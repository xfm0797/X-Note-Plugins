// 全库批量查找替换：预览命中 → 备份 → 执行 → 可一键撤销
// 备份写入笔记库 .xnote-bulk-backup/<时间戳>/（以 . 开头，不会出现在文件树）
const IS_TAURI = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
const BACKUP_DIR = '.xnote-bulk-backup'

const S = {
  wrap: { fontSize: 13, color: 'var(--text)' },
  row: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  btn: {
    padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border)',
    background: 'var(--bg-panel)', color: 'var(--text)', cursor: 'pointer', fontSize: 12
  },
  btnPrimary: {
    padding: '5px 10px', borderRadius: 6, border: '1px solid var(--accent)',
    background: 'var(--accent)', color: 'var(--accent-text)', cursor: 'pointer', fontSize: 12
  },
  btnDanger: {
    padding: '5px 10px', borderRadius: 6, border: '1px solid var(--danger)',
    background: 'var(--danger)', color: '#fff', cursor: 'pointer', fontSize: 12
  },
  input: {
    padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border)',
    background: 'var(--bg-panel)', color: 'var(--text)', fontSize: 12, outline: 'none'
  },
  muted: { color: 'var(--text-secondary)', fontSize: 12 },
  group: { border: '1px solid var(--border)', borderRadius: 8, marginBottom: 6, overflow: 'hidden' },
  groupHead: {
    display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
    background: 'var(--bg-hover)', fontSize: 12
  },
  sample: {
    padding: '4px 10px', borderTop: '1px solid var(--border)',
    fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 11,
    color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', wordBreak: 'break-all'
  },
  mark: { background: 'var(--bg-active)', color: 'var(--text)', padding: '0 2px', borderRadius: 2 }
}

function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

function buildMatcher(find, opts) {
  let src = opts.regex ? find : escapeRe(find)
  // 全词匹配用零宽断言（不能消费相邻字符，否则替换会误伤）
  if (opts.word) src = '(?<![\\w\\u4e00-\\u9fa5])(?:' + src + ')(?![\\w\\u4e00-\\u9fa5])'
  return new RegExp(src, opts.caseSensitive ? 'g' : 'gi')
}

/** 把位置映射为行号 */
function lineOf(lineStarts, pos) {
  let lo = 0
  let hi = lineStarts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (lineStarts[mid] <= pos) lo = mid
    else hi = mid - 1
  }
  return lo
}

function sampleOf(content, re, max) {
  const lineStarts = [0]
  for (let i = 0; i < content.length; i++) if (content.charCodeAt(i) === 10) lineStarts.push(i + 1)
  const out = []
  re.lastIndex = 0
  let m
  let guard = 0
  while ((m = re.exec(content)) && out.length < max && guard++ < 5000) {
    const li = lineOf(lineStarts, m.index)
    const start = lineStarts[li]
    const nl = content.indexOf('\n', start)
    const end = nl === -1 ? content.length : nl
    out.push({ line: li + 1, text: content.slice(start, end).slice(0, 180) })
    if (m[0] === '') re.lastIndex++
  }
  return out
}

