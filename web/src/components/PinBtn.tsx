import { Icon } from "./icons";
import { useBoard } from "../store/board";

/** Deska's "Open in canvas" — pins this panel's content as a card on the board. */
export function PinBtn({ title, body }: { title: string; body: string }) {
  const pinCard = useBoard((s) => s.pinCard);
  return (
    <button
      title="Add to Board — pin this panel as a card on the canvas"
      onClick={() => pinCard(title, body)}
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
