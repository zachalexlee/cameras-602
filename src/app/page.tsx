import { CameraGrid } from "@/components/camera-grid";
import { KeepAwake } from "@/components/keep-awake";
import { NewsTicker } from "@/components/news-ticker";
import { NotesTile } from "@/components/notes-tile";
import { RadioTile } from "@/components/radio-tile";
import { SiteHeader } from "@/components/site-header";
import { TileBoundary } from "@/components/tile-boundary";
import { WeatherTile } from "@/components/weather-tile";
import { googleConfigured, listCameras } from "@/lib/google";
import { radioConfig } from "@/lib/radio";

export const dynamic = "force-dynamic";
const SERVER_LIST_TIMEOUT_MS = 3_000;

export default async function DashboardPage() {
  const linked = googleConfigured();
  const radio = radioConfig();
  // Render the right number of tiles on first paint (no skeleton → no layout shift).
  // Cached server-side for 5 min; any failure falls back to the client fetch and its error UI.
  // Bounded so a slow Google never delays the whole page; the client fills in if we give up.
  const initialCameras = linked
    ? await Promise.race([
        listCameras().catch(() => null),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), SERVER_LIST_TIMEOUT_MS)),
      ])
    : null;

  return (
    <div className="flex flex-1 flex-col">
      <KeepAwake />
      <SiteHeader />
      <TileBoundary name="News wire">
        <NewsTicker />
      </TileBoundary>

      <main className="flex flex-1 flex-col gap-4 p-4 sm:p-6">
        <TileBoundary name="Live feeds">
          <CameraGrid initialCameras={initialCameras} />
        </TileBoundary>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label="Dashboard modules">
          <TileBoundary name="Weather">
            <WeatherTile />
          </TileBoundary>
          <TileBoundary name="Notes">
            <NotesTile />
          </TileBoundary>
          <TileBoundary name="Radio">
            <RadioTile config={radio} />
          </TileBoundary>
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
        <span className="label ml-auto text-muted">Home Ops · v1.0</span>
      </footer>
    </div>
  );
}
