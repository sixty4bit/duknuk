import * as THREE from 'three'
import { toonMaterial, addOutline } from '../art/toon.js'

// Tunable: seconds for a fully-bare cell to regrow to fully-lush.
export const REGROW_SECONDS = 90

const CELL_SIZE = 1
const BUCKET_LEVELS = 64
const BEST_SPOT_MIN_FOOD = 0.08
const DISTANCE_WEIGHT = 0.12
const PIXELS_PER_CELL = 24
const MAX_CANVAS = 512
const RENDER_Y = 0.03
const RING_COLOR = 0x2c4a1e
// The patch boundary is the core mechanic's affordance — bolder than the
// frame's default ink weight (toon.js INK_PIXELS) so it reads as the single
// most legible line on screen, and always wins the depth test against the
// ground it sits on (see the depthTest override applied after addOutline in
// _buildVisuals) since it is a UI-grade affordance, not a lit 3D edge.
const RING_INK_PIXELS = 4
// World-space height of the (invisible) rim wall used only to give the ink
// outline real outward-facing normals to expand along — see buildWallGeometry.
// Tall enough that the shell has real vertical body to read against the
// ground on arcs where the wall runs near-tangent to the camera.
const RING_WALL_HEIGHT = 0.35
// Gaussian blur radius (in canvas px) applied over the raw cell fill so cell
// boundaries feather instead of stair-stepping. At PIXELS_PER_CELL=24 there
// is enough resolution for this to actually hide the per-cell grid.
const FEATHER_PX = 3.5

// Lush must be the frame's brightest, most saturated note — a monotone
// descending value ramp from lush to bare — so depletion reads from value
// alone at a glance. Fresh grass in a cartoon is bright yellow-green, not a
// dark tone that risks reading as a hole or shadow against the field.
// Grazed-out fades through dusty gold to dark umber. Tuned against the
// *decoded* (sRGB colorSpace) texture output, not raw canvas hex — see the
// colorSpace assignment in _buildVisuals.
const LUSH = new THREE.Color('#8fdc45')
const THIN = new THREE.Color('#d4ae38')
const BARE = new THREE.Color('#96652f')

function foodColor(t, target = new THREE.Color()) {
  if (t >= 0.5) return target.copy(THIN).lerp(LUSH, (t - 0.5) * 2)
  return target.copy(BARE).lerp(THIN, t * 2)
}

// A stable (non-random) wobble so the boundary reads as hand-drawn but never
// re-jitters between rebuilds. Both the fill disc and the ink-outline rim
// wall are built from these exact points, so they can never drift apart —
// the fill can neither bleed past nor fall short of the line.
function buildWobbledOutline(radius, segments = 72) {
  const centers = []
  for (let s = 0; s <= segments; s++) {
    const t = (s / segments) * Math.PI * 2
    const wobble = 1 + 0.05 * Math.sin(t * 5 + 1.3) + 0.025 * Math.sin(t * 11 + 0.6)
    const r = radius * wobble
    centers.push([Math.cos(t) * r, Math.sin(t) * r])
  }
  return centers
}

