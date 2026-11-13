#!/usr/bin/env python3
"""キュレーションデータの検証。失敗したらビルドを止める。"""
from __future__ import annotations

import argparse
import os
import sys
from urllib.parse import urlparse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import DATA, read_json, read_jsonl, safe_url, slug_ok
from config import CATEGORIES, STATUS_LABELS, USES

CATEGORY_IDS = {c["id"] for c in CATEGORIES}
USE_IDS = {u["id"] for u in USES}
REQ_KEYS = ("os", "gpu", "vram", "robot", "sim", "runtime")
REQ_STATUS = {"official", "community", "unknown", "na"}
VERIFY_STATUS = {
    "sim": {"reported", "not_reported", "na", "unknown"},
    "real": {"vendor", "third_party", "community", "not_reported", "na", "unknown"},
    "repro": {"official", "third_party", "not_reported", "na", "unknown"},
}


def validate(projects, repos, paths, history, errors):
    ids, fulls = set(), set()
    repo_names = {r.get("full_name") for r in repos}
    for p in projects:
        pid = p.get("id")
        if not slug_ok(pid or ""):
            errors.append(f"project id is not URL-safe: {pid!r}")
            continue
        if pid in ids:
            errors.append(f"duplicate project id: {pid}")
        ids.add(pid)

        full = p.get("full_name")
        if not isinstance(full, str) or "/" not in full:
            errors.append(f"{pid}: full_name must be owner/name")
        elif full in fulls:
            errors.append(f"{pid}: duplicate full_name {full}")
        elif full not in repo_names:
            errors.append(f"{pid}: {full} is missing from data/repos.jsonl")
        fulls.add(full)

        if p.get("category") not in CATEGORY_IDS:
            errors.append(f"{pid}: invalid category {p.get('category')!r}")
        uses = p.get("uses")
        if not isinstance(uses, list) or not uses:
            errors.append(f"{pid}: uses must be a non-empty list")
        elif any(u not in USE_IDS for u in uses):
            errors.append(f"{pid}: invalid uses {[u for u in uses if u not in USE_IDS]}")
        if p.get("status") not in STATUS_LABELS:
            errors.append(f"{pid}: invalid status {p.get('status')!r}")

        for field in ("name", "summary", "body", "fit", "caveat", "why"):
            v = p.get(field)
            if not isinstance(v, str) or not v.strip():
                errors.append(f"{pid}: {field} is empty")
        for field in ("summary", "body"):
            if len(p.get(field) or "") > 1200:
                errors.append(f"{pid}: {field} is too long")

        if not isinstance(p.get("tags"), list) or not p.get("tags"):
            errors.append(f"{pid}: tags must be a non-empty list")

        links = p.get("links") or {}
        for key in ("github", "docs", "paper", "weights", "data", "demo"):
            u = links.get(key)
            if u is not None and not safe_url(u):
                errors.append(f"{pid}: unsafe or invalid link {key}={u!r}")
        if not links.get("github"):
            errors.append(f"{pid}: links.github is required")

        papers = p.get("papers")
        if not isinstance(papers, list):
            errors.append(f"{pid}: papers must be a list")
            papers = []
        for i, paper in enumerate(papers):
            if not isinstance(paper, dict) or not paper.get("title"):
                errors.append(f"{pid}: paper[{i}] needs a title")
                continue
            if not safe_url(paper.get("url")):
                errors.append(f"{pid}: paper[{i}] has an invalid URL")
            if not re_arxiv(paper.get("url")):
                errors.append(f"{pid}: paper[{i}] should point to arxiv.org/abs/")

        req = p.get("requirements")
        if not isinstance(req, dict):
            errors.append(f"{pid}: requirements must be an object")
            req = {}
        for key in REQ_KEYS:
            item = req.get(key)
            if not isinstance(item, dict) or not str(item.get("value", "")).strip():
                errors.append(f"{pid}: requirements.{key} is missing a value")
                continue
            if item.get("status") not in REQ_STATUS:
                errors.append(f"{pid}: requirements.{key} has invalid status {item.get('status')!r}")
            if item.get("status") == "official" and item.get("value") == "未確認":
                errors.append(f"{pid}: requirements.{key} cannot be official and 未確認")
        if not safe_url(p.get("requirements_source")):
            errors.append(f"{pid}: requirements_source is invalid")
        if not safe_url(p.get("license_source")):
            errors.append(f"{pid}: license_source is invalid")

        ver = p.get("verification") or {}
        for key, allowed in VERIFY_STATUS.items():
            if ver.get(key) not in allowed:
                errors.append(f"{pid}: verification.{key} has invalid status {ver.get(key)!r}")
        ev = ver.get("evidence")
        if not isinstance(ev, list) or not ev:
            errors.append(f"{pid}: verification.evidence must not be empty")
        else:
            for i, item in enumerate(ev):
                if not isinstance(item, dict) or not item.get("label") or not safe_url(item.get("url")):
                    errors.append(f"{pid}: verification.evidence[{i}] is invalid")

        licenses = p.get("licenses") or {}
        for key in ("code", "weights", "data"):
            item = licenses.get(key)
            if not isinstance(item, dict) or not str(item.get("value", "")).strip():
                errors.append(f"{pid}: licenses.{key} is missing a value")
            elif item.get("status") not in {"official", "varies", "unknown", "na"}:
                errors.append(f"{pid}: licenses.{key} has invalid status {item.get('status')!r}")

        checked = p.get("checked_at")
        if not isinstance(checked, str) or len(checked) != 10:
            errors.append(f"{pid}: checked_at must be YYYY-MM-DD")

    # repos metadata
    for r in repos:
        if not isinstance(r.get("id"), int):
            errors.append(f"repo {r.get('full_name')}: id must be an integer")
        if not isinstance(r.get("stars"), int) or r["stars"] < 0:
            errors.append(f"repo {r.get('full_name')}: stars must be a non-negative integer")
        if not safe_url(r.get("html_url")):
            errors.append(f"repo {r.get('full_name')}: html_url is invalid")
        if not isinstance(r.get("pushed_at"), str) or len(r["pushed_at"]) != 10:
            errors.append(f"repo {r.get('full_name')}: pushed_at must be YYYY-MM-DD")

    # paths
    path_ids = set()
    for path in paths:
        pid = path.get("id")
        if not slug_ok(pid or ""):
            errors.append(f"path id is not URL-safe: {pid!r}")
        if pid in path_ids:
            errors.append(f"duplicate path id: {pid}")
        path_ids.add(pid)
        if not path.get("title"):
            errors.append(f"path {pid}: title is empty")
        steps = path.get("steps")
        if not isinstance(steps, list) or len(steps) < 2:
            errors.append(f"path {pid}: needs at least two steps")
            continue
        seen = set()
        for i, step in enumerate(steps):
            if not isinstance(step, dict) or step.get("project") not in ids:
                errors.append(f"path {pid}: step[{i}] references an unknown project")
            elif step["project"] in seen:
                errors.append(f"path {pid}: duplicate project {step['project']}")
            seen.add(step.get("project"))
            if not step.get("why"):
                errors.append(f"path {pid}: step[{i}] needs a why")
        for i, paper in enumerate(path.get("papers") or []):
            if not safe_url(paper.get("url")):
                errors.append(f"path {pid}: paper[{i}] has an invalid URL")

    # history
    for h in history:
        if not isinstance(h.get("stars"), dict):
            errors.append(f"history {h.get('date')}: stars must be an object")
        if not h.get("date") or not h.get("week"):
            errors.append("history entry needs week and date")
    return errors


def re_arxiv(url) -> bool:
    if not url:
        return False
    try:
        p = urlparse(url)
    except ValueError:
        return False
    return p.netloc in {"arxiv.org", "www.arxiv.org", "export.arxiv.org"} and p.path.startswith("/abs/")


def run(data_dir=DATA) -> list[str]:
    projects = read_jsonl(os.path.join(data_dir, "projects.jsonl"))
    repos = read_jsonl(os.path.join(data_dir, "repos.jsonl"))
    paths = read_json(os.path.join(data_dir, "paths.json"), []) or []
    history = read_jsonl(os.path.join(data_dir, "history", "stars.jsonl"))
    errors: list[str] = []
    validate(projects, repos, paths, history, errors)
    return errors


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default=DATA)
    args = ap.parse_args()
    errors = run(args.data)
    if errors:
        print(f"validation failed: {len(errors)} error(s)", file=sys.stderr)
        for e in errors:
            print(" - " + e, file=sys.stderr)
        return 1
    print("validation ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
