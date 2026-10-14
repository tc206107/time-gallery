#!/usr/bin/env python3
"""从 dist/ 重建离线目录包 demo/（file:// 双击即玩，图片仍为相对文件）。

做三件事：
  1. 把 dist/index.html 复制到 demo/index.html，并把带哈希的资源名改成固定名
     （assets/index-<hash>.js -> assets/index.js，assets/index-<hash>.css -> assets/style.css）；
  2. 复制这两份资源与 favicon 到 demo/；assets/art 与 assets/thumb 若已存在则不动
     （图片由 optimize_assets.py 单独维护，重建它们很慢且本步骤不改变图片）；
  3. 调用 inline_offline.py 把 JS/CSS 内联进 index.html（file:// 下不能有 type="module"
     与外部样式表），并做自检。

为什么需要这个脚本：inline_offline.py 只做第 3 步的「内联已有 demo/」。第 1、2 步
（dist -> demo 的复制与改名）此前是手工命令，没有落盘脚本，结果这次改动源码后
demo/ 仍指向上一轮的旧 JS —— 交付物看起来更新了、其实是旧的。

用法：
    python tools/build_offline_dir.py
"""
from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, "dist")
DEMO = os.path.join(ROOT, "demo")


def main() -> int:
    dist_index = os.path.join(DIST, "index.html")
    if not os.path.exists(dist_index):
        print(f"missing {dist_index}; run `vite build` first", file=sys.stderr)
        return 1

    with open(dist_index, encoding="utf-8") as handle:
        html = handle.read()

    js_refs = re.findall(r'assets/index-[A-Za-z0-9_-]+\.js', html)
    css_refs = re.findall(r'assets/index-[A-Za-z0-9_-]+\.css', html)
    if len(js_refs) != 1 or len(css_refs) != 1:
        print(f"unexpected asset refs: js={js_refs} css={css_refs}", file=sys.stderr)
        return 1

    os.makedirs(os.path.join(DEMO, "assets"), exist_ok=True)
    shutil.copy2(os.path.join(DIST, js_refs[0]), os.path.join(DEMO, "assets", "index.js"))
    shutil.copy2(os.path.join(DIST, css_refs[0]), os.path.join(DEMO, "assets", "style.css"))
    favicon_dist = os.path.join(DIST, "favicon.svg")
    if os.path.exists(favicon_dist):
        shutil.copy2(favicon_dist, os.path.join(DEMO, "favicon.svg"))

    # 图片目录：缺失时从 dist 复制，已存在则保留（由 optimize_assets.py 维护）
    for name in ("art", "thumb"):
        src = os.path.join(DIST, "assets", name)
        dst = os.path.join(DEMO, "assets", name)
        if not os.path.exists(dst) and os.path.exists(src):
            shutil.copytree(src, dst)
            print(f"copied assets/{name}")
        elif os.path.exists(dst):
            n_dst = len(os.listdir(dst))
            n_src = len(os.listdir(src)) if os.path.exists(src) else 0
            print(f"assets/{name}: kept existing ({n_dst} files; dist has {n_src})")

    html = html.replace(js_refs[0], "assets/index.js").replace(css_refs[0], "assets/style.css")
    with open(os.path.join(DEMO, "index.html"), "w", encoding="utf-8", newline="\n") as handle:
        handle.write(html)
    print(f"demo/index.html refreshed from dist ({js_refs[0]} -> assets/index.js)")

    # 第 3 步：内联（复用既有脚本，保持单一实现）
    result = subprocess.run(
        [sys.executable, os.path.join(ROOT, "tools", "inline_offline.py")],
        cwd=ROOT,
    )
    if result.returncode != 0:
        print("inline_offline.py failed", file=sys.stderr)
        return result.returncode
    print("offline dir rebuilt: demo/")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
