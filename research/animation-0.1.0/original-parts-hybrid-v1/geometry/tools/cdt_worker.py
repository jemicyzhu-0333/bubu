import json, sys
from mathutils import Vector
from mathutils.geometry import delaunay_2d_cdt

args = sys.argv[sys.argv.index("--") + 1 :]
data = json.load(open(args[0]))
out = []
for item in data:
    v = item["vertices"]
    n = item["boundary_count"]
    edges = [(i, (i + 1) % n) for i in range(n)]
    face = list(range(n))
    area = sum(
        v[i][0] * v[(i + 1) % n][1] - v[i][1] * v[(i + 1) % n][0] for i in range(n)
    )
    if area < 0:
        face.reverse()
    vs, es, fs, ov, oe, of = delaunay_2d_cdt(
        [Vector(p) for p in v], edges, [face], 1, 1e-9, True
    )
    fs = [f for f, orig in zip(fs, of) if 0 in orig]
    out.append(
        {
            "vertices": [list(v) for v in vs],
            "faces": fs,
            "original_vertices": [list(i) for i in ov],
        }
    )
json.dump(out, open(args[1], "w"))
