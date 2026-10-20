from __future__ import annotations

import os
from pathlib import Path
from typing import Dict, List

import requests

TARGETS = (
    ("Areas", "database", "NOTION_AREAS_DB"),
    ("Projects", "database", "NOTION_PROJECTS_DB"),
    ("Tasks", "database", "NOTION_TASKS_DB"),
    ("Recurring Tasks", "database", "NOTION_RECURRING_DB"),
    ("Daily Task Dump", "page", "NOTION_DAILY_DUMP_PAGE"),
)
# The Areas database is titled Goals, and the Tasks database is titled Active Tasks.
TITLE_ALIASES = {
    "NOTION_AREAS_DB": ("areas", "goals"),
    "NOTION_PROJECTS_DB": ("projects",),
    "NOTION_TASKS_DB": ("tasks", "active tasks"),
    "NOTION_RECURRING_DB": ("recurring tasks",),
    "NOTION_DAILY_DUMP_PAGE": ("daily task dump",),
}
SKIPPED = {"quick add note", "quick add"}


class NotionSearchError(RuntimeError):
    pass


def plain(rich) -> str:
    return "".join(part.get("plain_text") or "" for part in rich or []).strip()


def result_title(item: dict) -> str:
    if item.get("object") == "database":
        return plain(item.get("title"))
    properties = item.get("properties") or {}
    for prop in properties.values():
        if isinstance(prop, dict) and prop.get("type") == "title":
            return plain(prop.get("title"))
    return ""


def normalize_id(notion_id: str) -> str:
    return notion_id.replace("-", "").strip()


def search_workspace(token: str, version: str = "2022-06-28") -> List[dict]:
    headers = {
        "Authorization": f"Bearer {token}",
        "Notion-Version": version,
        "Content-Type": "application/json",
    }
    results = []
    cursor = None
    while True:
        body = {"page_size": 100}
        if cursor:
            body["start_cursor"] = cursor
        response = requests.post("https://api.notion.com/v1/search", headers=headers, json=body, timeout=30)
        if response.status_code >= 400:
            raise NotionSearchError(f"Notion search failed ({response.status_code}): {response.text[:400]}")
        payload = response.json()
        results.extend(payload.get("results") or [])
        if not payload.get("has_more"):
            break
        cursor = payload.get("next_cursor")
    return results


def _folded(title: str) -> str:
    return " ".join(title.casefold().split())


def select_targets(results: List[dict]) -> Dict[str, dict]:
    grouped = {key: [] for _title, _kind, key in TARGETS}
    kinds = {key: kind for _title, kind, key in TARGETS}
    for item in results:
        title = result_title(item)
        folded = _folded(title)
        if folded in SKIPPED:
            continue
        for key, aliases in TITLE_ALIASES.items():
            if folded in aliases and item.get("object") == kinds[key]:
                grouped[key].append(item)
    chosen = {}
    for key, matches in grouped.items():
        if not matches:
            continue
        exact = TITLE_ALIASES[key][0]
        preferred = [item for item in matches if _folded(result_title(item)) == exact]
        pool = preferred or matches
        pool.sort(key=lambda item: item.get("last_edited_time") or "", reverse=True)
        chosen[key] = pool[0]
        chosen[key]["_match_count"] = len(pool)
    return chosen


def upsert_env(path: Path, values: Dict[str, str]) -> None:
    lines = path.read_text().splitlines() if path.is_file() else []
    written = set()
    updated = []
    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in line:
            updated.append(line)
            continue
        key = line.split("=", 1)[0].strip()
        if key in values:
            updated.append(f"{key}={values[key]}")
            written.add(key)
        else:
            updated.append(line)
    for key, value in values.items():
        if key not in written:
            updated.append(f"{key}={value}")
    path.write_text("\n".join(updated).rstrip() + "\n")
    path.chmod(0o600)


def discover_and_write(token: str, env_path: Path, version: str = "2022-06-28") -> List[dict]:
    if not token:
        raise NotionSearchError("NOTION_TOKEN is empty")
    found = select_targets(search_workspace(token, version))
    values = {"NOTION_TOKEN": token}
    if not os.environ.get("GOOGLE_CALENDAR_ID"):
        values["GOOGLE_CALENDAR_ID"] = "primary"
    rows = []
    for title, kind, key in TARGETS:
        item = found.get(key)
        if item is None:
            rows.append({"env": key, "title": title, "object": kind, "id": "", "matches": 0})
            continue
        notion_id = normalize_id(item["id"])
        values[key] = notion_id
        rows.append(
            {
                "env": key,
                "title": result_title(item) or title,
                "object": item.get("object") or kind,
                "id": notion_id,
                "matches": item.get("_match_count") or 1,
            }
        )
    upsert_env(env_path, values)
    return rows
