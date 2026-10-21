# Bind frontend updates to one native release and activate on cold launch

Public desktop builds may load signed frontend assets without replacing the
native binary. A commit-pinned `tauri-plugin-hot-update` fork supplies acquisition,
verification, persisted trials, and recovery. Quillium owns local readiness,
window coordination, and the presentation-only publication policy. MAS and
mobile builds use their existing distribution paths.

A signed manifest must match the application, channel, persisted format, native
package version, and exact native source revision. Frontend versions have their
own ordering within that identity. A new native release gets a separate store
namespace, so a newer frontend number cannot authorize older native commands or
persisted codecs. This preserves the event-log and lossless-undo contracts in
ADRs 0001 and 0006.

Each process selects one complete asset source before creating windows. A
download only stages assets. Activation requires a later full launch, with its
trial marker saved before serving. Local database load and replay, a rendered
shell, and installed restart listeners confirm the trial. Two missed
confirmations restore the previous confirmed source and suppress the failed
archive hash. Corrupt initialized state preserves its bytes and disables OTA
until offline repair. The embedded frontend remains available.

Relaunch and native installation first freeze every open editor, flush nested
state and persistence, and wait for native acknowledgements from the captured
window roster. A failed or missing acknowledgement cancels the operation.
An active collaboration session vetoes preparation because local persistence
cannot prove all remote changes have drained. This preserves parent authority
and the ephemeral collaboration model in ADRs 0004 and 0008.

Cold launches avoid serving different frontend generations across windows.
Exact native identity and a presentation-only release lane limit rollback
compatibility risk. They intentionally trade update breadth for a small first
shipping contract. Svelte changes still require review for new persisted writes;
path checks alone cannot prove semantic compatibility.

See [the release runbook](../../packages/desktop/scripts/frontend-ota-release.md)
and [evaluation evidence](../frontend-ota.md). Production rollout also requires
packaged verification on every supported platform.

The plugin source lives in [the fork](https://github.com/ThatXliner/tauri-plugin-hot-update); Quillium retains a Cargo Git
dependency pinned to a full commit SHA. The signer is built from the plugin pin
in the targeted native release, even after the policy branch moves to a newer
pin. Portable fixes are proposed in [upstream PR #2](https://github.com/yanqianglu/tauri-plugin-hot-update/pull/2).
