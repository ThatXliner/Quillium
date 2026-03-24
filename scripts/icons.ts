/**
 * Generates all platform icon formats from the source icon PNG.
 *
 * Source of truth: src-tauri/icons/Quillium.png
 * (Hand-crafted; SVG filter rendering varies across tools,
 *  so we use a pre-rendered PNG instead of icon.svg.)
 */
import { execSync } from "child_process";
import { resolve } from "path";

const root = resolve(import.meta.dirname, "..");
const srcIcon = resolve(root, "src-tauri/icons/Quillium.png");

execSync(`bunx tauri icon ${srcIcon}`, { stdio: "inherit", cwd: root });