export default {
  manifest: {
    id: 'bulkReplace',
    name: '全库批量查找替换',
    version: '1.0.0',
    description: '正则/字面批量替换全库笔记，先预览命中位置再执行；自动备份并支持一键撤销'
  },

  activate(ctx) {
    const R = window.XNoteReact
    const h = R.createElement

    /** 扫描命中（不动文件） */
    async function preview(find, opts) {
      const re = buildMatcher(find, opts)
      const lib = await ctx.storage.loadAll()
      const files = []
      let total = 0
      for (const [path, meta] of Object.entries(lib)) {
        const content = meta.content || ''
        re.lastIndex = 0
        const hits = content.match(re)
        if (!hits || !hits.length) continue
        total += hits.length
        files.push({ path, count: hits.length, samples: sampleOf(content, re, 3) })
      }
      files.sort((a, b) => b.count - a.count)
      return { files, total, scanned: Object.keys(lib).length }
    }

    /** 备份被修改的文件；返回 manifest（存 settings 供撤销） */
    async function backup(changes) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      const manifest = { at: stamp, entries: [] }
      if (IS_TAURI) {
        for (const [path, old] of changes) {
          const bp = BACKUP_DIR + '/' + stamp + '/' + path
          await ctx.storage.writeFile(bp, old)
          manifest.entries.push({ path, backup: bp })
        }
      } else {
        let size = 0
        for (const [, old] of changes) size += old.length
        if (size > 3_000_000) throw new Error('内容超过 3MB，浏览器模式无法建立备份，请改用桌面端执行')
        manifest.entries = changes.map(([path, old]) => ({ path, backup: null, content: old }))
      }
      ctx.settings.set('lastBackup', manifest)
      return manifest
    }

    /** 执行替换：返回 { files, total } */
    async function run(find, opts, repl) {
      const re = buildMatcher(find, opts)
      // 非正则模式下替换串按字面处理（转义 $）
      const template = opts.regex ? repl : String(repl).replace(/\$/g, '$$$$')
      const lib = await ctx.storage.loadAll()
      const changes = []
      for (const [path, meta] of Object.entries(lib)) {
        const content = meta.content || ''
        re.lastIndex = 0
        if (!re.test(content)) continue
        re.lastIndex = 0
        const next = content.replace(re, template)
        if (next !== content) changes.push([path, content, next])
      }
      if (!changes.length) return { files: 0, total: 0 }
      await backup(changes.map(([p, old]) => [p, old]))
      let total = 0
      for (const [path, old, next] of changes) {
        re.lastIndex = 0
        total += (old.match(re) || []).length
        await ctx.storage.writeFile(path, next)
      }
      await ctx.storage.reloadLibrary()
      return { files: changes.length, total }
    }

    /** 撤销上一次替换 */
    async function undo() {
      const m = ctx.settings.get('lastBackup', null)
      if (!m || !m.entries || !m.entries.length) throw new Error('没有可撤销的记录')
      let n = 0
      for (const e of m.entries) {
        const old = e.content != null ? e.content : await ctx.storage.readFile(e.backup)
        if (old == null) continue
        await ctx.storage.writeFile(e.path, old)
        n++
      }
      await ctx.storage.reloadLibrary()
      ctx.settings.set('lastBackup', null)
      return n
    }

    /* ---------- 面板 ---------- */
    function Panel() {
      const [find, setFind] = R.useState('')
      const [repl, setRepl] = R.useState('')
      const [opts, setOpts] = R.useState({ regex: false, caseSensitive: false, word: false })
      const [res, setRes] = R.useState(null)
      const [busy, setBusy] = R.useState(false)
      const [err, setErr] = R.useState('')
      const [armed, setArmed] = R.useState(false)
      const [backup, setBackup] = R.useState(() => ctx.settings.get('lastBackup', null))

      const toggle = k => { setOpts(o => ({ ...o, [k]: !o[k] })); setRes(null); setArmed(false) }

      async function doPreview() {
        if (!find) { setErr('请输入查找内容'); return }
        setBusy(true); setErr(''); setArmed(false)
        try { setRes(await preview(find, opts)) }
        catch (e) { setErr(String(e && e.message || e)) }
        finally { setBusy(false) }
      }

      async function doReplace() {
        if (!res || !res.total) return
        if (!armed) { setArmed(true); return }
        setBusy(true); setErr(''); setArmed(false)
        try {
          const r = await run(find, opts, repl)
          ctx.ui.showToast('已替换 ' + r.total + ' 处，涉及 ' + r.files + ' 篇笔记', 'success')
          setBackup(ctx.settings.get('lastBackup', null))
          setRes(null)
        } catch (e) { setErr(String(e && e.message || e)) }
        finally { setBusy(false) }
      }

      async function doUndo() {
        setBusy(true); setErr('')
        try {
          const n = await undo()
          ctx.ui.showToast('已撤销，恢复 ' + n + ' 篇笔记', 'success')
          setBackup(null); setRes(null)
        } catch (e) { setErr(String(e && e.message || e)) }
        finally { setBusy(false) }
      }

      const field = (label, value, onChange, placeholder) =>
        h('div', { style: { ...S.row, marginBottom: 6 } },
          h('span', { style: { ...S.muted, width: 46, flex: 'none' } }, label),
          h('input', { style: { ...S.input, flex: 1 }, value, placeholder, onChange: e => { onChange(e.target.value); setRes(null); setArmed(false) } })
        )

      const optBtn = (k, label) => h('button', { style: opts[k] ? S.btnPrimary : S.btn, onClick: () => toggle(k) }, label)

      return h('div', { style: S.wrap },
        field('查找', find, setFind, '要查找的文本，或正则表达式'),
        field('替换为', repl, setRepl, '替换为（留空即删除匹配内容' + (opts.regex ? '，可用 $1 引用分组' : '') + '）'),

        h('div', { style: { ...S.row, marginBottom: 10 } },
          optBtn('regex', '正则'),
          optBtn('caseSensitive', '区分大小写'),
          optBtn('word', '全词匹配'),
          h('span', { style: { flex: 1 } }),
          h('button', { style: S.btn, disabled: busy, onClick: () => void doPreview() }, busy ? '处理中…' : '预览'),
          res && res.total > 0 && h('button', {
            style: armed ? S.btnDanger : S.btnPrimary, disabled: busy, onClick: () => void doReplace()
          }, armed ? '确认替换 ' + res.total + ' 处？' : '全部替换'),
          backup && h('button', { style: S.btn, disabled: busy, onClick: () => void doUndo() }, '撤销上次')
        ),

        err && h('div', { style: { color: 'var(--danger)', fontSize: 12, marginBottom: 8 } }, err),

        res && h('div', { style: { ...S.muted, marginBottom: 8 } },
          res.total > 0
            ? '共 ' + res.total + ' 处命中，分布在 ' + res.files.length + ' 篇笔记（已扫描 ' + res.scanned + ' 篇）'
            : '未找到匹配内容'),

        res && res.files.map(f => h('div', { key: f.path, style: S.group },
          h('div', { style: S.groupHead },
            h('span', { style: { flex: 1, wordBreak: 'break-all' } }, f.path),
            h('span', { style: { fontSize: 11, padding: '1px 6px', borderRadius: 10, background: 'var(--bg-active)' } }, f.count + ' 处')
          ),
          f.samples.map(s => h('div', { key: 's' + s.line, style: S.sample }, h('span', { style: { opacity: 0.65 } }, 'L' + s.line + '  '), s.text))
        )),

        h('div', { style: { ...S.muted, marginTop: 8 } },
          IS_TAURI ? '执行前会自动备份到 ' + BACKUP_DIR + '/，可随时撤销' : '浏览器模式：备份存于本地设置，超过 3MB 将拒绝执行')
      )
    }

    ctx.ui.registerSettingsPanel({ id: 'bulkReplace', title: '全库批量查找替换', render: () => h(Panel, null) })

    ctx.ui.registerCommand({
      id: 'bulk-replace.undo',
      title: '撤销上次批量替换',
      run: async () => {
        try {
          const n = await undo()
          ctx.ui.showToast('已撤销，恢复 ' + n + ' 篇笔记', 'success')
        } catch (e) { ctx.ui.showToast(String(e && e.message || e), 'error') }
      }
    })

    ctx.log('bulk-replace 已激活')
  }
}
