// 插件自测：用模拟宿主 + 迷你 React 驱动真实面板逻辑，验证三类插件的读写正确性
// 运行：node test/plugin-test.mjs
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, '..', 'src')

/* ---------------- 迷你 React：支持 hooks 与元素树 ---------------- */
let hookStore = []
let hookIndex = 0

const R = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity).filter(c => c != null && c !== false) }),
  useState(init) {
    const i = hookIndex++
    if (!(i in hookStore)) hookStore[i] = typeof init === 'function' ? init() : init
    return [hookStore[i], v => { hookStore[i] = typeof v === 'function' ? v(hookStore[i]) : v }]
  },
  useMemo(fn) { hookIndex++; return fn() },
  useEffect() { hookIndex++ },
  useRef(v) { hookIndex++; return { current: v } }
}

globalThis.window = { XNoteReact: R }

/* ---------------- 模拟宿主 ---------------- */
function makeHost(files) {
  const store = new Map(Object.entries(files))
  const settings = new Map()
  const commands = []
  const panels = []
  const toasts = []
  const ctx = {
    manifest: {},
    storage: {
      async loadAll() {
        const o = {}
        for (const [p, c] of store) o[p] = { content: c, updated: 1 }
        return o
      },
      async readFile(p) { return store.has(p) ? store.get(p) : null },
      async writeFile(p, c) { store.set(p, c) },
      async deletePath(p) { store.delete(p) },
      async getModified() { return 1 },
      async reloadLibrary() { return this.loadAll() }
    },
    settings: {
      get(k, d) { return settings.has(k) ? settings.get(k) : d },
      set(k, v) { settings.set(k, v) }
    },
    ui: {
      registerCommand(c) { commands.push(c) },
      registerSettingsPanel(p) { panels.push(p) },
      showToast(t, kind) { toasts.push({ t, kind }) }
    },
    log() {}
  }
  return { ctx, store, settings, commands, panels, toasts }
}

/* ---------------- 渲染与查找工具 ---------------- */
function expand(node) {
  if (!node || typeof node !== 'object') return node
  if (typeof node.type === 'function') return expand(node.type(node.props || {}))
  return { ...node, children: (node.children || []).map(expand) }
}
function renderPanel(fn) {
  hookIndex = 0
  return expand(fn())
}
/** 切换插件前清空 hooks，模拟全新的组件实例 */
function resetHooks() { hookStore = [] }
function walk(node, out = []) {
  if (!node || typeof node !== 'object') return out
  out.push(node)
  for (const c of node.children || []) walk(c, out)
  return out
}
function textOf(node) {
  if (node == null) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (typeof node !== 'object') return ''
  return (node.children || []).map(textOf).join('')
}
function findButton(tree, label) {
  return walk(tree).find(n => n.type === 'button' && textOf(n).includes(label))
}
function findInput(tree, placeholderPart) {
  return walk(tree).find(n => n.type === 'input' && (n.props.placeholder || '').includes(placeholderPart))
}
function findCheckbox(tree) {
  return walk(tree).find(n => n.type === 'input' && n.props.type === 'checkbox')
}

async function waitFor(fn, ms = 3000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    const v = await fn()
    if (v) return v
    await new Promise(r => setTimeout(r, 20))
  }
  throw new Error('等待超时')
}

let pass = 0
let fail = 0
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ✓', name) }
  else { fail++; console.log('  ✗', name, extra !== undefined ? '→ ' + JSON.stringify(extra) : '') }
}

