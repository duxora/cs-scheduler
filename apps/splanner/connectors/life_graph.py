"""life-graph connector for SPlanner."""
from datetime import datetime, timezone
from pathlib import Path
import sqlite3

from . import ConnectorNotConfigured, RawSignal, register

LIFE_GRAPH_DB_PATH = Path.home() / ".life-graph" / "life-graph.db"
ALLOWED_ENTITY_TYPES = ("decision", "goal", "commitment", "lesson", "idea")


class LifeGraphConnector:
    name = "life-graph"

    def is_configured(self) -> bool:
        return LIFE_GRAPH_DB_PATH.is_file()

    def _connect(self) -> sqlite3.Connection:
        if not self.is_configured():
            raise ConnectorNotConfigured
        connection = sqlite3.connect(f"file:{LIFE_GRAPH_DB_PATH}?mode=ro", uri=True)
        connection.row_factory = sqlite3.Row
        return connection

    def poll(self, since: datetime) -> list[RawSignal]:
        db = self._connect()
        try:
            since_value = since.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
            rows = db.execute(
                """
                SELECT id, entity_type, topic, content, created_at
                FROM entities
                WHERE invalid_at IS NULL
                  AND created_at > ?
                  AND entity_type IN ('decision', 'goal', 'commitment', 'lesson', 'idea')
                ORDER BY created_at ASC
                LIMIT 50
                """,
                (since_value,),
            ).fetchall()

            signals: list[RawSignal] = []
            for row in rows:
                entity_type = row["entity_type"]
                topic = row["topic"]
                content = row["content"]
                created_at = row["created_at"]
                if (
                    entity_type not in ALLOWED_ENTITY_TYPES
                    or not isinstance(topic, str)
                    or not isinstance(content, str)
                    or not isinstance(created_at, str)
                ):
                    continue
                signals.append(
                    RawSignal(
                        body=f"[{entity_type}] {topic}: {content[:300]}",
                        source_ref=str(row["id"]),
                        occurred_at=created_at.replace(" ", "T") + "Z",
                    )
                )
            return signals
        finally:
            db.close()


life_graph_connector = LifeGraphConnector()
register(life_graph_connector)
