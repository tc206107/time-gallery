"""Generate manifest.json for the Time Gallery.

This generator is incremental on purpose, and the reason is data ownership:

* ``fetch_assets.WORKS`` (80 entries) is the source of truth for the title,
  artist, period, year and description of the artworks it lists.
* The remaining 16 artworks, the ten extra artists and the Commons physical
  dimensions (``physicalWidthCm`` / ``physicalHeightCm``) were added later by
  ``tools/expand_and_dimensions.py`` and cannot be re-derived from ``WORKS``.

So when ``manifest.json`` already exists, this script reads it and preserves
everything it does not own:

* the artwork order, and every artwork that is not present in ``WORKS`` (those
  keep every recorded field and only get their image/thumb path and their
  on-disk dimensions refreshed);
* every field it does not own on the artworks it does know (for example
  ``physicalWidthCm`` / ``physicalHeightCm``);
* the top-level ``project`` / ``academicReference`` / ``licensing`` /
  ``network`` blocks.

It owns and rewrites per artwork: id, title, titleEn, artistId, periodId, year,
description, image, thumb, imageWidth, imageHeight, source, filePage, license,
licenseUrl.  ``originalWidth`` / ``originalHeight`` are recorded on the first
generation and preserved afterwards: they are the true source pixel size and
must survive the downscale performed by ``tools/optimize_assets.py``, while
``imageWidth`` / ``imageHeight`` always describe the file that is on disk now.

Image paths are emitted RELATIVE, with no leading slash, so the same build works
both at a domain root and under a GitHub Pages project subpath such as
``https://<user>.github.io/time-gallery/``: a relative URL resolves against the
document URL in both cases, whereas ``/assets/art/x.jpg`` resolves to the domain
root and 404s under the subpath.

Usage:  python tools/generate_manifest.py
"""

import json
import os
import sys
import urllib.parse

from PIL import Image

from fetch_assets import PERIODS, WORKS


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ART_DIR = os.path.join(ROOT, "public", "assets", "art")
THUMB_DIR = os.path.join(ROOT, "public", "assets", "thumb")
MANIFEST_PATH = os.path.join(ROOT, "manifest.json")

IMAGE_PREFIX = "assets/art/"
THUMB_PREFIX = "assets/thumb/"

# Serialisation order of the fields this generator owns. Any further field
# carried over from the previous manifest is appended after these, in the order
# it already had, so nothing is silently reordered.
OWNED_FIELD_ORDER = (
    "id",
    "title",
    "titleEn",
    "artistId",
    "periodId",
    "year",
    "description",
    "image",
    "thumb",
    "originalWidth",
    "originalHeight",
    "imageWidth",
    "imageHeight",
    "source",
    "filePage",
    "license",
    "licenseUrl",
)

# Used only when manifest.json does not exist yet (a fresh checkout that has the
# images but no manifest). When the manifest is present its own blocks win.
FALLBACK_TOP_LEVEL = {
    "project": {
        "name": "时光画廊",
        "nameEn": "Time Gallery",
        "version": "1.1.0",
        "description": "沉浸式艺术史科普游戏，从《Arts and Ideas》的宏观脉络出发，以第一人称3D画廊串联十二个艺术时期与九十余幅公有领域经典画作。",
        "defaultLang": "zh-CN",
        "runtime": "fully-offline",
    },
    "academicReference": {
        "coreTexts": [
            "Fleming, William & Marien, Mary Warner. Arts and Ideas. Thomson/Wadsworth, later editions.",
            "以艺术形式背后的意识形态、社会背景与时代精神作为分期与叙述框架。",
        ],
        "note": "本项目为科普教育用途，文本为编者按学术框架撰写的原创简释，不含对原书内容的直接复制。",
    },
    "licensing": {
        "policy": "全部图像来自 Wikimedia Commons，均为公有领域（Public Domain）或 CC0 授权。",
        "notice": "作品年代与作者信息为本项目整理；授权以各文件页面为准。",
        "assets": "图片仅用于本地教育展示，随项目离线打包。",
    },
    "network": "运行时零外部请求；所有脚本、样式、字体与图片均随 dist 本地打包。",
}


def image_size(path):
    if not os.path.exists(path):
        return None
    with Image.open(path) as image:
        return image.size[0], image.size[1]


def source_url(file_name):
    safe_file = urllib.parse.quote(file_name.replace(" ", "_"), safe=":/()',-")
    return "https://commons.wikimedia.org/wiki/File:" + safe_file


def load_previous():
    if not os.path.exists(MANIFEST_PATH):
        return None
    with open(MANIFEST_PATH, "r", encoding="utf-8") as handle:
        return json.load(handle)


def disk_size(art_id):
    return image_size(os.path.join(ART_DIR, art_id + ".jpg"))


def ordered_artwork(previous, owned):
    artwork = {key: owned[key] for key in OWNED_FIELD_ORDER}
    for key, value in previous.items():
        if key not in artwork:
            artwork[key] = value
    return artwork


