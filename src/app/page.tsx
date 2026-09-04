import { CameraGrid } from "@/components/camera-grid";
import { NewsTicker } from "@/components/news-ticker";
import { Panel } from "@/components/panel";
import { SiteHeader } from "@/components/site-header";
import { googleConfigured } from "@/lib/google";

// Tiles that land in Phase 3.
const PENDING_MODULES: Array<{ title: string; detail: string }> = [
  { title: "Weather", detail: "NWS · Tacoma, WA" },
  { title: "Notes", detail: "Checklist + scratchpad" },
  { title: "Radio", detail: "Tacoma PD dispatch" },
];

export const dynamic = "force-dynamic";

export default function DashboardPage() {
  const linked = googleConfigured();

  return (
    <div className="flex flex-1 flex-col">
      <SiteHeader />
      <NewsTicker />

      <main className="flex flex-1 flex-col gap-4 p-4 sm:p-6">
        <CameraGrid />

        <section className="grid gap-4 sm:grid-cols-3">
          {PENDING_MODULES.map((m) => (
            <Panel key={m.title} title={m.title} meta="Pending" bodyClassName="min-h-24 justify-center px-3 py-3">
              <p className="label text-muted">{m.detail}</p>
              <p className="label mt-1 text-[10px] text-muted/70">Module arrives in Phase 3</p>
            </Panel>
          ))}
        </section>
      </main>

      <footer className="flex flex-wrap items-center gap-x-6 gap-y-1 border-t border-line px-4 py-2 sm:px-6">
        <span className="label text-muted">
          System <span className="text-ok">nominal</span>
        </span>
        <span className="label text-muted">
          Auth <span className="text-ok">ok</span>
        </span>
        <span className="label text-muted">
          Uplink {linked ? <span className="text-ok">linked</span> : <span className="text-warn">not linked</span>}
        </span>
        <span className="label ml-auto text-muted">Home Ops · v0.2</span>
      </footer>
    </div>
  );
}
