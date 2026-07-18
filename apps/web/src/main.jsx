import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { router } from "./router.jsx";
import { initHandoff } from "./handoff.js";
import "@screenxshot/editor/styles.css";

// StrictMode intentionally omitted: the canvas editor mounts imperatively and
// double-invocation of effects in dev would re-run the demo-load/bind cycle.
createRoot(document.getElementById("root")).render(<RouterProvider router={router} />);

// Desktop -> web "Continue on web" hand-off: rehydrate editor style + ops from
// the URL fragment (no image bytes travel). No-op for normal visitors.
initHandoff();
