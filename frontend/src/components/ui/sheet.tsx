"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Drawer trượt từ cạnh trái (mobile nav) dựng trên @radix-ui/react-dialog - lib này đã
 * là dependency có sẵn nhưng CHƯA được dùng ở đâu trong app trước Phase 0 (xác nhận qua
 * khảo sát). Giữ tối giản: chỉ đủ cho menu điều hướng mobile, không phải dialog đa dụng.
 */
function Sheet(props: DialogPrimitive.DialogProps) {
  return <DialogPrimitive.Root {...props} />;
}

function SheetTrigger(props: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger {...props} />;
}

function SheetContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 animate-overlay-fade-in" />
      <DialogPrimitive.Content
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex h-full w-72 max-w-[80vw] flex-col gap-4 border-r border-border bg-surface p-5 shadow-lg outline-none animate-sheet-slide-in-left",
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close className="absolute right-4 top-4 rounded-md p-1 text-muted transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <X className="size-4" />
          <span className="sr-only">Đóng</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

function SheetTitle(props: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className="text-sm font-semibold" {...props} />;
}

export { Sheet, SheetTrigger, SheetContent, SheetTitle };
