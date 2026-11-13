//! The local server the page talks to: the page's files, the game sound (/audio) and frames (/screen)
//! over WebSocket, and the page's own files (purchases, a mirror of its storage, diagnostics).
//! Only this PC and only our own page: the Host and Origin headers are checked on every request.
use axum::Router;
use axum::body::Bytes;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{DefaultBodyLimit, Request, State};
use axum::http::{HeaderMap, Method, StatusCode, Uri, header};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use tokio::sync::broadcast;

#[derive(Clone)]
pub enum Msg {
    Text(String),
    Bin(Bytes),
}

pub struct Hub {
    pub audio: broadcast::Sender<Msg>,
    pub audio_status: Mutex<String>,
    pub screen: broadcast::Sender<Msg>,
    pub screen_state: Mutex<String>,
    pub screen_clients: AtomicUsize,
    /// The page's files (read only) and the user's files (purchases, storage mirror, diag, merged base).
    pub ui: PathBuf,
    pub data: PathBuf,
    pub port: u16,
}

impl Hub {
    pub fn new(ui: PathBuf, data: PathBuf, port: u16) -> Arc<Hub> {
        Arc::new(Hub {
            audio: broadcast::channel(64).0,
            audio_status: Mutex::new(r#"{"type":"status","state":"start"}"#.into()),
            screen: broadcast::channel(8).0,
            screen_state: Mutex::new(String::new()),
            screen_clients: AtomicUsize::new(0),
            ui,
            data,
            port,
        })
    }
}

const BODY_MAX: usize = 32 * 1024 * 1024;
const DIAG_LOG_MAX: u64 = 2 * 1024 * 1024;
const DIAG_FRAMES: usize = 40;

pub fn router(hub: Arc<Hub>) -> Router {
    Router::new()
        .route("/audio", get(audio))
        .route("/screen", get(screen))
        .route("/api/purchases", post(|s, h, b| save_json(s, h, b, "purchases.mine.json", "\"purchases\"")))
        .route("/api/userdata", post(|s, h, b| save_json(s, h, b, "userdata.json", "\"localStorage\"")))
        .route("/api/diag", post(diag))
        .route("/api/diagframe", post(diag_frame))
        .fallback(file)
        .layer(DefaultBodyLimit::max(BODY_MAX))
        .layer(middleware::from_fn_with_state(hub.clone(), guard))
        .with_state(hub)
}

/// Another site open in a browser on this PC could also reach localhost, so: the Host must be ours (no DNS
/// rebinding), and anything but a plain GET must come from our own page. No Origin at all: not a browser.
async fn guard(State(hub): State<Arc<Hub>>, req: Request, next: Next) -> Response {
    let h = req.headers();
    let get = |name| h.get(name).and_then(|v: &header::HeaderValue| v.to_str().ok());
    let ours = [format!("localhost:{}", hub.port), format!("127.0.0.1:{}", hub.port)];
    if !get(header::HOST).is_some_and(|v| ours.iter().any(|o| o == v)) {
        return StatusCode::FORBIDDEN.into_response();
    }
    let sensitive = req.method() != Method::GET || h.contains_key(header::UPGRADE);
    let own = get(header::ORIGIN).is_none_or(|o| ours.iter().any(|x| o == format!("http://{x}")));
    if sensitive && !own {
        return StatusCode::FORBIDDEN.into_response();
    }
    next.run(req).await
}

async fn audio(State(hub): State<Arc<Hub>>, ws: WebSocketUpgrade) -> Response {
    ws.on_upgrade(|socket| async move {
        let rx = hub.audio.subscribe();
        let first = hub.audio_status.lock().unwrap().clone();
        pump(socket, rx, first).await;
    })
}

async fn screen(State(hub): State<Arc<Hub>>, ws: WebSocketUpgrade) -> Response {
    ws.on_upgrade(|socket| async move {
        let rx = hub.screen.subscribe();
        let first = hub.screen_state.lock().unwrap().clone();
        hub.screen_clients.fetch_add(1, Ordering::Relaxed);
        pump(socket, rx, first).await;
        hub.screen_clients.fetch_sub(1, Ordering::Relaxed);
    })
}

/// Sends the current state, then everything from the channel until the page closes the socket.
/// A page that falls behind loses the old messages (frames), it is never queued up.
async fn pump(mut socket: WebSocket, mut rx: broadcast::Receiver<Msg>, first: String) {
    if !first.is_empty() && socket.send(Message::Text(first.into())).await.is_err() {
        return;
    }
    loop {
        tokio::select! {
            m = rx.recv() => {
                let out = match m {
                    Ok(Msg::Text(t)) => Message::Text(t.into()),
                    Ok(Msg::Bin(b)) => Message::Binary(b),
                    Err(broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(broadcast::error::RecvError::Closed) => break,
                };
                if socket.send(out).await.is_err() { break; }
            }
            m = socket.recv() => {
                if !matches!(m, Some(Ok(m)) if !matches!(m, Message::Close(_))) { break; }
            }
        }
    }
}

/// Writes one of the page's own JSON files. The custom header cannot be sent from another site without
/// CORS permission. The file is replaced in one step, so it is never missing or half written.
async fn save_json(State(hub): State<Arc<Hub>>, headers: HeaderMap, body: String, name: &str, must_have: &str) -> StatusCode {
    let marked = headers.get("x-abi-merchant-helper").is_some_and(|v| v == "1");
    if !marked || !body.trim_start().starts_with('{') || !body.contains(must_have) {
        return StatusCode::BAD_REQUEST;
    }
    match write_atomic(&hub.data.join(name), body.as_bytes()) {
        Ok(()) => StatusCode::NO_CONTENT,
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR,
    }
}

pub fn write_atomic(file: &Path, bytes: &[u8]) -> std::io::Result<()> {
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = file.with_extension("tmp");
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, file)
}

fn local_time() -> windows::Win32::Foundation::SYSTEMTIME {
    unsafe { windows::Win32::System::SystemInformation::GetLocalTime() }
}

/// Diagnostics, local only: text lines go to diag/diag.log (capped), frames to diag/frame-*.jpg (newest 40).
static DIAG: Mutex<()> = Mutex::new(());

async fn diag(State(hub): State<Arc<Hub>>, body: String) -> StatusCode {
    use std::io::Write;
    let _lock = DIAG.lock().unwrap();
    let dir = hub.data.join("diag");
    let log = dir.join("diag.log");
    let _ = std::fs::create_dir_all(&dir);
    if std::fs::metadata(&log).is_ok_and(|m| m.len() > DIAG_LOG_MAX) {
        let _ = std::fs::remove_file(&log);
    }
    let t = local_time();
    let line = format!("{:02}.{:02} {:02}:{:02}:{:02}.{:03}  {body}\n", t.wDay, t.wMonth, t.wHour, t.wMinute, t.wSecond, t.wMilliseconds);
    match std::fs::OpenOptions::new().create(true).append(true).open(&log).and_then(|mut f| f.write_all(line.as_bytes())) {
        Ok(()) => StatusCode::NO_CONTENT,
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR,
    }
}

async fn diag_frame(State(hub): State<Arc<Hub>>, body: Bytes) -> StatusCode {
    let _lock = DIAG.lock().unwrap();
    let dir = hub.data.join("diag");
    let _ = std::fs::create_dir_all(&dir);
    let t = local_time();
    let name = format!("frame-{:02}{:02}-{:02}{:02}{:02}-{:03}.jpg", t.wMonth, t.wDay, t.wHour, t.wMinute, t.wSecond, t.wMilliseconds);
    if body.is_empty() || std::fs::write(dir.join(name), &body).is_err() {
        return StatusCode::BAD_REQUEST;
    }
    let mut frames: Vec<PathBuf> = std::fs::read_dir(&dir).into_iter().flatten().flatten().map(|e| e.path())
        .filter(|p| p.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.starts_with("frame-") && n.ends_with(".jpg")))
        .collect();
    frames.sort();
    for old in frames.iter().take(frames.len().saturating_sub(DIAG_FRAMES)) {
        let _ = std::fs::remove_file(old);
    }
    StatusCode::NO_CONTENT
}

