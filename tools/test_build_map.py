"""Tests for build_map.py (run: python -I -m unittest tools.test_build_map  from repo root)."""
import base64
import io
import json
import os
import shutil
import tempfile
import unittest

from PIL import Image

from tools import build_map as bm


def _png_data_uri(w, h, color):
    img = Image.new("RGB", (w, h), color)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def _jpeg_bytes(w, h, color):
    img = Image.new("RGB", (w, h), color)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=95)
    return buf.getvalue()


class TileMath(unittest.TestCase):
    def test_level_size(self):
        self.assertEqual(bm.level_size(1500, 1531.25, 3), (12000, 12250))
        self.assertEqual(bm.level_size(1500, 1531.25, 0), (1500, 1531))

    def test_tile_grid(self):
        self.assertEqual(bm.tile_grid(12000, 12250), (47, 48))
        self.assertEqual(bm.tile_grid(1500, 1531), (6, 6))
        self.assertEqual(bm.tile_grid(256, 256), (1, 1))

    def test_max_native_zoom(self):
        self.assertEqual(bm.max_native_zoom(12288, 12544, 1500, 1531.25), 3)
        self.assertEqual(bm.max_native_zoom(2001, 1976, 900, 900), 1)
        self.assertEqual(bm.max_native_zoom(600, 612, 300, 306), 1)


class Extraction(unittest.TestCase):
    def test_extract_data_object(self):
        html = '<script>x</script><script>const DATA={"a":[1,{"b":"}"}],"c":"\\"{"};const y=1;</script>'
        self.assertEqual(bm.extract_data(html), {"a": [1, {"b": "}"}], "c": '"{'})

    def test_externalize_images_rewrites_and_dedupes(self):
        tmp = tempfile.mkdtemp()
        try:
            uri = _png_data_uri(4, 4, (255, 0, 0))
            records = [
                {"info": f'<a href="{uri}"><img src="{uri}"></a>', "original": "plain"},
                {"info": "none", "original": f'<img src="{uri}">'},
            ]
            n = bm.externalize_images(records, ("info", "original"), os.path.join(tmp, "img"), "assets/img")
            files = os.listdir(os.path.join(tmp, "img"))
            self.assertEqual(len(files), 1)  # same bytes -> one file
            self.assertEqual(n, 3)  # three references rewritten
            self.assertNotIn("data:image", records[0]["info"])
            self.assertIn(f'src="assets/img/{files[0]}"', records[0]["info"])
            self.assertIn(f'src="assets/img/{files[0]}"', records[1]["original"])
            self.assertEqual(records[1]["info"], "none")
        finally:
            shutil.rmtree(tmp)

    def test_externalize_icons(self):
        tmp = tempfile.mkdtemp()
        try:
            icons = {"city": _png_data_uri(2, 2, (0, 255, 0)), "Weird/Type": _png_data_uri(2, 2, (0, 0, 255))}
            out = bm.externalize_icons(icons, os.path.join(tmp, "icons"), "assets/icons")
            self.assertEqual(out["city"], "assets/icons/city.png")
            self.assertTrue(out["Weird/Type"].startswith("assets/icons/"))
            self.assertNotIn("/", out["Weird/Type"][len("assets/icons/"):])
            self.assertEqual(len(os.listdir(os.path.join(tmp, "icons"))), 2)
        finally:
            shutil.rmtree(tmp)


class Tiles(unittest.TestCase):
    def test_build_tiles_small(self):
        tmp = tempfile.mkdtemp()
        try:
            # 600x612 image, map units 300x306 -> native zoom 1 (600px), zoom 0 = 300px
            src = Image.new("RGB", (600, 612), (10, 20, 30))
            src.paste((200, 100, 50), (0, 0, 16, 16))  # a block survives JPEG, a lone pixel would not
            stats = bm.build_tiles(src, 300, 306, os.path.join(tmp, "tiles"), bg=(1, 2, 3), quality=95)
            self.assertEqual(stats["maxNativeZoom"], 1)
            self.assertEqual(stats["tiles"][1], (3, 3))
            self.assertEqual(stats["tiles"][0], (2, 2))
            self.assertEqual(stats["count"], 9 + 4)
            t = Image.open(os.path.join(tmp, "tiles", "1", "0", "0.jpg"))
            self.assertEqual(t.size, (256, 256))
            r, g, b = t.getpixel((0, 0))
            self.assertGreater(r, 150)  # the marked source pixel survived
            edge = Image.open(os.path.join(tmp, "tiles", "1", "2", "2.jpg"))
            self.assertEqual(edge.size, (256, 256))
            r, g, b = edge.getpixel((255, 255))
            self.assertLess(r, 15)  # padded with bg color, not stretched
            self.assertTrue(os.path.exists(os.path.join(tmp, "tiles", "0", "1", "1.jpg")))
        finally:
            shutil.rmtree(tmp)


