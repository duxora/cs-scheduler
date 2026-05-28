# tests/test_tkt_activator.py
from fastapi.testclient import TestClient
from unittest.mock import patch
from server.main import app

client = TestClient(app)

def test_callback_done():
    update = {
        "update_id": 1,
        "callback_query": {
            "id": "cb1", "from": {"id": 1},
            "message": {"message_id": 10, "chat": {"id": 99}},
            "data": "done:42",
        },
    }
    with patch("apps.tkt_activator.tkt_cli.run_tkt") as tkt, \
         patch("apps.tkt_activator.telegram.answer_callback") as ack, \
         patch("apps.tkt_activator.telegram.remove_keyboard") as rm:
        tkt.return_value = {"ok": True}
        r = client.post("/tkt-activator/callback", json=update)
        assert r.status_code == 200
        tkt.assert_called_once_with(["done", "42"])
        ack.assert_called_once()
        rm.assert_called_once()

def test_callback_snooze1d():
    update = {"update_id": 2, "callback_query": {
        "id": "cb2", "from": {"id": 1},
        "message": {"message_id": 11, "chat": {"id": 99}},
        "data": "snooze1d:42",
    }}
    with patch("apps.tkt_activator.tkt_cli.run_tkt") as tkt, \
         patch("apps.tkt_activator.telegram.answer_callback"), \
         patch("apps.tkt_activator.telegram.remove_keyboard"):
        client.post("/tkt-activator/callback", json=update)
        tkt.assert_called_once_with(["defer", "42", "+1d"])

def test_callback_unknown_action_is_safe():
    update = {"update_id": 3, "callback_query": {
        "id": "cb3", "from": {"id": 1},
        "message": {"message_id": 12, "chat": {"id": 99}},
        "data": "wat:42",
    }}
    with patch("apps.tkt_activator.telegram.answer_callback") as ack:
        r = client.post("/tkt-activator/callback", json=update)
        assert r.status_code == 200
        ack.assert_called_once()
