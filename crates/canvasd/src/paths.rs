//! Portable filesystem locations and path shapes.
//!
//! canvasd grew up on Unix: home meant `$HOME`, config meant
//! `$HOME/.config`, PATH split on `:`, and every path carried `/`
//! separators. Those assumptions are compile-time invisible but break at
//! runtime on Windows, where home is the profile folder, config roams in
//! `%APPDATA%`, PATH splits on `;`, and the filesystem reports `\`
//! separators. This module is the single place that knows the difference.
//!
//! Parity rule: on macOS/Linux every resolved path is byte-identical to
//! the pre-port behavior — existing installs keep their grants, vaults
//! and config exactly where they already are.

use std::path::{Path, PathBuf};

/// Compile-time platform selector. The public helpers bind it here, so
/// unit tests can exercise both arms without a Windows box.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Platform {
    Unix,
    Windows,
}

pub const fn current_platform() -> Platform {
    if cfg!(windows) {
        Platform::Windows
    } else {
        Platform::Unix
    }
}

/// The operator's home directory: `$HOME` on Unix (falling back to the
/// passwd entry when the variable is absent), the user profile folder on
/// Windows — where `HOME` is typically not set at all and the CLI
/// dotfiles (`.claude.json`, `.codex/`, `.gemini/`) still live directly
/// in the profile root.
pub fn home_dir() -> Option<PathBuf> {
    dirs::home_dir()
}

/// `~` / `~/rest` expansion against an explicit home — the pure logic,
/// testable for both platforms. `~\rest` also expands on Windows, where
/// operators type the backslash form as often as the slash one. Anything
/// else (including the unsupported `~user` form) passes through
/// unchanged, as does everything when no home directory is resolvable.
pub fn expand_tilde_for(platform: Platform, input: &str, home: Option<&Path>) -> PathBuf {
    let is_sep = |c: char| c == '/' || (platform == Platform::Windows && c == '\\');
    let tail: Option<&str> = if input == "~" {
        Some("")
    } else if input.starts_with("~/") || (platform == Platform::Windows && input.starts_with("~\\"))
    {
        // Swallow the whole separator run, not just the first slash:
        // `~//vault` must stay inside home — `Path::join` with a tail
        // that is still absolute (`/vault`) would REPLACE the base
        // entirely and resolve outside the operator's home.
        Some(input[1..].trim_start_matches(is_sep))
    } else {
        None
    };
    match (tail, home) {
        (Some(rest), Some(h)) if !rest.is_empty() => h.join(rest),
        (Some(_), Some(h)) => h.to_path_buf(),
        _ => PathBuf::from(input),
    }
}

/// Expand a leading `~` using the operator's home directory. Canvas
/// accepts tilde paths for workspace repos and inside the allowed-roots
/// file — the places an operator types paths by hand.
pub fn expand_tilde(input: &str) -> PathBuf {
    expand_tilde_for(current_platform(), input, home_dir().as_deref())
}

/// Canvas's own user-level config directory — the home of the persisted
/// `allowed-roots` grant list.
///
/// Unix keeps the historical `$HOME/.config/canvas` layout byte-identical
/// (deliberately *not* XDG_CONFIG_HOME and *not* macOS's
/// `~/Library/Application Support`: existing installs already carry their
/// grants there, and moving them would silently revoke sandbox access).
///
/// Windows follows the platform convention instead: the roaming config
/// folder, i.e. `%APPDATA%\canvas` — a small user-scoped config file
/// belongs in roaming, not in `%LOCALAPPDATA%` machine-local data.
pub fn canvas_config_dir_for(
    platform: Platform,
    home: Option<&Path>,
    roaming_config: Option<&Path>,
) -> Option<PathBuf> {
    match platform {
        Platform::Unix => home.map(|h| h.join(".config").join("canvas")),
        Platform::Windows => roaming_config.map(|c| c.join("canvas")),
    }
}

/// The live config dir for this process — see [`canvas_config_dir_for`].
pub fn canvas_config_dir() -> Option<PathBuf> {
    canvas_config_dir_for(
        current_platform(),
        home_dir().as_deref(),
        dirs::config_dir().as_deref(),
    )
}

