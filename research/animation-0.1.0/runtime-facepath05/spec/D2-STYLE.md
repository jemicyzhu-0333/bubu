# D2 explicitly selected style capability

CPU/runtime candidate, 2026-10-17. Base: weighted-owner runtime (9d987939), with its canonical P1 sibling. Existing seven-slot and full18 defaults, canonical geometry, poses, morphs, old assets and production policies remain unchanged. No body/pointer vendored tree is updated by this candidate.

## Selection and exact identities

Use `prepareD2FacePack` with `fixtures/face-d2/`. Purpose/kind is `approved-full-face-d2-opt-in`, binding `fixed-eighteen-slot-d2-opt-in`. Select it explicitly; neither existing preparation entry point accepts it. P0 policies and P1 binding accept only this exact source/profile pair in addition to their existing registrations. Every actor validates policy against its admitted pack before load/reservation. Original P1 ADMISSION remains unchanged; no scheduler algorithm or production weights were changed.

- GLB SHA256: 84ec5d8608f21e43bf06df26b8b2f81124909ebb39c77bb9cc153aca17319a3a
- Profile SHA256: 9b282a72282245add92f65d85ffb15e1d67e6a4a4f5706c554cddc23f591ab02
- Mask float32 SHA256: 51b61efd1157e81dfe82d01d07c02b99c76aa4adc4dc48319e6ac81802e5febd

The body-only art variant changes 1,111 body COLOR_0 vertices. Everything outside that accessor byte range, including JSON, all morph targets, rig and original mouth material, is byte-identical to the gold library. Its audit is copied under d2-evidence/. This is static blush, not an expression-intensity blush system.

## Fixed N3 cavity patch

The shared source mouth material is also used by eyes and must never be recolored globally. On D2 source creation, after exact source parity verification and before publishing the cache lease, one owned deep copy of mouth geometry receives a frozen 704-float mask attribute. Its source parser geometry is replaced and disposed, without mutating original arrays. This style source has its own hash/cache identity. Later actors share that immutable geometry. Old gold actors never receive the mask.

Each actor clones only its mouth material and owns one private gate uniform. One pinned Three 0.186.1 shader patch passes the static mask as a vertex varying, then after color_fragment adds `vec3(.027,.004,.006) * .66 * gate * mask` to linear diffuseColor.rgb. It is additive, not multiplication of the near-black source. Roughness, specular, base material color, opacity, tongue and all other layers remain unchanged. All 64 outer rim mask vertices are exactly zero. This is one fixed patch, not a shader DSL.

The sole existing face writer sets gate from the current clock output: N3 uses smoothstep(.375, 1, amount), all other 17 IDs and Basis use exactly zero. There is no second clock. Interrupted withdrawal follows actual decreasing amount; retire/reset/hidden interaction and disposal return the uniform to zero. Same shader program cache key is safe because each material has its own uniform object. Disposal releases each actor material once, then the last source lease releases source geometry once. Compile-chunk mismatches throw; a failure inside the owner draw path fail-stops and releases owned resources.

## Resources and evidence limits

GLB bytes and structural geometry counts remain identical to full18. Base decoded reservation 38,211,404 plus transient mouth deep-copy 2,471,680 plus static mask 2,816 gives 40,685,900 bytes charged once per source before parsing. Final reachable source geometry is 21,002,000 bytes. Actor material/uniform objects are not geometry arrays and remain outside this pre-existing typed-array accounting; this is not a total JS heap or VRAM ceiling. No per-actor mouth geometry copies occur. Default deformation budget still admits one full18 actor; two-actor tests explicitly use 1,568,280 units.

Runtime regression 333/333; canonical P1 regression 26/26. Real Three data tests cover all 18 semantics, gate thresholds, all-layer original binding, actual-clock interruption, Basis/reset/retirement, per-actor material/uniform isolation, old-source isolation, final lease disposal, exact mask hash, black rim, budget-minus-one refusal, cross-profile rejection, simulated context/visibility restoration and shader-patch failure through owner draw. Pinned ShaderLib strings are patched in CPU tests; that is not GPU shader compilation.

One warmup + five shared-cloud CPU samples: median prepare 92.89 ms, cold create/parity/style preparation 211.31 ms, shared-source clone 1.00 ms, disposal 0.11 ms. Raw reports: D2-CPU-MEASUREMENTS.json. These are observations, not performance guarantees; geometry staging and renderer driver behavior were not measured.

No actual GPU rendering, shader compilation, transition appearance, real browser context restoration or pointer integration has been certified. A rendered workbench must explicitly select this style and verify the warm cavity stays local while transitioning. Historical drag/body/pointer copies must be coordinated rather than silently overwritten.
