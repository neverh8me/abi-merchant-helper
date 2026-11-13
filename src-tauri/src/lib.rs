//! ABI: Merchant Helper. One window: first the start screen (update, base sync), then the page itself,
//! which is served by the local server in this process (server.rs) and fed by capture.rs.
mod capture;
mod server;
mod sync;

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

const PORT: u16 = 8777; // the same address as before: the page's browser storage is keyed by it
const GAME_EXE: &str = "UAGame";

struct App {
    hub: Arc<server::Hub>,
    /// Why the local server did not start (the port is taken: an old version is still running).
    server_error: Option<String>,
}

#[derive(Serialize)]
struct Info {
    version: String,
    url: String,
    error: Option<String>,
}

#[tauri::command]
fn app_info(app: AppHandle, state: State<App>) -> Info {
    Info { version: app.package_info().version.to_string(), url: format!("http://localhost:{}/", state.hub.port), error: state.server_error.clone() }
}

#[tauri::command]
async fn sync_base(state: State<'_, App>) -> Result<sync::Summary, String> {
    sync::run(&state.hub.ui, &state.hub.data).await
}

#[derive(Serialize)]
struct UpdateInfo {
    available: bool,
    version: Option<String>,
    notes: Option<String>,
}

#[tauri::command]
async fn check_update(app: AppHandle) -> Result<UpdateInfo, String> {
    use tauri_plugin_updater::UpdaterExt;
    let update = app.updater().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())?;
    Ok(UpdateInfo { available: update.is_some(), version: update.as_ref().map(|u| u.version.clone()), notes: update.and_then(|u| u.body) })
}

/// Download (with `update-progress` events), verify the signature, install, restart.
#[tauri::command]
async fn install_update(app: AppHandle) -> Result<(), String> {
    use tauri_plugin_updater::UpdaterExt;
    let Some(update) = app.updater().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())? else {
        return Err("already up to date".into());
    };
    let mut downloaded = 0u64;
    let progress = app.clone();
    update
        .download_and_install(
            move |chunk, total| {
                downloaded += chunk as u64;
                let _ = progress.emit("update-progress", serde_json::json!({ "downloaded": downloaded, "total": total }));
            },
            || {},
        )
        .await
        .map_err(|e| e.to_string())?;
    app.restart(); // on Windows the installer takes over and closes the app itself
}

/// The value after `--name` on the command line.
fn arg(name: &str) -> Option<String> {
    let mut args = std::env::args().skip(1);
    args.find(|a| a == name).and_then(|_| args.next())
}

/// The move from the PowerShell version: its folder holds the page's storage mirror and the purchase files.
/// A file that is already here is never overwritten.
fn import(from: &Path, data: &Path) {
    for name in ["userdata.json", "purchases.mine.json", ".purchases-sent.json", "diag.on", "library/purchases.json"] {
        let (src, dst) = (from.join(name), data.join(name));
        if src.is_file() && !dst.exists() {
            let _ = dst.parent().map(std::fs::create_dir_all);
            let _ = std::fs::copy(src, dst);
        }
    }
}

/// `window.open` from the page. A blank one is the overlay (one monitor): a small window that stays above
/// the game, and the page moves the result card and the map into it. A web link goes to the browser.
fn new_window(app: &AppHandle, url: tauri::Url, features: tauri::webview::NewWindowFeatures) -> tauri::webview::NewWindowResponse<tauri::Wry> {
    use tauri::webview::NewWindowResponse;
    if url.scheme() == "https" {
        let _ = std::process::Command::new("explorer").arg(url.as_str()).spawn();
        return NewWindowResponse::Deny;
    }
    if url.as_str() != "about:blank" || app.get_webview_window("overlay").is_some() {
        return NewWindowResponse::Deny;
    }
    let built = WebviewWindowBuilder::new(app, "overlay", WebviewUrl::External(url))
        .window_features(features)
        .title("ABI: Merchant Helper")
        .inner_size(380.0, 600.0)
        .always_on_top(true)
        .background_color(tauri::webview::Color(5, 5, 7, 255))
        .build();
    match built {
        Ok(window) => NewWindowResponse::Create { window },
        Err(_) => NewWindowResponse::Deny,
    }
}

fn ui_dir(app: &AppHandle) -> PathBuf {
    if cfg!(debug_assertions) {
        return Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap().to_path_buf();
    }
    app.path().resource_dir().unwrap_or_default().join("ui")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![app_info, sync_base, check_update, install_update])
        .setup(|app| {
            let handle = app.handle();
            let data = arg("--data").map(PathBuf::from).unwrap_or(handle.path().app_data_dir()?);
            std::fs::create_dir_all(&data)?;
            if let Some(from) = arg("--import") {
                import(Path::new(&from), &data);
            }
            let port = arg("--port").and_then(|p| p.parse().ok()).unwrap_or(PORT);
            let exe = arg("--exe").unwrap_or(GAME_EXE.into());
            let hub = server::Hub::new(ui_dir(handle), data, port);

            // bind now, so the start screen can say plainly that the address is taken
            let server_error = match std::net::TcpListener::bind(("127.0.0.1", port)) {
                Ok(listener) => {
                    listener.set_nonblocking(true)?;
                    let router = server::router(hub.clone());
                    tauri::async_runtime::spawn(async move {
                        let listener = tokio::net::TcpListener::from_std(listener).expect("listener");
                        let _ = axum::serve(listener, router).await;
                    });
                    None
                }
                Err(e) => Some(e.to_string()),
            };
            for run in [capture::audio_loop as fn(Arc<server::Hub>, String), capture::screen_loop] {
                let (hub, exe) = (hub.clone(), exe.clone());
                std::thread::spawn(move || run(hub, exe));
            }
            app.manage(App { hub, server_error });

            // Our own title bar (close, minimize, maximize are part of the page) instead of the system frame.
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("ABI: Merchant Helper")
                .inner_size(1280.0, 860.0)
                .min_inner_size(760.0, 520.0)
                .decorations(false)
                .visible(!std::env::args().any(|a| a == "--hidden")) // tests: no window on the screen
                .background_color(tauri::webview::Color(5, 5, 7, 255))
                .initialization_script("window.__ABI_APP__ = true;")
                .on_new_window({
                    let handle = handle.clone();
                    move |url, features| new_window(&handle, url, features)
                })
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running ABI: Merchant Helper");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn import_copies_once_and_never_overwrites() {
        let dir = std::env::temp_dir().join(format!("abi-mh-import-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let (old, new) = (dir.join("old"), dir.join("new"));
        std::fs::create_dir_all(old.join("library")).unwrap();
        std::fs::create_dir_all(&new).unwrap();
        std::fs::write(old.join("userdata.json"), "old sounds").unwrap();
        std::fs::write(old.join("library/purchases.json"), "base").unwrap();
        std::fs::write(old.join("purchases.mine.json"), "old").unwrap();
        std::fs::write(new.join("purchases.mine.json"), "newer").unwrap();
        import(&old, &new);
        assert_eq!(std::fs::read_to_string(new.join("userdata.json")).unwrap(), "old sounds");
        assert_eq!(std::fs::read_to_string(new.join("library/purchases.json")).unwrap(), "base");
        assert_eq!(std::fs::read_to_string(new.join("purchases.mine.json")).unwrap(), "newer");
    }
}
