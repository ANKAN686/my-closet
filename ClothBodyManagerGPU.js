import * as THREE from 'three/webgpu'
import {
  Fn,
  If,
  Loop,
  float,
  uint,
  vec3,
  vec4,
  uniform,
  instancedArray,
  instanceIndex,
  normalize,
  length,
  cross,
  dot,
  abs,
  sin,
  cos,
  mix,
  step,
  floor,
  sqrt,
  mx_noise_float,
  texture,
  uv,
  vertexIndex,
  cameraViewMatrix,
  positionView,
  atomicAdd,
  atomicStore,
  atomicLoad,
} from 'three/tsl'

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_STRETCH = 8
const MAX_BEND = 8
const MAX_TRI_ADJ = 8
const HASH_BUCKET_SIZE = 16

// ─── CPU helpers ──────────────────────────────────────────────────────────────

function findTriNeighbors(triIds) {
  const edges = []
  const numTris = triIds.length / 3

  for (let i = 0; i < numTris; i++) {
    for (let j = 0; j < 3; j++) {
      const id0 = triIds[3 * i + j]
      const id1 = triIds[3 * i + ((j + 1) % 3)]
      edges.push({
        id0: Math.min(id0, id1),
        id1: Math.max(id0, id1),
        edgeNr: 3 * i + j,
      })
    }
  }

  edges.sort((a, b) => (a.id0 !== b.id0 ? a.id0 - b.id0 : a.id1 - b.id1))

  const neighbors = new Int32Array(3 * numTris)
  neighbors.fill(-1)

  let nr = 0
  while (nr < edges.length) {
    const e0 = edges[nr]
    nr++
    if (nr < edges.length) {
      const e1 = edges[nr]
      if (e0.id0 === e1.id0 && e0.id1 === e1.id1) {
        neighbors[e0.edgeNr] = e1.edgeNr
        neighbors[e1.edgeNr] = e0.edgeNr
        nr++
      }
    }
  }

  return neighbors
}

function buildClothData(position, index, offset = [0, 1.5, 0], rotation = [0, 0, 0]) {
  const numVerts = position.length / 3
  const numTris = index.length / 3

  // Rotate then offset positions
  const pos = new Float32Array(position.length)
  const euler = new THREE.Euler(...rotation)
  const v = new THREE.Vector3()
  for (let i = 0; i < numVerts; i++) {
    v.set(position[i * 3], position[i * 3 + 1], position[i * 3 + 2])
    v.applyEuler(euler)
    pos[i * 3] = v.x + offset[0]
    pos[i * 3 + 1] = v.y + offset[1]
    pos[i * 3 + 2] = v.z + offset[2]
  }

  // Inverse masses from triangle areas
  const invMass = new Float32Array(numVerts)
  for (let i = 0; i < numTris; i++) {
    const a = index[i * 3],
      b = index[i * 3 + 1],
      c = index[i * 3 + 2]
    const e0x = pos[b * 3] - pos[a * 3],
      e0y = pos[b * 3 + 1] - pos[a * 3 + 1],
      e0z = pos[b * 3 + 2] - pos[a * 3 + 2]
    const e1x = pos[c * 3] - pos[a * 3],
      e1y = pos[c * 3 + 1] - pos[a * 3 + 1],
      e1z = pos[c * 3 + 2] - pos[a * 3 + 2]
    const cx = e0y * e1z - e0z * e1y,
      cy = e0z * e1x - e0x * e1z,
      cz = e0x * e1y - e0y * e1x
    const area = 0.5 * Math.sqrt(cx * cx + cy * cy + cz * cz)
    const w = area > 0 ? 1 / (area * 3) : 0
    invMass[a] += w
    invMass[b] += w
    invMass[c] += w
  }

  // Find neighbors and build constraint pairs
  const neighbors = findTriNeighbors(index)
  const stretchEdges = []
  const bendPairSet = new Set()
  const bendPairs = []

  for (let i = 0; i < numTris; i++) {
    for (let j = 0; j < 3; j++) {
      const id0 = index[3 * i + j]
      const id1 = index[3 * i + ((j + 1) % 3)]
      const n = neighbors[3 * i + j]

      if (n < 0 || id0 < id1) {
        stretchEdges.push([id0, id1])
      }

      if (n >= 0) {
        const ni = Math.floor(n / 3)
        const nj = n % 3
        const id2 = index[3 * i + ((j + 2) % 3)]
        const id3 = index[3 * ni + ((nj + 2) % 3)]
        const key = Math.min(id2, id3) * numVerts + Math.max(id2, id3)
        if (!bendPairSet.has(key)) {
          bendPairSet.add(key)
          bendPairs.push([id2, id3])
        }
      }
    }
  }

  // Build per-vertex stretch neighbor lists
  const stretchData = new Float32Array(numVerts * MAX_STRETCH * 2)
  const stretchCounts = new Float32Array(numVerts)

  for (const [a, b] of stretchEdges) {
    const dx = pos[a * 3] - pos[b * 3],
      dy = pos[a * 3 + 1] - pos[b * 3 + 1],
      dz = pos[a * 3 + 2] - pos[b * 3 + 2]
    const restLen = Math.sqrt(dx * dx + dy * dy + dz * dz)

    let c = stretchCounts[a]
    if (c < MAX_STRETCH) {
      stretchData[(a * MAX_STRETCH + c) * 2] = b
      stretchData[(a * MAX_STRETCH + c) * 2 + 1] = restLen
      stretchCounts[a]++
    }
    c = stretchCounts[b]
    if (c < MAX_STRETCH) {
      stretchData[(b * MAX_STRETCH + c) * 2] = a
      stretchData[(b * MAX_STRETCH + c) * 2 + 1] = restLen
      stretchCounts[b]++
    }
  }

  // Build per-vertex bend neighbor lists
  const bendData = new Float32Array(numVerts * MAX_BEND * 2)
  const bendCounts = new Float32Array(numVerts)

  for (const [id2, id3] of bendPairs) {
    const dx = pos[id2 * 3] - pos[id3 * 3],
      dy = pos[id2 * 3 + 1] - pos[id3 * 3 + 1],
      dz = pos[id2 * 3 + 2] - pos[id3 * 3 + 2]
    const restLen = Math.sqrt(dx * dx + dy * dy + dz * dz)

    let c = bendCounts[id2]
    if (c < MAX_BEND) {
      bendData[(id2 * MAX_BEND + c) * 2] = id3
      bendData[(id2 * MAX_BEND + c) * 2 + 1] = restLen
      bendCounts[id2]++
    }
    c = bendCounts[id3]
    if (c < MAX_BEND) {
      bendData[(id3 * MAX_BEND + c) * 2] = id2
      bendData[(id3 * MAX_BEND + c) * 2 + 1] = restLen
      bendCounts[id3]++
    }
  }

  // Build per-vertex triangle adjacency
  const triAdjData = new Float32Array(numVerts * MAX_TRI_ADJ * 4)
  const triAdjCounts = new Float32Array(numVerts)

  for (let i = 0; i < numTris; i++) {
    const a = index[i * 3],
      b = index[i * 3 + 1],
      c = index[i * 3 + 2]
    const verts = [
      [a, b, c],
      [b, c, a],
      [c, a, b],
    ]
    for (const [v, next, prev] of verts) {
      const cnt = triAdjCounts[v]
      if (cnt < MAX_TRI_ADJ) {
        const base = (v * MAX_TRI_ADJ + cnt) * 4
        triAdjData[base] = next
        triAdjData[base + 1] = prev
        triAdjData[base + 2] = 0
        triAdjData[base + 3] = 0
        triAdjCounts[v]++
      }
    }
  }

  // Triangle indices for volume computation
  const triIndicesData = new Float32Array(numTris * 4)
  for (let i = 0; i < numTris; i++) {
    triIndicesData[i * 4] = index[i * 3]
    triIndicesData[i * 4 + 1] = index[i * 3 + 1]
    triIndicesData[i * 4 + 2] = index[i * 3 + 2]
  }

  // Rest volume
  const rx = pos[0],
    ry = pos[1],
    rz = pos[2]
  let restVolume = 0
  for (let i = 0; i < numTris; i++) {
    const a = index[i * 3],
      b = index[i * 3 + 1],
      c = index[i * 3 + 2]
    const p0x = pos[a * 3] - rx,
      p0y = pos[a * 3 + 1] - ry,
      p0z = pos[a * 3 + 2] - rz
    const p1x = pos[b * 3] - rx,
      p1y = pos[b * 3 + 1] - ry,
      p1z = pos[b * 3 + 2] - rz
    const p2x = pos[c * 3] - rx,
      p2y = pos[c * 3 + 1] - ry,
      p2z = pos[c * 3 + 2] - rz
    restVolume += p0x * (p1y * p2z - p1z * p2y) + p0y * (p1z * p2x - p1x * p2z) + p0z * (p1x * p2y - p1y * p2x)
  }
  restVolume /= 6

  return {
    numVerts,
    numTris,
    pos,
    invMass,
    stretchData,
    stretchCounts,
    bendData,
    bendCounts,
    triAdjData,
    triAdjCounts,
    triIndicesData,
    restVolume,
    index,
  }
}

