from __future__ import annotations

import re
from datetime import date, datetime, time, timedelta
from typing import Iterable, List, Optional
from zoneinfo import ZoneInfo

from brain.models import Constraints, Interval, weekday_token


def parse_hhmm(value: str) -> time:
    hour, minute = value.split(":")
    return time(int(hour), int(minute))


def aware(day: date, clock: time, tz: ZoneInfo) -> datetime:
    return datetime.combine(day, clock, tzinfo=tz)


def ceil_quarter(moment: datetime) -> datetime:
    moment = moment.replace(second=0, microsecond=0)
    remainder = moment.minute % 15
    if remainder == 0:
        return moment
    return moment + timedelta(minutes=15 - remainder)


def windows_for_day(day: date, constraints: Constraints) -> List[Interval]:
    token = weekday_token(day)
    tz = ZoneInfo(constraints.timezone)
    intervals = []
    for window in constraints.protected_windows:
        if token not in window.days:
            continue
        start = aware(day, parse_hhmm(window.start), tz)
        end = aware(day, parse_hhmm(window.end), tz)
        if end > start:
            intervals.append(Interval(start, end, window.label))
    return intervals


def overlaps(start: datetime, end: datetime, intervals: Iterable[Interval]) -> Optional[str]:
    for interval in intervals:
        if start < interval.end and end > interval.start:
            return interval.label or "busy"
    return None


def place_block(
    day: date,
    duration_minutes: int,
    earliest: datetime,
    busy: Iterable[Interval],
    constraints: Constraints,
) -> Optional[tuple]:
    tz = ZoneInfo(constraints.timezone)
    if earliest.tzinfo is None:
        earliest = earliest.replace(tzinfo=tz)
    earliest = earliest.astimezone(tz)
    day_start = aware(day, parse_hhmm("07:00"), tz)
    day_end = aware(day, parse_hhmm(constraints.day_end), tz)
    cursor = ceil_quarter(max(earliest, day_start))
    duration = timedelta(minutes=duration_minutes)
    forbidden = list(busy) + windows_for_day(day, constraints)
    while cursor + duration <= day_end:
        reason = overlaps(cursor, cursor + duration, forbidden)
        if reason is None:
            return cursor, cursor + duration
        cursor += timedelta(minutes=15)
    return None


def open_windows(day: date, busy: Iterable[Interval], constraints: Constraints, minimum_minutes: int = 30):
    tz = ZoneInfo(constraints.timezone)
    day_start = aware(day, parse_hhmm("07:00"), tz)
    day_end = aware(day, parse_hhmm(constraints.day_end), tz)
    blocked = list(busy) + windows_for_day(day, constraints)
    windows = []
    cursor = day_start
    step = timedelta(minutes=15)
    while cursor < day_end:
        if overlaps(cursor, min(cursor + step, day_end), blocked):
            cursor += step
            continue
        start = cursor
        while cursor < day_end and overlaps(cursor, min(cursor + step, day_end), blocked) is None:
            cursor += step
        if cursor - start >= timedelta(minutes=minimum_minutes):
            windows.append((start, cursor))
    return windows


def count_deep_blocks(events, day: date, prefix: str, tz_name: str) -> int:
    tz = ZoneInfo(tz_name)
    total = 0
    for event in events:
        if event.all_day or event.transparent:
            continue
        local = event.start.astimezone(tz)
        if local.date() != day:
            continue
        summary = event.summary or ""
        description = event.description or ""
        if summary.startswith(prefix) or "brain-key:" in description:
            total += 1
    return total


def event_matches(summary: str, pattern: str) -> bool:
    if not pattern or not summary:
        return False
    return re.search(pattern, summary, flags=re.IGNORECASE) is not None
