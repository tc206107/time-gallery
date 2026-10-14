import json
import os
import sys
import time
import urllib.parse
import urllib.request

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ART_DIR = os.path.join(ROOT, "public", "assets", "art")
UA = "TimeGalleryBuild/1.0 (offline-public-domain-assets)"

MISSING = {
    "u02": "NY Met demuth figure 5 gold.JPG",
    "u03": "Portrait of a German Officer, Marsden Hartley.jpg",
    "u04": "Goin' Fishin', by Arthur G. Dove.jpg",
    "u05": "John Marin Lower Manhattan, 1920.jpg",
    "u06": "Joseph Stella, 1919-20, Brooklyn Bridge, oil on canvas, 215.3 x 194.6 cm, Yale University Art Gallery.jpg",
    "u07": "Gelmeroda-chapel.jpg",
}


def http_get(url, timeout=90):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def main():
    os.makedirs(ART_DIR, exist_ok=True)
    for art_id, file_name in MISSING.items():
        dest = os.path.join(ART_DIR, art_id + ".jpg")
        if os.path.exists(dest):
            print(art_id, "already exists")
            continue
        endpoint = "https://commons.wikimedia.org/w/rest.php/v1/file/File:" + urllib.parse.quote(file_name)
        info = json.loads(http_get(endpoint).decode("utf-8"))
        url = info["preferred"]["url"]
        raw = http_get(url)
        with open(dest, "wb") as f:
            f.write(raw)
        print(art_id, "downloaded", len(raw), "bytes", flush=True)
        time.sleep(1.5)


if __name__ == "__main__":
    main()
