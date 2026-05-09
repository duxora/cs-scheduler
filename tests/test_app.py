"""Integration tests for the web API."""
import tempfile
from pathlib import Path
from unittest.mock import patch, MagicMock

from fastapi.testclient import TestClient
from invoice_matcher.app import app

client = TestClient(app)


def test_index_returns_html():
    resp = client.get("/")
    assert resp.status_code == 200
    assert "Invoice Matcher" in resp.text


def test_list_files_returns_pdfs():
    with tempfile.TemporaryDirectory() as tmpdir:
        (Path(tmpdir) / "a.pdf").write_bytes(b"fake")
        (Path(tmpdir) / "b.pdf").write_bytes(b"fake")
        (Path(tmpdir) / "c.txt").write_bytes(b"not a pdf")

        resp = client.get(f"/api/list-files?directory={tmpdir}")
        assert resp.status_code == 200
        assert resp.json() == ["a.pdf", "b.pdf"]


def test_list_files_invalid_directory():
    resp = client.get("/api/list-files?directory=/nonexistent/path")
    assert resp.status_code == 400


def _mock_gemini_response(text):
    r = MagicMock()
    r.text = text
    return r


def test_full_scan_flow():
    with tempfile.TemporaryDirectory() as tmpdir:
        (Path(tmpdir) / "master.pdf").write_bytes(b"master")
        (Path(tmpdir) / "doc1.pdf").write_bytes(b"doc1")
        (Path(tmpdir) / "doc2.pdf").write_bytes(b"doc2")

        mock_client = MagicMock()
        mock_client.models.generate_content.side_effect = [
            _mock_gemini_response('["INV-001", "INV-002"]'),
            _mock_gemini_response('["INV-001"]'),
            _mock_gemini_response('[]'),
        ]

        with patch("invoice_matcher.gemini._get_client", return_value=mock_client):
            resp = client.post("/api/scan", json={
                "api_key": "fake-key",
                "directory": tmpdir,
                "master_file": "master.pdf",
                "pattern": "{invoice}",
            })

        assert resp.status_code == 200
        data = resp.json()
        assert data["master_invoices"] == ["INV-001", "INV-002"]
        assert data["matches"]["doc1.pdf"]["invoices"] == ["INV-001"]
        assert data["matches"]["doc2.pdf"]["invoices"] == []
        assert data["plan"]["doc1.pdf"] == "INV-001.pdf"
        assert "doc2.pdf" not in data["plan"]


def test_full_scan_with_custom_separator():
    """Multiple invoices in one doc, joined with custom separator."""
    with tempfile.TemporaryDirectory() as tmpdir:
        (Path(tmpdir) / "master.pdf").write_bytes(b"master")
        (Path(tmpdir) / "multi.pdf").write_bytes(b"multi")

        mock_client = MagicMock()
        mock_client.models.generate_content.side_effect = [
            _mock_gemini_response('["123", "456", "789"]'),
            _mock_gemini_response('["123", "456", "789"]'),
        ]

        with patch("invoice_matcher.gemini._get_client", return_value=mock_client):
            resp = client.post("/api/scan", json={
                "api_key": "fake-key",
                "directory": tmpdir,
                "master_file": "master.pdf",
                "pattern": "{invoice}",
                "separator": "-",
            })

        assert resp.status_code == 200
        data = resp.json()
        assert data["plan"]["multi.pdf"] == "123-456-789.pdf"


def test_rename_flow():
    with tempfile.TemporaryDirectory() as tmpdir:
        (Path(tmpdir) / "doc1.pdf").write_bytes(b"content")

        resp = client.post("/api/rename", json={
            "directory": tmpdir,
            "plan": {"doc1.pdf": "INV-001.pdf"},
        })

        assert resp.status_code == 200
        assert len(resp.json()["renamed"]) == 1
        assert (Path(resp.json()["output_dir"]) / "INV-001.pdf").exists()
