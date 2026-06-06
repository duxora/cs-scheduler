"""Google Calendar connector for SPlanner."""
from datetime import datetime, timezone
import json
from pathlib import Path
from urllib.parse import quote

import httpx

from server import config as server_config

from . import ConnectorNotConfigured, RawSignal, register


class GoogleCalendarConnector:
    name = "calendar"

    def credentials_path(self) -> Path:
        return server_config.DATA_DIR / "splanner-google.json"

    def is_configured(self) -> bool:
        return self.credentials_path().is_file()

    def _load_credentials(self) -> dict:
        path = self.credentials_path()
        try:
            raw = path.read_text()
        except OSError as exc:
            raise ConnectorNotConfigured from exc

        try:
            credentials = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise ConnectorNotConfigured from exc

        required_keys = ("client_id", "client_secret", "refresh_token")
        if not all(isinstance(credentials.get(key), str) and credentials.get(key) for key in required_keys):
            raise ConnectorNotConfigured
        return credentials

    def _refresh_access_token(self, credentials: dict) -> str:
        response = httpx.post(
            "https://oauth2.googleapis.com/token",
            data={
                "client_id": credentials["client_id"],
                "client_secret": credentials["client_secret"],
                "refresh_token": credentials["refresh_token"],
                "grant_type": "refresh_token",
            },
            timeout=30,
        )
        response.raise_for_status()
        payload = response.json()
        access_token = payload.get("access_token")
        if not isinstance(access_token, str) or not access_token:
            raise ConnectorNotConfigured
        return access_token

    def _list_events(self, credentials: dict, access_token: str, since: datetime) -> list[dict]:
        calendar_id = credentials.get("calendar_id") or "primary"
        time_min = since.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
        response = httpx.get(
            f"https://www.googleapis.com/calendar/v3/calendars/{quote(calendar_id, safe='')}/events",
            headers={"Authorization": f"Bearer {access_token}"},
            params={
                "timeMin": time_min,
                "singleEvents": "true",
                "orderBy": "startTime",
                "maxResults": "50",
            },
            timeout=30,
        )
        response.raise_for_status()
        payload = response.json()
        items = payload.get("items", [])
        return items if isinstance(items, list) else []

    def poll(self, since: datetime) -> list[RawSignal]:
        credentials = self._load_credentials()
        access_token = self._refresh_access_token(credentials)
        events = self._list_events(credentials, access_token, since)

        signals: list[RawSignal] = []
        for event in events:
            if not isinstance(event, dict) or event.get("status") == "cancelled":
                continue

            summary = event.get("summary")
            source_ref = event.get("id")
            start = event.get("start", {})
            end = event.get("end", {})
            start_value = start.get("dateTime") or start.get("date")
            end_value = end.get("dateTime") or end.get("date")
            if not isinstance(summary, str) or not summary.strip() or not isinstance(source_ref, str):
                continue
            if not isinstance(start_value, str) or not isinstance(end_value, str):
                continue

            attendee_count = len(event.get("attendees", [])) if isinstance(event.get("attendees"), list) else 0
            attendee_suffix = f" · {attendee_count} attendees" if attendee_count > 1 else ""
            signals.append(
                RawSignal(
                    body=f"Calendar: {summary.strip()} ({start_value} – {end_value}){attendee_suffix}",
                    source_ref=source_ref,
                    occurred_at=start_value,
                )
            )

        return signals


calendar_connector = GoogleCalendarConnector()
register(calendar_connector)
