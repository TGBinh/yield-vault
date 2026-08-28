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

/** Parses a user-typed decimal string into base units. Throws on invalid input. */
export function parseTokenAmount(input: string, decimals: number): bigint {
  const trimmed = input.trim();
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
