export class Cushion {
  constructor(size, subdivisions) {
    const half = size / 2
    const gap = size * 0.01 // thin initial gap between top and bottom faces
    const n = subdivisions
    const vertsPerFace = (n + 1) * (n + 1)

    const position = new Float32Array(vertsPerFace * 2 * 3)
    const uvData = new Float32Array(vertsPerFace * 2 * 2)

    // Top face vertices (y = +gap/2)
    for (let row = 0; row <= n; row++) {
      for (let col = 0; col <= n; col++) {
        const vi = row * (n + 1) + col
        const i = vi * 3
        position[i] = -half + (col / n) * size
        position[i + 1] = gap / 2
        position[i + 2] = -half + (row / n) * size

        uvData[vi * 2] = col / n
        uvData[vi * 2 + 1] = row / n
      }
    }

    // Bottom face vertices (y = -gap/2)
    // UVs slightly contracted inward so side strip faces get non-degenerate UVs
    const eps = gap / size
    for (let row = 0; row <= n; row++) {
      for (let col = 0; col <= n; col++) {
        const vi = vertsPerFace + row * (n + 1) + col
        const i = vi * 3
        position[i] = -half + (col / n) * size
        position[i + 1] = -gap / 2
        position[i + 2] = -half + (row / n) * size

        uvData[vi * 2] = (col / n) * (1 - 2 * eps) + eps
        uvData[vi * 2 + 1] = (row / n) * (1 - 2 * eps) + eps
      }
    }

    const faces = []

    // Top face triangles
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        const tl = row * (n + 1) + col
        const tr = tl + 1
        const bl = (row + 1) * (n + 1) + col
        const br = bl + 1
        faces.push([tl, tr, br])
        faces.push([tl, br, bl])
      }
    }

    // Bottom face triangles
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        const tl = vertsPerFace + row * (n + 1) + col
        const tr = tl + 1
        const bl = vertsPerFace + (row + 1) * (n + 1) + col
        const br = bl + 1
        faces.push([tl, tr, br])
        faces.push([tl, br, bl])
      }
    }

    // Front side strip (row=0, z=-half)
    for (let col = 0; col < n; col++) {
      const t0 = col,
        t1 = col + 1
      const b0 = vertsPerFace + col,
        b1 = vertsPerFace + col + 1
      faces.push([t0, t1, b1])
      faces.push([t0, b1, b0])
    }

    // Back side strip (row=n, z=+half)
    for (let col = 0; col < n; col++) {
      const t0 = n * (n + 1) + col,
        t1 = t0 + 1
      const b0 = vertsPerFace + n * (n + 1) + col,
        b1 = b0 + 1
      faces.push([t0, t1, b1])
      faces.push([t0, b1, b0])
    }

    // Left side strip (col=0, x=-half)
    for (let row = 0; row < n; row++) {
      const t0 = row * (n + 1),
        t1 = (row + 1) * (n + 1)
      const b0 = vertsPerFace + row * (n + 1),
        b1 = vertsPerFace + (row + 1) * (n + 1)
      faces.push([t0, t1, b1])
      faces.push([t0, b1, b0])
    }

    // Right side strip (col=n, x=+half)
    for (let row = 0; row < n; row++) {
      const t0 = row * (n + 1) + n,
        t1 = (row + 1) * (n + 1) + n
      const b0 = vertsPerFace + row * (n + 1) + n,
        b1 = vertsPerFace + (row + 1) * (n + 1) + n
      faces.push([t0, t1, b1])
      faces.push([t0, b1, b0])
    }

    // Fix winding to ensure outward-facing normals
    const index = []
    for (const [a, b, c] of faces) {
      const abx = position[b * 3] - position[a * 3],
        aby = position[b * 3 + 1] - position[a * 3 + 1],
        abz = position[b * 3 + 2] - position[a * 3 + 2]
      const acx = position[c * 3] - position[a * 3],
        acy = position[c * 3 + 1] - position[a * 3 + 1],
        acz = position[c * 3 + 2] - position[a * 3 + 2]
      const nx = aby * acz - abz * acy,
        ny = abz * acx - abx * acz,
        nz = abx * acy - aby * acx
      // Face centroid dot normal > 0 means outward for centered geometry
      const cx = (position[a * 3] + position[b * 3] + position[c * 3]) / 3
      const cy = (position[a * 3 + 1] + position[b * 3 + 1] + position[c * 3 + 1]) / 3
      const cz = (position[a * 3 + 2] + position[b * 3 + 2] + position[c * 3 + 2]) / 3
      const dot = nx * cx + ny * cy + nz * cz
      if (dot > 0) index.push(a, b, c)
      else index.push(a, c, b)
    }

    this.position = position
    this.index = index
    this.uv = uvData
  }
}
