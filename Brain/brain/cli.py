from __future__ import annotations

import argparse
import sys
import warnings

import requests

warnings.filterwarnings("ignore", message="urllib3 v2 only supports OpenSSL")
warnings.filterwarnings("ignore", message="You are using a Python version")
warnings.filterwarnings("ignore", message="there are non-text parts in the response")
from datetime import date, datetime, time, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from brain.archetypes import ARCHETYPES
from brain.commands import add_course, known_archetypes, swap_course, update_schedule
from brain.config import DIRECTORY_PAGES, load_config
from brain.discover import discover_tracks
from brain.dump import load_quick_notes, note_hint, note_title, split_dump
from brain.execute import apply_plan, busy_from_events, load_notion_dump, notion_page_title, write_dump
from brain.gcal import CalendarError, GoogleCalendar, run_browser_login
from brain.canvas_sync import (
    apply_canvas_tasks,
    due_items,
    fetch_feed_events,
    load_profiles,
    profiles_text,
    render_canvas_preview,
)
from brain.gemini_menu import (
    GeminiError,
    build_prompt,
    execution_for,
    fallback_menu,
    generate_menu,
    option_by_id,
    planning_windows,
    render_menu,
    validate_blocks,
)
from brain.icscal import IcsError, completed_lectures, fetch_ics
from brain.notion import NotionClient, NotionError, plain_text
from brain.pipeline import RunContext, build_plan, ingest_quick_notes, render_plan
from brain.state import load_state
from brain.syllabus import load_schedule


def _date(value: str) -> date:
    return date.fromisoformat(value)


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="brain",
        description="Sync course folders, Google Calendar, and the Notion Brain workspace.",
    )
    sub = parser.add_subparsers(dest="cmd", required=True)

    run = sub.add_parser("run", help="Plan or apply today's study sync")
    run.add_argument("--date", type=_date, help="ISO date, defaults to today in the configured timezone")
    mode = run.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true", help="Preview Notion and Calendar changes")
    mode.add_argument("--commit", action="store_true", help="Create Notion pages and Calendar events")
    run.add_argument(
        "--syllabus-fallback",
        action="store_true",
        help="If calendar is offline, treat dated lecture/exam rows as triggers",
    )

    doctor = sub.add_parser("doctor", help="Show discovered tracks and credential status")
    doctor.add_argument("--date", type=_date)

    add = sub.add_parser("add-course", help="Register a track in brain_config.yaml and scaffold courses/")
    add.add_argument("track_id")
    add.add_argument("--name", required=True)
    add.add_argument("--archetype", required=True, choices=sorted(ARCHETYPES))
    add.add_argument("--trigger", choices=("calendar", "cadence"), default="calendar")
    add.add_argument("--cadence", default="", help="Comma-separated weekday tokens, e.g. Mon,Thu")
    add.add_argument("--syllabus", type=Path)
    add.add_argument("--slides", type=Path)
    add.add_argument("--code", default="")
    add.add_argument("--area", default="")
    add.add_argument("--priority", default="Medium")
    add.add_argument("--term-start", default="")
    add.add_argument("--term-end", default="")
    add.add_argument("--event-pattern", default="")

    swap = sub.add_parser("swap-course", help="Disable one track and scaffold its replacement")
    swap.add_argument("old_id")
    swap.add_argument("new_id")
    swap.add_argument("--name", required=True)
    swap.add_argument("--archetype", required=True, choices=sorted(ARCHETYPES))
    swap.add_argument("--trigger", choices=("calendar", "cadence"), default="calendar")
    swap.add_argument("--cadence", default="")
    swap.add_argument("--syllabus", type=Path)
    swap.add_argument("--slides", type=Path)
    swap.add_argument("--code", default="")
    swap.add_argument("--area", default="")
    swap.add_argument("--priority", default="Medium")
    swap.add_argument("--term-start", default="")
    swap.add_argument("--term-end", default="")
    swap.add_argument("--event-pattern", default="")

    update = sub.add_parser("update-schedule", help="Convert a syllabus or study plan into syllabus_schedule.md")
    update.add_argument("track_id")
    update.add_argument("--syllabus", type=Path, required=True)
    update.add_argument("--term-start", default="")

    sub.add_parser(
        "auth",
        help="Optional Google OAuth login. The ICS feed does not need this.",
    )
    menu = sub.add_parser("menu", help="Gemini Option A/B/C study menu from the ICS feed and Active Tasks")
    menu.add_argument("--date", type=_date)
    menu.add_argument("--choose", choices=("A", "B", "C", "a", "b", "c"))
    menu_mode = menu.add_mutually_exclusive_group()
    menu_mode.add_argument("--dry-run", action="store_true")
    menu_mode.add_argument("--commit", action="store_true")
    return parser


