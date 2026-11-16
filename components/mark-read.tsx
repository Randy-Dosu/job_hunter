"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCheck, Loader2 } from "lucide-react";

export function MarkAllRead({ count }: { count: number }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  if (!count) return null;

  return (
    <button
      type="button"
      className="btn-ghost btn-sm"
      onClick={async () => {
        setLoading(true);
        try {
          await fetch("/api/notifications", { method: "POST" });
          router.refresh();
        } finally {
          setLoading(false);
        }
      }}
      disabled={loading}
    >
      {loading ? <Loader2 size={12} className="animate-spin" /> : <CheckCheck size={12} />}
      Mark {count} read
    </button>
  );
}
