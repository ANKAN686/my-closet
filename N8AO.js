/**
 * N8AO - WebGPU/TSL port of n8ao (https://github.com/N8python/n8ao)
 * Screen-space ambient occlusion with hemisphere sampling, blue noise, and Poisson blur denoising.
 */
import {
  DataTexture,
  RenderTarget,
  RepeatWrapping,
  NearestFilter,
  NoColorSpace,
  Vector2,
  Vector3,
  TempNode,
  QuadMesh,
  NodeMaterial,
  RendererUtils,
} from 'three/webgpu'
import {
  Fn,
  float,
  vec2,
  vec3,
  vec4,
  int,
  uv,
  uniform,
  uniformArray,
  reference,
  Loop,
  If,
  texture,
  passTexture,
  NodeUpdateType,
  nodeObject,
  normalize,
  cross,
  dot,
  abs,
  smoothstep,
  clamp,
  fract,
  cos,
  sin,
  step,
  max,
  exp,
  mix,
  mat3,
  PI,
} from 'three/tsl'
import bluenoiseData from 'n8ao/src/BlueNoise.js'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const _quadMesh = /* @__PURE__ */ new QuadMesh()
const _size = /* @__PURE__ */ new Vector2()
let _rendererState

function generateHemisphereSamples(n) {
  const points = []
  for (let k = 0; k < n; k++) {
    const theta = 2.399963 * k // golden angle
    const r = Math.sqrt(k + 0.5) / Math.sqrt(n)
    const x = r * Math.cos(theta)
    const y = r * Math.sin(theta)
    const z = Math.sqrt(1 - (x * x + y * y))
    points.push(new Vector3(x, y, z))
  }
  return points
}

function generateDenoiseSamples(numSamples, numRings) {
  const angleStep = (2 * Math.PI * numRings) / numSamples
  const invNumSamples = 1.0 / numSamples
  const samples = []
  let radius = invNumSamples
  let angle = 0
  for (let i = 0; i < numSamples; i++) {
    samples.push(new Vector2(Math.cos(angle), Math.sin(angle)).multiplyScalar(Math.pow(radius, 0.75)))
    radius += invNumSamples
    angle += angleStep
  }
  return samples
}

function createBlueNoiseTexture() {
  const tex = new DataTexture(bluenoiseData, 128, 128)
  tex.colorSpace = NoColorSpace
  tex.wrapS = RepeatWrapping
  tex.wrapT = RepeatWrapping
  tex.minFilter = NearestFilter
  tex.magFilter = NearestFilter
  tex.needsUpdate = true
  return tex
}

// ─── N8AONode ─────────────────────────────────────────────────────────────────

class N8AONode extends TempNode {
  static get type() {
    return 'N8AONode'
  }

  constructor(depthNode, normalNode, camera) {
    super('vec4')

    this.depthNode = depthNode
    this.normalNode = normalNode
    this._camera = camera

    this.updateBeforeType = NodeUpdateType.FRAME

    // ── Config ────────────────────────────────────────────────────
    this.denoiseIterations = 2
    this.resolutionScale = 1

    // ── Render targets ────────────────────────────────────────────
    this._blurA = new RenderTarget(1, 1, { depthBuffer: false })
    this._blurB = new RenderTarget(1, 1, { depthBuffer: false })
    this._blurA.texture.name = 'N8AO.blurA'
    this._blurB.texture.name = 'N8AO.blurB'

    // ── Uniforms ──────────────────────────────────────────────────
    this._radiusU = uniform(5.0)
    this._intensityU = uniform(5.0)
    this._distanceFalloffU = uniform(1.0)
    this._denoiseRadiusU = uniform(12.0)
    this._screenSpaceRadiusU = uniform(0) // 0 = world-space, 1 = screen-space
    this._temporalJitterU = uniform(0) // 0 = off, 1 = on
    this._resolution = uniform(new Vector2())

    this._cameraNear = reference('near', 'float', camera)
    this._cameraFar = reference('far', 'float', camera)
    this._cameraProjectionMatrix = uniform(camera.projectionMatrix)
    this._cameraProjectionMatrixInverse = uniform(camera.projectionMatrixInverse)

    this._frame = uniform(0)
    this._denoiseIndex = uniform(0)
    this._aoSamplesCountU = uniform(16)
    this._denoiseSamplesCountU = uniform(8)

    // Hemisphere samples (golden-angle spiral) – max-size arrays, loop count controlled by uniform
    this._samplesU = uniformArray(generateHemisphereSamples(32), 'vec3')

    // Poisson disk denoise samples – max-size array
    this._denoiseSamplesU = uniformArray(generateDenoiseSamples(16, 11), 'vec2')

    // Blue noise texture
    this._blueNoise = createBlueNoiseTexture()
    this._blueNoiseNode = texture(this._blueNoise)

    // Dynamic texture reference for blur input (ping-pong)
    this._blurInputTex = texture(this._blurA.texture)

    // Materials
    this._aoMaterial = new NodeMaterial()
    this._aoMaterial.name = 'N8AO'
    this._blurMaterial = new NodeMaterial()
    this._blurMaterial.name = 'N8AO_Blur'

    // Output
    this._textureNode = passTexture(this, this._blurA.texture)

    this._frameCount = 0
  }