/* ================= 用例 1：全库待办看板 ================= */
async function testTodo() {
  console.log('\n[1] 全库待办看板')
  const lib = {
    '工作/周报.md': '# 周报\n\n- [ ] 写周报 #工作 @due(2026-01-01)\n- [x] 发邮件\n- [ ] 准备会议 #工作\n',
    '学习/读书.md': '- [ ] 读《Rust 程序设计》#读书\n\n```\n- [ ] 这是代码块里的假任务\n```\n',
    '无任务.md': '# 空\n没有任务\n'
  }
  resetHooks()
  const host = makeHost(lib)
  const mod = await import('file://' + join(SRC, 'todo-dashboard', 'main.js'))
  await mod.default.activate(host.ctx)

  ok(host.commands.length === 1, '注册 1 个命令', host.commands.map(c => c.title))
  ok(host.panels.length === 1 && host.panels[0].id === 'todoDashboard', '注册看板面板')

  // 命令：统计
  await host.commands[0].run()
  const msg = host.toasts.at(-1).t
  ok(msg.includes('未完成 3 项') && msg.includes('已完成 1 项'), '统计：3 未完成 / 1 已完成（跳过代码块假任务）', msg)

  // 面板：刷新 → 勾选第一个任务
  let tree = renderPanel(() => host.panels[0].render())
  const btn = findButton(tree, '刷新')
  ok(!!btn, '面板渲染出「刷新」按钮')
  btn.props.onClick()
  tree = await waitFor(() => {
    const t = renderPanel(() => host.panels[0].render())
    return walk(t).some(n => n.type === 'input' && n.props.type === 'checkbox') ? t : null
  })
  const boxes = walk(tree).filter(n => n.type === 'input' && n.props.type === 'checkbox')
  ok(boxes.length === 3, '列出 3 个未完成任务', boxes.length)

  // 按顺序：周报.md 的「写周报」在第一位（组内按行号）
  await boxes[0].props.onChange()
  const weekly = host.store.get('工作/周报.md')
  ok(weekly.includes('- [x] 写周报'), '勾选后回写原文件为 [x]', weekly.split('\n')[2])
  ok(host.store.get('学习/读书.md').includes('- [ ] 读《Rust'), '未勾选的笔记不受影响')

  const left = await waitFor(() => {
    const t = renderPanel(() => host.panels[0].render())
    const boxes2 = walk(t).filter(n => n.type === 'input' && n.props.type === 'checkbox')
    return boxes2.length === 2 ? boxes2 : null
  })
  ok(left.length === 2, '本地状态即时更新为 2 项', left.length)

  // 导出清单
  const exp = findButton(tree, '导出清单')
  await exp.props.onClick()
  const key = [...host.store.keys()].find(k => k.startsWith('待办汇总-'))
  ok(!!key && host.store.get(key).includes('- [ ] 准备会议'), '导出未完成清单', key)
}

/* ================= 用例 2：全库批量查找替换 ================= */
async function testBulk() {
  console.log('\n[2] 全库批量查找替换')
  const lib = {
    'a.md': 'Hello World\nhello world\nHELLO\n',
    'b.md': 'World only\n',
    'c.md': '无关内容\n'
  }
  resetHooks()
  const host = makeHost(lib)
  const mod = await import('file://' + join(SRC, 'bulk-replace', 'main.js'))
  await mod.default.activate(host.ctx)

  ok(host.panels.length === 1, '注册替换面板')
  ok(host.commands.some(c => c.id === 'bulk-replace.undo'), '注册撤销命令')

  let tree = renderPanel(() => host.panels[0].render())
  const findIn = findInput(tree, '查找')
  const replIn = findInput(tree, '替换为')
  ok(!!findIn && !!replIn, '面板渲染出查找/替换输入框')

  // 字面替换：World → 世界（不区分大小写 → 命中 3 处）
  findIn.props.onChange({ target: { value: 'World' } })
  replIn.props.onChange({ target: { value: '世界' } })
  tree = renderPanel(() => host.panels[0].render())
  findButton(tree, '预览').props.onClick()
  tree = await waitFor(() => {
    const t = renderPanel(() => host.panels[0].render())
    return textOf(t).includes('处命中') ? t : null
  })
  ok(textOf(tree).includes('共 3 处命中'), '预览统计 3 处命中', textOf(tree).slice(0, 120))

  // 二次确认后执行
  findButton(tree, '全部替换').props.onClick()   // 第一次：进入待确认
  tree = renderPanel(() => host.panels[0].render())
  const confirm = findButton(tree, '确认替换')
  ok(!!confirm, '首次点击进入确认态', textOf(findButton(tree, '全部替换') || {}))
  confirm.props.onClick()
  await waitFor(() => host.store.get('a.md').includes('世界'))
  ok(host.store.get('a.md') === 'Hello 世界\nhello 世界\nHELLO\n', 'a.md 大小写不敏感全部替换', host.store.get('a.md'))
  ok(host.store.get('b.md') === '世界 only\n', 'b.md 正确替换', host.store.get('b.md'))
  ok(host.store.get('c.md') === '无关内容\n', '无命中文件不动')

  const backup = host.settings.get('lastBackup', null)
  ok(backup && backup.entries.length === 2, '自动备份 2 个文件', backup && backup.entries.map(e => e.path))

  // 撤销
  await host.commands.find(c => c.id === 'bulk-replace.undo').run()
  ok(host.store.get('a.md') === lib['a.md'] && host.store.get('b.md') === lib['b.md'], '撤销后完全恢复原内容')

  // 正则 + 分组
  host.store.set('a.md', 'v1.2.3\nv2.0.0\n')
  tree = renderPanel(() => host.panels[0].render())
  const regBtn = findButton(tree, '正则')
  regBtn.props.onClick()
  tree = renderPanel(() => host.panels[0].render())
  findInput(tree, '查找').props.onChange({ target: { value: 'v(\\d+)\\.' } })
  tree = renderPanel(() => host.panels[0].render())
  findInput(tree, '替换为').props.onChange({ target: { value: 'ver$1-' } })
  tree = renderPanel(() => host.panels[0].render())
  findButton(tree, '预览').props.onClick()
  tree = await waitFor(() => {
    const t = renderPanel(() => host.panels[0].render())
    return textOf(t).includes('处命中') ? t : null
  })
  findButton(tree, '全部替换').props.onClick()
  tree = renderPanel(() => host.panels[0].render())
  findButton(tree, '确认替换').props.onClick()
  await waitFor(() => host.store.get('a.md').includes('ver1-'))
  ok(host.store.get('a.md') === 'ver1-2.3\nver2-0.0\n', '正则分组 $1 正常展开', host.store.get('a.md'))
}

