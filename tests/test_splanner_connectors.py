"""Tests for SPlanner connector framework and calendar adapter."""
import json
from pathlib import Path

from fastapi.testclient import TestClient
import pytest


RECORDED_EVENTS_FIXTURE = {
    "items": [
        {
            "id": "evt-1",
            "status": "confirmed",
            "summary": "Team sync",
            "start": {"dateTime": "2026-06-10T09:00:00Z"},
            "end": {"dateTime": "2026-06-10T09:30:00Z"},
            "attendees": [{"email": "a@example.com"}, {"email": "b@example.com"}],
        },
        {
            "id": "evt-2",
            "status": "cancelled",
            "summary": "Cancelled event",
            "start": {"dateTime": "2026-06-10T10:00:00Z"},
            "end": {"dateTime": "2026-06-10T10:30:00Z"},
        },
        {
            "id": "evt-3",
            "status": "confirmed",
            "start": {"dateTime": "2026-06-10T11:00:00Z"},
            "end": {"dateTime": "2026-06-10T11:30:00Z"},
        },
        {
            "id": "evt-4",
            "status": "confirmed",
            "summary": "1:1",
            "start": {"dateTime": "2026-06-11T14:00:00Z"},
            "end": {"dateTime": "2026-06-11T14:30:00Z"},
            "attendees": [{"email": "a@example.com"}],
        },
    ]
}


class StubResponse:
    def __init__(self, payload: dict):
        self._payload = payload

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict:
        return self._payload


@pytest.fixture
def client(tmp_path, monkeypatch):
    from server import config as server_config

    monkeypatch.setattr(server_config, "DATA_DIR", tmp_path)

    import apps.splanner.db as splanner_db

    monkeypatch.setattr(splanner_db, "DATA_DIR", tmp_path)

    from server.main import app

    return TestClient(app)


def write_calendar_credentials(tmp_path: Path) -> None:
    (tmp_path / "splanner-google.json").write_text(
        json.dumps(
            {
                "client_id": "client-id",
                "client_secret": "client-secret",
                "refresh_token": "refresh-token",
                "calendar_id": "primary",
            }
        )
    )


def test_calendar_adapter_maps_events_and_refreshes_token(tmp_path, monkeypatch):
    from server import config as server_config

    monkeypatch.setattr(server_config, "DATA_DIR", tmp_path)
    write_calendar_credentials(tmp_path)

    from apps.splanner.connectors import RawSignal
    from apps.splanner.connectors.calendar import GoogleCalendarConnector

    post_calls: list[dict] = []
    get_calls: list[dict] = []

    def fake_post(url, data=None, timeout=None):
        post_calls.append({"url": url, "data": data, "timeout": timeout})
        return StubResponse({"access_token": "access-token"})

    def fake_get(url, headers=None, params=None, timeout=None):
        get_calls.append({"url": url, "headers": headers, "params": params, "timeout": timeout})
        return StubResponse(RECORDED_EVENTS_FIXTURE)

    monkeypatch.setattr("apps.splanner.connectors.calendar.httpx.post", fake_post)
    monkeypatch.setattr("apps.splanner.connectors.calendar.httpx.get", fake_get)

    connector = GoogleCalendarConnector()
    signals = connector.poll(datetime_from("2026-06-09T00:00:00Z"))

    assert post_calls == [
        {
            "url": "https://oauth2.googleapis.com/token",
            "data": {
                "client_id": "client-id",
                "client_secret": "client-secret",
                "refresh_token": "refresh-token",
                "grant_type": "refresh_token",
            },
            "timeout": 30,
        }
    ]
    assert get_calls[0]["headers"] == {"Authorization": "Bearer access-token"}
    assert get_calls[0]["params"]["singleEvents"] == "true"
    assert get_calls[0]["params"]["orderBy"] == "startTime"
    # timeMax must cap the window at now — without it the poll returns all
    # future events (upcoming meetings are not check-ins)
    assert "timeMax" in get_calls[0]["params"]
    assert get_calls[0]["params"]["timeMax"].endswith("Z")
    assert signals == [
        RawSignal(
            body="Calendar: Team sync (2026-06-10T09:00:00Z – 2026-06-10T09:30:00Z) · 2 attendees",
            source_ref="evt-1",
            occurred_at="2026-06-10T09:00:00Z",
        ),
        RawSignal(
            body="Calendar: 1:1 (2026-06-11T14:00:00Z – 2026-06-11T14:30:00Z)",
            source_ref="evt-4",
            occurred_at="2026-06-11T14:00:00Z",
        ),
    ]


