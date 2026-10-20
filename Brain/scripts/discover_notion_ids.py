#!/usr/bin/env python3
"""Find Notion Brain database and page IDs and write them to .env."""

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from brain.notion_ids import NotionSearchError, discover_and_write


def main() -> int:
    try:
        token = os.environ["NOTION_TOKEN"]
    except KeyError:
        print("NOTION_TOKEN is not set.", file=sys.stderr)
        return 1
    try:
        rows = discover_and_write(token, ROOT / ".env")
    except NotionSearchError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    missing = [row for row in rows if not row["id"]]
    for row in rows:
        if row["id"]:
            extra = f" ({row['matches']} matches, kept the newest)" if row["matches"] > 1 else ""
            print(f"{row['env']}={row['id']}  {row['object']}: {row['title']}{extra}")
        else:
            print(f"{row['env']}=MISSING  expected {row['object']}: {row['title']}")
    print(f"Wrote {ROOT / '.env'}")
    if missing:
        print("Share the missing pages with the Notion integration, then run this script again.", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
