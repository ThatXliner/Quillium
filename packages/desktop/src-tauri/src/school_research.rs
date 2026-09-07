//! school_research.rs — bounded, public-HTTPS HTML fetches for School research.
//!
//! Requests are resolved and pinned before connecting so a DNS answer cannot be
//! swapped for a private address between validation and the HTTP request. The
//! command deliberately has no redirect, proxy, cookie, or credential support.

use std::{
    collections::HashMap,
    net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr},
    sync::{Arc, Mutex, OnceLock},
    time::Duration,
};

use tauri_plugin_http::reqwest::{self, header::CONTENT_TYPE, redirect::Policy};
use tokio::{
    net::lookup_host,
    sync::{oneshot, Semaphore},
    time::timeout,
};
use url::{Host, Url};

const HTTPS_PORT: u16 = 443;
const MAX_BODY_BYTES: usize = 512 * 1024;
const MAX_REQUEST_ID_CHARS: usize = 100;
const MAX_CONCURRENT_REQUESTS: usize = 2;
const FETCH_TIMEOUT: Duration = Duration::from_secs(15);
const USER_AGENT: &str = "Quillium-School-Research/1.0";

type PendingRequests = Mutex<HashMap<String, Option<oneshot::Sender<()>>>>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FetchError {
    InvalidRequestId,
    DuplicateRequestId,
    InvalidUrl,
    ForbiddenAddress,
    TooManyRequests,
    Dns,
    Client,
    Request,
    UnexpectedStatus,
    InvalidContentType,
    BodyTooLarge,
    BodyRead,
    Cancelled,
    TimedOut,
    Internal,
}

impl FetchError {
    fn message(self) -> &'static str {
        match self {
            Self::InvalidRequestId => "invalid research request id",
            Self::DuplicateRequestId => "research request id is already in use",
            Self::InvalidUrl => "research URL is not allowed",
            Self::ForbiddenAddress => "research URL resolved to a non-public address",
            Self::TooManyRequests => "too many research requests are in progress",
            Self::Dns => "research URL could not be resolved",
            Self::Client => "research HTTP client could not be created",
            Self::Request => "research request failed",
            Self::UnexpectedStatus => "research request returned an unsuccessful status",
            Self::InvalidContentType => "research response is not HTML or plain text",
            Self::BodyTooLarge => "research response exceeds the size limit",
            Self::BodyRead => "research response could not be read",
            Self::Cancelled => "research request was cancelled",
            Self::TimedOut => "research request timed out",
            Self::Internal => "research request state is unavailable",
        }
    }
}

struct ValidatedUrl {
    url: Url,
    hostname: String,
}

/// Fetches a small HTML/text page from a public HTTPS host.
#[tauri::command]
pub async fn school_research_fetch(url: String, request_id: String) -> Result<String, String> {
    validate_request_id(&request_id).map_err(|error| error.message().to_string())?;
    let validated = validate_public_url(&url).map_err(|error| error.message().to_string())?;
    let permit = fetch_semaphore()
        .clone()
        .try_acquire_owned()
        .map_err(|_| FetchError::TooManyRequests.message().to_string())?;
    let cancellation = register_pending_request(pending_requests(), request_id.clone())
        .map_err(|error| error.message().to_string())?;

    let result = timeout(
        FETCH_TIMEOUT,
        fetch_with_cancellation(validated, cancellation),
    )
    .await;

    let _ = remove_pending_request(pending_requests(), &request_id);
    drop(permit);

    match result {
        Ok(Ok(html)) => Ok(html),
        Ok(Err(error)) => Err(error.message().to_string()),
        Err(_) => Err(FetchError::TimedOut.message().to_string()),
    }
}

/// Cancels a pending School research fetch. Cancelling an already-finished or
/// unknown request is intentionally idempotent.
#[tauri::command]
pub fn school_research_cancel(request_id: String) -> Result<(), String> {
    validate_request_id(&request_id)
        .map_err(|error| error.message().to_string())
        .and_then(|_| {
            cancel_pending_request(pending_requests(), &request_id)
                .map_err(|error| error.message().to_string())
        })
}

async fn fetch_with_cancellation(
    validated: ValidatedUrl,
    cancellation: oneshot::Receiver<()>,
) -> Result<String, FetchError> {
    tokio::select! {
        biased;
        _ = cancellation => Err(FetchError::Cancelled),
        result = fetch_html(validated) => result,
    }
}

