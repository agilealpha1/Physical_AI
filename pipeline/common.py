"""共通ユーティリティ。破損した JSON を残さない原子的書き込みを徹底する。"""
from __future__ import annotations

import datetime as dt
import json
import os
import re
import tempfile
from urllib.parse import urlparse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
SITE = os.path.join(ROOT, "site")
DIST = os.path.join(ROOT, "site_dist")


def now_utc() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0)


def iso_now() -> str:
    return now_utc().isoformat().replace("+00:00", "Z")


JST = dt.timezone(dt.timedelta(hours=9))


def today() -> str:
    """サイトの表示・週次スナップショットは日本時間の日付に揃える。"""
    return dt.datetime.now(JST).date().isoformat()


def iso_week(day: dt.date | None = None) -> str:
    d = day or dt.datetime.now(JST).date()
    y, w, _ = d.isocalendar()
    return f"{y}-W{w:02d}"


def read_json(path: str, default=None):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return default


def read_jsonl(path: str) -> list[dict]:
    if not os.path.exists(path):
        return []
    out = []
    with open(path, encoding="utf-8") as f:
        for n, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError as exc:
                raise ValueError(f"{path}:{n}: invalid JSON ({exc})") from exc
    return out


def write_json(path: str, obj, *, indent: int | None = 1) -> None:
    text = json.dumps(obj, ensure_ascii=False, indent=indent, sort_keys=False)
    atomic_write(path, text + "\n")


def write_jsonl(path: str, rows) -> None:
    text = "".join(json.dumps(r, ensure_ascii=False, separators=(",", ":")) + "\n" for r in rows)
    atomic_write(path, text)


def atomic_write(path: str, text: str) -> None:
    os.makedirs(os.path.dirname(os.path.abspath(path)) or ".", exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".tmp-", dir=os.path.dirname(os.path.abspath(path)))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(text)
            f.flush()
            os.fsync(f.fileno())
        os.chmod(tmp, 0o644)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def safe_url(value) -> str | None:
    """許可するのは http(s) のみ。javascript: や data: を通さない。"""
    if not isinstance(value, str):
        return None
    value = value.strip()
    if not value or len(value) > 2000:
        return None
    try:
        p = urlparse(value)
    except ValueError:
        return None
    if p.scheme not in ("http", "https") or not p.netloc:
        return None
    return value


def clean_text(value, limit: int = 4000) -> str:
    if not isinstance(value, str):
        return ""
    value = re.sub(r"\s+", " ", value).strip()
    return value[:limit]


def slug_ok(value: str) -> bool:
    return bool(re.fullmatch(r"[a-z0-9][a-z0-9-]{1,80}", value or ""))


def base_url(value: str | None = None) -> str:
    raw = (value or os.environ.get("PA_BASE_URL") or "https://agilealpha1.github.io/Physical_AI/").strip()
    if not raw.endswith("/"):
        raw += "/"
    p = urlparse(raw)
    if p.scheme not in ("http", "https") or not p.netloc:
        raise ValueError(f"invalid base URL: {raw}")
    return raw


def log(msg: str) -> None:
    print(msg, flush=True)
