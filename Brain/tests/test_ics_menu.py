from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from brain.gemini_menu import parse_menu_payload
from brain.icscal import completed_lectures, events_from_ics
from brain.models import Constraints, ProtectedWindow, Track
from brain.schedule import event_matches, open_windows

TZ = ZoneInfo("America/Chicago")
PATTERN = r"ANAT\s*&?\s*PHY[S]?\s*335|ANAT\s*335|Anat\s*&?\s*Ph(?:ys|y)\s*335"
ICS = """BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//brain//EN
BEGIN:VEVENT
UID:lec1
DTSTART:20261020T190000Z
DTEND:20261020T201500Z
SUMMARY:ANAT&PHY 335 Lecture
END:VEVENT
BEGIN:VEVENT
UID:ema
DTSTART:20261020T210000Z
DTEND:20261020T221500Z
SUMMARY:EMA 303 Lecture
END:VEVENT
END:VCALENDAR
""".encode()


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


def test_phy_title_matches_and_completed_lectures_are_detected():
    assert event_matches("ANAT&PHY 335 Lecture", PATTERN)
    assert event_matches("BME 310 Lecture", r"BME\s*310")
    assert event_matches("EMA 303 Discussion", r"EMA\s*303")
    start = datetime(2026, 10, 20, 0, 0, tzinfo=TZ)
    end = datetime(2026, 10, 21, 0, 0, tzinfo=TZ)
    events = events_from_ics(ICS, start, end, "America/Chicago")
    track = Track(
        id="ANAT_335",
        name="ANAT&PHYS 335",
        area="ANAT&PHYS 335",
        archetype="bio_physiology",
        trigger="calendar",
        enabled=True,
        priority="Medium",
        course_dir=".",
        event_pattern=PATTERN,
    )
    moment = datetime(2026, 10, 20, 18, 0, tzinfo=TZ)
    done = completed_lectures(events, [track], moment)
    assert [event.summary for _track, event in done] == ["ANAT&PHY 335 Lecture"]


def test_monday_open_windows_skip_radiology_block():
    windows = open_windows(datetime(2026, 10, 19).date(), [], constraints())
    for start, end in windows:
        assert end <= datetime(2026, 10, 19, 8, 0, tzinfo=TZ) or start >= datetime(2026, 10, 19, 12, 0, tzinfo=TZ)


def test_menu_json_requires_three_options():
    payload = parse_menu_payload(
        """```json
        {"options":[
          {"id":"A","label":"Exam-first","blocks":[]},
          {"id":"B","label":"Balanced","blocks":[]},
          {"id":"C","label":"Light","blocks":[]}
        ]}
        ```"""
    )
    assert [item["id"] for item in payload["options"]] == ["A", "B", "C"]
