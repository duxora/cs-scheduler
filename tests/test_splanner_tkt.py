"""Tests for SPlanner tkt adapter and ticket creation flow."""
import sqlite3

from fastapi.testclient import TestClient
import pytest


@pytest.fixture
def client(tmp_path, monkeypatch):
    from server import config as server_config

    monkeypatch.setattr(server_config, "DATA_DIR", tmp_path)

    import apps.splanner.db as splanner_db

    monkeypatch.setattr(splanner_db, "DATA_DIR", tmp_path)

    from server.main import app

    return TestClient(app)


def create_tkt_db(path, rows: list[tuple[int, str, str, str]]) -> None:
    with sqlite3.connect(path) as conn:
        conn.execute(
            "CREATE TABLE tasks (id INTEGER PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL, updated_at TEXT NOT NULL)"
        )
        conn.executemany(
            "INSERT INTO tasks (id, title, status, updated_at) VALUES (?, ?, ?, ?)",
            rows,
        )
        conn.commit()


def seed_splanner_item(client: TestClient, *, context: str = "work", tkt_ticket_id: int | None = None) -> tuple[int, int, int]:
    project = client.post("/splanner/api/projects", json={"context": context, "name": f"{context} project"})
    objective = client.post(
        "/splanner/api/objectives",
        json={"project_id": project.json()["id"], "name": "Objective"},
    )
    item = client.post(
        "/splanner/api/items",
        json={"objective_id": objective.json()["id"], "name": "Item", "tkt_ticket_id": tkt_ticket_id},
    )
    return project.json()["id"], objective.json()["id"], item.json()["id"]


def test_tkt_poll_updates_item_and_emits_signal(client: TestClient, tmp_path, monkeypatch):
    import apps.splanner.connectors.tkt as tkt_module

    _, _, item_id = seed_splanner_item(client, tkt_ticket_id=101)
    tkt_db_path = tmp_path / "backlog.db"
    create_tkt_db(tkt_db_path, [(101, "Ship it", "done", "2026-06-12T10:00:00Z")])
    monkeypatch.setattr(tkt_module, "TKT_BACKLOG_DB_PATH", tkt_db_path)

    connector = tkt_module.TktConnector()
    signals = connector.poll(datetime_from("2026-06-01T00:00:00Z"))

    assert len(signals) == 1
    signal = signals[0]
    assert signal.kind == "win"
    assert signal.item_id == item_id
    assert signal.source_ref == "101:done:2026-06-12T10:00:00Z"

    detail = client.get(f"/splanner/api/projects/1")
    assert detail.status_code == 200
    assert detail.json()["objectives"][0]["items"][0]["status"] == "done"

    assert connector.poll(datetime_from("2026-06-01T00:00:00Z")) == []


def test_tkt_poll_skips_unchanged_missing_and_unmapped(client: TestClient, tmp_path, monkeypatch):
    import apps.splanner.connectors.tkt as tkt_module

    seed_splanner_item(client, tkt_ticket_id=201)
    _, _, second_item_id = seed_splanner_item(client, tkt_ticket_id=202)
    client.patch(f"/splanner/api/items/{second_item_id}", json={"status": "doing"})
    seed_splanner_item(client, tkt_ticket_id=999)

    tkt_db_path = tmp_path / "backlog.db"
    create_tkt_db(
        tkt_db_path,
        [
            (201, "Backlog task", "backlog", "2026-06-12T10:00:00Z"),
            (202, "Odd task", "mystery", "2026-06-12T11:00:00Z"),
        ],
    )
    monkeypatch.setattr(tkt_module, "TKT_BACKLOG_DB_PATH", tkt_db_path)

    connector = tkt_module.TktConnector()

    assert connector.poll(datetime_from("2026-06-01T00:00:00Z")) == []


