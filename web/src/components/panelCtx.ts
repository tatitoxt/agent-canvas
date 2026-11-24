import { createContext, useContext } from "react";

/** App-level actions panels need when mounted inside a canvas node —
 * injected by the Board so nodes stay decoupled from App internals. */
export interface PanelActions {
  openTerm: (t: { id: string; name: string }) => void;
  openEdgeDetail: (edgeId: string) => void;
}

export const PanelActionsCtx = createContext<PanelActions>({
  openTerm: () => {},
  openEdgeDetail: () => {},
});

export const usePanelActions = () => useContext(PanelActionsCtx);