  // Getters return the uniform node (for TSL & GUI `.value` binding).
  // Setters allow convenient `aoPass.radius = 5` syntax.
  get radius() {
    return this._radiusU
  }
  set radius(v) {
    this._radiusU.value = v
  }
  get intensity() {
    return this._intensityU
  }
  set intensity(v) {
    this._intensityU.value = v
  }
  get distanceFalloff() {
    return this._distanceFalloffU
  }
  set distanceFalloff(v) {
    this._distanceFalloffU.value = v
  }
  get denoiseRadius() {
    return this._denoiseRadiusU
  }
  set denoiseRadius(v) {
    this._denoiseRadiusU.value = v
  }
  get screenSpaceRadius() {
    return this._screenSpaceRadiusU
  }
  set screenSpaceRadius(v) {
    this._screenSpaceRadiusU.value = v
  }
  get temporalJitter() {
    return this._temporalJitterU
  }
  set temporalJitter(v) {
    this._temporalJitterU.value = v
  }
  get aoSamples() {
    return this._aoSamplesCountU
  }
  set aoSamples(v) {
    this._aoSamplesCountU.value = v
  }
  get denoiseSamples() {
    return this._denoiseSamplesCountU
  }
  set denoiseSamples(v) {
    this._denoiseSamplesCountU.value = v
  }

  getTextureNode() {
    return this._textureNode
  }

  setSize(width, height) {
    this._resolution.value.set(width, height)
    this._blurA.setSize(width, height)
    this._blurB.setSize(width, height)
  }

  updateBefore(frame) {
    const { renderer } = frame
    _rendererState = RendererUtils.resetRendererState(renderer, _rendererState)

    const size = renderer.getDrawingBufferSize(_size)
    const s = this.resolutionScale
    this.setSize(Math.ceil(size.width * s), Math.ceil(size.height * s))
    this._frame.value = this._frameCount++

    // Clear to white so background (discarded) pixels = 1.0 (no occlusion)
    renderer.setClearColor(0xffffff, 1)

    // Ping-pong: ensure final result lands in _blurA
    const startInA = this.denoiseIterations % 2 === 0
    let readTarget = startInA ? this._blurA : this._blurB
    let writeTarget = startInA ? this._blurB : this._blurA

    // AO pass
    _quadMesh.material = this._aoMaterial
    renderer.setRenderTarget(readTarget)
    _quadMesh.render(renderer)

    // Denoise passes
    for (let i = 0; i < this.denoiseIterations; i++) {
      this._blurInputTex.value = readTarget.texture
      this._denoiseIndex.value = i
      _quadMesh.material = this._blurMaterial
      renderer.setRenderTarget(writeTarget)
      _quadMesh.render(renderer)
      ;[readTarget, writeTarget] = [writeTarget, readTarget]
    }
    // Result is now in _blurA (readTarget after final swap)

    RendererUtils.restoreRendererState(renderer, _rendererState)
  }