/* ================= 用例 3：链接健康检查 ================= */
async function testLinks() {
  console.log('\n[3] 链接健康检查')
  const lib = {
    '首页.md': '# 首页\n[[项目计划]] [[不存在的笔记]]\n[[读书笔记|读书]]\n',
    '项目计划.md': '见 [[首页]]\n',
    '读书笔记.md': '# 读书\n#读书 #学习\n',
    '孤儿.md': '# 没人引用我\n#学习\n',
    '重名A/笔记.md': 'A\n',
    '重名B/笔记.md': 'B\n',
    '代码.md': '```\n[[代码块里的假链接]]\n```\n'
  }
  resetHooks()
  const host = makeHost(lib)
  const mod = await import('file://' + join(SRC, 'link-check', 'main.js'))
  await mod.default.activate(host.ctx)

  ok(host.panels.length === 1 && host.panels[0].id === 'linkCheck', '注册检查面板')
  await host.commands[0].run()
  const toast = host.toasts.at(-1).t
  ok(toast.includes('断链 1'), '识别 1 条断链（代码块内链接被忽略）', toast)
  ok(toast.includes('孤儿'), '输出孤儿数', toast)

  // 面板详情
  let tree = renderPanel(() => host.panels[0].render())
  findButton(tree, '重新扫描').props.onClick()
  tree = await waitFor(() => {
    const t = renderPanel(() => host.panels[0].render())
    return textOf(t).includes('断链') && textOf(t).includes('不存在的笔记') ? t : null
  })
  const text = textOf(tree)
  ok(text.includes('不存在的笔记'), '断链目标展示')
  ok(text.includes('来自 首页'), '显示引用来源')
  ok(text.includes('孤儿'), '显示孤儿分区')
  ok(text.includes('笔记') && text.includes('重名'), '显示重名分区标题')
  ok(!text.includes('代码块里的假链接'), '代码围栏内链接未误报')

  // 导出报告
  findButton(tree, '导出报告').props.onClick()
  await waitFor(() => [...host.store.keys()].some(k => k.startsWith('链接检查报告-')))
  const rk = [...host.store.keys()].find(k => k.startsWith('链接检查报告-'))
  const report = host.store.get(rk)
  ok(report.includes('断链（1）') && report.includes('孤儿笔记'), '导出 Markdown 报告', rk)
  ok(report.includes('重名'), '报告含重名小节')
}

/* ================= 运行 ================= */
try {
  await testTodo()
  await testBulk()
  await testLinks()
} catch (e) {
  fail++
  console.error('\n执行异常：', e)
}
console.log('\n结果：通过 ' + pass + ' 项，失败 ' + fail + ' 项')
process.exit(fail ? 1 : 0)
