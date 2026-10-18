# Bubu work and music props

Isolated candidates: keyboard, laptop, microphone, drum. These are existing V1 semantic IDs, not a new prop catalogue. No repository or remote writes.

## Deliverables

- `prototypes/`: per-prop generated concept/standalone views. These are design references only.
- `models/`: real geometry GLBs, with named socket nodes and separate materials.
- `src/prop-models.mjs`: owned factories with idempotent resource disposal. Keys are independently named; laptop screen is independently replaceable.
- `manifest.json`: model bounds, material constraints, sockets and clearance reservation.
- `renders/first-two-contact.png`, `renders/music-contact.png`: real GLB four-view boards.
- `review/*-static.json`: original approved actor body and original source face, with only original hand meshes rigidly rotated and translated. No anatomy reshaping or new action timing.
- `renders/accepted-candidate-*-*/0000.png`: real static actor/prop four-view images. Front means character +Z; laptop outer lid faces that direction.
- `reports/static-geometry-audit.json`: actual triangle surface distances and boundary intersection counts.
- `reports/static-placements.json`: support, position, hand transforms and world envelope.

Keyboard uses a reserved tabletop at y=0.223; laptop uses a lower tabletop y=0.24 and uniform 0.7 model scale. Gray support plates are diagnostic stage proxies, not new final background assets. Drum rests on the baseline ground y=0.006. Microphone has one grip; the other hand intentionally stays free.

## Reproduce

Node modules resolve the existing Three.js installation (no package install performed).

1. `node src/export-models.mjs`
2. `node --test src/test-models.mjs`
3. `blender -b -t 2 -P src/render-models.py`
4. `node src/read-hands.mjs` then `node src/export-static.mjs` then `blender -b -t 2 -P src/optimize-cap-fit.py`
5. `blender -b -t 2 -P src/audit-static.py`
6. `blender -b -t 2 -P src/audit-hand-boundaries.py` then `node --test src/test-static.mjs`
7. `blender -b -t 2 -P src/render_actual.py -- --input review/keyboard-static.json --out renders/final-keyboard-front --angle 0 --samples 16 --size 384 --span 3.3`

Repeat renderer at 0/90/45/180 degrees for each prop. These are Blender CPU renders of exported actual geometry, not native WebGL/OS acceptance. They do not prove all wardrobe combinations, dynamic trajectories or final background integration. Local body/face triangle checks do not certify garment clearance. Low-poly LOD and runtime budget integration remain future integration work.

Superseded mounted/final/rotated/seam render directories are retained as rejected iteration evidence. Only accepted-candidate views and new contact boards are current. Final independent review can still reject a static candidate.

Full cap qualification uses sourceVertexIds=-1 new collar/cap vertices and all vertices of triangles incident to those vertices (185 left / 183 right). Every participating hand is checked; the microphone free hand is intentionally outside that grip test. Small contact-pivot rotations are rigid, scale remains exactly one. The source data and approved actor are external build inputs listed by hash in reports/source-provenance.json; the independent GLB props load without these actor sources.

Candidate delivery is a source directory plus CANDIDATE-ALLOWLIST.json and CANDIDATE-SHA256.json, with no ZIP or remote publication. Failed iterations remain local and are excluded from the allowlist. The CPU static renderer uses a common matte review shader; the GLBs retain the exact material parameters recorded in manifest.json.
