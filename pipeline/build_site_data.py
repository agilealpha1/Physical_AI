#!/usr/bin/env python3
"""Physical AI Radar の静的サイトを site_dist/ に組み立てる。

  python3 pipeline/build_site_data.py [--out site_dist] [--data data] [--base URL]

site_dist/ は一時ディレクトリで作り、検証が通ってから原子的に差し替える。
GitHub Pages の /Physical_AI/ 配下でも動くよう、サイト側は相対パスだけを使う。
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import html
import io
import json
import os
import shutil
import sys
import zipfile
from email.utils import format_datetime
from xml.sax.saxutils import escape as xesc

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import DATA, DIST, ROOT, SITE, base_url, clean_text, iso_now, log, read_json, read_jsonl, safe_url, write_json
from config import (CATEGORIES, DEFAULT_BASE, INCLUSION, REAL_LABELS, REPRO_LABELS, REPO_URL, SCHEMA_VERSION,
                    SITE_DESC, SITE_NAME, SITE_TAGLINE, SIM_LABELS, STATUS_LABELS, USES)
from validate import run as validate_data

CATEGORY_BY_ID = {c["id"]: c for c in CATEGORIES}
USE_BY_ID = {u["id"]: u for u in USES}
STATIC_FILES = ["index.html", "app.js", "style.css", "vendor/fuse.min.js", "vendor/FUSE_LICENSE"]
CSV_COLUMNS = ["id", "name", "full_name", "category", "category_label", "uses", "use_labels", "summary", "stars", "forks",
               "weekly_gain", "pushed_at", "checked_at", "status", "code_license", "weights_license", "data_license",
               "os", "gpu", "vram", "robot", "simulator", "sim_verification", "real_verification", "repro_verification",
               "github", "paper", "docs"]


def load(data_dir=DATA):
    projects = read_jsonl(os.path.join(data_dir, "projects.jsonl"))
    repos = read_jsonl(os.path.join(data_dir, "repos.jsonl"))
    paths = read_json(os.path.join(data_dir, "paths.json"), []) or []
    history = sorted(read_jsonl(os.path.join(data_dir, "history", "stars.jsonl")), key=lambda h: h["date"])
    meta = read_json(os.path.join(data_dir, "meta.json"), {}) or {}
    return projects, repos, paths, history, meta


def history_index(history):
    series, first = {}, {}
    for h in history:
        for rid, stars in (h.get("stars") or {}).items():
            series.setdefault(str(rid), []).append([h["date"], int(stars)])
            first.setdefault(str(rid), h["date"])
    return series, first


def gain_of(rid, history):
    if len(history) < 2:
        return None
    last, prev = history[-1].get("stars") or {}, history[-2].get("stars") or {}
    rid = str(rid)
    if rid in last and rid in prev:
        return int(last[rid]) - int(prev[rid])
    return None


def availability(p):
    links = p.get("links") or {}
    return {
        "code": bool(links.get("github")),
        "weights": bool(links.get("weights")),
        "data": bool(links.get("data")),
        "paper": bool(p.get("papers")),
        "docs": bool(links.get("docs")),
        "demo": bool(links.get("demo")),
    }


def verification_flags(v):
    return {
        "sim": v.get("sim") == "reported",
        "real": v.get("real") in {"vendor", "third_party", "community"},
        "real_vendor": v.get("real") in {"vendor", "third_party"},
        "repro": v.get("repro") in {"official", "third_party"},
    }


def related_for(item, items, limit=4):
    scored = []
    for o in items:
        if o["id"] == item["id"]:
            continue
        score = 0
        if o["category"] == item["category"]:
            score += 3
        score += 2 * len(set(o["uses"]) & set(item["uses"]))
        score += len(set(o["tags"]) & set(item["tags"]))
        if score:
            scored.append((score, o["stars"], o["id"]))
    scored.sort(reverse=True)
    return [x[2] for x in scored[:limit]]


def paths_for(project_id, paths):
    return [p["id"] for p in paths if any(s.get("project") == project_id for s in p.get("steps") or [])]


def build_index(projects, repos, paths, history, meta, generated_at):
    repo_by_full = {r["full_name"]: r for r in repos}
    series, first_seen = history_index(history)
    items = []
    for p in projects:
        r = repo_by_full[p["full_name"]]
        cat = CATEGORY_BY_ID[p["category"]]
        uses = [u for u in p["uses"] if u in USE_BY_ID]
        v = p["verification"]
        item = {
            "id": p["id"],
            "name": p["name"],
            "full_name": p["full_name"],
            "category": p["category"],
            "category_label": cat["label"],
            "category_color": cat["color"],
            "uses": uses,
            "use_labels": [USE_BY_ID[u]["label"] for u in uses],
            "summary": p["summary"],
            "tags": p["tags"],
            "stars": int(r["stars"]),
            "gain": gain_of(r["id"], history),
            "forks": int(r.get("forks") or 0),
            "created": r.get("created_at") or "",
            "pushed": r.get("pushed_at") or "",
            "checked_at": p.get("checked_at") or "",
            "status": p["status"],
            "status_label": STATUS_LABELS.get(p["status"], p["status"]),
            "featured": bool(p.get("featured")),
            "papers_count": len(p.get("papers") or []),
            "requirements": p["requirements"],
            "verification": {k: v.get(k) for k in ("sim", "real", "repro")},
            "verification_labels": {
                "sim": SIM_LABELS.get(v.get("sim"), "未確認"),
                "real": REAL_LABELS.get(v.get("real"), "未確認"),
                "repro": REPRO_LABELS.get(v.get("repro"), "未確認"),
            },
            "flags": verification_flags(v),
            "availability": availability(p),
            "license_code": (p.get("licenses") or {}).get("code", {}).get("value", "未確認"),
            "archived": bool(r.get("archived")),
            "first_seen": first_seen.get(str(r["id"]), ""),
            "search_text": " ".join([
                p["summary"], p["body"], p["fit"], p["caveat"],
                " ".join(p["tags"]),
                " ".join(USE_BY_ID[u]["label"] for u in p["uses"] if u in USE_BY_ID),
                cat["label"],
                " ".join(x["title"] for x in p.get("papers") or []),
                " ".join(x["value"] for x in p["requirements"].values()),
                SIM_LABELS.get(v.get("sim"), ""), REAL_LABELS.get(v.get("real"), ""),
                REPRO_LABELS.get(v.get("repro"), ""), p["licenses"]["code"]["value"],
            ]),
        }
        items.append(item)
    items.sort(key=lambda x: (-x["stars"], x["name"].lower()))
    for i, x in enumerate(items, 1):
        x["rank"] = i
    return items


def build_details(projects, items, paths, history, repo_by_full):
    by_id = {x["id"]: x for x in items}
    series, _ = history_index(history)
    details = {}
    for p in projects:
        item = by_id[p["id"]]
        related = related_for(item, items)
        details[p["id"]] = {
            **item,
            "body": p["body"],
            "fit": p["fit"],
            "caveat": p["caveat"],
            "why": p["why"],
            "papers": p.get("papers") or [],
            "links": {k: safe_url(v) if v else None for k, v in (p.get("links") or {}).items()},
            "requirements_source": p.get("requirements_source"),
            "license_source": p.get("license_source"),
            "verification": p.get("verification"),
            "licenses": p.get("licenses"),
            "history": series.get(str(repo_by_full[p["full_name"]]["id"]), []),
            "related": related,
            "paths": paths_for(p["id"], paths),
        }
    return details


def _cat_counts(items):
    return {c["id"]: sum(1 for x in items if x["category"] == c["id"]) for c in CATEGORIES}


def _use_counts(items):
    return {u["id"]: sum(1 for x in items if u["id"] in x["uses"]) for u in USES}


def build_stats(items, history, meta, generated_at, repos):
    cats = _cat_counts(items)
    uses = _use_counts(items)
    checked = max((x["checked_at"] for x in items), default="")
    fetched = max((r.get("fetched_at", "") for r in repos), default="")
    return {
        "schema": SCHEMA_VERSION,
        "generated_at": generated_at.isoformat().replace("+00:00", "Z"),
        "data_checked_at": checked,
        "stars_fetched_at": fetched,
        "last_success_at": meta.get("last_success_at") or fetched,
        "snapshot": history[-1]["date"] if history else None,
        "prev_snapshot": history[-2]["date"] if len(history) > 1 else None,
        "snapshots": len(history),
        "gain_ready": len(history) > 1,
        "new_this_week": (sum(1 for x in items if x["first_seen"] == history[-1]["date"]) if len(history) > 1 else None),
        "projects": len(items),
        "categories": len(CATEGORIES),
        "uses": len(USES),
        "total_stars": sum(x["stars"] for x in items),
        "total_forks": sum(x["forks"] for x in items),
        "with_real": sum(1 for x in items if x["flags"]["real"]),
        "with_real_vendor": sum(1 for x in items if x["flags"]["real_vendor"]),
        "with_sim": sum(1 for x in items if x["flags"]["sim"]),
        "with_repro": sum(1 for x in items if x["flags"]["repro"]),
        "with_weights": sum(1 for x in items if x["availability"]["weights"]),
        "with_data": sum(1 for x in items if x["availability"]["data"]),
        "with_papers": sum(1 for x in items if x["availability"]["paper"]),
        "papers": sum(x["papers_count"] for x in items),
        "by_category": cats,
        "by_use": uses,
        "by_status": {s: sum(1 for x in items if x["status"] == s) for s in STATUS_LABELS},
        "categories_meta": CATEGORIES,
        "uses_meta": USES,
        "inclusion": INCLUSION,
        "site": {"name": SITE_NAME, "tagline": SITE_TAGLINE, "description": SITE_DESC, "repo": REPO_URL},
    }


def rss(items, generated_at, base):
    """更新の新しい順に 30 件。サイト再公開ではなく、リポジトリの最終 push を日付に使う。"""
    rows = sorted(items, key=lambda x: x["pushed"] or "", reverse=True)[:30]
    out = ['<?xml version="1.0" encoding="utf-8"?>', '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">', '<channel>',
           f'<title>{xesc(SITE_NAME)}: 新着・更新</title>', f'<link>{xesc(base)}</link>',
           f'<atom:link href="{xesc(base)}feed.xml" rel="self" type="application/rss+xml"/>',
           f'<description>{xesc(SITE_DESC)}</description>', '<language>ja</language>',
           f'<lastBuildDate>{format_datetime(generated_at)}</lastBuildDate>']
    for x in rows:
        try:
            when = dt.datetime.fromisoformat(x["pushed"]).replace(tzinfo=dt.timezone.utc)
        except ValueError:
            when = generated_at
        out += ['<item>',
                f'<title>{xesc(x["name"])} — {xesc(x["category_label"])}</title>',
                f'<link>{xesc(base)}#/p/{xesc(x["id"])}</link>',
                f'<guid isPermaLink="false">physical-ai-radar-{xesc(x["id"])}</guid>',
                f'<pubDate>{format_datetime(when)}</pubDate>',
                f'<category>{xesc(x["category_label"])}</category>',
                f'<description>{xesc(x["summary"])} / ★ {x["stars"]:,} / {xesc(x["full_name"])}</description>',
                '</item>']
    return "\n".join(out + ['</channel>', '</rss>']) + "\n"


def _csv_value(v):
    if isinstance(v, list):
        return ";".join(str(x) for x in v)
    return "" if v is None else str(v)


def data_zip(projects, items, repos, history, paths, generated_at):
    buf, stamp = io.BytesIO(), generated_at.timetuple()[:6]
    by_id = {x["id"]: x for x in items}
    rows = []
    for p in projects:
        x = by_id[p["id"]]
        req = p["requirements"]
        ver = p["verification"]
        lic = p["licenses"]
        rows.append({
            "id": p["id"], "name": p["name"], "full_name": p["full_name"], "category": p["category"],
            "category_label": x["category_label"], "uses": p["uses"], "use_labels": x["use_labels"],
            "summary": p["summary"], "stars": x["stars"], "forks": x["forks"], "weekly_gain": x["gain"],
            "pushed_at": x["pushed"], "checked_at": x["checked_at"], "status": p["status"],
            "code_license": lic["code"]["value"], "weights_license": lic["weights"]["value"],
            "data_license": lic["data"]["value"], "os": req["os"]["value"], "gpu": req["gpu"]["value"],
            "vram": req["vram"]["value"], "robot": req["robot"]["value"], "simulator": req["sim"]["value"],
            "sim_verification": ver["sim"], "real_verification": ver["real"], "repro_verification": ver["repro"],
            "github": p["links"]["github"], "paper": p["links"].get("paper") or "", "docs": p["links"].get("docs") or "",
        })
    s = io.StringIO()
    w = csv.DictWriter(s, CSV_COLUMNS, lineterminator="\n")
    w.writeheader()
    w.writerows([{k: _csv_value(r.get(k)) for k in CSV_COLUMNS} for r in rows])
    files = {
        "physical-ai-radar.csv": s.getvalue(),
        "projects.json": json.dumps(projects, ensure_ascii=False, indent=1),
        "index.json": json.dumps({"generated_at": generated_at.isoformat().replace("+00:00", "Z"), "projects": items}, ensure_ascii=False, indent=1),
        "repos.json": json.dumps(repos, ensure_ascii=False, indent=1),
        "paths.json": json.dumps(paths, ensure_ascii=False, indent=1),
        "stars-history.jsonl": "".join(json.dumps(h, ensure_ascii=False) + "\n" for h in history),
        "LICENSE.txt": (
            "CC0 1.0 Universal (public domain dedication)\n\n"
            "To the extent possible under law, the Physical AI Radar maintainers have waived all copyright and\n"
            "related rights to the curated catalog data in this archive.\n"
            "https://creativecommons.org/publicdomain/zero/1.0/\n\n"
            "Project names, descriptions, README excerpts and model weights belong to their authors.\n"
            "The catalog only organizes public metadata and links; each project keeps its own license.\n"
        ),
        "README.txt": (
            f"Physical AI Radar open data, generated {generated_at:%Y-%m-%d %H:%M} UTC.\n\n"
            f"physical-ai-radar.csv  one row per project ({len(projects)} projects)\n"
            "projects.json          curated fields (summary, requirements, verification, licenses, links)\n"
            "index.json             joined view with GitHub stars/forks and weekly gain\n"
            "repos.json             GitHub metadata snapshot\n"
            "paths.json             learning paths (projects + papers)\n"
            "stars-history.jsonl    one line per weekly snapshot: {week, date, stars: {repo_id: stars}}\n\n"
            "Verification values: sim=reported|not_reported|na|unknown, real=vendor|third_party|community|not_reported|na|unknown,\n"
            "repro=official|third_party|not_reported|na|unknown. 'unknown' is shown as 未確認 on the site; it is never a guess.\n"
        ),
    }
    with zipfile.ZipFile(buf, "w") as z:
        for name, text in files.items():
            zi = zipfile.ZipInfo(name, stamp)
            zi.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(zi, text)
    return buf.getvalue()


def build(out=DIST, data_dir=DATA, base=None, now=None, site_dir=SITE):
    generated_at = now or dt.datetime.now(dt.timezone.utc).replace(microsecond=0)
    base = base_url(base or DEFAULT_BASE)
    errors = validate_data(data_dir)
    if errors:
        raise ValueError("data validation failed:\n" + "\n".join(" - " + e for e in errors))
    projects, repos, paths, history, meta = load(data_dir)
    items = build_index(projects, repos, paths, history, meta, generated_at)
    details = build_details(projects, items, paths, history, {r['full_name']: r for r in repos})
    stats = build_stats(items, history, meta, generated_at, repos)
    paths_payload = []
    by_id = {x["id"]: x for x in items}
    for p in paths:
        paths_payload.append({
            **p,
            "steps": [{**s, "name": by_id[s["project"]]["name"], "summary": by_id[s["project"]]["summary"],
                       "category": by_id[s["project"]]["category"], "stars": by_id[s["project"]]["stars"]}
                      for s in p.get("steps") or []],
        })
    index = {
        "schema": SCHEMA_VERSION,
        "generated_at": generated_at.isoformat().replace("+00:00", "Z"),
        "site": stats["site"],
        "categories": CATEGORIES,
        "uses": USES,
        "projects": items,
    }

    out = os.path.abspath(out)
    tmp = out.rstrip("/") + ".tmp"
    shutil.rmtree(tmp, ignore_errors=True)
    try:
        os.makedirs(os.path.join(tmp, "data", "r"))
        os.makedirs(os.path.join(tmp, "download"))
        os.makedirs(os.path.join(tmp, "vendor"))
        for rel in STATIC_FILES:
            src = os.path.join(site_dir, rel)
            if not os.path.exists(src):
                raise FileNotFoundError(f"missing site asset: {src}")
            dst = os.path.join(tmp, rel)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copy2(src, dst)
        write_json(os.path.join(tmp, "data", "index.json"), index)
        write_json(os.path.join(tmp, "data", "stats.json"), stats)
        write_json(os.path.join(tmp, "data", "paths.json"), paths_payload)
        for pid, detail in details.items():
            write_json(os.path.join(tmp, "data", "r", f"{pid}.json"), detail)
        with open(os.path.join(tmp, "feed.xml"), "w", encoding="utf-8") as f:
            f.write(rss(items, generated_at, base))
        with open(os.path.join(tmp, "robots.txt"), "w", encoding="utf-8") as f:
            f.write("User-agent: *\nAllow: /\n")
        with open(os.path.join(tmp, ".nojekyll"), "w", encoding="utf-8") as f:
            f.write("")
        with open(os.path.join(tmp, "download", "physical-ai-radar-data.zip"), "wb") as f:
            f.write(data_zip(projects, items, repos, history, paths_payload, generated_at))
        validate_build(tmp, set(details), len(projects))
        shutil.rmtree(out, ignore_errors=True)
        os.replace(tmp, out)
        log(f"built {out} ({len(items)} projects, {len(paths_payload)} paths)")
        return items, stats
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def validate_build(out, expected_ids, expected_count):
    required = ["index.html", "app.js", "style.css", ".nojekyll", "feed.xml", "data/index.json", "data/stats.json",
                "data/paths.json", "download/physical-ai-radar-data.zip"]
    for rel in required:
        if not os.path.exists(os.path.join(out, rel)):
            raise ValueError(f"build missing {rel}")
    idx = read_json(os.path.join(out, "data", "index.json"))
    if len(idx.get("projects") or []) != expected_count:
        raise ValueError("index project count mismatch")
    ids = {x["id"] for x in idx["projects"]}
    if ids != expected_ids:
        raise ValueError("index ids do not match details")
    for pid in ids:
        d = read_json(os.path.join(out, "data", "r", f"{pid}.json"))
        if not d or d.get("id") != pid:
            raise ValueError(f"detail missing or mismatched: {pid}")
        for key in ("summary", "body", "requirements", "verification", "licenses"):
            if key not in d:
                raise ValueError(f"detail {pid} missing {key}")
    stats = read_json(os.path.join(out, "data", "stats.json"))
    if stats.get("projects") != expected_count:
        raise ValueError("stats project count mismatch")
    if (stats.get("snapshots", 0) > 1) != bool(stats.get("gain_ready")):
        raise ValueError("stats gain_ready inconsistent")
    return True



def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=DIST)
    ap.add_argument("--data", default=DATA)
    ap.add_argument("--base", default=None)
    ap.add_argument("--site", default=SITE)
    args = ap.parse_args()
    try:
        build(args.out, args.data, args.base, site_dir=args.site)
    except Exception as exc:
        print(f"build failed: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
