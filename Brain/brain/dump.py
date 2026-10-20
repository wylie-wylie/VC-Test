from __future__ import annotations

import re
from pathlib import Path
from typing import List, Optional, Tuple


INBOX_HEADING = "## Inbox"
EXECUTION_HEADING = "## Execution"
_ACTION = re.compile(
    r"^(?:todo|action|submit|finish|email|review|write|drill|complete|send|schedule|read)\b",
    re.I,
)


def split_dump(text: str) -> Tuple[str, List[str], str]:
    if EXECUTION_HEADING not in text:
        text = text.rstrip() + f"\n\n{EXECUTION_HEADING}\n"
    if INBOX_HEADING not in text:
        text = f"{INBOX_HEADING}\n\n" + text
    before, _, after = text.partition(INBOX_HEADING)
    inbox_blob, _, _execution = after.partition(EXECUTION_HEADING)
    bullets = []
    for line in inbox_blob.splitlines():
        stripped = line.strip()
        if stripped.startswith(("-", "*")):
            bullets.append(stripped.lstrip("-* ").strip())
    return before, bullets, inbox_blob


def is_actionable(bullet: str) -> bool:
    if bullet.lower().startswith("[ ]") or bullet.lower().startswith("[todo]"):
        return True
    return bool(_ACTION.search(bullet))


def match_track(bullet: str, tracks) -> Optional[object]:
    lowered = bullet.lower()
    best = None
    best_score = 0
    for track in tracks:
        weighted = (
            (track.id, 100),
            (track.code, 90),
            (track.name, 80),
            (track.area, 70),
        )
        score = 0
        for token, weight in weighted:
            probe = (token or "").strip().lower()
            if len(probe) < 3:
                continue
            if probe in lowered:
                score = max(score, weight + len(probe))
        if score > best_score:
            best = track
            best_score = score
    return best


def render_dump(inbox_remaining: List[str], execution_lines: List[str]) -> str:
    inbox = "\n".join(f"- {item}" for item in inbox_remaining)
    execution = "\n".join(execution_lines)
    return f"{INBOX_HEADING}\n{inbox}\n\n{EXECUTION_HEADING}\n{execution}\n"


def load_quick_notes(directory: Path) -> List[Tuple[Path, str]]:
    if not directory.is_dir():
        return []
    notes = []
    for path in sorted(directory.glob("*.md")):
        text = path.read_text()
        if re.search(r"(?m)^processed:\s*true\s*$", text):
            continue
        notes.append((path, text))
    return notes


def note_title(text: str, fallback: str) -> str:
    for line in text.splitlines():
        if line.startswith("# "):
            return line[2:].strip()
    return fallback


def note_hint(text: str) -> str:
    match = re.search(r"(?m)^area_hint:\s*(.+)$", text)
    return match.group(1).strip() if match else ""


def actionable_lines(text: str) -> List[str]:
    found = []
    for line in text.splitlines():
        stripped = line.strip().lstrip("-* ").strip()
        if not stripped or stripped.startswith("#") or stripped.startswith("---"):
            continue
        if stripped.lower().startswith("area_hint:"):
            continue
        if is_actionable(stripped) or stripped.lower().startswith("todo"):
            found.append(stripped)
    return found


def mark_note_processed(path: Path) -> None:
    text = path.read_text()
    if re.search(r"(?m)^processed:\s*false\s*$", text):
        text = re.sub(r"(?m)^processed:\s*false\s*$", "processed: true", text, count=1)
    elif "processed:" not in text:
        text = f"---\nprocessed: true\n---\n{text}"
    else:
        text = re.sub(r"(?m)^processed:\s*.*$", "processed: true", text, count=1)
    path.write_text(text)
