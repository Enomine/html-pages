"""Convert a single-file Conan Exiles map HTML (one giant base64 image + inline
Leaflet 0.5) into a tiled, multi-file page for GitHub Pages.

Usage (from repo root):
    python -I tools/build_map.py exiled-lands          # one map from tools/maps.json
    python -I tools/build_map.py --all                 # every map in tools/maps.json

What it does per map:
  * pulls `const DATA={...}` out of the source HTML
  * cuts DATA.mapImage into a 256px tile pyramid  -> <assets>/tiles/{z}/{x}/{y}.jpg
  * writes icon data URIs to files                -> <assets>/icons/<type>.<ext>
  * writes photos embedded in record text to files-> <assets>/img/<hash>.<ext>
  * writes a small HTML that loads vendored Leaflet 1.9 + shared map-app.js

Tile scheme: CRS.Simple with the map's north-west corner at pixel (0,0).  At zoom z
the whole map is (width_units * 2**z) px wide, so zoom 0 == 1 px per map unit.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import io
import json
import math
import os
import re
import sys
import time

from PIL import Image

Image.MAX_IMAGE_PIXELS = None  # the source maps are ~150 Mpx; they are our own files

TILE = 256
EXT = {"image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp", "image/svg+xml": "svg"}
DATA_URI = re.compile(r"data:(image/[a-z0-9+.-]+);base64,([A-Za-z0-9+/=]+)")
SAFE_NAME = re.compile(r"[^A-Za-z0-9_-]")


# ----------------------------------------------------------------------------- tile math
def level_size(units_w: float, units_h: float, z: int) -> tuple[int, int]:
    """Pixel size of the whole map at zoom z."""
    return round(units_w * 2 ** z), round(units_h * 2 ** z)


def tile_grid(px_w: int, px_h: int) -> tuple[int, int]:
    """Number of tiles across / down for a level of the given pixel size."""
    return math.ceil(px_w / TILE), math.ceil(px_h / TILE)


def max_native_zoom(img_w: int, img_h: int, units_w: float, units_h: float) -> int:
    """Highest zoom at which the level is not larger than the source image."""
    return int(math.floor(min(math.log2(img_w / units_w), math.log2(img_h / units_h))))


# ----------------------------------------------------------------------------- extraction
def _scan_object(text: str, start: int) -> int:
    """Return index just past the JS object literal whose '{' is at `start`."""
    depth = 0
    in_str = False
    esc = False
    i = start
    n = len(text)
    while i < n:
        c = text[i]
        if in_str:
            if esc:
                esc = False
            elif c == "\\":
                esc = True
            elif c == '"':
                in_str = False
        else:
            if c == '"':
                in_str = True
            elif c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    return i + 1
        i += 1
    raise ValueError("unterminated DATA object")


def extract_data(html: str) -> dict:
    m = re.search(r"const\s+DATA\s*=\s*\{", html)
    if not m:
        raise ValueError("const DATA={...} not found")
    start = m.end() - 1
    end = _scan_object(html, start)
    return json.loads(html[start:end])


def _decode_uri(mime: str, b64: str) -> tuple[bytes, str]:
    raw = base64.b64decode(b64 + "=" * (-len(b64) % 4))
    return raw, EXT.get(mime, "bin")


def externalize_images(records: list[dict], fields: tuple[str, ...], out_dir: str, url_prefix: str) -> int:
    """Replace data: URIs inside record text fields with files. Returns number of references rewritten."""
    os.makedirs(out_dir, exist_ok=True)
    written: dict[str, str] = {}
    count = 0

    def repl(m: re.Match) -> str:
        nonlocal count
        raw, ext = _decode_uri(m.group(1), m.group(2))
        digest = hashlib.sha1(raw).hexdigest()[:16]
        name = f"{digest}.{ext}"
        if name not in written:
            with open(os.path.join(out_dir, name), "wb") as f:
                f.write(raw)
            written[name] = name
        count += 1
        return f"{url_prefix}/{name}"

    for r in records:
        for field in fields:
            v = r.get(field)
            if isinstance(v, str) and "data:image/" in v:
                r[field] = DATA_URI.sub(repl, v)
    return count


def externalize_icons(icons: dict[str, str], out_dir: str, url_prefix: str) -> dict[str, str]:
    os.makedirs(out_dir, exist_ok=True)
    out: dict[str, str] = {}
    used: set[str] = set()
    for key, uri in icons.items():
        m = DATA_URI.fullmatch(uri or "")
        if not m:
            out[key] = uri  # already a URL (or empty); keep as is
            continue
        raw, ext = _decode_uri(m.group(1), m.group(2))
        base = SAFE_NAME.sub("", key) or "icon"
        if base != key or base in used:
            base = f"{base}-{hashlib.sha1(key.encode()).hexdigest()[:8]}"
        used.add(base)
        name = f"{base}.{ext}"
        with open(os.path.join(out_dir, name), "wb") as f:
            f.write(raw)
        out[key] = f"{url_prefix}/{name}"
    return out


# ----------------------------------------------------------------------------- tiles
def _hex_to_rgb(s: str) -> tuple[int, int, int]:
    s = s.lstrip("#")
    return int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16)


def build_tiles(img: Image.Image, units_w: float, units_h: float, out_dir: str,
                bg=(20, 25, 26), quality: int = 82, log=lambda *a: None) -> dict:
    """Write a tile pyramid for zoom 0..maxNativeZoom. Returns stats."""
    if img.mode != "RGB":
        img = img.convert("RGB")
    native = max_native_zoom(img.width, img.height, units_w, units_h)
    stats = {"maxNativeZoom": native, "tiles": {}, "count": 0, "bytes": 0}
    level = None
    for z in range(native, -1, -1):
        w, h = level_size(units_w, units_h, z)
        t0 = time.time()
        source = img if level is None else level
        level = source.resize((w, h), Image.LANCZOS) if (w, h) != source.size else source
        if source is img:
            img = None  # free the original once the top level exists
        tx, ty = tile_grid(w, h)
        zdir = os.path.join(out_dir, str(z))
        for x in range(tx):
            xdir = os.path.join(zdir, str(x))
            os.makedirs(xdir, exist_ok=True)
            for y in range(ty):
                box = (x * TILE, y * TILE, min((x + 1) * TILE, w), min((y + 1) * TILE, h))
                piece = level.crop(box)
                if piece.size != (TILE, TILE):
                    tile = Image.new("RGB", (TILE, TILE), bg)
                    tile.paste(piece, (0, 0))
                else:
                    tile = piece
                path = os.path.join(xdir, f"{y}.jpg")
                tile.save(path, "JPEG", quality=quality, optimize=True)
                stats["bytes"] += os.path.getsize(path)
                stats["count"] += 1
        stats["tiles"][z] = (tx, ty)
        log(f"  zoom {z}: {w}x{h}px -> {tx}x{ty} tiles ({time.time() - t0:.1f}s)")
    return stats


# ----------------------------------------------------------------------------- html
def _strip_scripts(html: str) -> str:
    return re.sub(r"<script\b[^>]*>.*?</script>", "", html, flags=re.S)


def _replace_first_style(html: str, replacement: str) -> str:
    m = re.search(r"<style\b[^>]*>.*?</style>", html, flags=re.S)
    if not m:
        return html
    return html[: m.start()] + replacement + html[m.end():]


def _js_literal(obj) -> str:
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")


def build(cfg: dict, repo_root: str, vendor: str = "vendor/leaflet-1.9.4", quality: int = 82,
          log=lambda *a: None) -> dict:
    src = cfg["src"]
    html_path = os.path.join(repo_root, cfg["html"])
    assets_path = os.path.join(repo_root, cfg["assets"])
    html_dir = os.path.dirname(html_path)
    assets_rel = os.path.relpath(assets_path, html_dir).replace(os.sep, "/")
    vendor_rel = os.path.relpath(os.path.join(repo_root, vendor), html_dir).replace(os.sep, "/")

    log(f"reading {src}")
    with open(src, encoding="utf-8") as f:
        html = f.read()
    data = extract_data(html)

    # --- map image -> tiles
    (south, west), (north, east) = cfg["bounds"]
    units_w, units_h = east - west, north - south
    m = DATA_URI.fullmatch(data["mapImage"])
    if not m:
        raise ValueError("mapImage is not a base64 data URI")
    raw, _ = _decode_uri(m.group(1), m.group(2))
    img = Image.open(io.BytesIO(raw))
    img.load()
    log(f"map image {img.width}x{img.height}, bounds {units_w}x{units_h} units")
    del data["mapImage"]
    bg = _hex_to_rgb(cfg.get("bg", "#14191a"))
    stats = build_tiles(img, units_w, units_h, os.path.join(assets_path, "tiles"), bg=bg, quality=quality, log=log)
    del img, raw

    # --- icons and in-record photos -> files
    data["icons"] = externalize_icons(data.get("icons", {}), os.path.join(assets_path, "icons"), f"{assets_rel}/icons")
    n_img = externalize_images(data["records"], ("info", "original"), os.path.join(assets_path, "img"), f"{assets_rel}/img")
    log(f"icons: {len(data['icons'])}, record images rewritten: {n_img}")

    # --- html
    config = {
        "tiles": f"{assets_rel}/tiles/{{z}}/{{x}}/{{y}}.jpg",
        "bounds": cfg["bounds"],
        "minZoom": cfg.get("minZoom", 0),
        "maxZoom": cfg.get("maxZoom", 4),
        "maxNativeZoom": stats["maxNativeZoom"],
        "attribution": cfg.get("attribution", ""),
        "coord": cfg.get("coord", {"xScale": 1, "xOffset": 0, "yScale": -1, "yOffset": 0}),
    }
    page = _strip_scripts(html)
    page = _replace_first_style(page, f'<link rel="stylesheet" href="{vendor_rel}/leaflet.css">')
    page = page.replace("</title>", '</title><link rel="icon" href="data:,">', 1)
    page = page.replace("지도·아이콘·설명은 이 파일에 포함되어 있습니다.", "지도 타일과 이미지는 화면에 보이는 부분만 내려받습니다.")
    scripts = (f'<script src="{vendor_rel}/leaflet.js"></script>\n'
               f"<script>const DATA={_js_literal(data)};const CONFIG={_js_literal(config)};</script>\n"
               f'<script src="map-app.js"></script>\n')
    if "</body>" in page:
        page = page.replace("</body>", scripts + "</body>", 1)
    else:
        page += scripts
    os.makedirs(html_dir, exist_ok=True)
    with open(html_path, "w", encoding="utf-8", newline="\n") as f:
        f.write(page)
    log(f"wrote {html_path} ({len(page.encode('utf-8')) / 1e6:.2f} MB), "
        f"{stats['count']} tiles ({stats['bytes'] / 1e6:.1f} MB)")
    return {"html": html_path, "maxNativeZoom": stats["maxNativeZoom"], "tiles": stats["count"],
            "tileBytes": stats["bytes"], "htmlBytes": len(page.encode("utf-8")), "recordImages": n_img}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("names", nargs="*", help="map names from tools/maps.json")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--maps", default=os.path.join(os.path.dirname(__file__), "maps.json"))
    ap.add_argument("--quality", type=int, default=82)
    args = ap.parse_args(argv)
    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    maps = json.load(open(args.maps, encoding="utf-8"))
    names = list(maps) if args.all else args.names
    if not names:
        ap.error("give map names or --all")
    for name in names:
        print(f"== {name}")
        res = build(maps[name], repo_root, quality=args.quality, log=lambda *a: print(*a))
        print(json.dumps(res, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