def test_tkt_poll_route_inserts_linked_checkin_without_classify(client: TestClient, tmp_path, monkeypatch):
    import apps.splanner.connectors.tkt as tkt_module
    from apps.splanner.connectors import get_connector

    project_id, objective_id, item_id = seed_splanner_item(client, tkt_ticket_id=301)
    tkt_db_path = tmp_path / "backlog.db"
    create_tkt_db(tkt_db_path, [(301, "Ship it", "done", "2026-06-12T10:00:00Z")])
    monkeypatch.setattr(tkt_module, "TKT_BACKLOG_DB_PATH", tkt_db_path)
    import apps.splanner.connectors.tkt  # noqa: F401

    calls: list[int] = []
    monkeypatch.setattr("apps.splanner.routes.classify_checkin", lambda checkin_id: calls.append(checkin_id))

    connector = get_connector("tkt")
    assert connector is not None

    response = client.post("/splanner/api/connectors/tkt/poll")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["inserted"] == 1
    assert calls == []

    checkins = client.get("/splanner/api/checkins?source=tkt")
    assert checkins.status_code == 200
    checkin = checkins.json()[0]
    assert checkin["kind"] == "win"
    assert checkin["item_id"] == item_id
    assert checkin["objective_id"] == objective_id
    assert checkin["project_id"] == project_id


def test_create_ticket_success_and_errors(client: TestClient, monkeypatch):
    import apps.splanner.connectors.tkt as tkt_module

    _, _, item_id = seed_splanner_item(client)
    already_linked = seed_splanner_item(client, tkt_ticket_id=88)[2]
    personal_item = seed_splanner_item(client, context="personal")[2]

    def fake_run(*args, **kwargs):
        class Result:
            returncode = 0
            stdout = "Created task #123"
            stderr = ""

        return Result()

    monkeypatch.setattr(tkt_module.subprocess, "run", fake_run)

    success = client.post(f"/splanner/api/items/{item_id}/create-ticket", json={})
    assert success.status_code == 200, success.text
    assert success.json()["tkt_ticket_id"] == 123

    conflict = client.post(f"/splanner/api/items/{already_linked}/create-ticket", json={})
    assert conflict.status_code == 409

    bad_context = client.post(f"/splanner/api/items/{personal_item}/create-ticket", json={})
    assert bad_context.status_code == 400

    monkeypatch.setattr(
        tkt_module.subprocess,
        "run",
        lambda *args, **kwargs: type("Result", (), {"returncode": 1, "stdout": "", "stderr": "boom"})(),
    )
    failure = client.post(f"/splanner/api/items/{seed_splanner_item(client)[2]}/create-ticket", json={})
    assert failure.status_code == 502

    monkeypatch.setattr(
        tkt_module.subprocess,
        "run",
        lambda *args, **kwargs: type("Result", (), {"returncode": 0, "stdout": "no id", "stderr": ""})(),
    )
    unparseable = client.post(f"/splanner/api/items/{seed_splanner_item(client)[2]}/create-ticket", json={})
    assert unparseable.status_code == 502


def test_connectors_route_lists_calendar_tkt_and_life_graph(client: TestClient, tmp_path, monkeypatch):
    import apps.splanner.connectors.life_graph as life_graph_module
    import apps.splanner.connectors.tkt as tkt_module

    tkt_db_path = tmp_path / "backlog.db"
    create_tkt_db(tkt_db_path, [])
    life_graph_db_path = tmp_path / "life-graph.db"
    create_life_graph_db(life_graph_db_path, [])
    monkeypatch.setattr(tkt_module, "TKT_BACKLOG_DB_PATH", tkt_db_path)
    monkeypatch.setattr(life_graph_module, "LIFE_GRAPH_DB_PATH", life_graph_db_path)

    # No explicit adapter imports here: registration must happen eagerly via the
    # connectors package import (regression guard for lazy-registration bugs).
    response = client.get("/splanner/api/connectors")

    assert response.status_code == 200
    by_name = {entry["name"]: entry["configured"] for entry in response.json()}
    assert by_name["calendar"] is False
    assert by_name["tkt"] is True
    assert by_name["life-graph"] is True


