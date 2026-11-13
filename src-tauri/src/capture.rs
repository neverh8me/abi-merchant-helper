//! The sound and the picture of the game, and nothing else.
//! Sound: Windows process loopback (as OBS and Discord do), only the game process is heard.
//! Picture: a plain screen copy of the right half of the game window (the merchant is there), as JPEG.
//! The game process is never opened: only the regular process and window lists are read.
use crate::server::{Hub, Msg};
use std::sync::atomic::Ordering;
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};
use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM, POINT, RECT};
use windows::Win32::Graphics::Gdi::*;
use windows::Win32::System::Diagnostics::ToolHelp::*;
use windows::Win32::UI::WindowsAndMessaging::*;
use windows::core::BOOL;

pub const SAMPLE_RATE: u32 = 48000;
const FRAME_MS: u64 = 33; // up to 30 frames per second
const BLACK_CHECK_EVERY: u32 = 15;
/// The frame is the right part of the window; the page is told so and does not crop again.
const MERCHANT_SIDE: f64 = 0.5;

/// `exe` is the name without ".exe"; "pid:1234" is one process (for tests without the game). 0: not running.
pub fn find_process(exe: &str) -> u32 {
    let want_pid: Option<u32> = exe.strip_prefix("pid:").and_then(|p| p.parse().ok());
    let want_name = format!("{exe}.exe").to_lowercase();
    unsafe {
        let Ok(snap) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else { return 0 };
        let mut e = PROCESSENTRY32W { dwSize: size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
        let mut found = 0;
        let mut ok = Process32FirstW(snap, &mut e).is_ok();
        while ok {
            let len = e.szExeFile.iter().position(|&c| c == 0).unwrap_or(e.szExeFile.len());
            let name = String::from_utf16_lossy(&e.szExeFile[..len]).to_lowercase();
            if want_pid.map_or(name == want_name, |p| p == e.th32ProcessID) {
                found = e.th32ProcessID;
                break;
            }
            ok = Process32NextW(snap, &mut e).is_ok();
        }
        let _ = CloseHandle(snap);
        found
    }
}

fn alive(pid: u32) -> bool {
    find_process(&format!("pid:{pid}")) == pid
}

// ---------------------------------------------------------------- sound

fn status_json(state: &str, pid: u32, message: &str) -> String {
    serde_json::json!({ "type": "status", "state": state, "pid": pid, "rate": SAMPLE_RATE, "message": message }).to_string()
}

fn set_status(hub: &Hub, state: &str, pid: u32, message: &str) {
    let s = status_json(state, pid, message);
    *hub.audio_status.lock().unwrap() = s.clone();
    let _ = hub.audio.send(Msg::Text(s));
}

/// Runs forever: waits for the game, streams its sound as mono float32 48 kHz.
pub fn audio_loop(hub: Arc<Hub>, exe: String) {
    let _ = wasapi::initialize_mta();
    let mut last = "";
    loop {
        let pid = find_process(&exe);
        if pid == 0 {
            if last != "wait" {
                set_status(&hub, "wait", 0, &format!("{exe}.exe"));
            }
            last = "wait";
            std::thread::sleep(Duration::from_secs(2));
            continue;
        }
        set_status(&hub, "game", pid, &format!("{exe}.exe"));
        last = "game";
        if let Err(e) = loopback(&hub, pid) {
            set_status(&hub, "error", pid, &e.to_string());
            last = "error";
            std::thread::sleep(Duration::from_secs(3));
        }
    }
}

/// Captures the process sound while the process is alive.
fn loopback(hub: &Hub, pid: u32) -> Result<(), Box<dyn std::error::Error>> {
    use wasapi::*;
    let format = WaveFormat::new(32, 32, SampleType::Float, SAMPLE_RATE as usize, 2, None);
    let mut client = AudioClient::new_application_loopback_client(pid, true)?;
    client.initialize_client(&format, Direction::Capture, StreamMode::EventsShared { autoconvert: true, buffer_duration_hns: 2_000_000 }, None)?;
    let event = client.set_get_eventhandle()?;
    let capture = client.get_audiocaptureclient()?;
    client.start_stream()?;
    let mut stereo = vec![0u8; 0];
    let mut checked = Instant::now();
    loop {
        let _ = event.wait_for_event(100); // silence sends no events: the timeout is not an error
        if checked.elapsed() > Duration::from_secs(1) {
            checked = Instant::now();
            if !alive(pid) {
                let _ = client.stop_stream();
                return Ok(());
            }
        }
        while let Some(frames) = capture.get_next_packet_size()?.filter(|&n| n > 0) {
            stereo.resize(frames as usize * 8, 0);
            let (got, info) = capture.read_from_device(&mut stereo)?;
            let mut mono = Vec::with_capacity(got as usize * 4);
            for f in stereo[..got as usize * 8].chunks_exact(8) {
                let l = f32::from_le_bytes([f[0], f[1], f[2], f[3]]);
                let r = f32::from_le_bytes([f[4], f[5], f[6], f[7]]);
                let m = if info.flags.silent { 0.0 } else { (l + r) * 0.5 };
                mono.extend_from_slice(&m.to_le_bytes());
            }
            if got > 0 {
                let _ = hub.audio.send(Msg::Bin(mono.into()));
            }
        }
    }
}

// ---------------------------------------------------------------- picture

/// The largest visible window of the process, from the regular window list.
fn find_window(pid: u32) -> Option<HWND> {
    struct Best(u32, i64, Option<HWND>);
    unsafe extern "system" fn each(h: HWND, p: LPARAM) -> BOOL {
        unsafe {
            let best = &mut *(p.0 as *mut Best);
            let mut owner = 0u32;
            GetWindowThreadProcessId(h, Some(&mut owner));
            let mut r = RECT::default();
            if owner == best.0 && IsWindowVisible(h).as_bool() && GetClientRect(h, &mut r).is_ok() {
                let area = (r.right - r.left) as i64 * (r.bottom - r.top) as i64;
                if area > best.1 {
                    best.1 = area;
                    best.2 = Some(h);
                }
            }
            true.into()
        }
    }
    let mut best = Best(pid, 0, None);
    unsafe {
        let _ = EnumWindows(Some(each), LPARAM(&mut best as *mut Best as isize));
    }
    best.2
}

/// The window's client area (no border, no title) in screen pixels: x, y, w, h.
fn client_area(h: HWND) -> Option<(i32, i32, i32, i32)> {
    unsafe {
        if IsIconic(h).as_bool() {
            return None;
        }
        let mut r = RECT::default();
        GetClientRect(h, &mut r).ok()?;
        let mut p = POINT::default();
        let _ = ClientToScreen(h, &mut p);
        Some((p.x, p.y, r.right - r.left, r.bottom - r.top))
    }
}

struct Frame {
    w: i32,
    h: i32,
    bgra: Vec<u8>,
}

/// A copy of a screen rectangle, 32-bit BGRA, top row first.
fn grab(x: i32, y: i32, w: i32, h: i32) -> Option<Frame> {
    unsafe {
        let screen = GetDC(None);
        let mem = CreateCompatibleDC(Some(screen));
        let info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER { biSize: size_of::<BITMAPINFOHEADER>() as u32, biWidth: w, biHeight: -h, biPlanes: 1, biBitCount: 32, ..Default::default() },
            ..Default::default()
        };
        let mut bits = std::ptr::null_mut();
        let bmp = CreateDIBSection(Some(mem), &info, DIB_RGB_COLORS, &mut bits, None, 0);
        let mut frame = None;
        if let Ok(bmp) = bmp {
            let old = SelectObject(mem, bmp.into());
            if BitBlt(mem, 0, 0, w, h, Some(screen), x, y, SRCCOPY).is_ok() && !bits.is_null() {
                frame = Some(Frame { w, h, bgra: std::slice::from_raw_parts(bits as *const u8, (w * h * 4) as usize).to_vec() });
            }
            SelectObject(mem, old);
            let _ = DeleteObject(bmp.into());
        }
        let _ = DeleteDC(mem);
        ReleaseDC(None, screen);
        frame
    }
}

