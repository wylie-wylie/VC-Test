from __future__ import annotations

from datetime import date
from pathlib import Path
from typing import Optional

from brain.archetypes import ARCHETYPES, get_archetype
from brain.config import upsert_registry
from brain.discover import load_track_file, write_track_file
from brain.syllabus import TABLE_HEADER, convert_schedule, render_table


def _empty_schedule() -> str:
    return render_table([])


def _link(source: Path, dest: Path) -> None:
    if dest.exists() or dest.is_symlink():
        return
    dest.symlink_to(source)


def add_course(
    root: Path,
    track_id: str,
    name: str,
    archetype: str,
    trigger: str = "calendar",
    cadence_days: Optional[list] = None,
    syllabus: Optional[Path] = None,
    slides: Optional[Path] = None,
    code: str = "",
    area: str = "",
    priority: str = "Medium",
    term_start: str = "",
    term_end: str = "",
    event_pattern: str = "",
    term_year: Optional[int] = None,
) -> Path:
    get_archetype(archetype)
    if trigger not in {"calendar", "cadence"}:
        raise ValueError("trigger must be 'calendar' or 'cadence'")
    course_dir = root / "courses" / track_id
    (course_dir / "slides").mkdir(parents=True, exist_ok=True)
    (course_dir / "notes").mkdir(parents=True, exist_ok=True)
    (course_dir / "sources").mkdir(parents=True, exist_ok=True)
    schedule_path = course_dir / "syllabus_schedule.md"
    if syllabus:
        start = date.fromisoformat(term_start) if term_start else None
        year = term_year or (start.year if start else date.today().year)
        schedule_path.write_text(convert_schedule(syllabus, year, start))
        _link(syllabus.resolve(), course_dir / "sources" / syllabus.name)
    elif not schedule_path.exists():
        schedule_path.write_text(_empty_schedule())
    if slides:
        slide_path = slides.resolve()
        targets = [slide_path] if slide_path.is_file() else [
            path for path in slide_path.iterdir() if path.suffix.lower() in {".pdf", ".md", ".markdown"}
        ]
        for target in targets:
            _link(target, course_dir / "slides" / target.name)
    data = {
        "id": track_id,
        "code": code or track_id.replace("_", " "),
        "name": name,
        "area": area or name,
        "enabled": True,
        "archetype": archetype,
        "trigger": trigger,
        "cadence_days": list(cadence_days or []),
        "priority": priority,
        "event_pattern": event_pattern,
        "term_start": term_start,
        "term_end": term_end,
    }
    data = {key: value for key, value in data.items() if value not in ("", [], None)}
    data["cadence_days"] = list(cadence_days or [])
    data["enabled"] = True
    write_track_file(course_dir, data)
    upsert_registry(root, track_id, True)
    return course_dir


def set_enabled(root: Path, track_id: str, enabled: bool) -> None:
    course_dir = root / "courses" / track_id
    track_file = course_dir / "track.yaml"
    if track_file.is_file():
        data = load_track_file(track_file)
        data["enabled"] = enabled
        write_track_file(course_dir, data)
    upsert_registry(root, track_id, enabled)


def swap_course(root: Path, old_id: str, new_id: str, **kwargs) -> Path:
    set_enabled(root, old_id, False)
    return add_course(root, new_id, **kwargs)


def update_schedule(root: Path, track_id: str, syllabus: Path, term_year: int, term_start: str = "") -> Path:
    course_dir = root / "courses" / track_id
    if not (course_dir / "track.yaml").is_file():
        raise FileNotFoundError(f"No track folder for {track_id}")
    start = date.fromisoformat(term_start) if term_start else None
    text = convert_schedule(syllabus, term_year, start)
    if TABLE_HEADER not in text:
        raise RuntimeError("Converted schedule is missing the required table header")
    dest = course_dir / "syllabus_schedule.md"
    dest.write_text(text)
    sources = course_dir / "sources"
    sources.mkdir(parents=True, exist_ok=True)
    _link(syllabus.resolve(), sources / syllabus.name)
    return dest


def known_archetypes() -> str:
    return ", ".join(sorted(ARCHETYPES))