def _normalize_cadence(value: str) -> list:
    aliases = {
        "monday": "Mon",
        "mon": "Mon",
        "tuesday": "Tue",
        "tue": "Tue",
        "wednesday": "Wed",
        "wed": "Wed",
        "thursday": "Thu",
        "thu": "Thu",
        "friday": "Fri",
        "fri": "Fri",
        "saturday": "Sat",
        "sat": "Sat",
        "sunday": "Sun",
        "sun": "Sun",
    }
    days = []
    for part in value.split(","):
        token = part.strip().lower()
        if not token:
            continue
        if token not in aliases:
            raise SystemExit(f"Unknown weekday {part!r}. Use Mon,Tue,Wed,Thu,Fri,Sat,Sun.")
        days.append(aliases[token])
    return days


def run_plan(config, day: date, syllabus_fallback: bool, commit: bool):
    tracks = discover_tracks(config.root, config.courses_dir, config.registry)
    schedules = {track.id: load_schedule(Path(track.schedule_path)) for track in tracks}
    state = load_state(config.state_path)
    tz = ZoneInfo(config.timezone)
    notes = []
    events = []
    busy = []
    calendar = None
    calendar_offline = True
    if config.calendar.configured:
        try:
            calendar = GoogleCalendar(config.calendar)
            start = datetime.combine(day, time(0, 0), tzinfo=tz)
            end = start + timedelta(days=8)
            events = calendar.list_events(start, end)
            busy = list(calendar.freebusy(start, end))
            busy.extend(busy_from_events(events, config.constraints))
            calendar_offline = False
        except CalendarError as exc:
            notes.append(f"Google Calendar is unavailable ({exc}). Continuing as a Notion-only dry-run.")
            calendar = None
            calendar_offline = True
            if commit:
                raise
    elif config.ics_url:
        try:
            start = datetime.combine(day, time(0, 0), tzinfo=tz)
            end = start + timedelta(days=8)
            events = fetch_feed_events(config.ics_url, start, end, config.timezone)
            busy = busy_from_events(events, config.constraints)
            calendar_offline = False
            notes.append(
                f"ICS feed loaded {len(events)} events. [Auto-Study] blocks are written to Daily Task Dump."
            )
        except IcsError as exc:
            notes.append(str(exc))
    else:
        notes.append(
            "No Google token and no GOOGLE_CALENDAR_ICS_URL. Lecture matching is off until the ICS url is in .env."
        )

    notion = None
    dump_text = ""
    if config.dump_path.is_file():
        dump_text = config.dump_path.read_text()
    if config.notion.configured:
        try:
            notion = NotionClient(config.notion)
            if config.notion.daily_dump_page:
                dump_text = load_notion_dump(notion, config.notion.daily_dump_page)
        except (NotionError, OSError) as exc:
            notes.append(str(exc))
            notion = None
    _, bullets, _ = split_dump(dump_text or "## Inbox\n\n## Execution\n")
    ctx = RunContext(
        day=day,
        tracks=tracks,
        schedules=schedules,
        events=events,
        busy=busy,
        state=state,
        constraints=config.constraints,
        calendar_offline=calendar_offline,
        syllabus_fallback=syllabus_fallback,
        notes=notes,
        dump_bullets=bullets,
        rewrite_dump=config.dump_path.is_file() or bool(config.notion.daily_dump_page),
        now=datetime.now(tz),
    )
    plan = build_plan(ctx)
    local_notes = []
    quick_paths = {}
    for path, text in load_quick_notes(config.quick_add_dir):
        page_id = str(path)
        quick_paths[page_id] = path
        local_notes.append(
            {
                "title": note_title(text, path.stem),
                "body": text,
                "hint": note_hint(text),
                "page_id": page_id,
            }
        )
    if notion and config.notion.quick_add_db:
        try:
            for page in notion.query_unprocessed(config.notion.quick_add_db):
                title = notion_page_title(page, config.notion.properties["title"])
                body_blocks = notion.block_children(page["id"])
                body = "\n".join(
                    plain_text((block.get(block.get("type")) or {}).get("rich_text") or [])
                    for block in body_blocks
                )
                local_notes.append({"title": title, "body": body, "hint": title, "page_id": page["id"]})
        except NotionError as exc:
            plan.notes.append(str(exc))
    if local_notes:
        ingest_quick_notes(plan, ctx, local_notes)
    rendered = render_plan(plan)
    if not commit:
        return rendered, 0
    if notion is None:
        raise SystemExit("Refusing --commit because Notion credentials are missing or unreadable.")
    messages = apply_plan(
        plan,
        config,
        state,
        notion,
        calendar,
        quick_paths,
        dump_only_events=calendar is None,
    )
    return rendered + "\nCommitted\n" + "\n".join(f"- {message}" for message in messages) + "\n", 0


