"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        router.push(next);
        router.refresh();
        return;
      }
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(data?.error ?? `Login failed (${res.status}).`);
      setPassword("");
      setSubmitting(false);
    } catch {
      setError("Network error. Try again.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      <label className="flex flex-col gap-2">
        <span className="label text-muted">Access code</span>
        <input
          type="password"
          name="password"
          autoComplete="current-password"
          autoFocus
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="border border-line bg-background px-3 py-2.5 font-mono text-base tracking-[0.3em] text-foreground outline-none transition focus:border-accent focus:shadow-[0_0_0_1px_var(--accent),0_0_18px_rgba(92,200,232,0.25)]"
        />
      </label>

      <div className="min-h-5" aria-live="polite">
        {error ? (
          <p role="alert" className="label text-danger">
            Access denied · {error}
          </p>
        ) : null}
      </div>

      <button
        type="submit"
        disabled={submitting || password.length === 0}
        className="label border border-accent bg-accent/10 px-4 py-2.5 font-medium text-accent transition hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {submitting ? "Verifying…" : "Authenticate"}
      </button>
    </form>
  );
}
