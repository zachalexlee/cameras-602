import { Emblem } from "@/components/emblem";
import { LoginForm } from "./login-form";
import { safeNextPath } from "@/lib/request";

export const metadata = { title: "Restricted · Home Ops" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const rawNext = Array.isArray(params.next) ? params.next[0] : params.next;
  const next = safeNextPath(rawNext);

  return (
    <main className="flex flex-1 flex-col items-center justify-center p-6">
      <div className="corners relative w-full max-w-sm border border-line bg-surface shadow-[0_30px_80px_rgba(0,0,0,0.6)]">
        <span className="corner-b" aria-hidden="true" />

        <div className="flex items-center justify-between border-b border-line px-5 py-2.5">
          <span className="label text-accent">Restricted access</span>
          <span className="label text-muted">Auth gate</span>
        </div>

        <div className="flex flex-col gap-6 px-5 py-6">
          <div className="flex items-center gap-3">
            <Emblem className="h-9 w-9 text-accent" />
            <div className="leading-tight">
              <div className="glow font-mono text-lg font-semibold tracking-[0.2em]">HOME OPS</div>
              <div className="label text-muted">Authorized personnel only</div>
            </div>
          </div>

          <LoginForm next={next} />
        </div>

        <div className="flex items-center justify-between gap-4 border-t border-line px-5 py-2.5">
          <span className="label text-muted">Rate-limited</span>
          <span className="label whitespace-nowrap text-muted">v0.1 · Phase 1</span>
        </div>
      </div>
    </main>
  );
}
