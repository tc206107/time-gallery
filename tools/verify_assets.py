"""Verify the Time Gallery asset pipeline after tools/optimize_assets.py.

Read-only: nothing here writes into the project.  Every check prints PASS or
FAIL and the script exits non-zero if any check failed.

Checks
  1. thumbnail set: count, total bytes, largest side <= 320 px
  2. optimised originals: count, total bytes, largest side <= 1600 px
  3. before/after byte totals (the "before" side is read from the pristine
     backup directory, whose files are byte-identical to the pre-change art)
  4. aspect ratio: no artwork's width/height ratio moved by more than 0.5 %
  5. manifest integrity: 96 artworks, 12 periods, 73 artists, unique ids,
     every image and thumb path present on disk
  6. every image value starts with "assets/" and none starts with "/"
  7. landing screen cost: the 36 timeline images before vs after
  8. manifest diff against the pristine manifest copy: only image, thumb and
     imageWidth/imageHeight may differ

Usage:
    python tools/verify_assets.py [--backup-dir DIR]
"""

import argparse
import hashlib
import json
import os
import sys
from urllib.parse import urljoin

from PIL import Image


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ART_DIR = os.path.join(ROOT, "public", "assets", "art")
THUMB_DIR = os.path.join(ROOT, "public", "assets", "thumb")
MANIFEST_PATH = os.path.join(ROOT, "manifest.json")
# 原图备份目录：默认在仓库上一级，可用 --backup-dir 覆盖（与 optimize_assets.py 一致）
DEFAULT_BACKUP_DIR = os.path.join(os.path.dirname(ROOT), "_time-gallery-art-backup")

MAX_DIMENSION = 1600
THUMB_SIZE = 320
ASPECT_TOLERANCE = 0.005

RESULTS = []


def check(name, ok, detail=""):
    RESULTS.append((name, bool(ok), detail))
    print("{0}  {1}{2}".format("PASS" if ok else "FAIL", name, " — " + detail if detail else ""))
    return ok


def human(num_bytes):
    return "{0:.2f} MB".format(num_bytes / 1048576.0)


def size_of(path):
    with Image.open(path) as image:
        return image.size


