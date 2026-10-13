# V7 continuous source-contact pose: front hiccup

Candidate only, runtimeReady=false. Both hands use the finalized single-source forearm+palm layers from hold-production/v7-front-hiccup-pose/frames.json. Each 66×72 logical canvas is drawn directly at origin(0,0): no second scale, no runtime rotation/stretch, no generic arm in the back pass. Canonical body and cup files/placements remain unchanged. Foreground opacity/coversPaw rules are retained.

## Evidence

- Left fixed S=(4.5,45.5), P=(12.346256,46.071392). Authored cut width7.593585, direct hidden continuation length7.867034. All103 positive-axis conservative raster cells are inside canonical body; no exposed/unknown cell. Full cut sampled at <=.125 art-unit spacing is inside body.
- Right fixed S=(61.5,45.5), P=(54.289449,46.071392). Cut width7.582534, continuation length7.233156. All94 conservative cells covered; no exposed/unknown/cut-outside samples.
- Coverage envelope uses the true cut width/2 plus .707 cell-intersection allowance; it does not synthesize pixels. Only existing nonpositive proximal-root halfspace permission is excluded. No positive-axis material is clipped or hidden by repainting body.
- Ideal source boundaries register exactly at left(23.25,48.375), right(44,48.375), normals +x/−x. Actual contact-row raster edge is left23 (gap .25 to white boundary), right44 (gap0). Neither crosses into cup white. Right remains outer-edge contact, not old handle-axis grasp42.5.
- Left/right89/84 opaque pixels, each one4-connected component, exact approved4-color palette, binaryalpha. Both supplied8× exports independently equal exact nearest-neighbor expansion.
- Actual 8× inspection shows continuous fore-to-palm upper/lower source contours and no separate wrist ring or disconnected joint patch. The earlier left exterior-arm stair steps disappear because the old generic arm is fully replaced. Proximal source cut sits inside body; it is an open source transition rather than a closed outlined cap. This is a visual candidate finding, not automatic aesthetic approval.

## Temporal scope

All257 p=i/256 samples use the same declared pose, cup(22,38), and opacity1. There are no chain selections, hidden-shoulder jumps or source switches. Existing whole-body hiccup motion remains applied by the actual artist. Static .25/.5/.85, full257 PNG sequence and257-frame6.5s APNG are included. Dense sampling does not certify every native-host subframe raster position; Skia offscreen rendering is not native OS acceptance.

## Files

- static-before-new-1x.png / -2x.png: original vs source-pose three phases
- actual-body-8x.png: contour/source registration inspection
- hiccup/000.png..256.png, hiccup-playback.apng
- sequence-data.json: source fingerprints, S/P/width, exact coverage cells, all frames
- pixel-verification.json: independent palette/alpha/8×/contact-edge checks
- tests.log:13/13 pass, including no back generic arm, foreground opacity/coverage, fixed shoulders, preprojected origins, full-width coverage, unchanged cup, source continuity and acceptance guards

No production files modified. Acceptance remains pending parent visual review. This is an explicit action-specific source-contact layer; it does not make the original generic v2 IK package production-ready.
