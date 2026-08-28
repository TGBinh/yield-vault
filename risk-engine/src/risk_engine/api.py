"""HTTP wrapper around the existing scoring/optimization pipeline (main.py's `run()`),
so the Backend can call it as part of the GD4 chain: Risk/Optimization Engine -> AI
Engine -> Policy Engine -> Execution Intent (PLAN.md §2.4/GD4 §5). The scoring math
itself is unchanged - this file adds no new logic, only an HTTP entrypoint.
"""
from __future__ import annotations

from fastapi import FastAPI

from risk_engine.main import run

app = FastAPI(
    title="Yield Vault Risk & Optimization Engine",
    description="Deterministic (no AI/LLM) risk scoring + allocation optimization - see PLAN.md GD3.",
)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/optimize")
def optimize() -> dict:
    return run()
