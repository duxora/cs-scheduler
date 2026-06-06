"""Connector registry for SPlanner."""
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol


@dataclass(frozen=True)
class RawSignal:
    body: str
    source_ref: str
    occurred_at: str | None
    kind: str | None = None
    item_id: int | None = None


class Connector(Protocol):
    name: str

    def poll(self, since: datetime) -> list[RawSignal]:
        ...


class ConnectorNotConfigured(Exception):
    """Raised when a connector is not configured."""


_REGISTRY: dict[str, Connector] = {}


def register(connector: Connector) -> None:
    _REGISTRY[connector.name] = connector


def get_connector(name: str) -> Connector | None:
    return _REGISTRY.get(name)


def list_connectors() -> list[Connector]:
    return list(_REGISTRY.values())

from .calendar import calendar_connector  # noqa: E402,F401
from .life_graph import life_graph_connector  # noqa: E402,F401
from .tkt import tkt_connector  # noqa: E402,F401