/// Completely black (the game in exclusive fullscreen): 81 points in a grid.
fn is_black(f: &Frame) -> bool {
    (1..10).all(|i| {
        (1..10).all(|j| {
            let o = ((f.h * j / 10) * f.w + f.w * i / 10) as usize * 4;
            f.bgra[o] as u32 + f.bgra[o + 1] as u32 + f.bgra[o + 2] as u32 <= 30
        })
    })
}

fn encode(f: &Frame) -> Option<Vec<u8>> {
    let mut out = Vec::with_capacity(f.bgra.len() / 8);
    jpeg_encoder::Encoder::new(&mut out, 92).encode(&f.bgra, f.w as u16, f.h as u16, jpeg_encoder::ColorType::Bgra).ok()?;
    Some(out)
}

fn screen_json(state: &str) -> String {
    serde_json::json!({ "type": "screen", "state": state, "crop": MERCHANT_SIDE }).to_string()
}

fn set_screen_state(hub: &Hub, state: &'static str) {
    let mut cur = hub.screen_state.lock().unwrap();
    if !cur.contains(&format!("\"state\":\"{state}\"")) {
        *cur = screen_json(state);
        let _ = hub.screen.send(Msg::Text(cur.clone()));
    }
}

/// Runs forever: frames go out only while a page listens. Capture and JPEG encoding run in two threads.
pub fn screen_loop(hub: Arc<Hub>, exe: String) {
    *hub.screen_state.lock().unwrap() = screen_json("start");
    let pending: Arc<(Mutex<Option<Frame>>, Condvar)> = Arc::default();
    {
        let (hub, pending) = (hub.clone(), pending.clone());
        std::thread::spawn(move || encode_loop(hub, pending));
    }
    let mut hwnd: Option<HWND> = None;
    let mut looked = Instant::now() - Duration::from_secs(100);
    let mut last_cursor = (i32::MIN, i32::MIN);
    let mut clients = 0;
    loop {
        let now_clients = hub.screen_clients.load(Ordering::Relaxed);
        if now_clients > clients {
            last_cursor = (i32::MIN, i32::MIN); // a new page gets the cursor even if the mouse stands still
        }
        clients = now_clients;
        if clients == 0 {
            std::thread::sleep(Duration::from_millis(200));
            continue;
        }
        let started = Instant::now();
        if hwnd.is_none() || looked.elapsed() > Duration::from_secs(2) {
            looked = started;
            let pid = find_process(&exe);
            hwnd = if pid != 0 { find_window(pid) } else { None };
        }
        let area = hwnd.and_then(client_area);
        let state = match (hwnd, area) {
            (None, _) => "nogame",
            (_, Some((_, _, w, h))) if w >= 100 && h >= 100 => "game",
            _ => "minimized",
        };
        set_screen_state(&hub, state);
        let Some((x, y, w, h)) = area.filter(|_| state == "game") else {
            std::thread::sleep(Duration::from_millis(500));
            continue;
        };
        let cut = (w as f64 * MERCHANT_SIDE).round() as i32;
        match grab(x + cut, y, w - cut, h) {
            Some(frame) => {
                // a frame not encoded yet is replaced by the fresh one, so no queue builds up
                *pending.0.lock().unwrap() = Some(frame);
                pending.1.notify_one();
                // the cursor in frame pixels, sent when it moves: the page then knows the cargo under the mouse
                let mut p = POINT::default();
                if unsafe { GetCursorPos(&mut p) }.is_ok() {
                    let c = (p.x - (x + cut), p.y - y);
                    if c != last_cursor {
                        last_cursor = c;
                        let _ = hub.screen.send(Msg::Text(serde_json::json!({ "type": "cursor", "x": c.0, "y": c.1 }).to_string()));
                    }
                }
            }
            None => std::thread::sleep(Duration::from_secs(1)),
        }
        if let Some(rest) = Duration::from_millis(FRAME_MS).checked_sub(started.elapsed()) {
            std::thread::sleep(rest);
        }
    }
}