// ─── ClothBodyManagerGPU class ───────────────────────────────────────────────

/**
 * GPU-accelerated cloth simulation using XPBD with pressure constraints.
 * Runs entirely on the GPU via compute shaders.
 *
 * All bodies are batched into single GPU buffers with single compute dispatches
 * (like SoftBodyManagerGPU). Collision uses a fixed-size bucket spatial hash grid
 * for O(n) neighbor lookups instead of brute-force O(n²) per body.
 *
 * Each substep: computes volume (divergence theorem), applies pressure + gravity
 * via Verlet integration, solves stretch + bend distance constraints (Jacobi),
 * rebuilds the spatial hash, handles inter-body vertex-level collision and ground
 * collision, then recomputes normals.
 *
 * Possible future collision optimization — tile-based sub-body broad phase:
 * Exploit the structured cushion mesh by precomputing vertex assignments into
 * spatial tiles (e.g., 4×4 grid per face = 32 chunks, ~28 vertices each).
 * Each frame, compute per-chunk bounding spheres. Collision testing would use:
 *   Level 1: Body bounding sphere (existing)
 *   Level 2: Chunk bounding sphere (only check ~32 chunks, most are far away)
 *   Level 3: Per-vertex in nearby chunks only (~28-56 vertices instead of 882)
 * This could give a ~10-15× reduction in distance checks without atomics.
 * Chunk assignments are static (precomputed on CPU), only the chunk bounding
 * spheres need recomputing each frame.
 *
 * References:
 * - https://github.com/matthias-research/pages/blob/master/tenMinutePhysics/14-cloth.html
 * - https://github.com/matthias-research/pages/blob/master/tenMinutePhysics/16-GPUCloth.py
 */
export class ClothBodyManagerGPU {
  // Public simulation params (overridable via constructor)
  numSubsteps = 25
  gravity = -10
  stretchingCompliance = 0.0
  bendingCompliance = 0.5
  pressure = 40
  pressureRampTime = 0.5
  pressureStiffness = 1
  timescale = 1
  damping = 0.002
  collisionRadius = 0.04
  collisionFriction = 0.3
  collisionDamping = 0.5
  groundY = 0
  groundFriction = 0.5
  wrinklesEnabled = true
  wrinkleFrequency = 45
  wrinkleStrength = 0.8
  wrinkleSmoothingTime = 0.15
  wrinkleGrazeAttenuation = 1.5
  wrinkleThreshold = 0.007
  wrinkleScale = 1
  wrinkleTurbulence2D = 1.25
  wrinkleTurbulence2DFrequency = 4.8
  wrinkleTurbulence = 0.93
  wrinkleTurbulenceFrequency = 11.9
  attractorStrength = 0
  attractorPosition = [0, 0, 0]
  attractorRadius = 1
  attractorRadiusMax = 2
  wanderStrength = 0
  wanderSpeed = 0.3
  sphereColliderPosition = [0, 0, 0]
  sphereColliderRadius = 0.3
  sphereColliderStrength = 500
  sphereColliderEnabled = false
  textureScale = 1
  textureIntensity = 1
  fabricNormalStrength = 1
  roughnessBase = 0.6

  #renderer
  #scene
  #numBodies
  #particlesPerBody
  #trisPerBody
  #totalParticles
  #totalTris

  #tableSize

  // Internal simulation state
  #simTime = 0
  #substepAccumulator = 0

  // Uniforms
  #dtU
  #gravityU
  #dampingU
  #pressureU
  #pressureStiffnessU
  #restVolumeU
  #stretchAlphaU
  #bendAlphaU
  #collisionRadiusU
  #frictionU
  #collisionDampingU
  #groundYU
  #groundEnabledU
  #groundFrictionU
  #hashSpacingU
  #wrinkleFrequencyU
  #wrinkleStrengthU
  #wrinkleSmoothingTimeU
  #wrinkleGrazeAttenuationU
  #wrinkleThresholdU
  #wrinkleScaleU
  #wrinkleTurbulence2DU
  #wrinkleTurbulence2DFrequencyU
  #wrinkleTurbulenceU
  #wrinkleTurbulenceFrequencyU
  #attractorPositionU
  #attractorStrengthU
  #attractorRadiusU
  #attractorRadiusMaxU
  #wanderStrengthU
  #wanderSpeedU
  #sphereColliderPositionU
  #sphereColliderRadiusU
  #sphereColliderStrengthU
  #sphereColliderEnabledU
  #simTimeU
  #textureScaleU
  #textureIntensityU
  #fabricNormalStrengthU
  #roughnessBaseU

  // Single compute passes (batched across all bodies)
  #passComputeVolume
  #passPreSolve
  #passSolveConstraints
  #passComputeNormals
  #passComputeStrain
  #passClearHash
  #passInsertHash
  #passApplyCollision
  #passComputeCentroids
  #passReset

  #bodyCentroidsBuffer

  // Scene objects
  #clothMeshes = []
  #clothMaterials = []
  #wireframeMaterials = []
  #strainDebugMaterials = []

