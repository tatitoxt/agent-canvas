import { Icon } from "./icons";
import { useBoard } from "../store/board";
import { useReactFlow } from "@xyflow/react";
import { edgePoint, obstacleRects, rectsOverlap, segmentHitsRect, type Pt, type Rect } from "./anchorGeom";

const CARD_W = 250;
const CARD_H = 150;

/** Pick a drop spot (screen px) whose anchor cable crosses nothing. */
export function cleanPinSpot(anchor: string | undefined): Pt {
  const iw = window.innerWidth;
  const ih = window.innerHeight;
  const panel = anchor ? document.querySelector(`[data-panel="${anchor}"]`) : null;
  const cands: Pt[] = [];
  if (panel) {
    const pr = panel.getBoundingClientRect();
    // prefer just right of the panel, at three heights; then free canvas
    cands.push(
      { x: pr.right + 48, y: pr.top + 12 },
      { x: pr.right + 48, y: pr.top + pr.height / 2 },
      { x: pr.right + 48, y: pr.bottom - CARD_H - 12 },
      { x: pr.left + pr.width / 2, y: pr.bottom + 40 },
    );
  }
  cands.push(
    { x: iw * 0.8, y: ih * 0.3 },
    { x: iw * 0.8, y: ih * 0.62 },
    { x: iw * 0.62, y: ih * 0.35 },
    { x: iw * 0.62, y: ih * 0.68 },
    { x: iw * 0.45, y: ih * 0.7 },
    { x: iw * 0.62, y: ih * 0.8 },
  );
  if (!panel) return cands[4];
  const pr = panel.getBoundingClientRect();
  const panelRect: Rect = { x: pr.left, y: pr.top, w: pr.width, h: pr.height };
  const panelC = { x: panelRect.x + panelRect.w / 2, y: panelRect.y + panelRect.h / 2 };
  const obstacles = obstacleRects([`[data-panel="${anchor}"]`]);
  for (const c of cands) {
    const card: Rect = { x: c.x, y: c.y, w: CARD_W, h: CARD_H };
    // card itself must sit on free canvas — never under/ontop another node
    if (obstacles.some((o) => rectsOverlap(card, o, 6))) continue;
    const a = edgePoint(card, panelC);
    const b = edgePoint(panelRect, { x: card.x + card.w / 2, y: card.y + card.h / 2 });
    if (!obstacles.some((o) => segmentHitsRect(a, b, o))) return c;
  }
  // nothing fully clean: take the first spot where at least the CARD is free
  for (const c of cands) {
    const card: Rect = { x: c.x, y: c.y, w: CARD_W, h: CARD_H };
    if (!obstacles.some((o) => rectsOverlap(card, o, 6))) return c;
  }
  return cands[0];
}

/** Pick a free drop spot (screen px) beside an agent/workplace node so the
 * agent→note connector crosses nothing. Tries right, below, left, above. */
export function agentPinSpot(nodeId: string): Pt | null {
  const el = document.querySelector(`[data-id="${nodeId}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const agent: Rect = { x: r.left, y: r.top, w: r.width, h: r.height };
  const agentC = { x: agent.x + agent.w / 2, y: agent.y + agent.h / 2 };
  const obstacles = obstacleRects([`[data-id="${nodeId}"]`]);
  const cands: Pt[] = [
    { x: agent.x + agent.w + 24, y: agent.y },                       // right
    { x: agent.x, y: agent.y + agent.h + 24 },                     // below
    { x: agent.x - CARD_W - 24, y: agent.y },                      // left
    { x: agent.x, y: agent.y - CARD_H - 24 },                      // above
    { x: agent.x + agent.w + 24, y: agent.y + agent.h + 24 },      // bottom-right
  ];
  for (const c of cands) {
    const card: Rect = { x: c.x, y: c.y, w: CARD_W, h: CARD_H };
    if (obstacles.some((o) => rectsOverlap(card, o, 6))) continue;
    const a = edgePoint(card, agentC);
    const b = edgePoint(agent, { x: card.x + card.w / 2, y: card.y + card.h / 2 });
    if (!obstacles.some((o) => segmentHitsRect(a, b, o))) return c;
  }
  for (const c of cands) {
    const card: Rect = { x: c.x, y: c.y, w: CARD_W, h: CARD_H };
    if (!obstacles.some((o) => rectsOverlap(card, o, 6))) return c;
  }
  return null;
}

/** Deska's "Open in canvas" — pins this panel's content as a card on the board. */
export function PinBtn({ title, body, anchor }: { title: string; body: string; anchor?: string }) {
  const pinCard = useBoard((s) => s.pinCard);
  const { screenToFlowPosition } = useReactFlow();
  return (
    <button
      title="Add to Board — pin this panel as a card on the canvas"
      onClick={() => pinCard(title, body, undefined, anchor, screenToFlowPosition(cleanPinSpot(anchor)))}
      style={{
        border: "1px solid color-mix(in srgb, var(--cv-accent) 45%, transparent)",
        borderRadius: 999,
        background: "color-mix(in srgb, var(--cv-accent) 10%, transparent)",
        cursor: "pointer",
        color: "var(--cv-accent)",
        display: "flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 8px",
        fontSize: 10,
        fontWeight: 600,
        flexShrink: 0,
      }}
    >
      <Icon name="pin" size={10} />
      board
    </button>
  );
}
