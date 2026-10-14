#!/usr/bin/env python3
"""构建「双击即玩」的离线单文件版。

背景（实测结论，决定了本脚本的形态）：
  1. 默认 Vite 产物是 ES module，file:// 下被 CORS 拒绝 → 必须用 IIFE 经典脚本。
  2. 即使改成经典脚本，Three.js 的 TextureLoader 会在 <img> 上设 crossOrigin='anonymous'，
     file:// 下图片被当作跨源，texImage2D 抛 SecurityError（本机实测）。
     普通 <img> 能显示，但 WebGL 贴图拿不到 → 3D 展厅必然是空白画框。
  3. 因此单文件版把图片内联为 data: URI（data: 属允许的源，贴图可用）。
     代价是 base64 膨胀约 33%，所以这里对 demo 用图单独降采样，不动 public/ 的正式资源。

产出：release/时光画廊-离线单文件版.html（自包含，无外部依赖，双击即玩）

用法：
    python tools/build_single_file.py
"""
from __future__ import annotations

import base64
import io
import json
import os
import re
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEMO = os.path.join(ROOT, "demo")
PUBLIC = os.path.join(ROOT, "public")
RELEASE = os.path.join(ROOT, "release")
OUT = os.path.join(RELEASE, "时光画廊-离线单文件版.html")

# demo 用图规格：单文件要控制体积，1280px 在展厅里近看仍清晰
DEMO_MAX_DIM = 1280
DEMO_QUALITY = 82
THUMB_MAX_DIM = 320
THUMB_QUALITY = 80


def jpeg_data_uri(path: str, max_dim: int, quality: int) -> str:
    with Image.open(path) as image:
        rgb = image.convert("RGB")
        width, height = rgb.size
        longest = max(width, height)
        if longest > max_dim:
            scale = max_dim / longest
            rgb = rgb.resize((max(1, round(width * scale)), max(1, round(height * scale))), Image.LANCZOS)
        buffer = io.BytesIO()
        rgb.save(buffer, "JPEG", quality=quality, optimize=True, progressive=True)
    return "data:image/jpeg;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")


