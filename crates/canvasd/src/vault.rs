//! Native Obsidian integration surface: a vault is just a folder of
//! markdown files. Discovery reads Obsidian's own `obsidian.json` registry
//! (macOS/Windows/Linux) and `.obsidian/` markers; registration writes the
//! marker and adds the folder to that registry so the real Obsidian app
//! lists the same vault.

use crate::protocol::VaultLocation;
use std::path::PathBuf;

fn obsidian_config_candidates() -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Ok(home) = std::env::var("HOME") {
        let h = PathBuf::from(&home);
        out.push(h.join("Library/Application Support/obsidian/obsidian.json")); // macOS
        out.push(h.join(".config/obsidian/obsidian.json")); // Linux
    }
    if let Ok(appdata) = std::env::var("APPDATA") {
        out.push(PathBuf::from(appdata).join("obsidian/obsidian.json")); // Windows
    }
    if let Ok(xdg) = std::env::var("XDG_CONFIG_HOME") {
        out.push(PathBuf::from(xdg).join("obsidian/obsidian.json"));
    }
    out
}

fn push_vault(out: &mut Vec<VaultLocation>, path: PathBuf) {
    if !path.is_dir() {
        return;
    }
    let canon = std::fs::canonicalize(&path).unwrap_or(path);
    let key = canon.to_string_lossy().to_string();
    if out.iter().any(|v| v.path == key) {
        return;
    }
    let name = canon
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| key.clone());
    out.push(VaultLocation { name, path: key });
}

/// Vaults Obsidian already knows (`obsidian.json`), plus any folder with a
/// `.obsidian/` marker in the usual places (covers vaults Obsidian has not
/// registered yet on this machine).
pub fn discover() -> Vec<VaultLocation> {
    let mut out: Vec<VaultLocation> = Vec::new();
    for cfg in obsidian_config_candidates() {
        if let Ok(text) = std::fs::read_to_string(&cfg) {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) {
                if let Some(vaults) = json.get("vaults").and_then(|v| v.as_object()) {
                    for v in vaults.values() {
                        if let Some(p) = v.get("path").and_then(|p| p.as_str()) {
                            push_vault(&mut out, PathBuf::from(p));
                        }
                    }
                }
            }
        }
    }
    if let Ok(home) = std::env::var("HOME") {
        let h = PathBuf::from(&home);
        for base in [h.join("Documents"), h.join("Desktop"), h.clone()] {
            if let Ok(rd) = std::fs::read_dir(&base) {
                for e in rd.flatten().take(200) {
                    let p = e.path();
                    if p.join(".obsidian").is_dir() {
                        push_vault(&mut out, p);
                    }
                }
            }
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

/// Make `dir` a first-class Obsidian vault on this machine: creates the
/// `.obsidian/` marker folder and writes the vault into obsidian.json so
/// Obsidian's vault switcher offers it. Returns the refreshed vault list.
pub fn register(dir: &str) -> Result<Vec<VaultLocation>, String> {
    let root = PathBuf::from(dir);
    if !root.is_dir() {
        return Err(format!("not a directory: {dir}"));
    }
    std::fs::create_dir_all(root.join(".obsidian")).map_err(|e| e.to_string())?;

    let cfg = obsidian_config_candidates()
        .into_iter()
        .find(|p| p.is_file())
        .or_else(|| {
            std::env::var("HOME").ok().map(|h| {
                PathBuf::from(h).join("Library/Application Support/obsidian/obsidian.json")
            })
        })
        .ok_or_else(|| "cannot locate obsidian.json (HOME/APPDATA unset)".to_string())?;

    let mut json = std::fs::read_to_string(&cfg)
        .ok()
        .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
        .unwrap_or_else(|| serde_json::json!({ "vaults": {} }));
    if !json.is_object() {
        json = serde_json::json!({ "vaults": {} });
    }
    if json.get("vaults").and_then(|v| v.as_object()).is_none() {
        json["vaults"] = serde_json::json!({});
    }
    let canon = std::fs::canonicalize(&root).unwrap_or(root);
    let path = canon.to_string_lossy().to_string();
    let vaults = json["vaults"].as_object_mut().unwrap();
    let known = vaults
        .values()
        .any(|v| v.get("path").and_then(|p| p.as_str()) == Some(path.as_str()));
    if !known {
        let id = uuid::Uuid::new_v4().simple().to_string()[..16].to_string();
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        vaults.insert(id, serde_json::json!({ "path": path, "ts": ts, "open": false }));
        if let Some(parent) = cfg.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::write(&cfg, serde_json::to_string_pretty(&json).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    }
    Ok(discover())
}
