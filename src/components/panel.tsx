import type { ReactNode } from "react";

type PanelProps = {
  title: string;
  /** Right-aligned readout in the header bar, e.g. an ID or status. */
  meta?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
};

/** Bordered console panel with corner brackets and a labeled header strip. */
export function Panel({ title, meta, children, className = "", bodyClassName = "" }: PanelProps) {
  return (
    <section className={`corners relative flex flex-col border border-line bg-surface ${className}`}>
      <span className="corner-b" aria-hidden="true" />
      <header className="flex items-center justify-between gap-3 border-b border-line px-3 py-2">
        <h2 className="label text-accent">{title}</h2>
        {meta ? <div className="label text-muted">{meta}</div> : null}
      </header>
      <div className={`flex flex-1 flex-col ${bodyClassName}`}>{children}</div>
    </section>
  );
}
