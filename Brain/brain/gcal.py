from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional
from urllib.parse import quote
from zoneinfo import ZoneInfo

import requests

from brain.models import CalendarEvent, Interval


class CalendarError(RuntimeError):
    pass


def _expiry_epoch(data: dict) -> float:
    if data.get("expires_at"):
        return float(data["expires_at"])
    raw = data.get("expiry")
    if not raw:
        return 0
    try:
        return datetime.fromisoformat(str(raw).replace("Z", "+00:00")).timestamp()
    except ValueError:
        return 0


def find_client_secret(credentials_dir: Path) -> Optional[Path]:
    preferred = credentials_dir / "client_secret.json"
    if preferred.is_file():
        return preferred
    matches = [
        path
        for path in sorted(credentials_dir.glob("client_secret*.json"))
        if "example" not in path.name and path.name != "google_token.json"
    ]
    if matches:
        return matches[0]
    return None


def write_google_token(credentials_dir: Path, creds) -> Path:
    expiry = 0
    if getattr(creds, "expiry", None) is not None:
        expiry = creds.expiry.replace(tzinfo=timezone.utc).timestamp()
    payload = {
        "client_id": creds.client_id,
        "client_secret": creds.client_secret,
        "refresh_token": creds.refresh_token,
        "token_uri": creds.token_uri or "https://oauth2.googleapis.com/token",
        "access_token": creds.token,
        "expires_at": expiry,
        "scopes": list(creds.scopes or []),
    }
    dest = credentials_dir / "google_token.json"
    dest.write_text(json.dumps(payload, indent=2) + "\n")
    dest.chmod(0o600)
    return dest


def run_browser_login(credentials_dir: Path) -> Path:
    secret = find_client_secret(credentials_dir)
    if secret is None:
        raise CalendarError(
            "Drop the OAuth desktop client_secret.json into credentials/, then run: python -m brain auth"
        )
    try:
        from google_auth_oauthlib.flow import InstalledAppFlow
    except ImportError as exc:
        raise CalendarError("google-auth-oauthlib is not installed. Run: .venv/bin/pip install google-auth-oauthlib") from exc
    flow = InstalledAppFlow.from_client_secrets_file(
        str(secret),
        scopes=["https://www.googleapis.com/auth/calendar"],
    )
    creds = flow.run_local_server(port=0, open_browser=True, access_type="offline", prompt="consent")
    if not creds.refresh_token:
        raise CalendarError("Google did not return a refresh token. Re-run auth and approve calendar access.")
    return write_google_token(credentials_dir, creds)