def main() -> int:
    manifest_path = os.path.join(ROOT, "manifest.json")
    with open(manifest_path, encoding="utf-8") as handle:
        manifest = json.load(handle)

    bundle_path = os.path.join(DEMO, "assets", "index.js")
    css_path = os.path.join(DEMO, "assets", "style.css")
    for path in (bundle_path, css_path):
        if not os.path.exists(path):
            print(f"missing {path}; run the offline build first", file=sys.stderr)
            return 1

    # 新旧一致性闸门：单文件包取的是 demo/assets/index.js，而 demo/ 由 build_offline_dir.py
    # 从 dist/ 刷新。如果 demo 没刷新过就直接打包，会把上一轮的旧 JS 打进交付物里
    # —— 产物看起来更新了、其实是旧的（本次实际踩到：单文件包里还是两阶段加载之前的代码）。
    # 这里与 dist/index.html 当前引用的 bundle 逐字节比对，不一致就拒绝打包。
    dist_index = os.path.join(ROOT, "dist", "index.html")
    if os.path.exists(dist_index):
        with open(dist_index, encoding="utf-8") as handle:
            dist_html = handle.read()
        match = re.search(r"assets/(index-[A-Za-z0-9_-]+\.js)", dist_html)
        if match:
            dist_js = os.path.join(ROOT, "dist", "assets", match.group(1))
            if os.path.exists(dist_js):
                with open(dist_js, "rb") as handle:
                    dist_bytes = handle.read()
                with open(bundle_path, "rb") as handle:
                    demo_bytes = handle.read()
                if dist_bytes != demo_bytes:
                    print(
                        "demo/assets/index.js 与 dist 当前构建不一致（demo 未刷新）。\n"
                        "请先运行：python tools/build_offline_dir.py\n"
                        "否则单文件包会打进上一轮的旧 JS。",
                        file=sys.stderr,
                    )
                    return 1

    with open(bundle_path, encoding="utf-8") as handle:
        js = handle.read()
    with open(css_path, encoding="utf-8") as handle:
        css = handle.read()

    # 用 data: URI 替换 manifest 里的相对路径字符串。
    # 这些字符串在打包后的 bundle 中各出现一次（image / thumb 字段）。
    art_total = 0
    thumb_total = 0
    replaced_art = 0
    replaced_thumb = 0
    for artwork in manifest["artworks"]:
        art_id = artwork["id"]

        art_src = os.path.join(PUBLIC, "assets", "art", f"{art_id}.jpg")
        if os.path.exists(art_src):
            uri = jpeg_data_uri(art_src, DEMO_MAX_DIM, DEMO_QUALITY)
            art_total += len(uri)
            needle = f"assets/art/{art_id}.jpg"
            if needle in js:
                js = js.replace(needle, uri)
                replaced_art += 1

        thumb_src = os.path.join(PUBLIC, "assets", "thumb", f"{art_id}.jpg")
        if os.path.exists(thumb_src):
            uri = jpeg_data_uri(thumb_src, THUMB_MAX_DIM, THUMB_QUALITY)
            thumb_total += len(uri)
            needle = f"assets/thumb/{art_id}.jpg"
            if needle in js:
                js = js.replace(needle, uri)
                replaced_thumb += 1

    # 图标也内联，避免 file:// 下取不到
    favicon_uri = ""
    favicon_path = os.path.join(PUBLIC, "favicon.svg")
    if os.path.exists(favicon_path):
        with open(favicon_path, encoding="utf-8") as handle:
            svg = handle.read()
        favicon_uri = "data:image/svg+xml;base64," + base64.b64encode(svg.encode("utf-8")).decode("ascii")

    remaining = re.findall(r"assets/(?:art|thumb)/[a-z0-9]+\.jpg", js)
    if remaining:
        print(f"FAIL {len(remaining)} image paths were not inlined: {remaining[:3]}", file=sys.stderr)
        return 1

    safe_js = js.replace("</script>", "<\\/script>")
    # 静态模板按默认语言（英文）写死。运行时会按用户选择改写 <html lang>、<title>
    # 与 description，但「JS 执行前的一瞬」应当已经是英文，否则默认英文的用户会
    # 先看到一帧中文标题。这里直接取 manifest 的英文侧字段。
    doc_lang = "en"
    doc_title = (manifest.get("project", {}).get("nameEn")
                 or manifest.get("project", {}).get("name") or "Time Gallery")
    doc_desc = manifest.get("project", {}).get("descriptionEn", "")
    # 描述里可能含 <i> 之类的标记，去掉标签避免破坏 meta 属性
    doc_desc = re.sub(r"<[^>]+>", "", doc_desc).replace('"', "&quot;")
    html = f"""<!doctype html>
<html lang="{doc_lang}">
  <head>
    <meta charset="UTF-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover"
    />
    <meta name="color-scheme" content="light" />
    <meta name="theme-color" content="#f6f0e5" />
    <meta name="description" content="{doc_desc}" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-title" content="{doc_title}" />
    <link rel="icon" href="{favicon_uri}" type="image/svg+xml" />
    <title>{doc_title}</title>
    <style>
{css}
    </style>
  </head>
  <body>
    <div id="app"></div>
    <script>
{safe_js}
    </script>
  </body>
</html>
"""

    os.makedirs(RELEASE, exist_ok=True)
    with open(OUT, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(html)

    size = os.path.getsize(OUT)
    print(f"art inlined:   {replaced_art}/96  ({art_total / 1048576:.1f} MB as data URI)")
    print(f"thumbs inlined:{replaced_thumb}/96  ({thumb_total / 1048576:.1f} MB as data URI)")
    print(f"output: {OUT}")
    print(f"size:   {size / 1048576:.1f} MB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
