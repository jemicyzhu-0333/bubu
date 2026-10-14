# Native-view walk artist preview

## Result and scope

This slice uses the existing right-facing production body's own PNG, ears, face and two original foot parts. There is no reflected left-view body, substitute foot art, generated image, new renderer, timer, persistence writer, window change, or native default enablement.

The original bounded gait sampler supplies only relative motion. The adapter maps near/far source-root deltas onto the unchanged native left/right foot rectangles. Native foot alpha bounds reach the native floor at art Y=64, measured independently; the sampler's reference floor 64.5 is not passed into native geometry. Body/ears/face share bodyWorld; foot support remains world-fixed. The original PNG rectangles and pixel bytes stay unchanged.

The production factory defaults to walkPreview=null. The adapter accepts only strict enabled=true. The extra episode input is preview-only: ordinary walking or idle with no action, bare appearance, explicit three-quarter-right or its three-quarter alias, and fully ready native resources. Unsupported actions (including run and moonwalk), outfits, views, transforms and unavailable resources keep the complete old path. Once a resource or compatibility failure disables an episode, it stays disabled until a new episode ID. Existing source cache, readiness subscriptions, palette painter and disposal are reused.

## Minimal API

Instantiate createDangoRasterArtist with its existing manifest, loadImage and createSurface ports, plus walkPreview: { enabled: true }. Await artist.ready(). Resolve artwork with view:'three-quarter-right', state:'walking', motion:'idle', and walkEpisode:{id:'preview-1', progress:0..1}. A paused host repeats exactly the same progress. The episode duration for this preview is 7.2 seconds; it creates no clock.

Use the ordinary artist/form-art back, appearance, cached-body, face, appearance and front passes. The body cache is unchanged and has no phase key. clipBody applies bodyWorld to the live cached-body callback; bodyForeground receives body-local foot matrices, preventing repeated world translation if root fills exist. This native ordinary view currently has no rootJoins; running-variant root joins do not enter this slice.

Reduced motion uses one latched episode position, settles both original feet, disables bob, and holds the whole image while progress changes. Pausing/reduced state and source failures are exercised without enabling the native renderer.

## Main evidence

- standard-artist-native-walk.mp4: 7.2 s, 288 frames, 40 fps, 876×292, original 99 CSS-pixel body design width / 219 CSS-pixel stage. Two cached-path light/dark panels and two direct-path light/dark panels.
- standard-artist-keyframes.png: eight corresponding phases, same display scale.
- capture.mjs: executes the actual production form-art module. Only its artist import is redirected at test time to an injectable artist; relative imports become absolute. No compositing method is rewritten.
- artist-audit.json: form-art source hash, all eight real cached endpoint comparisons, source/cache/disposal counts and limitations.
- native-asset-hashes.json: unchanged production native-view body, ears, feet and neutral face identities.
- footparts-measure.json: actual native PNG dimensions, alpha bounds, unchanged rectangles and Y=64 soles.
- contact-audit.json: isolated standard-artist foot raster comparison during planted intervals across DPR 1 / 1.25 / 1.5 / 2.
- tests.log: 8 source tests plus the focused 10-test actual Canvas integration suite; 18 passed, no failures or skips. Parent owns the final full-tree aggregate run.

## Exactness and remaining limits

Pure artist endpoint tests at DPR 1 / 1.25 / 1.5 / 2 are pixel-exact against the corresponding same-view idle at the same world position. The real form-art cached path is pixel-exact for seven of eight endpoint/DPR combinations. At DPR=2, p=1, combining the reference idle's offX+world into one input translate differs from the adapter's nested transform by one float32 ULP (0.0000152587890625 device pixels). Ten RGBA channels differ, maximum 7/255, on four edge pixels. Four antialiased boundary alpha values change (maximum 7/255), and six RGB channels change (maximum 2/255). Both complete nonzero-alpha and half-alpha masks are identical; occupied bounds, binary contour, components and holes are unchanged. endpoint-alpha-audit.json and the endpoint PNGs preserve this measured precision residual. It is a small raster-precision note, separate from the genuinely missing host integration below. It has not been hidden by rounding or a looser pass threshold, and the claim is not “all form-art endpoints 0diff.”

Cached and direct paths legitimately rasterize the static body differently at fractional origins. Each preserves the same source and verified transform semantics; their full-frame pixels are not claimed equal throughout motion.

runtimeReady=false and host=null remain explicit. The actual pet renderer recognizes walking through state and a looping animation clock, but does not supply a bounded walking episode, world trajectory, episode origin, or final world handoff. It also owns an independent walking bob and higher-priority transforms. Therefore native ordinary walking is not enabled. Removing walkEpisode at the end without transferring the final world origin returns to the old host position; this is an unimplemented host boundary, not an accepted seamless native transition.

This is offscreen Skia evidence. No browser security retry was attempted; no browser/native Windows/macOS/GPU/transparent-window validation is claimed. The original standalone painter video is historical reference, not this adapter's proof.


## Portable reproduction

Requires Node compatible with the repository and the repository's existing @napi-rs/canvas dependency. Video creation uses an existing ffmpeg on PATH. Nothing is installed, and no browser is opened.

    node capture.mjs --repo=/absolute/path/to/bubu --out=/absolute/path/to/evidence
    node audit-contact.mjs --repo=/absolute/path/to/bubu --out=/absolute/path/to/evidence
    node audit-endpoint.mjs --repo=/absolute/path/to/bubu --out=/absolute/path/to/evidence

The output directory contains a generated test-only artist-fixture.mjs. It is not production code. capture imports the repository's current source directly and records the exact form-art hash, so rerunning on a different tree does not silently inherit this tree's acceptance. Static native-asset-hashes.json and the publication seal identify this delivered tree. The per-frame JSON is generated during reproduction but omitted from this compact published bundle.

## Runtime handoff checklist for Bobo

1. Keep production walkPreview disabled until an actual walking host contract exists. Match only ordinary walk; do not route run, moonwalk, carried-prop actions, clothing or unsupported views through this slice.
2. Extract a focused host presentation module instead of adding responsibility to frozen renderer/controller. Use the existing animation clock and supply an explicit walking episode ID, phase, real world origin and bounded trajectory. Pause must freeze the same phase. No second timer or persistence writer is needed.
3. Decide exactly one owner of world travel. The current preview applies bodyWorld inside art space; a native window must not simultaneously move the same distance again. Map any window/DIP travel and DPR into the same art-space frame used by planted feet.
4. Remove only the generic walking bob/transform that the accepted gait owns. Preserve higher-priority interaction/drag/safety transforms and define their interruption behavior. Avoid global behavior changes for other actions.
5. On natural completion transfer the final world position before clearing the episode, so the ordinary idle stays at the arrived location. Define a grounded settling path for mid-swing interruption. The current preview does not implement this host handoff.
6. Use the same source cache readiness window and atomic two-foot fallback. Retain the constant cached-body key and existing palette/face/wardrobe ordering. Test dynamic reduced motion and source loss in the actual host.
7. Run the source, artist and actual form-art cached-path tests, the aggregate suite and then real native/browser/GPU/transparent-window acceptance at DPR 1/1.25/1.5/2. Inspect the small endpoint precision note separately from geometric/topological failures. Enable the runtime gate only after these host-specific checks, without treating offscreen success as native acceptance.
