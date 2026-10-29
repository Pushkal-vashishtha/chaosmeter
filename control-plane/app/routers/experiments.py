from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException
from app.config import Settings, get_settings
from app.deps import StoreDep
from app.models import ExperimentSpec
from app.safety import enforce_safety_limits

SettingsDep = Annotated[Settings, Depends(get_settings)]

router = APIRouter(prefix="/experiments", tags=["experiments"])


@router.post("", status_code=201)
def create_experiment(
    spec: ExperimentSpec, store: StoreDep, settings: SettingsDep
) -> dict:
    enforce_safety_limits(spec, settings)
    eid = store.add(spec)
    return {"id": eid, "spec": spec}


@router.get("/{experiment_id}")
def get_experiment(experiment_id: int, store: StoreDep) -> dict:
    found = store.get(experiment_id)
    if found is None:
        raise HTTPException(status_code=404, detail="experiment not found")
    return found