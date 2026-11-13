import copy
import os
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "pipeline"))
from common import read_json, read_jsonl, safe_url  # noqa: E402
from validate import run, validate  # noqa: E402


class ValidateTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.projects = read_jsonl(os.path.join(ROOT, "data", "projects.jsonl"))
        cls.repos = read_jsonl(os.path.join(ROOT, "data", "repos.jsonl"))
        cls.paths = read_json(os.path.join(ROOT, "data", "paths.json"))
        cls.history = read_jsonl(os.path.join(ROOT, "data", "history", "stars.jsonl"))

    def test_committed_data_is_valid(self):
        self.assertEqual(run(), [])

    def test_rejects_bad_category(self):
        p = copy.deepcopy(self.projects)
        p[0]["category"] = "not-a-category"
        errors = []
        validate(p, self.repos, self.paths, self.history, errors)
        self.assertTrue(any("invalid category" in e for e in errors))

    def test_rejects_unsafe_url(self):
        p = copy.deepcopy(self.projects)
        p[0]["links"]["github"] = "javascript:alert(1)"
        errors = []
        validate(p, self.repos, self.paths, self.history, errors)
        self.assertTrue(any("unsafe" in e for e in errors))
        self.assertIsNone(safe_url("javascript:alert(1)"))
        self.assertIsNone(safe_url("data:text/html,x"))
        self.assertEqual(safe_url("https://example.com/a"), "https://example.com/a")

    def test_rejects_unknown_path_project(self):
        paths = copy.deepcopy(self.paths)
        paths[0]["steps"][0]["project"] = "does-not-exist"
        errors = []
        validate(self.projects, self.repos, paths, self.history, errors)
        self.assertTrue(any("unknown project" in e for e in errors))

    def test_requires_evidence(self):
        p = copy.deepcopy(self.projects)
        p[0]["verification"]["evidence"] = []
        errors = []
        validate(p, self.repos, self.paths, self.history, errors)
        self.assertTrue(any("evidence" in e for e in errors))


if __name__ == "__main__":
    unittest.main()