def datetime_from(value: str):
    from datetime import datetime

    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def create_tkt_db_with_projects(
    path,
    tasks: list[tuple[int, str, str, str, str | None]],  # id, title, status, updated_at, project_id
    projects: list[tuple[str, str, str | None]],  # id, name, archived_at
) -> None:
    with sqlite3.connect(path) as conn:
        conn.execute(
            "CREATE TABLE tasks (id INTEGER PRIMARY KEY, title TEXT NOT NULL, "
            "status TEXT NOT NULL, updated_at TEXT NOT NULL, project_id TEXT)"
        )
        conn.executemany(
            "INSERT INTO tasks (id, title, status, updated_at, project_id) VALUES (?, ?, ?, ?, ?)",
            tasks,
        )
        conn.execute(
            "CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, archived_at TEXT)"
        )
        conn.executemany(
            "INSERT INTO projects (id, name, archived_at) VALUES (?, ?, ?)",
            projects,
        )
        conn.commit()


def seed_splanner_objective(
    client: TestClient,
    *,
    context: str = "work",
    project_name: str = "work project",
) -> tuple[int, int]:
    project = client.post("/splanner/api/projects", json={"context": context, "name": project_name})
    objective = client.post(
        "/splanner/api/objectives",
        json={"project_id": project.json()["id"], "name": "Objective"},
    )
    return project.json()["id"], objective.json()["id"]


# ── GET /api/tkt/projects ─────────────────────────────────────────────────────

def test_list_tkt_projects_excludes_archived(client: TestClient, tmp_path, monkeypatch):
    import apps.splanner.connectors.tkt as tkt_module

    tkt_db_path = tmp_path / "backlog.db"
    create_tkt_db_with_projects(
        tkt_db_path,
        tasks=[],
        projects=[
            ("alpha", "Alpha Project", None),
            ("beta", "Beta Project", "2026-01-01"),  # archived
        ],
    )
    monkeypatch.setattr(tkt_module, "TKT_BACKLOG_DB_PATH", tkt_db_path)

    resp = client.get("/splanner/api/tkt/projects")
    assert resp.status_code == 200
    data = resp.json()
    ids = [p["id"] for p in data["projects"]]
    assert "alpha" in ids
    assert "beta" not in ids
    assert data["suggested"] is None


def test_list_tkt_projects_suggest_linked_items_majority(client: TestClient, tmp_path, monkeypatch):
    import apps.splanner.connectors.tkt as tkt_module

    tkt_db_path = tmp_path / "backlog.db"
    create_tkt_db_with_projects(
        tkt_db_path,
        tasks=[
            (10, "Task A", "open", "2026-06-01", "proj-a"),
            (11, "Task B", "open", "2026-06-01", "proj-a"),
            (12, "Task C", "open", "2026-06-01", "proj-b"),
        ],
        projects=[
            ("proj-a", "Project A", None),
            ("proj-b", "Project B", None),
        ],
    )
    monkeypatch.setattr(tkt_module, "TKT_BACKLOG_DB_PATH", tkt_db_path)

    # Create a project + objective + 3 items with tickets (2 in proj-a, 1 in proj-b)
    project = client.post("/splanner/api/projects", json={"context": "work", "name": "My Project"})
    objective = client.post(
        "/splanner/api/objectives",
        json={"project_id": project.json()["id"], "name": "My Obj"},
    )
    obj_id = objective.json()["id"]
    for tkt_id in (10, 11, 12):
        client.post("/splanner/api/items", json={"objective_id": obj_id, "name": f"Item {tkt_id}", "tkt_ticket_id": tkt_id})

    resp = client.get(f"/splanner/api/tkt/projects?suggest_for_objective={obj_id}")
    assert resp.status_code == 200
    assert resp.json()["suggested"] == "proj-a"


