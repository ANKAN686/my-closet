export class Coin {
  constructor(size, subdivisions) {
    const radius = size * 0.5
    const thickness = Math.max(size * 0.06, 0.02)
    const segments = Math.max(16, subdivisions * 4)
    const rings = Math.max(3, subdivisions)
    const vertsPerFace = 1 + rings * segments
    const totalVerts = vertsPerFace * 2

    const position = new Float32Array(totalVerts * 3)
    const uvData = new Float32Array(totalVerts * 2)

    const topIndex = (ring, seg) => {
      if (ring === 0) return 0
      const s = ((seg % segments) + segments) % segments
      return 1 + (ring - 1) * segments + s
    }
    const bottomOffset = vertsPerFace
    const bottomIndex = (ring, seg) => bottomOffset + topIndex(ring, seg)

    const setVertex = (vi, x, y, z) => {
      const i3 = vi * 3
      position[i3] = x
      position[i3 + 1] = y
      position[i3 + 2] = z
      uvData[vi * 2] = x / (radius * 2) + 0.5
      uvData[vi * 2 + 1] = z / (radius * 2) + 0.5
    }

    // Centers
    setVertex(topIndex(0, 0), 0, thickness * 0.5, 0)
    setVertex(bottomIndex(0, 0), 0, -thickness * 0.5, 0)

    // Rings with a slight bevel to read as a coin
    for (let ring = 1; ring <= rings; ring++) {
      const rNorm = ring / rings
      const ringRadius = radius * rNorm
      const bevel = Math.pow(rNorm, 4) * thickness * 0.18
      for (let seg = 0; seg < segments; seg++) {
        const a = (seg / segments) * Math.PI * 2
        const x = Math.cos(a) * ringRadius
        const z = Math.sin(a) * ringRadius

        setVertex(topIndex(ring, seg), x, thickness * 0.5 - bevel, z)
        setVertex(bottomIndex(ring, seg), x, -thickness * 0.5 + bevel, z)
      }
    }

    const faces = []

    // Top cap
    for (let seg = 0; seg < segments; seg++) {
      faces.push([topIndex(0, 0), topIndex(1, seg), topIndex(1, seg + 1)])
    }
    for (let ring = 1; ring < rings; ring++) {
      for (let seg = 0; seg < segments; seg++) {
        const a = topIndex(ring, seg)
        const b = topIndex(ring, seg + 1)
        const c = topIndex(ring + 1, seg + 1)
        const d = topIndex(ring + 1, seg)
        faces.push([a, b, c], [a, c, d])
      }
    }

    // Bottom cap
    for (let seg = 0; seg < segments; seg++) {
      faces.push([bottomIndex(0, 0), bottomIndex(1, seg + 1), bottomIndex(1, seg)])
    }
    for (let ring = 1; ring < rings; ring++) {
      for (let seg = 0; seg < segments; seg++) {
        const a = bottomIndex(ring, seg)
        const b = bottomIndex(ring, seg + 1)
        const c = bottomIndex(ring + 1, seg + 1)
        const d = bottomIndex(ring + 1, seg)
        faces.push([a, c, b], [a, d, c])
      }
    }

    // Side wall
    for (let seg = 0; seg < segments; seg++) {
      const t0 = topIndex(rings, seg)
      const t1 = topIndex(rings, seg + 1)
      const b0 = bottomIndex(rings, seg)
      const b1 = bottomIndex(rings, seg + 1)
      faces.push([t0, t1, b1], [t0, b1, b0])
    }

    // Fix winding to outward normals for stable pressure volume.
    const index = []
    for (const [a, b, c] of faces) {
      const abx = position[b * 3] - position[a * 3]
      const aby = position[b * 3 + 1] - position[a * 3 + 1]
      const abz = position[b * 3 + 2] - position[a * 3 + 2]
      const acx = position[c * 3] - position[a * 3]
      const acy = position[c * 3 + 1] - position[a * 3 + 1]
      const acz = position[c * 3 + 2] - position[a * 3 + 2]
      const nx = aby * acz - abz * acy
      const ny = abz * acx - abx * acz
      const nz = abx * acy - aby * acx
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
