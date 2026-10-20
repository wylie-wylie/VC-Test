from __future__ import annotations

import json
import re
from datetime import datetime, timedelta
from pathlib import Path
from typing import List, Optional
from zoneinfo import ZoneInfo

from brain.schedule import open_windows
from brain.syllabus import load_schedule, lookup_row, newest_slide, slide_blurb, topic_label


MODELS = ("gemini-3.8-flash", "gemini-2.5-flash")


class GeminiError(RuntimeError):
    pass


def _public(exc: Exception, secret: str) -> str:
    text = str(exc)
    if secret:
        text = text.replace(secret, "[key]")
    return text[:400]


def parse_menu_payload(text: str) -> dict:
    cleaned = text.strip()
    fence = re.search(r"```(?:json)?\s*(\{.*\})\s*```", cleaned, re.S)
    if fence:
        cleaned = fence.group(1)
    else:
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start >= 0 and end > start:
            cleaned = cleaned[start : end + 1]
    data = json.loads(cleaned)
    options = data.get("options") or []
    if len(options) != 3:
        raise GeminiError("Gemini menu did not contain exactly three options")
    ids = [str(option.get("id") or "").upper() for option in options]
    if ids != ["A", "B", "C"]:
        raise GeminiError("Gemini menu options must be A, B, and C in that order")
    return data


def generate_menu(api_key: str, prompt: str) -> tuple:
    if not api_key:
        raise GeminiError("GEMINI_API_KEY is not set")
    try:
        from google import genai
    except ImportError as exc:
        raise GeminiError("google-genai is not installed") from exc
    client = genai.Client(api_key=api_key)
    errors = []
    for model in MODELS:
        try:
            response = client.models.generate_content(model=model, contents=prompt)
        except Exception as exc:
            errors.append(f"{model}: {_public(exc, api_key)}")
            continue
        text = getattr(response, "text", None) or ""
        if not text:
            errors.append(f"{model}: empty response")
            continue
        try:
            return model, parse_menu_payload(text)
        except (json.JSONDecodeError, GeminiError) as exc:
            errors.append(f"{model}: {_public(exc, api_key)}")
    raise GeminiError("Gemini did not return a usable menu. " + " | ".join(errors))


def course_context(tracks) -> str:
    chunks = []
    for track in tracks:
        rows = load_schedule(Path(track.schedule_path))
        lines = [f"## {track.name} ({track.archetype})"]
        for row in rows:
            if row.date is None:
                continue
            lines.append(
                f"{row.date.isoformat()} | {row.module} | {row.topic} | {row.deliverable}"
            )
        text = "\n".join(lines)
        slide = newest_slide(Path(track.slides_dir))
        blurb = slide_blurb(slide)
        if blurb:
            text += f"\nNewest slide: {blurb}"
        chunks.append(text[:3500])
    return "\n\n".join(chunks)[:12000]


