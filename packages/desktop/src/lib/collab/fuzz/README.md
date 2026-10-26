# Long collaboration fuzz tests

This directory holds opt-in convergence stress tests. The regular test suite
uses bounded property tests in
[`tests/lib/collab/convergence-projection.test.ts`](../../../../tests/lib/collab/convergence-projection.test.ts).

`convergence.fuzz.test.ts` applies seeded text and annotation operations across
two connected peers. It compares text, Yjs state, and CodeMirror projections at
checkpoints and at completion. Peers settle after each operation.

Run from the repository root:

```bash
bun run desktop:test:collab-fuzz
```

The default is 10,000 operations with checks every 100 operations. Override the
seed, operation count, or checkpoint interval to investigate a failure:

```bash
COLLAB_FUZZ_SEED=12345 COLLAB_FUZZ_OPERATIONS=20000 \
  COLLAB_FUZZ_CHECKPOINT_INTERVAL=100 bun run desktop:test:collab-fuzz
```

Keep the explicit `COLLAB_FUZZ=1` gate on long suites. The script sets it; the
`*.fuzz.test.ts` suffix alone does not skip a test. Ordinary regression tests
belong in the regular test directories. This suite covers convergence, not
cross-peer undo, native persistence, or two-device interaction.
