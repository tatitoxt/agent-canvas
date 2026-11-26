import { useEffect } from "react";
import { panelRoot } from "./panelChrome";
import { useBoard } from "../store/board";

/** One-click skills — a small community-style catalog. Installing appends
 * the skill block to the board's shared memory, so every agent spawned in
 * it can read the instructions through $CANVAS_MEMORY. */
const CATALOG: { name: string; glyph: string; blurb: string; body: string }[] = [
  {
    name: "pr-reviewer",
    glyph: "±",
    blurb: "Review diffs like a senior: correctness, regressions, style",
    body: "## Skill: pr-reviewer\nWhen asked to review, read `git diff` and report: bugs first, then regressions, then style. Cite file:line.",
  },
  {
    name: "test-writer",
    glyph: "✓",
    blurb: "Write focused unit tests for the files you touched",
    body: "## Skill: test-writer\nAfter changing a file, write focused tests for the new behavior only. Match the repo's existing test style.",
  },
  {
    name: "security-audit",
    glyph: "◈",
    blurb: "Hunt injection, secrets, unsafe paths in changed code",
    body: "## Skill: security-audit\nFlag injection surfaces, hardcoded secrets, path traversal, unvalidated input in any diff you produce.",
  },
  {
    name: "docs",
    glyph: "✎",
    blurb: "Keep README/docs in sync with the code you change",
    body: "## Skill: docs\nWhen a change alters public behavior, update the matching README/docs section in the same commit.",
  },
  {
    name: "commit-style",
    glyph: "▣",
    blurb: "Conventional, descriptive commit messages",
    body: "## Skill: commit-style\nCommit messages: imperative subject ≤72 chars, then a body explaining *why*, not what.",
  },
  {
    name: "perf",
    glyph: "◐",
    blurb: "Prefer measured optimizations over guesses",
    body: "## Skill: perf\nBefore optimizing, state the measured hot path. Prefer algorithmic wins over micro-tweaks.",
  },
];

export function SkillsPanel() {
  const activeBoard = useBoard((s) => s.activeBoard);
  const memories = useBoard((s) => s.memories);
  const memoryRead = useBoard((s) => s.memoryRead);
  const memoryWrite = useBoard((s) => s.memoryWrite);
  const notify = useBoard((s) => s.notify);
  const nodeId = activeBoard ?? "main";
  const key = `cv-skills-${nodeId}`;
  const installed: string[] = (() => {
    try { return JSON.parse(localStorage.getItem(key) ?? "[]"); } catch { return []; }
  })();

  useEffect(() => { memoryRead(nodeId); }, [nodeId, memoryRead]);

  const install = (skill: (typeof CATALOG)[number]) => {
    const cur = memories[nodeId] ?? "";
    if (cur.includes(`## Skill: ${skill.name}`)) {
      notify(`skill "${skill.name}" already in ${nodeId} memory`);
      return;
    }
    const next = cur ? `${cur.trimEnd()}\n\n${skill.body}\n` : `${skill.body}\n`;
    memoryWrite(nodeId, next);
    localStorage.setItem(key, JSON.stringify([...installed, skill.name]));
    notify(`skill "${skill.name}" installed → ${nodeId} memory`);
  };

  return (
    <div
      style={{ ...panelRoot, padding: "12px 10px" }}
    >
      <div style={{ fontSize: "var(--cv-text-xxs)", color: "var(--cv-ink-dim)", padding: "0 12px 10px" }}>
        one click → every agent in this board reads it via memory
      </div>
      <div style={{ flex: 1, overflowY: "auto" }}>
        {CATALOG.map((sk) => {
          const isIn = installed.includes(sk.name) || (memories[nodeId] ?? "").includes(`## Skill: ${sk.name}`);
          return (
            <div
              key={sk.name}
              className="glass"
              style={{ margin: "0 0 6px", padding: "9px 12px", display: "flex", gap: 10, alignItems: "flex-start" }}
            >
              <span style={{ fontSize: "var(--cv-text-md)", color: "var(--cv-accent)", flexShrink: 0, marginTop: 1 }}>{sk.glyph}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: "var(--cv-text-xs)", fontWeight: 600, color: "var(--cv-ink)" }}>{sk.name}</div>
                <div style={{ fontSize: "var(--cv-text-xxs)", color: "var(--cv-ink-dim)", lineHeight: 1.35 }}>{sk.blurb}</div>
              </div>
              <button
                className="cv-mini-btn"
                disabled={isIn}
                onClick={() => install(sk)}
                style={{
                  cursor: isIn ? "default" : "pointer",
                  fontSize: "var(--cv-text-xxs)",
                  fontWeight: 600,
                  padding: "4px 10px",
                  color: isIn ? "var(--cv-done)" : "var(--cv-accent)",
                  flexShrink: 0,
                }}
              >
                {isIn ? "installed" : "install"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
