//! Share-by-link primitives: publish artifact bytes at an unguessable URL
//! that lives only while the app runs (Deska's "publish by link"). One
//! implementation feeding both the daemon's `/api/share` + `/share/{id}`
//! routes and the Tauri shell's embedded share server — a link produced
//! by either runtime behaves identically in the browser.

use base64::Engine;

/// Published bytes are capped — shares are artifacts, not file transfer.
pub const MAX_SHARE_BYTES: usize = 8 * 1024 * 1024;

/// Unguessable share id: 16 hex chars of a v4 uuid (64 bits). The id is
/// the capability — the serving endpoint is unauthenticated by design, so
/// the entropy here is the whole access-control story.
pub fn new_share_id() -> String {
    uuid::Uuid::new_v4().simple().to_string()[..16].to_string()
}

/// Why a share body was rejected — the daemon maps these to distinct HTTP
/// statuses (413 vs 400), so the variants stay machine-readable rather
/// than collapsing into one error string.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DecodeError {
    TooLarge,
    BadBase64,
}

impl DecodeError {
    pub fn message(self) -> &'static str {
        match self {
            DecodeError::TooLarge => "share too large",
            DecodeError::BadBase64 => "bad base64",
        }
    }
}

impl std::fmt::Display for DecodeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.message())
    }
}

/// Decode the client's base64 body, rejecting anything over the cap.
pub fn decode_body(b64: &str) -> Result<Vec<u8>, DecodeError> {
    match base64::engine::general_purpose::STANDARD.decode(b64) {
        Ok(b) if b.len() <= MAX_SHARE_BYTES => Ok(b),
        Ok(_) => Err(DecodeError::TooLarge),
        Err(_) => Err(DecodeError::BadBase64),
    }
}

/// Empty titles publish as "artifact" — the filename in the browser tab
/// still reads sensibly when the caller had nothing better.
pub fn normalize_title(title: &str) -> String {
    if title.trim().is_empty() {
        "artifact".to_string()
    } else {
        title.to_string()
    }
}

pub fn normalize_mime(mime: &str) -> String {
    if mime.trim().is_empty() {
        "application/octet-stream".to_string()
    } else {
        mime.to_string()
    }
}

/// Content-Disposition for the served bytes: inline preview with a .pdf
/// filename — shares are PDFs in practice, and the browser's save dialog
/// should not have to guess the extension. Quotes are stripped so a title
/// can't break out of the header value. (The daemon historically produced
/// a trailing dot for titles already ending in `.pdf`; this is the
/// intended form of the same logic.)
pub fn content_disposition(title: &str) -> String {
    let name = title.replace('"', "");
    if name.ends_with(".pdf") {
        format!("inline; filename=\"{name}\"")
    } else {
        format!("inline; filename=\"{name}.pdf\"")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn share_ids_are_16_hex_chars_and_unique() {
        let a = new_share_id();
        let b = new_share_id();
        assert_eq!(a.len(), 16);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a, b);
    }

    #[test]
    fn decode_body_accepts_valid_base64_within_the_cap() {
        let body = decode_body("aGVsbG8=").unwrap();
        assert_eq!(body, b"hello");
    }

    #[test]
    fn decode_body_rejects_bad_base64_and_oversized_payloads() {
        assert_eq!(decode_body("!!!not-base64!!!"), Err(DecodeError::BadBase64));
        let oversized =
            base64::engine::general_purpose::STANDARD.encode(vec![0u8; MAX_SHARE_BYTES + 1]);
        assert_eq!(decode_body(&oversized), Err(DecodeError::TooLarge));
        // Exactly at the cap is fine — the limit is a cap, not a fencepost.
        let at_cap = base64::engine::general_purpose::STANDARD.encode(vec![0u8; MAX_SHARE_BYTES]);
        assert!(decode_body(&at_cap).is_ok());
    }

    #[test]
    fn blank_titles_and_mimes_fall_back_to_defaults() {
        assert_eq!(normalize_title(""), "artifact");
        assert_eq!(normalize_title("   "), "artifact");
        assert_eq!(normalize_title("digest"), "digest");
        assert_eq!(normalize_mime(""), "application/octet-stream");
        assert_eq!(normalize_mime("application/pdf"), "application/pdf");
    }

    #[test]
    fn content_disposition_appends_pdf_once_and_strips_quotes() {
        assert_eq!(
            content_disposition("weekly digest"),
            "inline; filename=\"weekly digest.pdf\""
        );
        // Already-suffixed titles stay untouched — no trailing dot, no
        // double extension.
        assert_eq!(
            content_disposition("digest.pdf"),
            "inline; filename=\"digest.pdf\""
        );
        assert_eq!(
            content_disposition("evil\"name"),
            "inline; filename=\"evilname.pdf\""
        );
    }
}
