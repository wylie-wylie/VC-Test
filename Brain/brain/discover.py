from __future__ import annotations

import re
from datetime import date
from pathlib import Path
from typing import Optional

import yaml

from brain.archetypes import get_archetype
from brain.models import Track


def _parse_date(value) -> Optional[date]:
    if not value:
        return None
    if isinstance(value, date):
        return value
    return date.fromisoformat(str(value)[:10])


def _pattern_from_code(code: str) -> str:
    parts = [part for part in re.split(r"[\s_\-]+", code.strip()) if part]
    if not parts:
        return ""
    return r"[\s_\-]*".join(re.escape(part) for part in parts)


def load_track_file(path: Path) -> dict:
    data = yaml.safe_load(path.read_text()) or {}
    if not isinstance(data, dict):
        raise ValueError(f"{path} must be a mapping")
    return data


def track_from_mapping(data: dict, course_dir: Path, registry_entry: Optional[dict] = None) -> Track:
    merged = dict(data)
    if registry_entry:
        for key, value in registry_entry.items():
            if key != "id" and value is not None:
                merged[key] = value
    track_id = str(merged.get("id") or course_dir.name)
    code = str(merged.get("code") or track_id)
    archetype = str(merged.get("archetype") or "")
    if archetype:
        get_archetype(archetype)
    cadence = merged.get("cadence_days") or []
    return Track(
        id=track_id,
        name=str(merged.get("name") or track_id),
        area=str(merged.get("area") or merged.get("name") or track_id),
        archetype=archetype,
        trigger=str(merged.get("trigger") or "calendar"),
        enabled=bool(merged.get("enabled", True)),
        priority=str(merged.get("priority") or "Medium"),
        course_dir=str(course_dir),
        event_pattern=str(merged.get("event_pattern") or _pattern_from_code(code)),
        cadence_days=tuple(cadence),
        term_start=_parse_date(merged.get("term_start")),
        term_end=_parse_date(merged.get("term_end")),
        code=code,
    )


def discover_tracks(root: Path, courses_dir: Path, registry: dict) -> list:
    found = {}
    if courses_dir.is_dir():
        for track_file in sorted(courses_dir.glob("*/track.yaml")):
            data = load_track_file(track_file)
            track_id = str(data.get("id") or track_file.parent.name)
            found[track_id] = (track_file.parent, data)
    tracks = []
    ids = sorted(set(found) | set(registry))
    for track_id in ids:
        folder = found.get(track_id)
        if folder is None:
            continue
        course_dir, data = folder
        track = track_from_mapping(data, course_dir, registry.get(track_id))
        if track.enabled:
            tracks.append(track)
    return tracks


def write_track_file(course_dir: Path, data: dict) -> None:
    course_dir.mkdir(parents=True, exist_ok=True)
    course_dir.joinpath("track.yaml").write_text(
        yaml.safe_dump(data, sort_keys=False, allow_unicode=True)
    )
