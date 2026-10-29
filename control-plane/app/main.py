from fastapi import FastAPI
from app.routers import experiments

app = FastAPI(title="chaosmeter control plane")

app.include_router(experiments.router)


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}