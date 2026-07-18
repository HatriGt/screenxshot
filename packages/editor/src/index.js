// Barrel for the shared ScreenXShot editor package.
export { editor } from "./editor/instance.js";
export { editorStore, set } from "./editor/store.js";
export {
  encodeHandoff,
  decodeHandoff,
  readHandoffFromHash,
  HANDOFF_VERSION,
  HANDOFF_PARAM,
} from "./editor/handoff.js";
export { COLORS, WALLS, GRADS, SOLIDS, SIZE, TSIZE } from "./editor/data.js";
export { getEntitlements, isPro } from "./entitlements.js";
export { default as Studio } from "./components/Studio.jsx";
export { default as Dock } from "./components/Dock.jsx";
export { default as Panel } from "./components/Panel.jsx";
export { useReveal } from "./hooks/useReveal.js";
export { useParallax } from "./hooks/useParallax.js";