class EndToEnd(unittest.TestCase):
    def test_build_writes_html_and_assets(self):
        tmp = tempfile.mkdtemp()
        try:
            map_uri = "data:image/jpeg;base64," + base64.b64encode(_jpeg_bytes(600, 612, (10, 20, 30))).decode()
            icon = _png_data_uri(2, 2, (0, 255, 0))
            photo = _png_data_uri(3, 3, (9, 9, 9))
            data = {
                "records": [{"en": "A", "ko": "가", "type": "city", "layer": "City", "lat": -1, "lng": 1,
                             "info": f'<img src="{photo}">', "original": "", "coords": ""}],
                "groups": [{"name": "g", "types": ["City"]}],
                "labels": {"City": "도시"},
                "icons": {"city": icon},
                "mapImage": map_uri,
                "defaultTypes": ["City"],
            }
            src_html = ("<!doctype html><html><head><title>T</title><style>/* leaflet */.x{}</style>"
                        "<style>.app{}</style></head><body><header>h</header><div id=\"map\"></div>"
                        "<footer>지도·아이콘·설명은 이 파일에 포함되어 있습니다. 링크.</footer>"
                        "<script>/*leaflet*/</script><script>const DATA=" + json.dumps(data, ensure_ascii=False)
                        + ";const map=1;</script></body></html>")
            src_path = os.path.join(tmp, "src.html")
            with open(src_path, "w", encoding="utf-8") as f:
                f.write(src_html)
            cfg = {
                "src": src_path,
                "html": "ConanExile/test-ko.html",
                "assets": "ConanExile/test",
                "bounds": [[-306, 0], [0, 300]],
                "minZoom": -2, "maxZoom": 3,
                "attribution": "attr",
                "coord": {"xScale": 1, "xOffset": 0, "yScale": -1, "yOffset": 0},
            }
            out = bm.build(cfg, repo_root=tmp, vendor="vendor/leaflet-1.9.4", quality=95)
            html_path = os.path.join(tmp, "ConanExile", "test-ko.html")
            self.assertTrue(os.path.exists(html_path))
            with open(html_path, encoding="utf-8") as f:
                html = f.read()
            self.assertNotIn("data:image", html)
            self.assertNotIn("/* leaflet */", html)
            self.assertIn(".app{}", html)
            self.assertIn('href="../vendor/leaflet-1.9.4/leaflet.css"', html)
            self.assertIn('src="../vendor/leaflet-1.9.4/leaflet.js"', html)
            self.assertIn('src="map-app.js"', html)
            self.assertNotIn("이 파일에 포함되어 있습니다", html)
            self.assertLess(len(html), 20000)
            self.assertEqual(out["maxNativeZoom"], 1)
            self.assertTrue(os.path.exists(os.path.join(tmp, "ConanExile", "test", "tiles", "1", "0", "0.jpg")))
            self.assertTrue(os.path.exists(os.path.join(tmp, "ConanExile", "test", "icons", "city.png")))
            self.assertEqual(len(os.listdir(os.path.join(tmp, "ConanExile", "test", "img"))), 1)
            # embedded CONFIG is valid and points at the tiles relative to the html
            cfg_json = html.split("const CONFIG=", 1)[1].split(";</script>", 1)[0]
            config = json.loads(cfg_json)
            self.assertEqual(config["tiles"], "test/tiles/{z}/{x}/{y}.jpg")
            self.assertEqual(config["maxNativeZoom"], 1)
            self.assertEqual(config["bounds"], [[-306, 0], [0, 300]])
            data_json = html.split("const DATA=", 1)[1].split(";const CONFIG=", 1)[0]
            d = json.loads(data_json)
            self.assertNotIn("mapImage", d)
            self.assertEqual(d["icons"]["city"], "test/icons/city.png")
            self.assertIn('src="test/img/', d["records"][0]["info"])
        finally:
            shutil.rmtree(tmp)


if __name__ == "__main__":
    unittest.main()
