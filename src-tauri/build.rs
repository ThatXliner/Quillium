use std::fs;

fn main() {
    // Copy the updater capability into the capabilities dir for non-MAS builds.
    // For MAS builds (--no-default-features --features mas), this file is excluded
    // because the updater plugin is not allowed on the Mac App Store.
    #[cfg(feature = "updater")]
    {
        let src = "capabilities-optional/updater.json";
        let dst = "capabilities/updater.json";
        fs::copy(src, dst).expect("failed to copy updater capability");
        println!("cargo:rerun-if-changed={src}");
    }

    // Remove the updater capability if it was previously copied (MAS builds).
    #[cfg(not(feature = "updater"))]
    {
        let dst = "capabilities/updater.json";
        if std::path::Path::new(dst).exists() {
            fs::remove_file(dst).expect("failed to remove updater capability");
        }
    }

    println!("cargo:rerun-if-changed=capabilities-optional/updater.json");
    tauri_build::build()
}