async fn fetch_html(validated: ValidatedUrl) -> Result<String, FetchError> {
    let addresses: Vec<SocketAddr> = lookup_host((validated.hostname.as_str(), HTTPS_PORT))
        .await
        .map_err(|_| FetchError::Dns)?
        .collect();
    if addresses.is_empty()
        || addresses
            .iter()
            .any(|address| !is_public_address(address.ip()))
    {
        return Err(FetchError::ForbiddenAddress);
    }

    let client = reqwest::Client::builder()
        .redirect(Policy::none())
        .no_proxy()
        .cookie_store(false)
        .referer(false)
        .user_agent(USER_AGENT)
        .timeout(FETCH_TIMEOUT)
        .resolve_to_addrs(&validated.hostname, &addresses)
        .build()
        .map_err(|_| FetchError::Client)?;

    let mut response = client
        .get(validated.url)
        .send()
        .await
        .map_err(|_| FetchError::Request)?;
    if !response.status().is_success() {
        return Err(FetchError::UnexpectedStatus);
    }
    if !is_html_or_plain_text(response.headers().get(CONTENT_TYPE)) {
        return Err(FetchError::InvalidContentType);
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_BODY_BYTES as u64)
    {
        return Err(FetchError::BodyTooLarge);
    }

    let capacity = response
        .content_length()
        .unwrap_or(0)
        .min(MAX_BODY_BYTES as u64) as usize;
    let mut body = Vec::with_capacity(capacity);
    while let Some(chunk) = response.chunk().await.map_err(|_| FetchError::BodyRead)? {
        append_body_chunk(&mut body, &chunk)?;
    }

    Ok(String::from_utf8_lossy(&body).into_owned())
}

fn validate_request_id(request_id: &str) -> Result<(), FetchError> {
    if request_id.is_empty() || request_id.chars().count() > MAX_REQUEST_ID_CHARS {
        Err(FetchError::InvalidRequestId)
    } else {
        Ok(())
    }
}

fn validate_public_url(raw_url: &str) -> Result<ValidatedUrl, FetchError> {
    let url = Url::parse(raw_url).map_err(|_| FetchError::InvalidUrl)?;
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || authority_contains_userinfo(&url)
        || url.query().is_some()
        || url.fragment().is_some()
        || url.port().is_some_and(|port| port != HTTPS_PORT)
    {
        return Err(FetchError::InvalidUrl);
    }

    let hostname = match url.host() {
        Some(Host::Domain(host)) => host.to_string(),
        Some(Host::Ipv4(_)) | Some(Host::Ipv6(_)) | None => return Err(FetchError::InvalidUrl),
    };
    let host_without_trailing_dot = hostname.trim_end_matches('.');
    let lowercase_host = host_without_trailing_dot.to_ascii_lowercase();
    if host_without_trailing_dot.is_empty()
        || lowercase_host.parse::<IpAddr>().is_ok()
        || lowercase_host == "localhost"
        || lowercase_host == "local"
        || lowercase_host == "internal"
        || lowercase_host.ends_with(".local")
        || lowercase_host.ends_with(".internal")
    {
        return Err(FetchError::InvalidUrl);
    }

    Ok(ValidatedUrl { url, hostname })
}

fn authority_contains_userinfo(url: &Url) -> bool {
    let Some((_, after_scheme)) = url.as_str().split_once("://") else {
        return false;
    };
    let authority = after_scheme
        .split(|character| matches!(character, '/' | '?' | '#'))
        .next()
        .unwrap_or_default();
    authority.contains('@')
}

fn is_html_or_plain_text(content_type: Option<&reqwest::header::HeaderValue>) -> bool {
    let Some(content_type) = content_type else {
        return false;
    };
    let Ok(content_type) = content_type.to_str() else {
        return false;
    };
    let media_type = content_type.split(';').next().unwrap_or_default().trim();
    media_type.eq_ignore_ascii_case("text/html") || media_type.eq_ignore_ascii_case("text/plain")
}

fn append_body_chunk(body: &mut Vec<u8>, chunk: &[u8]) -> Result<(), FetchError> {
    if body.len() > MAX_BODY_BYTES || chunk.len() > MAX_BODY_BYTES.saturating_sub(body.len()) {
        return Err(FetchError::BodyTooLarge);
    }
    body.extend_from_slice(chunk);
    Ok(())
}

