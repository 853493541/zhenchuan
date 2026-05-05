"use client";

import { Copy } from "lucide-react";

import { toastError, toastSuccess } from "../components/toast/toast";

export default function CopyNameButton({ value, label = "复制名称" }: { value: string; label?: string }) {
  const handleCopy = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();

    try {
      await navigator.clipboard.writeText(value);
      toastSuccess(`已复制：${value}`);
    } catch {
      toastError("复制失败");
    }
  };

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={handleCopy}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 22,
        height: 22,
        borderRadius: 6,
        border: "1px solid #d8d0c6",
        background: "#fffdf9",
        color: "#6d6257",
        cursor: "pointer",
        padding: 0,
        flexShrink: 0,
      }}
    >
      <Copy size={13} strokeWidth={2} aria-hidden="true" />
    </button>
  );
}