use std::{collections::HashSet, path::PathBuf, sync::{Mutex, OnceLock}};
static ACTIVE: OnceLock<Mutex<HashSet<PathBuf>>> = OnceLock::new();

/// Prevent two requests from appending to the same partial file concurrently.
pub(super) struct DownloadGuard(PathBuf);
impl DownloadGuard {
    pub fn acquire(path: PathBuf) -> Result<Self, String> {
        let mut active = ACTIVE.get_or_init(Default::default).lock().map_err(|_| "Download lock unavailable")?;
        if !active.insert(path.clone()) { return Err("This file is already downloading".into()); }
        Ok(Self(path))
    }
}
impl Drop for DownloadGuard {
    fn drop(&mut self) {
        if let Ok(mut active) = ACTIVE.get_or_init(Default::default).lock() { active.remove(&self.0); }
    }
}