def doctor(config, day: date) -> str:
    tracks = discover_tracks(config.root, config.courses_dir, config.registry)
    lines = [
        f"Root {config.root}",
        f"Date {day.isoformat()}",
        f"Notion connection: {_notion_status(config)}",
        f"Gemini connection: {_gemini_status(config.gemini_api_key)}",
        f"Calendar OAuth: {'yes' if config.calendar.configured else 'no'}",
        f"Calendar ICS feed: {_feed_status(config.ics_url)}",
        f"Canvas ICS feed: {_feed_status(config.canvas_ics_url)}",
        f"Deep-block cap: {config.constraints.max_deep_blocks_per_day}",
        "Protected windows:",
    ]
    for window in config.constraints.protected_windows:
        lines.append(f"- {','.join(window.days)} {window.start}-{window.end} {window.label}")
    if not config.canvas_ics_url:
        lines.append("Set CANVAS_CALENDAR_ICS_URL in .env to import Canvas dues.")
    lines.append("Directory pages are navigation only: " + ", ".join(DIRECTORY_PAGES))
    notion_ids = (
        ("NOTION_AREAS_DB", config.notion.areas_db),
        ("NOTION_PROJECTS_DB", config.notion.projects_db),
        ("NOTION_TASKS_DB", config.notion.tasks_db),
        ("NOTION_RECURRING_DB", config.notion.recurring_db),
        ("NOTION_DAILY_DUMP_PAGE", config.notion.daily_dump_page),
    )
    lines.append("Notion IDs:")
    for label, value in notion_ids:
        lines.append(f"- {label}: {value or 'missing'}")
    lines.append("Tracks:")
    if not tracks:
        lines.append("- none discovered")
    for track in tracks:
        rows = load_schedule(Path(track.schedule_path))
        dated = sum(1 for row in rows if row.date)
        lines.append(
            f"- {track.id} | {track.archetype} | {track.trigger} | cadence {','.join(track.cadence_days) or '—'} | {dated} dated rows"
        )
    lines.append("Archetypes: " + known_archetypes())
    return "\n".join(lines) + "\n"


