export class Coin {
  constructor(radius, thickness, segments) {
    const n = segments
    const r = radius
    const t = thickness / 2

    const position = new Float32Array((n + 1) * 2 * 3)
    const uvData = new Float32Array((n + 1) * 2 * 2)

    for (let i = 0; i <= n; i++) {
      const theta = (i / n) * Math.PI * 2
      const x = Math.cos(theta) * r
      const z = Math.sin(theta) * r

      position[i * 3] = x
      position[i * 3 + 1] = t
      position[i * 3 + 2] = z

      uvData[i * 2] = i / n
      uvData[i * 2 + 1] = 1
    }

    for (let i = 0; i <= n; i++) {
      const theta = (i / n) * Math.PI * 2
      const x = Math.cos(theta) * r
      const z = Math.sin(theta) * r

      position[(n + 1 + i) * 3] = x
      position[(n + 1 + i) * 3 + 1] = -t
      position[(n + 1 + i) * 3 + 2] = z

      uvData[(n + 1 + i) * 2] = i / n
      uvData[(n + 1 + i) * 2 + 1] = 0
    }

    const faces = []

    for (let i = 0; i < n; i++) {
      faces.push([i, i + 1, n + 1 + i])
      faces.push([i + 1, n + 1 + i + 1, n + 1 + i])
    }

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
