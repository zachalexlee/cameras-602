import { Panel } from "@/components/panel";
import { SiteHeader } from "@/components/site-header";

// Placeholder feeds until Phase 2 wires up the real SDM device list.
const PLACEHOLDER_FEEDS = ["Front door", "Backyard", "Driveway", "Side gate"];

// Tiles that land in Phase 3.
const PENDING_MODULES: Array<{ title: string; detail: string }> = [
  { title: "Weather", detail: "NWS · Tacoma, WA" },
  { title: "News wire", detail: "AP · NPR · local" },
  { title: "Notes", detail: "Checklist + scratchpad" },
  { title: "Radio", detail: "Tacoma PD dispatch" },
];

export default function DashboardPage() {
  return (
    <div className="flex flex-1 flex-col">
      <SiteHeader />

      <main className="flex flex-1 flex-col gap-4 p-4 sm:p-6">
        <div className="flex items-center justify-between">
          <h1 className="label text-muted">
            Live feeds · <span className="text-foreground">{PLACEHOLDER_FEEDS.length}</span> cameras
          </h1>
          <span className="label text-muted">Grid · auto</span>
        </div>

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {PLACEHOLDER_FEEDS.map((name, i) => (
            <Panel
              key={name}
              title={`Cam ${String(i + 1).padStart(2, "0")} · ${name}`}
              meta={<span className="text-warn">Standby</span>}
              bodyClassName="aspect-video items-center justify-center"
            >
              <div className="flex flex-col items-center gap-2">
                <span className="label text-muted">No signal</span>
                <span className="label text-[10px] text-muted/70">Feed arrives in Phase 2</span>
              </div>
            </Panel>
          ))}
        </section>

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {PENDING_MODULES.map((m) => (
            <Panel key={m.title} title={m.title} meta="Pending" bodyClassName="min-h-28 justify-center px-3 py-3">
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
          Uplink <span className="text-warn">not linked</span>
        </span>
        <span className="label ml-auto text-muted">Home Ops · v0.1</span>
      </footer>
    </div>
  );
}
