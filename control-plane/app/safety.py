# app/safety.py — a configurable limit that can only be stricter
from fastapi import HTTPException
from app.config import Settings
from app.models import ExperimentSpec


def enforce_safety_limits(spec: ExperimentSpec, settings: Settings) -> None:
    """Deployment-configurable limits, applied on top of schema constraints."""
    if spec.duration_seconds > settings.max_experiment_duration_seconds:
        raise HTTPException(
            422,
            f"duration {spec.duration_seconds}s exceeds the configured "
            f"maximum of {settings.max_experiment_duration_seconds}s",
        )
    if spec.target.max_targets > settings.max_blast_radius:
        raise HTTPException(
            422,
            f"blast radius {spec.target.max_targets} exceeds the configured "
            f"maximum of {settings.max_blast_radius}",
        )