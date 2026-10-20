from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from brain.config import HARD_BLOCK_CAP, load_config
from brain.models import CalendarEvent, Constraints, ProtectedWindow, Track
from brain.pipeline import RunContext, build_plan
from brain.schedule import place_block
from brain.syllabus import parse_table

TZ = ZoneInfo("America/Chicago")


def constraints(cap=2):
    return Constraints(
        timezone="America/Chicago",
        day_end="22:00",
        max_deep_blocks_per_day=min(cap, HARD_BLOCK_CAP),
        event_prefix="[Auto-Study]",
        protected_windows=(
            ProtectedWindow(("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"), "00:00", "07:00", "Sleep"),
            ProtectedWindow(("Mon", "Fri"), "08:00", "12:00", "Radiology Research"),
        ),
        all_day_busy_keywords=("shift", "clinical"),
    )


def track():
    return Track(
        id="SAMPLE_101",
        name="Sample 101",
        area="Sample Area",
        archetype="quant_engineering",
        trigger="calendar",
        enabled=True,
        priority="Medium",
        course_dir=".",
        event_pattern=r"SAMPLE\s*101",
        code="SAMPLE 101",
    )


def test_monday_research_window_pushes_block_to_noon():
    earliest = datetime(2026, 10, 19, 7, 0, tzinfo=TZ)
    slot = place_block(date(2026, 10, 19), 90, earliest, [], constraints())
    assert slot is not None
    start, end = slot
    assert start == datetime(2026, 10, 19, 12, 0, tzinfo=TZ)
    assert end == datetime(2026, 10, 19, 13, 30, tzinfo=TZ)


def test_sleep_window_is_closed():
    earliest = datetime(2026, 10, 18, 6, 0, tzinfo=TZ)
    slot = place_block(date(2026, 10, 18), 60, earliest, [], constraints())
    assert slot is not None
    assert slot[0] == datetime(2026, 10, 18, 7, 0, tzinfo=TZ)


def test_burnout_cap_and_idempotent_state():
    day = date(2026, 10, 20)
    lecture = CalendarEvent(
        id="lec",
        summary="SAMPLE 101 Lecture",
        start=datetime(2026, 10, 20, 14, 0, tzinfo=TZ),
        end=datetime(2026, 10, 20, 15, 15, tzinfo=TZ),
    )
    existing = [
        CalendarEvent(
            id=f"s{i}",
            summary="[Auto-Study] already",
            start=datetime(2026, 10, 20, 16, 0, tzinfo=TZ) + timedelta(hours=i),
            end=datetime(2026, 10, 20, 16, 30, tzinfo=TZ) + timedelta(hours=i),
        )
        for i in range(2)
    ]
    rows = parse_table(
        "| Date (YYYY-MM-DD) | Module | Topic | Deliverable |\n"
        "| --- | --- | --- | --- |\n"
        "| 2026-10-20 | Module 7 | Bending | M7L2 |\n"
    )
    ctx = RunContext(
        day=day,
        tracks=[track()],
        schedules={"SAMPLE_101": rows},
        events=[lecture, *existing],
        busy=[],
        state={"entries": {}},
        constraints=constraints(),
        calendar_offline=False,
        syllabus_fallback=False,
    )
    plan = build_plan(ctx)
    assert plan.tasks
    assert all(task.project_key in plan.project_keys() for task in plan.tasks)
    assert plan.unscheduled
    assert not any(event.start.date() == day for event in plan.events)

    ctx.state = {"entries": {plan.tasks[0].key: {"kind": "task"}}}
    second = build_plan(ctx)
    assert all(task.key != plan.tasks[0].key for task in second.tasks)


def test_hard_cap_cannot_be_raised(tmp_path, monkeypatch):
    root = tmp_path
    (root / "brain_config.yaml").write_text(
        "timezone: America/Chicago\nterm_year: 2026\n"
        "constraints:\n  max_deep_blocks_per_day: 9\n"
        "tracks:\n# end tracks\n"
    )
    monkeypatch.setenv("BRAIN_HOME", str(root))
    loaded = load_config(root)
    assert loaded.constraints.max_deep_blocks_per_day == 2
    labels = [window.label for window in loaded.constraints.protected_windows]
    assert "Sleep" in labels
    assert "Radiology Research" in labels
