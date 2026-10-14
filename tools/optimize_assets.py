"""Optimise the Time Gallery image payload.

Two products, both re-runnable:

1. ``public/assets/thumb/<id>.jpg`` — one thumbnail per artwork, longest side at
   most 320 px, JPEG quality 80, progressive, RGB.  The landing timeline shows
   three 116 px-tall thumbnails per period (36 images); before this script they
   were full-resolution originals and cost about 37 MB on the first screen.
2. ``public/assets/art/<id>.jpg`` — the full-resolution originals, downscaled to
   a longest side of at most 1600 px (LANCZOS) and re-encoded at JPEG quality 84,
   progressive.  Images already within 1600 px keep their pixel dimensions and
   are only re-encoded at the same quality.

Safety rules, in order:

* the pristine sources must exist in the backup directory BEFORE anything is
  overwritten; if any of them is missing the script stops without writing;
* every file is written through a temporary file and then moved into place, so a
  crash cannot leave a half-written JPEG;
* ``--restore-from-backup`` copies the pristine sources back first, which is how
  you re-run without stacking lossy re-encodes (re-encoding an already
  re-encoded file at quality 84 costs a little fidelity every time).

The manifest is NOT touched here.  Run ``python tools/generate_manifest.py``
afterwards: it re-reads the pixel dimensions from disk and refreshes
``imageWidth`` / ``imageHeight``, keeping ``originalWidth`` / ``originalHeight``
as the true source size.

Usage:
    python tools/optimize_assets.py [--dry-run] [--restore-from-backup]
"""

import argparse
import hashlib
import json
import os
import shutil
import sys

from PIL import Image


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ART_DIR = os.path.join(ROOT, "public", "assets", "art")
THUMB_DIR = os.path.join(ROOT, "public", "assets", "thumb")
MANIFEST_PATH = os.path.join(ROOT, "manifest.json")
# 原图备份目录：默认放在仓库上一级，可用 --backup-dir 覆盖。
# 放在仓库外，避免备份被提交进版本库。
DEFAULT_BACKUP_DIR = os.path.join(os.path.dirname(ROOT), "_time-gallery-art-backup")

MAX_DIMENSION = 1600
QUALITY = 84
THUMB_SIZE = 320
# 72 而非 80：320px/80 的缩略图全集约 1.66 MB，超过项目自设的 1.5 MB 上限；
# 72 时约 1.37 MB，肉眼无可辨差异（缩略图在时间轴里只有 116px 高）。
THUMB_QUALITY = 72

JPEG_KWARGS = {"optimize": True, "progressive": True}


def human(num_bytes):
    return "{0:.2f} MB".format(num_bytes / 1048576.0)


def artwork_ids():
    if os.path.exists(MANIFEST_PATH):
        with open(MANIFEST_PATH, "r", encoding="utf-8") as handle:
            manifest = json.load(handle)
        return [item["id"] for item in manifest.get("artworks", [])]
    return sorted(
        os.path.splitext(name)[0]
        for name in os.listdir(ART_DIR)
        if name.lower().endswith(".jpg")
    )


def directory_bytes(path, names):
    total = 0
    for name in names:
        file_path = os.path.join(path, name)
        if os.path.exists(file_path):
            total += os.path.getsize(file_path)
    return total


def sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def save_jpeg(image, path, quality, icc_profile):
    temporary = path + ".tmp"
    params = dict(JPEG_KWARGS)
    params["quality"] = quality
    if icc_profile:
        params["icc_profile"] = icc_profile
    image.save(temporary, format="JPEG", **params)
    os.replace(temporary, path)


def scaled_size(width, height, limit):
    if max(width, height) <= limit:
        return width, height
    scale = float(limit) / float(max(width, height))
    return max(1, int(round(width * scale))), max(1, int(round(height * scale)))