  constructor({ position, index, uv: providedUV, bodies }, renderer, scene, params = {}) {
    Object.assign(this, params)

    this.#renderer = renderer
    this.#scene = scene
    this.#numBodies = bodies.length

    // Build per-body data on CPU
    const allData = bodies.map((body) => buildClothData(position, index, body.position, body.rotation))

    this.#particlesPerBody = allData[0].numVerts
    this.#trisPerBody = allData[0].numTris
    this.#totalParticles = this.#numBodies * this.#particlesPerBody
    this.#totalTris = this.#numBodies * this.#trisPerBody
    this.#tableSize = 2 * this.#totalParticles

    // Uniforms
    this.#dtU = uniform(1 / 60 / this.numSubsteps)
    this.#gravityU = uniform(this.gravity)
    this.#dampingU = uniform(this.damping)
    this.#pressureU = uniform(this.pressure)
    this.#pressureStiffnessU = uniform(this.pressureStiffness)
    this.#restVolumeU = uniform(allData[0].restVolume)
    this.#stretchAlphaU = uniform(0.0)
    this.#bendAlphaU = uniform(0.0)
    this.#collisionRadiusU = uniform(this.collisionRadius)
    this.#frictionU = uniform(this.collisionFriction)
    this.#collisionDampingU = uniform(this.collisionDamping)
    this.#groundYU = uniform(typeof this.groundY === 'number' ? this.groundY : 0)
    this.#groundEnabledU = uniform(typeof this.groundY === 'number' ? 1 : 0)
    this.#groundFrictionU = uniform(this.groundFriction)
    this.#hashSpacingU = uniform(this.collisionRadius * 2)
    this.#wrinkleFrequencyU = uniform(this.wrinkleFrequency)
    this.#wrinkleStrengthU = uniform(this.wrinkleStrength)
    this.#wrinkleSmoothingTimeU = uniform(this.wrinkleSmoothingTime)
    this.#wrinkleGrazeAttenuationU = uniform(this.wrinkleGrazeAttenuation)
    this.#wrinkleThresholdU = uniform(this.wrinkleThreshold)
    this.#wrinkleScaleU = uniform(this.wrinkleScale)
    this.#wrinkleTurbulence2DU = uniform(this.wrinkleTurbulence2D)
    this.#wrinkleTurbulence2DFrequencyU = uniform(this.wrinkleTurbulence2DFrequency)
    this.#wrinkleTurbulenceU = uniform(this.wrinkleTurbulence)
    this.#wrinkleTurbulenceFrequencyU = uniform(this.wrinkleTurbulenceFrequency)
    this.#attractorPositionU = uniform(new THREE.Vector3(...this.attractorPosition))
    this.#attractorStrengthU = uniform(this.attractorStrength)
    this.#attractorRadiusU = uniform(this.attractorRadius)
    this.#attractorRadiusMaxU = uniform(this.attractorRadiusMax)
    this.#wanderStrengthU = uniform(this.wanderStrength)
    this.#wanderSpeedU = uniform(this.wanderSpeed)
    this.#sphereColliderPositionU = uniform(new THREE.Vector3(...this.sphereColliderPosition))
    this.#sphereColliderRadiusU = uniform(this.sphereColliderRadius)
    this.#sphereColliderStrengthU = uniform(this.sphereColliderStrength)
    this.#sphereColliderEnabledU = uniform(this.sphereColliderEnabled ? 1 : 0)
    this.#simTimeU = uniform(0)
    this.#textureScaleU = uniform(this.textureScale)
    this.#textureIntensityU = uniform(this.textureIntensity)
    this.#fabricNormalStrengthU = uniform(this.fabricNormalStrength)
    this.#roughnessBaseU = uniform(this.roughnessBase)

    // Batch all body data into single arrays with remapped indices
    const batchedData = this.#buildBatchedData(allData)

    // Create single set of GPU buffers
    const buffers = this.#createGPUBuffers(batchedData)
    this.#bodyCentroidsBuffer = buffers.bodyCentroids

    // Create single compute passes covering all bodies
    this.#createComputePasses(buffers)

    // Use provided UVs or compute from original unrotated positions
    let uvData
    if (providedUV) {
      uvData = providedUV
    } else {
      const numVerts = position.length / 3
      uvData = new Float32Array(numVerts * 2)
      const size = this.cushionSize || 1
      for (let i = 0; i < numVerts; i++) {
        uvData[i * 2] = position[i * 3] / size + 0.5
        uvData[i * 2 + 1] = position[i * 3 + 2] / size + 0.5
      }
    }

    // Create single instanced display mesh (1 pipeline instead of N)
    this.#createInstancedDisplayMesh(allData[0], buffers, bodies, uvData)
  }

  #buildBatchedData(allData) {
    const numBodies = this.#numBodies
    const particlesPerBody = this.#particlesPerBody
    const trisPerBody = this.#trisPerBody
    const totalParticles = this.#totalParticles
    const totalTris = this.#totalTris

    const posData = new Float32Array(totalParticles * 3)
    const invMassData = new Float32Array(totalParticles)
    const stretchData = new Float32Array(totalParticles * MAX_STRETCH * 2)
    const stretchCountsData = new Float32Array(totalParticles)
    const bendData = new Float32Array(totalParticles * MAX_BEND * 2)
    const bendCountsData = new Float32Array(totalParticles)
    const triAdjData = new Float32Array(totalParticles * MAX_TRI_ADJ * 4)
    const triAdjCountsData = new Float32Array(totalParticles)
    const triIndicesData = new Float32Array(totalTris * 4)

    for (let b = 0; b < numBodies; b++) {
      const data = allData[b]
      const pOff = b * particlesPerBody
      const tOff = b * trisPerBody

      // Positions (direct copy)
      posData.set(data.pos, pOff * 3)

      // Inverse masses (direct copy)
      invMassData.set(data.invMass, pOff)

      // Stretch neighbors (remap neighbor indices to global)
      for (let i = 0; i < particlesPerBody; i++) {
        stretchCountsData[pOff + i] = data.stretchCounts[i]
        for (let j = 0; j < data.stretchCounts[i]; j++) {
          const srcIdx = (i * MAX_STRETCH + j) * 2
          const dstIdx = ((pOff + i) * MAX_STRETCH + j) * 2
          stretchData[dstIdx] = data.stretchData[srcIdx] + pOff
          stretchData[dstIdx + 1] = data.stretchData[srcIdx + 1]
        }
      }

      // Bend neighbors (remap neighbor indices to global)
      for (let i = 0; i < particlesPerBody; i++) {
        bendCountsData[pOff + i] = data.bendCounts[i]
        for (let j = 0; j < data.bendCounts[i]; j++) {
          const srcIdx = (i * MAX_BEND + j) * 2
          const dstIdx = ((pOff + i) * MAX_BEND + j) * 2
          bendData[dstIdx] = data.bendData[srcIdx] + pOff
          bendData[dstIdx + 1] = data.bendData[srcIdx + 1]
        }
      }

      // Triangle adjacency (remap vertex indices to global)
      for (let i = 0; i < particlesPerBody; i++) {
        triAdjCountsData[pOff + i] = data.triAdjCounts[i]
        for (let j = 0; j < data.triAdjCounts[i]; j++) {
          const srcBase = (i * MAX_TRI_ADJ + j) * 4
          const dstBase = ((pOff + i) * MAX_TRI_ADJ + j) * 4
          triAdjData[dstBase] = data.triAdjData[srcBase] + pOff
          triAdjData[dstBase + 1] = data.triAdjData[srcBase + 1] + pOff
          triAdjData[dstBase + 2] = 0
          triAdjData[dstBase + 3] = 0
        }
      }

      // Triangle indices (remap all 3 vertex indices to global)
      for (let t = 0; t < trisPerBody; t++) {
        triIndicesData[(tOff + t) * 4] = data.triIndicesData[t * 4] + pOff
        triIndicesData[(tOff + t) * 4 + 1] = data.triIndicesData[t * 4 + 1] + pOff
        triIndicesData[(tOff + t) * 4 + 2] = data.triIndicesData[t * 4 + 2] + pOff
        triIndicesData[(tOff + t) * 4 + 3] = 0
      }
    }

