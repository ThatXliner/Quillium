//! Generates disposable keys for the packaged OTA verification harness.
#[cfg(feature = "cli")]
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let root = std::path::PathBuf::from(
        std::env::args()
            .nth(1)
            .ok_or("fixture directory required")?,
    );
    std::fs::create_dir_all(&root)?;
    let pair = minisign::KeyPair::generate_unencrypted_keypair()?;
    std::fs::write(root.join("fixture.pub"), pair.pk.to_box()?.to_string())?;
    let path = root.join("fixture.key");
    let mut file = std::fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        file.set_permissions(std::fs::Permissions::from_mode(0o600))?;
    }
    use std::io::Write;
    file.write_all(pair.sk.to_box(None)?.to_string().as_bytes())?;
    Ok(())
}
#[cfg(not(feature = "cli"))]
fn main() {
    panic!("fixture key generation requires --features cli");
}
