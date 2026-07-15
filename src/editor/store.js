import { Store } from "@tanstack/store";

// Editor settings + derived UI flags live in a TanStack Store so React components
// can subscribe reactively. The canvas engine reads settings from here and updates
// the derived flags (hasImage/canUndo/canRedo/copyLabel) as runtime state changes.
export const editorStore = new Store({
  // settings (mirror of the original `state` object)
  tool: "cursor",
  color: "#ef4444",
  size: "m",
  frame: "light",
  padding: 0.24,
  srad: 0.015,
  shadow: 0.075,
  bg: { kind: "wall", id: "bloom" },
  // panel view state
  tab: "bg",
  cat: "wall",
  // derived runtime flags
  hasImage: false,
  canUndo: false,
  canRedo: false,
  copyLabel: "Copy",
});

export const set = (patch) =>
  editorStore.setState((s) => ({ ...s, ...patch }));
