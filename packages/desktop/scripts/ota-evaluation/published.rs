// published.rs records the native compatibility limitation in hot-update 0.1.1.
#[tokio::test]
async fn published_bundle_survives_a_native_upgrade_below_its_frontend_version() {
    let fixture = Fixture::new();
    fixture.publish("1.1.0", "1.0.0");
    download(&boot(&fixture.root, "1.0.0"), &fixture).await;
    let upgraded = boot(&fixture.root, "1.0.1");
    assert_eq!(upgraded.current_bundle().unwrap().source, BundleSource::Ota);
    assert_eq!(
        upgraded.current_bundle().unwrap().version.to_string(),
        "1.1.0"
    );
    assert!(fixture.state()["versions"]["1"]
        .get("minShellVersion")
        .is_none());
}
