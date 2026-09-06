"use client";

import { useCallback, useMemo, useState } from "react";
import { parseTokenAmount, toRawAmountString } from "@/lib/format";

/**
 * Vault Security Audit - dedupe: deposit-form và withdraw-form trước đây tự chép lại
 * gần y hệt logic parse + validate amount (rawAmount state, parseTokenAmount trong
 * useMemo, so exceedsBalance, nút Max) - gom về 1 hook dùng chung để tránh lệch hành
 * vi giữa 2 form khi sửa sau này.
 */
export function useAmountInput(decimals: number, balance: bigint | undefined) {
  const [rawAmount, setRawAmount] = useState("");

  const amount = useMemo(() => {
    try {
      return rawAmount ? parseTokenAmount(rawAmount, decimals) : 0n;
    } catch {
      return null;
    }
  }, [rawAmount, decimals]);

  const isValid = amount !== null && amount > 0n;
  const exceedsBalance = isValid && balance !== undefined && amount > balance;

  const setMax = useCallback(() => {
    if (balance !== undefined) {
      setRawAmount(toRawAmountString(balance, decimals));
    }
  }, [balance, decimals]);

  const reset = useCallback(() => setRawAmount(""), []);

  return { rawAmount, setRawAmount, amount, isValid, exceedsBalance, setMax, reset };
}
