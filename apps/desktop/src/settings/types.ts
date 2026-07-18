/** What happens immediately after a region capture. */
export type AfterCapture = "open-editor" | "copy-raw" | "copy-styled";

/** Corner the capture toast appears in (kebab-case mirrors Rust serde). */
export type ToastPosition =
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

/** File format for saving captures to disk (clipboard always stays PNG). */
export type ExportFormat = "png" | "jpeg";

/** Mirror of the Rust `Settings` struct (serde-compatible field names). */
export interface Settings {
  hotkey: string;
  launch_on_startup: boolean;
  save_dir: string;
  tray_closes_to_tray: boolean;
  after_capture: AfterCapture;
  /** Opaque snapshot of the editor's default style; null when unset. */
  default_style: unknown;
  /** Corner the capture toast appears in. */
  toast_position: ToastPosition;
  /** Toast auto-dismiss timeout in ms; 0 = never (stays until dismissed). */
  toast_dismiss_ms: number;
  /** Countdown before a capture is grabbed, in seconds; 0 = off. */
  self_timer_secs: number;
  /** Format used for FILE saves. */
  export_format: ExportFormat;
}
