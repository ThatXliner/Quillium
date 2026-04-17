# PostHog Session Replay CSS Fix for Tauri Apps

## The Problem

PostHog session replays in Tauri desktop apps render with **no CSS** — the replay shows unstyled HTML while the actual user experience is perfectly fine.

### Root Cause

1. **Tauri serves app assets via `tauri://localhost`**, a custom protocol scheme.
2. **PostHog uses rrweb** under the hood for session replay. During recording, rrweb takes a DOM snapshot and tries to inline all CSS by reading `stylesheet.cssRules`.
3. **Browsers treat `tauri://` as cross-origin**, so accessing `stylesheet.cssRules` throws a `DOMException: CSSStyleSheet.cssRules getter: Not allowed to access cross-origin stylesheet`.
4. **rrweb's fallback fails silently** — for `<link>` stylesheets, when `cssRules` access throws, rrweb keeps the original `href` (e.g. `tauri://localhost/_app/immutable/assets/...`). But PostHog's replay server can't fetch `tauri://` URLs, so the CSS is simply lost.
5. There is **no fetch-based fallback** in PostHog's rrweb fork (`@posthog/rrweb-record@^0.0.47`) — confirmed by searching the recorder source for XHR/fetch calls related to CSS.

### What Users See

- Session replays look completely unstyled (raw HTML layout)
- Console errors in the replay: `"[Editor] Failed to replay event"` (these may be app-specific, not rrweb)
- The actual user never sees any issue — CSS renders perfectly in the Tauri WebView

### Affected Platforms

- **Tauri v1 and v2** (both use `tauri://localhost`)
- **Electron** apps using custom protocol schemes (same `cssRules` CORS issue)
- Any app serving assets via a non-HTTP custom protocol

## The Fix

Set `crossOrigin = "anonymous"` on all `<link rel="stylesheet">` elements **before** PostHog's recorder takes its first DOM snapshot. This tells the browser to allow `cssRules` access, which lets rrweb successfully inline the CSS.

### Why This Works

PostHog's [troubleshooting docs](https://posthog.com/docs/session-replay/troubleshooting) already mention that `crossorigin="anonymous"` is needed for cross-origin CDN stylesheets. The same fix applies to Tauri's custom protocol — the browser doesn't distinguish between "cross-origin because different domain" and "cross-origin because custom protocol scheme."

Setting `crossOrigin = "anonymous"` on a `<link>` element causes the browser to re-fetch the stylesheet with CORS headers. Since Tauri's custom protocol handler serves the files locally (no actual network request), this is essentially free — no performance cost, no security implications.

### Implementation

