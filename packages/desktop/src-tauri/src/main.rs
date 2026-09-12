// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let arguments = std::env::args().collect::<Vec<_>>();
    if arguments.iter().any(|argument| argument == "--mcp") {
        if let Err(problem) = quillium_lib::mcp::run(&arguments) {
            eprintln!("[mcp] {problem}");
            std::process::exit(1);
        }
        return;
    }
    quillium_lib::run();
}
