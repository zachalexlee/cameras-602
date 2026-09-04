import { Emblem } from "@/components/emblem";
import { LogoutButton } from "@/components/logout-button";
import { StatusClock } from "@/components/status-clock";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-elev/90 backdrop-blur">
      <div className="flex items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-2 sm:gap-3">
          <Emblem className="h-7 w-7 text-accent" />
          <div className="leading-tight">
            <div className="glow whitespace-nowrap font-mono text-base font-semibold tracking-[0.2em] text-foreground">HOME OPS</div>
            <div className="label hidden whitespace-nowrap text-muted sm:block">Surveillance console</div>
          </div>
        </div>

        <div className="flex items-center gap-3 sm:gap-6">
          <div className="hidden items-center gap-2 md:flex">
            <span className="status-dot" aria-hidden="true" />
            <span className="label text-ok">Session active</span>
          </div>
          <StatusClock />
          <LogoutButton />
        </div>
      </div>
    </header>
  );
}
