"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function logout() {
    if (busy) return;
    setBusy(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.push("/login");
      router.refresh();
    }
  }

  return (
    <button
      type="button"
      onClick={logout}
      disabled={busy}
      className="label whitespace-nowrap border border-line px-2 py-1.5 text-muted sm:px-3 transition hover:border-line-strong hover:bg-surface-hover hover:text-foreground disabled:opacity-50"
    >
      Sign out
    </button>
  );
}
