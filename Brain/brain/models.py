from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from pathlib import Path
from typing import Optional


DAYS = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")


def weekday_token(value: date) -> str:
    return DAYS[value.weekday()]


@dataclass(frozen=True)
class ProtectedWindow:
    days: tuple
    start: str
    end: str
    label: str


@dataclass(frozen=True)
class Constraints:
    timezone: str
    day_end: str
    max_deep_blocks_per_day: int
    event_prefix: str
    protected_windows: tuple
    all_day_busy_keywords: tuple


@dataclass(frozen=True)
class Track:
    id: str
    name: str
    area: str
    archetype: str
    trigger: str
    enabled: bool
    priority: str
    course_dir: str
    event_pattern: str = ""
    cadence_days: tuple = ()
    term_start: Optional[date] = None
    term_end: Optional[date] = None
    code: str = ""

    @property
    def slides_dir(self) -> str:
        return str(Path(self.course_dir) / "slides")

    @property
    def schedule_path(self) -> str:
        return str(Path(self.course_dir) / "syllabus_schedule.md")


@dataclass(frozen=True)
class ScheduleRow:
    date: Optional[date]
    module: str
    topic: str
    deliverable: str

    @property
    def is_no_class(self) -> bool:
        blob = f"{self.topic} {self.deliverable}".lower()
        return "no class" in blob

    @property
    def is_exam(self) -> bool:
        blob = f"{self.module} {self.topic} {self.deliverable}".lower()
        return any(word in blob for word in ("exam", "midterm", "final"))


@dataclass(frozen=True)
class Interval:
    start: datetime
    end: datetime
    label: str = ""


@dataclass(frozen=True)
class CalendarEvent:
    id: str
    summary: str
    start: datetime
    end: datetime
    description: str = ""
    all_day: bool = False
    transparent: bool = False


@dataclass
class PlannedArea:
    name: str
    key: str


@dataclass
class PlannedProject:
    key: str
    name: str
    area_name: str
    track_id: str
    work_start: date
    work_end: date
    priority: str


@dataclass
class PlannedTask:
    key: str
    name: str
    track_id: str
    project_key: str
    priority: str
    source_date: date
    notes: str = ""


@dataclass
class PlannedEvent:
    key: str
    summary: str
    start: datetime
    end: datetime
    track_id: str
    description: str
    priority: int = 50


@dataclass
class Unscheduled:
    key: str
    track_id: str
    summary: str
    day: date
    minutes: int
    reason: str


@dataclass
class Skipped:
    key: str
    reason: str


@dataclass
class DumpRewrite:
    inbox_remaining: list
    execution_lines: list
    consumed: list


@dataclass
class QuickAddResult:
    page_id: str
    title: str
    area_name: str
    project_key: str
    task_keys: list


@dataclass
class Plan:
    day: date
    areas: list = field(default_factory=list)
    projects: list = field(default_factory=list)
    tasks: list = field(default_factory=list)
    events: list = field(default_factory=list)
    unscheduled: list = field(default_factory=list)
    skipped: list = field(default_factory=list)
    notes: list = field(default_factory=list)
    dump: Optional[DumpRewrite] = None
    quick_add: list = field(default_factory=list)

    def task_project_keys(self) -> set:
        return {task.project_key for task in self.tasks}

    def project_keys(self) -> set:
        return {project.key for project in self.projects}
