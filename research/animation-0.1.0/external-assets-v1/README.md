# External asset research candidates

小步 only. Proposed placement: `research/animation-0.1.0/external-assets-v1`.

`catalog.json` distinguishes 18 wearable entries (4 existing repository references and 14 new candidates), 39 prop geometry families, and the research stage descriptor. Candidate files are selected current versions, not a declaration of final user approval, production wardrobe integration, complete action choreography, or native desktop acceptance.

The source character is not duplicated. Existing reference and source hashes identify prerequisites; generated character concept imagery is reference only. Superseded generated prototypes, large actor-frame JSON, frame binaries, videos, archives and dependencies are excluded.

## Reproduction prerequisites

Original GLBs and prototype images remain byte-for-byte copies. Runtime/export/audit/test entries documented below now use explicit repository/reference/cache inputs. They require the approved repository source, verified D2 source GLB, hybrid fixture and regenerated old trajectory/tea snapshots. Install Three 0.186.1 and Blender/Python dependencies separately. Validation used an existing local source tree whose 1,352 files and two binary inputs were independently matched to remote commit 67714cb2 by Git blob SHA; it was not a clean git checkout.

The original source GLB SHA256 is `84ec5d8608f21e43bf06df26b8b2f81124909ebb39c77bb9cc153aca17319a3a`; the hybrid SHA256 is `52a080d81606fbe92e9cd71593bd703f356eb50a0e1c74ccc34547a0db308e67`. The existing `original-parts-hybrid-v1` package is unchanged.

## Evidence boundaries

Garden uses only `final-candidate-allowlist.json` v2 entries; the old watering can is excluded. Comfort, work, fantasy and background final research candidates are included. Comfort adds handheld tissue-sheet and telescope variants without adding geometry families. The energy-token family now contains the revised V1 golden energy crystal; the withdrawn coin prototype/model and failed review images are excluded. Paper/pencil retains the recorded right hand boundary diagnostic; no claim of full burial is made. Other source reports describe their own sampled or static checks, not continuous collision or native runtime validation.

## Rights

See `notices/`. Project code licensing does not establish character or artwork rights. Publication permission and final visual acceptance are separate decisions.

## Verified representative reproduction

The following entries are supported in this staged revision. `$REPO` is a checkout of the previously committed bubu repository. `$REF` is a checkout containing the canonical D2 gzip artifact at its existing repository-relative path (it may equal `$REPO`). `$CACHE` is a fresh writable directory outside both checkouts. `$PKG` is this package. Install the pinned dependency with `npm install --prefix "$PKG"`; cache preparation links its explicit dependency directory without vendoring it; Python needs NumPy, and current mount auditing needs Blender 4.3.2. No source model is downloaded or duplicated per group.

1. `python "$PKG/shared/prepare-cache.py" --repo-root "$REPO" --reference-root "$REF" --cache-root "$CACHE" --node-modules-root "$PKG/node_modules"`
2. `node "$CACHE/research/animation-0.1.0/original-parts-hybrid-v1/integration/actual-pointer-regression.mjs" --research-root "$CACHE/research/animation-0.1.0" --output "$CACHE/pointer" --scenario drag --numeric-only`
3. `node "$PKG/accessory-expansion/src/test_and_export.mjs" --repo-root "$REPO" --reference-root "$CACHE" --cache-root "$CACHE" --static-only`
4. `python "$PKG/shared/check-leisure.py" --repo-root "$REPO" --reference-root "$CACHE" --cache-root "$CACHE"`
5. `python "$PKG/shared/verify-evidence.py" --proof "$CACHE/leisure-props/reports/current-evidence.json"`

The representative pipeline first rebuilds all five leisure GLBs and requires exact candidate SHA matches, then generates mounted meshes, reruns the actual Blender audit, binds current inputs and asserts. Changing a mounted actor vertex while retaining the prior green audit is rejected. Generated frame JSON and geometry binaries stay in the cache, outside the publication allowlist. Historical `test-static-mounts.mjs` cached-report checks are insufficient and are not the recommended acceptance entry.

For exact boots reconstruction:

1. `python "$PKG/shared/export-foot-inputs.py" --repo-root "$REPO" --out "$CACHE/feet"`
2. `python "$PKG/accessory-expansion/src/build_boots.py" --foot-root "$CACHE/feet" --output-root "$CACHE/boots-rebuild"`

The foot inputs are extracted from the verified committed hybrid GLB. Rebuilt boots must match candidate SHA `27c5772fb961b7f3e9cd09ea07d7678725e328cf96eb33b869bee3d30c253b5c`.

The old full drag/longpress numeric trajectory exporter can run with `--scenario drag,longpress --numeric-only`; it records old host motion, not newly authored actions. Removing `--static-only` from the accessory exporter requires both generated trajectories. The existing tea package has controller/inputs but no full rendering exporter; the recovered pure exporters below now provide that cache-only step, with measured 271-frame parity. The documented group entries below now use explicit paths. Existing-four wrappers receive adapter dependencies by injection; their original GLBs remain repository references only. Satchel/scarf have nonzero and partly visible tea crossing seams, recorded in existing-wearables/CONTACT-LIMITS.md.


## Verified old tea export regeneration

These commands use the same prepared `$CACHE` as above. Python additionally needs SciPy. They do not design new action timing.

