// 链接健康检查：断链 / 孤儿笔记 / 重名笔记 / 标签分布
// 链接解析规则与宿主一致：[[目标]] 按「文件名去掉 .md」匹配
const WIKI_RE = /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g
const TAG_RE = /(^|\s)#([^\s#]+)/g

const S = {
  wrap: { fontSize: 13, color: 'var(--text)' },
  row: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  btn: {
    padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border)',
    background: 'var(--bg-panel)', color: 'var(--text)', cursor: 'pointer', fontSize: 12
  },
  muted: { color: 'var(--text-secondary)', fontSize: 12 },
  stat: { flex: '1 1 74px', minWidth: 74, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-panel)' },
  statNum: { fontSize: 20, fontWeight: 700, lineHeight: 1.2 },
  statLbl: { fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 },
  sec: { border: '1px solid var(--border)', borderRadius: 8, marginBottom: 8, overflow: 'hidden' },
  secHead: {
    display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px',
    background: 'var(--bg-hover)', cursor: 'pointer', fontSize: 13, fontWeight: 600
  },
  line: {
    display: 'flex', alignItems: 'flex-start', gap: 8, padding: '5px 10px',
    borderTop: '1px solid var(--border)', fontSize: 12, lineHeight: 1.5
  },
  badge: { fontSize: 11, padding: '1px 6px', borderRadius: 10, background: 'var(--bg-active)', whiteSpace: 'nowrap' },
  danger: { fontSize: 11, padding: '1px 6px', borderRadius: 10, background: 'var(--danger)', color: '#fff', whiteSpace: 'nowrap' },
  empty: { padding: '14px 10px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: 12 }
}

function titleOf(path) {
  const base = path.split('/').pop() || path
  return base.replace(/\.md$/i, '')
}