/// Base folders scanned for user content living directly under the
/// profile (`.obsidian` vault markers today): Documents, Desktop and the
/// home root itself.
///
/// Unix keeps the historical triple exactly. Windows adds the
/// known-folder locations, because Documents/Desktop are frequently
/// redirected away from the profile defaults — OneDrive's folder backup
/// does this silently — and a vault copied into the redirected Documents
/// would otherwise never surface.
pub fn home_scan_bases_for(
    platform: Platform,
    home: Option<&Path>,
    document_dir: Option<&Path>,
    desktop_dir: Option<&Path>,
) -> Vec<PathBuf> {
    let mut bases: Vec<PathBuf> = home
        .map(|h| vec![h.join("Documents"), h.join("Desktop"), h.to_path_buf()])
        .unwrap_or_default();
    if platform == Platform::Windows {
        for extra in [document_dir, desktop_dir].into_iter().flatten() {
            let extra = extra.to_path_buf();
            if !bases.contains(&extra) {
                bases.push(extra);
            }
        }
    }
    bases
}

/// The live scan bases for this process — see [`home_scan_bases_for`].
pub fn home_scan_bases() -> Vec<PathBuf> {
    home_scan_bases_for(
        current_platform(),
        home_dir().as_deref(),
        dirs::document_dir().as_deref(),
        dirs::desktop_dir().as_deref(),
    )
}

