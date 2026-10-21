import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function frontendOtaPluginSource(manifest) {
    const cargo = Bun.TOML.parse(manifest);
    const name = "tauri-plugin-hot-update";
    const declarations = [
        cargo.dependencies?.[name],
        ...Object.values(cargo.target ?? {}).map((target) => target.dependencies?.[name]),
    ].filter((dependency) => dependency !== undefined);
    if (declarations.length !== 1)
        throw new Error("Declare exactly one native frontend OTA plugin dependency");
    const dependency = declarations[0];
    if (
        typeof dependency !== "object" ||
        dependency === null ||
        typeof dependency.git !== "string" ||
        !/^[0-9a-f]{40}$/.test(dependency.rev ?? "") ||
        dependency.path !== undefined ||
        dependency.branch !== undefined ||
        dependency.tag !== undefined
    )
        throw new Error("Frontend OTA plugin must use a Git URL and full commit revision");
    const url = new URL(dependency.git);
    const repository = url.pathname.match(/^\/([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
    if (
        url.protocol !== "https:" ||
        url.hostname !== "github.com" ||
        url.port ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        !repository
    )
        throw new Error("Frontend OTA plugin must use a public HTTPS GitHub repository URL");
    return {
        url: dependency.git,
        repository: `${repository[1]}/${repository[2]}`,
        revision: dependency.rev,
    };
}

export function configuredFrontendOtaPlugin() {
    return frontendOtaPluginSource(
        readFileSync(new URL("../src-tauri/Cargo.toml", import.meta.url), "utf8"),
    );
}

if (import.meta.main) {
    let source;
    if (process.argv.length === 2) source = configuredFrontendOtaPlugin();
    else {
        const [flag, nativeSha] = process.argv.slice(2);
        if (
            process.argv.length !== 4 ||
            flag !== "--native-sha" ||
            !/^[0-9a-f]{40}$/.test(nativeSha ?? "")
        )
            throw new Error("Use --native-sha with the full native release commit");
        source = frontendOtaPluginSource(
            execFileSync("git", ["show", `${nativeSha}:packages/desktop/src-tauri/Cargo.toml`], {
                cwd: fileURLToPath(new URL("../../../", import.meta.url)),
                encoding: "utf8",
            }),
        );
    }
    process.stdout.write(`repository=${source.repository}\nrevision=${source.revision}\n`);
}
