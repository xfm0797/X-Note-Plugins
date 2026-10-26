// ===== AI 写作助手（X-Note 外部插件）=====
// 选中内容 → 调 OpenAI 兼容的 /chat/completions → 预览 → 一键写回编辑器
// 请求统一走宿主 ctx.http：桌面端在 Rust 侧发出，绕开 WebView 的 CORS 限制；
// 编辑器读写走 ctx.editor，属于应用同一条自动保存/快照链路（Ctrl+Z 可撤销）。

const h = (...args) => window.XNoteReact.createElement(...args)

/* ---------------- 预设：常见 OpenAI 兼容服务 ---------------- */
const PRESETS = [
  { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { name: 'Kimi', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
  { name: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  { name: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
  { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' }
]

const DEFAULTS = {
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: '',
  model: 'deepseek-chat',
  temperature: 0.7,
  maxTokens: 2048,
  tone: '简洁专业',
  lang: '英语',
  summaryStyle: '3-5 条要点'
}

const TONES = ['简洁专业', '亲切自然', '严谨学术', '生动有感染力']
const LANGS = ['英语', '简体中文', '繁体中文', '日语', '韩语', '法语', '德语']
const SUMMARY_STYLES = ['3-5 条要点', '一段话（100 字内）', 'TL;DR 一句话']

const TASKS = [
  { id: 'polish', label: '润色', desc: '不改变原意，让表达更通顺、专业' },
  { id: 'translate', label: '翻译', desc: '多语言互译，保留 Markdown 结构与代码块' },
  { id: 'summary', label: '摘要', desc: '提炼要点，把长文压成摘要' },
  { id: 'meta', label: '标题标签', desc: '起标题 + 3-5 个标签，可直接写入笔记' },
  { id: 'custom', label: '自定义', desc: '用自己的提示词处理选中内容' }
]

const MAX_INPUT = 12000 // 单次送给模型的正文上限（字符），超出截断避免超长计费

/* ---------------- 样式 ---------------- */
const S = {
  wrap: { fontSize: 13, color: 'var(--text)' },
  row: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 8 },
  tabs: { display: 'flex', gap: 4, marginBottom: 6 },
  tab: {
    padding: '5px 12px', borderRadius: 7, border: '1px solid var(--border)',
    background: 'var(--bg-panel)', color: 'var(--text)', cursor: 'pointer', fontSize: 12
  },
  tabActive: {
    padding: '5px 12px', borderRadius: 7, border: '1px solid var(--accent)',
    background: 'var(--accent)', color: 'var(--accent-text)', cursor: 'pointer', fontSize: 12, fontWeight: 600
  },
  desc: { color: 'var(--text-secondary)', fontSize: 11.5, marginBottom: 10 },
  btn: {
    padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border)',
    background: 'var(--bg-panel)', color: 'var(--text)', cursor: 'pointer', fontSize: 12
  },
  primary: {
    padding: '6px 16px', borderRadius: 6, border: '1px solid var(--accent)',
    background: 'var(--accent)', color: 'var(--accent-text)', cursor: 'pointer', fontSize: 12, fontWeight: 600
  },
  danger: {
    padding: '5px 10px', borderRadius: 6, border: '1px solid var(--danger)',
    background: 'var(--bg-panel)', color: 'var(--danger)', cursor: 'pointer', fontSize: 12
  },
  chip: {
    padding: '3px 9px', borderRadius: 20, border: '1px solid var(--border)',
    background: 'var(--bg)', color: 'var(--text)', cursor: 'pointer', fontSize: 11.5
  },
  chipActive: {
    padding: '3px 9px', borderRadius: 20, border: '1px solid var(--accent)',
    background: 'var(--bg-active)', color: 'var(--text)', cursor: 'pointer', fontSize: 11.5, fontWeight: 600
  },
  mini: {
    padding: '2px 7px', borderRadius: 6, border: '1px solid var(--border)',
    background: 'var(--bg)', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 11
  },
  link: {
    border: 'none', background: 'transparent', color: 'var(--accent)',
    cursor: 'pointer', fontSize: 12, padding: '2px 0', textAlign: 'left'
  },
  input: {
    padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border)',
    background: 'var(--bg)', color: 'var(--text)', fontSize: 12, outline: 'none', minWidth: 0
  },
  cfgBox: {
    border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px',
    marginBottom: 10, background: 'var(--bg)'
  },
  field: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, fontSize: 12 },
  fieldLabel: { width: 68, color: 'var(--text-secondary)', flexShrink: 0 },
  hint: { color: 'var(--text-secondary)', fontSize: 11, marginBottom: 8 },
  muted: { color: 'var(--text-secondary)', fontSize: 11.5 },
  ok: { color: '#16a34a', fontSize: 11.5 },
  error: { color: 'var(--danger)', fontSize: 12, margin: '6px 0', whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
  warn: { color: '#b45309', fontSize: 11.5 },
  resultHead: { display: 'flex', alignItems: 'center', gap: 8, margin: '8px 0 4px' },
  result: {
    width: '100%', boxSizing: 'border-box', minHeight: 150, maxHeight: 260, resize: 'vertical',
    padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)',
    background: 'var(--bg)', color: 'var(--text)', fontSize: 12.5, lineHeight: 1.6, outline: 'none',
    fontFamily: 'inherit'
  },
  prompt: {
    width: '100%', boxSizing: 'border-box', minHeight: 52, marginBottom: 8,
    padding: '6px 9px', borderRadius: 6, border: '1px solid var(--border)',
    background: 'var(--bg)', color: 'var(--text)', fontSize: 12, outline: 'none', resize: 'vertical'
  },
  tag: {
    display: 'inline-block', padding: '1px 7px', marginRight: 4, borderRadius: 10,
    background: 'var(--bg-active)', color: 'var(--text)', fontSize: 11
  }
}

/* ---------------- 小工具 ---------------- */
function num(v, def) {
  const n = Number(v)
  return Number.isFinite(n) ? n : def
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** baseURL → /chat/completions 完整地址（已写全则原样使用） */
function endpoint(base) {
  const u = String(base || '').trim().replace(/\/+$/, '')
  if (!u) throw new Error('请先填写接口地址，例如 https://api.deepseek.com/v1')
  if (!/^https?:\/\//i.test(u)) throw new Error('接口地址需以 http:// 或 https:// 开头')
  if (/\/chat\/completions$/.test(u)) return u
  return u + '/chat/completions'
}

/** 去掉模型爱加的整段 ``` 包裹 */
function unfence(text) {
  const m = /^```[a-zA-Z0-9_-]*\n([\s\S]*?)\n?```$/.exec(text.trim())
  return m ? m[1] : text.trim()
}

function previewHost(base) {
  try { return new URL(String(base)).host } catch { return String(base || '未配置') }
}

/** 把接口错误整理成人话 */
function apiError(res) {
  let detail = ''
  const d = res.data
  if (d) detail = (d.error && (d.error.message || d.error.msg)) || d.message || ''
  if (!detail) detail = String(res.text || '').slice(0, 240)
  const tips = {
    400: '（请求被拒绝，检查模型名/参数）',
    401: '（Key 无效或未授权）',
    403: '（无权限，或模型未开通）',
    404: '（接口地址或模型名不对）',
    429: '（触发限流或余额不足）',
    500: '（服务端错误，稍后重试）'
  }
  return `HTTP ${res.status}${tips[res.status] || ''}：${detail}`
}

/** 正文里是否已有该标签 */
function hasTag(content, tag) {
  return new RegExp('(^|[\\s(（【\\[,，:：])#' + escapeRe(tag) + '($|[\\s)）】\\],，。！？；：、])').test(content)
}

/* ---------------- 提示词 ---------------- */
function buildMessages(task, cfg, text, opts) {
  const keepStructure = '保留 Markdown 结构、代码块、公式与链接原样，不要添加原文没有的事实。'
  switch (task) {
    case 'polish':
      return [
        {
          role: 'system',
          content: '你是一位严谨的中文写作编辑，擅长把口语化、冗余或生硬的表达改得通顺、准确、专业。只改表达，不改事实与结构。'
        },
        {
          role: 'user',
          content: `【语气】${opts.tone}\n【要求】${keepStructure}原文以中文为主就用中文输出，以英文为主就用英文输出。\n只输出润色后的文本，不要任何解释、标题或代码块包裹。\n\n【原文】\n${text}`
        }
      ]
    case 'translate':
      return [
        {
          role: 'system',
          content: '你是专业译者，精通中文与多语种互译，译文自然地道、术语准确，不做多余的意译或补充说明。'
        },
        {
          role: 'user',
          content: `【目标语言】${opts.lang}\n【要求】只输出译文；${keepStructure}\n不要解释、不要标注原文、不要加任何前后缀。\n\n【原文】\n${text}`
        }
      ]
    case 'summary':
      return [
        {
          role: 'system',
          content: '你是内容摘要助手，擅长提炼要点，只依据原文，不臆造信息。'
        },
        {
          role: 'user',
          content: `【摘要形式】${opts.style}\n【要求】输出 Markdown，只给摘要本身；要点形式用无序列表，一条一个要点，尽量不复述原句。\n\n【正文】\n${text}`
        }
      ]
    case 'meta':
      return [
        {
          role: 'system',
          content: '你是笔记整理助手，负责为 Markdown 笔记起标题、打标签。你的输出必须是可被 JSON.parse 解析的纯 JSON。'
        },
        {
          role: 'user',
          content: `【要求】输出严格 JSON，形如 {"title":"...","tags":["...","..."]}\n- title：不超过 24 个汉字，具体明确，不带 # 、书名号或末尾标点\n- tags：3-5 个中文短词，不带 # 号，能反映主题与所属领域\n- 只输出 JSON，不要代码块、不要注释、不要任何解释\n\n【正文】\n${text}`
        }
      ]
    default:
      return [
        { role: 'system', content: '你是严谨的写作助手，严格按用户指令处理文本，只输出结果本身。' },
        {
          role: 'user',
          content: `【指令】${opts.custom || '（未填写，按内容自行给出合适的处理）'}\n【要求】${keepStructure}\n只输出处理结果。\n\n【原文】\n${text}`
        }
      ]
  }
}

/* ---------------- 调模型 ---------------- */
async function callModel(ctx, cfg, messages, opts) {
  const key = String(cfg.apiKey || '').trim()
  if (!key) throw new Error('还没填 API Key：展开上方「接口设置」填写后重试')
  const model = String(cfg.model || '').trim()
  if (!model) throw new Error('还没填模型名，例如 deepseek-chat')
  const url = endpoint(cfg.baseUrl)
  const body = {
    model,
    messages,
    temperature: num(cfg.temperature, 0.7),
    max_tokens: Math.max(16, Math.round(num(opts && opts.maxTokens, num(cfg.maxTokens, 2048)))),
    stream: false
  }
  const res = await ctx.http.postJSON(url, body, { Authorization: 'Bearer ' + key }, 180000)
  if (!res.ok) throw new Error(apiError(res))
  const data = res.data
  if (!data) throw new Error('接口返回的不是 JSON：' + String(res.text || '').slice(0, 200))
  const msg = ((data.choices || [])[0] || {}).message || {}
  let content = ''
  if (typeof msg.content === 'string') content = msg.content
  else if (Array.isArray(msg.content)) content = msg.content.map(p => (p && (p.text || p.content)) || '').join('')
  if (!String(content).trim()) throw new Error('模型没有返回内容：' + JSON.stringify(data).slice(0, 160))
  return unfence(content)
}

/* ---------------- 标题/标签结果解析与写回 ---------------- */
function parseMeta(raw) {
  const text = String(raw || '').trim()
  if (!text) return null
  const m = /\{[\s\S]*\}/.exec(text)
  if (!m) return null
  try {
    const o = JSON.parse(m[0])
    const title = typeof o.title === 'string' ? o.title.replace(/^#+\s*/, '').trim() : ''
    const tags = (Array.isArray(o.tags) ? o.tags : [])
      .map(t => String(t).replace(/^#/, '').trim())
      .filter(Boolean)
      .slice(0, 8)
    if (!title && !tags.length) return null
    return { title, tags }
  } catch {
    return null
  }
}

/** 首个非空行若是标题则替换，否则在（front-matter 之后的）文首插入 */
function applyTitle(ctx, title) {
  const content = ctx.editor.getContent()
  const lines = content.split('\n')
  let offset = 0
  let firstNonEmpty = -1
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) { offset += lines[i].length + 1; continue }
    firstNonEmpty = i
    break
  }
  if (firstNonEmpty >= 0 && /^#\s+/.test(lines[firstNonEmpty])) {
    ctx.editor.replaceRange(offset, offset + lines[firstNonEmpty].length, '# ' + title)
    return '已替换一级标题'
  }
  // 有 front-matter（--- ... ---）时插到它后面，避免破坏元数据块
  let insertAt = 0
  if (lines[0] !== undefined && lines[0].trim() === '---') {
    const end = lines.indexOf('---', 1)
    if (end > 0) insertAt = lines.slice(0, end + 1).reduce((n, s) => n + s.length + 1, 0)
  }
  ctx.editor.replaceRange(insertAt, insertAt, '# ' + title + '\n\n')
  return '已在文首插入标题'
}

/** 标签插到一级标题下一行（没有标题则放文首），已存在的自动跳过 */
function applyTags(ctx, tags) {
  const content = ctx.editor.getContent()
  const fresh = tags.filter(t => !hasTag(content, t))
  if (!fresh.length) return '这些标签正文里都已经有了'
  const line = fresh.map(t => '#' + t).join(' ')
  const lines = content.split('\n')
  let pos = -1
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue
    if (/^#\s+/.test(lines[i])) pos = lines.slice(0, i + 1).reduce((n, s) => n + s.length + 1, 0)
    break
  }
  if (pos >= 0) {
    ctx.editor.replaceRange(pos, pos, '\n' + line)
  } else {
    const sep = content.length === 0 ? '' : content.endsWith('\n') ? '\n' : '\n\n'
    ctx.editor.replaceRange(content.length, content.length, sep + line + '\n')
  }
  return '已写入标签：' + fresh.join(' ')
}

/* ---------------- 组件：一行「标签 + 控件」 ---------------- */
function Field(props) {
  return h('div', { style: S.field },
    h('span', { style: S.fieldLabel }, props.label),
    props.children
  )
}

function SelectRow(props) {
  return h('div', { style: S.row },
    h('span', { style: S.muted }, props.label),
    h('select', {
      style: { ...S.input, padding: '4px 8px' },
      value: props.value,
      onChange: e => props.onChange(e.target.value)
    }, props.options.map(o => h('option', { key: o, value: o }, o)))
  )
}

/* ---------------- 组件：接口设置 ---------------- */
function ConfigSection(props) {
  const ctx = props.ctx
  const cfg = props.cfg
  const patch = props.patch
  const [testing, setTesting] = window.XNoteReact.useState(false)
  const [test, setTest] = window.XNoteReact.useState({ state: '', msg: '' })

  const runTest = async () => {
    setTesting(true)
    setTest({ state: 'busy', msg: '连接中…' })
    try {
      const out = await callModel(ctx, cfg, [{ role: 'user', content: '只回复两个字：可用' }], { maxTokens: 16 })
      setTest({ state: 'ok', msg: '连接成功，模型返回：' + out.replace(/\s+/g, ' ').slice(0, 40) })
    } catch (e) {
      setTest({ state: 'err', msg: String(e).replace(/^Error:\s*/, '') })
    } finally {
      setTesting(false)
    }
  }

  return h('div', { style: S.cfgBox },
    h('div', { style: S.row },
      h('span', { style: S.muted }, '预设'),
      PRESETS.map(p => h('button', {
        key: p.name,
        style: S.chip,
        title: p.baseUrl,
        onClick: () => patch({ baseUrl: p.baseUrl, model: p.model })
      }, p.name))
    ),
    h(Field, { label: '接口地址' },
      h('input', {
        style: { ...S.input, flex: 1 },
        value: cfg.baseUrl,
        placeholder: 'https://api.deepseek.com/v1',
        onChange: e => patch({ baseUrl: e.target.value })
      })
    ),
    h('div', { style: S.hint }, '填 OpenAI 兼容的 baseURL（到 /v1 即可，自动补 /chat/completions；自建服务填完整地址也行）'),
    h(Field, { label: 'API Key' },
      h('input', {
        style: { ...S.input, flex: 1 },
        type: 'password',
        value: cfg.apiKey,
        placeholder: 'sk-…',
        onChange: e => patch({ apiKey: e.target.value.trim() })
      })
    ),
    h(Field, { label: '模型' },
      h('input', {
        style: { ...S.input, flex: 1 },
        value: cfg.model,
        placeholder: 'deepseek-chat',
        onChange: e => patch({ model: e.target.value.trim() })
      })
    ),
    h('div', { style: S.row },
      h(Field, { label: '温度' },
        h('input', {
          style: { ...S.input, width: 62 },
          value: cfg.temperature,
          onChange: e => patch({ temperature: e.target.value })
        })
      ),
      h(Field, { label: '最大 tokens' },
        h('input', {
          style: { ...S.input, width: 82 },
          value: cfg.maxTokens,
          onChange: e => patch({ maxTokens: e.target.value })
        })
      ),
      h('button', { style: S.btn, disabled: testing, onClick: runTest }, testing ? '测试中…' : '测试连接'),
      test.msg && h('span', { style: test.state === 'ok' ? S.ok : S.error }, test.msg)
    ),
    h('div', { style: S.hint }, 'Key 只保存在本机 localStorage（xnote:plugin:ai-writer:cfg），不会上传到任何地方；请求直连你填的接口。')
  )
}

/* ---------------- 组件：AI 助手主面板 ---------------- */
function AiPanel(props) {
  const ctx = props.ctx
  const { useState, useEffect, useMemo, useRef } = window.XNoteReact
  const preset = props.preset || {}

  // 面板内的接口配置：本地 state 立即可见，同时持久化到插件设置
  const cfgRef = useRef(props.cfg)
  const [cfg, setCfg] = useState(props.cfg)
  const patch = (p) => {
    const next = { ...cfgRef.current, ...p }
    cfgRef.current = next
    setCfg(next)
    props.patch(next)
  }

  const [task, setTask] = useState(preset.task || 'polish')
  const [scope, setScope] = useState(() => preset.scope || (ctx.editor.getSelection().text.trim() ? 'selection' : 'doc'))
  const [sel, setSel] = useState(() => ctx.editor.getSelection())
  const [docLen, setDocLen] = useState(() => ctx.editor.getContent().length)
  const [tone, setTone] = useState(cfg.tone || DEFAULTS.tone)
  const [lang, setLang] = useState(cfg.lang || DEFAULTS.lang)
  const [style, setStyle] = useState(cfg.summaryStyle || DEFAULTS.summaryStyle)
  const [custom, setCustom] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [result, setResult] = useState('')
  const [confirmDoc, setConfirmDoc] = useState(false)
  const [showCfg, setShowCfg] = useState(!String(cfg.apiKey || '').trim())

  // 生成任务序号：点「取消」后迟到的响应直接丢弃
  const runRef = useRef(0)

  const refreshSel = () => {
    setSel(ctx.editor.getSelection())
    setDocLen(ctx.editor.getContent().length)
  }

  // 正文变化时同步字数（应用结果后字数也要跟着变）
  useEffect(() => ctx.editor.onChange(c => setDocLen(c.length)), [])

  useEffect(() => {
    if (!confirmDoc) return
    const t = setTimeout(() => setConfirmDoc(false), 4000)
    return () => clearTimeout(t)
  }, [confirmDoc])

  const meta = useMemo(() => (task === 'meta' ? parseMeta(result) : null), [task, result])
  const current = TASKS.find(t => t.id === task) || TASKS[0]
  const hasNote = !!ctx.editor.active()

  const generate = async () => {
    setErr('')
    const cfgNow = cfgRef.current
    if (!String(cfgNow.apiKey || '').trim()) {
      setErr('还没配置 API Key：展开上方「接口设置」填写（Key 只存本机）')
      setShowCfg(true)
      return
    }
    let text = ''
    if (scope === 'doc') {
      text = ctx.editor.getContent()
      if (!text.trim()) { setErr('当前笔记是空的，写点内容再试'); return }
      if (text.length > MAX_INPUT) text = text.slice(0, MAX_INPUT) + '\n\n…（后文过长已省略）'
    } else {
      const now = ctx.editor.getSelection()
      if (!now.text.trim()) { setErr('没有选中内容：请先在编辑器里选中一段文字，或把范围切到「全文」'); return }
      text = now.text
      setSel(now)
    }
    if (task === 'custom' && !custom.trim()) { setErr('「自定义」需要先写一句指令，例如：改写成小红书风格'); return }

    const run = ++runRef.current
    setBusy(true)
    setResult('')
    try {
      const messages = buildMessages(task, cfgNow, text, { tone, lang, style, custom })
      const out = await callModel(ctx, cfgNow, messages)
      if (runRef.current !== run) return
      setResult(out)
      if (task === 'meta' && !parseMeta(out)) setErr('模型这次没返回标准 JSON，可以手改下方结果后再应用（格式：{"title":"…","tags":["…"]}）')
    } catch (e) {
      if (runRef.current === run) setErr(String(e).replace(/^Error:\s*/, ''))
    } finally {
      if (runRef.current === run) setBusy(false)
    }
  }

  const cancel = () => {
    runRef.current++
    setBusy(false)
    setErr('已取消（请求可能仍在后台完成，结果不会写回）')
  }

  /* ---- 应用结果 ---- */
  const text4apply = () => result.trim()

  const doReplaceSel = () => {
    const v = text4apply()
    if (!v) return
    const s = ctx.editor.getSelection()
    if (!s.text.trim()) { ctx.ui.showToast('当前没有选区，已改为插入到光标处', 'info'); ctx.editor.insertText(v) }
    else ctx.editor.replaceSelection(v)
    ctx.ui.showToast('已写回编辑器（Ctrl+Z 可撤销）', 'success')
  }

  const doInsert = () => {
    const v = text4apply()
    if (!v) return
    ctx.editor.insertText(v)
    ctx.ui.showToast('已插入到光标处（Ctrl+Z 可撤销）', 'success')
  }

  const doReplaceDoc = () => {
    const v = text4apply()
    if (!v) return
    if (!confirmDoc) { setConfirmDoc(true); return }
    setConfirmDoc(false)
    ctx.editor.setContent(v)
    ctx.ui.showToast('已替换整篇内容（Ctrl+Z 可撤销）', 'success')
  }

  const doCopy = async () => {
    const v = result.trim()
    if (!v) return
    try {
      await navigator.clipboard.writeText(v)
      ctx.ui.showToast('结果已复制', 'success')
    } catch {
      ctx.ui.showToast('复制失败，请手动选中结果文本', 'error')
    }
  }

  const doApplyTitle = () => {
    if (!meta || !meta.title) return
    ctx.ui.showToast(applyTitle(ctx, meta.title), 'success')
  }

  const doApplyTags = () => {
    if (!meta || !meta.tags.length) return
    ctx.ui.showToast(applyTags(ctx, meta.tags), 'success')
  }

  /* ---- 渲染 ---- */
  return h('div', { style: S.wrap },
    // 接口设置（可折叠）
    h('div', { style: { ...S.row, justifyContent: 'space-between' } },
      h('button', { style: S.link, onClick: () => setShowCfg(v => !v) },
        (showCfg ? '▾ ' : '▸ ') + '接口设置 · ' + (cfg.model || '未填模型') + ' @ ' + previewHost(cfg.baseUrl)),
      !String(cfg.apiKey || '').trim() && h('span', { style: S.warn }, '⚠ 还没填 API Key')
    ),
    showCfg && h(ConfigSection, { ctx, cfg, patch }),

    // 任务切换
    h('div', { style: S.tabs }, TASKS.map(t => h('button', {
      key: t.id,
      style: task === t.id ? S.tabActive : S.tab,
      title: t.desc,
      onClick: () => { setTask(t.id); setErr('') }
    }, t.label))),
    h('div', { style: S.desc }, current.desc),

    // 范围
    h('div', { style: S.row },
      h('span', { style: S.muted }, '范围'),
      h('button', { style: scope === 'selection' ? S.chipActive : S.chip, onClick: () => setScope('selection') },
        '选中内容' + (sel.text ? '（' + sel.text.length + ' 字）' : '（未选中）')),
      h('button', { style: scope === 'doc' ? S.chipActive : S.chip, onClick: () => setScope('doc') },
        '全文（' + docLen + ' 字）'),
      h('button', { style: S.mini, title: '重新读取编辑器里的选区', onClick: refreshSel }, '↻')
    ),

    // 任务参数
    task === 'polish' && h(SelectRow, { label: '语气', options: TONES, value: tone, onChange: setTone }),
    task === 'translate' && h(SelectRow, { label: '目标语言', options: LANGS, value: lang, onChange: setLang }),
    task === 'summary' && h(SelectRow, { label: '摘要形式', options: SUMMARY_STYLES, value: style, onChange: setStyle }),
    task === 'custom' && h('textarea', {
      style: S.prompt,
      value: custom,
      placeholder: '写清怎么处理这段文字，例如：改写成小红书风格，加 3 个 emoji 小标题；或：把这段改成更口语的技术博客语气',
      onChange: e => setCustom(e.target.value)
    }),

    // 生成
    h('div', { style: S.row },
      h('button', { style: S.primary, disabled: busy || !hasNote, onClick: generate },
        busy ? '生成中…' : (result ? '重新生成' : '生成')),
      busy && h('button', { style: S.btn, onClick: cancel }, '取消'),
      !hasNote && h('span', { style: S.warn }, '请先打开一篇笔记')
    ),

    err && h('div', { style: S.error }, err),

    // 结果
    (result || busy) && h('div', null,
      h('div', { style: S.resultHead },
        h('span', { style: S.muted }, '结果（可直接修改后再应用）'),
        task === 'meta' && meta && h('span', { style: S.ok },
          '解析到：' + (meta.title || '（无标题）') + ' ｜ ' + meta.tags.map(t => '#' + t).join(' '))
      ),
      h('textarea', {
        style: S.result,
        value: result,
        placeholder: busy ? '正在生成…' : '',
        onChange: e => setResult(e.target.value)
      }),
      task === 'meta'
        ? h('div', { style: S.row },
          h('button', { style: S.btn, disabled: !meta || !meta.title, onClick: doApplyTitle }, '应用标题'),
          h('button', { style: S.btn, disabled: !meta || !meta.tags.length, onClick: doApplyTags }, '应用标签'),
          h('button', { style: S.btn, disabled: !text4apply(), onClick: doCopy }, '复制')
        )
        : h('div', { style: S.row },
          h('button', { style: S.btn, disabled: !text4apply(), onClick: doReplaceSel }, '替换选区'),
          h('button', { style: S.btn, disabled: !text4apply(), onClick: doInsert }, '插入到光标'),
          h('button', {
            style: confirmDoc ? S.danger : S.btn,
            disabled: !text4apply(),
            onClick: doReplaceDoc
          }, confirmDoc ? '确认替换整篇？' : '替换全文'),
          h('button', { style: S.btn, disabled: !text4apply(), onClick: doCopy }, '复制')
        )
    ),

    // 底部
    h('div', { style: { ...S.row, marginTop: 12, marginBottom: 0, justifyContent: 'flex-end' } },
      h('span', { style: S.muted }, 'AI 结果仅供参考，写回后可用 Ctrl+Z 撤销'),
      h('button', { style: S.btn, onClick: () => ctx.ui.closeDialog() }, '关闭')
    )
  )
}

/* ---------------- 插件入口 ---------------- */
export default {
  manifest: {
    id: 'ai-writer',
    name: 'AI 写作助手',
    version: '1.0.0',
    description: PRESETS.map(p => p.name).join(' / ') + ' 等 OpenAI 兼容接口'
  },

  activate(ctx) {
    const getCfg = () => ({ ...DEFAULTS, ...ctx.settings.get('cfg', {}) })
    const patchCfg = (patch) => ctx.settings.set('cfg', { ...getCfg(), ...patch })

    /** 打开面板；preset 可指定初始任务与范围（'selection' | 'doc'） */
    const openPanel = (preset) => {
      if (!ctx.editor.active()) { ctx.ui.showToast('请先打开一篇笔记', 'info'); return }
      const cfg = getCfg()
      ctx.ui.showDialog({
        id: 'ai-writer',
        title: 'AI 写作助手',
        subtitle: '润色 · 翻译 · 摘要 · 标题标签',
        width: 760,
        render: () => h(AiPanel, { ctx, cfg, patch: patchCfg, preset })
      })
    }

    ctx.ui.registerCommand({
      id: 'ai-writer.open',
      title: 'AI 写作助手…',
      run: () => openPanel()
    })
    // 需要选区的任务：没有选区就提示，不做「默默处理全文」这种危险默认
    const needSelection = (task) => {
      if (!ctx.editor.active()) { ctx.ui.showToast('请先打开一篇笔记', 'info'); return }
      if (!ctx.editor.getSelection().text.trim()) {
        ctx.ui.showToast('先用鼠标选中要处理的文字（也可以在面板里改为处理全文）', 'info')
        return
      }
      openPanel({ task, scope: 'selection' })
    }

    ctx.ui.registerCommand({ id: 'ai-writer.polish', title: 'AI：润色选中内容', run: () => needSelection('polish') })
    ctx.ui.registerCommand({ id: 'ai-writer.translate', title: 'AI：翻译选中内容', run: () => needSelection('translate') })
    ctx.ui.registerCommand({ id: 'ai-writer.summary', title: 'AI：为全文生成摘要', run: () => openPanel({ task: 'summary', scope: 'doc' }) })
    ctx.ui.registerCommand({ id: 'ai-writer.meta', title: 'AI：生成标题与标签', run: () => openPanel({ task: 'meta', scope: 'doc' }) })

    ctx.ui.registerSettingsPanel({
      id: 'aiWriterSettings',
      title: 'AI 写作助手（接口配置）',
      render: () => {
        const cfg = getCfg()
        return h('div', null,
          h(ConfigSection, { ctx, cfg, patch: patchCfg }),
          h('div', { style: S.row },
            h('button', { style: S.primary, onClick: () => openPanel() }, '打开 AI 助手'),
            h('span', { style: S.muted }, '菜单「插件 → AI 写作助手…」也能打开')
          )
        )
      }
    })

    ctx.log('AI 写作助手已加载，' + PRESETS.length + ' 个预设')
  }
}