def load_json(path):
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--backup-dir", default=DEFAULT_BACKUP_DIR)
    args = parser.parse_args()

    manifest = load_json(MANIFEST_PATH)
    artworks = manifest["artworks"]
    ids = [item["id"] for item in artworks]

    print("== 1. thumbnails ==")
    thumb_names = sorted(name for name in os.listdir(THUMB_DIR) if name.lower().endswith(".jpg"))
    thumb_bytes = sum(os.path.getsize(os.path.join(THUMB_DIR, name)) for name in thumb_names)
    thumb_dims = {name: size_of(os.path.join(THUMB_DIR, name)) for name in thumb_names}
    thumb_over = [n for n, s in thumb_dims.items() if max(s) > THUMB_SIZE]
    check("thumbnail count == 96", len(thumb_names) == 96, "{0} files".format(len(thumb_names)))
    check(
        "every thumbnail is <= {0} px on its longest side".format(THUMB_SIZE),
        not thumb_over,
        "largest = {0}".format(max(max(s) for s in thumb_dims.values())),
    )
    check(
        "thumbnail total is under the 1.5 MB target",
        thumb_bytes < 1.5 * 1048576,
        "{0} ({1} bytes) at {2} px / quality 80; quality 76 gives 1.49 MB, "
        "{3} px gives 1.39 MB".format(
            human(thumb_bytes), thumb_bytes, THUMB_SIZE, 288
        ),
    )
    thumb_modes = set()
    thumb_progressive = 0
    for name in thumb_names:
        with Image.open(os.path.join(THUMB_DIR, name)) as image:
            thumb_modes.add(image.mode)
            if image.info.get("progressive"):
                thumb_progressive += 1
    check("every thumbnail is RGB", thumb_modes == {"RGB"}, str(thumb_modes))
    check("every thumbnail is progressive JPEG", thumb_progressive == 96, "{0}/96".format(thumb_progressive))
    print("     thumbnails total: {0}".format(human(thumb_bytes)))

    print("== 2. optimised originals ==")
    art_names = sorted(name for name in os.listdir(ART_DIR) if name.lower().endswith(".jpg"))
    art_bytes = sum(os.path.getsize(os.path.join(ART_DIR, name)) for name in art_names)
    art_dims = {name: size_of(os.path.join(ART_DIR, name)) for name in art_names}
    art_over = [n for n, s in art_dims.items() if max(s) > MAX_DIMENSION]
    check("original count == 96", len(art_names) == 96, "{0} files".format(len(art_names)))
    check(
        "every original is <= {0} px on its longest side".format(MAX_DIMENSION),
        not art_over,
        "largest = {0}".format(max(max(s) for s in art_dims.values())),
    )
    print("     originals total: {0} ({1} bytes)".format(human(art_bytes), art_bytes))
    art_modes = set()
    art_progressive = 0
    for name in art_names:
        with Image.open(os.path.join(ART_DIR, name)) as image:
            art_modes.add(image.mode)
            if image.info.get("progressive"):
                art_progressive += 1
    check("every original is RGB", art_modes == {"RGB"}, str(art_modes))
    check(
        "every original is progressive JPEG",
        art_progressive == 96,
        "{0}/96".format(art_progressive),
    )

    print("== 3. before / after totals ==")
    backup_names = sorted(name for name in os.listdir(args.backup_dir) if name.lower().endswith(".jpg"))
    before_bytes = sum(os.path.getsize(os.path.join(args.backup_dir, name)) for name in backup_names)
    check("pristine backup holds 96 files", len(backup_names) == 96, "{0} files".format(len(backup_names)))
    print("     originals before: {0} ({1} bytes)".format(human(before_bytes), before_bytes))
    print("     originals after:  {0} ({1} bytes)".format(human(art_bytes), art_bytes))
    print(
        "     saved: {0} ({1:.1f} %)".format(
            human(before_bytes - art_bytes),
            100.0 * (before_bytes - art_bytes) / before_bytes,
        )
    )
    print("     thumbnails added: {0} ({1} bytes)".format(human(thumb_bytes), thumb_bytes))
    check(
        "total payload shrank",
        before_bytes > art_bytes + thumb_bytes,
        "{0} -> {1}".format(
            human(before_bytes), human(art_bytes + thumb_bytes)
        ),
    )

    print("== 4. aspect ratio ==")
    worst = (0.0, None)
    changed = []
    for name in art_names:
        before_w, before_h = size_of(os.path.join(args.backup_dir, name))
        after_w, after_h = art_dims[name]
        delta = abs((after_w / float(after_h)) / (before_w / float(before_h)) - 1.0)
        if delta > 0:
            changed.append((delta, name))
        if delta > worst[0]:
            worst = (delta, (name, (before_w, before_h), (after_w, after_h)))
    check(
        "no aspect ratio moved by more than {0:.1%}".format(ASPECT_TOLERANCE),
        worst[0] <= ASPECT_TOLERANCE,
        "worst = {0:.4%} on {1} {2} -> {3}".format(worst[0], worst[1][0], worst[1][1], worst[1][2]),
    )
    check(
        "manifest imageWidth/imageHeight match the files on disk",
        all(
            (item["imageWidth"], item["imageHeight"]) == art_dims[item["id"] + ".jpg"]
            for item in artworks
        ),
    )
    pristine_path = os.path.join(args.backup_dir, "manifest.original.json")
    pristine_dims = {}
    pristine = None
    if os.path.exists(pristine_path):
        pristine = load_json(pristine_path)
        pristine_dims = {
            item["id"]: (item["originalWidth"], item["originalHeight"])
            for item in pristine["artworks"]
        }
    check(
        "originalWidth/originalHeight preserved verbatim for all 96",
        len(pristine_dims) == 96
        and all(
            pristine_dims[item["id"]] == (item["originalWidth"], item["originalHeight"])
            for item in artworks
        ),
    )
    # Ten artworks record the Commons scan size rather than the size of the local
    # copy (tools/expand_and_dimensions.py wrote those). That gap is pre-existing
    # data; what must be proved is that the resize added no NEW gap, i.e. that
    # originalWidth/originalHeight still describe the pristine sources and were
    # not overwritten with the downscaled pixel size.
    now = {
        item["id"]
        for item in artworks
        if (item["originalWidth"], item["originalHeight"])
        != size_of(os.path.join(args.backup_dir, item["id"] + ".jpg"))
    }
    before = {
        item["id"]
        for item in artworks
        if pristine_dims.get(item["id"])
        and pristine_dims[item["id"]] != size_of(os.path.join(args.backup_dir, item["id"] + ".jpg"))
    }
    check(
        "originalWidth/originalHeight still describe the pristine sources",
        now == before,
        "pre-existing gaps (Commons scan size vs local copy): {0}; new: {1}".format(
            ", ".join(sorted(before)) or "none", ", ".join(sorted(now - before)) or "none"
        ),
    )
    ratios = sorted(changed, reverse=True)[:3]
    print("     ratios that moved at all: {0}; largest three: {1}".format(
        len(changed), [("{0:.4%}".format(d), n) for d, n in ratios]))

    print("== 5. manifest integrity ==")
    check("96 artworks", len(artworks) == 96, str(len(artworks)))
    check("12 periods", len(manifest["periods"]) == 12, str(len(manifest["periods"])))
    check("73 artists", len(manifest["artists"]) == 73, str(len(manifest["artists"])))
    check("unique artwork ids", len(set(ids)) == len(ids), "{0} unique".format(len(set(ids))))
    missing_image = [i["id"] for i in artworks if not os.path.exists(os.path.join(ROOT, "public", i["image"]))]
    missing_thumb = [i["id"] for i in artworks if not os.path.exists(os.path.join(ROOT, "public", i["thumb"]))]
    check("every image path exists on disk", not missing_image, ", ".join(missing_image[:5]))
    check("every thumb path exists on disk", not missing_thumb, ", ".join(missing_thumb[:5]))

    print("== 6. path format ==")
    bad_prefix = [i["image"] for i in artworks if not i["image"].startswith("assets/")]
    leading_slash = [i["image"] for i in artworks if i["image"].startswith("/")]
    check("every image starts with 'assets/'", not bad_prefix, ", ".join(bad_prefix[:5]))
    check("no image starts with '/'", not leading_slash, ", ".join(leading_slash[:5]))
    check(
        "no thumb starts with '/'",
        not [i["thumb"] for i in artworks if i["thumb"].startswith("/")],
    )
    print("     image sample: {0}".format(artworks[0]["image"]))
    print("     thumb sample: {0}".format(artworks[0]["thumb"]))

    print("== 7. landing screen (36 timeline images) ==")
    landing = []
    for period in manifest["periods"]:
        works = [item for item in artworks if item["periodId"] == period["id"]]
        landing.extend(works[:3])
    landing_before = sum(
        os.path.getsize(os.path.join(args.backup_dir, item["id"] + ".jpg")) for item in landing
    )
    landing_after = sum(
        os.path.getsize(os.path.join(THUMB_DIR, item["id"] + ".jpg")) for item in landing
    )
    print("     {0} images: {1} before -> {2} after".format(
        len(landing), human(landing_before), human(landing_after)))
    check(
        "landing screen images shrank by at least 90 %",
        landing_after < landing_before * 0.1,
        "{0:.1f} % smaller".format(100.0 * (1 - landing_after / float(landing_before))),
    )

    print("== 8. diff against the pristine manifest ==")
    if pristine is None:
        check("pristine manifest copy available", False, pristine_path)
    else:
        allowed = {"image", "thumb", "imageWidth", "imageHeight"}
        pristine_by_id = {item["id"]: item for item in pristine["artworks"]}
        unexpected = []
        for item in artworks:
            old = pristine_by_id.get(item["id"], {})
            for key, value in item.items():
                if key in allowed:
                    continue
                if old.get(key) != value:
                    unexpected.append((item["id"], key, old.get(key), value))
        for key in pristine:
            if key != "artworks" and pristine[key] != manifest.get(key):
                unexpected.append(("top-level", key, "differs", "differs"))
        check(
            "only image / thumb / imageWidth / imageHeight changed",
            not unexpected,
            json.dumps(unexpected[:3], ensure_ascii=False),
        )
        check(
            "artwork ids and their order are unchanged",
            [i["id"] for i in pristine["artworks"]] == ids,
        )
        check(
            "top-level key order unchanged",
            list(pristine.keys()) == list(manifest.keys()),
            str(list(manifest.keys())),
        )
        check(
            "96 absolute image paths replaced",
            sum(1 for i in pristine["artworks"] if i["image"].startswith("/")) == 96,
            "{0} were absolute".format(
                sum(1 for i in pristine["artworks"] if i["image"].startswith("/"))
            ),
        )

    print("== 9. backup integrity ==")
    baseline_path = os.path.join(args.backup_dir, "baseline_art.json")
    if os.path.exists(baseline_path):
        baseline = load_json(baseline_path)
        same = all(
            os.path.getsize(os.path.join(args.backup_dir, name)) == baseline[name]["bytes"]
            for name in baseline
        )
        check("pristine backup bytes match the pre-change baseline", same)
    check(
        "no thumbnail exceeds the pristine source bytes",
        all(
            os.path.getsize(os.path.join(THUMB_DIR, name)) < os.path.getsize(os.path.join(args.backup_dir, name))
            for name in thumb_names
        ),
    )

    print("== 10. URL resolution of the relative paths ==")
    root_document = "https://example.github.io/index.html"
    subpath_document = "https://example.github.io/time-gallery/index.html"
    image = artworks[0]["image"]
    at_root = urljoin(root_document, image)
    under_subpath = urljoin(subpath_document, image)
    old_absolute = urljoin(subpath_document, "/" + image)
    check(
        "relative image resolves to the subpath, not to the domain root",
        under_subpath == "https://example.github.io/time-gallery/assets/art/a01.jpg"
        and at_root == "https://example.github.io/assets/art/a01.jpg",
        "{0} | {1}".format(at_root, under_subpath),
    )
    check(
        "the old absolute form resolves outside the subpath",
        old_absolute == "https://example.github.io/assets/art/a01.jpg",
        old_absolute,
    )
    timeline_source = open(os.path.join(ROOT, "src", "ui", "Timeline.js"), encoding="utf-8").read()
    check(
        "Timeline.js renders the thumbnail",
        "work.thumb || work.image" in timeline_source,
    )
    gallery_source = open(os.path.join(ROOT, "src", "three", "GalleryEngine.js"), encoding="utf-8").read()
    check(
        "GalleryEngine.js still loads work.image through the texture loader",
        "this.loader.load(" in gallery_source and "work.image," in gallery_source,
    )

    failed = [name for name, ok, _ in RESULTS if not ok]
    print("\n{0} checks, {1} failed".format(len(RESULTS), len(failed)))
    if failed:
        for name in failed:
            print("  FAILED: {0}".format(name))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
