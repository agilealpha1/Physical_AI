#!/usr/bin/env python3
"""GitHub メタデータを更新し、週次のスタースナップショットを追記する。

  GITHUB_TOKEN=... python3 pipeline/refresh.py
  python3 pipeline/refresh.py --dry-run

キュレーション済みの data/projects.jsonl は変更しない。更新するのは
data/repos.jsonl / data/history/stars.jsonl / data/meta.json だけ。
"""
from __future__ import annotations

import argparse
import datetime as dt
import math
import os
import sys
import time

import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import DATA, iso_now, iso_week, log, read_json, read_jsonl, today, write_json, write_jsonl

API = "https://api.github.com/repos/{full}"
UA = "physical-ai-radar/1.0 (+https://github.com/agilealpha1/Physical_AI)"
MIN_SUCCESS_RATIO = 0.80


class RepoGone(Exception):
    pass


def fetch_one(session: requests.Session, full: str, token: str | None, retries: int = 3) -> dict:
    headers = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": UA}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    last = None
    for attempt in range(retries):
        try:
            r = session.get(API.format(full=full), headers=headers, timeout=25)
        except requests.RequestException as exc:
            last = exc
            time.sleep(1.5 * (attempt + 1))
            continue
        if r.status_code == 200:
            return r.json()
        if r.status_code == 404:
            raise RepoGone(f"{full}: 404")
        if r.status_code in (403, 429):
            reset = r.headers.get("X-RateLimit-Reset")
            last = RuntimeError(f"{full}: HTTP {r.status_code} rate limit (reset={reset})")
            if attempt + 1 < retries:
                time.sleep(min(20, 2 ** attempt * 3))
                continue
        if r.status_code >= 500:
            last = RuntimeError(f"{full}: HTTP {r.status_code}")
            time.sleep(1.5 * (attempt + 1))
            continue
        raise RuntimeError(f"{full}: HTTP {r.status_code} {r.text[:200]}")
    raise RuntimeError(str(last) if last else f"{full}: unknown error")


def normalize(d: dict, full: str, fetched_at: str) -> dict:
    lic = d.get("license") or {}
    return {
        "id": int(d["id"]),
        "full_name": full,
        "github_full_name": d.get("full_name") or full,
        "html_url": d.get("html_url") or f"https://github.com/{full}",
        "description": d.get("description"),
        "homepage": d.get("homepage"),
        "stars": int(d.get("stargazers_count") or 0),
        "forks": int(d.get("forks_count") or 0),
        "open_issues": int(d.get("open_issues_count") or 0),
        "created_at": (d.get("created_at") or "")[:10],
        "pushed_at": (d.get("pushed_at") or "")[:10],
        "archived": bool(d.get("archived")),
        "topics": [t for t in (d.get("topics") or []) if isinstance(t, str)][:20],
        "license": lic.get("spdx_id"),
        "default_branch": d.get("default_branch"),
        "fetched_at": fetched_at,
    }


def upsert_history(history: list[dict], date: str, stars: dict[str, int], week: str | None = None) -> list[dict]:
    """同じ ISO 週のスナップショットは置き換える（再実行しても行が増えない）。"""
    week = week or iso_week(dt.date.fromisoformat(date))
    row = {"week": week, "date": date, "stars": {str(k): int(v) for k, v in stars.items()}}
    out = [h for h in history if h.get("week") != week]
    out.append(row)
    out.sort(key=lambda h: h.get("date", ""))
    return out


def shrink_ok(previous: int, success: int, force: bool = False) -> bool:
    if force or previous <= 0:
        return True
    return success >= max(1, math.ceil(previous * MIN_SUCCESS_RATIO))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default=DATA)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--force", action="store_true", help="allow a >20% shrink (use only for intentional removals)")
    ap.add_argument("--token", default=os.environ.get("GITHUB_TOKEN"))
    ap.add_argument("--sleep", type=float, default=0.05)
    args = ap.parse_args()

    projects = read_jsonl(os.path.join(args.data, "projects.jsonl"))
    previous = read_jsonl(os.path.join(args.data, "repos.jsonl"))
    if not projects:
        print("no data/projects.jsonl", file=sys.stderr)
        return 1
    old_by_full = {r.get("full_name"): r for r in previous}
    prev_count = len(previous)
    fetched_at = iso_now()
    session = requests.Session()
    rows, failures, gone = [], [], []
    success = 0
    for i, p in enumerate(projects, 1):
        full = p["full_name"]
        try:
            d = fetch_one(session, full, args.token)
            row = normalize(d, full, fetched_at)
            rows.append(row)
            success += 1
            log(f"[{i:02d}/{len(projects)}] {full:<42} ★ {row['stars']:,}")
        except RepoGone as exc:
            gone.append(str(exc))
            log(f"[{i:02d}/{len(projects)}] GONE {full}")
            if full in old_by_full:
                rows.append(old_by_full[full])
        except Exception as exc:  # network / rate limit: keep old metadata for this repo
            failures.append(f"{full}: {exc}")
            log(f"[{i:02d}/{len(projects)}] FAIL {full}: {exc}")
            if full in old_by_full:
                rows.append(old_by_full[full])
        if args.sleep:
            time.sleep(args.sleep)

    if not shrink_ok(prev_count, success, args.force):
        print(f"refresh aborted: only {success}/{prev_count} repos fetched (guard {MIN_SUCCESS_RATIO:.0%})", file=sys.stderr)
        return 2
    have = {r.get("full_name") for r in rows}
    missing = [p["full_name"] for p in projects if p["full_name"] not in have]
    if missing:
        print(f"refresh aborted: no metadata for {len(missing)} repo(s): {', '.join(missing[:5])}", file=sys.stderr)
        return 2

    # If the whole request failed, preserve the previous stars for the weekly snapshot.
    old_stars = {}
    hist_path = os.path.join(args.data, "history", "stars.jsonl")
    history = read_jsonl(hist_path)
    if history:
        old_stars = {str(k): int(v) for k, v in (history[-1].get("stars") or {}).items()}
    stars = dict(old_stars)
    for r in rows:
        stars[str(r["id"])] = int(r["stars"])
    new_history = upsert_history(history, today(), stars)
    ratio = success / max(1, len(projects))
    previous_meta = read_json(os.path.join(args.data, "meta.json"), {}) or {}
    meta = {
        "schema": 1,
        "last_success_at": fetched_at if ratio >= 0.9 else previous_meta.get("last_success_at"),
        "snapshot": today(),
        "repos": len(rows),
        "updated_repos": success,
        "failed_repos": len(failures) + len(gone),
        "source": "GitHub REST API",
    }

    if args.dry_run:
        log(f"dry-run: would write {len(rows)} repos, {len(failures) + len(gone)} failures, snapshot {today()}")
        return 0
    write_jsonl(os.path.join(args.data, "repos.jsonl"), rows)
    write_jsonl(hist_path, new_history)
    write_json(os.path.join(args.data, "meta.json"), meta)
    log(f"updated {len(rows)} repos, {len(failures) + len(gone)} failures, snapshot {today()}")
    if failures or gone:
        for x in failures + gone:
            log("  warning: " + x)
        return 0
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