class GoogleCalendar:
    def __init__(self, settings):
        self.settings = settings
        self.token_path = Path(settings.token_path)
        self.calendar_id = settings.calendar_id or "primary"
        self.timezone = ZoneInfo(settings.timezone)

    def _token_data(self) -> dict:
        return json.loads(self.token_path.read_text())

    def _save(self, data: dict) -> None:
        self.token_path.write_text(json.dumps(data, indent=2) + "\n")

    def access_token(self) -> str:
        data = self._token_data()
        access = data.get("access_token") or data.get("token") or ""
        expires = _expiry_epoch(data)
        if access and expires > time.time() + 60:
            return access
        refresh = data.get("refresh_token")
        client_id = data.get("client_id")
        client_secret = data.get("client_secret")
        if not (refresh and client_id and client_secret):
            if access:
                return access
            raise CalendarError("Google token file needs a refresh_token, client_id, and client_secret")
        response = requests.post(
            data.get("token_uri") or "https://oauth2.googleapis.com/token",
            data={
                "client_id": client_id,
                "client_secret": client_secret,
                "refresh_token": refresh,
                "grant_type": "refresh_token",
            },
            timeout=30,
        )
        if response.status_code >= 400:
            raise CalendarError(f"Google token refresh failed ({response.status_code}): {response.text[:300]}")
        payload = response.json()
        data["access_token"] = payload["access_token"]
        data["expires_at"] = time.time() + int(payload.get("expires_in") or 3600)
        self._save(data)
        return data["access_token"]

    def _request(self, method: str, path: str, **kwargs):
        headers = {"Authorization": f"Bearer {self.access_token()}"}
        response = requests.request(
            method,
            f"https://www.googleapis.com/calendar/v3/{path.lstrip('/')}",
            headers=headers,
            timeout=30,
            **kwargs,
        )
        if response.status_code >= 400:
            raise CalendarError(f"Calendar {method} {path} failed ({response.status_code}): {response.text[:400]}")
        if not response.content:
            return {}
        return response.json()

    def _parse_bound(self, node: dict, all_day: bool) -> datetime:
        if all_day:
            moment = datetime.fromisoformat(node["date"]).replace(tzinfo=self.timezone)
            return moment
        raw = node["dateTime"]
        moment = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if moment.tzinfo is None:
            moment = moment.replace(tzinfo=self.timezone)
        return moment

    def list_events(self, start: datetime, end: datetime) -> List[CalendarEvent]:
        events = []
        page = None
        while True:
            params = {
                "timeMin": start.astimezone(timezone.utc).isoformat(),
                "timeMax": end.astimezone(timezone.utc).isoformat(),
                "singleEvents": "true",
                "orderBy": "startTime",
                "maxResults": 250,
                "timeZone": self.settings.timezone,
            }
            if page:
                params["pageToken"] = page
            data = self._request("GET", f"calendars/{quote(self.calendar_id, safe='@')}/events", params=params)
            for item in data.get("items") or []:
                if item.get("status") == "cancelled":
                    continue
                all_day = "date" in (item.get("start") or {})
                begin = self._parse_bound(item["start"], all_day)
                finish = self._parse_bound(item["end"], all_day)
                private = (item.get("extendedProperties") or {}).get("private") or {}
                description = item.get("description") or ""
                if private.get("brainKey"):
                    description = f"{description}\nbrain-key: {private['brainKey']}".strip()
                events.append(
                    CalendarEvent(
                        id=item.get("id") or "",
                        summary=item.get("summary") or "",
                        start=begin,
                        end=finish,
                        description=description,
                        all_day=all_day,
                        transparent=(item.get("transparency") == "transparent"),
                    )
                )
            page = data.get("nextPageToken")
            if not page:
                break
        return events

    def freebusy(self, start: datetime, end: datetime) -> List[Interval]:
        body = {
            "timeMin": start.astimezone(timezone.utc).isoformat(),
            "timeMax": end.astimezone(timezone.utc).isoformat(),
            "timeZone": self.settings.timezone,
            "items": [{"id": self.calendar_id}],
        }
        data = self._request("POST", "freeBusy", json=body)
        calendars = data.get("calendars") or {}
        slot = calendars.get(self.calendar_id) or {}
        intervals = []
        for busy in slot.get("busy") or []:
            begin = datetime.fromisoformat(busy["start"].replace("Z", "+00:00"))
            finish = datetime.fromisoformat(busy["end"].replace("Z", "+00:00"))
            intervals.append(Interval(begin, finish, "busy"))
        return intervals

    def find_brain_key(self, brain_key: str, start: datetime, end: datetime) -> Optional[str]:
        params = {
            "privateExtendedProperty": f"brainKey={brain_key}",
            "timeMin": start.astimezone(timezone.utc).isoformat(),
            "timeMax": end.astimezone(timezone.utc).isoformat(),
            "singleEvents": "true",
            "maxResults": 1,
        }
        data = self._request("GET", f"calendars/{quote(self.calendar_id, safe='@')}/events", params=params)
        items = data.get("items") or []
        if not items:
            return None
        return items[0].get("id")

    def create_event(self, summary: str, start: datetime, end: datetime, description: str, brain_key: str) -> str:
        body = {
            "summary": summary,
            "description": description,
            "start": {"dateTime": start.isoformat(), "timeZone": self.settings.timezone},
            "end": {"dateTime": end.isoformat(), "timeZone": self.settings.timezone},
            "extendedProperties": {"private": {"brainKey": brain_key}},
        }
        data = self._request("POST", f"calendars/{quote(self.calendar_id, safe='@')}/events", json=body)
        return data["id"]