fn encode_loop(hub: Arc<Hub>, pending: Arc<(Mutex<Option<Frame>>, Condvar)>) {
    let (mut was_black, mut n) = (false, 0u32);
    loop {
        let frame = {
            let mut slot = pending.0.lock().unwrap();
            loop {
                if let Some(f) = slot.take() {
                    break f;
                }
                slot = pending.1.wait(slot).unwrap();
            }
        };
        if n % BLACK_CHECK_EVERY == 0 {
            let black = is_black(&frame);
            if black != was_black {
                was_black = black;
                let _ = hub.screen.send(Msg::Text(serde_json::json!({ "type": "screen", "black": black, "crop": MERCHANT_SIDE }).to_string()));
            }
        }
        n = n.wrapping_add(1);
        if let Some(jpeg) = encode(&frame) {
            let _ = hub.screen.send(Msg::Bin(jpeg.into()));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_itself_and_no_ghosts() {
        let me = std::process::id();
        assert_eq!(find_process(&format!("pid:{me}")), me);
        assert!(alive(me));
        assert_eq!(find_process("no-such-game-exe"), 0);
    }

    #[test]
    fn black_frame_and_jpeg() {
        let mut f = Frame { w: 64, h: 64, bgra: vec![0; 64 * 64 * 4] };
        assert!(is_black(&f));
        f.bgra.iter_mut().for_each(|b| *b = 200);
        assert!(!is_black(&f));
        let jpeg = encode(&f).unwrap();
        assert_eq!(&jpeg[..2], &[0xFF, 0xD8]);
    }

    #[test]
    fn grabs_the_screen() {
        let f = grab(0, 0, 32, 16).expect("screen copy");
        assert_eq!(f.bgra.len(), 32 * 16 * 4);
    }
}