def _notion_status(config) -> str:
    if not config.notion.configured:
        return "no"
    try:
        NotionClient(config.notion)._request("GET", "users/me")
    except NotionError as exc:
        return f"configured, unreachable ({exc})"
    return "yes"


def _gemini_status(api_key: str) -> str:
    if not api_key:
        return "no"
    try:
        response = requests.get(
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash",
            headers={"x-goog-api-key": api_key},
            timeout=20,
        )
    except requests.RequestException as exc:
        return f"configured, unreachable ({exc.__class__.__name__})"
    if response.status_code >= 400:
        return f"configured, unreachable (HTTP {response.status_code})"
    return "yes"


def _feed_status(url: str) -> str:
    if not url:
        return "no"
    try:
        fetch_ics(url)
    except IcsError as exc:
        return f"set, unreachable ({exc})"
    return "yes"


def _inbox_and_notion(config):
    notion = None
    dump_text = config.dump_path.read_text() if config.dump_path.is_file() else "## Inbox\n\n## Execution\n"
    if config.notion.configured:
        notion = NotionClient(config.notion)
        if config.notion.daily_dump_page:
            dump_text = load_notion_dump(notion, config.notion.daily_dump_page)
    _, bullets, _ = split_dump(dump_text)
    return notion, bullets


def run_study_menu(config, day: date, choose: str, commit: bool) -> str:
    tz = ZoneInfo(config.timezone)
    now = datetime.now(tz)
    tracks = discover_tracks(config.root, config.courses_dir, config.registry)
    notes = []
    events = []
    canvas_events = []
    start = datetime.combine(day, time(0, 0), tzinfo=tz)
    horizon_end = start + timedelta(days=15)
    if config.calendar.configured:
        try:
            calendar = GoogleCalendar(config.calendar)
            events = calendar.list_events(start, start + timedelta(days=2))
        except CalendarError as exc:
            notes.append(str(exc))
    elif config.ics_url:
        try:
            events = fetch_feed_events(config.ics_url, start, horizon_end, config.timezone)
            notes.append(f"Google ICS feed loaded {len(events)} events.")
        except IcsError as exc:
            notes.append(str(exc))
    else:
        notes.append("GOOGLE_CALENDAR_ICS_URL is not set. The menu has no live lecture times.")
    if config.canvas_ics_url:
        try:
            canvas_events = fetch_feed_events(config.canvas_ics_url, start, horizon_end, config.timezone)
            notes.append(f"Canvas ICS feed loaded {len(canvas_events)} events.")
        except IcsError as exc:
            notes.append(str(exc))
    else:
        notes.append("CANVAS_CALENDAR_ICS_URL is not set, so Canvas dues were not imported.")
    busy = busy_from_events(events, config.constraints)
    evening, wrap, tomorrow = planning_windows(now, busy, config.constraints)
    windows = wrap + tomorrow if evening else wrap
    if evening:
        notes.append(
            f"Evening horizon: one wrap-up tonight and full open windows on {(day + timedelta(days=1)).isoformat()}."
        )
    lectures = completed_lectures(events, tracks, now)
    dues = due_items(list(canvas_events) + list(events), tracks, day)
    if dues:
        notes.append(f"Canvas-style dues matched: {len([item for item in dues if item.get('track')])} linked, {len([item for item in dues if item.get('track') is None])} unmatched.")
    notes.extend(render_canvas_preview(dues)[:12])
    if lectures:
        notes.append("Completed lectures: " + ", ".join(event.summary for _track, event in lectures))
    else:
        notes.append("No completed lecture blocks were matched on the feed.")
    tasks = []
    notion = None
    inbox = []
    if config.notion.configured:
        try:
            notion, inbox = _inbox_and_notion(config)
            tasks = notion.query_open_tasks()
            notes.append(f"Triaged {len(tasks)} open Active Tasks.")
        except NotionError as exc:
            notes.append(str(exc))
    model = None
    try:
        profiles = profiles_text(load_profiles(config.root))
        model, payload = generate_menu(
            config.gemini_api_key,
            build_prompt(
                day,
                tracks,
                tasks,
                lectures,
                windows,
                config.constraints,
                profiles,
                render_canvas_preview(dues),
                evening,
                day + timedelta(days=1),
            ),
        )
    except GeminiError as exc:
        notes.append(str(exc))
        payload = fallback_menu(lectures, windows, config.constraints.event_prefix)
    for option in payload.get("options") or []:
        notes.extend(validate_blocks(option, day, windows, config.constraints, evening))
    rendered = render_menu(payload, model, notes)
    if not choose:
        rendered += "\nPass --choose A|B|C --commit to write that option into Daily Task Dump.\n"
        return rendered
    option = option_by_id(payload, choose)
    lines = execution_for(day, option)
    rendered += "\nSelected\n" + "\n".join(lines) + "\n"
    if not commit:
        rendered += "Dry run only. Re-run with --commit to update Daily Task Dump.\n"
        return rendered
    if notion is None or not config.notion.daily_dump_page:
        raise SystemExit("Refusing --commit because the Daily Task Dump page is not configured.")
    write_dump(config, notion, inbox, lines)
    from brain.state import load_state

    canvas_messages = apply_canvas_tasks(config, notion, load_state(config.state_path), dues)
    rendered += "Wrote the selected blocks to Daily Task Dump.\n"
    if canvas_messages:
        rendered += "Canvas tasks:\n" + "\n".join(f"- {message}" for message in canvas_messages) + "\n"
    return rendered


