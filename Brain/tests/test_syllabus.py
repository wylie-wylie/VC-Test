from datetime import date
from pathlib import Path

from brain.syllabus import lookup_row, parse_grid_text, parse_narrative_text, topic_label

FIXTURE = Path(__file__).parent / "fixtures"


def test_grid_repairs_weekday_and_carries_module():
    rows = parse_grid_text((FIXTURE / "ema_snippet.txt").read_text(), 2026, date(2026, 9, 2))
    by_date = {row.date: row for row in rows}
    assert date(2026, 9, 4) in by_date
    assert by_date[date(2026, 9, 7)].is_no_class
    assert "Stress" in by_date[date(2026, 9, 3)].topic
    assert by_date[date(2026, 10, 7)].deliverable == "Midterm 1"
    assert "Bending" in by_date[date(2026, 10, 19)].module or "Bending" in by_date[date(2026, 10, 19)].topic
    assert by_date[date(2026, 12, 15)].is_exam


def test_narrative_units_follow_exams():
    rows = parse_narrative_text((FIXTURE / "anat_snippet.txt").read_text(), 2026, date(2026, 9, 2))
    october = lookup_row(rows, date(2026, 10, 19))
    assert october is not None
    assert "Cardiovascular" in october.topic or "Unit 3" in october.module
    assert any(row.date == date(2026, 10, 16) and row.deliverable == "Exam 2" for row in rows)
    assert any(row.date == date(2026, 12, 11) and row.deliverable == "Final Exam" for row in rows)


def test_exact_exam_day_beats_carried_module():
    rows = parse_narrative_text((FIXTURE / "anat_snippet.txt").read_text(), 2026, date(2026, 9, 2))
    exam = lookup_row(rows, date(2026, 10, 16))
    assert exam is not None and exam.is_exam
    assert "Exam" in topic_label(exam, "fallback")
