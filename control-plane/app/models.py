from enum import StrEnum
from typing import Literal
from pydantic import BaseModel, Field, field_validator


class FaultType(StrEnum):
    CONTAINER_KILL = "container_kill"
    LATENCY = "latency"
    RESOURCE_PRESSURE = "resource_pressure"
    DEPENDENCY_BLACKHOLE = "dependency_blackhole"


class TargetSelector(BaseModel):
    service: str = Field(min_length=1, examples=["payment-svc"])
    max_targets: int = Field(default=1, ge=1, le=3)


class SteadyStateCondition(BaseModel):
    """One thing that must stay true during the experiment."""
    sli: Literal["latency_p95_ms", "error_rate"]
    comparator: Literal["lt", "lte"]
    threshold: float = Field(gt=0)


class ExperimentSpec(BaseModel):
    name: str = Field(min_length=3, max_length=80)
    fault: FaultType
    target: TargetSelector
    duration_seconds: int = Field(ge=5, le=300)
    parameters: dict[str, float] = Field(default_factory=dict)
    steady_state: list[SteadyStateCondition] = Field(min_length=1)
    dry_run: bool = True

    @field_validator("parameters")
    @classmethod
    def validate_parameters_for_fault(cls, v, info):
        fault = info.data.get("fault")
        if fault == FaultType.LATENCY and "latency_ms" not in v:
            raise ValueError("latency fault requires a 'latency_ms' parameter")
        return v