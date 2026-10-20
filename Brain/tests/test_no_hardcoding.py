from pathlib import Path


FORBIDDEN = ("ANAT", "EMA_303", "EMA 303", "BME_310", "BME 300", "MCAT_PREP", "WENTLAND")


def test_engine_does_not_name_courses():
    root = Path(__file__).resolve().parents[1] / "brain"
    for path in root.glob("*.py"):
        text = path.read_text()
        for token in FORBIDDEN:
            assert token not in text, f"{path.name} contains {token}"
