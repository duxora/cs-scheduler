#!/usr/bin/env python3
"""One-shot Google OAuth helper for the SPlanner calendar connector."""
import argparse
from datetime import datetime, timedelta, timezone
import http.server
import json
import os
from pathlib import Path
import sys
from urllib import error, parse, request
import webbrowser

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from server.config import DATA_DIR

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.readonly"


class OAuthCodeHandler(http.server.BaseHTTPRequestHandler):
    server_version = "SPlannerGoogleAuth/1.0"

    def do_GET(self) -> None:
        parsed = parse.urlparse(self.path)
        query = parse.parse_qs(parsed.query)
        code = query.get("code", [None])[0]
        error_value = query.get("error", [None])[0]

        self.server.auth_code = code
        self.server.auth_error = error_value

        if code:
            body = "You can close this tab."
            status = 200
        elif error_value:
            body = f"OAuth failed: {error_value}. You can close this tab."
            status = 400
        else:
            body = "Missing code. You can close this tab."
            status = 400

        payload = body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, format: str, *args) -> None:
        return


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Configure SPlanner Google Calendar OAuth credentials.")
    parser.add_argument("--client-id", required=True)
    parser.add_argument("--client-secret", required=True)
    parser.add_argument("--calendar-id", default="primary")
    parser.add_argument("--port", type=int, default=8765)
    return parser.parse_args()


def build_auth_url(client_id: str, port: int) -> str:
    query = parse.urlencode(
        {
            "client_id": client_id,
            "redirect_uri": f"http://localhost:{port}",
            "response_type": "code",
            "scope": CALENDAR_SCOPE,
            "access_type": "offline",
            "prompt": "consent",
        }
    )
    return f"{AUTH_URL}?{query}"


def wait_for_code(port: int) -> str:
    server = http.server.HTTPServer(("127.0.0.1", port), OAuthCodeHandler)
    server.auth_code = None
    server.auth_error = None
    try:
        server.handle_request()
    finally:
        server.server_close()

    if server.auth_error:
        raise SystemExit(f"OAuth callback returned error: {server.auth_error}")
    if not server.auth_code:
        raise SystemExit("OAuth callback did not include a code.")
    return server.auth_code


def post_form(url: str, data: dict[str, str]) -> dict:
    encoded = parse.urlencode(data).encode("utf-8")
    req = request.Request(url, data=encoded, method="POST")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")
    try:
        with request.urlopen(req, timeout=30) as response:
            raw = response.read().decode("utf-8")
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise SystemExit(f"HTTP {exc.code} from {url}: {detail}") from exc
    except error.URLError as exc:
        raise SystemExit(f"Request to {url} failed: {exc.reason}") from exc

    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise SystemExit(f"Non-JSON response from {url}: {raw}") from exc
    if not isinstance(payload, dict):
        raise SystemExit(f"Unexpected response payload from {url}: {payload!r}")
    return payload


def fetch_json(url: str, headers: dict[str, str], params: dict[str, str]) -> dict:
    query_url = f"{url}?{parse.urlencode(params)}"
    req = request.Request(query_url, method="GET")
    for key, value in headers.items():
        req.add_header(key, value)
    try:
        with request.urlopen(req, timeout=30) as response:
            raw = response.read().decode("utf-8")
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise SystemExit(f"HTTP {exc.code} from {url}: {detail}") from exc
    except error.URLError as exc:
        raise SystemExit(f"Request to {url} failed: {exc.reason}") from exc

    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise SystemExit(f"Non-JSON response from {url}: {raw}") from exc
    if not isinstance(payload, dict):
        raise SystemExit(f"Unexpected response payload from {url}: {payload!r}")
    return payload


def exchange_code_for_tokens(client_id: str, client_secret: str, code: str, port: int) -> dict:
    return post_form(
        TOKEN_URL,
        {
            "client_id": client_id,
            "client_secret": client_secret,
            "code": code,
            "grant_type": "authorization_code",
            "redirect_uri": f"http://localhost:{port}",
        },
    )


def refresh_access_token(credentials: dict[str, str]) -> str:
    payload = post_form(
        TOKEN_URL,
        {
            "client_id": credentials["client_id"],
            "client_secret": credentials["client_secret"],
            "refresh_token": credentials["refresh_token"],
            "grant_type": "refresh_token",
        },
    )
    access_token = payload.get("access_token")
    if not isinstance(access_token, str) or not access_token:
        raise SystemExit(f"Token refresh response missing access_token: {payload}")
    return access_token


def verify_calendar_access(credentials: dict[str, str]) -> None:
    access_token = refresh_access_token(credentials)
    calendar_id = credentials.get("calendar_id") or "primary"
    time_min = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat().replace("+00:00", "Z")
    payload = fetch_json(
        f"https://www.googleapis.com/calendar/v3/calendars/{parse.quote(calendar_id, safe='')}/events",
        headers={"Authorization": f"Bearer {access_token}"},
        params={
            "timeMin": time_min,
            "singleEvents": "true",
            "orderBy": "startTime",
            "maxResults": "1",
        },
    )
    items = payload.get("items", [])
    if not isinstance(items, list):
        raise SystemExit(f"Calendar events response missing items list: {payload}")


def write_credentials(credentials: dict[str, str]) -> Path:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    path = DATA_DIR / "splanner-google.json"
    path.write_text(json.dumps(credentials, ensure_ascii=True, indent=2) + "\n")
    os.chmod(path, 0o600)
    return path


def main() -> int:
    args = parse_args()
    auth_url = build_auth_url(args.client_id, args.port)
    print(auth_url)
    webbrowser.open(auth_url)
    code = wait_for_code(args.port)
    token_payload = exchange_code_for_tokens(args.client_id, args.client_secret, code, args.port)

    refresh_token = token_payload.get("refresh_token")
    if not isinstance(refresh_token, str) or not refresh_token:
        raise SystemExit(
            "OAuth response did not include a refresh_token. Re-run with prompt=consent and, "
            "if needed, remove the prior grant at https://myaccount.google.com/permissions."
        )

    credentials = {
        "client_id": args.client_id,
        "client_secret": args.client_secret,
        "refresh_token": refresh_token,
        "calendar_id": args.calendar_id,
    }
    path = write_credentials(credentials)
    print(f"Wrote credentials to {path}")

    try:
        verify_calendar_access(credentials)
    except SystemExit as exc:
        print(f"Calendar verification failed: {exc}", file=sys.stderr)
        return 1

    print("OK — calendar connector configured")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