def build_prompt(day, tracks, tasks: List[str], lectures: List[tuple], windows, constraints, profiles: str, canvas_lines: List[str], evening: bool, next_day) -> str:
    lecture_lines = []
    for track, event in lectures:
        rows = load_schedule(Path(track.schedule_path))
        topic = topic_label(lookup_row(rows, event.start.date()), event.summary)
        lecture_lines.append(
            f"- {event.start.strftime('%Y-%m-%d %H:%M')}-{event.end.strftime('%H:%M')} {event.summary}: {topic}"
        )
    window_lines = [
        f"- {start.strftime('%Y-%m-%d %H:%M')}-{end.strftime('%H:%M')}" for start, end in windows
    ]
    task_lines = [f"- {name}" for name in tasks[:40]]
    horizon = (
        f"It is after 19:30 on {day.isoformat()}. Put at most one wrap-up block tonight, no longer than 45 minutes, inside tonight's window. "
        f"Put the real study blocks on {next_day.isoformat()} inside that day's open windows. Do not discard a block only because it does not fit before 22:00 tonight."
        if evening
        else f"Plan {day.isoformat()} inside the open windows. At most 2 deep blocks that day."
    )
    return f"""You plan study blocks. Use only the lectures, Canvas dues, tasks, syllabus rows, open windows, and study rules below.
Return JSON only, no markdown, with this shape:
{{
  "triage": [{{"task": "", "priority": "now|soon|later", "reason": ""}}],
  "options": [
    {{"id": "A", "label": "Exam-first", "why": "", "blocks": [{{"date": "YYYY-MM-DD", "start": "HH:MM", "end": "HH:MM", "line": "[Auto-Study] ..."}}]}},
    {{"id": "B", "label": "Balanced lecture review", "why": "", "blocks": []}},
    {{"id": "C", "label": "Light recovery", "why": "", "blocks": []}}
  ]
}}
Rules:
- Option A is exam and due-date first. Option B balances completed lectures with the area study rules. Option C is the lighter plan.
- {horizon}
- Every block must sit inside one listed open window. Include the window's date on the block.
- Never use 00:00-07:00. Never use Monday or Friday 08:00-12:00.
- At most 2 deep blocks on {next_day.isoformat() if evening else day.isoformat()}, plus the optional tonight wrap-up when it is after 19:30.
- Prefix every block line with [Auto-Study].
- Follow the area study rules exactly when the block names that area. Image occlusion is only for anatomical structures and diagrams. Do not fragment pathways into cloze cards.
- Tie each block to a Canvas due item, a completed lecture, or an open Active Task.

Timezone: {constraints.timezone}
Day ends: {constraints.day_end}
Completed lectures:
{chr(10).join(lecture_lines) or "- none"}
Canvas homework, quizzes, and project dues:
{chr(10).join(canvas_lines) or "- none"}
Open windows:
{chr(10).join(window_lines) or "- none"}
Open Active Tasks:
{chr(10).join(task_lines) or "- none"}

Area study rules, follow these exactly:
{profiles or "- none"}

Local syllabus and slides:
{course_context(tracks)}
"""


def fallback_menu(lectures, windows, prefix: str) -> dict:
    def block_for(index: int, minutes: int):
        if index >= len(windows):
            return []
        start, end = windows[index]
        end = min(end, start + timedelta(minutes=minutes))
        if end <= start:
            return []
        if not lectures:
            line = f"{prefix} Open review"
        else:
            track, event = lectures[min(index, len(lectures) - 1)]
            line = f"{prefix} {track.name} — {event.summary}"
        return [{
            "date": start.date().isoformat(),
            "start": start.strftime("%H:%M"),
            "end": end.strftime("%H:%M"),
            "line": line[:180],
        }]

    return {
        "triage": [],
        "options": [
            {"id": "A", "label": "Exam-first", "why": "Uses the first full open window for the top due item or completed lecture.", "blocks": block_for(0, 90) + block_for(1, 75)},
            {"id": "B", "label": "Balanced lecture review", "why": "One wrap-up if tonight is short, then the next day's first open window.", "blocks": block_for(0, 45) + block_for(min(1, max(len(windows) - 1, 0)), 75)},
            {"id": "C", "label": "Light recovery", "why": "A single shorter block in the last listed window.", "blocks": block_for(max(len(windows) - 1, 0), 45)},
        ],
        "source": "fallback",
    }


def _combine(day, clock: str, tz: ZoneInfo) -> datetime:
    hour, minute = [int(part) for part in clock.split(":")[:2]]
    return datetime.combine(day, datetime.min.time(), tzinfo=tz).replace(hour=hour, minute=minute)


def place_in_windows(day, start_clock: str, end_clock: str, windows, tz: ZoneInfo, evening: bool, explicit_date=None):
    """Attach a clock range to tonight or the next day, whichever window contains it."""
    from datetime import date as date_cls

    dates = []
    if explicit_date:
        dates = [explicit_date if isinstance(explicit_date, date_cls) else date_cls.fromisoformat(str(explicit_date))]
    else:
        for start, _end in windows:
            if start.date() not in dates:
                dates.append(start.date())
        if day not in dates:
            dates.insert(0, day)
    candidates = []
    for when in dates:
        try:
            start = _combine(when, start_clock, tz)
            end = _combine(when, end_clock, tz)
        except (ValueError, TypeError):
            continue
        if end <= start:
            continue
        for window_start, window_end in windows:
            if start >= window_start and end <= window_end:
                candidates.append((start, end))
                break
            if start >= window_start and start < window_end and end > window_end:
                candidates.append((start, window_end))
                break
    if not candidates:
        return None
    if evening:
        later = [item for item in candidates if item[0].date() > day]
        early = [item for item in candidates if item[0].time() >= datetime.strptime("19:30", "%H:%M").time() and item[0].date() == day]
        if early:
            return early[0]
        if later:
            return later[0]
    return candidates[0]


