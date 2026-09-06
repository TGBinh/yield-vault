/**
 * Vault Security Audit - High: deposit/withdraw preview (convertToShares/
 * convertToAssets) đọc lúc user gõ số, nhưng lúc ký giao dịch thật không re-check gì -
 * giữa preview và lúc tx được mine, share price có thể đổi (rebalance chạy giữa chừng,
 * hoặc MEV sandwich), user nhận ít hơn hẳn so với những gì họ thấy mà không có cách từ
 * chối. Vault ERC-4626 hiện tại KHÔNG có tham số minOut ở cấp contract (deposit/
 * withdraw/redeem chuẩn không nhận min-output) - đây là biện pháp giảm thiểu tạm thời ở
 * tầng client: so lại giá trị "tươi" ngay trước khi ký với giá trị preview user đã thấy,
 * chặn tx nếu lệch quá ngưỡng. Giải pháp đầy đủ (true minOut/deadline) cần thêm tham số
 * ở contract - ngoài phạm vi patch frontend-only này.
 */
export const DEFAULT_SLIPPAGE_TOLERANCE_BPS = 50n; // 0.5%
const BPS_DENOMINATOR = 10_000n;

export function isWithinSlippageTolerance(
  previewValue: bigint,
  freshValue: bigint,
  toleranceBps: bigint = DEFAULT_SLIPPAGE_TOLERANCE_BPS,
): boolean {
  if (previewValue === 0n) return freshValue === 0n;
  const diff = previewValue > freshValue ? previewValue - freshValue : freshValue - previewValue;
  return diff * BPS_DENOMINATOR <= previewValue * toleranceBps;
}
