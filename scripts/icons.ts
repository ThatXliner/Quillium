/**
 * Renders static/icon.svg to a high-res PNG (via Playwright's Chromium
 * so SVG filters like feDropShadow render correctly), then runs
 * `tauri icon` to generate all platform icon formats.
 */
import { execSync } from "child_process";
import { resolve } from "path";
import { chromium } from "playwright";

const root = resolve(import.meta.dirname, "..");
const svgPath = resolve(root, "static/icon.svg");
const pngPath = resolve(root, "src-tauri/icons/icon.png");

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
await page.goto(`file://${svgPath}`);
await page.screenshot({ path: pngPath, omitBackground: true });
await browser.close();
console.log(`Rendered ${pngPath}`);

execSync(`bunx tauri icon ${pngPath}`, { stdio: "inherit", cwd: root });
