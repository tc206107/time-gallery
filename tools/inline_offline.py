#!/usr/bin/env python3
"""把 demo/ 目录内联为可双击运行的离线包。

做三件事：
  1. 将 demo/assets/index.js 与 style.css 的内容内联进 index.html，
     消除 <script type="module"> 与外部样式表在 file:// 下的 CORS 限制。
  2. 校验 index.html 内不再有 type="module" 与外部 js/css 引用。
  3. 校验图片资源仍以相对路径存在（<img> 与 TextureLoader 在 file:// 下可读）。

用法：
    python tools/inline_offline.py
"""
from __future__ import annotations

import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEMO = os.path.join(ROOT, "demo")
INDEX = os.path.join(DEMO, "index.html")


def main() -> int:
    if not os.path.exists(INDEX):
        print(f"missing {INDEX}; run the offline build first", file=sys.stderr)
        return 1

    with open(INDEX, encoding="utf-8") as handle:
        html = handle.read()

    # 收集需要内联的外部资源
    script_refs = re.findall(r'<script[^>]*src="([^"]+)"[^>]*></script>', html)
    style_refs = re.findall(r'<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>', html)

    inlined_js = 0
    pending_scripts: list[str] = []
    for ref in script_refs:
        path = os.path.join(DEMO, ref.lstrip("./"))
        if not os.path.exists(path):
            print(f"referenced script not found: {ref}", file=sys.stderr)
            return 1
        with open(path, encoding="utf-8") as handle:
            code = handle.read()
        # 经典脚本（无 type="module"）才能在 file:// 下执行。
        # 用 lambda 作为替换值：re.sub 会把替换串里的反斜杠当转义解释，
        # 而压缩后的 JS 里含有 \w \d 等序列，直接传字符串会抛 PatternError。
        replacement = "<script>\n" + code.replace("</script>", "<\\/script>") + "\n</script>"
        # 先把 script 标签整段删掉，稍后统一插到 </body> 之前。
        # 原因：<script type="module"> 天然是 defer 的，而内联的经典脚本会立即执行；
        # 若留在 <head> 里，脚本运行到 document.querySelector('#app') 时 <body> 还没解析，
        # 会拿到 null 并在 appendChild 上抛错。
        html = re.sub(
            r'<script[^>]*src="' + re.escape(ref) + r'"[^>]*></script>',
            lambda _match: "",
            html,
        )
        pending_scripts.append(replacement)
        inlined_js += 1

    inlined_css = 0
    for ref in style_refs:
        path = os.path.join(DEMO, ref.lstrip("./"))
        if not os.path.exists(path):
            print(f"referenced stylesheet not found: {ref}", file=sys.stderr)
            return 1
        with open(path, encoding="utf-8") as handle:
            css = handle.read()
        html = re.sub(
            r'<link[^>]*rel="stylesheet"[^>]*href="' + re.escape(ref) + r'"[^>]*>',
            lambda _match, _css=css: "<style>\n" + _css + "\n</style>",
            html,
        )
        inlined_css += 1

    # 把内联脚本放到 </body> 之前，等价于 module 的 defer 语义
    if pending_scripts:
        if "</body>" not in html:
            print("cannot place scripts: no </body> in index.html", file=sys.stderr)
            return 1
        html = html.replace("</body>", "\n".join(pending_scripts) + "\n</body>")

    with open(INDEX, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(html)

    # 内联后的自检
    problems = []
    if 'type="module"' in html:
        problems.append('index.html still contains type="module"')
    if re.search(r'<script[^>]*src=', html):
        problems.append("index.html still references an external script")
    if re.search(r'<link[^>]*rel="stylesheet"', html):
        problems.append("index.html still references an external stylesheet")

    art_dir = os.path.join(DEMO, "assets", "art")
    thumb_dir = os.path.join(DEMO, "assets", "thumb")
    art_n = len([f for f in os.listdir(art_dir)]) if os.path.isdir(art_dir) else 0
    thumb_n = len([f for f in os.listdir(thumb_dir)]) if os.path.isdir(thumb_dir) else 0

    print(f"inlined scripts: {inlined_js}")
    print(f"inlined stylesheets: {inlined_css}")
    print(f"assets/art: {art_n} files")
    print(f"assets/thumb: {thumb_n} files")
    if problems:
        for problem in problems:
            print(f"FAIL {problem}", file=sys.stderr)
        return 1
    if art_n == 0:
        print("FAIL no artwork files copied into demo/", file=sys.stderr)
        return 1
    print("OK index.html is self-contained and file:// safe")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
