from typing import Annotated
from fastapi import Depends


class ExperimentStore:
    """In-memory for now. Postgres in week 3."""
    def __init__(self) -> None:
        self._items: dict[int, dict] = {}
        self._next_id = 1

    def add(self, spec) -> int:
        eid = self._next_id
        self._items[eid] = spec.model_dump()
        self._next_id += 1
        return eid

    def get(self, eid: int) -> dict | None:
        return self._items.get(eid)


_store = ExperimentStore()

def get_store() -> ExperimentStore:
    return _store

StoreDep = Annotated[ExperimentStore, Depends(get_store)]