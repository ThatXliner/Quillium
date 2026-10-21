// hot_update.rs exercises upstream runtime and acquisition using real files and HTTP.
use std::{fs, path::Path, sync::Arc};

use crate::runtime::{self, HotUpdate, Shared};
use crate::testutil::Fixture;
use crate::update::UpdateOutcome;
use crate::BundleSource;

fn boot(root: &Path, native: &str) -> HotUpdate {
    let shared = Arc::new(Shared::default());
    runtime::initialize(&shared, root.to_path_buf(), native.parse().unwrap());
    HotUpdate { shared }
}

async fn download(app: &HotUpdate, fixture: &Fixture) -> UpdateOutcome {
    app.check_and_download(&fixture.config(), |_, _| {})
        .await
        .unwrap()
}

#[tokio::test]
async fn recovery_keeps_previous_bundle_and_suppresses_failed_hash_until_state_corruption() {
    let fixture = Fixture::new();
    fixture.publish("1.1.0", "1.0.0");
    let app = boot(&fixture.root, "1.0.0");
    assert!(matches!(
        download(&app, &fixture).await,
        UpdateOutcome::Staged { .. }
    ));
    assert_eq!(app.current_bundle().unwrap().source, BundleSource::Embedded);
    boot(&fixture.root, "1.0.0").notify_app_ready().unwrap();

    fs::write(
        fixture.tmp.path().join("dist/index.html"),
        "broken frontend",
    )
    .unwrap();
    let (broken, _) = fixture.publish("1.2.0", "1.0.0");
    assert!(matches!(
        download(&app, &fixture).await,
        UpdateOutcome::Staged { .. }
    ));
    for _ in 0..2 {
        let trial = boot(&fixture.root, "1.0.0");
        assert_eq!(trial.current_bundle().unwrap().version.to_string(), "1.2.0");
        assert!(fixture.state()["booting"].is_number());
    }
    let recovered = boot(&fixture.root, "1.0.0");
    assert_eq!(
        recovered.current_bundle().unwrap().version.to_string(),
        "1.1.0"
    );
    assert!(fixture.state()["failed"]
        .as_array()
        .unwrap()
        .contains(&serde_json::Value::String(broken.archive.sha256)));
    let downloads = fixture.server.request_count("/bundle-1.2.0.tar.gz");
    assert!(matches!(
        download(&recovered, &fixture).await,
        UpdateOutcome::Blacklisted { .. }
    ));
    assert_eq!(
        fixture.server.request_count("/bundle-1.2.0.tar.gz"),
        downloads
    );

    fs::write(fixture.root.join("state.json"), "{").unwrap();
    let recovered = boot(&fixture.root, "1.0.0");
    assert_eq!(
        recovered.current_bundle().unwrap().source,
        BundleSource::Embedded
    );
    assert_eq!(fixture.state()["failed"], serde_json::json!([]));
    assert_eq!(fixture.state()["maxVersionSeen"], "1.0.0");
    assert!(matches!(
        download(&recovered, &fixture).await,
        UpdateOutcome::Staged { .. }
    ));
}

#[tokio::test]
async fn stalled_body_outlives_the_thirty_second_connection_timeout() {
    use std::io::{BufRead, BufReader, ErrorKind, Write};
    use std::net::TcpListener;
    use std::time::Duration;

    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let url = format!("http://{}/manifest.json", listener.local_addr().unwrap());
    let (release, wait) = std::sync::mpsc::channel();
    let server = std::thread::spawn(move || {
        let mut socket = loop {
            match listener.accept() {
                Ok((socket, _)) => break socket,
                Err(error) if error.kind() == ErrorKind::WouldBlock => {
                    if wait.recv_timeout(Duration::from_millis(10))
                        != Err(std::sync::mpsc::RecvTimeoutError::Timeout)
                    {
                        return;
                    }
                }
                Err(error) => panic!("test server could not accept a connection: {error}"),
            }
        };
        socket.set_nonblocking(false).unwrap();
        socket
            .set_read_timeout(Some(Duration::from_secs(10)))
            .unwrap();
        let mut reader = BufReader::new(socket.try_clone().unwrap());
        loop {
            let mut line = String::new();
            if reader.read_line(&mut line).unwrap() == 0 || line == "\r\n" {
                break;
            }
        }
        socket
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nx")
            .unwrap();
        socket.flush().unwrap();
        wait.recv_timeout(Duration::from_secs(40)).ok();
    });
    let client = crate::download::http_client().unwrap();
    let observed = tokio::time::timeout(
        Duration::from_secs(32),
        crate::download::fetch_capped(&client, &url, 1024),
    )
    .await;
    release.send(()).ok();
    server.join().unwrap();
    assert!(
        observed.is_err(),
        "the evaluator deadline, rather than the client, must expire"
    );
}
