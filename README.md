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

## 收录插件

| 插件 | 版本 | 说明 |
| ---- | ---- | ---- |
| [hello-world](plugins/hello-world.zip) | 1.0.0 | 开发样板：命令 + 设置面板 + storage 读写 + 配置持久化的最小完整用法 |
| [github-gist](plugins/github-gist.zip) | 1.0.0 | 笔记库一键备份到 GitHub Gist 并随时恢复（保留目录结构，远端删除可同步） |
| [gitee-gist](plugins/gitee-gist.zip) | 1.0.0 | 笔记库一键备份到 Gitee 代码片段（扁平化存储 + 清单还原目录结构） |

## 目录结构

```
X-Note-Plugins/
├── index.json        # 插件索引（数组或 { plugins: [...] }，每项含 id/name/version/zip）
├── README.md
└── plugins/          # .zip 插件包（plugin.json + main.js 位于包根）
    ├── hello-world.zip
    ├── github-gist.zip
    └── gitee-gist.zip
```

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

1. 按 [插件开发指南](https://github.com/xfm0797/X-Note/blob/main/xnote-external-plugins/%E6%8F%92%E4%BB%B6%E5%BC%80%E5%8F%91%E6%8C%87%E5%8D%97.md) 开发插件（`plugin.json` + `main.js`，ESM default 导出）
2. 把插件目录打 zip（`plugin.json` 置于包根）放入 `plugins/`
3. 在 `index.json` 增加（或更新）条目，提交推送即可——应用内刷新列表立即可见

## 安全提示

外部插件以应用的完整权限执行代码。请审阅插件源码（本仓库内 `plugins/*.zip` 均可解压审阅）后再安装信任来源的插件。

—— 开发者：[XFM](https://www.lovou.pw) · [@xfm0797](https://github.com/xfm0797)
