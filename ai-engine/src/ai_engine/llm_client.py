"""Real Anthropic API integration using tool-use to force structured output (never
free-form text parsing for the decision fields - PLAN.md GD4 §3: "Thiết kế prompt có
structured output (JSON schema bắt buộc, không tự do văn bản cho phần quyết định)").

NOTE: this has NOT been exercised against a real API call in this environment (no
ANTHROPIC_API_KEY was available while building this - see ai-engine/README.md and
PLAN.md GD4 notes). The integration follows Anthropic's documented tool-use pattern
correctly, but is unverified end-to-end; the fallback path (service.py) IS fully
verified since it doesn't depend on a live API call.
"""
from __future__ import annotations

import json
import os

from anthropic import Anthropic, APIError, APITimeoutError

from ai_engine.models import OptimizationInput, Recommendation

_MODEL = "claude-sonnet-5"
_TIMEOUT_SECONDS = 20.0

_RECOMMENDATION_TOOL = {
    "name": "submit_recommendation",
    "description": "Submit a structured allocation recommendation for the yield vault.",
    "input_schema": {
        "type": "object",
        "properties": {
            "allocations": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "strategy_id": {"type": "string"},
                        "target_weight_bps": {"type": "integer", "minimum": 0, "maximum": 10000},
                        "risk_score": {"type": "number"},
                        "expected_apy": {"type": "number"},
                    },
                    "required": ["strategy_id", "target_weight_bps", "risk_score", "expected_apy"],
                },
            },
            "confidence": {
                "type": "number",
                "minimum": 0,
                "maximum": 1,
                "description": "Your confidence in this recommendation, 0-1",
            },
            "explanation": {
                "type": "string",
                "description": "Natural-language explanation for a human reviewer - display only, never parsed for the decision itself",
            },
            "risk_flags": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Short machine-readable flags for anything noteworthy (e.g. 'concentration_risk', 'low_liquidity')",
            },
        },
        "required": ["allocations", "confidence", "explanation", "risk_flags"],
    },
}


class LlmUnavailableError(Exception):
    """Raised whenever the LLM call cannot be trusted to have produced a usable
    Recommendation - missing API key, timeout, API error, or invalid tool output. The
    caller (service.py) always has a deterministic fallback for this (PLAN.md GD4 §4:
    "AI là lớp bổ sung, không phải phụ thuộc cứng")."""


def _build_prompt(optimization_input: OptimizationInput) -> str:
    allocations_json = json.dumps([a.model_dump() for a in optimization_input.allocations], indent=2)
    return f"""You are reviewing a deterministic Risk/Optimization Engine's proposed allocation
for a DeFi yield vault. The proposal below already accounts for risk scores and expected
APY per strategy - your job is to sanity-check it, flag anything concerning, and either
confirm it or propose a small adjustment, then call submit_recommendation with your
final structured answer.

You are NOT authorized to execute anything - your output is reviewed by a separate,
independent Policy Engine before any human can approve it, and by a human after that.
Do not claim in your explanation that any action has been taken.

Proposed allocation from the deterministic engine:
{allocations_json}
"""


def generate_recommendation(optimization_input: OptimizationInput) -> Recommendation:
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise LlmUnavailableError("ANTHROPIC_API_KEY not set")

    client = Anthropic(api_key=api_key, timeout=_TIMEOUT_SECONDS)

    try:
        response = client.messages.create(
            model=_MODEL,
            max_tokens=1024,
            tools=[_RECOMMENDATION_TOOL],
            tool_choice={"type": "tool", "name": "submit_recommendation"},
            messages=[{"role": "user", "content": _build_prompt(optimization_input)}],
        )
    except (APIError, APITimeoutError) as exc:
        raise LlmUnavailableError(f"Anthropic API call failed: {exc}") from exc

    tool_use_block = next((b for b in response.content if b.type == "tool_use"), None)
    if tool_use_block is None:
        raise LlmUnavailableError("Model did not return a tool_use block")

    try:
        return Recommendation(
            allocations=tool_use_block.input["allocations"],
            source="ai",
            confidence=tool_use_block.input["confidence"],
            explanation=tool_use_block.input["explanation"],
            risk_flags=tool_use_block.input.get("risk_flags", []),
        )
    except (KeyError, TypeError, ValueError) as exc:
        raise LlmUnavailableError(f"Model output failed schema validation: {exc}") from exc
