"use client";

import { Component, type ReactNode } from "react";

type Props = { name: string; children: ReactNode };
type State = { error: Error | null };

const AUTO_RESET_MS = 60_000;

/**
 * Crash guard for one dashboard module. A tile throwing must never blank the
 * page. Shows a themed error panel, retries automatically after a minute (no
 * human is at a wall screen), and on demand.
 */
export class TileBoundary extends Component<Props, State> {
  state: State = { error: null };
  private timer: number | undefined;

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(`[${this.props.name}] tile crashed`, error);
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(this.reset, AUTO_RESET_MS);
  }

  componentWillUnmount() {
    window.clearTimeout(this.timer);
  }

  reset = () => {
    window.clearTimeout(this.timer);
    this.setState({ error: null });
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <section className="corners relative flex flex-col border border-line bg-surface" aria-label={`${this.props.name} error`}>
        <span className="corner-b" aria-hidden="true" />
        <header className="flex items-center justify-between gap-3 border-b border-line px-3 py-2">
          <h2 className="label text-accent">{this.props.name}</h2>
          <span className="label text-danger">Fault</span>
        </header>
        <div className="flex flex-col gap-2 px-4 py-5">
          <p className="label text-foreground">This module hit an error and was isolated.</p>
          <p className="label text-[10px] text-muted">{this.state.error.message || "Unknown error"} · auto-retry in 60s</p>
          <button type="button" onClick={this.reset} className="label mt-1 w-fit border border-line px-3 py-1.5 text-foreground hover:border-line-strong hover:bg-surface-hover">
            Retry now
          </button>
        </div>
      </section>
    );
  }
}