```typescript
/**
 * Tauri serves assets via `tauri://localhost`, a custom protocol that browsers
 * treat as cross-origin. This prevents rrweb (PostHog's session replay engine)
 * from reading `stylesheet.cssRules` — so CSS is missing in replays.
 *
 * Fix: set `crossOrigin` on all `<link rel="stylesheet">` elements before
 * the recorder takes its first DOM snapshot. Also observe future additions
 * for dynamically injected stylesheets (e.g. from SvelteKit's HMR/code-split).
 */
function patchStylesheetCORS() {
    document
        .querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')
        .forEach((link) => {
            if (!link.crossOrigin) link.crossOrigin = "anonymous";
        });

    new MutationObserver((mutations) => {
        for (const m of mutations) {
            for (const node of m.addedNodes) {
                if (
                    node instanceof HTMLLinkElement &&
                    node.rel === "stylesheet" &&
                    !node.crossOrigin
                ) {
                    node.crossOrigin = "anonymous";
                }
            }
        }
    }).observe(document.head, { childList: true });
}
```

**Call `patchStylesheetCORS()` before `posthog.init()`:**

```typescript
if (!dev && PUBLIC_POSTHOG_KEY && PUBLIC_POSTHOG_HOST) {
    patchStylesheetCORS();
    posthog.init(PUBLIC_POSTHOG_KEY, {
        // ... your config
    });
}
```

### Why the MutationObserver?

Frameworks like SvelteKit, Next.js, and Nuxt dynamically inject `<link>` tags via code-splitting. Without the observer, stylesheets added after the initial page load won't get the `crossOrigin` attribute, and any CSS from lazy-loaded routes/components will be missing in replays.

## Key Technical Details (for the docs PR)

### rrweb's CSS Capture Flow

In PostHog's rrweb fork (`recorder-v2.js`), the CSS capture for `<link>` elements works like this:

```
1. Find <link rel="stylesheet"> element
2. Access element.sheet (the CSSStyleSheet object)
3. Try to read sheet.cssRules
4. If successful: serialize all rules into a _cssText string, remove href
5. If cssRules throws (CORS): keep the href, hope the replay server can fetch it
```

Step 5 is where Tauri apps break — the replay server can't fetch `tauri://localhost/...` URLs.

### Why CSS Sometimes Reappears Mid-Replay (Without the Fix)

You may notice that CSS is missing at the start of a replay but appears ~5 minutes in. Here's why:

**rrweb has a stylesheet load listener** — but it's bypassed in Tauri. When serializing a `<link>` element, rrweb checks `element.sheet`. If it's `null` (stylesheet not loaded yet), it sets up a `load` event listener to re-serialize once loaded. But in Tauri, `element.sheet` is **not null** — the stylesheet *is* loaded, just CORS-blocked. So the listener is never set up.

**The 5-minute full re-snapshot** (`full_snapshot_interval_millis = 300000`) re-serializes the entire DOM. On macOS (WKWebView/WebKit), the CORS restriction on `cssRules` appears to be **relaxed after the page is fully loaded and idle** — a WebKit-specific quirk where the initial strict security context softens. So the re-snapshot succeeds where the first one failed.

**This is platform-dependent:**
- **macOS (WKWebView/WebKit)**: CSS reappears after the first re-snapshot (~5 min). WebKit has historically been more relaxed about same-origin policy for local/custom protocols.
- **Windows (WebView2/Chromium)**: CSS likely **never** reappears. Chrome 64+ strictly treats each custom protocol URL as a unique origin, with no relaxation over time.

This means Windows users may have **permanently broken CSS** in all their session replays, while macOS users only lose CSS for the first ~5 minutes. The `crossOrigin = "anonymous"` fix resolves both platforms from the first snapshot.

### No Fetch Fallback

The original [rrweb-snapshot#45](https://github.com/rrweb-io/rrweb-snapshot/issues/45) issue (2020) proposed using XHR to fetch CSS when `cssRules` access fails. This was reportedly fixed, but PostHog's fork (`@posthog/rrweb-record@^0.0.47`) does **not** include a fetch fallback — confirmed by searching the bundled recorder for fetch/XHR patterns around CSS handling.

### Relevant Source Locations

PostHog's recorder CSS capture logic (minified, from `node_modules/posthog-js/dist/recorder-v2.js`):

```javascript
// For <style> tags: try to read cssRules from parent's sheet
try {
    e.nextSibling || e.previousSibling || (null == (r = a.sheet) ? void 0 : r.cssRules) && (l = w(a.sheet))
} catch(t) {
    console.warn("Cannot get CSS styles from text's parentNode. Error: " + t, e)
}

// For <link> tags: try to read cssRules, inline as _cssText
M && (B = w(M));  // w() reads cssRules
B && (delete y.rel, delete y.href, y._cssText = B)
// If B is null (cssRules failed), href is kept → unreachable tauri:// URL
```

## References

- **PostHog troubleshooting docs** (mentions crossorigin for CDN stylesheets): https://posthog.com/docs/session-replay/troubleshooting
- **rrweb-snapshot CORS issue**: https://github.com/rrweb-io/rrweb-snapshot/issues/45
- **PostHog rrweb fork**: https://github.com/PostHog/posthog-rrweb
- **Tauri CORS issues**: https://github.com/tauri-apps/tauri/issues/8339
- **Our commit implementing this fix**: `9bec570` in ThatXliner/Quillium

## Suggested Docs PR Scope

Add a new section to `contents/docs/session-replay/troubleshooting.mdx` in the [posthog.com repo](https://github.com/PostHog/posthog.com):

### Section Title
"CSS missing in Tauri or Electron desktop apps"

### Content to Add
- Explain the custom protocol → CORS → `cssRules` failure chain
- Provide the `patchStylesheetCORS()` snippet
- Note the MutationObserver for SPA frameworks
- Mention this applies to any custom protocol scheme, not just Tauri

### Where to Add
After the existing "Styles are missing from my recordings" section, which already covers the `crossorigin` attribute for CDN stylesheets. The Tauri/Electron section is a natural extension of that existing guidance.
