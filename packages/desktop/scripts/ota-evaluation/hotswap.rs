// hotswap.rs checks actual updater functions rather than isolated policy methods.
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
};

use crate::manifest::{HotswapManifest, HotswapMeta};
use crate::policy::{BinaryCachePolicyKind, ConfirmationPolicyKind, RollbackPolicyKind};
use crate::resolver::{CheckContext, HotswapResolver};
use crate::updater::{activate_version, check_compatibility, check_update, read_meta};

fn bundle(root: &Path, sequence: u64, confirmed: bool) -> PathBuf {
    let directory = root.join(format!("seq-{sequence}"));
    fs::create_dir_all(&directory).unwrap();
    fs::write(directory.join("index.html"), "fixture frontend").unwrap();
    let meta = HotswapMeta {
        version: format!("1.0.0-ota.{sequence}"),
        sequence,
        min_binary_version: "1.0.0".into(),
        confirmed,
        unconfirmed_launch_count: 0,
    };
    fs::write(
        directory.join("hotswap-meta.json"),
        serde_json::to_vec(&meta).unwrap(),
    )
    .unwrap();
    directory
}

fn startup(root: &Path) -> Option<PathBuf> {
    check_compatibility(
        root,
        "1.0.0",
        &BinaryCachePolicyKind::default(),
        &ConfirmationPolicyKind::default(),
        &RollbackPolicyKind::default(),
    )
}

#[test]
fn default_policy_discards_activation_before_its_first_cold_trial() {
    let root = tempfile::tempdir().unwrap();
    let pending = bundle(root.path(), 1, false);
    activate_version(root.path(), &pending).unwrap();
    assert_eq!(startup(root.path()), None);
    assert!(!pending.exists());
}

struct Offer(HotswapManifest);

impl HotswapResolver for Offer {
    fn check(
        &self,
        _: &CheckContext,
    ) -> std::pin::Pin<
        Box<dyn std::future::Future<Output = crate::error::Result<Option<HotswapManifest>>> + Send>,
    > {
        let manifest = self.0.clone();
        Box::pin(async move { Ok(Some(manifest)) })
    }
}

#[tokio::test]
async fn failed_release_is_offered_again_after_rollback_to_confirmed_bundle() {
    let root = tempfile::tempdir().unwrap();
    let good = bundle(root.path(), 1, true);
    let broken = bundle(root.path(), 2, false);
    activate_version(root.path(), &broken).unwrap();
    assert_eq!(startup(root.path()), Some(good.clone()));
    let context = CheckContext {
        current_sequence: read_meta(&good).unwrap().sequence,
        binary_version: "1.0.0".into(),
        platform: "macos",
        arch: "aarch64",
        channel: None,
        headers: HashMap::new(),
        endpoint_override: None,
    };
    let resolver = Offer(HotswapManifest {
        version: "1.0.0-ota.2".into(),
        sequence: 2,
        url: "https://example.invalid/broken.tar.gz".into(),
        signature: "unused-at-check".into(),
        min_binary_version: "1.0.0".into(),
        notes: None,
        pub_date: None,
        mandatory: None,
        bundle_size: None,
    });
    let offered = check_update::<tauri::test::MockRuntime>(&resolver, &context, None)
        .await
        .unwrap();
    assert_eq!(offered.unwrap().sequence, 2);
}