def main(argv=None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)
    config = load_config()
    if args.cmd == "menu":
        day = args.date or datetime.now(ZoneInfo(config.timezone)).date()
        sys.stdout.write(run_study_menu(config, day, (args.choose or "").upper(), bool(args.commit)))
        return 0
    if args.cmd == "auth":
        try:
            dest = run_browser_login(config.root / "credentials")
        except CalendarError as exc:
            raise SystemExit(str(exc))
        sys.stdout.write(f"Wrote {dest}\n")
        return 0
    if args.cmd == "doctor":
        day = args.date or datetime.now(ZoneInfo(config.timezone)).date()
        sys.stdout.write(doctor(config, day))
        return 0
    if args.cmd == "run":
        day = args.date or datetime.now(ZoneInfo(config.timezone)).date()
        commit = bool(args.commit)
        text, code = run_plan(config, day, args.syllabus_fallback, commit)
        sys.stdout.write(text)
        return code
    if args.cmd == "add-course":
        course = add_course(
            config.root,
            args.track_id,
            name=args.name,
            archetype=args.archetype,
            trigger=args.trigger,
            cadence_days=_normalize_cadence(args.cadence),
            syllabus=args.syllabus,
            slides=args.slides,
            code=args.code,
            area=args.area,
            priority=args.priority,
            term_start=args.term_start,
            term_end=args.term_end,
            event_pattern=args.event_pattern,
            term_year=config.term_year,
        )
        sys.stdout.write(f"Scaffolded {course}\n")
        return 0
    if args.cmd == "swap-course":
        course = swap_course(
            config.root,
            args.old_id,
            args.new_id,
            name=args.name,
            archetype=args.archetype,
            trigger=args.trigger,
            cadence_days=_normalize_cadence(args.cadence),
            syllabus=args.syllabus,
            slides=args.slides,
            code=args.code,
            area=args.area,
            priority=args.priority,
            term_start=args.term_start,
            term_end=args.term_end,
            event_pattern=args.event_pattern,
            term_year=config.term_year,
        )
        sys.stdout.write(f"Disabled {args.old_id} and scaffolded {course}\n")
        return 0
    if args.cmd == "update-schedule":
        dest = update_schedule(
            config.root,
            args.track_id,
            args.syllabus,
            config.term_year,
            args.term_start,
        )
        sys.stdout.write(f"Wrote {dest}\n")
        return 0
    parser.error(f"Unknown command {args.cmd}")
    return 2
