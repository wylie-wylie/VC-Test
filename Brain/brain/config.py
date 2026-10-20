from __future__ import annotations

import os
import re
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Optional

import yaml

from brain.models import Constraints, DAYS, ProtectedWindow


HARD_PROTECTED = (
    ProtectedWindow(DAYS, "00:00", "07:00", "Sleep"),
    ProtectedWindow(("Mon", "Fri"), "08:00", "12:00", "Radiology Research"),
)
HARD_BLOCK_CAP = 2
DEFAULT_PROPS = {
    "title": "Name",
    "area": "Area",
    "project": "Project",
    "work_time": "Work Time",
    "priority": "Priority",
    "done": "Done",
    "archive": "Archive",
    "processed": "Processed",
    "days": "Day/Days",
}
DIRECTORY_PAGES = ("Goals", "Action", "Archive")


@dataclass
class NotionSettings:
    token: str
    version: str
    areas_db: str
    projects_db: str
    tasks_db: str
    recurring_db: str
    quick_add_db: str
    daily_dump_page: str
    properties: dict

    @property
    def configured(self) -> bool:
        return bool(self.token and self.areas_db and self.projects_db and self.tasks_db)


@dataclass
class CalendarSettings:
    calendar_id: str
    token_path: str
    timezone: str

    @property
    def configured(self) -> bool:
        return bool(self.token_path and Path(self.token_path).is_file())


@dataclass
class BrainConfig:
    root: Path
    timezone: str
    term_year: int
    constraints: Constraints
    notion: NotionSettings
    calendar: CalendarSettings
    state_path: Path
    courses_dir: Path
    registry: dict
    dump_path: Path
    quick_add_dir: Path
    gemini_api_key: str = ""
    ics_url: str = ""
    canvas_ics_url: str = ""


def find_root(start: Optional[Path] = None) -> Path:
    env = os.environ.get("BRAIN_HOME")
    if env:
        return Path(env).resolve()
    here = (start or Path.cwd()).resolve()
    for candidate in [here, *here.parents]:
        if (candidate / "brain_config.yaml").is_file():
            return candidate
    package_root = Path(__file__).resolve().parent.parent
    if (package_root / "brain_config.yaml").is_file():
        return package_root
    return here


def _http_url(value: str) -> str:
    text = (value or "").strip()
    if text.lower().startswith(("http://", "https://")):
        return text
    return ""


def _env(name: str, default: str = "") -> str:
    if not name:
        return default
    return os.environ.get(name, default)


def load_dotenv(root: Path) -> None:
    """Load .env then .env.local. Existing process variables stay in place."""
    merged = {}
    for name in (".env", ".env.local"):
        path = root / name
        if not path.is_file():
            continue
        for raw in path.read_text().splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
                value = value[1:-1]
            if key:
                merged[key] = value
    for key, value in merged.items():
        os.environ.setdefault(key, value)


