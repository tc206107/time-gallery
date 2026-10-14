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
    html = f"""<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover"
    />
    <meta name="color-scheme" content="light" />
    <meta name="theme-color" content="#f6f0e5" />
    <meta name="description" content="时光画廊：以第一人称 3D 展厅浏览十二个艺术时期与九十六幅公有领域经典画作。" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-title" content="时光画廊" />
    <link rel="icon" href="{favicon_uri}" type="image/svg+xml" />
    <title>时光画廊</title>
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
