"""Cross-chain opportunity comparison (Phase 5) - PLAN.md GD5 §4: so sánh risk-adjusted
yield GIỮA các chain, tính "ngưỡng đáng để chuyển" theo công thức ở tài liệu gốc:

    Expected Yield Improvement > Gas + Bridge Fee + Slippage + Execution Cost + Risk Premium

Đây CHỈ SINH KHUYẾN NGHỊ - không thực thi cross-chain (di chuyển vốn thật để dành GĐ6).
"Lợi suất cao hơn" KHÔNG tự động nghĩa là "nên chuyển": nếu phần cải thiện annualized
trên đúng quy mô vốn hiện có không đủ bù chi phí một-lần của việc chuyển (gas cầu nối,
phí bridge, trượt giá, chi phí thực thi, phần bù rủi ro cho quy trình bridge chưa kiểm
chứng), chuyển là lỗ ròng dù APY đích cao hơn trên giấy.
"""
from __future__ import annotations

from pydantic import BaseModel, Field


class ChainOpportunity(BaseModel):
    chain_id: int
    chain_name: str
    strategy_id: str
    expected_apy: float = Field(description="APY dạng phân số, 0.05 = 5%/năm")
    risk_score: float = Field(ge=0, le=100)


class SwitchCostEstimate(BaseModel):
    """Chi phí MỘT LẦN để chuyển vốn sang chain khác - tất cả tính bằng USD tuyệt đối
    trên đúng quy mô vốn đang xét, không phải %."""

    gas_cost_usd: float = Field(ge=0)
    bridge_fee_usd: float = Field(ge=0)
    slippage_usd: float = Field(ge=0)
    execution_cost_usd: float = Field(ge=0)
    risk_premium_usd: float = Field(
        ge=0, description="Phần bù rủi ro cho quy trình bridge/chain đích chưa kiểm chứng bằng chain hiện tại"
    )

    @property
    def total_usd(self) -> float:
        return (
            self.gas_cost_usd
            + self.bridge_fee_usd
            + self.slippage_usd
            + self.execution_cost_usd
            + self.risk_premium_usd
        )


class SwitchRecommendation(BaseModel):
    should_switch: bool
    annualized_yield_improvement_usd: float
    total_switch_cost_usd: float
    net_benefit_usd: float
    payback_days: float | None = Field(
        default=None, description="Số ngày để phần lãi thêm bù lại chi phí chuyển - None nếu không bao giờ hoàn vốn"
    )
    reasoning: str


def evaluate_switch(
    current: ChainOpportunity,
    candidate: ChainOpportunity,
    position_size_usd: float,
    costs: SwitchCostEstimate,
) -> SwitchRecommendation:
    """position_size_usd: quy mô vốn ĐANG XÉT chuyển - chi phí chuyển là số tuyệt đối cố
    định (phí gas/bridge gần như không phụ thuộc số tiền), nên vị thế càng nhỏ càng khó
    bù chi phí - đây chính là lý do "APY cao hơn" không tự động đáng chuyển."""
    if position_size_usd <= 0:
        return SwitchRecommendation(
            should_switch=False,
            annualized_yield_improvement_usd=0.0,
            total_switch_cost_usd=costs.total_usd,
            net_benefit_usd=-costs.total_usd,
            reasoning="Position size is zero or negative - nothing to switch.",
        )

    apy_delta = candidate.expected_apy - current.expected_apy
    annualized_improvement = position_size_usd * apy_delta
    total_cost = costs.total_usd
    net_benefit = annualized_improvement - total_cost

    payback_days: float | None = None
    if annualized_improvement > 0:
        daily_improvement = annualized_improvement / 365.0
        payback_days = total_cost / daily_improvement if daily_improvement > 0 else None

    should_switch = net_benefit > 0

    if apy_delta <= 0:
        reasoning = (
            f"Candidate chain's APY ({candidate.expected_apy * 100:.2f}%) is not better than "
            f"current ({current.expected_apy * 100:.2f}%) - no reason to pay switch costs for a worse or equal yield."
        )
    elif should_switch:
        reasoning = (
            f"Annualized yield improvement (${annualized_improvement:,.2f}) exceeds total switch cost "
            f"(${total_cost:,.2f}) by ${net_benefit:,.2f}"
            + (f" - pays back in ~{payback_days:.0f} days." if payback_days else ".")
        )
    else:
        reasoning = (
            f"Annualized yield improvement (${annualized_improvement:,.2f}) does NOT cover total switch cost "
            f"(${total_cost:,.2f}) - would be a net loss of ${-net_benefit:,.2f}. Higher APY alone isn't "
            f"enough; the position size here is too small to amortize the one-time switch cost."
        )

    return SwitchRecommendation(
        should_switch=should_switch,
        annualized_yield_improvement_usd=round(annualized_improvement, 2),
        total_switch_cost_usd=round(total_cost, 2),
        net_benefit_usd=round(net_benefit, 2),
        payback_days=round(payback_days, 1) if payback_days else None,
        reasoning=reasoning,
    )
