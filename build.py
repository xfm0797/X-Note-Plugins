#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""打包插件：把 src/<插件目录>/ 打成 plugins/<plugin.json 的 id>.zip

用法：
    python build.py            # 打包全部
    python build.py todo-dashboard   # 只打包指定插件
zip 内保持 plugin.json + main.js 于根目录，与插件中心安装逻辑兼容。
"""
import json
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).parent
SRC = ROOT / "src"
OUT = ROOT / "plugins"


def build(name: str) -> str:
    d = SRC / name
    manifest_path = d / "plugin.json"
    if not manifest_path.exists():
        raise SystemExit(f"[跳过] {name}：缺少 plugin.json")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    main = manifest.get("main", "main.js")
    if not (d / main).exists():
        raise SystemExit(f"[跳过] {name}：缺少入口文件 {main}")

    OUT.mkdir(exist_ok=True)
    zip_path = OUT / f"{name}.zip"
    files = sorted(p for p in d.rglob("*") if p.is_file())
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        for p in files:
            z.write(p, p.relative_to(d).as_posix())
    meta = {p.relative_to(d).as_posix(): p.stat().st_size for p in files}
    print(f"[OK] {zip_path.name}  ({len(files)} 文件) {meta}")
    return str(zip_path)


def main():
    targets = sys.argv[1:] or sorted(p.name for p in SRC.iterdir() if p.is_dir())
    for name in targets:
        build(name)


if __name__ == "__main__":
    main()
