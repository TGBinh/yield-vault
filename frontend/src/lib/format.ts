/**
 * Formatting helpers for on-chain token amounts. All amounts in this app are
 * bigint base units — never format with plain JS number math (precision loss).
 */

export function formatTokenAmount(
  value: bigint | undefined,
  decimals: number,
  opts?: { maxFractionDigits?: number },
): string {
  if (value === undefined) return "—";
  const maxFractionDigits = opts?.maxFractionDigits ?? 4;
  const divisor = 10n ** BigInt(decimals);
  const whole = value / divisor;
  const remainder = value % divisor;

  if (remainder === 0n) {
    return whole.toLocaleString("en-US");
  }

  const fractionStr = remainder.toString().padStart(decimals, "0");
  const trimmed = fractionStr.slice(0, maxFractionDigits).replace(/0+$/, "");
  const wholeStr = whole.toLocaleString("en-US");
  return trimmed.length > 0 ? `${wholeStr}.${trimmed}` : wholeStr;
}

/**
 * Vault Security Audit - High: sinh chuỗi để NHẬP LẠI vào input (nút "Max") - KHÔNG
 * dùng chung với formatTokenAmount (dấu phẩy nhóm hàng nghìn của formatTokenAmount làm
 * parseTokenAmount reject silently khi số dư >= 1000, khiến nút Deposit/Withdraw bị
 * disable mà không có thông báo lỗi nào - bug thật, đã verify).
 */
export function toRawAmountString(value: bigint, decimals: number): string {
  const divisor = 10n ** BigInt(decimals);
  const whole = value / divisor;
  const remainder = value % divisor;
  if (remainder === 0n) return whole.toString();

  const fractionStr = remainder.toString().padStart(decimals, "0").replace(/0+$/, "");
  return fractionStr.length > 0 ? `${whole.toString()}.${fractionStr}` : whole.toString();
}

/** Parses a user-typed decimal string into base units. Throws on invalid input. */
export function parseTokenAmount(input: string, decimals: number): bigint {
  // Chấp nhận và bỏ dấu phẩy nhóm hàng nghìn phòng hờ user paste từ nơi khác - lớp
  // phòng thủ thứ 2 độc lập với việc sửa nút Max ở trên.
  const trimmed = input.trim().replace(/,/g, "");
  if (trimmed === "" || !/^\d*\.?\d*$/.test(trimmed) || trimmed === ".") {
    throw new Error("Invalid amount");
  }
  const [wholePart, fractionPart = ""] = trimmed.split(".");
  if (fractionPart.length > decimals) {
    throw new Error(`Too many decimal places (max ${decimals})`);
  }
  const paddedFraction = fractionPart.padEnd(decimals, "0");
  const combined = `${wholePart || "0"}${paddedFraction}`;
  return BigInt(combined);
}

export function shortenAddress(address: string | undefined, chars = 4): string {
  if (!address) return "";
  return `${address.slice(0, 2 + chars)}…${address.slice(-chars)}`;
}

/**
 * "23h 14m", "2d 3h", "45s" - dùng cho đếm ngược timelock (Governance) và tooltip chart.
 * Âm (đã qua hạn) trả về "0s" thay vì chuỗi âm gây hiểu nhầm - caller tự quyết định hiển
 * thị "đã qua hạn"/"có thể thực thi" dựa trên dấu của giá trị gốc, hàm này chỉ format độ
 * lớn.
 */
export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

/** "vừa xong", "5 phút trước", "3 giờ trước" - dùng cho nhãn trục thời gian trên chart/danh sách sự kiện. */
export function formatRelativeTime(timestampMs: number): string {
  const diffSeconds = Math.floor((Date.now() - timestampMs) / 1000);
  if (diffSeconds < 5) return "vừa xong";
  if (diffSeconds < 60) return `${diffSeconds} giây trước`;
  if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)} phút trước`;
  if (diffSeconds < 86400) return `${Math.floor(diffSeconds / 3600)} giờ trước`;
  return `${Math.floor(diffSeconds / 86400)} ngày trước`;
}