def test_list_tkt_projects_suggest_name_match(client: TestClient, tmp_path, monkeypatch):
    import apps.splanner.connectors.tkt as tkt_module

    tkt_db_path = tmp_path / "backlog.db"
    create_tkt_db_with_projects(
        tkt_db_path,
        tasks=[],
        projects=[("spartan", "Spartan", None), ("other", "Other", None)],
    )
    monkeypatch.setattr(tkt_module, "TKT_BACKLOG_DB_PATH", tkt_db_path)

    # Project name matches tkt project id case-insensitively
    project = client.post("/splanner/api/projects", json={"context": "work", "name": "Spartan"})
    objective = client.post(
        "/splanner/api/objectives",
        json={"project_id": project.json()["id"], "name": "Obj"},
    )
    obj_id = objective.json()["id"]

    resp = client.get(f"/splanner/api/tkt/projects?suggest_for_objective={obj_id}")
    assert resp.status_code == 200
    # No linked items → falls back to name match
    assert resp.json()["suggested"] == "spartan"


# ── POST /api/objectives/{id}/create-epic ─────────────────────────────────────

def test_create_epic_non_work_context_400(client: TestClient, tmp_path, monkeypatch):
    import apps.splanner.connectors.tkt as tkt_module

    tkt_db_path = tmp_path / "backlog.db"
    create_tkt_db_with_projects(tkt_db_path, tasks=[], projects=[("proj", "Proj", None)])
    monkeypatch.setattr(tkt_module, "TKT_BACKLOG_DB_PATH", tkt_db_path)

    _, obj_id = seed_splanner_objective(client, context="personal")
    resp = client.post(
        f"/splanner/api/objectives/{obj_id}/create-epic",
        json={"tkt_project": "proj"},
    )
    assert resp.status_code == 400


def test_create_epic_already_has_epic_409(client: TestClient, monkeypatch):
    import apps.splanner.connectors.tkt as tkt_module

    call_count = {"n": 0}

    def fake_run(*args, **kwargs):
        call_count["n"] += 1
        class R:
            returncode = 0
            stdout = f"Created epic #5{call_count['n']}"
            stderr = ""
        return R()

    monkeypatch.setattr(tkt_module.subprocess, "run", fake_run)

    _, obj_id = seed_splanner_objective(client)
    # First creation succeeds
    resp = client.post(
        f"/splanner/api/objectives/{obj_id}/create-epic",
        json={"tkt_project": "proj"},
    )
    assert resp.status_code == 200
    assert resp.json()["tkt_epic_id"] == 51

    # Second creation → 409
    resp2 = client.post(
        f"/splanner/api/objectives/{obj_id}/create-epic",
        json={"tkt_project": "proj"},
    )
    assert resp2.status_code == 409


