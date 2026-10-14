#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Expand the Time Gallery manifest with local Commons assets.

The script is intentionally conservative:
- reads the current manifest instead of regenerating it
- appends twelve new artworks and merges any missing artists
- downloads each new image into public/assets/art
- records Commons source metadata and physical dimensions
- fills missing physical dimensions for existing artworks
"""

import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ART_DIR = os.path.join(ROOT, "public", "assets", "art")
MANIFEST_PATH = os.path.join(ROOT, "manifest.json")
COMMONS_API = "https://commons.wikimedia.org/w/api.php"
WIKIDATA_API = "https://www.wikidata.org/w/api.php"
WIKIDATA_SPARQL = "https://query.wikidata.org/sparql"
UA = {"User-Agent": "TimeGalleryBuild/1.1 (offline-public-domain-assets)"}
MAX_TITLES_PER_REQUEST = 20
DOWNLOAD_WIDTH = 1600
REFERENCE_MAX_CM = 120.0
GENERIC_LICENSE_URL = "https://commons.wikimedia.org/wiki/Commons:Reusing_content"

NEW_ARTISTS = {
    "paolo-uccello": {
        "id": "paolo-uccello",
        "name": "保罗·乌切洛",
        "nameEn": "Paolo Uccello",
        "birthYear": 1397,
        "deathYear": 1475,
        "nationality": "意大利",
    },
    "ingres": {
        "id": "ingres",
        "name": "让·奥古斯特·多米尼克·安格尔",
        "nameEn": "Jean-Auguste-Dominique Ingres",
        "birthYear": 1780,
        "deathYear": 1867,
        "nationality": "法国",
    },
    "rousseau": {
        "id": "rousseau",
        "name": "亨利·卢梭",
        "nameEn": "Henri Rousseau",
        "birthYear": 1844,
        "deathYear": 1910,
        "nationality": "法国",
    },
    "duchamp": {
        "id": "duchamp",
        "name": "马塞尔·杜尚",
        "nameEn": "Marcel Duchamp",
        "birthYear": 1887,
        "deathYear": 1968,
        "nationality": "法国 / 美国",
    },
    "chagall": {
        "id": "chagall",
        "name": "马克·夏加尔",
        "nameEn": "Marc Chagall",
        "birthYear": 1887,
        "deathYear": 1985,
        "nationality": "俄罗斯 / 法国",
    },
    "hopper": {
        "id": "hopper",
        "name": "爱德华·霍普",
        "nameEn": "Edward Hopper",
        "birthYear": 1882,
        "deathYear": 1967,
        "nationality": "美国",
    },
}

NEW_WORKS = [
    {
        "id": "a07",
        "periodId": "ancient-medieval",
        "title": "伊苏斯之战马赛克",
        "titleEn": "Battle of Issus Mosaic",
        "artistId": "anonymous",
        "year": "约公元前100年",
        "description": "罗马马赛克以密集的人物动作、斜向透视与戏剧性瞬间记录亚历山大大帝与大流士三世的交锋，体现古代叙事图像的公共纪念功能。",
        "file": "Battle of Issus mosaic - Museo Archeologico Nazionale - Naples 2013-05-16 16-25-06 BW.jpg",
        "fallbackWidthCm": 513.0,
        "fallbackHeightCm": 272.0,
    },
    {
        "id": "e07",
        "periodId": "early-renaissance",
        "title": "圣罗马诺之战（伦敦画板）",
        "titleEn": "The Battle of San Romano (London panel)",
        "artistId": "paolo-uccello",
        "year": "约1435-1440年",
        "description": "乌切洛以几何化的盔甲、枪矛与地面网格组织战争场面，将空间透视转化为近乎抽象的节奏，是早期文艺复兴对秩序与观察力的重要实验。",
        "file": "San Romano Battle (Paolo Uccello, London) 01.jpg",
        "fallbackWidthCm": 320.0,
        "fallbackHeightCm": 182.0,
    },
    {
        "id": "h08",
        "periodId": "high-renaissance",
        "title": "多尼圆形画",
        "titleEn": "Doni Tondo",
        "artistId": "michelangelo",
        "year": "约1504-1507年",
        "description": "米开朗基罗将圣家族置于圆形构图中，通过扭转的人体、雕塑般的体量与冷暖色彩展现盛期文艺复兴对雕塑性与整体秩序的追求。",
        "file": "Michelangelo, tondo doni 03.jpg",
        "fallbackWidthCm": 120.0,
        "fallbackHeightCm": 120.0,
    },
    {
        "id": "b08",
        "periodId": "baroque",
        "title": "尼古拉斯·杜尔博士的解剖学课",
        "titleEn": "The Anatomy Lesson of Dr Nicolaes Tulp",
        "artistId": "rembrandt",
        "year": "1632",
        "description": "伦勃朗以聚光灯般的明暗将解剖演示转化为集体心理叙事，人物注视、手势与光影共同构成荷兰巴洛克群体肖像的经典。",
        "file": "Rembrandt - The Anatomy Lesson of Dr Nicolaes Tulp.jpg",
        "fallbackWidthCm": 216.5,
        "fallbackHeightCm": 169.5,
    },
    {
        "id": "r08",
        "periodId": "rococo-neoclassicism",
        "title": "拿破仑一世御座像",
        "titleEn": "Napoleon I on His Imperial Throne",
        "artistId": "ingres",
        "year": "1806",
        "description": "安格尔以正面、对称的圣像式构图呈现拿破仑的威权姿态，将罗马帝国图像、宫廷仪轨与新古典主义的清晰轮廓叠合为政治神化。",
        "file": "Ingres, Napoleon on his Imperial throne.jpg",
        "fallbackWidthCm": 162.0,
        "fallbackHeightCm": 259.0,
    },
    {
        "id": "m08",
        "periodId": "romanticism",
        "title": "1808年5月3日",
        "titleEn": "The Third of May 1808",
        "artistId": "goya",
        "year": "1814",
        "description": "戈雅以夜灯下的枪决场面记录战争的残酷，将牺牲者、枪口与地平线组织成道德控诉，开辟浪漫主义历史画中的个体苦难主题。",
        "file": "El Tres de Mayo, by Francisco de Goya, from Prado thin black margin.jpg",
        "fallbackWidthCm": 347.0,
        "fallbackHeightCm": 268.0,
    },
    {
        "id": "s07",
        "periodId": "realism",
        "title": "碎石工",
        "titleEn": "The Stone Breakers",
        "artistId": "courbet",
        "year": "1849",
        "description": "库尔贝以几乎等身大的构图描绘普通劳动者的身体与劳作，将传统历史画的庄严尺度赋予被忽略的阶级，成为写实主义的宣言性作品。",
        "file": "Gustave Courbet 018.jpg",
        "fallbackWidthCm": 257.0,
        "fallbackHeightCm": 165.0,
    },
    {
        "id": "i08",
        "periodId": "impressionism",
        "title": "草地上的午餐",
        "titleEn": "Le Déjeuner sur l'herbe",
        "artistId": "manet",
        "year": "1863",
        "description": "马奈借用古典构图却以当代人物与直接平涂打破惯例，将现代生活、裸体传统与公众争议带入画面，为印象派打开新的观看空间。",
        "file": "Édouard Manet - Le Déjeuner sur l'herbe.jpg",
        "fallbackWidthCm": 264.5,
        "fallbackHeightCm": 208.0,
    },
    {
        "id": "p08",
        "periodId": "post-impressionism",
        "title": "沉睡的吉普赛人",
        "titleEn": "The Sleeping Gypsy",
        "artistId": "rousseau",
        "year": "1897",
        "description": "卢梭以清晰的轮廓、静止的月光与不设景深的舞台式空间组织梦幻场景，展现后印象派对主观想象和象征性画面的不同路径。",
        "file": "La Bohémienne endormie.jpg",
        "fallbackWidthCm": 200.7,
        "fallbackHeightCm": 129.5,
    },
    {
        "id": "v08",
        "periodId": "modern-avant-garde",
        "title": "下楼梯的裸女二号（军械库展刊印视图）",
        "titleEn": "Nude Descending a Staircase, No. 2 (Armory Show installation photograph)",
        "artistId": "duchamp",
        "year": "1912",
        "description": "杜尚将连续动作叠合在同一画面中，以空间化的时间问题改写绘画再现方式；1913年军械库展的刊印视图记录了它在现代艺术公众争议中的位置。",
        "file": "Armory Show, 1913, the Cubist room, Raymond Duchamp-Villon, Albert Gleizes, Marcel Duchamp, Alexander Archipenko, New York Tribune, 17 February 1913, p. 7.jpg",
    },
    {
        "id": "x07",
        "periodId": "expressionism-beyond",
        "title": "我与村庄",
        "titleEn": "I and the Village",
        "artistId": "chagall",
        "year": "1911",
        "description": "夏加尔以片段化、倒置的村庄记忆组织画面，将童年、幻想与色彩经验并置，体现二十世纪初期绘画中主观心理空间的扩展。",
        "file": "Marc Chagall, I and the Village (50394064557).jpg",
        "fallbackWidthCm": 151.4,
        "fallbackHeightCm": 192.1,
    },
    {
        "id": "u08",
        "periodId": "american-modern",
        "title": "铁道旁的房屋",
        "titleEn": "House by the Railroad",
        "artistId": "hopper",
        "year": "1925",
        "description": "霍普以孤立的房屋、静止的轨道与清冷光线构成美国现代生活的情感空间，将日常建筑转化为关于疏离与沉默的象征。",
        "file": "The House by the Railroad by Edward Hopper 1925.jpg",
        "fallbackWidthCm": 73.7,
        "fallbackHeightCm": 61.0,
    },
]

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def api_get(api, params, timeout=60):
    url = api + "?" + urllib.parse.urlencode(params)
    last_error = None
    for attempt in range(7):
        try:
            request = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return json.load(response)
        except urllib.error.HTTPError as exc:
            if exc.code not in (429, 500, 502, 503, 504):
                raise
            last_error = exc
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            last_error = exc
        delay = min(30.0, 2.5 * (2 ** attempt))
        print(f"  retry {attempt + 1} in {delay:.1f}s: {last_error}", flush=True)
        time.sleep(delay)
    raise RuntimeError(f"API request failed after retries: {url}")


def http_bytes(url, timeout=180):
    last_error = None
    for attempt in range(6):
        try:
            request = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return response.read()
        except urllib.error.HTTPError as exc:
            if exc.code not in (429, 500, 502, 503, 504):
                raise
            last_error = exc
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            last_error = exc
        time.sleep(min(20.0, 2.0 * (2 ** attempt)))
    raise RuntimeError(f"Download failed after retries: {url}")


def chunked(items, size):
    for index in range(0, len(items), size):
        yield items[index:index + size]


def file_title_from_url(url):
    if not url:
        return None
    split = urllib.parse.urlsplit(url)
    query = urllib.parse.parse_qs(split.query)
    raw = urllib.parse.unquote(query.get("title", [split.path])[0])
    if raw.startswith("File:"):
        return raw[len("File:"):]
    if "/File:" in raw:
        return raw.split("/File:", 1)[1]
    return None


def file_page_url(title):
    encoded = urllib.parse.quote(title.replace(" ", "_"), safe=":/()',-")
    return "https://commons.wikimedia.org/wiki/File:" + encoded


def commons_license(info):
    metadata = (info or {}).get("extmetadata", {})
    short = str(metadata.get("LicenseShortName", {}).get("value") or "")
    code = str(metadata.get("License", {}).get("value") or "")
    if "public domain" in short.lower() or "cc0" in short.lower():
        return "Public domain" if "public domain" in short.lower() else "CC0"
    if code.lower() in ("pd", "cc0"):
        return "Public domain" if code.lower() == "pd" else "CC0"
    return None


def fetch_commons(titles):
    result = {}
    titles = sorted(set(titles))
    for group in chunked(titles, MAX_TITLES_PER_REQUEST):
        data = api_get(COMMONS_API, {
            "action": "query",
            "prop": "imageinfo|revisions",
            "iiprop": "url|size|extmetadata",
            "iiurlwidth": str(DOWNLOAD_WIDTH),
            "rvprop": "content",
            "rvslots": "main",
            "titles": "|".join(group),
            "format": "json",
        })
        if data.get("error"):
            raise RuntimeError(data["error"])
        pages = data.get("query", {}).get("pages", {})
        for page in pages.values():
            title = page.get("title")
            if not title:
                continue
            revisions = page.get("revisions") or []
            wikitext = ""
            if revisions:
                wikitext = revisions[0].get("slots", {}).get("main", {}).get("*", "")
            result[title] = {
                "imageinfo": page.get("imageinfo") or [],
                "wikitext": wikitext,
                "missing": bool(page.get("missing")),
            }
    return result


def quantity_to_cm(value):
    amount = float(value.get("amount", 0))
    unit = str(value.get("unit", "")).rstrip("/").rsplit("/", 1)[-1]
    if unit == "Q174789":  # millimetre
        return amount / 10.0
    if unit == "Q11573":  # metre
        return amount * 100.0
    if unit == "Q218593":  # inch
        return amount * 2.54
    if unit == "Q174728":  # centimetre
        return amount
    return None


def claim_quantity(claims, property_id):
    for claim in claims.get(property_id, []):
        mainsnak = claim.get("mainsnak", {})
        value = mainsnak.get("datavalue", {}).get("value")
        if not value:
            continue
        converted = quantity_to_cm(value)
        if converted is not None and converted > 0:
            return round(converted, 2)
    return None


def sparql_get(query):
    body = urllib.parse.urlencode({"query": query, "format": "json"}).encode("utf-8")
    headers = {
        **UA,
        "Accept": "application/sparql-results+json",
        "Content-Type": "application/x-www-form-urlencoded",
    }
    last_error = None
    for attempt in range(7):
        try:
            request = urllib.request.Request(WIKIDATA_SPARQL, data=body, headers=headers)
            with urllib.request.urlopen(request, timeout=90) as response:
                return json.load(response)
        except urllib.error.HTTPError as exc:
            if exc.code not in (429, 500, 502, 503, 504):
                raise
            last_error = exc
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            last_error = exc
        time.sleep(min(30.0, 2.5 * (2 ** attempt)))
    raise RuntimeError("Wikidata SPARQL request failed: " + str(last_error))


def fetch_wikidata_dimensions(qids):
    qids = sorted(set(qid for qid in qids if qid))
    if not qids:
        return {}
    values = " ".join("wd:" + qid for qid in qids)
    query = (
        "SELECT ?item ?height ?width WHERE { "
        "VALUES ?item { " + values + " } "
        "OPTIONAL { ?item wdt:P2048 ?height. } "
        "OPTIONAL { ?item wdt:P2049 ?width. } "
        "}"
    )
    data = sparql_get(query)
    result = {}
    for row in data.get("results", {}).get("bindings", []):
        item = row.get("item", {}).get("value", "").rsplit("/", 1)[-1]
        height_value = row.get("height", {}).get("value")
        width_value = row.get("width", {}).get("value")
        height = round(float(height_value), 2) if height_value else None
        width = round(float(width_value), 2) if width_value else None
        if width or height:
            result[item] = (width, height)
    return result


def strip_html(value):
    return re.sub(r"<[^>]+>", " ", str(value or ""))


def parse_physical_pair(value):
    text = strip_html(value).replace("–", "-").replace("−", "-")
    pair = re.search(r"(\d+(?:\.\d+)?)\s*(?:×|x|by)\s*(\d+(?:\.\d+)?)\s*(?:cm|centimetre|centimeter|mm|millimetre|m|metre|meter)\b", text, re.I)
    if pair:
        return float(pair.group(2)), float(pair.group(1))
    cm_height = re.search(r"(?:height|hauteur|höhe)\D{0,30}(\d+(?:\.\d+)?)\s*cm\b", text, re.I)
    cm_width = re.search(r"(?:width|largeur|breite)\D{0,30}(\d+(?:\.\d+)?)\s*cm\b", text, re.I)
    if cm_height and cm_width:
        return float(cm_width.group(1)), float(cm_height.group(1))
    return None


def parse_size_template(value):
    match = re.search(r"\{\{\s*Size\s*\|\s*(?:cm|in|m|mm)\s*\|\s*(\d+(?:\.\d+)?)\s*\|\s*(\d+(?:\.\d+)?)", value, re.I)
    if match:
        unit = re.search(r"Size\s*\|\s*(cm|in|m|mm)", value, re.I).group(1).lower()
        first, second = float(match.group(1)), float(match.group(2))
        if unit == "in":
            first, second = first * 2.54, second * 2.54
        elif unit == "m":
            first, second = first * 100.0, second * 100.0
        elif unit == "mm":
            first, second = first / 10.0, second / 10.0
        return round(second, 2), round(first, 2)
    return None


def wikitext_dimensions(wikitext):
    for key in ("dimensions", "size"):
        match = re.search(r"(?im)\|\s*" + re.escape(key) + r"\s*=\s*([^\n|}]+)", wikitext)
        if match:
            from_size = parse_size_template(match.group(1))
            if from_size:
                return from_size
            from_text = parse_physical_pair(match.group(1))
            if from_text:
                return from_text
    height_match = re.search(r"(?im)\|\s*height_metric\s*=\s*([0-9.]+)", wikitext)
    width_match = re.search(r"(?im)\|\s*width_metric\s*=\s*([0-9.]+)", wikitext)
    if height_match and width_match:
        return round(float(width_match.group(1)), 2), round(float(height_match.group(1)), 2)
    return None


def wikidata_id_from_wikitext(wikitext):
    match = re.search(r"(?im)\bwikidata\s*=\s*(Q\d+)", wikitext or "")
    return match.group(1) if match else None


def extmetadata_dimensions(info):
    metadata = (info or {}).get("extmetadata", {})
    for key in metadata:
        if "dimension" not in key.lower():
            continue
        dimensions = parse_physical_pair(metadata[key].get("value"))
        if dimensions:
            return dimensions
    return None


def aspect_dimensions(width, height):
    if not width or not height:
        return round(REFERENCE_MAX_CM, 2), round(REFERENCE_MAX_CM, 2)
    ratio = float(width) / float(height)
    if ratio >= 1.0:
        return round(REFERENCE_MAX_CM, 2), round(REFERENCE_MAX_CM / ratio, 2)
    return round(REFERENCE_MAX_CM * ratio, 2), round(REFERENCE_MAX_CM, 2)


def resolve_dimensions(work, info, wikidata_dimensions):
    from_metadata = extmetadata_dimensions(info)
    if from_metadata:
        return from_metadata

    wikitext = info.get("wikitext", "") if info else ""
    from_wikitext = wikitext_dimensions(wikitext)
    if from_wikitext:
        return from_wikitext

    qid = wikidata_id_from_wikitext(wikitext)
    if qid and qid in wikidata_dimensions:
        width, height = wikidata_dimensions[qid]
        if width and height:
            return width, height

    fallback_width = work.get("fallbackWidthCm")
    fallback_height = work.get("fallbackHeightCm")
    if fallback_width and fallback_height:
        return round(float(fallback_width), 2), round(float(fallback_height), 2)

    images = (info or {}).get("imageinfo") or []
    if images:
        return aspect_dimensions(images[0].get("width"), images[0].get("height"))
    return aspect_dimensions(work.get("imageWidth"), work.get("imageHeight"))


def download_image(work, info):
    if not info or not info.get("imageinfo"):
        raise RuntimeError(f"No Commons image metadata for {work['id']}")

    imageinfo = info["imageinfo"][0]
    license_name = commons_license(imageinfo)
    if not license_name:
        raise RuntimeError(
            f"Rejecting {work['id']}: Commons asset is not Public domain/CC0"
        )

    source = file_page_url(info.get("title") or work["file"])
    url = imageinfo.get("thumburl") or imageinfo.get("url")
    if not url:
        raise RuntimeError(f"No download URL for {work['id']}")

    destination = os.path.join(ART_DIR, work["id"] + ".jpg")
    os.makedirs(ART_DIR, exist_ok=True)
    if os.path.exists(destination):
        with Image.open(destination) as image:
            local_width, local_height = image.size
    else:
        raw = http_bytes(url)
        temporary = destination + ".part"
        with open(temporary, "wb") as output:
            output.write(raw)
        with Image.open(temporary) as image:
            image.verify()
        os.replace(temporary, destination)
        with Image.open(destination) as image:
            local_width, local_height = image.size

    return {
        "source": source,
        "filePage": source,
        "license": license_name,
        "licenseUrl": GENERIC_LICENSE_URL,
        "originalWidth": int(imageinfo.get("width") or local_width),
        "originalHeight": int(imageinfo.get("height") or local_height),
        "imageWidth": local_width,
        "imageHeight": local_height,
    }


def merge_artists(existing_artists):
    by_id = {artist.get("id"): artist for artist in existing_artists if artist.get("id")}
    merged = list(existing_artists)
    for artist in NEW_ARTISTS.values():
        if artist["id"] not in by_id:
            merged.append(artist)
    return merged, by_id


def main():
    with open(MANIFEST_PATH, "r", encoding="utf-8") as manifest_file:
        manifest = json.load(manifest_file)

    existing_artworks = manifest.setdefault("artworks", [])
    existing_ids = {artwork.get("id") for artwork in existing_artworks}
    existing_titles = set()
    for artwork in existing_artworks:
        title = file_title_from_url(artwork.get("source") or artwork.get("filePage"))
        if title:
            existing_titles.add("File:" + title)

    new_titles = [("File:" + work["file"]) for work in NEW_WORKS]
    all_titles = list(existing_titles) + new_titles

    print(f"Fetching Commons metadata for {len(all_titles)} file pages...")
    commons = fetch_commons(all_titles)

    # Commons imageinfo and page templates provide the requested dimension data.
    # The fallback path is deliberately used when neither source is available.
    wikidata_dimensions = {}

    manifest_artists, artist_by_id = merge_artists(manifest.setdefault("artists", []))
    manifest["artists"] = manifest_artists

    for artwork in existing_artworks:
        title = file_title_from_url(artwork.get("source") or artwork.get("filePage"))
        info = commons.get("File:" + title) if title else None
        dimensions = resolve_dimensions(artwork, info, wikidata_dimensions)
        artwork["physicalWidthCm"] = dimensions[0]
        artwork["physicalHeightCm"] = dimensions[1]

    appended = []
    existing_by_id = {artwork.get("id"): artwork for artwork in existing_artworks}
    for work in NEW_WORKS:
        title = "File:" + work["file"]
        info = commons.get(title)
        if not info or info.get("missing") or not info.get("imageinfo"):
            raise RuntimeError(f"Missing Commons file: {title}")
        image_data = download_image(work, info)
        width, height = resolve_dimensions(work, info, wikidata_dimensions)
        target = existing_by_id.get(work["id"])
        if target is None:
            target = {}
            existing_artworks.append(target)
            existing_by_id[work["id"]] = target
        target.update({
            "id": work["id"],
            "title": work["title"],
            "titleEn": work["titleEn"],
            "artistId": work["artistId"],
            "periodId": work["periodId"],
            "year": work["year"],
            "description": work["description"],
            "image": "/assets/art/" + work["id"] + ".jpg",
            "physicalWidthCm": width,
            "physicalHeightCm": height,
        })
        target.update(image_data)
        appended.append(work["id"])

    manifest["artworks"] = existing_artworks
    manifest["artists"] = manifest_artists
    manifest.setdefault("project", {})["description"] = (
        "沉浸式艺术史科普游戏，从《Arts and Ideas》的宏观脉络出发，"
        "以第一人称3D画廊串联十二个艺术时期与九十余幅公有领域经典画作。"
    )

    with open(MANIFEST_PATH, "w", encoding="utf-8") as manifest_file:
        json.dump(manifest, manifest_file, ensure_ascii=False, indent=2)
        manifest_file.write("\n")

    physical_count = sum(
        1 for artwork in manifest["artworks"]
        if artwork.get("physicalWidthCm") and artwork.get("physicalHeightCm")
    )
    print(f"Manifest written: {len(manifest['artworks'])} artworks, "
          f"{len(manifest['artists'])} artists, {physical_count} with physical dimensions.")
    print("Added:", ", ".join(appended))


if __name__ == "__main__":
    main()





