"""HTTP wrapper around the existing scoring/optimization pipeline (main.py's `run()`),
so the Backend can call it as part of the GD4 chain: Risk/Optimization Engine -> AI
Engine -> Policy Engine -> Execution Intent (PLAN.md §2.4/GD4 §5). The scoring math
itself is unchanged - this file adds no new logic, only an HTTP entrypoint.
"""
from __future__ import annotations

from fastapi import FastAPI

from risk_engine.cross_chain import ChainOpportunity, SwitchCostEstimate, SwitchRecommendation, evaluate_switch
from risk_engine.main import run
from pydantic import BaseModel

app = FastAPI(
    title="Yield Vault Risk & Optimization Engine",
    description="Deterministic (no AI/LLM) risk scoring + allocation optimization - see PLAN.md GD3/GD5.",
)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/optimize")
def optimize() -> dict:
    return run()


class CrossChainEvaluateRequest(BaseModel):
    current: ChainOpportunity
    candidate: ChainOpportunity
    position_size_usd: float
    costs: SwitchCostEstimate


@app.post("/cross-chain/evaluate", response_model=SwitchRecommendation)
def cross_chain_evaluate(request: CrossChainEvaluateRequest) -> SwitchRecommendation:
    """PLAN.md GD5 §4/§6: 'nên/không nên chuyển sang chain X' kèm số liệu chi phí-lợi ích -
    display-only recommendation, no cross-chain execution happens here or anywhere yet."""
    return evaluate_switch(
        request.current, request.candidate, request.position_size_usd, request.costs
    )
