use thiserror::Error;

/// Application error type shared across Tauri commands. Implements `Serialize`
/// so it can cross the IPC boundary as a string the frontend can catch.
// Variants are consumed once capture commands land (U3); allow until then.
#[allow(dead_code)]
#[derive(Debug, Error)]
pub enum AppError {
    #[error("capture failed: {0}")]
    Capture(String),

    #[error("image encode failed: {0}")]
    Encode(String),
}

impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::ser::Serializer,
    {
        serializer.serialize_str(self.to_string().as_ref())
    }
}