fn pending_requests() -> &'static PendingRequests {
    static PENDING: OnceLock<PendingRequests> = OnceLock::new();
    PENDING.get_or_init(|| Mutex::new(HashMap::new()))
}

fn fetch_semaphore() -> &'static Arc<Semaphore> {
    static FETCH_SEMAPHORE: OnceLock<Arc<Semaphore>> = OnceLock::new();
    FETCH_SEMAPHORE.get_or_init(|| Arc::new(Semaphore::new(MAX_CONCURRENT_REQUESTS)))
}

fn register_pending_request(
    pending: &PendingRequests,
    request_id: String,
) -> Result<oneshot::Receiver<()>, FetchError> {
    let (sender, receiver) = oneshot::channel();
    let mut requests = pending.lock().map_err(|_| FetchError::Internal)?;
    if requests.contains_key(&request_id) {
        return Err(FetchError::DuplicateRequestId);
    }
    requests.insert(request_id, Some(sender));
    Ok(receiver)
}

fn remove_pending_request(pending: &PendingRequests, request_id: &str) -> Result<(), FetchError> {
    let mut requests = pending.lock().map_err(|_| FetchError::Internal)?;
    requests.remove(request_id);
    Ok(())
}

fn cancel_pending_request(pending: &PendingRequests, request_id: &str) -> Result<(), FetchError> {
    // Keep the entry until the fetch's completion path removes it. This makes
    // request IDs unique for the entire operation, including after cancel, and
    // prevents an old fetch from removing a newer request with the same ID.
    let sender = pending
        .lock()
        .map_err(|_| FetchError::Internal)?
        .get_mut(request_id)
        .and_then(Option::take);
    if let Some(sender) = sender {
        let _ = sender.send(());
    }
    Ok(())
}

fn is_public_address(address: IpAddr) -> bool {
    match address {
        IpAddr::V4(address) => is_public_ipv4(address),
        IpAddr::V6(address) => is_public_ipv6(address),
    }
}

fn is_public_ipv4(address: Ipv4Addr) -> bool {
    const NON_PUBLIC_NETWORKS: &[([u8; 4], u8)] = &[
        ([0, 0, 0, 0], 8),       // this network / unspecified
        ([10, 0, 0, 0], 8),      // private
        ([100, 64, 0, 0], 10),   // shared address space
        ([127, 0, 0, 0], 8),     // loopback
        ([169, 254, 0, 0], 16),  // link local
        ([172, 16, 0, 0], 12),   // private
        ([192, 0, 0, 0], 24),    // IETF protocol assignments
        ([192, 0, 2, 0], 24),    // documentation
        ([192, 88, 99, 0], 24),  // deprecated 6to4 relay anycast
        ([192, 168, 0, 0], 16),  // private
        ([198, 18, 0, 0], 15),   // benchmarking
        ([198, 51, 100, 0], 24), // documentation
        ([203, 0, 113, 0], 24),  // documentation
        ([224, 0, 0, 0], 4),     // multicast
        ([240, 0, 0, 0], 4),     // reserved
    ];

    !NON_PUBLIC_NETWORKS
        .iter()
        .any(|(network, prefix)| ipv4_in_network(address, *network, *prefix))
}

fn ipv4_in_network(address: Ipv4Addr, network: [u8; 4], prefix: u8) -> bool {
    let address = u32::from_be_bytes(address.octets());
    let network = u32::from_be_bytes(network);
    let mask = if prefix == 0 {
        0
    } else {
        u32::MAX << (32 - u32::from(prefix))
    };
    address & mask == network & mask
}

