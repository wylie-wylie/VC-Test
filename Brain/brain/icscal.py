from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import List, Optional
from zoneinfo import ZoneInfo

import requests

from brain.models import CalendarEvent
from brain.schedule import event_matches


class IcsError(RuntimeError):
    pass


def fetch_ics(url: str) -> bytes:
    if not url:
        raise IcsError("GOOGLE_CALENDAR_ICS_URL is empty")
    try:
        response = requests.get(url, timeout=30)
    except requests.RequestException as exc:
        raise IcsError(f"ICS fetch failed: {exc.__class__.__name__}") from exc
    if response.status_code >= 400:
        raise IcsError(f"ICS fetch failed ({response.status_code})")
    return response.content


def _as_local(value, tz: ZoneInfo, end: bool = False) -> tuple:
    if isinstance(value, datetime):
        moment = value if value.tzinfo else value.replace(tzinfo=tz)
        return moment.astimezone(tz), False
    if isinstance(value, date):
        moment = datetime.combine(value, datetime.min.time(), tzinfo=tz)
        if end:
            moment += timedelta(days=1)
        return moment, True
    raise IcsError("ICS event is missing a start or end")


def events_from_ics(payload: bytes, window_start: datetime, window_end: datetime, tz_name: str) -> List[CalendarEvent]:
    from icalendar import Calendar

    tz = ZoneInfo(tz_name)
    try:
        calendar = Calendar.from_ical(payload)
    except Exception as exc:
        raise IcsError(f"ICS parse failed: {exc.__class__.__name__}") from exc
    try:
        from recurring_ical_events import of

        components = of(calendar).between(window_start, window_end)
    except Exception:
        components = [
            component
            for component in calendar.walk("VEVENT")
            if component.get("dtstart") is not None and component.get("dtend") is not None
        ]
    events = []
    for component in components:
        start_raw = component.get("dtstart")
        end_raw = component.get("dtend")
        if start_raw is None or end_raw is None:
            continue
        start, all_day = _as_local(start_raw.dt, tz, end=False)
        end, _ = _as_local(end_raw.dt, tz, end=True)
        if end <= window_start or start >= window_end:
            continue
        summary = str(component.get("summary") or "")
        description = str(component.get("description") or "")
        categories = component.get("categories")
        if categories:
            description = f"{description}\n{categories}".strip()
        transparent = str(component.get("transp") or "").upper() == "TRANSPARENT"
        events.append(
            CalendarEvent(
                id=str(component.get("uid") or summary),
                summary=summary,
                start=start,
                end=end,
                description=description,
                all_day=all_day,
                transparent=transparent,
            )
        )
    events.sort(key=lambda event: event.start)
    return events


def completed_lectures(events: List[CalendarEvent], tracks, moment: datetime) -> List[tuple]:
    found = []
    for event in events:
        if event.all_day or event.transparent or event.end > moment:
            continue
        for track in tracks:
            if track.trigger != "calendar":
                continue
            if event_matches(event.summary, track.event_pattern):
                found.append((track, event))
                break
    return found