1. `python "$PKG/shared/export-foot-inputs.py" --repo-root "$REPO" --out "$CACHE/hybrid-inputs" --all-parts`
2. `node "$PKG/shared/tea/export-samples.mjs" --repo-root "$REPO" --reference-root "$CACHE" --cache-root "$CACHE"`
3. `node "$PKG/shared/tea/export-face-sequence.mjs" --repo-root "$REPO" --reference-root "$CACHE" --cache-root "$CACHE"`
4. `python "$PKG/shared/tea/build-render-input.py" --reference-root "$CACHE" --cache-root "$CACHE"`
5. `python "$PKG/accessory-expansion/src/audit_tea.py" --cache-root "$CACHE"` (16 keyframes; add `--full` for 271 discrete frames)

Rebuilt arrays were compared to the prior reference export: 5,691 position/normal arrays matched byte-for-byte across 271 frames, as did shared topology/colors and controller samples. This is reproducibility evidence, not continuous collision, cloth simulation, full wardrobe compatibility or native GPU acceptance.

All 55 included GLBs are verified by `python shared/verify-candidate.py`: 14 new wearables, 39 prop geometry families and 2 handheld variants. The 4 existing wearable GLBs are referenced without duplication. Background descriptors retain their 2D screen-space assets and do not imply a 3D environment or GPU validation.


## Expanded fresh checks

After the prepared source cache, halo-static export and old tea regeneration above:

- `python "$PKG/shared/check-basic-props.py" --repo-root "$REPO" --reference-root "$CACHE" --cache-root "$CACHE"`
- `python "$PKG/shared/check-prop-groups.py" --repo-root "$REPO" --reference-root "$CACHE" --cache-root "$CACHE"`
- `python "$PKG/shared/check-work-garden.py" --group work-props --repo-root "$REPO" --reference-root "$CACHE" --cache-root "$CACHE"`
- Repeat the previous command with `--group garden-props`.

These pipelines rebuild candidate GLBs byte-identically, generate actual mounted geometry, recompute audits, bind geometry/source/script/report SHA values, and assert current results. Verification rejects changed mounted geometry even if an old green report remains. Comfort includes two handheld variants; play includes the golden crystal and repeated instances; garden uses the final fixed watering-can and shaft-depth placements. Basic paper/pencil retains 19 positive right-hand boundary points (maximum signed distance approximately 0.01350694); its static contact pass is not a full hand-cap burial claim.

For all existing-four/headwear-seven/themed-four CPU hosts, use the explicit entries in each group's PORTABILITY.md. Full old drag271 + longpress1891 host replay and discrete tea271 checks were repeated. Headwear/themed tea crossings were zero; existing satchel/scarf retain the published seam limitations. Replays certify the measured old CPU host paths only.

Optional accessory pointer-clearance and motion-review utilities require actual mesh/face exports from `actual-pointer-regression.mjs --windows-only` or `--full-export`; numeric-only trajectories are insufficient and fail closed. This expanded run did not regenerate those large pointer mesh frames or new review images. The three uncalled archive-only finalizer exits are excluded from this candidate; use fresh check scripts and preserve prior reports as provenance. Authoring/render utilities require their explicitly documented model/reference/render inputs; do not run authoring generation over frozen candidate assets.


## Wearable evidence matrix

| Scope | Canonical policy mapping | Full old drag / longpress replay in this staging run | Tea evidence in this staging run |
| --- | ---: | --- | --- |
| Existing original wearables | 4 | 4: 271 / 1891 frames | 271 frames; satchel/scarf seams retained |
| Headwear expansion | 7 | 7: 271 / 1891 frames | 271 frames; zero sampled crossings |
| Themed accessories | 4 | 4: 271 / 1891 frames | 271 frames; zero sampled crossings |
| Basic halo/boots/cape | 3 | 3: 271 / 1891 frames; model/lifecycle/coordinates also checked | 271 frames: cape versus visible hands/cup only |
| Total | 18 | 18 full old-host replays | Distinct collision scopes; no blanket all-pair clearance claim |

Optional pointer mesh regeneration (not executed in this staging pass):

`node "$CACHE/research/animation-0.1.0/original-parts-hybrid-v1/integration/actual-pointer-regression.mjs" --research-root "$CACHE/research/animation-0.1.0" --output "$CACHE/pointer-mesh" --scenario drag,longpress --windows-only`

Replace `--windows-only` with `--full-export` for all2162 frames. Do not combine either with `--numeric-only`. Then pass `--pointer-root "$CACHE/pointer-mesh" --reference-root "$CACHE" --cache-root "$CACHE"` to accessory `audit_pointer_clearance.py` / `prepare_motion_review.py`. Full export writes positions+normals (24 bytes per exported vertex per frame), plus mouth diffuse data and topology/manifests. At100,000 exported vertices this is about5.19GB for2162 frames, before JSON overhead; this is a sizing example, not a measured run. Window output is smaller (historically142+218 sampled frames). Reserve adequate cache disk; never include generated binaries in the publication payload.


## Physical mounting correction candidate

Ear-side anchors and continuous effects, supported garment shapes, compact fin visibility, open shoe rims, the separate round tail, readable book orientation and ground supports have been revised. Representative actual CPU-rendered views and scoped tests accompany the source.

Bag/scarf palm-edge crossings during early tea motion remain unresolved. Static tail/cloth edge checks and chain-tail proxy checks do not establish complete cloth/contact collision. This candidate is separate from the experimental animation foundation and is not admitted to production, main or a release.