def build_artwork(work, previous):
    """Merge one WORKS entry with whatever the previous manifest knew about it."""
    art_id = work["id"]
    size = disk_size(art_id)
    if size is None:
        return None, art_id
    width, height = size
    previous = previous or {}

    owned = {
        "id": art_id,
        "title": work["titleZh"],
        "titleEn": work["titleEn"],
        "artistId": work["artistId"],
        "periodId": work["periodId"],
        "year": work["year"],
        "description": work["description"],
        "image": IMAGE_PREFIX + art_id + ".jpg",
        "thumb": THUMB_PREFIX + art_id + ".jpg",
        # True source pixel size: recorded once, preserved from then on.
        "originalWidth": previous.get("originalWidth") or width,
        "originalHeight": previous.get("originalHeight") or height,
        # Dimensions of the file that is actually on disk right now.
        "imageWidth": width,
        "imageHeight": height,
        "source": source_url(work["file"]),
        "filePage": source_url(work["file"]),
        "license": "Public domain",
        "licenseUrl": "https://commons.wikimedia.org/wiki/Commons:Reusing_content",
    }
    return ordered_artwork(previous, owned), None


def carry_over_artwork(previous):
    """Normalise a carried-over artwork: relative paths, and dimensions from disk.

    These are the artworks that `tools/expand_and_dimensions.py` appended, so the
    generator has no WORKS entry to rebuild them from.  Every field the previous
    manifest recorded is kept verbatim; only the two path fields and the two
    on-disk dimension fields are brought up to date.
    """
    art_id = previous.get("id")
    size = disk_size(art_id) if art_id else None
    if size is None:
        return None, art_id
    width, height = size

    updated = dict(previous)
    updated["image"] = IMAGE_PREFIX + art_id + ".jpg"
    updated["thumb"] = THUMB_PREFIX + art_id + ".jpg"
    updated["imageWidth"] = width
    updated["imageHeight"] = height
    updated.setdefault("originalWidth", width)
    updated.setdefault("originalHeight", height)

    order = []
    for key in previous:
        order.append(key)
        if key == "image" and "thumb" not in previous:
            order.append("thumb")
    artwork = {key: updated[key] for key in order}
    for key, value in updated.items():
        if key not in artwork:
            artwork[key] = value
    return artwork, None


def merge_artists(previous_artists):
    """WORKS artists win on shared ids; every other artist is carried over."""
    merged = []
    seen = set()
    by_id = {}
    for work in WORKS:
        by_id[work["artistId"]] = {
            "id": work["artistId"],
            "name": work["artistNameZh"],
            "nameEn": work["artistNameEn"],
            "birthYear": work["artistBorn"],
            "deathYear": work["artistDied"],
            "nationality": work["nationality"],
        }
    for artist in previous_artists:
        artist_id = artist.get("id")
        seen.add(artist_id)
        merged.append(by_id.get(artist_id, artist))
    for artist_id, artist in by_id.items():
        if artist_id not in seen:
            merged.append(artist)
    return merged


def main():
    previous = load_previous()
    previous_artworks = (previous or {}).get("artworks", [])
    previous_by_id = {item.get("id"): item for item in previous_artworks}
    previous_artists = (previous or {}).get("artists", [])

    artworks = []
    missing = []
    kept_unknown = 0

    for work in WORKS:
        artwork, missing_id = build_artwork(work, previous_by_id.get(work["id"]))
        if artwork is None:
            missing.append(missing_id)
            continue
        artworks.append(artwork)

    known_ids = {item["id"] for item in artworks}
    for item in previous_artworks:
        if item.get("id") not in known_ids:
            # Artworks added by tools/expand_and_dimensions.py: every field is
            # preserved, only the image/thumb paths and the on-disk dimensions
            # are refreshed.
            artwork, missing_id = carry_over_artwork(item)
            if artwork is None:
                missing.append(missing_id)
                continue
            artworks.append(artwork)
            kept_unknown += 1

    if missing:
        print("Missing local assets:", ", ".join(missing))
        sys.exit(1)

    missing_thumbs = [
        item["id"]
        for item in artworks
        if not os.path.exists(os.path.join(THUMB_DIR, item["id"] + ".jpg"))
    ]

    # Top-level order follows the manifest that is already in the repository, so
    # that regenerating rewrites values instead of reshuffling the file.
    previous = previous or {}
    manifest = {
        "project": previous.get("project", FALLBACK_TOP_LEVEL["project"]),
        "academicReference": previous.get(
            "academicReference", FALLBACK_TOP_LEVEL["academicReference"]
        ),
        "periods": previous.get("periods") or PERIODS,
        "artists": merge_artists(previous_artists),
        "artworks": artworks,
        "licensing": previous.get("licensing", FALLBACK_TOP_LEVEL["licensing"]),
        "network": previous.get("network", FALLBACK_TOP_LEVEL["network"]),
    }
    for key, value in previous.items():
        if key not in manifest:
            manifest[key] = value

    with open(MANIFEST_PATH, "w", encoding="utf-8") as handle:
        json.dump(manifest, handle, ensure_ascii=False, indent=2)

    print(
        "Manifest written: {0} artworks ({1} carried over from the previous manifest), "
        "{2} artists.".format(len(artworks), kept_unknown, len(manifest["artists"]))
    )
    print(
        "Image paths are relative: {0}<id>.jpg / {1}<id>.jpg".format(IMAGE_PREFIX, THUMB_PREFIX)
    )
    if missing_thumbs:
        print(
            "Warning: {0} thumbnails not on disk yet ({1}{2}). "
            "Run tools/optimize_assets.py.".format(
                len(missing_thumbs),
                ", ".join(missing_thumbs[:5]),
                ", ..." if len(missing_thumbs) > 5 else "",
            )
        )
    else:
        print("All {0} thumbnails present.".format(len(artworks)))


if __name__ == "__main__":
    main()
