"use client";

import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { toast } from "sonner";
import { BACKEND_URL } from "@/lib/backend";
import { formatTokenAmount, shortenAddress } from "@/lib/format";

// Số thập phân mUSDC cho hiển thị TRAY thông báo - hardcode 6 (chuẩn USDC) thay vì đọc
// on-chain qua useVaultData(): NotificationBell nằm ở site-header, render trên MỌI trang
// kể cả khi ví chưa kết nối, không muốn kéo theo 1 hook nặng phụ thuộc ví chỉ để lấy 1 con
// số hầu như không bao giờ đổi. Đây là hiển thị tray, không phải tính toán tài chính.
const NOTIFICATION_ASSET_DECIMALS = 6;

export type VaultNotification = {
  id: string;
  message: string;
  timestamp: number;
  read: boolean;
};

type RawEvent = Record<string, unknown> & {
  type?: string;
  tx_hash?: string;
  log_index?: number;
};

function buildMessage(eventName: string, raw: RawEvent): string | null {
  switch (eventName) {
    case "deposit": {
      const assets = typeof raw.assets === "string" ? BigInt(raw.assets) : 0n;
      const owner = typeof raw.owner_address === "string" ? raw.owner_address : undefined;
      return `Deposit mới: ${formatTokenAmount(assets, NOTIFICATION_ASSET_DECIMALS)} mUSDC từ ${shortenAddress(owner)}`;
    }
    case "withdrawal": {
      const assets = typeof raw.assets === "string" ? BigInt(raw.assets) : 0n;
      const owner = typeof raw.owner_address === "string" ? raw.owner_address : undefined;
      return `Rút vốn: ${formatTokenAmount(assets, NOTIFICATION_ASSET_DECIMALS)} mUSDC từ ${shortenAddress(owner)}`;
    }
    case "strategy-event": {
      const name = raw.event_name;
      if (name === "AllocationsUpdated") return "Phân bổ chiến lược vừa được cập nhật.";
      return typeof name === "string" ? `Sự kiện chiến lược: ${name}` : null;
    }
    case "governance-event": {
      const name = raw.event_name;
      if (name === "RebalanceQueued") return "Có đề xuất rebalance mới đang chờ timelock.";
      if (name === "RebalanceExecuted") return "Rebalance đã được thực thi.";
      if (name === "RebalanceCanceled") return "Đề xuất rebalance đã bị huỷ.";
      if (name === "TransferQueued") return "Có đề xuất chuyển tài sản cross-chain mới đang chờ timelock.";
      if (name === "TransferExecuted") return "Chuyển tài sản cross-chain đã được thực thi.";
      if (name === "TransferCanceled") return "Đề xuất chuyển tài sản cross-chain đã bị huỷ.";
      return typeof name === "string" ? `Sự kiện quản trị: ${name}` : null;
    }
    default:
      return null;
  }
}

const NOTIFIED_EVENTS = ["deposit", "withdrawal", "strategy-event", "governance-event"];

/**
 * Phase 4 (realtime notifications): kết nối Socket.IO tới backend NotificationsGateway.
 * Backend chỉ emit SAU KHI indexer xác nhận event (không phải lúc thấy log lần đầu, tránh
 * false-positive do reorg) - xem indexer/src/reorg-confirmer.ts + redis-publisher.ts.
 * Mỗi event nhận được vừa toast() (tái dùng sonner, đúng pattern use-tx.ts) vừa append vào
 * list giữ trong state cho phần "tray" (notification-bell.tsx). socket.io-client tự động
 * reconnect với backoff khi backend/Redis tạm thời không sống - không cần xử lý gì thêm để
 * tránh crash phía client.
 */
export function useNotifications() {
  const [notifications, setNotifications] = useState<VaultNotification[]>([]);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const socket = io(BACKEND_URL, { transports: ["websocket", "polling"] });
    socketRef.current = socket;

    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));

    const handlers = NOTIFIED_EVENTS.map((eventName) => {
      const handler = (raw: RawEvent) => {
        const message = buildMessage(eventName, raw);
        if (!message) return;
        toast.info(message);
        setNotifications((prev) =>
          [
            {
              id: `${eventName}:${raw.tx_hash ?? Math.random().toString(36).slice(2)}:${raw.log_index ?? 0}`,
              message,
              timestamp: Date.now(),
              read: false,
            },
            ...prev,
          ].slice(0, 50),
        );
      };
      socket.on(eventName, handler);
      return { eventName, handler };
    });

    return () => {
      handlers.forEach(({ eventName, handler }) => socket.off(eventName, handler));
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  const unreadCount = notifications.filter((n) => !n.read).length;

  function markAllRead() {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }

  return { notifications, unreadCount, connected, markAllRead };
}
