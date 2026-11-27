//! Thin standalone wrapper around `canvasd::ctl`.

fn main() -> anyhow::Result<()> {
    canvasd::ctl::run_blocking(std::env::args().skip(1).collect())
}
