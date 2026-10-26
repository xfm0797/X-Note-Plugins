// 全库待办看板：扫描所有笔记里的 - [ ] 任务，聚合展示，勾选即回写原文件
// 语法：- [ ] 任务内容  #标签  @due(2026-12-31)
const TASK_RE = /^(\s*)(?:[-*+]|\d+[.)])\s+\[([ xX])\]\s*(.*)$/
const TAG_RE = /(^|\s)#([^\s#]+)/g
const DUE_RE = /(?:@due\((\d{4}-\d{2}-\d{2})\)|📅\s*(\d{4}-\d{2}-\d{2})|(?:^|\s)due:(\d{4}-\d{2}-\d{2}))/i

const S = {
  wrap: { fontSize: 13, color: 'var(--text)' },
  row: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  btn: {
    padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border)',
    background: 'var(--bg-panel)', color: 'var(--text)', cursor: 'pointer', fontSize: 12
  },
  btnOn: {
    padding: '5px 10px', borderRadius: 6, border: '1px solid var(--accent)',
    background: 'var(--bg-active)', color: 'var(--text)', cursor: 'pointer', fontSize: 12
  },
  input: {
    padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border)',
    background: 'var(--bg-panel)', color: 'var(--text)', fontSize: 12, outline: 'none'
  },
  muted: { color: 'var(--text-secondary)', fontSize: 12 },
  stat: { flex: '1 1 80px', minWidth: 80, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-panel)' },
  statNum: { fontSize: 20, fontWeight: 700, lineHeight: 1.2 },
  statLbl: { fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 },
  group: { border: '1px solid var(--border)', borderRadius: 8, marginBottom: 8, overflow: 'hidden' },
  groupHead: {
    display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px',
    background: 'var(--bg-hover)', cursor: 'pointer', fontSize: 13
  },
  task: {
    display: 'flex', alignItems: 'flex-start', gap: 8, padding: '5px 10px',
    borderTop: '1px solid var(--border)', lineHeight: 1.5
  },
  tag: {
    fontSize: 11, padding: '1px 6px', borderRadius: 10,
    background: 'var(--bg-active)', color: 'var(--text)', whiteSpace: 'nowrap'
  },
  due: { fontSize: 11, padding: '1px 6px', borderRadius: 10, background: 'var(--bg-hover)', color: 'var(--text-secondary)', whiteSpace: 'nowrap' },
  dueBad: { fontSize: 11, padding: '1px 6px', borderRadius: 10, background: 'var(--danger)', color: '#fff', whiteSpace: 'nowrap' },
  empty: { padding: '18px 10px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: 12 }
}

function pad2(n) { return String(n).padStart(2, '0') }
function todayStr() {
  const d = new Date()
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
}
function titleOf(path) {
  const base = path.split('/').pop() || path
  return base.replace(/\.md$/i, '')
}

