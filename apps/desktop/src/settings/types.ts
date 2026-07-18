/** What happens immediately after a region capture. */
export type AfterCapture = "open-editor" | "copy-raw" | "copy-styled";

/** Mirror of the Rust `Settings` struct (serde-compatible field names). */
export interface Settings {
  hotkey: string;
  launch_on_startup: boolean;
  save_dir: string;
  tray_closes_to_tray: boolean;
  after_capture: AfterCapture;
  /** Opaque snapshot of the editor's default style; null when unset. */
  default_style: unknown;
}
