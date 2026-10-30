"""Private coupled-cloth discretization; frozen source arrays are read-only.

The same sparse affine map owns collision and displayed vertices. All existing
material points, cells, masses, supports and centroid relationships are retained.
No production admission or application state is owned here.
"""
import numpy as np
from scipy import sparse


def sparse_rows(rows, count):
    rr, cc, vv = [], [], []
    for i, row in enumerate(rows):
        for j, value in row.items():
            if value:
                rr.append(i); cc.append(j); vv.append(value)
    return sparse.csr_matrix((vv, (rr, cc)), shape=(len(rows), count))


def material_system(data):
    rest = np.asarray(data['positions'], dtype=np.float32).astype(float).reshape(-1, 3)
    cells = np.asarray(data['cells'], dtype=int).reshape(-1, 4)
    assert len(rest) <= 2048 and len(cells) <= 4096
    x = rest[cells]
    dm = np.transpose(x[:, 1:] - x[:, :1], (0, 2, 1))
    volumes = np.linalg.det(dm) / 6
    assert np.all(volumes > 1e-10)
    inverse = np.linalg.inv(dm)
    gradients = np.concatenate([-inverse.sum(axis=1)[:, None, :], inverse], axis=1)
    rows = []
    for ids, gradient in zip(cells, gradients):
        rows.extend(dict(zip(ids, gradient[:, k])) for k in range(3))
    deformation = sparse_rows(rows, len(rest))
    masses = np.zeros(len(rest))
    for k in range(4):
        np.add.at(masses, cells[:, k], volumes/4)
    edges = set()
    def edge(a, b):
        edges.add(tuple(sorted((int(a), int(b)))))
    for ids in cells:
        for j in range(4):
            for k in range(j+1, 4): edge(ids[j], ids[k])
    for front in data['fronts'].values():
        centers, radial = front['centers'], front['radial']
        for section, ids in enumerate(radial):
            radius = np.linalg.norm(rest[ids[0]]-rest[centers[section]])
            length = sum(np.linalg.norm(rest[centers[k]]-rest[centers[section]])/2
                         for k in (section-1, section+1) if 0 <= k < 19)
            masses[ids] = np.pi*radius**2*length/12
            for j, a in enumerate(ids):
                edge(a, ids[(j+1)%12]); edge(a, centers[section])
                if section < 18:
                    edge(a, radial[section+1][j])
                    # Actual authored triangle diagonals are added below.
        for section in (0, 18):
            for a in radial[section]: edge(a, centers[section])
    for section in data['sections']:
        for ids in (section['backIds'], [i+5 for i in section['backIds']]):
            masses[ids] = masses[ids].mean()
    assert np.all(masses > 0)
    masses *= .444/masses.sum()
    # Preserve the previous native particle masses, including its f32 storage.
    masses = masses.astype(np.float32).astype(float)
    return rest, cells, volumes, deformation, masses, edges


def centroid_constraints(data, count):
    rows = []
    def add(center, ring):
        row = {int(center): 1.0}
        for i in ring: row[int(i)] = row.get(int(i), 0)-1/len(ring)
        rows.append(row)
    for i, section in enumerate(data['sections'][1:-1]):
        add(data['backCenters'][i], section['backIds'])
    for name, front in data['fronts'].items():
        for center, ring in zip(front['centers'], front['radial']): add(center, ring)
        column = 1 if name.endswith('_0') else len(data['sections'])-2
        add(front['centers'][18], [i+5 for i in data['sections'][column]['backIds']])
    assert len(rows) == 201
    return sparse_rows(rows, count)


