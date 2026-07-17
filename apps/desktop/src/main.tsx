import { createRoot } from "react-dom/client";
import { Studio } from "@screenxshot/editor";
import "@screenxshot/editor/styles.css";
import "./desktop.css";
import { initDesktopBridge } from "./desktopBridge";

// Desktop shell: editor-only. Studio already renders the `.studio-area` /
// `.window` mac-frame chrome, so the editor is visually identical to the web
// app's Studio section — only the marketing page chrome (Header/Hero/Caps/
// Footer) is absent, by design.
function App() {
  return <Studio />;
}

createRoot(document.getElementById("root") as HTMLElement).render(<App />);

// Wire native capture delivery (hotkey/overlay -> editor).
void initDesktopBridge();
