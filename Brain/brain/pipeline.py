from __future__ import annotations

import re
from collections import Counter
from datetime import date, datetime, time, timedelta
from pathlib import Path
from typing import Dict, List, Optional
from zoneinfo import ZoneInfo

from brain.archetypes import get_archetype
from brain.dump import is_actionable, match_track
from brain.models import (
    CalendarEvent,
    DumpRewrite,
    Interval,
    Plan,
    PlannedArea,
    PlannedEvent,
    PlannedProject,
    PlannedTask,
    QuickAddResult,
    ScheduleRow,
    Skipped,
    Track,
    Unscheduled,
    weekday_token,
)
from brain.schedule import count_deep_blocks, event_matches, place_block
from brain.state import has_key
from brain.syllabus import lookup_row, newest_slide, slide_blurb, topic_label, week_rows


def week_bounds(day: date) -> tuple:
    monday = day - timedelta(days=day.weekday())
    sunday = monday + timedelta(days=6)
    return monday, sunday


def _slug(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return slug[:60] or "task"


def _project_name(track: Track, monday: date, rows: List[ScheduleRow]) -> tuple:
    exams = [row for row in rows if row.is_exam]
    if exams:
        title = exams[0].deliverable or exams[0].topic or "Exam block"
        return f"{track.name} — {title}", "High"
    modules = [row.module for row in rows if row.module]
    unique = list(dict.fromkeys(modules))
    if len(unique) == 1:
        return f"{track.name} — {unique[0]}", track.priority
    return f"{track.name} — Week of {monday.isoformat()}", track.priority


def _row_is_session(row: ScheduleRow) -> bool:
    if row.is_no_class:
        return False
    blob = f"{row.module} {row.topic} {row.deliverable}"
    if re.search(r"\bM\d+L\d+\b", blob):
        return True
    if row.is_exam:
        return True
    return False


class RunContext:
    def __init__(
        self,
        day: date,
        tracks: List[Track],
        schedules: Dict[str, List[ScheduleRow]],
        events: List[CalendarEvent],
        busy,
        state: dict,
        constraints,
        calendar_offline: bool,
        syllabus_fallback: bool,
        notes: Optional[List[str]] = None,
        dump_bullets: Optional[List[str]] = None,
        rewrite_dump: bool = False,
        now: Optional[datetime] = None,
    ):
        self.day = day
        self.tracks = tracks
        self.schedules = schedules
        self.events = events
        self.busy = list(busy)
        self.state = state
        self.constraints = constraints
        self.calendar_offline = calendar_offline
        self.syllabus_fallback = syllabus_fallback
        self.notes = notes or []
        self.dump_bullets = list(dump_bullets or [])
        self.rewrite_dump = rewrite_dump or dump_bullets is not None
        self.now = now


def _ensure_project(plan: Plan, track: Track, day: date, rows: List[ScheduleRow]) -> PlannedProject:
    monday, sunday = week_bounds(day)
    key = f"{track.id}|project|{monday.isoformat()}"
    for project in plan.projects:
        if project.key == key:
            return project
    week = week_rows(rows, monday, sunday)
    name, priority = _project_name(track, monday, week)
    if any(row.is_exam for row in week):
        priority = "High"
    project = PlannedProject(
        key=key,
        name=name,
        area_name=track.area,
        track_id=track.id,
        work_start=monday,
        work_end=sunday,
        priority=priority,
    )
    plan.projects.append(project)
    if not any(area.name == track.area for area in plan.areas):
        plan.areas.append(PlannedArea(track.area, f"area|{track.area}"))
    return project


def _add_task(plan: Plan, track: Track, project: PlannedProject, day: date, template: str, topic: str, label: str):
    name = f"{template.format(topic=topic)} ({day.isoformat()})"
    key = f"{track.id}|task|{day.isoformat()}|{_slug(label)}|{_slug(topic)[:40]}"
    if has_key(plan_state := _state_of(plan), key):
        return
    if any(task.key == key for task in plan.tasks):
        return
    plan.tasks.append(
        PlannedTask(
            key=key,
            name=name,
            track_id=track.id,
            project_key=project.key,
            priority=project.priority,
            source_date=day,
            notes=topic,
        )
    )


def _state_of(plan: Plan) -> dict:
    return getattr(plan, "_state", {"entries": {}})


def build_plan(ctx: RunContext) -> Plan:
    plan = Plan(day=ctx.day, notes=list(ctx.notes))
    plan._state = ctx.state  # type: ignore[attr-defined]
    tz = ZoneInfo(ctx.constraints.timezone)
    now = ctx.now.astimezone(tz) if ctx.now is not None else None
    triggers = []

    def earliest_at(moment: datetime) -> datetime:
        local = moment.astimezone(tz)
        if now is not None and local.date() == now.date() and local < now:
            return now
        return local

    for track in ctx.tracks:
        rows = ctx.schedules.get(track.id, [])
        if track.trigger == "cadence":
            if weekday_token(ctx.day) in track.cadence_days:
                row = lookup_row(rows, ctx.day)
                topic = topic_label(row, f"Weekly {track.name} sprint")
                triggers.append((track, ctx.day, topic, "cadence", earliest_at(aware_morning(ctx.day, tz)), 0))
        else:
            matched = [
                event
                for event in ctx.events
                if not event.all_day
                and event.start.astimezone(tz).date() == ctx.day
                and event_matches(event.summary, track.event_pattern)
            ]
            if matched:
                for event in matched:
                    row = lookup_row(rows, ctx.day)
                    slide = newest_slide(Path(track.slides_dir))
                    if row and row.date == ctx.day:
                        topic = topic_label(row, track.name)
                        if slide is not None:
                            topic = f"{topic} [{slide.name}]"
                    else:
                        topic = slide_blurb(slide) or topic_label(row, track.name)
                    triggers.append((track, ctx.day, topic, "calendar", earliest_at(event.end), 10))
            elif ctx.calendar_offline and ctx.syllabus_fallback:
                row = next((item for item in rows if item.date == ctx.day), None)
                if row and _row_is_session(row):
                    triggers.append(
                        (
                            track,
                            ctx.day,
                            topic_label(row, track.name),
                            "syllabus-fallback",
                            aware_morning(ctx.day, tz),
                            20,
                        )
                    )
                    plan.notes.append(f"{track.id} triggered from syllabus because calendar is offline.")
            elif ctx.calendar_offline:
                plan.notes.append(
                    f"{track.id} is calendar-triggered and calendar is offline, so no study block was created."
                )

        monday, sunday = week_bounds(ctx.day)
        cadence_this_week = any(
            weekday_token(monday + timedelta(days=offset)) in track.cadence_days for offset in range(7)
        )
        if week_rows(rows, monday, sunday) or cadence_this_week:
            _ensure_project(plan, track, ctx.day, rows)

    placed_keys = set()
    deep_added: Counter = Counter()
    proposals = []
    for track, source_day, topic, origin, earliest, rank in triggers:
        try:
            archetype = get_archetype(track.archetype)
        except KeyError as exc:
            plan.notes.append(str(exc))
            continue
        rows = ctx.schedules.get(track.id, [])
        project = _ensure_project(plan, track, source_day, rows)
        for index, template in enumerate(archetype.same_day_tasks):
            _add_task(plan, track, project, source_day, template, topic, f"same-{index}")
        block_key = f"{track.id}|block|{source_day.isoformat()}|same-day"
        proposals.append(
            {
                "key": block_key,
                "track": track,
                "day": source_day,
                "minutes": archetype.same_day_minutes,
                "earliest": earliest,
                "summary": f"{ctx.constraints.event_prefix} {track.name} — {topic}",
                "rank": rank,
                "deep": archetype.deep,
            }
        )
        for spaced in archetype.spaced:
            target = source_day + timedelta(days=spaced.offset_days)
            target_project = _ensure_project(plan, track, target, rows)
            _add_task(plan, track, target_project, target, spaced.task, topic, f"plus-{spaced.offset_days}")
            proposals.append(
                {
                    "key": f"{track.id}|block|{target.isoformat()}|+{spaced.offset_days}d",
                    "track": track,
                    "day": target,
                    "minutes": spaced.minutes,
                    "earliest": aware_morning(target, tz),
                    "summary": f"{ctx.constraints.event_prefix} {track.name} — {spaced.task.format(topic=topic)}",
                    "rank": rank + 30 + spaced.offset_days,
                    "deep": archetype.deep,
                }
            )

    for proposal in sorted(proposals, key=lambda item: (item["day"], item["rank"])):
        key = proposal["key"]
        if has_key(ctx.state, key) or key in placed_keys:
            plan.skipped.append(Skipped(key, "already recorded in state_manifest.json"))
            continue
        day = proposal["day"]
        existing = deep_added[day.isoformat()] + count_deep_blocks(
            ctx.events, day, ctx.constraints.event_prefix, ctx.constraints.timezone
        )
        if proposal["deep"] and existing >= ctx.constraints.max_deep_blocks_per_day:
            plan.unscheduled.append(
                Unscheduled(
                    key,
                    proposal["track"].id,
                    proposal["summary"],
                    day,
                    proposal["minutes"],
                    "burnout cap",
                )
            )
            continue
        slot = place_block(
            day,
            proposal["minutes"],
            proposal["earliest"],
            ctx.busy,
            ctx.constraints,
        )
        if slot is None:
            plan.unscheduled.append(
                Unscheduled(
                    key,
                    proposal["track"].id,
                    proposal["summary"],
                    day,
                    proposal["minutes"],
                    "no open slot outside protected windows",
                )
            )
            continue
        start, end = slot
        description = f"brain-key: {key}\norigin: study block\ntrack: {proposal['track'].id}"
        plan.events.append(
            PlannedEvent(
                key=key,
                summary=proposal["summary"][:180],
                start=start,
                end=end,
                track_id=proposal["track"].id,
                description=description,
                priority=proposal["rank"],
            )
        )
        ctx.busy.append(Interval(start, end, key))
        placed_keys.add(key)
        if proposal["deep"]:
            deep_added[day.isoformat()] += 1

    _attach_dump_tasks(plan, ctx)
    _validate_links(plan)
    return plan


def aware_morning(day: date, tz: ZoneInfo) -> datetime:
    return datetime.combine(day, time(7, 0), tzinfo=tz)


def _attach_dump_tasks(plan: Plan, ctx: RunContext) -> None:
    if not getattr(ctx, "rewrite_dump", False):
        return
    raw_bullets = list(getattr(ctx, "dump_bullets", []) or [])
    consumed = []
    remaining = []
    for bullet in raw_bullets:
        if not is_actionable(bullet):
            remaining.append(bullet)
            continue
        track = match_track(bullet, ctx.tracks)
        if track is None:
            remaining.append(bullet)
            plan.notes.append(f"Inbox bullet left in place because no track matched: {bullet}")
            continue
        rows = ctx.schedules.get(track.id, [])
        project = _ensure_project(plan, track, ctx.day, rows)
        key = f"{track.id}|dump|{ctx.day.isoformat()}|{_slug(bullet)}"
        if has_key(ctx.state, key) or any(task.key == key for task in plan.tasks):
            consumed.append(bullet)
            continue
        plan.tasks.append(
            PlannedTask(
                key=key,
                name=bullet,
                track_id=track.id,
                project_key=project.key,
                priority=project.priority,
                source_date=ctx.day,
                notes="Daily Task Dump",
            )
        )
        consumed.append(bullet)
    lines = [f"### {ctx.day.isoformat()}"]
    timed = sorted(plan.events, key=lambda event: event.start)
    for event in timed:
        if event.start.date() != ctx.day:
            continue
        start = event.start.strftime("%H:%M")
        end = event.end.strftime("%H:%M")
        lines.append(f"- {start}–{end} {event.summary}")
    for item in plan.unscheduled:
        if item.day == ctx.day:
            lines.append(f"- unscheduled ({item.reason}) {item.summary}")
    for task in plan.tasks:
        if task.source_date == ctx.day and task.notes == "Daily Task Dump":
            lines.append(f"- task {task.name}")
    plan.dump = DumpRewrite(remaining, lines, consumed)


def _validate_links(plan: Plan) -> None:
    projects = {project.key for project in plan.projects}
    for task in plan.tasks:
        if task.project_key not in projects:
            raise RuntimeError(f"Refusing orphan task {task.key} with no project")
        if not task.name.strip():
            raise RuntimeError(f"Refusing untitled task {task.key}")
    for project in plan.projects:
        if not project.area_name or not project.work_start or not project.work_end:
            raise RuntimeError(f"Project {project.key} is missing Area or Work Time")


def ingest_quick_notes(plan: Plan, ctx: RunContext, notes: List[dict]) -> None:
    """notes items: title, body, hint, page_id."""
    for note in notes:
        hint = note.get("hint") or ""
        body = note.get("body") or ""
        title = note.get("title") or "Untitled note"
        track = match_track(f"{hint} {title} {body}", ctx.tracks)
        if track is None:
            plan.notes.append(f"Quick Add note left unprocessed because no track matched: {title}")
            continue
        rows = ctx.schedules.get(track.id, [])
        project = _ensure_project(plan, track, ctx.day, rows)
        task_keys = []
        from brain.dump import actionable_lines

        for line in actionable_lines(body) or []:
            key = f"{track.id}|note|{ctx.day.isoformat()}|{_slug(line)}"
            if has_key(ctx.state, key) or any(task.key == key for task in plan.tasks):
                continue
            plan.tasks.append(
                PlannedTask(
                    key=key,
                    name=line,
                    track_id=track.id,
                    project_key=project.key,
                    priority=project.priority,
                    source_date=ctx.day,
                    notes=f"Quick Add: {title}",
                )
            )
            task_keys.append(key)
        plan.quick_add.append(
            QuickAddResult(
                page_id=str(note.get("page_id") or ""),
                title=title,
                area_name=track.area,
                project_key=project.key,
                task_keys=task_keys,
            )
        )
    _validate_links(plan)


def render_plan(plan: Plan) -> str:
    lines = [f"Brain plan for {plan.day.isoformat()}"]
    if plan.notes:
        lines.append("")
        lines.append("Notes")
        for note in plan.notes:
            lines.append(f"- {note}")
    lines.append("")
    lines.append("Areas")
    if plan.areas:
        for area in plan.areas:
            lines.append(f"- ensure {area.name}")
    else:
        lines.append("- none")
    lines.append("")
    lines.append("Projects")
    if plan.projects:
        for project in plan.projects:
            lines.append(
                f"- {project.name} | {project.area_name} | {project.work_start.isoformat()} → {project.work_end.isoformat()} | {project.priority}"
            )
    else:
        lines.append("- none")
    lines.append("")
    lines.append("Tasks")
    if plan.tasks:
        for task in plan.tasks:
            lines.append(f"- {task.name}")
            lines.append(f"  project {task.project_key}")
    else:
        lines.append("- none")
    lines.append("")
    lines.append("Calendar blocks")
    if plan.events:
        for event in plan.events:
            lines.append(
                f"- {event.start.strftime('%Y-%m-%d %H:%M')}–{event.end.strftime('%H:%M')} {event.summary}"
            )
    else:
        lines.append("- none")
    if plan.unscheduled:
        lines.append("")
        lines.append("Unscheduled")
        for item in plan.unscheduled:
            lines.append(f"- {item.day.isoformat()} {item.summary} ({item.reason})")
    if plan.skipped:
        lines.append("")
        lines.append("Skipped")
        for item in plan.skipped:
            lines.append(f"- {item.key} ({item.reason})")
    if plan.dump is not None:
        lines.append("")
        lines.append("Daily Task Dump")
        for line in plan.dump.execution_lines:
            lines.append(line)
        if plan.dump.inbox_remaining:
            lines.append("Inbox still open:")
            for item in plan.dump.inbox_remaining:
                lines.append(f"- {item}")
    return "\n".join(lines) + "\n"
