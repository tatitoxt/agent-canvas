//! Best-effort CLI account/model detection, shared between canvasd
//! and the Tauri embedded host.

/// Best-effort detection of which account/model a CLI runs with, from
/// the CLI's own config files. Honest by design: anything not found in
/// a real file stays None and the UI says "unknown".
pub fn detect_cli_identities(known_clis: &[&str]) -> std::collections::HashMap<String, crate::protocol::CliIdentity> {
    use std::collections::HashMap;
    // The CLIs keep the same dotfile layout in the home/profile directory
    // on every platform — what changes is how the home directory itself is
    // resolved (HOME is typically absent on Windows).
    let Some(home) = crate::paths::home_dir() else {
        return HashMap::new();
    };
    let mut out = HashMap::new();

    fn read_json(path: &std::path::Path) -> Option<serde_json::Value> {
        serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()
    }
    /// Depth-first scan for the first string value of a key whose name
    /// matches `pred` — config layouts differ per CLI version, so look
    /// anywhere in the tree rather than hardcode paths inside the file.
    fn scan_keys(v: &serde_json::Value, pred: &dyn Fn(&str) -> bool, depth: u8) -> Option<String> {
        if depth > 6 { return None; }
        match v {
            serde_json::Value::Object(map) => {
                for (k, val) in map {
                    if pred(k) {
                        if let serde_json::Value::String(s) = val {
                            if !s.is_empty() { return Some(s.clone()); }
                        }
                    }
                }
                for val in map.values() {
                    if let Some(found) = scan_keys(val, pred, depth + 1) { return Some(found); }
                }
                None
            }
            serde_json::Value::Array(items) => {
                for val in items {
                    if let Some(found) = scan_keys(val, pred, depth + 1) { return Some(found); }
                }
                None
            }
            _ => None,
        }
    }
    fn emailish(s: &str) -> bool { s.contains('@') && s.len() < 320 }
    /// codex (and others) store an OIDC id_token — the email lives in
    /// the JWT payload; no verification needed for display purposes.
    fn jwt_email(token: &str) -> Option<String> {
        use base64::Engine;
        let payload = token.split('.').nth(1)?;
        let pad = match payload.len() % 4 { 2 => "==", 3 => "=", _ => "" };
        let bytes = base64::engine::general_purpose::URL_SAFE
            .decode(format!("{payload}{pad}"))
            .ok()?;
        let v: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
        scan_keys(&v, &|k| k == "email", 0).filter(|e| emailish(e))
    }

    for &cli in known_clis.iter() {
        let mut id = crate::protocol::CliIdentity { account: None, model: None, source: None };
        match cli {
            "claude" => {
                let cfg = home.join(".claude.json");
                if let Some(v) = read_json(&cfg) {
                    id.account = scan_keys(&v, &|k| k.eq_ignore_ascii_case("email") || k.to_ascii_lowercase().ends_with("emailaddress"), 0).filter(|e| emailish(e));
                    id.model = scan_keys(&v, &|k| k == "model", 0);
                    if id.account.is_some() || id.model.is_some() { id.source = Some("~/.claude.json".into()); }
                }
                let st = home.join(".claude").join("settings.json");
                if id.model.is_none() {
                    if let Some(v) = read_json(&st) {
                        id.model = scan_keys(&v, &|k| k == "model", 0);
                        if id.model.is_some() && id.source.is_none() { id.source = Some("~/.claude/settings.json".into()); }
                    }
                }
            }
            "codex" => {
                let auth = home.join(".codex").join("auth.json");
                if let Some(v) = read_json(&auth) {
                    if let Some(tok) = scan_keys(&v, &|k| k == "id_token", 0) {
                        id.account = jwt_email(&tok);
                    }
                    if id.account.is_none() {
                        id.account = scan_keys(&v, &|k| k == "email", 0).filter(|e| emailish(e));
                    }
                    if id.account.is_some() { id.source = Some("~/.codex/auth.json".into()); }
                }
                // config.toml — no toml dep; a top-level `model = "x"` line scan is enough.
                let toml = home.join(".codex").join("config.toml");
                if let Ok(text) = std::fs::read_to_string(&toml) {
                    for line in text.lines() {
                        let line = line.trim();
                        if let Some(rest) = line.strip_prefix("model") {
                            if let Some((_, val)) = rest.split_once('=') {
                                let val = val.trim().trim_matches('"').trim_matches('\'');
                                if !val.is_empty() {
                                    id.model = Some(val.to_string());
                                    if id.source.is_none() { id.source = Some("~/.codex/config.toml".into()); }
                                    break;
                                }
                            }
                        }
                    }
                }
            }
            "gemini" => {
                let accts = home.join(".gemini").join("google_accounts.json");
                if let Some(v) = read_json(&accts) {
                    id.account = scan_keys(&v, &|k| k == "active" || k == "email", 0).filter(|e| emailish(e));
                    if id.account.is_some() { id.source = Some("~/.gemini/google_accounts.json".into()); }
                }
                let st = home.join(".gemini").join("settings.json");
                if let Some(v) = read_json(&st) {
                    id.model = scan_keys(&v, &|k| k == "model", 0);
                    if id.model.is_some() && id.source.is_none() { id.source = Some("~/.gemini/settings.json".into()); }
                }
            }
            _ => {}
        }
        if id.account.is_some() || id.model.is_some() {
            out.insert(cli.to_string(), id);
        }
    }
    out
}