/// Wire-format relative path: vault and repo entries cross the socket as
/// forward-slash strings — the Obsidian convention the web client splits
/// and matches on. Joining components manually keeps the wire shape
/// identical on every platform, instead of leaking Windows `\` separators
/// into a protocol the client never expects.
///
/// On Unix this is byte-identical to `rel.to_string_lossy()` for
/// well-formed paths: components never contain `/` by construction.
pub fn wire_rel_path(rel: &Path) -> String {
    rel.components()
        .map(|c| c.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

/// Extensions a bare command name may carry on Windows — from `PATHEXT`,
/// falling back to the CreateProcess default set. Unix has no extension
/// machinery: the bare name either is the executable or is not there.
pub fn executable_extensions_for(platform: Platform, pathext: Option<&str>) -> Vec<String> {
    if platform != Platform::Windows {
        return Vec::new();
    }
    let from_env: Vec<String> = pathext
        .map(|v| {
            v.split(';')
                .filter(|e| !e.is_empty())
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    if !from_env.is_empty() {
        return from_env;
    }
    [".COM", ".EXE", ".BAT", ".CMD"]
        .iter()
        .map(|s| s.to_string())
        .collect()
}

/// Is `bin` an executable file inside `dir`? On Windows the bare name
/// lookup almost always fails — installed CLIs are `claude.exe` /
/// `codex.cmd` — so each PATHEXT extension is tried in both cases (the
/// filesystem is case-insensitive in practice, but checking both keeps
/// the lookup deterministic on any filesystem).
pub fn binary_in_dir_for(platform: Platform, dir: &Path, bin: &str, pathext: Option<&str>) -> bool {
    if dir.join(bin).is_file() {
        return true;
    }
    executable_extensions_for(platform, pathext)
        .iter()
        .any(|ext| {
            dir.join(format!("{}{}", bin, ext.to_ascii_lowercase()))
                .is_file()
                || dir
                    .join(format!("{}{}", bin, ext.to_ascii_uppercase()))
                    .is_file()
        })
}

/// Binary lookup in PATH — `std::env::split_paths` honors the platform
/// separator. Splitting a Windows PATH on `:` would shred every
/// drive-lettered entry (`C:\…` becomes `C` + `\…`), which is why the
/// naive `split(':')` scan never found anything on Windows at all.
pub fn binary_on_path(bin: &str) -> bool {
    let Some(paths) = std::env::var_os("PATH") else {
        return false;
    };
    let pathext = std::env::var("PATHEXT").ok();
    std::env::split_paths(&paths)
        .any(|dir| binary_in_dir_for(current_platform(), &dir, bin, pathext.as_deref()))
}

#[cfg(test)]
mod tests {
    use super::*;

    // ---------- tilde expansion ----------

    #[test]
    fn tilde_expands_home_forms_on_unix() {
        let home = Path::new("/home/op");
        assert_eq!(
            expand_tilde_for(Platform::Unix, "~/vault", Some(home)),
            PathBuf::from("/home/op/vault")
        );
        assert_eq!(
            expand_tilde_for(Platform::Unix, "~", Some(home)),
            PathBuf::from("/home/op")
        );
        assert_eq!(
            expand_tilde_for(Platform::Unix, "~/a/b/c", Some(home)),
            PathBuf::from("/home/op/a/b/c")
        );
    }

    #[test]
    fn tilde_passes_non_tilde_and_unknown_user_forms_through() {
        let home = Path::new("/home/op");
        for input in ["/abs/path", "relative/path", "~other/x", "x~", ""] {
            assert_eq!(
                expand_tilde_for(Platform::Unix, input, Some(home)),
                PathBuf::from(input),
                "input must pass through unchanged: {input:?}"
            );
        }
    }

    #[test]
    fn tilde_without_home_leaves_input_untouched() {
        // Same net effect as before the port: an unexpandable tilde path
        // simply never canonicalizes, rather than resolving somewhere wrong.
        assert_eq!(
            expand_tilde_for(Platform::Unix, "~/vault", None),
            PathBuf::from("~/vault")
        );
        assert_eq!(
            expand_tilde_for(Platform::Windows, "~/vault", None),
            PathBuf::from("~/vault")
        );
    }

    #[test]
    fn tilde_expands_backslash_form_only_on_windows() {
        let home = Path::new("C:/Users/op");
        assert_eq!(
            expand_tilde_for(Platform::Windows, "~\\vault", Some(home)),
            PathBuf::from("C:/Users/op").join("vault")
        );
        assert_eq!(
            expand_tilde_for(Platform::Windows, "~/vault", Some(home)),
            PathBuf::from("C:/Users/op").join("vault")
        );
        // …while a literal `~` never expands on Unix — `~\` is not a
        // shell convention there.
        let unix_home = Path::new("/home/op");
        assert_eq!(
            expand_tilde_for(Platform::Unix, "~\\vault", Some(unix_home)),
            PathBuf::from("~\\vault")
        );
    }

    #[test]
    fn tilde_separator_runs_stay_inside_home() {
        // Regression: `~//vault` must resolve under home — joining a tail
        // that is still absolute (`/vault`) would REPLACE the home base
        // and escape to the filesystem root.
        let home = Path::new("/home/op");
        assert_eq!(
            expand_tilde_for(Platform::Unix, "~//vault", Some(home)),
            PathBuf::from("/home/op/vault")
        );
        assert_eq!(
            expand_tilde_for(Platform::Unix, "~///a/b", Some(home)),
            PathBuf::from("/home/op/a/b")
        );
        let win_home = Path::new("C:/Users/op");
        assert_eq!(
            expand_tilde_for(Platform::Windows, "~\\\\vault", Some(win_home)),
            PathBuf::from("C:/Users/op").join("vault")
        );
        assert_eq!(
            expand_tilde_for(Platform::Windows, "~/\\vault", Some(win_home)),
            PathBuf::from("C:/Users/op").join("vault")
        );
    }

    // ---------- canvas config dir selection ----------

    #[test]
    fn unix_config_dir_is_the_historical_dot_config_layout() {
        // Parity lock: pre-port installs live at $HOME/.config/canvas —
        // moving this would silently revoke existing sandbox grants.
        let home = Path::new("/home/op");
        assert_eq!(
            canvas_config_dir_for(Platform::Unix, Some(home), None),
            Some(PathBuf::from("/home/op/.config/canvas"))
        );
        // The roaming config location is irrelevant on Unix even when set.
        assert_eq!(
            canvas_config_dir_for(Platform::Unix, Some(home), Some(Path::new("/x/roaming"))),
            Some(PathBuf::from("/home/op/.config/canvas"))
        );
        assert_eq!(canvas_config_dir_for(Platform::Unix, None, None), None);
    }

    #[test]
    fn windows_config_dir_roams_in_appdata() {
        let roaming = Path::new("C:/Users/op/AppData/Roaming");
        assert_eq!(
            canvas_config_dir_for(Platform::Windows, None, Some(roaming)),
            Some(PathBuf::from("C:/Users/op/AppData/Roaming/canvas"))
        );
        // HOME being absent must not matter — Windows resolves config
        // from the roaming folder, not the Unix layout.
        let home = Path::new("C:/Users/op");
        assert_eq!(
            canvas_config_dir_for(Platform::Windows, Some(home), Some(roaming)),
            Some(PathBuf::from("C:/Users/op/AppData/Roaming/canvas"))
        );
        assert_eq!(
            canvas_config_dir_for(Platform::Windows, Some(home), None),
            None
        );
    }

    // ---------- home scan bases ----------

    #[test]
    fn unix_scan_bases_are_the_historical_triple() {
        let home = Path::new("/home/op");
        assert_eq!(
            home_scan_bases_for(Platform::Unix, Some(home), None, None),
            vec![
                PathBuf::from("/home/op/Documents"),
                PathBuf::from("/home/op/Desktop"),
                PathBuf::from("/home/op"),
            ]
        );
        // XDG-style document locations never leak into the Unix scan.
        assert_eq!(
            home_scan_bases_for(
                Platform::Unix,
                Some(home),
                Some(Path::new("/home/op/docs")),
                None
            ),
            vec![
                PathBuf::from("/home/op/Documents"),
                PathBuf::from("/home/op/Desktop"),
                PathBuf::from("/home/op"),
            ]
        );
        assert!(home_scan_bases_for(Platform::Unix, None, None, None).is_empty());
    }

    #[test]
    fn windows_scan_bases_include_redirected_known_folders() {
        let home = Path::new("C:/Users/op");
        let redirected = Path::new("C:/Users/op/OneDrive/Documents");
        let bases = home_scan_bases_for(
            Platform::Windows,
            Some(home),
            Some(redirected),
            Some(Path::new("C:/Users/op/Desktop")), // not redirected — deduped
        );
        assert_eq!(
            bases,
            vec![
                PathBuf::from("C:/Users/op/Documents"),
                PathBuf::from("C:/Users/op/Desktop"),
                PathBuf::from("C:/Users/op"),
                PathBuf::from("C:/Users/op/OneDrive/Documents"),
            ]
        );
    }

    // ---------- wire-format relative paths ----------

    #[test]
    fn wire_paths_are_forward_slash_joined() {
        // Components joined manually: no platform separator leaks onto
        // the wire regardless of how the filesystem reported the path.
        let rel = Path::new("notes").join("deep").join("file.md");
        assert_eq!(wire_rel_path(&rel), "notes/deep/file.md");
        assert_eq!(wire_rel_path(Path::new("file.md")), "file.md");
        // A backslash inside a Unix filename is data, not a separator —
        // it must survive untouched (the input here is a single component
        // on Unix and two components when parsed on Windows; either way
        // the wire join never emits a backslash as a separator).
        let joined = wire_rel_path(&Path::new("a").join("b.md"));
        assert_eq!(joined, "a/b.md");
    }

    // ---------- PATH scan ----------

    #[test]
    fn unix_never_uses_extension_candidates() {
        assert!(executable_extensions_for(Platform::Unix, Some(".EXE")).is_empty());
        assert!(executable_extensions_for(Platform::Unix, None).is_empty());
    }

    #[test]
    fn windows_extensions_come_from_pathext_or_the_default_set() {
        assert_eq!(
            executable_extensions_for(Platform::Windows, Some(".COM;.EXE;.BAT;.CMD;.VBS")),
            vec![".COM", ".EXE", ".BAT", ".CMD", ".VBS"]
        );
        // Empty/missing PATHEXT falls back to the CreateProcess set.
        assert_eq!(
            executable_extensions_for(Platform::Windows, None),
            vec![".COM", ".EXE", ".BAT", ".CMD"]
        );
        assert_eq!(
            executable_extensions_for(Platform::Windows, Some(";;")),
            vec![".COM", ".EXE", ".BAT", ".CMD"]
        );
    }

    #[test]
    fn binary_in_dir_matches_bare_and_extended_names() {
        let dir = std::env::temp_dir().join(format!(
            "canvas-paths-test-{}",
            uuid::Uuid::new_v4().simple()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("plain"), "x").unwrap();
        std::fs::write(dir.join("wincli.exe"), "x").unwrap();

        // Bare names resolve identically on both platforms.
        assert!(binary_in_dir_for(Platform::Unix, &dir, "plain", None));
        assert!(binary_in_dir_for(Platform::Windows, &dir, "plain", None));
        assert!(!binary_in_dir_for(Platform::Unix, &dir, "missing", None));

        // `wincli.exe` is invisible to the Unix bare-name scan but found
        // through PATHEXT on Windows.
        assert!(!binary_in_dir_for(Platform::Unix, &dir, "wincli", None));
        assert!(binary_in_dir_for(Platform::Windows, &dir, "wincli", None));
        // .EXE absent from PATHEXT — must NOT match.
        assert!(!binary_in_dir_for(
            Platform::Windows,
            &dir,
            "wincli",
            Some(".BAT;.CMD")
        ));

        std::fs::remove_dir_all(&dir).unwrap();
    }
}
