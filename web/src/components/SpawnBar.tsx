import { useState } from "react";
import { useBoard } from "../store/board";

export function SpawnBar() {
  const connected = useBoard((s) => s.connected);
  const connect = useBoard((s) => s.connect);
  const spawn = useBoard((s) => s.spawn);
  const [command, setCommand] = useState("bash");
  const [name, setName] = useState("");

  return (
    <div className="absolute left-1/2 top-14 z-10 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-[var(--cv-border)] bg-[var(--cv-surface)]/95 px-3 py-2 backdrop-blur">
      {!connected ? (
        <>
          <span className="text-xs text-[var(--cv-ink-dim)]">daemon offline</span>
          <button
            className="rounded-md bg-[var(--cv-accent)]/15 px-3 py-1 text-xs font-semibold text-[var(--cv-accent)]"
            onClick={() => connect("")}
          >
            connect
          </button>
        </>
      ) : (
        <>
          <input
            className="w-28 rounded-md border border-[var(--cv-border)] bg-transparent px-2 py-1 text-xs outline-none"
            placeholder="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            className="w-44 rounded-md border border-[var(--cv-border)] bg-transparent px-2 py-1 text-xs outline-none"
            placeholder="command (bash, claude…)"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
          />
          <button
            className="rounded-md bg-[var(--cv-accent)]/15 px-3 py-1 text-xs font-semibold text-[var(--cv-accent)] disabled:opacity-40"
            disabled={!command.trim()}
            onClick={() => {
              spawn(name.trim() || command.trim(), command.trim());
              setName("");
            }}
          >
            + agent
          </button>
        </>
      )}
    </div>
  );
}