/// A file of the page. The user's folder comes first: the merged purchase base, the storage mirror
/// and diag.on live there. Only plain names below the two folders, never "..".
async fn file(State(hub): State<Arc<Hub>>, method: Method, uri: Uri) -> Response {
    if method != Method::GET {
        return StatusCode::NOT_FOUND.into_response();
    }
    let rel = match uri.path().trim_start_matches('/') {
        "" => "index.html",
        p => p,
    };
    let Some(path) = resolve(&hub, rel) else { return StatusCode::NOT_FOUND.into_response() };
    let Ok(bytes) = tokio::fs::read(&path).await else { return StatusCode::NOT_FOUND.into_response() };
    let mime = match path.extension().and_then(|e| e.to_str()).unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "js" => "application/javascript; charset=utf-8",
        "css" => "text/css",
        "json" => "application/json; charset=utf-8",
        "png" => "image/png",
        "svg" => "image/svg+xml",
        "ico" => "image/x-icon",
        "wav" => "audio/wav",
        "wasm" => "application/wasm",
        _ => "application/octet-stream",
    };
    ([(header::CONTENT_TYPE, mime), (header::CACHE_CONTROL, "no-cache")], bytes).into_response()
}

fn resolve(hub: &Hub, rel: &str) -> Option<PathBuf> {
    // percent-encoded paths are not decoded: the page's own files have plain names
    let plain = !rel.is_empty() && rel.split('/').all(|part| !part.is_empty() && part != ".." && part != "." && !part.contains(['\\', ':', '%']));
    if !plain {
        return None;
    }
    [&hub.data, &hub.ui].into_iter().map(|root| root.join(rel)).find(|p| p.is_file())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hub() -> (Arc<Hub>, PathBuf) {
        let dir = std::env::temp_dir().join(format!("abi-mh-test-{}-{:?}", std::process::id(), std::thread::current().id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("ui/library")).unwrap();
        std::fs::create_dir_all(dir.join("data/library")).unwrap();
        std::fs::write(dir.join("ui/index.html"), "page").unwrap();
        std::fs::write(dir.join("ui/library/purchases.json"), "shipped").unwrap();
        std::fs::write(dir.join("secret.txt"), "no").unwrap();
        (Hub::new(dir.join("ui"), dir.join("data"), 8777), dir)
    }

    #[test]
    fn serves_only_plain_paths_and_prefers_the_users_folder() {
        let (hub, dir) = hub();
        assert_eq!(resolve(&hub, "index.html"), Some(dir.join("ui/index.html")));
        assert_eq!(resolve(&hub, "library/purchases.json"), Some(dir.join("ui/library/purchases.json")));
        std::fs::write(dir.join("data/library/purchases.json"), "merged").unwrap();
        assert_eq!(resolve(&hub, "library/purchases.json"), Some(dir.join("data/library/purchases.json")));
        for bad in ["../secret.txt", "..\\secret.txt", "library/../../secret.txt", "%2e%2e/secret.txt", "C:/Windows/win.ini", "nope.js"] {
            assert_eq!(resolve(&hub, bad), None, "{bad}");
        }
    }

    #[test]
    fn a_file_is_replaced_whole() {
        let (_, dir) = hub();
        let f = dir.join("data/purchases.mine.json");
        write_atomic(&f, b"one").unwrap();
        write_atomic(&f, b"two").unwrap();
        assert_eq!(std::fs::read_to_string(&f).unwrap(), "two");
        assert!(!f.with_extension("tmp").exists());
    }
}
