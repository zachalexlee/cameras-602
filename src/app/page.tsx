import { CameraGrid } from "@/components/camera-grid";
import { NewsTicker } from "@/components/news-ticker";
import { NotesTile } from "@/components/notes-tile";
import { RadioTile } from "@/components/radio-tile";
import { SiteHeader } from "@/components/site-header";
import { WeatherTile } from "@/components/weather-tile";
import { googleConfigured } from "@/lib/google";
import { radioConfig } from "@/lib/radio";

export const dynamic = "force-dynamic";

export default function DashboardPage() {
  const linked = googleConfigured();
  const radio = radioConfig();

  return (
    <div className="flex flex-1 flex-col">
      <SiteHeader />
      <NewsTicker />

      <main className="flex flex-1 flex-col gap-4 p-4 sm:p-6">
        <CameraGrid />

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label="Dashboard modules">
          <WeatherTile />
          <NotesTile />
          <RadioTile config={radio} />
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
        <span className="label ml-auto text-muted">Home Ops · v0.3</span>
      </footer>
    </div>
  );
}
