fn main() {
    // The MCP bridge capability lives in capabilities/dev/ and must only be
    // compiled into dev builds. Capability files are auto-discovered by glob, so
    // we widen the glob to include capabilities/dev/ ONLY when the `mcp-bridge`
    // feature is enabled (set by `bun run tauri:dev:mcp`). Production `tauri build`
    // runs without the feature → the default top-level glob is used → the dev
    // capability is never read and cannot trip an unknown-permission error.
    // Tauri's default scan is recursive (capabilities/**/*.json), which would pick
    // up capabilities/dev/ even in production. So we set the glob explicitly in both
    // branches: production sees only the top-level files; dev additionally sees dev/.
    #[cfg(feature = "mcp-bridge")]
    let pattern = "./capabilities/**/*.json";
    #[cfg(not(feature = "mcp-bridge"))]
    let pattern = "./capabilities/*.json";

    let attrs = tauri_build::Attributes::new().capabilities_path_pattern(pattern);
    tauri_build::try_build(attrs).expect("failed to run tauri build script");
}