/** 提取链接与标签（跳过代码围栏，避免把示例当真实链接） */
function scanNote(content) {
  const links = []
  const tags = []
  let fence = null
  const lines = String(content || '').split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const f = /^\s*(```|~~~)/.exec(line)
    if (f) { fence = fence ? null : f[1]; continue }
    if (fence) continue
    WIKI_RE.lastIndex = 0
    let m
    while ((m = WIKI_RE.exec(line))) links.push({ target: m[1].trim(), line: i + 1 })
    TAG_RE.lastIndex = 0
    let t
    while ((t = TAG_RE.exec(line))) tags.push(t[2])
  }
  return { links, tags }
}

/** 编辑距离（用于给断链推荐最接近的标题） */
function lev(a, b) {
  const m = a.length
  const n = b.length
  if (!m) return n
  if (!n) return m
  let prev = new Array(n + 1)
  let cur = new Array(n + 1)
  for (let j = 0; j <= n; j++) prev[j] = j
  for (let i = 1; i <= m; i++) {
    cur[0] = i
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    const tmp = prev; prev = cur; cur = tmp
  }
  return prev[n]
}

function suggestTitle(target, titles) {
  const t = target.toLowerCase()
  let best = ''
  let bestScore = 0
  for (const name of titles) {
    const n = name.toLowerCase()
    let score = 0
    if (n === t) score = 100
    else if (n.includes(t) || t.includes(n)) score = 60 + Math.min(n.length, t.length)
    else {
      const d = lev(n, t)
      if (d <= Math.max(1, Math.floor(t.length / 3))) score = 40 - d * 5
    }
    if (score > bestScore) { bestScore = score; best = name }
  }
  return bestScore >= 40 ? best : ''
}

export default {
  manifest: {
    id: 'linkCheck',
    name: '链接健康检查',
    version: '1.0.0',
    description: '扫描全库双向链接，报告断链、孤儿笔记、重名笔记与标签分布'
  },

  activate(ctx) {
    const R = window.XNoteReact
    const h = R.createElement

    async function analyze() {
      const lib = await ctx.storage.loadAll()
      const paths = Object.keys(lib)
      const titles = paths.map(titleOf)
      const byLower = new Map()   // 小写标题 → 路径数组
      for (const p of paths) {
        const k = titleOf(p).toLowerCase()
        if (!byLower.has(k)) byLower.set(k, [])
        byLower.get(k).push(p)
      }

      const broken = []            // { from, fromTitle, target, line, suggest }
      const inbound = new Map()    // path → 入链数（不含自引用）
      const tagCount = new Map()
      let linkTotal = 0

      for (const path of paths) {
        const { links, tags } = scanNote(lib[path].content)
        linkTotal += links.length
        for (const g of tags) tagCount.set(g, (tagCount.get(g) || 0) + 1)
        for (const l of links) {
          const hit = byLower.get(l.target.toLowerCase())
          if (!hit) {
            broken.push({
              from: path, fromTitle: titleOf(path), target: l.target, line: l.line,
              suggest: suggestTitle(l.target, titles)
            })
          } else {
            for (const p of hit) if (p !== path) inbound.set(p, (inbound.get(p) || 0) + 1)
          }
        }
      }

      const orphans = paths
        .filter(p => !inbound.get(p))
        .map(p => ({ path: p, title: titleOf(p), links: scanNote(lib[p].content).links.length }))
        .sort((a, b) => a.title.localeCompare(b.title))

      const dups = [...byLower.entries()]
        .filter(([, ps]) => ps.length > 1)
        .map(([title, ps]) => ({ title, paths: ps }))

      return {
        total: paths.length,
        linkTotal,
        broken,
        orphans,
        dups,
        tags: [...tagCount.entries()].sort((a, b) => b[1] - a[1]),
        at: Date.now()
      }
    }

    function toReport(d) {
      const stamp = new Date().toISOString().slice(0, 10)
      const out = ['# 链接健康检查报告 ' + stamp, '', '| 指标 | 数值 |', '| --- | --- |',
        '| 笔记数 | ' + d.total + ' |', '| 双向链接 | ' + d.linkTotal + ' |',
        '| 断链 | ' + d.broken.length + ' |', '| 孤儿笔记 | ' + d.orphans.length + ' |',
        '| 重名笔记 | ' + d.dups.length + ' |', '| 标签数 | ' + d.tags.length + ' |', '']
      out.push('## 断链（' + d.broken.length + '）', '')
      if (!d.broken.length) out.push('无', '')
      for (const b of d.broken) {
        out.push('- `[[' + b.target + ']]` ← ' + b.fromTitle + ' L' + b.line + (b.suggest ? '（建议：`[[' + b.suggest + ']]`）' : ''))
      }
      out.push('', '## 孤儿笔记（' + d.orphans.length + '）', '')
      if (!d.orphans.length) out.push('无', '')
      for (const o of d.orphans) out.push('- ' + o.title + '（' + o.path + '）')
      if (d.dups.length) {
        out.push('', '## 重名笔记（' + d.dups.length + '）', '')
        for (const g of d.dups) out.push('- ' + g.title + ' → ' + g.paths.join(' / '))
      }
      out.push('', '## 标签分布', '')
      for (const [g, n] of d.tags.slice(0, 40)) out.push('- #' + g + ' × ' + n)
      return out.join('\n')
    }

    /* ---------- 面板 ---------- */
    function Panel() {
      const [data, setData] = R.useState(null)
      const [busy, setBusy] = R.useState(false)
      const [err, setErr] = R.useState('')
      const [open, setOpen] = R.useState({ broken: true, orphans: true, dups: false, tags: false })

      async function refresh() {
        setBusy(true); setErr('')
        try { setData(await analyze()) }
        catch (e) { setErr(String(e && e.message || e)) }
        finally { setBusy(false) }
      }
      R.useEffect(() => { void refresh() }, [])

      async function exportReport() {
        try {
          if (!data) return
          const path = '链接检查报告-' + new Date().toISOString().slice(0, 10) + '.md'
          await ctx.storage.writeFile(path, toReport(data))
          await ctx.storage.reloadLibrary()
          ctx.ui.showToast('报告已导出：' + path, 'success')
        } catch (e) { ctx.ui.showToast(String(e && e.message || e), 'error') }
      }

      const stat = (n, label, color) => h('div', { style: S.stat },
        h('div', { style: { ...S.statNum, color } }, String(n)),
        h('div', { style: S.statLbl }, label))

      const section = (key, title, count, body) => h('div', { style: S.sec },
        h('div', { style: S.secHead, onClick: () => setOpen(o => ({ ...o, [key]: !o[key] })) },
          h('span', { style: { color: 'var(--text-secondary)', fontSize: 11 } }, open[key] ? '▼' : '▶'),
          h('span', { style: { flex: 1 } }, title),
          h('span', { style: S.muted }, count + ' 项')
        ),
        open[key] && body
      )

      const header = h('div', { style: { ...S.row, marginBottom: 10 } },
        h('button', { style: S.btn, disabled: busy, onClick: () => void refresh() }, busy ? '扫描中…' : '重新扫描'),
        h('button', { style: S.btn, disabled: !data, onClick: () => void exportReport() }, '导出报告')
      )

      const stats = data && h('div', { style: { ...S.row, marginBottom: 10, alignItems: 'stretch' } },
        stat(data.total, '笔记'),
        stat(data.linkTotal, '双向链接'),
        stat(data.broken.length, '断链', data.broken.length ? 'var(--danger)' : undefined),
        stat(data.orphans.length, '孤儿笔记'),
        stat(data.dups.length, '重名'),
        stat(data.tags.length, '标签')
      )

      const body = data && h('div', null,
        section('broken', '断链（引用了不存在的笔记）', data.broken.length,
          data.broken.length === 0
            ? h('div', { style: S.empty }, '全部链接有效 ✓')
            : data.broken.map((b, i) => h('div', { key: 'b' + i, style: S.line },
              h('span', { style: S.danger }, '✗'),
              h('div', { style: { flex: 1, minWidth: 0 } },
                h('div', { style: { wordBreak: 'break-all' } }, '[[' + b.target + ']]'),
                h('div', { style: { ...S.muted, marginTop: 2 } },
                  '来自 ' + b.fromTitle + ' · L' + b.line,
                  b.suggest ? ' · 建议改为 [[' + b.suggest + ']]' : ''
                )
              )
            ))
        ),
        section('orphans', '孤儿笔记（没有任何入链）', data.orphans.length,
          data.orphans.length === 0
            ? h('div', { style: S.empty }, '所有笔记都有入链 ✓')
            : data.orphans.map(o => h('div', { key: o.path, style: S.line },
              h('span', { style: S.muted }, '·'),
              h('div', { style: { flex: 1, minWidth: 0 } },
                h('div', { style: { wordBreak: 'break-all' } }, o.title),
                h('div', { style: { ...S.muted, marginTop: 2 } }, o.path + ' · 内含 ' + o.links + ' 条链接')
              )
            ))
        ),
        section('dups', '重名笔记（[[链接]] 会同时指向全部）', data.dups.length,
          data.dups.length === 0
            ? h('div', { style: S.empty }, '没有重名笔记 ✓')
            : data.dups.map(d => h('div', { key: d.title, style: S.line },
              h('span', { style: S.badge }, d.title),
              h('div', { style: { flex: 1, minWidth: 0, wordBreak: 'break-all' } }, d.paths.join('  /  '))
            ))
        ),
        section('tags', '标签分布', data.tags.length,
          data.tags.length === 0
            ? h('div', { style: S.empty }, '还没有使用 #标签')
            : h('div', { style: { ...S.row, padding: 10, gap: 6 } },
              data.tags.slice(0, 40).map(([g, n]) => h('span', { key: g, style: S.badge }, '#' + g + ' ' + n))
            )
        )
      )

      return h('div', { style: S.wrap },
        header,
        stats,
        err && h('div', { style: { color: 'var(--danger)', fontSize: 12, marginBottom: 8 } }, err),
        body || h('div', { style: S.empty }, busy ? '正在扫描全库…' : '暂无数据')
      )
    }

    ctx.ui.registerSettingsPanel({ id: 'linkCheck', title: '链接健康检查', render: () => h(Panel, null) })

    ctx.ui.registerCommand({
      id: 'link-check.run',
      title: '检查链接健康',
      run: async () => {
        try {
          const d = await analyze()
          const msg = d.broken.length || d.orphans.length
            ? '断链 ' + d.broken.length + ' · 孤儿 ' + d.orphans.length + ' · 重名 ' + d.dups.length
            : '链接全部健康：' + d.linkTotal + ' 条双向链接无断链'
          ctx.ui.showToast(msg, d.broken.length ? 'error' : 'success')
        } catch (e) { ctx.ui.showToast(String(e && e.message || e), 'error') }
      }
    })

    ctx.log('link-check 已激活')
  }
}
