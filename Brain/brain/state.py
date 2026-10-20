from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path


def load_state(path: Path) -> dict:
    if not path.is_file():
        return {"version": 1, "entries": {}}
    data = json.loads(path.read_text() or "{}")
    data.setdefault("version", 1)
    data.setdefault("entries", {})
    return data


def save_state(path: Path, state: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state, indent=2, sort_keys=True) + "\n")


def has_key(state: dict, key: str) -> bool:
    return key in state.get("entries", {})


def record(state: dict, key: str, kind: str, **extra) -> None:
    state.setdefault("entries", {})[key] = {
        "kind": kind,
        "created_at": datetime.now(timezone.utc).isoformat(),
        **extra,
    }
