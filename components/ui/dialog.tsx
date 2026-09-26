"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { cn } from "@/src/lib/cn";
import type { ReactNode } from "react";

export function SimpleDialog({
  trigger,
  title,
  children,
}: {
  trigger: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/70" />
        <Dialog.Content
          className={cn(
            "fixed left-1/2 top-1/2 w-[min(32rem,calc(100%-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-[var(--line)] bg-[#12141a] p-5 shadow-2xl",
          )}
        >
          <Dialog.Title className="mb-3 text-lg">{title}</Dialog.Title>
          {children}
          <Dialog.Close className="mt-4 text-sm text-[var(--muted)]">Close</Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
