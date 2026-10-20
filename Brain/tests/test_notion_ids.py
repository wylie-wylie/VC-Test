from brain.config import load_config
from brain.notion_ids import select_targets


def test_select_targets_matches_type_and_skips_quick_add():
    results = [
        {"object": "page", "id": "page-areas", "last_edited_time": "2026-01-01", "properties": {"Name": {"type": "title", "title": [{"plain_text": "Areas"}]}}},
        {"object": "database", "id": "db-goals", "last_edited_time": "2026-01-02", "title": [{"plain_text": "Goals"}]},
        {"object": "database", "id": "db-areas-old", "last_edited_time": "2026-01-01", "title": [{"plain_text": "Areas"}]},
        {"object": "database", "id": "db-areas-new", "last_edited_time": "2026-10-01", "title": [{"plain_text": "Areas"}]},
        {"object": "database", "id": "db-projects", "last_edited_time": "2026-02-01", "title": [{"plain_text": "Projects"}]},
        {"object": "database", "id": "db-active-tasks", "last_edited_time": "2026-02-02", "title": [{"plain_text": "Active Tasks"}]},
        {"object": "database", "id": "db-tasks", "last_edited_time": "2026-02-01", "title": [{"plain_text": "Tasks"}]},
        {"object": "database", "id": "db-recurring", "last_edited_time": "2026-02-01", "title": [{"plain_text": "Recurring Tasks"}]},
        {"object": "page", "id": "page-dump", "last_edited_time": "2026-03-01", "properties": {"title": {"type": "title", "title": [{"plain_text": "Daily Task Dump"}]}}},
        {"object": "page", "id": "quick", "last_edited_time": "2026-03-01", "properties": {"title": {"type": "title", "title": [{"plain_text": "Quick Add Note"}]}}},
    ]
    chosen = select_targets(results)
    assert chosen["NOTION_AREAS_DB"]["id"] == "db-areas-new"
    assert chosen["NOTION_PROJECTS_DB"]["id"] == "db-projects"
    assert chosen["NOTION_TASKS_DB"]["id"] == "db-tasks"
    assert chosen["NOTION_RECURRING_DB"]["id"] == "db-recurring"
    assert chosen["NOTION_DAILY_DUMP_PAGE"]["id"] == "page-dump"
    assert "quick" not in {item["id"] for item in chosen.values()}


def test_dotenv_is_loaded_without_overriding_the_process(tmp_path, monkeypatch):
    (tmp_path / "brain_config.yaml").write_text(
        "timezone: America/Chicago\nterm_year: 2026\ntracks:\n# end tracks\n"
    )
    (tmp_path / ".env").write_text(
        "NOTION_TOKEN=from-file\nNOTION_AREAS_DB=areas\nNOTION_PROJECTS_DB=projects\nNOTION_TASKS_DB=tasks\n"
    )
    monkeypatch.setenv("BRAIN_HOME", str(tmp_path))
    monkeypatch.setenv("NOTION_TOKEN", "from-process")
    monkeypatch.delenv("NOTION_AREAS_DB", raising=False)
    monkeypatch.delenv("NOTION_PROJECTS_DB", raising=False)
    monkeypatch.delenv("NOTION_TASKS_DB", raising=False)
    loaded = load_config(tmp_path)
    assert loaded.notion.token == "from-process"
    assert loaded.notion.areas_db == "areas"
    assert loaded.notion.configured
