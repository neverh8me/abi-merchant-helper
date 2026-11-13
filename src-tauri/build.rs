fn main() {
    // The start screen (shell/) uses the same daisyUI file as the page; one copy is kept in git (lib/daisyui).
    println!("cargo:rerun-if-changed=../lib/daisyui/daisyui.css");
    for f in ["daisyui.css", "abi-theme.css"] {
        std::fs::copy(format!("../lib/daisyui/{f}"), format!("shell/{f}")).expect("copy daisyUI");
    }
    tauri_build::build()
}