fn is_public_ipv6(address: Ipv6Addr) -> bool {
    let segments = address.segments();
    if address.is_unspecified()
        || address.is_loopback()
        || address.is_multicast()
        || address.to_ipv4_mapped().is_some()
    {
        return false;
    }

    // Global unicast IPv6 addresses are in 2000::/3. This also excludes
    // unique-local, link-local, site-local, and other non-global ranges.
    if segments[0] & 0xe000 != 0x2000 {
        return false;
    }

    // Reserved, documentation, benchmark, tunnel, and deprecated ranges.
    if (segments[0] == 0x2001 && segments[1] <= 0x0007)
        || (segments[0] == 0x2001 && segments[1] == 0x0002 && segments[2] == 0)
        || (segments[0] == 0x2001 && segments[1] & 0xfff0 == 0x0010)
        || (segments[0] == 0x2001 && segments[1] == 0x0db8)
        || segments[0] == 0x2002
        || segments[0] == 0x3ffe
        || (segments[0] == 0x3fff && segments[1] & 0xf000 == 0)
    {
        return false;
    }

    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_urls_outside_the_public_https_policy() {
        for url in [
            "http://example.com/",
            "https://user@example.com/",
            "https://example.com?query=secret",
            "https://example.com/#fragment",
            "https://example.com:8443/",
            "https://127.0.0.1/",
            "https://[::1]/",
            "https://localhost/",
            "https://service.local/",
            "https://service.internal/",
        ] {
            assert!(validate_public_url(url).is_err(), "accepted {url}");
        }

        assert!(validate_public_url("https://example.com/path").is_ok());
        assert!(validate_public_url("https://example.com:443/path").is_ok());
    }

    #[test]
    fn rejects_non_public_ipv4_and_ipv6_answers() {
        for address in [
            "0.0.0.0",
            "10.0.0.1",
            "100.64.0.1",
            "127.0.0.1",
            "169.254.1.1",
            "172.16.0.1",
            "192.168.1.1",
            "198.18.0.1",
            "203.0.113.1",
            "224.0.0.1",
            "240.0.0.1",
            "::",
            "::1",
            "::ffff:8.8.8.8",
            "::ffff:127.0.0.1",
            "fc00::1",
            "fe80::1",
            "ff02::1",
            "2001:db8::1",
            "2001:2::1",
            "2002::1",
        ] {
            let address = address.parse::<IpAddr>().unwrap();
            assert!(!is_public_address(address), "accepted {address}");
        }

        assert!(is_public_address("8.8.8.8".parse().unwrap()));
        assert!(is_public_address("2001:4860:4860::8888".parse().unwrap()));
    }

    #[test]
    fn body_accumulator_enforces_the_byte_cap() {
        let mut body = Vec::new();
        let at_limit = vec![b'x'; MAX_BODY_BYTES];
        append_body_chunk(&mut body, &at_limit).unwrap();
        assert_eq!(body.len(), MAX_BODY_BYTES);
        assert_eq!(
            append_body_chunk(&mut body, b"x"),
            Err(FetchError::BodyTooLarge)
        );
    }

    #[test]
    fn request_ids_are_bounded_and_unique_while_pending() {
        assert!(validate_request_id(&"x".repeat(MAX_REQUEST_ID_CHARS)).is_ok());
        assert!(validate_request_id(&"x".repeat(MAX_REQUEST_ID_CHARS + 1)).is_err());
        assert!(validate_request_id("").is_err());

        let pending = Mutex::new(HashMap::new());
        let _receiver = register_pending_request(&pending, "request-1".to_string()).unwrap();
        assert!(matches!(
            register_pending_request(&pending, "request-1".to_string()),
            Err(FetchError::DuplicateRequestId)
        ));
        remove_pending_request(&pending, "request-1").unwrap();
    }

    #[test]
    fn cancellation_notifies_and_completion_removes_a_pending_request() {
        let pending = Mutex::new(HashMap::new());
        let receiver = register_pending_request(&pending, "request-1".to_string()).unwrap();
        cancel_pending_request(&pending, "request-1").unwrap();
        assert!(receiver.blocking_recv().is_ok());
        assert!(pending.lock().unwrap().contains_key("request-1"));
        cancel_pending_request(&pending, "request-1").unwrap();
        remove_pending_request(&pending, "request-1").unwrap();
        assert!(!pending.lock().unwrap().contains_key("request-1"));
    }

    #[tokio::test]
    #[ignore = "requires live public internet access"]
    async fn fetches_live_official_research_pages() {
        let uc = school_research_fetch(
            "https://admission.universityofcalifornia.edu/how-to-apply/applying-as-a-first-year/personal-insight-questions.html".to_string(),
            "live-uc-piq".to_string(),
        )
        .await
        .unwrap();
        assert!(uc
            .to_ascii_lowercase()
            .contains("personal insight questions"));
    }
}
