// development.rs checks baseVersion across all startup pointer states at the pinned head.
#[tokio::test]
async fn development_rechecks_staged_base_after_native_upgrade() {
    let fixture = Fixture::new();
    fixture.publish_with_base("1.1.0", "1.0.0", Some("1.0.0"));
    assert!(matches!(
        download(&boot(&fixture.root, "1.0.0"), &fixture).await,
        UpdateOutcome::Staged { .. }
    ));
    let upgraded = boot(&fixture.root, "1.0.1");
    assert_eq!(
        upgraded.current_bundle().unwrap().source,
        BundleSource::Embedded
    );
    assert_eq!(fixture.state()["failed"], serde_json::json!([]));
}

#[tokio::test]
async fn development_rearms_trial_despite_native_upgrade_past_base() {
    let fixture = Fixture::new();
    fixture.publish_with_base("1.1.0", "1.0.0", Some("1.0.0"));
    assert!(matches!(
        download(&boot(&fixture.root, "1.0.0"), &fixture).await,
        UpdateOutcome::Staged { .. }
    ));
    boot(&fixture.root, "1.0.0");
    let upgraded = boot(&fixture.root, "1.0.1");
    assert_eq!(upgraded.current_bundle().unwrap().source, BundleSource::Ota);
    assert_eq!(fixture.state()["bootingStrikes"], 1);
    assert_eq!(fixture.state()["versions"]["1"]["baseVersion"], "1.0.0");
}

#[tokio::test]
async fn development_keeps_committed_bundle_despite_native_upgrade_past_base() {
    let fixture = Fixture::new();
    fixture.publish_with_base("1.1.0", "1.0.0", Some("1.0.0"));
    assert!(matches!(
        download(&boot(&fixture.root, "1.0.0"), &fixture).await,
        UpdateOutcome::Staged { .. }
    ));
    boot(&fixture.root, "1.0.0").notify_app_ready().unwrap();
    let upgraded = boot(&fixture.root, "1.0.1");
    assert_eq!(upgraded.current_bundle().unwrap().source, BundleSource::Ota);
    assert_eq!(fixture.state()["versions"]["1"]["baseVersion"], "1.0.0");
}