  setup(builder) {
    // ── Captured references ───────────────────────────────────────
    const projMatU = this._cameraProjectionMatrix
    const projMatInvU = this._cameraProjectionMatrixInverse
    const resolutionU = this._resolution
    const nearU = this._cameraNear
    const farU = this._cameraFar
    const radiusU = this._radiusU
    const distanceFalloffU = this._distanceFalloffU
    const frameU = this._frame
    const temporalJitterU = this._temporalJitterU
    const samplesU = this._samplesU
    const blueNoiseNode = this._blueNoiseNode
    const screenSpaceRadiusU = this._screenSpaceRadiusU
    const depthNode = this.depthNode
    const denoiseRadiusU = this._denoiseRadiusU
    const denoiseSamplesU = this._denoiseSamplesU
    const denoiseIndexU = this._denoiseIndex
    const blurInputTexNode = this._blurInputTex
    const aoSamplesCountU = this._aoSamplesCountU
    const denoiseSamplesCountU = this._denoiseSamplesCountU

    // ── Shared helpers ────────────────────────────────────────────

    // Reconstruct view-space position from depth + UV
    const getViewPos = (depthVal, coordVal) => {
      const z = depthVal.mul(2.0).sub(1.0)
      const clipPos = vec4(coordVal.mul(2.0).sub(1.0), z, 1.0)
      const viewPos = projMatInvU.mul(clipPos)
      return viewPos.xyz.div(viewPos.w)
    }

    const sampleDepth = (uvCoord) => depthNode.sample(uvCoord).r

    // Compute normal from depth buffer (improved 5-tap method from n8ao)
    const computeNormal = (uvCoord) => {
      const texelSize = vec2(1.0).div(resolutionU)

      const c0 = sampleDepth(uvCoord)
      const l2 = sampleDepth(uvCoord.sub(vec2(texelSize.x.mul(2.0), 0.0)))
      const l1 = sampleDepth(uvCoord.sub(vec2(texelSize.x, 0.0)))
      const r1 = sampleDepth(uvCoord.add(vec2(texelSize.x, 0.0)))
      const r2 = sampleDepth(uvCoord.add(vec2(texelSize.x.mul(2.0), 0.0)))
      const b2 = sampleDepth(uvCoord.sub(vec2(0.0, texelSize.y.mul(2.0))))
      const b1 = sampleDepth(uvCoord.sub(vec2(0.0, texelSize.y)))
      const t1 = sampleDepth(uvCoord.add(vec2(0.0, texelSize.y)))
      const t2 = sampleDepth(uvCoord.add(vec2(0.0, texelSize.y.mul(2.0))))

      const dl = abs(l1.mul(2.0).sub(l2).sub(c0))
      const dr = abs(r1.mul(2.0).sub(r2).sub(c0))
      const db = abs(b1.mul(2.0).sub(b2).sub(c0))
      const dt = abs(t1.mul(2.0).sub(t2).sub(c0))

      const ce = getViewPos(c0, uvCoord)

      const dpdx = dl
        .lessThan(dr)
        .select(
          ce.sub(getViewPos(l1, uvCoord.sub(vec2(texelSize.x, 0.0)))),
          getViewPos(r1, uvCoord.add(vec2(texelSize.x, 0.0))).sub(ce),
        )
      const dpdy = db
        .lessThan(dt)
        .select(
          ce.sub(getViewPos(b1, uvCoord.sub(vec2(0.0, texelSize.y)))),
          getViewPos(t1, uvCoord.add(vec2(0.0, texelSize.y))).sub(ce),
        )

      return normalize(cross(dpdx, dpdy))
    }

    // ── AO Shader ─────────────────────────────────────────────────
    const aoFn = Fn(() => {
      const vuv = uv()
      const depth = sampleDepth(vuv).toVar()

      depth.greaterThanEqual(1.0).discard()

      const viewPos = getViewPos(depth, vuv).toVar()
      const normal = computeNormal(vuv).toVar()

      // Blue noise (tiled at 128px), with optional temporal jitter
      const noiseUV = vuv.mul(resolutionU).div(128.0)
      const noise = blueNoiseNode.sample(noiseUV)
      const harmNum = vec2(1.618033988749895, 1.324717957244746)
      const jittered = fract(noise.rg.add(harmNum.mul(frameU)))
      const noiseRG = mix(noise.rg, jittered, temporalJitterU).toVar()

      // Build rotated TBN matrix
      const helperVec = vec3(0.0, 1.0, 0.0).toVar()
      If(abs(dot(helperVec, normal)).greaterThan(0.99), () => {
        helperVec.assign(vec3(1.0, 0.0, 0.0))
      })
      const tangent = normalize(cross(helperVec, normal)).toVar()
      const bitangent = cross(normal, tangent).toVar()

      // Bake blue-noise rotation into TBN (avoids mat3×mat3)
      const angle = noiseRG.x.mul(PI.mul(2.0))
      const cosR = cos(angle)
      const sinR = sin(angle)
      const rotT = tangent.mul(cosR).add(bitangent.mul(sinR))
      const rotB = tangent.mul(sinR.negate()).add(bitangent.mul(cosR))
      const tbn = mat3(rotT, rotB, normal)

      // Sampling
      const occluded = float(0.0).toVar()
      const totalWeight = float(0.0).toVar()

      // Radius
      const radiusToUse = screenSpaceRadiusU
        .greaterThan(0.5)
        .select(
          getViewPos(depth, vuv.add(vec2(radiusU, 0.0).div(resolutionU)))
            .sub(viewPos)
            .length(),
          radiusU,
        )
        .toVar()

      const distFalloff = screenSpaceRadiusU
        .greaterThan(0.5)
        .select(radiusToUse.mul(distanceFalloffU), radiusToUse.mul(distanceFalloffU).mul(0.2))
        .toVar()

      const offsetMove = noiseRG.y.toVar()
      const offsetMoveInv = float(1.0).div(aoSamplesCountU)

      const farTimesNear = farU.mul(nearU)
      const farMinusNear = farU.sub(nearU)

      Loop({ start: int(0), end: int(aoSamplesCountU), type: 'int', condition: '<' }, ({ i }) => {
        const sampleDirection = tbn.mul(samplesU.element(i))

        const moveAmt = fract(offsetMove)
        offsetMove.addAssign(offsetMoveInv)

        const samplePos = viewPos.add(sampleDirection.mul(radiusToUse.mul(moveAmt)))

        // Project to screen
        const projected = projMatU.mul(vec4(samplePos, 1.0)).toVar()
        const screenXYZ = projected.xyz.div(projected.w).mul(0.5).add(0.5).toVar()

        // Bounds check: all components in (0, 1)
        const inBounds = screenXYZ.x
          .mul(float(1.0).sub(screenXYZ.x))
          .greaterThan(0.0)
          .and(screenXYZ.y.mul(float(1.0).sub(screenXYZ.y)).greaterThan(0.0))
          .and(screenXYZ.z.mul(float(1.0).sub(screenXYZ.z)).greaterThan(0.0))

        If(inBounds, () => {
          const sampleDepthVal = sampleDepth(screenXYZ.xy).toVar()

          // Linearize depths for distance comparison
          const distSample = farTimesNear.div(farU.sub(sampleDepthVal.mul(farMinusNear)))
          const distWorld = farTimesNear.div(farU.sub(screenXYZ.z.mul(farMinusNear)))

          // Distance-based falloff
          const rangeCheck = smoothstep(0.0, 1.0, distFalloff.div(abs(distSample.sub(distWorld))))

          // Self-occlusion prevention
          const fragCoord = vuv.mul(resolutionU)
          const sampleCoord = screenXYZ.xy.mul(resolutionU)
          const diff = fragCoord.sub(sampleCoord)

          const contribution = rangeCheck
            .mul(step(float(0.001), abs(distSample.sub(distWorld)))) // depths differ
            .mul(step(float(0.001), abs(sampleDepthVal.sub(depth)))) // raw depths differ
            .mul(step(distSample, distWorld)) // sample behind surface
            .mul(step(float(1.0), dot(diff, diff))) // not same pixel

          occluded.addAssign(contribution)
          totalWeight.addAssign(1.0)
        })
      })

      const occ = clamp(float(1.0).sub(occluded.div(max(totalWeight, 1.0))), 0.0, 1.0)
      return vec4(occ, normal.mul(0.5).add(0.5))
    })

    this._aoMaterial.fragmentNode = aoFn().context(builder.getSharedContext())
    this._aoMaterial.needsUpdate = true

    // ── Denoise Shader (Poisson blur) ─────────────────────────────
    const denoiseFn = Fn(() => {
      const vuv = uv()
      const texelSize = vec2(1.0).div(resolutionU)

      const data = blurInputTexNode.sample(vuv).toVar()
      const d = sampleDepth(vuv).toVar()

      // Background: pass through
      const result = data.toVar()

      If(d.lessThan(1.0), () => {
        const occlusion = data.r.toVar()
        const normal = data.gba.mul(2.0).sub(1.0).toVar()
        const count = float(1.0).toVar()
        const viewPos = getViewPos(d, vuv).toVar()

        // Blue noise rotation (different channel per iteration)
        const noiseUV = vuv.mul(resolutionU).div(128.0)
        const noiseVal = blueNoiseNode.sample(noiseUV)
        const noiseAngle = denoiseIndexU
          .equal(0)
          .select(
            noiseVal.w,
            denoiseIndexU.equal(1).select(noiseVal.z, denoiseIndexU.equal(2).select(noiseVal.y, noiseVal.x)),
          )
          .mul(PI.mul(2.0))

        const cosA = cos(noiseAngle)
        const sinA = sin(noiseAngle)

        // World radius for falloff
        const wRadius = screenSpaceRadiusU
          .greaterThan(0.5)
          .select(
            getViewPos(d, vuv.add(vec2(radiusU, 0.0).div(resolutionU)))
              .sub(viewPos)
              .length(),
            radiusU,
          )
          .toVar()

        const distFalloff = screenSpaceRadiusU
          .greaterThan(0.5)
          .select(wRadius.mul(distanceFalloffU), wRadius.mul(distanceFalloffU).mul(0.2))
          .toVar()

        const invDistFalloff = float(1.0).div(distFalloff)

        Loop({ start: int(0), end: int(denoiseSamplesCountU), type: 'int', condition: '<' }, ({ i }) => {
          const disk = denoiseSamplesU.element(i)
          // Apply rotation
          const rotatedOffset = vec2(disk.x.mul(cosA).sub(disk.y.mul(sinA)), disk.x.mul(sinA).add(disk.y.mul(cosA)))
          const offset = rotatedOffset.mul(texelSize).mul(denoiseRadiusU)

          const dataSample = blurInputTexNode.sample(vuv.add(offset))
          const occSample = dataSample.r
          const normalSample = dataSample.gba.mul(2.0).sub(1.0)

          const dSample = sampleDepth(vuv.add(offset))
          const viewPosSample = getViewPos(dSample, vuv.add(offset))

          const tangentPlaneDist = abs(dot(viewPosSample.sub(viewPos), normal))
          const rangeCheck = step(float(0.001), float(1.0).sub(dSample)) // not background
            .mul(exp(tangentPlaneDist.negate().mul(invDistFalloff)))
            .mul(max(dot(normal, normalSample), 0.0))

          occlusion.addAssign(occSample.mul(rangeCheck))
          count.addAssign(rangeCheck)
        })

        If(count.greaterThan(0.0), () => {
          occlusion.assign(occlusion.div(count))
        })
        occlusion.assign(clamp(occlusion, 0.0, 1.0))

        result.assign(vec4(occlusion, normal.mul(0.5).add(0.5)))
      })

      return result
    })

    this._blurMaterial.fragmentNode = denoiseFn()
    this._blurMaterial.needsUpdate = true

    return this._textureNode
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

function n8ao(depthNode, normalNode, camera) {
  return nodeObject(new N8AONode(depthNode, normalNode, camera))
}

export { N8AONode, n8ao }