def validate_blocks(option: dict, day, windows, constraints, evening: bool = False) -> List[str]:
    tz = ZoneInfo(constraints.timezone)
    notes = []
    kept = []
    next_day_count = 0
    tonight_count = 0
    for block in option.get("blocks") or []:
        try:
            placed = place_in_windows(
                day,
                str(block["start"]),
                str(block["end"]),
                windows,
                tz,
                evening,
                block.get("date"),
            )
        except (KeyError, ValueError, TypeError):
            notes.append("Dropped a block with a bad time.")
            continue
        line = str(block.get("line") or "").strip()
        if not line.startswith("[Auto-Study]"):
            line = f"[Auto-Study] {line}"
        if placed is None and evening:
            tonight_windows = [item for item in windows if item[0].date() == day]
            explicit = str(block.get("date") or "")
            if tonight_windows and tonight_count == 0 and explicit in {"", day.isoformat()}:
                start, end = tonight_windows[0]
                placed = (start, end)
                notes.append(f"Moved {line} into tonight's wrap-up window.")
        if placed is None:
            notes.append(f"Dropped {line} because it sits outside an open window.")
            continue
        start, end = placed
        if evening and start.date() == day and end - start > timedelta(minutes=45):
            end = start + timedelta(minutes=45)
            notes.append(f"Shortened tonight's wrap-up for {line} to 45 minutes.")
        if evening and start.date() == day:
            tonight_count += 1
            if tonight_count > 1:
                notes.append(f"Dropped extra tonight block {line}.")
                continue
        if start.date() != day:
            next_day_count += 1
            if next_day_count > 2:
                notes.append(f"Dropped extra next-day block {line}.")
                continue
        kept.append(f"- {start.strftime('%Y-%m-%d %H:%M')}–{end.strftime('%H:%M')} {line}")
    option["render"] = kept
    return notes


def render_menu(payload: dict, model: Optional[str], extra_notes: List[str]) -> str:
    lines = [f"Study menu via {model or 'local fallback'}"]
    for note in extra_notes:
        lines.append(f"- {note}")
    triage = payload.get("triage") or []
    if triage:
        lines.append("")
        lines.append("Active task triage")
        for item in triage[:12]:
            lines.append(f"- {item.get('priority', '')}: {item.get('task', '')} — {item.get('reason', '')}")
    lines.append("")
    for option in payload.get("options") or []:
        lines.append(f"Option {option.get('id')}: {option.get('label')}")
        if option.get("why"):
            lines.append(f"  {option.get('why')}")
        for row in option.get("render") or []:
            lines.append(f"  {row}")
        if not option.get("render"):
            lines.append("  No block fits an open window.")
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def planning_windows(now: datetime, busy, constraints):
    """After 19:30, keep one short wrap-up tonight and open the next day fully."""
    from brain.schedule import open_windows

    today = now.date()
    tonight = clip_windows(open_windows(today, busy, constraints, minimum_minutes=20), now, minimum_minutes=20)
    evening = now.time() >= datetime.strptime("19:30", "%H:%M").time()
    if not evening:
        return False, tonight, []
    wrap = []
    candidates = []
    for start, end in tonight:
        wrap_end = min(end, start + timedelta(minutes=45))
        if wrap_end - start >= timedelta(minutes=20):
            candidates.append((start, wrap_end))
    if candidates:
        wrap.append(max(candidates, key=lambda item: item[1] - item[0]))
    tomorrow = open_windows(today + timedelta(days=1), busy, constraints, minimum_minutes=30)
    return True, wrap, tomorrow


def clip_windows(windows, now: datetime, minimum_minutes: int = 30):
    kept = []
    minimum = timedelta(minutes=minimum_minutes)
    for start, end in windows:
        if end <= now:
            continue
        if start < now:
            start = now
        if end - start >= minimum:
            kept.append((start, end))
    return kept


def execution_for(day, option: dict) -> list:
    lines = [f"### {day.isoformat()} Option {option.get('id')} — {option.get('label')}"]
    lines.extend(option.get("render") or [])
    return lines


def option_by_id(payload: dict, choice: str) -> dict:
    wanted = choice.strip().upper()
    for option in payload.get("options") or []:
        if str(option.get("id") or "").upper() == wanted:
            return option
    raise GeminiError(f"No option {wanted}")
