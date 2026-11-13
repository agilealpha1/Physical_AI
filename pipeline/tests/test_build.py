import datetime as dt
import json
import os
import sys
import tempfile
import unittest
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "pipeline"))
from build_site_data import build  # noqa: E402
from common import read_json  # noqa: E402


class BuildTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.out = os.path.join(cls.tmp.name, "site_dist")
        cls.now = dt.datetime(2026, 11, 13, 21, 10, tzinfo=dt.timezone.utc)
        cls.items, cls.stats = build(cls.out, base="https://example.com/Physical_AI/", now=cls.now)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_index_and_details(self):
        idx = read_json(os.path.join(self.out, "data", "index.json"))
        self.assertEqual(len(idx["projects"]), 47)
        self.assertEqual(len({p["id"] for p in idx["projects"]}), 47)
        for p in idx["projects"]:
            d = read_json(os.path.join(self.out, "data", "r", p["id"] + ".json"))
            self.assertEqual(d["id"], p["id"])
            self.assertIn("requirements", d)
            self.assertIn("licenses", d)
            self.assertIn("verification", d)
            self.assertIsInstance(d["history"], list)

    def test_stats_and_gain(self):
        st = read_json(os.path.join(self.out, "data", "stats.json"))
        self.assertEqual(st["projects"], 47)
        self.assertEqual(st["categories"], 5)
        self.assertEqual(st["snapshots"], 1)
        self.assertFalse(st["gain_ready"])
        self.assertIsNone(st["new_this_week"])
        first = self.items[0]
        self.assertIsNone(first["gain"])
        self.assertTrue(first["stars"] > 0)

    def test_rss_and_open_data(self):
        with open(os.path.join(self.out, "feed.xml"), encoding="utf-8") as f:
            feed = f.read()
        self.assertIn("<rss", feed)
        self.assertIn("https://example.com/Physical_AI/feed.xml", feed)
        self.assertIn("Physical AI Radar", feed)
        zpath = os.path.join(self.out, "download", "physical-ai-radar-data.zip")
        with zipfile.ZipFile(zpath) as z:
            names = set(z.namelist())
            self.assertIn("physical-ai-radar.csv", names)
            self.assertIn("projects.json", names)
            self.assertIn("stars-history.jsonl", names)
            self.assertIn("paths.json", names)
            self.assertIn("LICENSE.txt", names)

    def test_paths_resolve(self):
        paths = read_json(os.path.join(self.out, "data", "paths.json"))
        ids = {p["id"] for p in self.items}
        self.assertGreaterEqual(len(paths), 4)
        for path in paths:
            for step in path["steps"]:
                self.assertIn(step["project"], ids)
                self.assertIn("name", step)

    def test_no_unsafe_links(self):
        for p in self.items:
            self.assertTrue(p["full_name"])
            self.assertTrue(p["category"])
            self.assertTrue(p["summary"])


if __name__ == "__main__":
    unittest.main()
