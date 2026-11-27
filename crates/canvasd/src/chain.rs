//! CLI fallback chains: which agent CLIs this machine has and in what
//! order to try them when one dies at launch.
//!
//! Shared by the canvasd daemon and the Tauri shell — both spawn agents
//! through the same `AgentManager`, and a workspace chain configured in
//! one frontend must mean the same thing in the other.

/// CLIs the board knows how to fall back between, in preference order.
pub const KNOWN_CLIS: &[&str] = &[
    "claude",
    "codex",
    "gemini",
    "aider",
    "goose",
    "amp",
    "opencode",
    "cursor-agent",
];

/// First token of a spawn command — the CLI being launched.
pub fn command_cli(command: &str) -> &str {
    command.split_whitespace().next().unwrap_or("")
}

/// Swap the leading CLI token of a command, keeping every argument.
pub fn substitute_cli(command: &str, cli: &str) -> String {
    let rest = command
        .trim_start_matches(command_cli(command))
        .trim_start();
    if rest.is_empty() {
        cli.to_string()
    } else {
        format!("{cli} {rest}")
    }
}

/// Global default chain: known CLIs actually installed, in preference order.
/// The PATH scan itself is portable (platform separators + Windows
/// PATHEXT) and lives in `paths` so the logic is unit-testable.
pub fn detected_chain() -> Vec<String> {
    KNOWN_CLIS
        .iter()
        .filter(|c| crate::paths::binary_on_path(c))
        .map(|c| c.to_string())
        .collect()
}

/// Fallback chain for a spawn. `configured` is the workspace's saved chain
/// straight from the store — empty means "back to auto", so both None and
/// Some([]) resolve to the machine-wide auto-detected chain. The CLI being
/// spawned leads the chain even when the configuration omits it.
///
/// Not an agent CLI (bash, sh, editors…) — nothing to fall back to, the
/// chain is just the command itself.
pub fn chain_for_spawn(configured: Option<Vec<String>>, cli: &str) -> Vec<String> {
    if !KNOWN_CLIS.contains(&cli) {
        return if cli.is_empty() {
            Vec::new()
        } else {
            vec![cli.to_string()]
        };
    }
    let configured = configured
        .filter(|c| !c.is_empty())
        .unwrap_or_else(detected_chain);
    let mut chain: Vec<String> = Vec::new();
    if !cli.is_empty() {
        chain.push(cli.to_string());
    }
    for c in configured {
        if c != cli && !chain.contains(&c) {
            chain.push(c);
        }
    }
    chain
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn substitute_cli_keeps_arguments() {
        assert_eq!(
            substitute_cli("claude --model opus", "codex"),
            "codex --model opus"
        );
        assert_eq!(substitute_cli("claude", "gemini"), "gemini");
    }

    #[test]
    fn command_cli_reads_first_token() {
        assert_eq!(command_cli("codex -a x"), "codex");
        assert_eq!(command_cli(""), "");
    }

    #[test]
    fn chain_leads_with_requested_cli_without_duplicates() {
        let configured = vec![
            "claude".to_string(),
            "codex".to_string(),
            "gemini".to_string(),
        ];
        assert_eq!(
            chain_for_spawn(Some(configured), "codex"),
            vec!["codex", "claude", "gemini"]
        );
    }

    #[test]
    fn empty_configured_chain_falls_back_to_auto_detection() {
        // Whatever the host has installed, the requested CLI still leads
        // and no entry repeats.
        for configured in [None, Some(vec![])] {
            let chain = chain_for_spawn(configured, "claude");
            assert_eq!(chain.first().map(String::as_str), Some("claude"));
            let unique: std::collections::HashSet<&String> = chain.iter().collect();
            assert_eq!(unique.len(), chain.len());
        }
    }

    #[test]
    fn non_agent_clis_have_no_fallback() {
        assert_eq!(chain_for_spawn(None, "bash"), vec!["bash"]);
        assert!(chain_for_spawn(None, "").is_empty());
    }
}
