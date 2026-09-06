/**
 * Vault Security Audit - High: deposit/withdraw preview (convertToShares/
 * convertToAssets) đọc lúc user gõ số, nhưng lúc ký giao dịch thật không re-check gì -
 * giữa preview và lúc tx được mine, share price có thể đổi (rebalance chạy giữa chừng,
 * hoặc MEV sandwich), user nhận ít hơn hẳn so với những gì họ thấy mà không có cách từ
 * chối. Đã thêm `depositWithMinShares`/`redeemWithMinAssets` ở Vault.sol (minOut +
 * deadline thật, check atomic on-chain - nếu không đạt, toàn bộ tx rollback) thay cho
 * bước đọc-lại-rồi-tự-chặn phía client trước đây (đã gỡ, không còn cần thiết vì contract
 * giờ tự bảo vệ đúng ngay trong cùng giao dịch).
 */
export const DEFAULT_SLIPPAGE_TOLERANCE_BPS = 50n; // 0.5%
const BPS_DENOMINATOR = 10_000n;
export const DEFAULT_DEADLINE_SECONDS = 20 * 60; // 20 phút, đủ cho user xác nhận ví chậm

/// @notice Tính `minOut` để truyền vào `depositWithMinShares`/`redeemWithMinAssets` từ
/// giá trị preview user đang thấy trên UI - trừ đi đúng phần trăm dung sai cho phép.
export function applySlippageTolerance(
  previewValue: bigint,
  toleranceBps: bigint = DEFAULT_SLIPPAGE_TOLERANCE_BPS,
): bigint {
  return previewValue - (previewValue * toleranceBps) / BPS_DENOMINATOR;
}

/// @notice Deadline dạng unix timestamp (giây) cho tham số `deadline` của contract.
export function makeDeadline(secondsFromNow: number = DEFAULT_DEADLINE_SECONDS): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + secondsFromNow);
}
