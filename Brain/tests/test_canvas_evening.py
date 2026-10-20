from datetime import datetime
from zoneinfo import ZoneInfo

from brain.canvas_sync import due_items, load_profiles, plan_canvas_tasks, profiles_text
from brain.gemini_menu import build_prompt, planning_windows, validate_blocks
from brain.icscal import events_from_ics
from brain.models import Constraints, ProtectedWindow, Track

TZ = ZoneInfo("America/Chicago")


def constraints():
    return Constraints(
        timezone="America/Chicago",
        day_end="22:00",
        max_deep_blocks_per_day=2,
        event_prefix="[Auto-Study]",
        protected_windows=(
            ProtectedWindow(("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"), "00:00", "07:00", "Sleep"),
            ProtectedWindow(("Mon", "Fri"), "08:00", "12:00", "Radiology Research"),
        ),
        all_day_busy_keywords=(),
    )


def test_evening_horizon_keeps_next_morning_block():
    now = datetime(2026, 10, 19, 20, 44, tzinfo=TZ)
    evening, wrap, tomorrow = planning_windows(now, [], constraints())
    assert evening
    assert wrap
    assert wrap[0][1] - wrap[0][0] <= __import__("datetime").timedelta(minutes=45)
    assert tomorrow[0][0].hour == 7
    long_tonight = [(now, datetime(2026, 10, 19, 22, 0, tzinfo=TZ))]
    windows = long_tonight + tomorrow
    option = {
        "blocks": [
            {"date": "2026-10-19", "start": "21:00", "end": "23:00", "line": "[Auto-Study] Wrap physiology"},
            {"date": "2026-10-20", "start": "09:00", "end": "10:30", "line": "[Auto-Study] Tuesday derivations"},
        ]
    }
    notes = validate_blocks(option, now.date(), windows, constraints(), evening=True)
    rendered = "\n".join(option["render"])
    assert "2026-10-20 09:00" in rendered
    assert "2026-10-19" in rendered
    assert any("Shortened" in note for note in notes)
    missed = {
        "blocks": [
            {"date": "2026-10-19", "start": "18:00", "end": "19:00", "line": "[Auto-Study] Missed wrap"},
            {"date": "2026-10-20", "start": "09:00", "end": "10:00", "line": "[Auto-Study] Tuesday kept"},
        ]
    }
    notes = validate_blocks(missed, now.date(), wrap + tomorrow, constraints(), evening=True)
    rendered = "\n".join(missed["render"])
    assert "2026-10-19" in rendered
    assert "2026-10-20 09:00" in rendered
    assert any("wrap-up window" in note for note in notes)


def test_canvas_assignment_links_to_project_and_skips_unmatched():
    payload = """BEGIN:VCALENDAR
BEGIN:VEVENT
UID:hw1
DTSTART;VALUE=DATE:20261020
DTEND;VALUE=DATE:20261021
SUMMARY:EMA 303 Homework 4
DESCRIPTION:problem set
END:VEVENT
BEGIN:VEVENT
UID:club
DTSTART;VALUE=DATE:20261021
DTEND;VALUE=DATE:20261022
SUMMARY:Club social assignment
END:VEVENT
END:VCALENDAR
""".encode()
    start = datetime(2026, 10, 19, tzinfo=TZ)
    events = events_from_ics(payload, start, start.replace(day=19) + __import__("datetime").timedelta(days=16), "America/Chicago")
    track = Track(
        id="EMA_303",
        name="EMA 303",
        area="EMA 303",
        archetype="quant_engineering",
        trigger="calendar",
        enabled=True,
        priority="Medium",
        course_dir=".",
        event_pattern=r"EMA\s*303",
    )
    items = due_items(events, [track], start.date())
    assert len(items) == 2
    areas, projects, tasks = plan_canvas_tasks(items)
    assert len(tasks) == 1
    assert tasks[0].project_key == projects[0].key
    assert areas[0].name == "EMA 303"
    assert "Homework 4" in tasks[0].name


def test_prompt_includes_profile_rules():
    profiles = profiles_text(load_profiles(__import__("pathlib").Path(__file__).resolve().parents[1]))
    prompt = build_prompt(
        datetime(2026, 10, 19).date(),
        [],
        [],
        [],
        [],
        constraints(),
        profiles,
        [],
        True,
        datetime(2026, 10, 20).date(),
    )
    assert "image occlusion strictly restricted to anatomical structures and diagrams" in prompt
    assert "Never fragment pathways into cloze cards" in prompt
    assert "2026-10-20" in prompt
