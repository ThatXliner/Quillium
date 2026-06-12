//! schema.rs — Connection setup. The schema itself lives in migrations.rs.

use rusqlite::{Connection, Result};
use std::path::Path;
use std::time::Duration;

use super::migrations;

/// Registers sqlite-vec (the `vec0` virtual table module, statically linked)
/// for every connection opened in this process. Must run before the first
/// `Connection::open`; `Once` makes repeat calls free.
fn register_vec_extension() {
    use rusqlite::ffi::sqlite3_auto_extension;
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| unsafe {
        // Transmute is the documented registration pattern for sqlite-vec with
        // rusqlite 0.31 (the C init fn signature matches sqlite3_auto_extension's
        // expected callback type).
        sqlite3_auto_extension(Some(std::mem::transmute(
            sqlite_vec::sqlite3_vec_init as *const (),
        )));
    });
}

pub fn open_db(path: &Path) -> Result<Connection> {
    register_vec_extension();
    let conn = Connection::open(path)?;
    conn.execute_batch(
        "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA synchronous=NORMAL;",
    )?;
    // The semantic-index worker holds a second connection to the same file;
    // WAL allows the concurrency, busy_timeout absorbs write collisions.
    conn.busy_timeout(Duration::from_secs(5))?;
    migrations::migrate(&conn)?;
    Ok(conn)
}
