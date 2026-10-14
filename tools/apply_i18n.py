#!/usr/bin/env python3
"""把英文内容合并进 manifest.json，实现全量双语。

做三件事：
  1. 读取 tools/i18n-content/ 下的英文内容（en-meta.json、en-artworks.json），
     为 periods / artists / artworks / project / licensing / academicReference
     补上对应的 *En 字段；中文原文一律保留，供切换回中文时使用。
  2. 年份（year）按规则确定性转换出 yearEn：约→c.、公元前→BCE、区间用 en dash、
     去掉「年」字。逐条打印转换结果以便核对。
  3. 把 project.defaultLang 设为 en（用户要求默认英文）。

幂等：重复运行结果一致。
用法：
    python tools/apply_i18n.py
"""
from __future__ import annotations

import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONTENT = os.path.join(ROOT, "tools", "i18n-content")
MANIFEST = os.path.join(ROOT, "manifest.json")

CJK = re.compile(r"[\u4e00-\u9fff]")


def load(path):
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def year_to_en(value: str) -> str:
    """把中文年份转成英文写法。

    规则：
      约            -> c.
      公元前 N      -> N BCE
      1503-1519     -> 1503–1519   （连字符转 en dash，仅限数字区间）
      末尾「年」    -> 去掉
    纯数字年份（如 1434）原样返回，不做任何改写。
    """
    text = value.strip()
    approx = text.startswith("约")
    if approx:
        text = text[1:].strip()

    bce = "公元前" in text
    if bce:
        text = text.replace("公元前", "").strip()

    text = text.rstrip("年").strip()

    # 仅在「数字-数字」处替换为 en dash，避免误伤其它连字符
    text = re.sub(r"(?<=\d)-(?=\d)", "\u2013", text)

    if bce:
        text = f"{text} BCE"

    if approx:
        text = f"c. {text}"

    return text


def main() -> int:
    manifest = load(MANIFEST)
    meta = load(os.path.join(CONTENT, "en-meta.json"))
    artworks_en = load(os.path.join(CONTENT, "en-artworks.json"))

    problems: list[str] = []

    # --- 1. project ---
    manifest["project"]["nameEn"] = meta["project"]["nameEn"]
    manifest["project"]["descriptionEn"] = meta["project"]["descriptionEn"]
    # 用户要求：默认英文
    manifest["project"]["defaultLang"] = "en"

    # --- 2. academicReference ---
    ref = manifest["academicReference"]
    ref["noteEn"] = meta["academicReference"]["noteEn"]
    ref["coreTextsEn"] = meta["academicReference"]["coreTexts"]

    # --- 3. licensing ---
    lic = manifest["licensing"]
    for key, en_key in (("policy", "policyEn"), ("notice", "noticeEn"), ("assets", "assetsEn")):
        lic[en_key] = meta["licensing"][en_key]

    # --- 4. network ---
    manifest["networkEn"] = meta["network"]["networkEn"]

    # --- 5. periods ---
    for period in manifest["periods"]:
        en = meta["periods"].get(period["id"])
        if not en:
            problems.append(f"period missing English: {period['id']}")
            continue
        period["nameEn"] = en["nameEn"]
        period["rangeEn"] = en["rangeEn"]
        period["descriptionEn"] = en["descriptionEn"]

    # --- 6. artists ---
    nat_map = meta["nationalities"]
    for artist in manifest["artists"]:
        nat = artist["nationality"]
        if nat not in nat_map:
            problems.append(f"nationality unmapped: {nat!r}")
            continue
        artist["nationalityEn"] = nat_map[nat]
        # nameEn 已存在；若缺失则报错
        if not artist.get("nameEn"):
            problems.append(f"artist missing nameEn: {artist['id']}")

    # --- 7. artworks ---
    for artwork in manifest["artworks"]:
        art_id = artwork["id"]
        desc = artworks_en.get(art_id)
        if not desc:
            problems.append(f"artwork missing English description: {art_id}")
        else:
            artwork["descriptionEn"] = desc

        if not artwork.get("titleEn"):
            problems.append(f"artwork missing titleEn: {art_id}")

        artwork["yearEn"] = year_to_en(artwork["year"])

    # --- 8. 自检：英文侧不得残留中文 ---
    def scan(obj, path=""):
        if isinstance(obj, dict):
            for key, value in obj.items():
                scan(value, f"{path}.{key}")
        elif isinstance(obj, list):
            for index, value in enumerate(obj):
                scan(value, f"{path}[{index}]")
        elif isinstance(obj, str):
            if path.endswith("En") and CJK.search(obj):
                problems.append(f"CJK left in English field {path}: {obj[:40]!r}")

    scan(manifest)

    if problems:
        print("PROBLEMS:", file=sys.stderr)
        for problem in problems:
            print(f"  {problem}", file=sys.stderr)
        return 1

    with open(MANIFEST, "w", encoding="utf-8", newline="\n") as handle:
        json.dump(manifest, handle, ensure_ascii=False, indent=2)
        handle.write("\n")

    # --- 报告 ---
    print(f"periods:  {len(manifest['periods'])}  (nameEn/rangeEn/descriptionEn)")
    print(f"artists:  {len(manifest['artists'])}  (nameEn/nationalityEn)")
    print(f"artworks: {len(manifest['artworks'])}  (titleEn/yearEn/descriptionEn)")
    print(f"defaultLang: {manifest['project']['defaultLang']}")
    print()
    print("年份转换抽查（全部 96 条中凡含中文者）：")
    for artwork in manifest["artworks"]:
        if CJK.search(artwork["year"]):
            print(f"  {artwork['id']}  {artwork['year']:<22} -> {artwork['yearEn']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
