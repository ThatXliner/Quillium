// scripts/generate-licenses.ts
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type LicenseEntry = {
    name: string;
    version: string;
    license: string;
    url?: string;
    ecosystem: "js" | "rust";
};

// ── JS dependencies ───────────────────────────────────────────────
const pkgJson = JSON.parse(readFileSync("package.json", "utf-8"));
const jsDeps: LicenseEntry[] = Object.keys(pkgJson.dependencies ?? {}).flatMap((name) => {
    try {
        const depPkg = JSON.parse(
            readFileSync(join("node_modules", name, "package.json"), "utf-8"),
        );
        const repo = depPkg.repository;
        let url: string | undefined;
        if (typeof repo === "string") {
            url = repo.startsWith("https://") ? repo : `https://github.com/${repo.replace(/^github:/, "")}`;
        } else if (typeof repo === "object" && repo?.url) {
            url = repo.url
                .replace(/^git\+/, "")
                .replace(/^git:\/\//, "https://")
                .replace(/\.git$/, "");
        } else if (depPkg.homepage) {
            url = depPkg.homepage;
        }
        return [
            {
                name: depPkg.name ?? name,
                version: depPkg.version ?? pkgJson.dependencies[name],
                license: depPkg.license ?? "Unknown",
                url,
                ecosystem: "js" as const,
            },
        ];
    } catch {
        // Package not found in node_modules — skip silently.
        return [];
    }
});

// ── Rust dependencies ─────────────────────────────────────────────
// Hardcoded because Cargo.toml has a small, stable set of direct deps
// and cargo-about requires a separate toolchain setup.
const cargoToml = readFileSync("src-tauri/Cargo.toml", "utf-8");

// Parse all dependency sections: [dependencies], [dev-dependencies],
// and [target.'...'.dependencies] (e.g. platform-specific deps).
// Strategy: collect every line that looks like a dep declaration from
// any section that ends with `dependencies]`.
const versionMap: Record<string, string> = {};
const sectionRegex = /\[(?:[^\]]*\.)?(?:dev-)?dependencies\]/g;
const sectionStarts: number[] = [];

for (const m of cargoToml.matchAll(sectionRegex)) {
    sectionStarts.push(m.index + m[0].length);
}

for (const start of sectionStarts) {
    // Find the end of this section (next section header or end of file)
    const nextBracket = cargoToml.indexOf("\n[", start);
    const sectionText = nextBracket === -1 ? cargoToml.slice(start) : cargoToml.slice(start, nextBracket);

    for (const line of sectionText.split("\n")) {
        const simple = line.match(/^(\S+)\s*=\s*"([^"]+)"/);
        if (simple) {
            versionMap[simple[1]] = simple[2];
            continue;
        }
        const table = line.match(/^(\S+)\s*=\s*\{[^}]*version\s*=\s*"([^"]+)"/);
        if (table) versionMap[table[1]] = table[2];
    }
}

const RUST_LICENSES: Record<string, { license: string; url: string }> = {
    tauri:                  { license: "MIT/Apache-2.0", url: "https://github.com/tauri-apps/tauri" },
    "tauri-plugin-opener":  { license: "MIT/Apache-2.0", url: "https://github.com/tauri-apps/plugins-workspace" },
    "tauri-plugin-updater": { license: "MIT/Apache-2.0", url: "https://github.com/tauri-apps/plugins-workspace" },
    "tauri-plugin-process": { license: "MIT/Apache-2.0", url: "https://github.com/tauri-apps/plugins-workspace" },
    serde:                  { license: "MIT/Apache-2.0", url: "https://github.com/serde-rs/serde" },
    serde_json:             { license: "MIT/Apache-2.0", url: "https://github.com/serde-rs/json" },
    keyring:                { license: "MIT",             url: "https://github.com/hwchen/keyring-rs" },
    rusqlite:               { license: "MIT",             url: "https://github.com/rusqlite/rusqlite" },
    uuid:                   { license: "MIT/Apache-2.0", url: "https://github.com/uuid-rs/uuid" },
};

const rustDeps: LicenseEntry[] = Object.keys(versionMap)
    .filter((name) => name in RUST_LICENSES)
    .map((name) => ({
        name,
        version: versionMap[name],
        license: RUST_LICENSES[name].license,
        url: RUST_LICENSES[name].url,
        ecosystem: "rust" as const,
    }));

// ── Merge, sort, write ────────────────────────────────────────────
const all: LicenseEntry[] = [...jsDeps, ...rustDeps].sort((a, b) =>
    a.name.localeCompare(b.name),
);

writeFileSync("static/licenses.json", `${JSON.stringify(all, null, 2)}\n`);
console.log(`Generated static/licenses.json (${all.length} entries)`);