def test_create_epic_zero_items_success(client: TestClient, monkeypatch):
    import apps.splanner.connectors.tkt as tkt_module

    def fake_run(*args, **kwargs):
        class R:
            returncode = 0
            stdout = "Created epic #77"
            stderr = ""
        return R()

    monkeypatch.setattr(tkt_module.subprocess, "run", fake_run)

    _, obj_id = seed_splanner_objective(client)
    resp = client.post(
        f"/splanner/api/objectives/{obj_id}/create-epic",
        json={"tkt_project": "proj"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["tkt_epic_id"] == 77
    assert data["items"] == []


def test_create_epic_tkt_cli_nonzero_502(client: TestClient, monkeypatch):
    import apps.splanner.connectors.tkt as tkt_module

    monkeypatch.setattr(
        tkt_module.subprocess,
        "run",
        lambda *a, **kw: type("R", (), {"returncode": 1, "stdout": "", "stderr": "boom"})(),
    )

    _, obj_id = seed_splanner_objective(client)
    resp = client.post(
        f"/splanner/api/objectives/{obj_id}/create-epic",
        json={"tkt_project": "proj"},
    )
    assert resp.status_code == 502


def test_create_epic_partial_child_failure_502_epic_persisted(client: TestClient, monkeypatch):
    """Epic id must be persisted even when a child ticket creation fails."""
    import apps.splanner.connectors.tkt as tkt_module

    call_count = {"n": 0}

    def fake_run(args, **kwargs):
        call_count["n"] += 1
        if "--type" in args:
            # Epic creation succeeds
            class R:
                returncode = 0
                stdout = "Created epic #99"
                stderr = ""
            return R()
        # Child ticket creation fails
        class R:
            returncode = 1
            stdout = ""
            stderr = "child fail"
        return R()

    monkeypatch.setattr(tkt_module.subprocess, "run", fake_run)

    _, obj_id = seed_splanner_objective(client)
    # Add one unlinked item
    client.post("/splanner/api/items", json={"objective_id": obj_id, "name": "Item 1"})

    resp = client.post(
        f"/splanner/api/objectives/{obj_id}/create-epic",
        json={"tkt_project": "proj"},
    )
    assert resp.status_code == 502
    detail = resp.json()["detail"]
    assert detail["epic_id"] == 99
    assert len(detail["errors"]) > 0

    # Verify epic id was persisted in DB
    proj_detail = client.get(f"/splanner/api/projects/1")
    obj_data = next(o for o in proj_detail.json()["objectives"] if o["id"] == obj_id)
    assert obj_data["tkt_epic_id"] == 99


def test_create_epic_cascades_child_tickets(client: TestClient, monkeypatch):
    import apps.splanner.connectors.tkt as tkt_module

    ticket_counter = {"n": 100}
    args_log: list[list[str]] = []

    def fake_run(args, **kwargs):
        args_log.append(list(args))
        ticket_counter["n"] += 1
        class R:
            returncode = 0
            stdout = f"Created #{ ticket_counter['n'] }"
            stderr = ""
        return R()

    monkeypatch.setattr(tkt_module.subprocess, "run", fake_run)

    _, obj_id = seed_splanner_objective(client)
    for name in ("Item A", "Item B"):
        client.post("/splanner/api/items", json={"objective_id": obj_id, "name": name})

    resp = client.post(
        f"/splanner/api/objectives/{obj_id}/create-epic",
        json={"tkt_project": "myproj"},
    )
    assert resp.status_code == 200
    data = resp.json()
    epic_id = data["tkt_epic_id"]
    assert epic_id is not None

    # Verify child calls include --parent-id and --project
    child_calls = [a for a in args_log if "--parent-id" in a]
    assert len(child_calls) == 2
    for call in child_calls:
        assert "--parent-id" in call
        assert str(epic_id) in call
        assert "--project" in call
        assert "myproj" in call

    # Items should now have tkt_ticket_id set
    for item in data["items"]:
        assert item["tkt_ticket_id"] is not None


def test_create_epic_adopt_linked_items(client: TestClient, monkeypatch):
    """Linked items should be adopted into the epic via tkt edit --parent-id."""
    import apps.splanner.connectors.tkt as tkt_module

    args_log: list[list[str]] = []
    counter = {"n": 200}

    def fake_run(args, **kwargs):
        args_log.append(list(args))
        counter["n"] += 1
        class R:
            returncode = 0
            stdout = f"#{ counter['n'] }"
            stderr = ""
        return R()

    monkeypatch.setattr(tkt_module.subprocess, "run", fake_run)

    _, obj_id = seed_splanner_objective(client)
    # Add an item already linked to ticket 55
    client.post("/splanner/api/items", json={"objective_id": obj_id, "name": "Existing", "tkt_ticket_id": 55})

    resp = client.post(
        f"/splanner/api/objectives/{obj_id}/create-epic",
        json={"tkt_project": "myproj"},
    )
    assert resp.status_code == 200

    # Verify an adopt call (tkt edit <ticket_id> --parent-id <epic_id>) was made
    edit_calls = [a for a in args_log if "edit" in a]
    assert len(edit_calls) >= 1
    edit_call = edit_calls[0]
    assert "55" in edit_call
    assert "--parent-id" in edit_call


def test_post_epic_item_create_uses_parent(client: TestClient, monkeypatch):
    """After objective has tkt_epic_id, create-ticket should pass --parent-id and --project."""
    import apps.splanner.connectors.tkt as tkt_module
    import apps.splanner.routes as splanner_routes

    args_log: list[list[str]] = []
    counter = {"n": 300}

    def fake_run(args, **kwargs):
        args_log.append(list(args))
        counter["n"] += 1
        class R:
            returncode = 0
            stdout = f"#{ counter['n'] }"
            stderr = ""
        return R()

    monkeypatch.setattr(tkt_module.subprocess, "run", fake_run)

    # Fake get_epic_project to return a project id
    monkeypatch.setattr(tkt_module, "get_epic_project", lambda epic_id: "epic-proj")

    _, obj_id = seed_splanner_objective(client)
    # Force epic id on the objective
    from apps.splanner.db import get_db as _get_db
    import apps.splanner.db as splanner_db_module
    from server import config as server_config

    # Manually set tkt_epic_id on objective via the DB
    # Use the tmp_path DB — we need to find it via monkeypatched DATA_DIR
    # The fixture client already monkeypatches DATA_DIR — use splanner_db
    db = _get_db()
    db.execute("UPDATE objectives SET tkt_epic_id = 42 WHERE id = ?", (obj_id,))
    db.commit()
    db.close()

    # Create a new unlinked item
    item_resp = client.post("/splanner/api/items", json={"objective_id": obj_id, "name": "New Item"})
    item_id = item_resp.json()["id"]

    resp = client.post(f"/splanner/api/items/{item_id}/create-ticket", json={})
    assert resp.status_code == 200
    assert resp.json()["tkt_ticket_id"] is not None

    # The create call must include --parent-id 42 and --project epic-proj
    create_calls = [a for a in args_log if "add" in a]
    assert len(create_calls) == 1
    call = create_calls[0]
    assert "--parent-id" in call
    assert "42" in call
    assert "--project" in call
    assert "epic-proj" in call


def test_objective_dict_includes_tkt_epic_id(client: TestClient, monkeypatch):
    """project-detail response includes tkt_epic_id on objectives."""
    import apps.splanner.connectors.tkt as tkt_module

    def fake_run(*a, **kw):
        class R:
            returncode = 0
            stdout = "Epic #10"
            stderr = ""
        return R()

    monkeypatch.setattr(tkt_module.subprocess, "run", fake_run)

    proj_id, obj_id = seed_splanner_objective(client)

    # Before epic: tkt_epic_id is null
    detail = client.get(f"/splanner/api/projects/{proj_id}")
    assert detail.status_code == 200
    obj_data = detail.json()["objectives"][0]
    assert "tkt_epic_id" in obj_data
    assert obj_data["tkt_epic_id"] is None

    # Create epic
    client.post(
        f"/splanner/api/objectives/{obj_id}/create-epic",
        json={"tkt_project": "proj"},
    )

    # After epic: tkt_epic_id is set
    detail2 = client.get(f"/splanner/api/projects/{proj_id}")
    obj_data2 = detail2.json()["objectives"][0]
    assert obj_data2["tkt_epic_id"] == 10


def create_life_graph_db(path, rows: list[tuple[int, str, str, str, str, str | None]]) -> None:
    with sqlite3.connect(path) as conn:
        conn.execute(
            "CREATE TABLE entities (id INTEGER PRIMARY KEY, entity_type TEXT NOT NULL, topic TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL, invalid_at TEXT)"
        )
        conn.executemany(
            "INSERT INTO entities (id, entity_type, topic, content, created_at, invalid_at) VALUES (?, ?, ?, ?, ?, ?)",
            rows,
        )
        conn.commit()
