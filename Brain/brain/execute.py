from __future__ import annotations

from datetime import datetime, time, timedelta, timezone

from brain.dump import mark_note_processed, render_dump
from brain.gcal import GoogleCalendar
from brain.models import Interval
from brain.notion import NotionClient, blocks_to_markdown, markdown_blocks, plain_text
from brain.state import has_key, record, save_state


class ApplyError(RuntimeError):
    pass


def _title(settings, text: str) -> dict:
    return {settings.properties["title"]: {"title": [{"type": "text", "text": {"content": text[:200]}}]}}


def ensure_area(notion: NotionClient, state: dict, name: str) -> str:
    key = f"area|{name}"
    entry = state["entries"].get(key) or {}
    if entry.get("notion_id"):
        return entry["notion_id"]
    found = notion.find_by_title(notion.settings.areas_db, name)
    if found:
        record(state, key, "area", notion_id=found)
        return found
    properties = _title(notion.settings, name)
    created = notion.create_page(notion.settings.areas_db, properties)
    record(state, key, "area", notion_id=created)
    return created


def ensure_project(notion: NotionClient, state: dict, project, area_id: str) -> str:
    entry = state["entries"].get(project.key) or {}
    if entry.get("notion_id"):
        return entry["notion_id"]
    found = notion.find_by_title(notion.settings.projects_db, project.name)
    if found:
        record(state, project.key, "project", notion_id=found)
        return found
    props = notion.settings.properties
    properties = _title(notion.settings, project.name)
    properties[props["area"]] = {"relation": [{"id": area_id}]}
    properties[props["work_time"]] = {
        "date": {"start": project.work_start.isoformat(), "end": project.work_end.isoformat()}
    }
    properties[props["priority"]] = {"select": {"name": project.priority}}
    properties[props["done"]] = {"checkbox": False}
    properties[props["archive"]] = {"checkbox": False}
    created = notion.create_page(notion.settings.projects_db, properties)
    record(state, project.key, "project", notion_id=created)
    return created


def ensure_task(notion: NotionClient, state: dict, task, project_id: str) -> str:
    if has_key(state, task.key) and state["entries"][task.key].get("notion_id"):
        return state["entries"][task.key]["notion_id"]
    found = notion.find_by_title(notion.settings.tasks_db, task.name[:200])
    if found:
        record(state, task.key, "task", notion_id=found)
        return found
    props = notion.settings.properties
    properties = _title(notion.settings, task.name)
    properties[props["project"]] = {"relation": [{"id": project_id}]}
    properties[props["done"]] = {"checkbox": False}
    if not project_id:
        raise ApplyError(f"Refusing orphan task {task.name}")
    created = notion.create_page(notion.settings.tasks_db, properties)
    record(state, task.key, "task", notion_id=created)
    return created


def write_dump(config, notion: NotionClient, inbox: list, execution_lines: list) -> None:
    text = render_dump(inbox, execution_lines)
    config.dump_path.parent.mkdir(parents=True, exist_ok=True)
    config.dump_path.write_text(text)
    if notion is not None and config.notion.daily_dump_page:
        for block in notion.block_children(config.notion.daily_dump_page):
            notion.archive_block(block["id"])
        notion.append_blocks(config.notion.daily_dump_page, markdown_blocks(inbox, execution_lines))


def apply_plan(plan, config, state, notion: NotionClient, calendar: GoogleCalendar, quick_paths: dict, dump_only_events: bool = False) -> list:
    if not notion or not notion.settings.configured:
        raise ApplyError("Notion is not configured. Set NOTION_TOKEN and the database ids before --commit.")
    messages = []
    area_ids = {}
    project_ids = {}
    for area in plan.areas:
        area_ids[area.name] = ensure_area(notion, state, area.name)
        save_state(config.state_path, state)
        messages.append(f"area {area.name}")
    for project in plan.projects:
        area_id = area_ids.get(project.area_name) or ensure_area(notion, state, project.area_name)
        area_ids[project.area_name] = area_id
        project_ids[project.key] = ensure_project(notion, state, project, area_id)
        save_state(config.state_path, state)
        messages.append(f"project {project.name}")
    for task in plan.tasks:
        project_id = project_ids.get(task.project_key)
        if not project_id:
            raise ApplyError(f"Refusing orphan task {task.key}")
        ensure_task(notion, state, task, project_id)
        save_state(config.state_path, state)
        messages.append(f"task {task.name}")
    if calendar is not None:
        window_start = datetime.combine(plan.day, time(0, 0), tzinfo=timezone.utc) - timedelta(days=1)
        window_end = window_start + timedelta(days=14)
        for event in plan.events:
            if has_key(state, event.key) and state["entries"][event.key].get("calendar_id"):
                messages.append(f"event exists {event.summary}")
                continue
            existing = calendar.find_brain_key(event.key, window_start, window_end)
            if existing:
                record(state, event.key, "event", calendar_id=existing)
                save_state(config.state_path, state)
                continue
            created = calendar.create_event(event.summary, event.start, event.end, event.description, event.key)
            record(state, event.key, "event", calendar_id=created)
            save_state(config.state_path, state)
            messages.append(f"event {event.summary}")
    elif plan.events and not dump_only_events:
        raise ApplyError("Calendar blocks are planned, but Google Calendar credentials are missing.")
    elif plan.events:
        messages.append("Kept auto-study blocks on the Daily Task Dump instead of Google Calendar.")
    if plan.dump is not None:
        write_dump(config, notion, plan.dump.inbox_remaining, plan.dump.execution_lines)
        for bullet in plan.dump.consumed:
            record(state, f"dump|{plan.day.isoformat()}|{bullet}", "dump")
        save_state(config.state_path, state)
        messages.append("rewrote Daily Task Dump")
    props = notion.settings.properties
    for item in plan.quick_add:
        project_id = project_ids.get(item.project_key)
        area_id = area_ids.get(item.area_name)
        if item.page_id and not item.page_id.startswith("/") and len(item.page_id) > 20:
            properties = {}
            if area_id:
                properties[props["area"]] = {"relation": [{"id": area_id}]}
            if project_id:
                properties[props["project"]] = {"relation": [{"id": project_id}]}
            properties[props["processed"]] = {"checkbox": True}
            notion.update_page(item.page_id, properties)
        path = quick_paths.get(item.page_id)
        if path is not None:
            mark_note_processed(path)
        record(state, f"quick|{item.page_id or item.title}", "quick_add")
        save_state(config.state_path, state)
        messages.append(f"processed note {item.title}")
    return messages


def notion_page_title(page: dict, title_prop: str) -> str:
    prop = (page.get("properties") or {}).get(title_prop) or {}
    return plain_text(prop.get("title") or []) or "Untitled"


def load_notion_dump(notion: NotionClient, page_id: str) -> str:
    return blocks_to_markdown(notion.block_children(page_id))


def busy_from_events(events, constraints) -> list:
    from zoneinfo import ZoneInfo

    tz = ZoneInfo(constraints.timezone)
    intervals = []
    for event in events:
        if event.transparent:
            continue
        if event.all_day:
            summary = (event.summary or "").lower()
            if not any(word in summary for word in constraints.all_day_busy_keywords):
                continue
            start = datetime.combine(event.start.date(), time(7, 0), tzinfo=tz)
            end = datetime.combine(event.start.date(), _parse_end(constraints.day_end), tzinfo=tz)
            intervals.append(Interval(start, end, event.summary))
            continue
        intervals.append(Interval(event.start, event.end, event.summary))
    return intervals


def _parse_end(value: str):
    hour, minute = value.split(":")
    return time(int(hour), int(minute))
