from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import List, Optional

import yaml

from brain.dump import match_track
from brain.icscal import events_from_ics, fetch_ics
from brain.models import PlannedArea, PlannedProject, PlannedTask
from brain.pipeline import week_bounds
from brain.schedule import event_matches
from brain.state import has_key


QUIZ_HINTS = ("quiz", "exam", "midterm", "final")
PROJECT_HINTS = ("project", "deliverable", "milestone", "design review")
ASSIGNMENT_HINTS = (
    "assignment",
    "homework",
    "problem set",
    "pset",
    "prelab",
    "lab report",
    "/assignments/",
)


def classify_feed_item(summary: str, description: str) -> str:
    blob = f"{summary}\n{description}".lower()
    if any(hint in blob for hint in QUIZ_HINTS):
        return "quiz"
    if any(hint in blob for hint in PROJECT_HINTS):
        return "project"
    if any(hint in blob for hint in ASSIGNMENT_HINTS):
        return "assignment"
    if "lecture" in blob:
        return "lecture"
    return "event"


def match_feed_track(blob: str, tracks):
    hits = [track for track in tracks if track.event_pattern and event_matches(blob, track.event_pattern)]
    if len(hits) == 1:
        return hits[0]
    if len(hits) > 1:
        return max(hits, key=lambda track: len(track.code or track.id))
    return match_track(blob, tracks)


def due_items(events, tracks, today: date, horizon_days: int = 14) -> List[dict]:
    window_end = today + timedelta(days=horizon_days)
    items = []
    seen = set()
    for event in events:
        kind = classify_feed_item(event.summary, event.description)
        if kind not in {"assignment", "quiz", "project"}:
            continue
        due = event.start.date()
        if due < today - timedelta(days=1) or due > window_end:
            continue
        blob = f"{event.summary}\n{event.description}"
        track = match_feed_track(blob, tracks)
        key = f"canvas|{event.id}|{due.isoformat()}"
        if key in seen:
            continue
        seen.add(key)
        items.append(
            {
                "key": key,
                "uid": event.id,
                "title": event.summary.strip() or "Canvas item",
                "kind": kind,
                "due": due,
                "track": track,
            }
        )
    items.sort(key=lambda item: (item["due"], item["title"]))
    return items


def load_profiles(root) -> list:
    path = root / "project_study_profiles.yaml"
    if not path.is_file():
        return []
    data = yaml.safe_load(path.read_text()) or {}
    return list(data.get("profiles") or [])


def profiles_text(profiles: list) -> str:
    chunks = []
    for profile in profiles:
        rules = str(profile.get("rules") or "").strip()
        if not rules:
            continue
        chunks.append(f"### {profile.get('area') or 'Area'}\n{rules}")
    return "\n\n".join(chunks)


def plan_canvas_tasks(items: List[dict], state: Optional[dict] = None):
    state = state or {"entries": {}}
    areas = []
    projects = []
    tasks = []
    seen_areas = set()
    seen_projects = set()
    for item in items:
        track = item.get("track")
        if track is None:
            continue
        if has_key(state, item["key"]):
            continue
        monday, sunday = week_bounds(item["due"])
        project_key = f"{track.id}|project|{monday.isoformat()}"
        if project_key not in seen_projects:
            projects.append(
                PlannedProject(
                    key=project_key,
                    name=f"{track.name} — Week of {monday.isoformat()}",
                    area_name=track.area,
                    track_id=track.id,
                    work_start=monday,
                    work_end=sunday,
                    priority="High" if item["kind"] in {"quiz", "project"} else track.priority,
                )
            )
            seen_projects.add(project_key)
        if track.area not in seen_areas:
            areas.append(PlannedArea(track.area, f"area|{track.area}"))
            seen_areas.add(track.area)
        tasks.append(
            PlannedTask(
                key=item["key"],
                name=f"Canvas {item['kind']}: {item['title']} (due {item['due'].isoformat()})",
                track_id=track.id,
                project_key=project_key,
                priority="High" if item["kind"] in {"quiz", "project"} else "Medium",
                source_date=item["due"],
                notes="Canvas calendar",
            )
        )
    return areas, projects, tasks


def render_canvas_preview(items: List[dict]) -> List[str]:
    lines = []
    for item in items:
        track = item.get("track")
        if track is None:
            lines.append(f"- unmatched {item['kind']}: {item['title']} due {item['due'].isoformat()}")
            continue
        lines.append(
            f"- {track.area} / {track.name} / Canvas {item['kind']}: {item['title']} due {item['due'].isoformat()}"
        )
    return lines


def apply_canvas_tasks(config, notion, state, items: List[dict]) -> List[str]:
    from brain.execute import ensure_area, ensure_project, ensure_task
    from brain.state import save_state

    areas, projects, tasks = plan_canvas_tasks(items, state)
    area_ids = {}
    project_ids = {}
    messages = []
    for area in areas:
        area_ids[area.name] = ensure_area(notion, state, area.name)
        messages.append(f"area {area.name}")
    for project in projects:
        area_id = area_ids.get(project.area_name) or ensure_area(notion, state, project.area_name)
        area_ids[project.area_name] = area_id
        project_ids[project.key] = ensure_project(notion, state, project, area_id)
        messages.append(f"project {project.name}")
    for task in tasks:
        project_id = project_ids.get(task.project_key)
        if not project_id:
            continue
        ensure_task(notion, state, task, project_id)
        messages.append(f"task {task.name}")
    if messages:
        save_state(config.state_path, state)
    return messages


def fetch_feed_events(url: str, start: datetime, end: datetime, tz_name: str):
    if not url:
        return []
    return events_from_ics(fetch_ics(url), start, end, tz_name)
