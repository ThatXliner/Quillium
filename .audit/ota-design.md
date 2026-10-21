# Selected OTA implementation

Candidates A and B independently converged on a hardened local upstream plugin, a Quillium-owned coordinator, and frontend publication tooling. The independent judge selected B for configure-once trust and immutable activation. A contributes process-held store locking and a concrete packaged verification matrix. The initial implementation placed the plugin in Quillium. The user later chose [a commit-pinned fork](https://github.com/ThatXliner/tauri-plugin-hot-update) to keep plugin maintenance outside this repository. The plugin has no dependency on Quillium or the Bun workspace.

The release manifest carries contract {applicationId,channel,stateFormat} and exact baseVersion. Native code supplies these expectations. State is namespaced by this identity and native base; frontend ordering never grants native compatibility. Corrupt initialized state disables OTA without overwriting the evidence. No JavaScript permissions are granted for plugin ready/reset/apply. Quillium alone confirms local health and performs the all-window restart barrier.

Claude was asked to design the UI but its session quota prevented output. The implementation reuses the existing banner. No production key or release is created by this work.
