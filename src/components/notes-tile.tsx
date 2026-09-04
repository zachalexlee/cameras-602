"use client";

import { useState, type FormEvent } from "react";
import { Panel } from "@/components/panel";
import { useLocalStorageState } from "@/lib/use-local-storage";

type Todo = { id: string; text: string; done: boolean; createdAt: number };
type NotesState = { todos: Todo[]; scratch: string };

const KEY = "homeops:notes:v1";
const EMPTY: NotesState = { todos: [], scratch: "" };

export function NotesTile() {
  const [state, setState] = useLocalStorageState<NotesState>(KEY, EMPTY);
  const [draft, setDraft] = useState("");

  const add = (e: FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setState((s) => ({ ...s, todos: [...s.todos, { id: crypto.randomUUID(), text, done: false, createdAt: Date.now() }] }));
    setDraft("");
  };
  const toggle = (id: string) => setState((s) => ({ ...s, todos: s.todos.map((t) => (t.id === id ? { ...t, done: !t.done } : t)) }));
  const remove = (id: string) => setState((s) => ({ ...s, todos: s.todos.filter((t) => t.id !== id) }));
  const clearDone = () => setState((s) => ({ ...s, todos: s.todos.filter((t) => !t.done) }));

  const openCount = state?.todos.filter((t) => !t.done).length ?? 0;
  const doneCount = (state?.todos.length ?? 0) - openCount;

  return (
    <Panel
      title="Notes"
      meta={state ? <span>{openCount} open{doneCount ? ` · ${doneCount} done` : ""}</span> : "Loading"}
      bodyClassName="gap-3 px-4 py-3"
    >
      <form onSubmit={add} className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a to-do"
          aria-label="New to-do"
          disabled={!state}
          className="min-w-0 flex-1 border border-line bg-background px-2.5 py-1.5 text-sm outline-none transition focus:border-accent"
        />
        <button type="submit" disabled={!state || !draft.trim()} className="label border border-line px-3 text-muted transition hover:border-line-strong hover:text-foreground disabled:opacity-40">
          Add
        </button>
      </form>

      <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto">
        {state?.todos.length === 0 ? <li className="label py-1 text-[10px] text-muted">Nothing on the list</li> : null}
        {state?.todos.map((t) => (
          <li key={t.id} className="group flex items-center gap-2">
            <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" checked={t.done} onChange={() => toggle(t.id)} className="h-4 w-4 accent-[var(--accent)]" />
              <span className={`truncate ${t.done ? "text-muted line-through" : ""}`}>{t.text}</span>
            </label>
            <button type="button" onClick={() => remove(t.id)} aria-label={`Delete ${t.text}`} className="label text-[10px] text-muted opacity-0 transition hover:text-danger group-hover:opacity-100 focus:opacity-100">
              Del
            </button>
          </li>
        ))}
      </ul>
      {doneCount > 0 ? (
        <button type="button" onClick={clearDone} className="label w-fit text-[10px] text-muted hover:text-foreground">
          Clear done
        </button>
      ) : null}

      <textarea
        value={state?.scratch ?? ""}
        onChange={(e) => {
          const scratch = e.target.value;
          setState((s) => ({ ...s, scratch }));
        }}
        placeholder="Scratchpad"
        aria-label="Scratchpad"
        disabled={!state}
        rows={4}
        className="w-full resize-y border border-line bg-background px-2.5 py-2 font-mono text-sm leading-relaxed outline-none transition focus:border-accent"
      />
      <p className="label text-[10px] text-muted">Saved on this device only</p>
    </Panel>
  );
}