/** 解析单篇笔记里的任务（跳过 ``` / ~~~ 围栏内的伪任务） */
function parseNote(path, content) {
  const lines = String(content || '').split(/\r?\n/)
  const tasks = []
  let done = 0
  let fence = null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const f = /^\s*(```|~~~)/.exec(line)
    if (f) { fence = fence ? null : f[1]; continue }
    if (fence) continue
    const m = TASK_RE.exec(line)
    if (!m) continue
    const checked = m[2] !== ' '
    if (checked) { done++; continue }
    const text = (m[3] || '').trim()
    const tags = []
    TAG_RE.lastIndex = 0
    let t
    while ((t = TAG_RE.exec(text))) tags.push(t[2])
    const d = DUE_RE.exec(text)
    tasks.push({
      path, line: i, text, indent: m[1].length, tags,
      due: d ? (d[1] || d[2] || d[3]) : null
    })
  }
  return { path, title: titleOf(path), tasks, done }
}

export default {
  manifest: {
    id: 'todoDashboard',
    name: '全库待办看板',
    version: '1.0.0',
    description: '扫描全库任务清单，勾选即回写原文件；支持标签/到期日筛选与完成率统计'
  },

  activate(ctx) {
    const R = window.XNoteReact
    const h = R.createElement

    async function scanAll() {
      const lib = await ctx.storage.loadAll()
      const notes = []
      let open = 0
      let done = 0
      for (const [path, meta] of Object.entries(lib)) {
        const r = parseNote(path, meta.content)
        done += r.done
        if (!r.tasks.length) continue
        notes.push(r)
        open += r.tasks.length
      }
      notes.sort((a, b) => b.tasks.length - a.tasks.length || a.title.localeCompare(b.title))
      return { notes, open, done, total: Object.keys(lib).length, at: Date.now() }
    }

    /** 勾选任务：把原文件对应行 [ ] → [x]（行号漂移时按文本兜底定位） */
    async function completeTask(item) {
      const content = await ctx.storage.readFile(item.path)
      if (content == null) throw new Error('读取笔记失败：' + item.path)
      const lines = content.split(/\r?\n/)
      const hit = i => {
        const m = TASK_RE.exec(lines[i] || '')
        return !!m && m[2] === ' ' && (m[3] || '').trim() === item.text
      }
      let idx = item.line
      if (!(idx >= 0 && idx < lines.length && hit(idx))) idx = lines.findIndex((_, i) => hit(i))
      if (idx < 0) throw new Error('任务位置已变化，请点「刷新」重扫')
      lines[idx] = lines[idx].replace(/\[[ xX]\]/, '[x]')
      await ctx.storage.writeFile(item.path, lines.join('\n'))
      await ctx.storage.reloadLibrary()
    }

    async function exportList(data) {
      const t0 = todayStr()
      const out = ['# 待办汇总 ' + t0, '', '共 **' + data.open + '** 项未完成，已完成 ' + data.done + ' 项。', '']
      for (const n of data.notes) {
        out.push('## ' + n.title + '（' + n.tasks.length + '）', '')
        for (const t of n.tasks) out.push('- [ ] ' + t.text)
        out.push('')
      }
      const path = '待办汇总-' + t0 + '.md'
      await ctx.storage.writeFile(path, out.join('\n'))
      await ctx.storage.reloadLibrary()
      ctx.ui.showToast('已导出到 ' + path, 'success')
    }

    /* ---------- 面板 ---------- */
    function Panel() {
      const [data, setData] = R.useState(null)
      const [busy, setBusy] = R.useState(false)
      const [err, setErr] = R.useState('')
      const [filter, setFilter] = R.useState('all')
      const [query, setQuery] = R.useState('')
      const [collapsed, setCollapsed] = R.useState({})

      async function refresh() {
        setBusy(true); setErr('')
        try { setData(await scanAll()) }
        catch (e) { setErr(String(e && e.message || e)) }
        finally { setBusy(false) }
      }
      R.useEffect(() => { void refresh() }, [])

      const t0 = todayStr()

      const tags = R.useMemo(() => {
        if (!data) return []
        const map = new Map()
        for (const n of data.notes) for (const t of n.tasks) for (const g of t.tags) map.set(g, (map.get(g) || 0) + 1)
        return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
      }, [data])

      const overdue = R.useMemo(() => {
        if (!data) return 0
        let n = 0
        for (const note of data.notes) for (const t of note.tasks) if (t.due && t.due < t0) n++
        return n
      }, [data, t0])

      const view = R.useMemo(() => {
        if (!data) return []
        const q = query.trim().toLowerCase()
        return data.notes.map(n => {
          const tasks = n.tasks.filter(t => {
            if (q && !(t.text.toLowerCase().includes(q) || n.title.toLowerCase().includes(q))) return false
            if (filter === 'today') return t.due === t0
            if (filter === 'overdue') return !!t.due && t.due < t0
            if (filter.indexOf('tag:') === 0) return t.tags.includes(filter.slice(4))
            return true
          })
          return { ...n, tasks }
        }).filter(n => n.tasks.length > 0)
      }, [data, filter, query, t0])

      async function onDone(note, task) {
        try {
          await completeTask(task)
          setData(d => {
            if (!d) return d
            return {
              ...d,
              open: Math.max(0, d.open - 1),
              done: d.done + 1,
              notes: d.notes.map(n => n.path === note.path
                ? { ...n, done: n.done + 1, tasks: n.tasks.filter(t => !(t.line === task.line && t.text === task.text)) }
                : n)
            }
          })
          ctx.ui.showToast('已完成：' + (task.text.length > 24 ? task.text.slice(0, 24) + '…' : task.text), 'success')
        } catch (e) {
          ctx.ui.showToast(String(e && e.message || e), 'error')
        }
      }

      const chip = (key, label) => h('button', {
        style: filter === key ? S.btnOn : S.btn,
        onClick: () => setFilter(key)
      }, label)

      const header = h('div', { style: { ...S.row, marginBottom: 10 } },
        h('button', { style: S.btn, onClick: () => void refresh(), disabled: busy }, busy ? '扫描中…' : '刷新'),
        h('input', {
          style: { ...S.input, flex: '1 1 140px', minWidth: 120 },
          placeholder: '搜索任务 / 笔记标题…',
          value: query,
          onChange: e => setQuery(e.target.value)
        }),
        h('button', {
          style: S.btn,
          onClick: () => { if (data) void exportList(data).catch(e => ctx.ui.showToast(String(e), 'error')) }
        }, '导出清单')
      )

      const stats = data && h('div', { style: { ...S.row, marginBottom: 10, alignItems: 'stretch' } },
        h('div', { style: S.stat },
          h('div', { style: { ...S.statNum, color: 'var(--accent)' } }, String(data.open)),
          h('div', { style: S.statLbl }, '未完成')),
        h('div', { style: S.stat },
          h('div', { style: S.statNum }, String(data.done)),
          h('div', { style: S.statLbl }, '已完成')),
        h('div', { style: S.stat },
          h('div', { style: { ...S.statNum, color: overdue ? 'var(--danger)' : undefined } }, String(overdue)),
          h('div', { style: S.statLbl }, '已逾期')),
        h('div', { style: S.stat },
          h('div', { style: S.statNum }, String(data.notes.length)),
          h('div', { style: S.statLbl }, '涉及笔记'))
      )

      const filters = data && h('div', { style: { ...S.row, marginBottom: 10, gap: 6 } },
        chip('all', '全部'),
        chip('today', '今天到期'),
        chip('overdue', '逾期'),
        ...tags.map(([g, n]) => chip('tag:' + g, '#' + g + ' ' + n))
      )

      const body = !data
        ? h('div', { style: S.empty }, busy ? '正在扫描全库…' : '暂无数据')
        : view.length === 0
          ? h('div', { style: S.empty }, query || filter !== 'all' ? '没有匹配的待办' : '全库没有未完成任务 🎉')
          : view.map(note => {
            const open = collapsed[note.path]
            return h('div', { key: note.path, style: S.group },
              h('div', {
                style: S.groupHead,
                onClick: () => setCollapsed(c => ({ ...c, [note.path]: !c[note.path] })),
                title: note.path
              },
                h('span', { style: { color: 'var(--text-secondary)', fontSize: 11 } }, open ? '▶' : '▼'),
                h('span', { style: { fontWeight: 600, flex: 1 } }, note.title),
                h('span', { style: S.muted }, note.tasks.length + ' 项待办'),
                note.done > 0 && h('span', { style: S.tag }, '已完成 ' + note.done)
              ),
              !open && note.tasks.map(t => h('div', { key: note.path + ':' + t.line, style: S.task },
                h('input', {
                  type: 'checkbox', checked: false, style: { marginTop: 3, cursor: 'pointer' },
                  onChange: () => void onDone(note, t)
                }),
                h('div', { style: { flex: 1, minWidth: 0, wordBreak: 'break-word' } },
                  h('span', null, t.text),
                  h('div', { style: { ...S.row, gap: 5, marginTop: 3 } },
                    t.due && h('span', { style: t.due < t0 ? S.dueBad : S.due }, t.due < t0 ? '逾期 ' + t.due : t.due === t0 ? '今天到期' : t.due),
                    t.tags.map(g => h('span', { key: g, style: S.tag }, '#' + g))
                  )
                )
              ))
            )
          })

      return h('div', { style: S.wrap },
        header,
        stats,
        filters,
        err && h('div', { style: { color: 'var(--danger)', fontSize: 12, marginBottom: 8 } }, err),
        body,
        data && h('div', { style: { ...S.muted, marginTop: 8 } },
          '任务语法：- [ ] 内容  #标签  @due(2026-12-31) · 勾选后立即写回原文件')
      )
    }

    ctx.ui.registerSettingsPanel({ id: 'todoDashboard', title: '全库待办看板', render: () => h(Panel, null) })

    ctx.ui.registerCommand({
      id: 'todo-dashboard.summary',
      title: '待办统计',
      run: async () => {
        try {
          const d = await scanAll()
          ctx.ui.showToast('未完成 ' + d.open + ' 项 · 已完成 ' + d.done + ' 项 · 涉及 ' + d.notes.length + ' 篇笔记', 'info')
        } catch (e) { ctx.ui.showToast(String(e && e.message || e), 'error') }
      }
    })

    ctx.log('todo-dashboard 已激活')
  }
}
