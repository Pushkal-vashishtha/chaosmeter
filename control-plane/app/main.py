from fastapi import FastAPI, HTTPException
from app.models import ExperimentSpec
from app.deps import StoreDep

app = FastAPI(title="chaosmeter control plane")

@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/experiments", status_code=201)
def create_experiment(spec: ExperimentSpec, store: StoreDep) -> dict:
    eid = store.add(spec)
    return {"id": eid, "spec": spec}

@app.get("/experiments/{experiment_id}")
def get_experiment(experiment_id: int, store: StoreDep) -> dict:
    found = store.get(experiment_id)
    if found is None:
        raise HTTPException(status_code=404, detail="experiment not found")
    return found