    return {
      posData,
      invMassData,
      stretchData,
      stretchCountsData,
      bendData,
      bendCountsData,
      triAdjData,
      triAdjCountsData,
      triIndicesData,
    }
  }

  #createGPUBuffers(data) {
    return {
      positions: instancedArray(data.posData, 'vec3'),
      prevPositions: instancedArray(new Float32Array(data.posData), 'vec3'),
      invMasses: instancedArray(data.invMassData, 'float'),
      initialPositions: instancedArray(new Float32Array(data.posData), 'vec3'),
      stretchNeighbors: instancedArray(data.stretchData, 'vec2'),
      stretchCounts: instancedArray(data.stretchCountsData, 'float'),
      bendNeighbors: instancedArray(data.bendData, 'vec2'),
      bendCounts: instancedArray(data.bendCountsData, 'float'),
      triAdj: instancedArray(data.triAdjData, 'vec4'),
      triAdjCounts: instancedArray(data.triAdjCountsData, 'float'),
      triIndices: instancedArray(data.triIndicesData, 'vec4'),
      volumeBuffer: instancedArray(this.#numBodies, 'float'),
      normalsBuffer: instancedArray(this.#totalParticles * 4, 'vec4'),
      strainBuffer: instancedArray(this.#totalParticles * 4, 'vec4'),
      hashBucketCounts: instancedArray(this.#tableSize, 'uint').toAtomic(),
      hashBucketEntries: instancedArray(this.#tableSize * HASH_BUCKET_SIZE, 'uint'),
      bodyCentroids: instancedArray(this.#numBodies, 'vec4'), // xyz = centroid, w = bounding radius
    }
  }

  #createComputePasses(buffers) {
    const {
      positions,
      prevPositions,
      invMasses,
      initialPositions,
      stretchNeighbors,
      stretchCounts,
      bendNeighbors,
      bendCounts,
      triAdj,
      triAdjCounts,
      triIndices,
      volumeBuffer,
      normalsBuffer,
      strainBuffer,
      hashBucketCounts,
      hashBucketEntries,
      bodyCentroids,
    } = buffers

    const totalParticles = this.#totalParticles
    const particlesPerBody = this.#particlesPerBody
    const trisPerBody = this.#trisPerBody
    const numBodies = this.#numBodies
    const tableSize = this.#tableSize
    const totalParticlesU = uint(totalParticles)
    const tableSizeU = uint(tableSize)

    const dtU = this.#dtU
    const gravityU = this.#gravityU
    const dampingU = this.#dampingU
    const pressureU = this.#pressureU
    const pressureStiffnessU = this.#pressureStiffnessU
    const restVolumeU = this.#restVolumeU
    const stretchAlphaU = this.#stretchAlphaU
    const bendAlphaU = this.#bendAlphaU
    const collisionRadiusU = this.#collisionRadiusU
    const frictionU = this.#frictionU
    const collisionDampingU = this.#collisionDampingU
    const groundYU = this.#groundYU
    const groundEnabledU = this.#groundEnabledU
    const groundFrictionU = this.#groundFrictionU
    const wrinkleSmoothingTimeU = this.#wrinkleSmoothingTimeU
    const attractorPositionU = this.#attractorPositionU
    const attractorStrengthU = this.#attractorStrengthU
    const attractorRadiusU = this.#attractorRadiusU
    const attractorRadiusMaxU = this.#attractorRadiusMaxU
    const wanderStrengthU = this.#wanderStrengthU
    const wanderSpeedU = this.#wanderSpeedU
    const sphereColliderPosU = this.#sphereColliderPositionU
    const sphereColliderRadU = this.#sphereColliderRadiusU
    const sphereColliderStrU = this.#sphereColliderStrengthU
    const sphereColliderEnabledU = this.#sphereColliderEnabledU
    const simTimeU = this.#simTimeU
    const hashSpacingU = this.#hashSpacingU

    // ─── Spatial hash helpers ──────────────────────────────────────────────────
    // All arithmetic stays in float/uint — no int() to avoid TSL code-gen issues.
    // A large offset (50000) ensures all cell coordinates are positive so
    // uint(floor(x)) is always well-defined in WGSL.

    const H1 = uint(92837111)
    const H2 = uint(689287499)
    const H3 = uint(283923481)
    const COORD_OFFSET = float(50000)

    // Cell coordinate as float (always positive via offset)
    function cellCoordF(val) {
      return floor(val.div(hashSpacingU)).add(COORD_OFFSET)
    }

    // Hash from float cell coords → uint table index
    function hashFromFloats(cx, cy, cz) {
      return uint(cx).mul(H1).add(uint(cy).mul(H2)).add(uint(cz).mul(H3)).mod(tableSizeU)
    }

    // Hash from position vec3
    function hashFromPos(p) {
      return hashFromFloats(cellCoordF(p.x), cellCoordF(p.y), cellCoordF(p.z))
    }

    // ─── 1. Compute volume ─────────────────────────────────────────────────────

    this.#passComputeVolume = Fn(() => {
      const bodyIdx = instanceIndex
      const pBase = bodyIdx.mul(uint(particlesPerBody))
      const tBase = bodyIdx.mul(uint(trisPerBody))
      const ref = positions.element(pBase)
      const vol = float(0).toVar()

      Loop(trisPerBody, ({ i }) => {
        const tri = triIndices.element(tBase.add(i))
        const p0 = positions.element(uint(tri.x)).sub(ref)
        const p1 = positions.element(uint(tri.y)).sub(ref)
        const p2 = positions.element(uint(tri.z)).sub(ref)
        vol.addAssign(dot(p0, cross(p1, p2)))
      })

      volumeBuffer.element(bodyIdx).assign(vol.div(6))
    })().compute(numBodies)

    // ─── 2. PreSolve (with velocity clamping) ──────────────────────────────────

    this.#passPreSolve = Fn(() => {
      const i = instanceIndex

      If(i.lessThan(totalParticlesU), () => {
        const bodyIdx = i.div(uint(particlesPerBody))
        const invM = invMasses.element(i)

        If(invM.greaterThan(0), () => {
          const pos = positions.element(i)
          const prevPos = prevPositions.element(i)

          const vel = pos.sub(prevPos).div(dtU).toVar()

          // Pressure force (per-body volume)
          const vol = volumeBuffer.element(bodyIdx)
          const absVol = abs(vol).max(1e-10)
          const P = pressureU.add(pressureStiffnessU.mul(restVolumeU.div(absVol).sub(1)))

          const triCount = uint(triAdjCounts.element(i))
          const pressureForce = vec3(0, 0, 0).toVar()

          Loop(triCount, ({ i: j }) => {
            const tri = triAdj.element(i.mul(MAX_TRI_ADJ).add(j))
            const pNext = positions.element(uint(tri.x))
            const pPrev = positions.element(uint(tri.y))
            pressureForce.addAssign(cross(pNext, pPrev))
          })

          vel.addAssign(pressureForce.mul(P.div(6).mul(dtU).mul(invM)))

          // Gravity
          vel.y.addAssign(gravityU.mul(dtU))

          // Sphere containment — push body back toward center when centroid exceeds attractorRadius
          If(attractorStrengthU.greaterThan(0), () => {
            const centroid = bodyCentroids.element(bodyIdx).xyz
            const toCenter = attractorPositionU.sub(centroid)
            const dist = length(toCenter)

            If(dist.greaterThan(attractorRadiusU), () => {
              // Ramp force 0→1 from attractorRadius to attractorRadiusMax
              const t = dist.sub(attractorRadiusU).div(attractorRadiusMaxU.sub(attractorRadiusU)).clamp(0, 1)
              const force = t.mul(attractorStrengthU)
              vel.addAssign(toCenter.div(dist).mul(force.mul(dtU)))
            })
          })

          // Per-body wander
          If(wanderStrengthU.greaterThan(0), () => {
            const wanderT = simTimeU.mul(wanderSpeedU)
            const seed = float(bodyIdx).mul(137.5)
            vel.addAssign(
              vec3(
                sin(wanderT.add(seed)),
                sin(wanderT.mul(0.77).add(seed.mul(2.1))),
                sin(wanderT.mul(0.63).add(seed.mul(3.7))),
              ).mul(wanderStrengthU.mul(dtU)),
            )
          })

          // Sphere collider repulsion (mouse interaction)
          If(sphereColliderEnabledU.greaterThan(0), () => {
            const sDiff = pos.sub(sphereColliderPosU)
            const sDist = length(sDiff)
            If(sDist.lessThan(sphereColliderRadU).and(sDist.greaterThan(1e-6)), () => {
              const overlap = sphereColliderRadU.sub(sDist)
              const force = overlap.mul(sphereColliderStrU).mul(dtU)
              vel.addAssign(sDiff.div(sDist).mul(force))
            })
          })

          // Damping
          vel.mulAssign(float(1).sub(dampingU))

          // Velocity clamping — prevent tunneling through collision thickness
          const maxSpeed = collisionRadiusU.mul(0.2).div(dtU)
          const speed = length(vel)
          If(speed.greaterThan(maxSpeed), () => {
            vel.mulAssign(maxSpeed.div(speed))
          })

          // Save previous position
          prevPos.assign(pos)

          // Advance position
          pos.addAssign(vel.mul(dtU))

          // Ground collision
          If(groundEnabledU.greaterThan(0), () => {
            If(pos.y.lessThan(groundYU), () => {
              pos.assign(prevPositions.element(i))
              pos.y.assign(groundYU)
              // Friction — reduce horizontal velocity at ground contact
              const groundVel = pos.sub(prevPositions.element(i))
              pos.x.subAssign(groundVel.x.mul(groundFrictionU))
              pos.z.subAssign(groundVel.z.mul(groundFrictionU))
            })
          })
        })
      })
    })().compute(totalParticles)

    // ─── 3. Solve constraints ──────────────────────────────────────────────────

    this.#passSolveConstraints = Fn(() => {
      const i = instanceIndex

      If(i.lessThan(totalParticlesU), () => {
        const myInvM = invMasses.element(i)

        If(myInvM.greaterThan(0), () => {
          // --- Stretch phase ---
          const myPos = positions.element(i).toVar()
          const stretchCorr = vec3(0, 0, 0).toVar()
          const sCount = uint(stretchCounts.element(i))

          Loop(sCount, ({ i: j }) => {
            const neighbor = stretchNeighbors.element(i.mul(MAX_STRETCH).add(j))
            const otherId = uint(neighbor.x)
            const restLen = neighbor.y
            const otherPos = positions.element(otherId)
            const otherInvM = invMasses.element(otherId)

            const diff = myPos.sub(otherPos).toVar()
            const len = length(diff)

            If(len.greaterThan(1e-6), () => {
              const grad = diff.div(len)
              const C = len.sub(restLen)
              const w = myInvM.add(otherInvM)
              const s = C.negate().div(w.add(stretchAlphaU))
              stretchCorr.addAssign(grad.mul(s.mul(myInvM)))
            })
          })

          If(sCount.greaterThan(uint(0)), () => {
            positions.element(i).assign(myPos.add(stretchCorr.div(float(sCount))))
          })

          // --- Bend phase ---
          const myPos2 = positions.element(i).toVar()
          const bendCorr = vec3(0, 0, 0).toVar()
          const bCount = uint(bendCounts.element(i))

          Loop(bCount, ({ i: j }) => {
            const neighbor = bendNeighbors.element(i.mul(MAX_BEND).add(j))
            const otherId = uint(neighbor.x)
            const restLen = neighbor.y
            const otherPos = positions.element(otherId)
            const otherInvM = invMasses.element(otherId)

            const diff = myPos2.sub(otherPos).toVar()
            const len = length(diff)

            If(len.greaterThan(1e-6), () => {
              const grad = diff.div(len)
              const C = len.sub(restLen)
              const w = myInvM.add(otherInvM)
              const s = C.negate().div(w.add(bendAlphaU))
              bendCorr.addAssign(grad.mul(s.mul(myInvM)))
            })
          })

          If(bCount.greaterThan(uint(0)), () => {
            positions.element(i).assign(myPos2.add(bendCorr.div(float(bCount))))
          })
        })
      })
    })().compute(totalParticles)

    // ─── 4. Compute vertex normals ─────────────────────────────────────────────

    this.#passComputeNormals = Fn(() => {
      const i = instanceIndex

      If(i.lessThan(totalParticlesU), () => {
        const normal = vec3(0, 0, 0).toVar()
        const count = uint(triAdjCounts.element(i))

        Loop(count, ({ i: j }) => {
          const tri = triAdj.element(i.mul(MAX_TRI_ADJ).add(j))
          const pNext = positions.element(uint(tri.x))
          const pPrev = positions.element(uint(tri.y))
          const pSelf = positions.element(i)
          normal.addAssign(cross(pNext.sub(pSelf), pPrev.sub(pSelf)))
        })

        // Guard against degenerate normals (near-zero length → NaN after normalize)
        // at edge/corner vertices where adjacent triangle cross products may cancel
        const len = length(normal)
        const isValid = step(float(1e-6), len)
        const safeNormal = mix(vec3(0, 1, 0), normal.div(len.max(float(1e-6))), isValid)
        normalsBuffer.element(i).assign(vec4(safeNormal, 0))
      })
    })().compute(totalParticles)

    // ─── 5. Compute per-vertex strain for wrinkles ────────────────────────────

    const wrinkleThresholdU = this.#wrinkleThresholdU

    this.#passComputeStrain = Fn(() => {
      const i = instanceIndex

      If(i.lessThan(totalParticlesU), () => {
        const pos = positions.element(i)
        const normal = normalsBuffer.element(i).xyz
        const sCount = uint(stretchCounts.element(i))

        // Accumulate net tension vector from all stretched edges
        const tensionVec = vec3(0, 0, 0).toVar()

        Loop(sCount, ({ i: j }) => {
          const neighbor = stretchNeighbors.element(i.mul(MAX_STRETCH).add(j))
          const otherId = uint(neighbor.x)
          const restLen = neighbor.y
          const otherPos = positions.element(otherId)

          const edge = otherPos.sub(pos)
          const currentLen = length(edge)
          // positive strain = edge stretched beyond rest length
          const strain = currentLen.sub(restLen).div(restLen)

          If(strain.greaterThan(0), () => {
            tensionVec.addAssign(edge.div(currentLen).mul(strain))
          })
        })

        // Project onto tangent plane, get magnitude
        tensionVec.subAssign(normal.mul(dot(tensionVec, normal)))
        const rawMag = length(tensionVec)
        const dir = tensionVec.div(rawMag.max(1e-6))

        // Smoothstep the raw magnitude through threshold for clean falloff
        const t = rawMag.div(wrinkleThresholdU).clamp(0, 1)
        const weight = t.mul(t).mul(float(3).sub(t.mul(2)))

        const newStrain = vec4(dir, weight)

        // Temporal smoothing
        const oldStrain = strainBuffer.element(i)
        strainBuffer.element(i).assign(mix(oldStrain, newStrain, wrinkleSmoothingTimeU))
      })
    })().compute(totalParticles)

    // ─── 6. Spatial hash build (2 passes — fixed-size buckets, no prefix sum) ──

    // 6a. Clear bucket counts
    this.#passClearHash = Fn(() => {
      If(instanceIndex.lessThan(tableSizeU), () => {
        atomicStore(hashBucketCounts.element(instanceIndex), uint(0))
      })
    })().compute(tableSize)

    // 6b. Insert particles into buckets
    this.#passInsertHash = Fn(() => {
      If(instanceIndex.lessThan(totalParticlesU), () => {
        const h = hashFromPos(positions.element(instanceIndex))
        const slot = atomicAdd(hashBucketCounts.element(h), uint(1))
        If(slot.lessThan(uint(HASH_BUCKET_SIZE)), () => {
          hashBucketEntries.element(h.mul(uint(HASH_BUCKET_SIZE)).add(slot)).assign(uint(instanceIndex))
        })
      })
    })().compute(totalParticles)

    // ─── 6c. Compute per-body centroids + bounding radii ────────────────────────

    this.#passComputeCentroids = Fn(() => {
      const bodyIdx = instanceIndex
      If(bodyIdx.lessThan(uint(numBodies)), () => {
        const base = bodyIdx.mul(uint(particlesPerBody))
        const sum = vec3(0, 0, 0).toVar()

        Loop({ start: uint(0), end: uint(particlesPerBody), type: 'uint', name: 'k', condition: '<' }, ({ k }) => {
          sum.addAssign(positions.element(base.add(k)))
        })

        const centroid = sum.div(float(particlesPerBody)).toVar()

        const maxDist2 = float(0).toVar()
        Loop({ start: uint(0), end: uint(particlesPerBody), type: 'uint', name: 'k', condition: '<' }, ({ k }) => {
          const diff = positions.element(base.add(k)).sub(centroid)
          const d2 = dot(diff, diff)
          If(d2.greaterThan(maxDist2), () => {
            maxDist2.assign(d2)
          })
        })

        bodyCentroids.element(bodyIdx).assign(vec4(centroid, sqrt(maxDist2)))
      })
    })().compute(numBodies)

    // ─── 6d. Apply collision — spatial hash query + friction ─────────────────────
    //
    // Instead of brute-forcing all vertices per body, query 3×3×3 neighboring
    // hash cells to find nearby particles from other bodies.

    this.#passApplyCollision = Fn(() => {
      const i = instanceIndex

      If(i.lessThan(totalParticlesU), () => {
        const myBody = i.div(uint(particlesPerBody))
        const pos = positions.element(i)
        const prevPos = prevPositions.element(i)

        const thickness = collisionRadiusU
        const thickness2 = thickness.mul(thickness)

        // Compute this particle's cell coordinates
        const cx = cellCoordF(pos.x)
        const cy = cellCoordF(pos.y)
        const cz = cellCoordF(pos.z)

        // Accumulate corrections from all nearby other-body vertices
        const totalCorr = vec3(0, 0, 0).toVar()
        const collisionCount = float(0).toVar()

        // Query 3×3×3 neighboring cells
        Loop({ start: uint(0), end: uint(3), type: 'uint', name: 'dx', condition: '<' }, ({ dx }) => {
          Loop({ start: uint(0), end: uint(3), type: 'uint', name: 'dy', condition: '<' }, ({ dy }) => {
            Loop({ start: uint(0), end: uint(3), type: 'uint', name: 'dz', condition: '<' }, ({ dz }) => {
              const h = hashFromFloats(
                cx.add(float(dx)).sub(1.0),
                cy.add(float(dy)).sub(1.0),
                cz.add(float(dz)).sub(1.0),
              )
              const count = atomicLoad(hashBucketCounts.element(h))

              Loop(HASH_BUCKET_SIZE, ({ i: k }) => {
                If(uint(k).lessThan(count), () => {
                  const otherIdx = hashBucketEntries.element(h.mul(uint(HASH_BUCKET_SIZE)).add(uint(k)))
                  const otherBody = otherIdx.div(uint(particlesPerBody))

                  If(otherBody.notEqual(myBody), () => {
                    const otherPos = positions.element(otherIdx)
                    const diff = otherPos.sub(pos)
                    const d2 = dot(diff, diff)
                    If(d2.lessThan(thickness2).and(d2.greaterThan(1e-10)), () => {
                      const dist = sqrt(d2)
                      const overlap = thickness.sub(dist)
                      totalCorr.addAssign(diff.div(dist).mul(overlap).negate())
                      collisionCount.addAssign(1.0)
                    })
                  })
                })
              })
            })
          })
        })

        // Apply averaged correction with reduced factor
        If(collisionCount.greaterThan(0), () => {
          const correction = totalCorr.div(collisionCount).mul(0.3)
          pos.addAssign(correction)

          // Friction — reduce tangential velocity at contact
          const vel = pos.sub(prevPos)
          const corrDir = normalize(correction)
          const normalVel = corrDir.mul(dot(vel, corrDir))
          const tangentVel = vel.sub(normalVel)
          pos.subAssign(tangentVel.mul(frictionU))

          // Normal damping — absorb velocity in collision direction
          pos.subAssign(normalVel.mul(collisionDampingU))

          // Partial prevPos shift (absorbs energy instead of preserving full velocity)
          prevPos.addAssign(correction.mul(0.5))
        })

        // Ground collision
        If(groundEnabledU.greaterThan(0), () => {
          If(pos.y.lessThan(groundYU), () => {
            pos.y.assign(groundYU)
            const gVel = pos.sub(prevPos)
            pos.x.subAssign(gVel.x.mul(groundFrictionU))
            pos.z.subAssign(gVel.z.mul(groundFrictionU))
          })
        })


      })
    })().compute(totalParticles)

    // ─── 7. Reset ──────────────────────────────────────────────────────────────

    this.#passReset = Fn(() => {
      If(instanceIndex.lessThan(totalParticlesU), () => {
        positions.element(instanceIndex).assign(initialPositions.element(instanceIndex))
        prevPositions.element(instanceIndex).assign(initialPositions.element(instanceIndex))
        strainBuffer.element(instanceIndex).assign(vec4(0, 0, 0, 0))
      })
    })().compute(totalParticles)
  }

  #createInstancedDisplayMesh(data, buffers, bodies, uvData) {
    const { positions, normalsBuffer, strainBuffer } = buffers
    const numBodies = this.#numBodies
    const particlesPerBody = this.#particlesPerBody

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.pos, 3))
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvData, 2))
    geometry.setIndex(Array.from(data.index))
    geometry.computeVertexNormals()

    // Per-instance color buffers
    const colorsData = new Float32Array(numBodies * 3)
    const sheenColorsData = new Float32Array(numBodies * 3)

    for (let i = 0; i < numBodies; i++) {
      const c = bodies[i].color
      colorsData[i * 3] = c.r
      colorsData[i * 3 + 1] = c.g
      colorsData[i * 3 + 2] = c.b

      const sc = bodies[i].sheenColor
      sheenColorsData[i * 3] = sc.r
      sheenColorsData[i * 3 + 1] = sc.g
      sheenColorsData[i * 3 + 2] = sc.b
    }

    const colorsBuffer = instancedArray(colorsData, 'vec3')
    const sheenColorsBuffer = instancedArray(sheenColorsData, 'vec3')

    // Per-instance particle offset derived from instanceIndex
    const globalIdx = vertexIndex.add(instanceIndex.mul(uint(particlesPerBody)))

    const wrinkleFreqU = this.#wrinkleFrequencyU
    const wrinkleStrU = this.#wrinkleStrengthU
    const wrinkleGrazeU = this.#wrinkleGrazeAttenuationU
    const wrinkleScaleU = this.#wrinkleScaleU
    const wrinkleTurb2DU = this.#wrinkleTurbulence2DU
    const wrinkleTurb2DFreqU = this.#wrinkleTurbulence2DFrequencyU
    const wrinkleTurbU = this.#wrinkleTurbulenceU
    const wrinkleTurbFreqU = this.#wrinkleTurbulenceFrequencyU

    // Shared material — 1 pipeline for all bodies
    const material = new THREE.MeshPhysicalNodeMaterial({
      roughness: 0.6,
      metalness: 0,
      sheen: 1.0,
      sheenRoughness: 0.5,
    })

    material.positionNode = Fn(() => {
      return positions.element(globalIdx)
    })()

    // Pass per-vertex data as varyings for fragment-shader bump
    const vBaseNormal = normalsBuffer.element(globalIdx).xyz.toVarying('v_baseNormal')
    const vWeight = strainBuffer.element(globalIdx).w.toVarying('v_weight')

    // View-space normal from simulation (for perturbNormalArb)
    const viewNormal = cameraViewMatrix.transformDirection(vBaseNormal).toVarying('v_viewNormal').normalize()

    // Fabric texture UVs from geometry attribute (rotation-independent), scaled by textureScale
    const fabricUV = this.fabricTextures ? uv().mul(this.#textureScaleU) : null

    // Per-instance color and sheen color (fabric texture tints per-instance color)
    if (this.fabricTextures) {
      const fabricColor = texture(this.fabricTextures.color, fabricUV)
      const fabricAO = texture(this.fabricTextures.ao, fabricUV)
      const texturedColor = fabricColor.rgb.mul(fabricAO.r)
      const instanceColor = colorsBuffer.element(instanceIndex)
      // textureIntensity blends between flat instance color and textured color
      material.colorNode = mix(instanceColor, texturedColor.mul(instanceColor), this.#textureIntensityU)
      // roughness blends between base value and texture
      const texRoughness = texture(this.fabricTextures.roughness, fabricUV).r
      material.roughnessNode = mix(this.#roughnessBaseU, texRoughness, this.#textureIntensityU)
    } else {
      material.colorNode = colorsBuffer.element(instanceIndex)
    }
    material.sheenColorNode = sheenColorsBuffer.element(instanceIndex)

    // Procedural normal map via analytical derivatives + TBN
    material.normalNode = Fn(() => {
      // Unrotated local coordinates from UV (rotation-independent)
      const csz = this.cushionSize || 1
      const x = uv().x.sub(0.5).mul(csz)
      const z = uv().y.sub(0.5).mul(csz)
      const localPos = vec3(x, float(0), z)
      const ax = abs(x)
      const az = abs(z)
      const f = wrinkleFreqU

      // Each edge gets independent streaks, confined by step
      const isLR = step(az, ax)

      // Noise-based domain warp along perpendicular axis only
      // 2D noise — phase offset from both axes (bends streaks)
      const n2D = mx_noise_float(localPos.mul(wrinkleTurb2DFreqU))
      const phaseOffset = n2D.mul(wrinkleTurb2DU).mul(6.28)

      // 1D noise — warp perpendicular axis only (irregular width, no bending)
      const nZ = mx_noise_float(vec3(0, 0, z.mul(wrinkleTurbFreqU)))
      const nX = mx_noise_float(vec3(x.mul(wrinkleTurbFreqU), 0, 0))
      const warpedZ = z.add(nZ.mul(wrinkleTurbU).div(f))
      const warpedX = x.add(nX.mul(wrinkleTurbU).div(f))

      // Cosine wave shape matching the sin height field (same amplitudes, no frequency multiplier)
      // Used as gradient direction for the normal map — wrinkleStrU controls perturbation strength
      // d(hLR)/dz
      const dhLR_dz = cos(warpedZ.mul(f).add(phaseOffset))
        .mul(0.6)
        .add(cos(warpedZ.mul(f.mul(2.13)).add(1.7).add(phaseOffset.mul(1.3))).mul(0.64))
        .add(cos(warpedZ.mul(f.mul(4.37)).add(3.1).add(phaseOffset.mul(0.7))).mul(0.44))

      // d(hFB)/dx
      const dhFB_dx = cos(warpedX.mul(f).add(phaseOffset))
        .mul(0.6)
        .add(cos(warpedX.mul(f.mul(2.13)).add(1.7).add(phaseOffset.mul(1.3))).mul(0.64))
        .add(cos(warpedX.mul(f.mul(4.37)).add(3.1).add(phaseOffset.mul(0.7))).mul(0.44))

      // Fade out at grazing angles to prevent edge artifacts
      const NdotV = dot(viewNormal, positionView.normalize().negate()).clamp(0, 1)
      const grazeAttenuation = NdotV.smoothstep(0, wrinkleGrazeU)

      // Combined gradient scaled by strain weight and parameters
      const amplitude = vWeight.mul(wrinkleScaleU).mul(wrinkleStrU).mul(grazeAttenuation)
      const gradX = mix(dhFB_dx, float(0), isLR).mul(amplitude)
      const gradZ = mix(float(0), dhLR_dz, isLR).mul(amplitude)

      // Tangent-space normal from analytical gradient + fabric normal map
      let tsX = gradX.negate()
      let tsY = gradZ.negate()
      if (fabricUV) {
        const fabricN = texture(this.fabricTextures.normal, fabricUV).xyz.mul(2).sub(1)
        tsX = tsX.add(fabricN.x.mul(this.#fabricNormalStrengthU))
        tsY = tsY.add(fabricN.y.mul(this.#fabricNormalStrengthU))
      }
      const tsNormal = vec3(tsX, tsY, float(1)).normalize()

      // Build TBN aligned with local X/Z by projecting world axes onto tangent plane
      const N_world = vBaseNormal.normalize()
      const rawT = vec3(1, 0, 0).sub(N_world.mul(N_world.x))
      const T_world = rawT.div(length(rawT).max(0.001))
      const rawB = vec3(0, 0, 1).sub(N_world.mul(N_world.z))
      const B_world = rawB.div(length(rawB).max(0.001))

      // Transform TBN to view space and apply tangent-space normal
      const T_view = cameraViewMatrix.transformDirection(T_world).normalize()
      const B_view = cameraViewMatrix.transformDirection(B_world).normalize()
      const N_view = viewNormal

      return T_view.mul(tsNormal.x).add(B_view.mul(tsNormal.y)).add(N_view.mul(tsNormal.z)).normalize()
    })()

    // White wireframe material using same positionNode (reuses MeshPhysicalNodeMaterial
    // to avoid WebGPU pipeline caching bug with simpler material types)
    const wireMat = new THREE.MeshPhysicalNodeMaterial({
      color: 0xffffff,
      wireframe: true,
    })
    wireMat.positionNode = material.positionNode

    // Strain debug material: blue (0) → red (max) weight map
    const strainDebugMat = new THREE.MeshPhysicalNodeMaterial({
      roughness: 1,
      metalness: 0,
    })
    strainDebugMat.positionNode = material.positionNode
    const baseNormalForDebug = Fn(() => {
      return normalsBuffer.element(globalIdx).xyz
    })()
    strainDebugMat.normalNode = cameraViewMatrix
      .transformDirection(baseNormalForDebug)
      .toVarying('v_debugNormal')
      .normalize()
    const wrinkleDbgU = this.#wrinkleScaleU
    strainDebugMat.colorNode = Fn(() => {
      const weight = strainBuffer.element(globalIdx).w.mul(wrinkleDbgU)
      // Blue (no strain) → Red (high strain); weight is already smoothstepped
      return mix(vec3(0, 0, 1), vec3(1, 0, 0), weight.clamp(0, 1))
    })()

    const mesh = new THREE.InstancedMesh(geometry, material, numBodies)
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.frustumCulled = false
    this.#scene.add(mesh)
    this.#clothMeshes.push(mesh)
    this.#clothMaterials.push(material)
    this.#wireframeMaterials.push(wireMat)
    this.#strainDebugMaterials.push(strainDebugMat)
  }

  async compute() {
    const sdt = 1 / 60 / this.numSubsteps

    this.#substepAccumulator += this.numSubsteps * this.timescale
    const stepsThisFrame = Math.floor(this.#substepAccumulator)
    this.#substepAccumulator -= stepsThisFrame

    if (stepsThisFrame === 0) return

    this.#simTime += stepsThisFrame * sdt
    const pressureRamp = Math.min(1, this.#simTime / this.pressureRampTime)

    this.#collisionRadiusU.value = this.collisionRadius
    this.#frictionU.value = this.collisionFriction
    this.#collisionDampingU.value = this.collisionDamping
    this.#groundYU.value = typeof this.groundY === 'number' ? this.groundY : 0
    this.#groundEnabledU.value = typeof this.groundY === 'number' ? 1 : 0
    this.#groundFrictionU.value = this.groundFriction
    this.#hashSpacingU.value = this.collisionRadius * 2
    this.#dtU.value = sdt
    this.#gravityU.value = this.gravity
    this.#dampingU.value = this.damping
    this.#pressureU.value = this.pressure * pressureRamp
    this.#pressureStiffnessU.value = this.pressureStiffness
    this.#stretchAlphaU.value = this.stretchingCompliance / sdt / sdt
    this.#bendAlphaU.value = this.bendingCompliance / sdt / sdt
    this.#wrinkleFrequencyU.value = this.wrinkleFrequency
    this.#wrinkleStrengthU.value = this.wrinklesEnabled ? this.wrinkleStrength : 0
    this.#wrinkleSmoothingTimeU.value = this.wrinkleSmoothingTime
    this.#wrinkleGrazeAttenuationU.value = this.wrinkleGrazeAttenuation
    this.#wrinkleThresholdU.value = this.wrinkleThreshold
    this.#wrinkleScaleU.value = this.wrinkleScale
    this.#wrinkleTurbulence2DU.value = this.wrinkleTurbulence2D
    this.#wrinkleTurbulence2DFrequencyU.value = this.wrinkleTurbulence2DFrequency
    this.#wrinkleTurbulenceU.value = this.wrinkleTurbulence
    this.#wrinkleTurbulenceFrequencyU.value = this.wrinkleTurbulenceFrequency
    this.#attractorPositionU.value.set(...this.attractorPosition)
    this.#attractorStrengthU.value = this.attractorStrength
    this.#attractorRadiusU.value = this.attractorRadius
    this.#attractorRadiusMaxU.value = this.attractorRadiusMax
    this.#wanderStrengthU.value = this.wanderStrength
    this.#wanderSpeedU.value = this.wanderSpeed
    this.#sphereColliderPositionU.value.set(...this.sphereColliderPosition)
    this.#sphereColliderRadiusU.value = this.sphereColliderRadius
    this.#sphereColliderStrengthU.value = this.sphereColliderStrength
    this.#sphereColliderEnabledU.value = this.sphereColliderEnabled ? 1 : 0
    this.#simTimeU.value = this.#simTime
    this.#textureScaleU.value = this.textureScale
    this.#textureIntensityU.value = this.textureIntensity
    this.#fabricNormalStrengthU.value = this.fabricNormalStrength
    this.#roughnessBaseU.value = this.roughnessBase

    const batch = []

    // Volume + centroids once before substeps
    batch.push(this.#passComputeVolume)
    batch.push(this.#passComputeCentroids)

    for (let step = 0; step < stepsThisFrame; step++) {
      batch.push(this.#passPreSolve)
      batch.push(this.#passSolveConstraints)
      // Rebuild spatial hash each substep (positions change after solve)
      batch.push(this.#passClearHash)
      batch.push(this.#passInsertHash)
      batch.push(this.#passApplyCollision)
    }

    // Normals + strain once after all substeps
    batch.push(this.#passComputeNormals)
    batch.push(this.#passComputeStrain)

    await this.#renderer.computeAsync(batch)
  }

  async reset() {
    this.#simTime = 0
    this.#substepAccumulator = 0
    await this.#renderer.computeAsync(this.#passReset)
  }

  async readCentroids() {
    return new Float32Array(await this.#renderer.getArrayBufferAsync(this.#bodyCentroidsBuffer.value))
  }

  get materials() {
    return this.#clothMaterials
  }

  setDebug(visible) {
    for (let i = 0; i < this.#clothMeshes.length; i++) {
      this.#clothMeshes[i].material = visible ? this.#wireframeMaterials[i] : this.#clothMaterials[i]
      this.#clothMeshes[i].castShadow = !visible
    }
  }

  setShowWrinkles(visible) {
    for (let i = 0; i < this.#clothMeshes.length; i++) {
      this.#clothMeshes[i].material = visible ? this.#strainDebugMaterials[i] : this.#clothMaterials[i]
      this.#clothMeshes[i].castShadow = !visible
    }
  }

  dispose() {
    for (const mesh of this.#clothMeshes) {
      this.#scene.remove(mesh)
      mesh.geometry.dispose()
      mesh.material.dispose()
    }
    for (const mat of this.#wireframeMaterials) {
      mat.dispose()
    }
    for (const mat of this.#strainDebugMaterials) {
      mat.dispose()
    }
    this.#clothMeshes.length = 0
    this.#clothMaterials.length = 0
    this.#wireframeMaterials.length = 0
    this.#strainDebugMaterials.length = 0
  }
}
