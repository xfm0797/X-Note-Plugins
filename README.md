# X-Note-Plugins —— X-Note 官方插件中心

[X-Note](https://github.com/xfm0797/X-Note) 的官方插件源：一个静态仓库承载「插件索引 + 插件包」，应用内 **设置 → 插件中心** 直接拉取本仓库的 `index.json` 即可浏览与一键安装。

## 索引地址（应用内填这个）

```
https://raw.githubusercontent.com/xfm0797/X-Note-Plugins/main/index.json
```

国内网络不稳时可改用 jsDelivr 镜像（应用默认源即为 jsDelivr）：

```
https://cdn.jsdelivr.net/gh/xfm0797/X-Note-Plugins@main/index.json
```

Gitee 镜像（本仓库同步托管于 Gitee，直连可用）：

```
https://gitee.com/xfm0797/x-note-plugins/raw/main/index.json
```

以上三个地址内容完全一致，任选其一填入 **设置 → 插件中心** 即可。

## 收录插件

| 插件 | 版本 | 说明 |
| ---- | ---- | ---- |
| [ai-writer](plugins/ai-writer.zip) | 1.0.0 | **AI 写作助手**：润色 / 翻译 / 摘要 / 生成标题标签，结果可改后写回选区或全文。自填 OpenAI 兼容 baseURL + Key（DeepSeek、Kimi、通义千问、智谱、OpenAI 及自建服务均可），支持测试连接。需 X-Note ≥ 0.3.0 |
| [todo-dashboard](plugins/todo-dashboard.zip) | 1.0.0 | **全库待办看板**：聚合全库 `- [ ]` 任务，勾选即回写原文件；支持 `#标签` / `@due(2026-12-31)` 筛选、完成率统计、清单导出 |
| [bulk-replace](plugins/bulk-replace.zip) | 1.0.0 | **全库批量查找替换**：正则/字面替换，先预览命中文件与行号再二次确认；执行前自动备份（`.xnote-bulk-backup/`），支持一键撤销 |
| [link-check](plugins/link-check.zip) | 1.0.0 | **链接健康检查**：扫描 `[[双向链接]]`，报告断链（附相似标题建议）、孤儿笔记、重名笔记、标签分布，可导出 Markdown 报告 |
| [hello-world](plugins/hello-world.zip) | 1.0.0 | 开发样板：命令 + 设置面板 + storage 读写 + 配置持久化的最小完整用法 |
| [github-gist](plugins/github-gist.zip) | 1.0.0 | 笔记库一键备份到 GitHub Gist 并随时恢复（保留目录结构，远端删除可同步） |
| [gitee-gist](plugins/gitee-gist.zip) | 1.0.0 | 笔记库一键备份到 Gitee 代码片段（扁平化存储 + 清单还原目录结构） |

## 目录结构

```
X-Note-Plugins/
├── index.json        # 插件索引（数组或 { plugins: [...] }，每项含 id/name/version/zip）
├── build.py          # 打包脚本：src/<插件> → plugins/<插件>.zip
├── README.md
├── 插件开发指南.md    # 外部插件开发指南（契约 / API / 调试 / 打包发布）
├── src/              # 插件源码（可读可审阅）
│   ├── ai-writer/
│   ├── todo-dashboard/
│   ├── bulk-replace/
│   └── link-check/
├── test/
│   └── plugin-test.mjs   # 插件自测（模拟宿主 + 迷你 React 驱动真实面板逻辑）
└── plugins/          # .zip 插件包（plugin.json + main.js 位于包根）
    ├── ai-writer.zip
    ├── todo-dashboard.zip
    ├── bulk-replace.zip
    └── link-check.zip
```

## 本地打包与自测

```bash
python build.py                  # 打包 src/ 下全部插件到 plugins/
python build.py todo-dashboard    # 只打包指定插件
node test/plugin-test.mjs         # 跑插件逻辑自测（51 项断言）
```

## 插件能用到的宿主能力

| 能力 | 用途 |
| --- | --- |
| `ctx.storage` | 读全库 / 读写删除文件 / 重载库 |
| `ctx.editor` | 当前笔记与选区：`getContent / setContent / getSelection / replaceSelection / insertText / replaceRange`，`onChange` 订阅正文变化 |
| `ctx.http` | `postJSON / getJSON / request`；桌面端由 Rust 侧发请求，**不受 WebView CORS 限制**（调 AI、WebDAV、图床都靠它） |
| `ctx.ui.registerCommand` | 在应用「插件」菜单加一项 |
| `ctx.ui.registerSettingsPanel` | 在「插件 → 插件设置…」加配置面板（X-Note ≥ 0.4.0；更早版本显示在「插件中心」内） |
| `ctx.ui.showDialog` | 弹出插件自己的窗口（`{ id, title, subtitle?, width?, render }`），`ctx.ui.closeDialog()` 关闭 |
| `ctx.settings` | 插件私有配置（localStorage，按插件 id 隔离） |

`ctx.editor` / `ctx.http` / `ctx.ui.showDialog` 自 **X-Note 0.3.0** 起提供；用到它们的插件请在 `plugin.json` 的 `description` 里注明最低版本要求。

## index.json 条目格式

```json
{
  "id": "hello-world",
  "name": "Hello World 样板",
  "version": "1.0.0",
  "description": "一句话说明",
  "author": "XFM",
  "homepage": "https://github.com/xfm0797/X-Note",
  "zip": "https://cdn.jsdelivr.net/gh/xfm0797/X-Note-Plugins@main/plugins/hello-world.zip"
}
```

`zip` 地址支持任一可直连的下载地址：本仓库 raw / jsDelivr / GitHub Release 资产。

## 发布新插件 / 更新版本

1. 按 [插件开发指南](./插件开发指南.md) 开发插件（`plugin.json` + `main.js`，ESM default 导出）
2. 把插件目录打 zip（`plugin.json` 置于包根）放入 `plugins/`
3. 在 `index.json` 增加（或更新）条目，提交推送即可——应用内刷新列表立即可见

## 安全提示

外部插件以应用的完整权限执行代码。请审阅插件源码（本仓库内 `plugins/*.zip` 均可解压审阅）后再安装信任来源的插件。

—— 开发者：[XFM](https://www.lovou.pw) · [@xfm0797](https://github.com/xfm0797)