def load_config(root: Optional[Path] = None) -> BrainConfig:
    root = find_root(root)
    load_dotenv(root)
    path = root / "brain_config.yaml"
    raw = yaml.safe_load(path.read_text()) or {}
    timezone = raw.get("timezone", "America/Chicago")
    constraints_raw = raw.get("constraints") or {}
    extra_windows = []
    for item in constraints_raw.get("protected_windows") or []:
        extra_windows.append(
            ProtectedWindow(
                days=tuple(item.get("days") or []),
                start=str(item["start"]),
                end=str(item["end"]),
                label=str(item.get("label") or "Protected"),
            )
        )
    requested_cap = int(constraints_raw.get("max_deep_blocks_per_day", HARD_BLOCK_CAP))
    constraints = Constraints(
        timezone=timezone,
        day_end=str(constraints_raw.get("day_end", "22:00")),
        max_deep_blocks_per_day=min(requested_cap, HARD_BLOCK_CAP),
        event_prefix=str(constraints_raw.get("event_prefix", "[Auto-Study]")),
        protected_windows=HARD_PROTECTED + tuple(extra_windows),
        all_day_busy_keywords=tuple(
            constraints_raw.get("all_day_busy_keywords") or ("shift", "clinical", "on call")
        ),
    )
    notion_raw = raw.get("notion") or {}
    props = dict(DEFAULT_PROPS)
    props.update(notion_raw.get("properties") or {})
    notion = NotionSettings(
        token=_env(notion_raw.get("token_env", "NOTION_TOKEN")),
        version=str(notion_raw.get("version", "2022-06-28")),
        areas_db=_env(notion_raw.get("areas_db_env", "NOTION_AREAS_DB")),
        projects_db=_env(notion_raw.get("projects_db_env", "NOTION_PROJECTS_DB")),
        tasks_db=_env(notion_raw.get("tasks_db_env", "NOTION_TASKS_DB")),
        recurring_db=_env(notion_raw.get("recurring_db_env", "NOTION_RECURRING_DB")),
        quick_add_db=_env(notion_raw.get("quick_add_db_env", "NOTION_QUICK_ADD_DB")),
        daily_dump_page=_env(notion_raw.get("daily_dump_page_env", "NOTION_DAILY_DUMP_PAGE")),
        properties=props,
    )
    gemini_raw = raw.get("gemini") or {}
    calendar_raw = raw.get("calendar") or {}
    token_path = calendar_raw.get("token_path", "credentials/google_token.json")
    token_file = Path(token_path)
    if not token_file.is_absolute():
        token_file = root / token_file
    calendar_id_raw = _env(calendar_raw.get("calendar_id_env", "GOOGLE_CALENDAR_ID"), "primary")
    ics_url = _env(calendar_raw.get("ics_url_env", "GOOGLE_CALENDAR_ICS_URL")) or _http_url(calendar_id_raw)
    calendar_id = "primary" if _http_url(calendar_id_raw) else (calendar_id_raw or "primary")
    calendar = CalendarSettings(
        calendar_id=calendar_id,
        token_path=str(token_file),
        timezone=timezone,
    )
    registry = {}
    for entry in raw.get("tracks") or []:
        if isinstance(entry, dict) and entry.get("id"):
            registry[str(entry["id"])] = entry
    dump_rel = (raw.get("inbox") or {}).get("daily_dump", "inbox/daily_task_dump.md")
    quick_rel = (raw.get("inbox") or {}).get("quick_add_dir", "inbox/quick_add")
    return BrainConfig(
        root=root,
        timezone=timezone,
        term_year=int(raw.get("term_year", date.today().year)),
        constraints=constraints,
        notion=notion,
        calendar=calendar,
        state_path=root / raw.get("state_path", "state_manifest.json"),
        courses_dir=root / ((raw.get("discovery") or {}).get("courses_dir", "courses")),
        registry=registry,
        dump_path=root / dump_rel,
        quick_add_dir=root / quick_rel,
        gemini_api_key=_env(gemini_raw.get("api_key_env", "GEMINI_API_KEY")),
        ics_url=ics_url,
        canvas_ics_url=_env(calendar_raw.get("canvas_ics_url_env", "CANVAS_CALENDAR_ICS_URL")),
    )


_TRACK_SENTINEL = "# end tracks"


def upsert_registry(root: Path, track_id: str, enabled: bool) -> None:
    path = root / "brain_config.yaml"
    text = path.read_text()
    if _TRACK_SENTINEL not in text:
        raise RuntimeError("brain_config.yaml is missing the '# end tracks' marker")
    block, _, rest = text.partition(_TRACK_SENTINEL)
    pattern = re.compile(
        rf"(?m)^  - id: {re.escape(track_id)}\n    enabled: (true|false)\n"
    )
    replacement = f"  - id: {track_id}\n    enabled: {'true' if enabled else 'false'}\n"
    if pattern.search(block):
        block = pattern.sub(replacement, block, count=1)
    else:
        if not block.endswith("\n"):
            block += "\n"
        block += replacement
    path.write_text(block + _TRACK_SENTINEL + rest)