def test_calendar_adapter_missing_credentials_raises(tmp_path, monkeypatch):
    from server import config as server_config

    monkeypatch.setattr(server_config, "DATA_DIR", tmp_path)

    from apps.splanner.connectors import ConnectorNotConfigured
    from apps.splanner.connectors.calendar import GoogleCalendarConnector

    connector = GoogleCalendarConnector()

    with pytest.raises(ConnectorNotConfigured):
        connector.poll(datetime_from("2026-06-09T00:00:00Z"))


def test_connectors_route_lists_calendar_unconfigured(client: TestClient):
    response = client.get("/splanner/api/connectors")

    assert response.status_code == 200
    by_name = {entry["name"]: entry["configured"] for entry in response.json()}
    assert by_name["calendar"] is False


def test_calendar_poll_route_inserts_and_dedups(client: TestClient, monkeypatch):
    from apps.splanner.connectors import RawSignal, get_connector

    calls: list[int] = []

    def fake_classify(checkin_id: int) -> None:
        calls.append(checkin_id)

    monkeypatch.setattr("apps.splanner.routes.classify_checkin", fake_classify)

    connector = get_connector("calendar")
    assert connector is not None

    signals = [
        RawSignal(body="Calendar: Team sync (2026-06-10T09:00:00Z – 2026-06-10T09:30:00Z)", source_ref="evt-1", occurred_at="2026-06-10T09:00:00Z"),
        RawSignal(body="Calendar: 1:1 (2026-06-11T14:00:00Z – 2026-06-11T14:30:00Z)", source_ref="evt-4", occurred_at="2026-06-11T14:00:00Z"),
    ]
    monkeypatch.setattr(connector, "poll", lambda since: signals)

    first = client.post("/splanner/api/connectors/calendar/poll")
    assert first.status_code == 200, first.text
    first_body = first.json()
    assert first_body["polled"] == 2
    assert first_body["inserted"] == 2
    assert len(first_body["checkin_ids"]) == 2
    assert calls == first_body["checkin_ids"]

    checkins = client.get("/splanner/api/checkins?source=calendar")
    assert checkins.status_code == 200
    data = checkins.json()
    assert len(data) == 2
    assert {entry["source_ref"] for entry in data} == {"evt-1", "evt-4"}

    second = client.post("/splanner/api/connectors/calendar/poll")
    assert second.status_code == 200, second.text
    assert second.json() == {"polled": 2, "inserted": 0, "checkin_ids": []}


def test_calendar_poll_route_returns_404_for_unknown_connector(client: TestClient):
    response = client.post("/splanner/api/connectors/nope/poll")

    assert response.status_code == 404


def test_calendar_poll_route_returns_503_when_unconfigured(client: TestClient, monkeypatch):
    from apps.splanner.connectors import ConnectorNotConfigured, get_connector

    connector = get_connector("calendar")
    assert connector is not None
    monkeypatch.setattr(
        connector,
        "poll",
        lambda since: (_ for _ in ()).throw(ConnectorNotConfigured()),
    )

    response = client.post("/splanner/api/connectors/calendar/poll")

    assert response.status_code == 503
    assert response.json() == {"detail": "calendar connector not configured"}


def datetime_from(value: str):
    from datetime import datetime

    return datetime.fromisoformat(value.replace("Z", "+00:00"))
