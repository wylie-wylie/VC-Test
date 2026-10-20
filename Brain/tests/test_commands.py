from datetime import date
from pathlib import Path

from brain.commands import add_course, swap_course
from brain.discover import discover_tracks


def _root(tmp_path: Path) -> Path:
    (tmp_path / "brain_config.yaml").write_text(
        "timezone: America/Chicago\nterm_year: 2026\ntracks:\n# end tracks\n"
    )
    (tmp_path / "courses").mkdir()
    return tmp_path


def test_add_course_writes_config_not_engine(tmp_path: Path):
    root = _root(tmp_path)
    engine = Path(__file__).resolve().parents[1] / "brain" / "pipeline.py"
    before = engine.read_text()
    syllabus = tmp_path / "plan.md"
    syllabus.write_text(
        "| Date (YYYY-MM-DD) | Module | Topic | Deliverable |\n"
        "| --- | --- | --- | --- |\n"
        "| 2026-11-02 | Block 4 | CARS passages | Timed set |\n"
    )
    course = add_course(
        root,
        "NEW_440",
        name="New 440",
        archetype="quant_engineering",
        trigger="calendar",
        syllabus=syllabus,
        code="NEW 440",
        term_start="2026-09-02",
        term_year=2026,
    )
    assert (course / "track.yaml").is_file()
    assert "2026-11-02" in (course / "syllabus_schedule.md").read_text()
    assert "NEW_440" in (root / "brain_config.yaml").read_text()
    assert engine.read_text() == before
    found = discover_tracks(root, root / "courses", {"NEW_440": {"id": "NEW_440", "enabled": True}})
    assert [track.id for track in found] == ["NEW_440"]


def test_swap_disables_old_track(tmp_path: Path):
    root = _root(tmp_path)
    add_course(root, "OLD_101", name="Old 101", archetype="bio_physiology", trigger="calendar", term_year=2026)
    swap_course(
        root,
        "OLD_101",
        "NEW_102",
        name="New 102",
        archetype="mcat_block",
        trigger="cadence",
        cadence_days=["Tue", "Thu"],
        term_year=2026,
    )
    text = (root / "brain_config.yaml").read_text()
    assert "enabled: false" in text
    assert "NEW_102" in text
    registry = {}
    # discover reads enabled from the merged registry written into yaml via track files
    from brain.config import load_config

    # load_config needs BRAIN_HOME; call discover with parsed registry instead
    import yaml

    raw = yaml.safe_load((root / "brain_config.yaml").read_text())
    for entry in raw["tracks"]:
        registry[entry["id"]] = entry
    tracks = discover_tracks(root, root / "courses", registry)
    assert [track.id for track in tracks] == ["NEW_102"]
    assert tracks[0].cadence_days == ("Tue", "Thu")


def test_dump_bullet_becomes_linked_task(tmp_path: Path):
    from datetime import datetime
    from zoneinfo import ZoneInfo

    from brain.models import Constraints, ProtectedWindow, Track
    from brain.pipeline import RunContext, build_plan

    track = Track(
        id="LAB_1",
        name="Lab One",
        area="Lab Area",
        archetype="research_engineering",
        trigger="cadence",
        enabled=True,
        priority="High",
        course_dir=str(tmp_path),
        cadence_days=("Mon",),
        code="LAB",
    )
    constraints = Constraints(
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
    ctx = RunContext(
        day=date(2026, 10, 19),
        tracks=[track],
        schedules={track.id: []},
        events=[],
        busy=[],
        state={"entries": {}},
        constraints=constraints,
        calendar_offline=True,
        syllabus_fallback=False,
        dump_bullets=["Finish the segmentation export for LAB"],
    )
    plan = build_plan(ctx)
    assert any("segmentation export" in task.name for task in plan.tasks)
    assert all(task.project_key in plan.project_keys() for task in plan.tasks)
    assert plan.dump is not None
    assert plan.dump.consumed
    assert datetime(2026, 10, 19, 12, 0, tzinfo=ZoneInfo("America/Chicago")) == plan.events[0].start
