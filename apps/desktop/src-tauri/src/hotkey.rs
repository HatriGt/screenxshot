// Global capture shortcut. macOS uses Cmd+Shift+2; other platforms use
// Ctrl+Shift+2. Kept as a pure function so the per-platform choice is testable.

pub fn default_shortcut() -> &'static str {
    #[cfg(target_os = "macos")]
    {
        "Cmd+Shift+2"
    }
    #[cfg(not(target_os = "macos"))]
    {
        "Ctrl+Shift+2"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_shortcut_is_platform_appropriate() {
        let s = default_shortcut();
        assert!(s.contains("Shift+2"));
        #[cfg(target_os = "macos")]
        assert!(s.starts_with("Cmd"));
        #[cfg(not(target_os = "macos"))]
        assert!(s.starts_with("Ctrl"));
    }
}
