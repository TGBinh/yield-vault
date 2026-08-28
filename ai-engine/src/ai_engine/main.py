from __future__ import annotations

from fastapi import FastAPI

from ai_engine.models import OptimizationInput, Recommendation
from ai_engine.service import get_recommendation

app = FastAPI(
    title="Yield Vault AI Engine",
    description=(
        "PLAN.md GD4 - generates a structured allocation Recommendation from the "
        "risk-engine's deterministic proposal. Has NO execution authority; every "
        "output must pass through the Backend's Policy Engine before a human can "
        "approve it."
    ),
)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/recommend", response_model=Recommendation)
def recommend(optimization_input: OptimizationInput) -> Recommendation:
    return get_recommendation(optimization_input)
