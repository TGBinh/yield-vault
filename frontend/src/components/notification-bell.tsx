"use client";

import { useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNotifications } from "@/hooks/use-notifications";
import { formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Phase 4 (realtime notifications): chuông + badge số chưa đọc + dropdown danh sách, đặt
 * cạnh ConnectWallet ở site-header.tsx. Dropdown đơn giản (không dùng thêm dependency
 * popover mới) - đóng khi click ra ngoài. Phase 5 (responsive): dưới `sm:` panel chuyển
 * sang `fixed` gần full-width/full-height ngay dưới header (thay vì dropdown góc nhỏ khó
 * chạm trên mobile) - `containerRef.contains()` vẫn hoạt động đúng dù panel đổi từ
 * `absolute` sang `fixed` vì đó là quan hệ DOM, không phụ thuộc CSS position.
 */
export function NotificationBell() {
  const { notifications, unreadCount, markAllRead } = useNotifications();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <Button
        variant="ghost"
        size="icon"
        aria-label="Thông báo"
        className="relative"
        onClick={() => {
          setOpen((v) => !v);
          if (!open) markAllRead();
        }}
      >
        <Bell className="size-5" />
        {unreadCount > 0 && (
          <span className="absolute right-1 top-1 flex size-4 items-center justify-center rounded-full bg-negative text-[10px] font-medium text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </Button>

      {open && (
        <div
          className={cn(
            "animate-overlay-fade-in fixed inset-x-3 top-[4.25rem] z-50 rounded-lg border border-border bg-surface shadow-lg",
            "sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-80 sm:max-w-[calc(100vw-2rem)]",
          )}
        >
          <div className="border-b border-border px-3 py-2">
            <p className="text-sm font-medium text-foreground">Thông báo</p>
          </div>
          <div className="max-h-[70vh] overflow-y-auto sm:max-h-96">
            {notifications.length === 0 && (
              <p className="px-3 py-6 text-center text-sm text-muted">Chưa có thông báo nào.</p>
            )}
            {notifications.map((n) => (
              <div key={n.id} className="border-b border-border/60 px-3 py-2.5 last:border-b-0">
                <p className="text-sm text-foreground">{n.message}</p>
                <p className="mt-0.5 text-[11px] text-muted">{formatRelativeTime(n.timestamp)}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