// Flat triangle fan across the wobbled boundary, built directly in the
// group's local XZ plane (no object rotation trick). UVs mirror
// THREE.CircleGeometry's own mapping (normalized by the nominal, un-wobbled
// diameter) so the canvas texture lands the same way it did before.
function buildDiscGeometry(radius, centers) {
  const positions = [0, 0, 0]
  const uvs = [0.5, 0.5]
  // Normalized against a diameter padded past the wobble's outward peak
  // (1 + 0.05 + 0.025 = 1.075x radius) so outward-wobble arcs never push uv
  // to/past 1.0 and clamp — that clamp was stretching the edge texel
  // radially outward, smearing fill past the boundary on those arcs.
  const uvDiameter = radius * 2 * 1.08
  for (const [cx, cz] of centers) {
    positions.push(cx, 0, cz)
    uvs.push(cx / uvDiameter + 0.5, cz / uvDiameter + 0.5)
  }
  const segments = centers.length - 1
  const index = []
  for (let s = 0; s < segments; s++) {
    // Wound so computeVertexNormals lands on +Y (up) — center, far, near.
    index.push(0, s + 2, s + 1)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geo.setIndex(index)
  geo.computeVertexNormals()
  return geo
}

// A thin, invisible standing wall traced exactly along the wobbled boundary.
// It exists only so addOutline() has real outward-facing rim normals to
// expand along — a flat disc's normals all point straight up, which gives the
// ink shader nothing to push radially. The wall itself is never drawn (see
// the colorWrite:false material in _buildVisuals); only its generated ink
// shell is, which is what makes the ring hold constant screen-space
// INK_PIXELS like every other outline in the frame instead of a constant
// world-space thickness.
function buildWallGeometry(centers, height) {
  const positions = []
  for (const [cx, cz] of centers) {
    positions.push(cx, 0, cz, cx, height, cz)
  }
  const segments = centers.length - 1
  const index = []
  for (let s = 0; s < segments; s++) {
    const a = s * 2
    const b = a + 1
    const c = a + 2
    const d = a + 3
    index.push(a, b, c, b, d, c)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setIndex(index)
  geo.computeVertexNormals()
  return geo
}

export class Patch {
  constructor(scene, world, center, radius) {
    this.scene = scene
    this.world = world
    this.center = { x: center.x, z: center.z }
    this.radius = radius
    this.group = new THREE.Group()
    const gh = world.groundHeightAt(this.center.x, this.center.z)
    this.group.position.set(this.center.x, gh + RENDER_Y, this.center.z)

    this._buildGrid()
    this._buildVisuals()
    this._redrawTexture()
    this._syncBuckets()
    scene.add(this.group)
  }

  _buildGrid() {
    const raw = Math.max(3, Math.ceil((this.radius * 2) / CELL_SIZE))
    this._cols = raw | 1 // force odd so there's a centered cell
    const n = this._cols * this._cols
    this._food = new Float32Array(n)
    this._buckets = new Float32Array(n)
    const half = (this._cols - 1) / 2
    for (let j = 0; j < this._cols; j++) {
      for (let i = 0; i < this._cols; i++) {
        const lx = (i - half) * CELL_SIZE
        const lz = (j - half) * CELL_SIZE
        const active = Math.hypot(lx, lz) <= this.radius
        this._food[j * this._cols + i] = active ? 1 : -1
      }
    }
  }

  _buildVisuals() {
    const px = Math.max(4, Math.min(MAX_CANVAS / this._cols, PIXELS_PER_CELL))
    this._pxPerCell = Math.floor(px)
    const size = this._cols * this._pxPerCell
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    this._canvas = canvas
    this._ctx = canvas.getContext('2d')
    // Raw (un-feathered) fill lives on a separate canvas; the visible texture
    // is a blurred copy of it so cell boundaries feather, not stair-step.
    const raw = document.createElement('canvas')
    raw.width = size
    raw.height = size
    this._rawCanvas = raw
    this._rawCtx = raw.getContext('2d')
    this._texture = new THREE.CanvasTexture(canvas)
    // Canvas bytes are sRGB-encoded (same as the ground texture in
    // world.js). Without this, three r180's NoColorSpace default treats them
    // as linear and re-encodes on output, washing out and inverting the
    // apparent lush/grazed value ramp.
    this._texture.colorSpace = THREE.SRGBColorSpace

    // Fill and rim share one wobbled boundary so they're guaranteed
    // coincident — no bleed on the inward arcs, no gap on the outward ones.
    // Kept on the instance so _paintRawFill can clip the per-cell fill to the
    // exact same smooth curve instead of the square cell grid's own jagged
    // approximation of a circle.
    const outline = buildWobbledOutline(this.radius)
    this._outline = outline

    // Same shading path as the ground beneath it (toon-lit, not unlit) so
    // "lush" and "grazed" land the same value/saturation logic as the field.
    const mat = toonMaterial(0xffffff, {
      steps: 3,
      map: this._texture,
      transparent: true,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    })
    this._discMesh = new THREE.Mesh(buildDiscGeometry(this.radius, outline), mat)
    this._discMesh.renderOrder = 5
    this.group.add(this._discMesh)

    // Invisible rim wall, ink-shelled via addOutline() so the boundary ring
    // holds a constant on-screen INK_PIXELS weight like every other outline
    // in the frame, instead of a constant world-space ribbon thickness.
    const wallMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false })
    this._wallMesh = new THREE.Mesh(buildWallGeometry(outline, RING_WALL_HEIGHT), wallMat)
    this._wallMesh.renderOrder = 6
    this.group.add(this._wallMesh)
    addOutline(this._wallMesh, { color: RING_COLOR, pixels: RING_INK_PIXELS })
    // The generated ink shell inherits toon.js's default polygonOffset
    // (factor +1), which pushes it *away* from the camera — backwards for a
    // decal that must always win against the ground surface it sits on, and
    // on arcs where the rim wall runs near-tangent to the view it loses the
    // depth test outright. This is a UI-grade affordance, not a lit 3D edge,
    // so it always wins: disable depth testing/writing and draw it last.
    this._wallMesh.traverse((o) => {
      if (!o.userData.isOutline) return
      o.material.depthTest = false
      o.material.depthWrite = false
      // The rim wall is an open tube (no top/bottom caps): on a closed hull
      // BackSide alone would work, but here the near half's quads face the
      // camera and get culled outright, leaving only the far arc inked. This
      // is a UI-grade decal, not a lit 3D edge, so draw both winding
      // directions instead of relying on hull closure.
      o.material.side = THREE.DoubleSide
      o.renderOrder = 10
    })
  }

  _disposeVisuals() {
    if (this._discMesh) {
      this.group.remove(this._discMesh)
      this._discMesh.geometry.dispose()
      this._discMesh.material.dispose()
    }
    if (this._wallMesh) {
      this.group.remove(this._wallMesh)
      // Includes the addOutline() ink shell child — each shell owns its own
      // material/geometry (see toon.js), so both must be disposed here.
      this._wallMesh.traverse((o) => {
        o.geometry?.dispose()
        o.material?.dispose()
      })
    }
    this._texture?.dispose()
  }

  _cellIndexAt(x, z) {
    const half = (this._cols - 1) / 2
    let i = Math.round((x - this.center.x) / CELL_SIZE + half)
    let j = Math.round((z - this.center.z) / CELL_SIZE + half)
    i = Math.min(this._cols - 1, Math.max(0, i))
    j = Math.min(this._cols - 1, Math.max(0, j))
    return j * this._cols + i
  }

  _cellWorldPos(i, j) {
    const half = (this._cols - 1) / 2
    return { x: this.center.x + (i - half) * CELL_SIZE, z: this.center.z + (j - half) * CELL_SIZE }
  }

  _syncBuckets() {
    for (let k = 0; k < this._food.length; k++) {
      const f = this._food[k]
      this._buckets[k] = f < 0 ? -1 : Math.round(f * BUCKET_LEVELS)
    }
  }

  _redrawTexture() {
    this._paintRawFill()
    this._featherFillToTexture()
    this._texture.needsUpdate = true
  }

  // Canvas-space path tracing the same wobbled boundary the disc geometry
  // and ink rim are built from, in the same pixel coordinates _paintRawFill
  // draws cells in (see the i*px/j*px mapping there). Clipping fill to this
  // means the visible edge is always that smooth curve, never the square
  // cell grid's own stair-stepped approximation of a circle.
  _outlineClipPath() {
    const half = (this._cols - 1) / 2
    const px = this._pxPerCell
    const path = new Path2D()
    this._outline.forEach(([cx, cz], idx) => {
      const x = (cx / CELL_SIZE + half) * px
      const y = (cz / CELL_SIZE + half) * px
      if (idx === 0) path.moveTo(x, y)
      else path.lineTo(x, y)
    })
    path.closePath()
    return path
  }

  // Hard-edged per-cell fill onto the offscreen raw canvas, clipped to the
  // wobbled boundary so no square cell corner can ever poke past the rim.
  _paintRawFill() {
    const ctx = this._rawCtx
    const cols = this._cols
    const px = this._pxPerCell
    const scratch = new THREE.Color()
    ctx.clearRect(0, 0, this._rawCanvas.width, this._rawCanvas.height)
    ctx.save()
    ctx.clip(this._outlineClipPath())
    for (let j = 0; j < cols; j++) {
      for (let i = 0; i < cols; i++) {
        const f = this._food[j * cols + i]
        if (f < 0) continue
        foodColor(f, scratch)
        ctx.fillStyle = `#${scratch.getHexString()}`
        ctx.fillRect(i * px, j * px, px + 1, px + 1)
      }
    }
    ctx.restore()
  }

  // Blurs the raw fill onto the visible texture so cell boundaries feather
  // into each other instead of reading as a hard, stair-stepped alpha mask.
  _featherFillToTexture() {
    const ctx = this._ctx
    ctx.clearRect(0, 0, this._canvas.width, this._canvas.height)
    ctx.save()
    ctx.filter = `blur(${FEATHER_PX}px)`
    ctx.drawImage(this._rawCanvas, 0, 0)
    ctx.restore()
    // The blur above bleeds ~FEATHER_PX past the raw fill's clip on every
    // arc. Re-clip to the same wobbled boundary the ink ring is built from
    // so the feather stays strictly inside the line instead of smearing past
    // it.
    ctx.save()
    ctx.globalCompositeOperation = 'destination-in'
    ctx.fill(this._outlineClipPath())
    ctx.restore()
  }

  // Redraws only if a cell's quantized food level actually changed — keeps
  // the canvas repaint gated on real visual change, not every tick.
  _refreshIfDirty() {
    const food = this._food
    const buckets = this._buckets
    let dirty = false
    for (let k = 0; k < food.length; k++) {
      const f = food[k]
      if (f < 0) continue
      const b = Math.round(f * BUCKET_LEVELS)
      if (b !== buckets[k]) {
        buckets[k] = b
        dirty = true
      }
    }
    if (dirty) this._redrawTexture()
  }

  eatAt(x, z, amount) {
    const idx = this._cellIndexAt(x, z)
    const food = this._food[idx]
    if (food <= 0) return 0
    const consumed = Math.min(amount, food)
    this._food[idx] = food - consumed
    if (consumed > 0) this._refreshIfDirty()
    return consumed
  }

  bestSpot(from) {
    let best = null
    let bestScore = -Infinity
    const cols = this._cols
    for (let j = 0; j < cols; j++) {
      for (let i = 0; i < cols; i++) {
        const food = this._food[j * cols + i]
        if (food < BEST_SPOT_MIN_FOOD) continue
        const { x, z } = this._cellWorldPos(i, j)
        const score = food - Math.hypot(x - from.x, z - from.z) * DISTANCE_WEIGHT
        if (score > bestScore) {
          bestScore = score
          best = { x, z }
        }
      }
    }
    return best
  }

  fullness() {
    let sum = 0
    let count = 0
    for (let k = 0; k < this._food.length; k++) {
      const f = this._food[k]
      if (f < 0) continue
      sum += f
      count++
    }
    return count > 0 ? sum / count : 0
  }

  update(dt) {
    const inc = dt / REGROW_SECONDS
    const food = this._food
    for (let k = 0; k < food.length; k++) {
      const f = food[k]
      if (f < 0 || f >= 1) continue
      food[k] = Math.min(1, f + inc)
    }
    this._refreshIfDirty()
  }

  moveTo(center) {
    this.center = { x: center.x, z: center.z }
    const gh = this.world.groundHeightAt(center.x, center.z)
    this.group.position.set(this.center.x, gh + RENDER_Y, this.center.z)
    this._buildGrid() // fresh grass at the new spot
    this._redrawTexture()
    this._syncBuckets()
  }

  setRadius(r) {
    this.radius = r
    this._disposeVisuals()
    this._buildGrid()
    this._buildVisuals()
    this._redrawTexture()
    this._syncBuckets()
  }

  dispose() {
    this._disposeVisuals()
    this.scene.remove(this.group)
  }
}
