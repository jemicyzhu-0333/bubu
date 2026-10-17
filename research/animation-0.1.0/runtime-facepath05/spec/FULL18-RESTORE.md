# Full18 checkout restoration

The runtime remains in its original directory. The 16,867,596-byte approved GLB is reconstructed locally from the already committed lossless gzip at `../expression-library/approved-v1/shared-library/bubu-expression-library-v1.glb.gz`; it is not duplicated in this commit. The gzip is 10,914,547 bytes, SHA256 `be39c3c61184c8470182855bfc62885feb478998bacfa2a0f8d9f3a3645f22ee`.

From repository root:

```sh
cd research/animation-0.1.0/runtime-facepath05
npm run restore:full18
sha256sum -c FULL18-SHA256SUMS
npm ci --ignore-scripts
npm test
node tools/benchmark-full18.mjs
```

The materializer verifies compressed and expanded sizes and hashes, uses bounded streaming decompression and atomic replacement, and rechecks an existing output. Missing/corrupt archives and wrong existing outputs fail closed. It needs Python 3 standard library only, no network or absolute workspace paths. The reconstructed GLB is intentionally gitignored. Run restoration before tests or loading the full18 fixture. The original seven-slot fixture and default entry point are unchanged.

This is an opt-in CPU/API capability candidate. No actual GPU, WebGL restoration, input latency or transition appearance approval is implied.
