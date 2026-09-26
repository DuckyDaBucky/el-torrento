import { cn } from "@/src/lib/cn";
import type { InputHTMLAttributes } from "react";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-10 w-full rounded-md border border-[var(--line)] bg-black/30 px-3 text-sm outline-none placeholder:text-[var(--muted)] focus:border-[var(--sand)]",
        className,
      )}
      {...props}
    />
  );
}
