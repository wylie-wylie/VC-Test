from __future__ import annotations

from typing import Optional

import requests


class NotionError(RuntimeError):
    pass


class NotionClient:
    def __init__(self, settings):
        self.settings = settings
        self.session = requests.Session()
        self.session.headers.update(
            {
                "Authorization": f"Bearer {settings.token}",
                "Notion-Version": settings.version,
                "Content-Type": "application/json",
            }
        )

    def _request(self, method: str, path: str, body: Optional[dict] = None) -> dict:
        response = self.session.request(
            method,
            f"https://api.notion.com/v1/{path.lstrip('/')}",
            json=body,
            timeout=30,
        )
        if response.status_code >= 400:
            raise NotionError(f"Notion {method} {path} failed ({response.status_code}): {response.text[:500]}")
        if response.status_code == 204 or not response.content:
            return {}
        return response.json()

    def find_by_title(self, database_id: str, title: str) -> Optional[str]:
        prop = self.settings.properties["title"]
        payload = {
            "filter": {"property": prop, "title": {"equals": title}},
            "page_size": 1,
        }
        data = self._request("POST", f"databases/{database_id}/query", payload)
        results = data.get("results") or []
        if not results:
            return None
        return results[0]["id"]

    def create_page(self, database_id: str, properties: dict) -> str:
        data = self._request(
            "POST",
            "pages",
            {"parent": {"database_id": database_id}, "properties": properties},
        )
        return data["id"]

    def update_page(self, page_id: str, properties: dict) -> str:
        data = self._request("PATCH", f"pages/{page_id}", {"properties": properties})
        return data.get("id", page_id)

    def title_property(self, text: str) -> dict:
        return {"title": [{"type": "text", "text": {"content": text[:200]}}]}

    def relation(self, page_id: str) -> dict:
        return {"relation": [{"id": page_id}]}

    def query_open_tasks(self, limit: int = 40) -> list:
        done = self.settings.properties["done"]
        title = self.settings.properties["title"]
        payload = {
            "filter": {"property": done, "checkbox": {"equals": False}},
            "page_size": min(limit, 100),
        }
        data = self._request("POST", f"databases/{self.settings.tasks_db}/query", payload)
        names = []
        for page in data.get("results") or []:
            prop = (page.get("properties") or {}).get(title) or {}
            text = plain_text(prop.get("title") or [])
            if text:
                names.append(text)
        return names[:limit]

    def query_unprocessed(self, database_id: str) -> list:
        prop = self.settings.properties["processed"]
        payload = {
            "filter": {"property": prop, "checkbox": {"equals": False}},
            "page_size": 25,
        }
        data = self._request("POST", f"databases/{database_id}/query", payload)
        return data.get("results") or []

    def block_children(self, block_id: str) -> list:
        children = []
        cursor = None
        while True:
            path = f"blocks/{block_id}/children?page_size=100"
            if cursor:
                path += f"&start_cursor={cursor}"
            data = self._request("GET", path)
            children.extend(data.get("results") or [])
            if not data.get("has_more"):
                break
            cursor = data.get("next_cursor")
        return children

    def archive_block(self, block_id: str) -> None:
        self._request("PATCH", f"blocks/{block_id}", {"archived": True})

    def append_blocks(self, block_id: str, blocks: list) -> None:
        for index in range(0, len(blocks), 50):
            self._request(
                "PATCH",
                f"blocks/{block_id}/children",
                {"children": blocks[index : index + 50]},
            )


def plain_text(rich: list) -> str:
    return "".join(part.get("plain_text") or "" for part in rich or [])


def blocks_to_markdown(blocks: list) -> str:
    lines = ["## Inbox", ""]
    mode = "inbox"
    for block in blocks:
        kind = block.get("type")
        data = block.get(kind) or {}
        text = plain_text(data.get("rich_text") or [])
        if kind in {"heading_1", "heading_2", "heading_3"} and text.lower().startswith("execution"):
            lines.extend(["", "## Execution", ""])
            mode = "execution"
            continue
        if kind == "bulleted_list_item" and mode == "inbox":
            lines.append(f"- {text}")
        elif text and mode == "execution":
            lines.append(text)
        elif kind == "bulleted_list_item":
            lines.append(f"- {text}")
    if "## Execution" not in "\n".join(lines):
        lines.extend(["", "## Execution", ""])
    return "\n".join(lines) + "\n"


def markdown_blocks(inbox: list, execution_lines: list) -> list:
    def rich(text: str) -> list:
        return [{"type": "text", "text": {"content": text[:1900]}}]

    blocks = [
        {"object": "block", "type": "heading_2", "heading_2": {"rich_text": rich("Inbox")}},
    ]
    for item in inbox:
        blocks.append(
            {
                "object": "block",
                "type": "bulleted_list_item",
                "bulleted_list_item": {"rich_text": rich(item)},
            }
        )
    blocks.append(
        {"object": "block", "type": "heading_2", "heading_2": {"rich_text": rich("Execution")}}
    )
    for line in execution_lines:
        blocks.append(
            {"object": "block", "type": "paragraph", "paragraph": {"rich_text": rich(line)}}
        )
    return blocks