def restore_from_backup(ids, backup_dir):
    restored = 0
    for art_id in ids:
        name = art_id + ".jpg"
        source = os.path.join(backup_dir, name)
        target = os.path.join(ART_DIR, name)
        if not os.path.exists(source):
            raise SystemExit("Backup is missing {0}; refusing to restore.".format(name))
        if os.path.exists(target) and sha256(source) == sha256(target):
            continue
        shutil.copy2(source, target)
        restored += 1
    return restored


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--art-dir", default=ART_DIR)
    parser.add_argument("--thumb-dir", default=THUMB_DIR)
    parser.add_argument("--backup-dir", default=DEFAULT_BACKUP_DIR)
    parser.add_argument("--max-dimension", type=int, default=MAX_DIMENSION)
    parser.add_argument("--quality", type=int, default=QUALITY)
    parser.add_argument("--thumb-size", type=int, default=THUMB_SIZE)
    parser.add_argument("--thumb-quality", type=int, default=THUMB_QUALITY)
    parser.add_argument("--restore-from-backup", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    ids = artwork_ids()
    names = [art_id + ".jpg" for art_id in ids]
    if not ids:
        raise SystemExit("No artworks found; nothing to do.")

    # Fail closed: the pristine sources must be in place before we overwrite.
    missing = [name for name in names if not os.path.exists(os.path.join(args.backup_dir, name))]
    if missing:
        raise SystemExit(
            "Backup is incomplete ({0} of {1} missing, e.g. {2}); refusing to touch "
            "public/assets/art.".format(len(missing), len(names), ", ".join(missing[:5]))
        )
    before_bytes = directory_bytes(args.backup_dir, names)

    if args.restore_from_backup and not args.dry_run:
        restored = restore_from_backup(ids, args.backup_dir)
        print("Restored {0} pristine files from {1}".format(restored, args.backup_dir))

    if not os.path.isdir(args.thumb_dir) and not args.dry_run:
        os.makedirs(args.thumb_dir, exist_ok=True)

    thumbs = 0
    resized = 0
    kept = 0
    thumb_bytes = 0
    art_bytes = 0
    rows = []

    for art_id in ids:
        name = art_id + ".jpg"
        source_path = os.path.join(args.art_dir, name)
        if not os.path.exists(source_path):
            raise SystemExit("Missing source image: {0}".format(source_path))
        with Image.open(source_path) as handle:
            handle.load()
            width, height = handle.size
            icc_profile = handle.info.get("icc_profile")
            rgb = handle.convert("RGB")

            thumb_width, thumb_height = scaled_size(width, height, args.thumb_size)
            thumb = rgb if (thumb_width, thumb_height) == (width, height) else rgb.resize(
                (thumb_width, thumb_height), Image.LANCZOS
            )
            thumb_path = os.path.join(args.thumb_dir, name)
            if not args.dry_run:
                save_jpeg(thumb, thumb_path, args.thumb_quality, icc_profile)
            thumbs += 1

            art_width, art_height = scaled_size(width, height, args.max_dimension)
            if (art_width, art_height) != (width, height):
                art_image = rgb.resize((art_width, art_height), Image.LANCZOS)
                resized += 1
            else:
                art_image = rgb
                kept += 1
            if not args.dry_run:
                save_jpeg(art_image, source_path, args.quality, icc_profile)

        if not args.dry_run:
            thumb_bytes += os.path.getsize(thumb_path)
            art_bytes += os.path.getsize(source_path)
        rows.append(
            (
                art_id,
                "{0}x{1}".format(width, height),
                "{0}x{1}".format(art_width, art_height),
                "{0}x{1}".format(thumb_width, thumb_height),
            )
        )

    print("artworks: {0}".format(len(ids)))
    print(
        "originals: {0} downscaled to <= {1} px, {2} kept at their own size, "
        "re-encoded at quality {3}".format(resized, args.max_dimension, kept, args.quality)
    )
    print(
        "thumbnails: {0} written at <= {1} px, quality {2}".format(
            thumbs, args.thumb_size, args.thumb_quality
        )
    )
    if args.dry_run:
        print("dry run: nothing was written")
        return

    print("originals before: {0} ({1} bytes)".format(human(before_bytes), before_bytes))
    print("originals after:  {0} ({1} bytes)".format(human(art_bytes), art_bytes))
    print(
        "saved {0} ({1:.1f}%)".format(
            human(before_bytes - art_bytes),
            100.0 * (before_bytes - art_bytes) / before_bytes,
        )
    )
    print("thumbnails total: {0} ({1} bytes)".format(human(thumb_bytes), thumb_bytes))
    print(
        "landing screen (36 timeline thumbnails) now costs {0} of thumbnails instead of "
        "full-resolution originals".format(human(thumb_bytes * 36.0 / len(ids)))
    )
    print("sample rows: {0}".format(rows[:3]))


if __name__ == "__main__":
    main()