def surface_binding(data, parts, rest, cells):
    """Affine displacements preserve every original vertex exactly at rest.

    Pipe rings on a section triangle share its affine frame. Their mean weights
    equal the section center, avoiding independent seam deformation. Source
    roundoff offsets remain in the one common collision/display representation.
    """
    tet = rest[cells]
    inv = np.linalg.inv(np.transpose(tet[:, 1:]-tet[:, :1], (0, 2, 1)))
    low, high = tet.min(axis=1)-1e-7, tet.max(axis=1)+1e-7
    rows, positions, triangles, ranges, source_errors = [], [], [], [], []
    for part in parts:
        name = part['name']
        if name == 'cape_clasp': continue
        source = np.asarray(part['positions']).reshape(-1, 3)
        start = len(rows)
        if name == 'cape_cloth':
            for vertex, point in enumerate(source):
                column, row = divmod(vertex, 19)
                if column in (0, 160):
                    front = data['fronts'][f'cape_front_edge_{int(column==160)}']
                    weights = {front['centers'][row]: 1.0}
                elif row == 0:
                    weights = {data['backCenters'][column]: 1.0}
                elif row == 18:
                    weights = {i+5: 1/3 for i in data['sections'][column+1]['backIds']}
                else:
                    candidates = np.flatnonzero(np.all((point >= low)&(point <= high), axis=1))
                    b = np.einsum('kij,kj->ki', inv[candidates], point-tet[candidates, 0])
                    b = np.column_stack([1-b.sum(axis=1), b])
                    chosen = b.min(axis=1).argmax()
                    assert b[chosen].min() >= -1e-6, (name, vertex)
                    weights = dict(zip(cells[candidates[chosen]], b[chosen]))
                rows.append(weights)
        elif name in data['fronts']:
            front = data['fronts'][name]
            for vertex in range(len(source)):
                section, j = divmod(vertex, 13)
                rows.append({front['radial'][section][max(0, j-1)]: 1.0})
        else:
            assert name in ('cape_back_edge', 'cape_hem')
            for section in range(161):
                ids = np.asarray(data['sections'][section+1]['backIds'])+(5 if name=='cape_hem' else 0)
                origin = rest[ids[0]]
                basis = (rest[ids[1:]]-origin).T
                points = source[section*13:(section+1)*13]
                uv = np.linalg.lstsq(basis, (points-origin).T, rcond=None)[0].T
                w = np.column_stack([1-uv.sum(axis=1), uv])
                w -= w[1:].mean(axis=0)-1/3
                rows.extend(dict(zip(ids, value)) for value in w)
        positions.extend(source)
        triangles.extend((np.asarray(part['indices']).reshape(-1, 3)+start).tolist())
        ranges.append({'name': name, 'start': start, 'count': len(source)})
    mapping = sparse_rows(rows, len(rest))
    source = np.asarray(positions)
    offsets = source-mapping@rest
    assert np.max(np.linalg.norm(offsets, axis=1)) < 1e-6
    return mapping, offsets, source, np.asarray(triangles), ranges


def edge_operator(pairs, positions, mapping=None):
    pairs = np.asarray(sorted(set(tuple(sorted(e)) for e in pairs)), dtype=int)
    length = np.linalg.norm(positions[pairs[:, 1]]-positions[pairs[:, 0]], axis=1)
    keep = length > 1e-9
    pairs, length = pairs[keep], length[keep]
    rows = [{int(a): -1/l, int(b): 1/l} for (a, b), l in zip(pairs, length)]
    operator = sparse_rows(rows, len(positions))
    rest_vectors = operator@positions
    return (operator if mapping is None else operator@mapping), rest_vectors, pairs, length


def build_discretization(data, parts):
    rest, cells, volumes, deformation, masses, edges = material_system(data)
    mapping, offset, source, triangles, ranges = surface_binding(data, parts, rest, cells)
    # Retain every actual front-surface edge, including its authored diagonal.
    for part in parts:
        if part['name'] not in data['fronts']: continue
        front = data['fronts'][part['name']]
        to_particle = lambda v: front['radial'][v//13][max(0, v%13-1)]
        for tri in np.asarray(part['indices']).reshape(-1, 3):
            for a, b in zip(tri, np.roll(tri, -1)):
                a, b = to_particle(int(a)), to_particle(int(b))
                if a != b: edges.add(tuple(sorted((a, b))))
    physical, _, physical_pairs, physical_lengths = edge_operator(edges, rest)
    render_pairs = [tuple(pair) for tri in triangles for pair in zip(tri, np.roll(tri, -1))]
    rendered, render_rest, render_pairs, render_lengths = edge_operator(render_pairs, source, mapping)
    shape_rows, shape_groups = [], []
    groups = [np.asarray(section['backIds'])+offset for section in data['sections'] for offset in (0, 5)]
    groups += [np.asarray([center]+ring) for front in data['fronts'].values() for center, ring in zip(front['centers'], front['radial'])]
    for ids in groups:
        fraction = masses[ids]/masses[ids].sum()
        relative = rest[ids]-fraction@rest[ids]
        radius = np.sqrt(np.sum(fraction[:, None]*relative**2))
        start = len(shape_rows)
        for i in ids:
            row = {int(j): -w/radius for j, w in zip(ids, fraction)}
            row[int(i)] += 1/radius
            shape_rows.append(row)
        shape_groups.append(dict(start=start, count=len(ids), rest=relative/radius,
                                 masses=masses[ids], radius=radius))
    shape = sparse_rows(shape_rows, len(rest))
    return dict(shape=shape, shape_groups=shape_groups, rest=rest, cells=cells, volumes=volumes, deformation=deformation,
                masses=masses, centroid=centroid_constraints(data, len(rest)),
                mapping=mapping, offset=offset, source=source, triangles=triangles, ranges=ranges,
                physical=physical, physical_pairs=physical_pairs, physical_lengths=physical_lengths,
                rendered=rendered, render_offset=render_rest-rendered@rest,
                render_pairs=render_pairs, render_lengths=render_lengths,
                pins=np.asarray(data['pins'], dtype=int))
