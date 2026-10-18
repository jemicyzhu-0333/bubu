/** Bounded render-only adapter. The physics library owns particle integration;
 * this adapter writes only explicitly bound private position attributes. */
export function createThinSurfaceMapper({ indices, vertexCount }) {
  if (
    !Number.isSafeInteger(vertexCount) ||
    vertexCount < 3 ||
    vertexCount > 2048 ||
    (ArrayBuffer.isView(indices) && !(indices.buffer instanceof ArrayBuffer)) ||
    !Number.isSafeInteger(indices?.length) ||
    indices.length < 3 ||
    indices.length % 3 ||
    indices.length > 4096 * 3
  )
    throw Error("Invalid bounded surface topology");
  let triangles = new Uint32Array(indices.length);
  for (let i = 0; i < indices.length; i++) {
    const v = indices[i];
    if (!Number.isSafeInteger(v) || v < 0 || v >= vertexCount)
      throw Error("Invalid bounded surface topology");
    triangles[i] = v;
  }
  let frames = new Float64Array((triangles.length / 3) * 18),
    closed = false,
    ready = false,
    total = 0;
  const bindings = [];
  const guard = () => {
    if (closed) throw Error("Surface mapper disposed");
  };
  return {
    bind(records, attribute) {
      guard();
      if (
        bindings.length >= 16 ||
        attribute?.itemSize !== 3 ||
        attribute.normalized ||
        attribute.isInterleavedBufferAttribute ||
        !(
          attribute.array instanceof Float32Array ||
          attribute.array instanceof Float64Array
        ) ||
        !(attribute.array.buffer instanceof ArrayBuffer) ||
        !Number.isSafeInteger(attribute.count) ||
        attribute.count < 1 ||
        attribute.array.length !== attribute.count * 3 ||
        (ArrayBuffer.isView(records) &&
          !(records.buffer instanceof ArrayBuffer)) ||
        records.length !== attribute.count * 7 ||
        total + attribute.count > 50000
      )
        throw Error("Invalid bounded render binding");
      const data = new Float64Array(records.length);
      for (let i = 0; i < records.length; i++) {
        if (!Number.isFinite(records[i]))
          throw Error("Non-finite render binding");
        data[i] = records[i];
      }
      for (let i = 0; i < data.length; i += 7) {
        if (
          !Number.isSafeInteger(data[i]) ||
          data[i] < 0 ||
          data[i] >= triangles.length / 3 ||
          [data[i + 1], data[i + 2], data[i + 3]].some(
            (w) => w < -1e-6 || w > 1 + 1e-6,
          ) ||
          Math.abs(data[i + 1] + data[i + 2] + data[i + 3] - 1) > 1e-5 ||
          Math.hypot(data[i + 4], data[i + 5], data[i + 6]) > 0.08
        )
          throw Error("Invalid triangle binding record");
      }
      if (
        bindings.some(
          (b) =>
            b.buffer === attribute.array.buffer &&
            attribute.array.byteOffset < b.offset + b.bytes &&
            b.offset < attribute.array.byteOffset + attribute.array.byteLength,
        )
      )
        throw Error("Duplicate render target");
      bindings.push({
        attribute,
        array: attribute.array,
        buffer: attribute.array.buffer,
        bufferBytes: attribute.array.buffer.byteLength,
        offset: attribute.array.byteOffset,
        bytes: attribute.array.byteLength,
        count: attribute.count,
        version: attribute.version,
        data,
      });
      total += attribute.count;
    },
    prepare(vertices) {
      guard();
      ready = false;
      if (
        !(
          vertices instanceof Float32Array || vertices instanceof Float64Array
        ) ||
        !(vertices.buffer instanceof ArrayBuffer) ||
        vertices.length !== vertexCount * 3 ||
        !vertices.every((v) => Number.isFinite(v) && Math.abs(v) < 10)
      )
        throw Error("Invalid particle snapshot");
      for (let t = 0; t < triangles.length; t += 3) {
        const a = triangles[t] * 3,
          b = triangles[t + 1] * 3,
          c = triangles[t + 2] * 3,
          k = (t / 3) * 18;
        const ex = vertices[b] - vertices[a],
          ey = vertices[b + 1] - vertices[a + 1],
          ez = vertices[b + 2] - vertices[a + 2],
          fx = vertices[c] - vertices[a],
          fy = vertices[c + 1] - vertices[a + 1],
          fz = vertices[c + 2] - vertices[a + 2];
        const nx = ey * fz - ez * fy,
          ny = ez * fx - ex * fz,
          nz = ex * fy - ey * fx,
          len = Math.hypot(ex, ey, ez),
          area = Math.hypot(nx, ny, nz);
        if (len < 1e-8 || area < 1e-8)
          throw Error("Degenerate simulated triangle");
        const tx = ex / len,
          ty = ey / len,
          tz = ez / len,
          ux = nx / area,
          uy = ny / area,
          uz = nz / area;
        frames[k] = vertices[a];
        frames[k + 1] = vertices[a + 1];
        frames[k + 2] = vertices[a + 2];
        frames[k + 3] = ex;
        frames[k + 4] = ey;
        frames[k + 5] = ez;
        frames[k + 6] = fx;
        frames[k + 7] = fy;
        frames[k + 8] = fz;
        frames[k + 9] = tx;
        frames[k + 10] = ty;
        frames[k + 11] = tz;
        frames[k + 12] = uy * tz - uz * ty;
        frames[k + 13] = uz * tx - ux * tz;
        frames[k + 14] = ux * ty - uy * tx;
        frames[k + 15] = ux;
        frames[k + 16] = uy;
        frames[k + 17] = uz;
      }
      ready = true;
    },
    apply() {
      guard();
      if (!ready) throw Error("Prepare a valid particle snapshot first");
      for (const b of bindings)
        if (
          b.attribute.array !== b.array ||
          b.array.buffer !== b.buffer ||
          b.buffer.byteLength !== b.bufferBytes ||
          b.array.byteOffset !== b.offset ||
          b.array.byteLength !== b.bytes ||
          b.array.length !== b.count * 3 ||
          b.attribute.isInterleavedBufferAttribute ||
          b.attribute.count !== b.count ||
          b.attribute.itemSize !== 3 ||
          b.attribute.normalized ||
          b.attribute.version !== b.version
        )
          throw Error("Render target changed");
      for (const b of bindings) {
        const d = b.data,
          out = b.array;
        for (let v = 0; v < b.count; v++) {
          const j = v * 7,
            k = d[j] * 18;
          for (let axis = 0; axis < 3; axis++)
            out[v * 3 + axis] =
              frames[k + axis] * (d[j + 1] + d[j + 2] + d[j + 3]) +
              frames[k + 3 + axis] * d[j + 2] +
              frames[k + 6 + axis] * d[j + 3] +
              frames[k + 9 + axis] * d[j + 4] +
              frames[k + 12 + axis] * d[j + 5] +
              frames[k + 15 + axis] * d[j + 6];
        }
        b.attribute.needsUpdate = true;
        b.version = b.attribute.version;
      }
    },
    diagnostics() {
      return {
        disposed: closed,
        triangles: closed ? 0 : triangles.length / 3,
        vertices: closed ? 0 : total,
        ownedBytes: closed
          ? 0
          : frames.byteLength +
            triangles.byteLength +
            bindings.reduce((n, b) => n + b.data.byteLength, 0),
      };
    },
    dispose() {
      if (closed) return;
      closed = true;
      ready = false;
      frames = null;
      triangles = null;
      bindings.length = 0;
      total = 0;
    },
  };
}
