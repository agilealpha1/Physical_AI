import datetime as dt
import os
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "pipeline"))
from refresh import normalize, shrink_ok, upsert_history  # noqa: E402


class RefreshTest(unittest.TestCase):
    def test_same_week_replaces(self):
        h = [{"week": "2026-W45", "date": "2026-11-07", "stars": {"1": 10}}]
        out = upsert_history(h, "2026-11-14", {"1": 12, "2": 3})
        self.assertEqual(len(out), 2)
        self.assertEqual(out[-1]["stars"], {"1": 12, "2": 3})
        out2 = upsert_history(out, "2026-11-14", {"1": 13})
        self.assertEqual(len(out2), 2)
        self.assertEqual(out2[-1]["stars"], {"1": 13})

    def test_shrink_guard(self):
        self.assertTrue(shrink_ok(0, 0))
        self.assertTrue(shrink_ok(47, 38))
        self.assertFalse(shrink_ok(47, 37))
        self.assertTrue(shrink_ok(47, 0, force=True))

    def test_normalize(self):
        d = {
            "id": 1, "full_name": "a/b", "html_url": "https://github.com/a/b", "description": "x",
            "homepage": "", "stargazers_count": 5, "forks_count": 2, "open_issues_count": 1,
            "created_at": "2020-01-01T00:00:00Z", "pushed_at": "2026-01-02T00:00:00Z",
            "archived": False, "topics": ["robot"], "license": {"spdx_id": "MIT"}, "default_branch": "main",
        }
        r = normalize(d, "a/b", "2026-11-13T00:00:00Z")
        self.assertEqual(r["stars"], 5)
        self.assertEqual(r["license"], "MIT")
        self.assertEqual(r["pushed_at"], "2026-01-02")
        self.assertEqual(r["topics"], ["robot"])


if __name__ == "__main__":
    unittest.main()
