import * as THREE from 'three'
import { toonMaterial } from '../art/toon.js'

// Tunable: seconds for a fully-bare cell to regrow to fully-lush.
export const REGROW_SECONDS = 90

const CELL_SIZE = 1
const BUCKET_LEVELS = 64
const BEST_SPOT_MIN_FOOD = 0.08
const DISTANCE_WEIGHT = 0.12
const PIXELS_PER_CELL = 16
const MAX_CANVAS = 512
const RENDER_Y = 0.03
const RING_COLOR = 0x2c4a1e
const RING_THICKNESS = 0.12
// Gaussian blur radius (in canvas px) applied over the raw cell fill so cell
// boundaries feather instead of stair-stepping.
const FEATHER_PX = 1.5

// Lush must be the darkest, richest note in the frame (grazed-vs-fresh reads
// backwards otherwise) — deep saturated emerald down to dry umber.
const LUSH = new THREE.Color('#3f8f2a')
const THIN = new THREE.Color('#d8b23a')
const BARE = new THREE.Color('#7a5433')

function foodColor(t, target = new THREE.Color()) {
  if (t >= 0.5) return target.copy(THIN).lerp(LUSH, (t - 0.5) * 2)
  return target.copy(BARE).lerp(THIN, t * 2)
}

// A stable (non-random) wobble so the ring reads as hand-drawn but never
// re-jitters between rebuilds. Returns a flat ribbon (triangle strip) instead
// of a single-pixel line so it can carry real ink weight.
function buildRingGeometry(radius, thickness, segments = 72) {
  const centers = []
  for (let s = 0; s <= segments; s++) {
    const t = (s / segments) * Math.PI * 2
    const wobble = 1 + 0.05 * Math.sin(t * 5 + 1.3) + 0.025 * Math.sin(t * 11 + 0.6)
    const r = radius * wobble
    centers.push([Math.cos(t) * r, Math.sin(t) * r])
  }
  const half = thickness / 2
  const positions = []
  for (let s = 0; s <= segments; s++) {
    const [cx, cz] = centers[s]
    const [px, pz] = centers[(s - 1 + segments) % segments]
    const [nx, nz] = centers[(s + 1) % segments]
    let tx = nx - px
    let tz = nz - pz
    const tl = Math.hypot(tx, tz) || 1
    tx /= tl
    tz /= tl
    // outward normal = tangent rotated 90°, in the XZ plane
    const ox = -tz
    const oz = tx
    positions.push(cx + ox * half, 0, cz + oz * half)
    positions.push(cx - ox * half, 0, cz - oz * half)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  const index = []
  for (let s = 0; s < segments; s++) {
    const a = s * 2
    const b = a + 1
    const c = a + 2
    const d = a + 3
    index.push(a, b, c, b, d, c)
  }
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

    // Same shading path as the ground beneath it (toon-lit, not unlit) so
    // "lush" and "grazed" land the same value/saturation logic as the field.
    const geo = new THREE.CircleGeometry(this.radius, 48)
    const mat = toonMaterial(0xffffff, {
      steps: 3,
      map: this._texture,
      transparent: true,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    })
    this._discMesh = new THREE.Mesh(geo, mat)
    this._discMesh.rotation.x = -Math.PI / 2
    this._discMesh.renderOrder = 5
    this.group.add(this._discMesh)

    const ringMat = new THREE.MeshBasicMaterial({ color: RING_COLOR, side: THREE.DoubleSide })
    this._ringMesh = new THREE.Mesh(buildRingGeometry(this.radius, RING_THICKNESS), ringMat)
    this._ringMesh.position.y = 0.015
    this._ringMesh.renderOrder = 6
    this.group.add(this._ringMesh)
  }

  _disposeVisuals() {
    if (this._discMesh) {
      this.group.remove(this._discMesh)
      this._discMesh.geometry.dispose()
      this._discMesh.material.dispose()
    }
    if (this._ringMesh) {
      this.group.remove(this._ringMesh)
      this._ringMesh.geometry.dispose()
      this._ringMesh.material.dispose()
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

  // Hard-edged per-cell fill onto the offscreen raw canvas.
  _paintRawFill() {
    const ctx = this._rawCtx
    const cols = this._cols
    const px = this._pxPerCell
    const scratch = new THREE.Color()
    ctx.clearRect(0, 0, this._rawCanvas.width, this._rawCanvas.height)
    for (let j = 0; j < cols; j++) {
      for (let i = 0; i < cols; i++) {
        const f = this._food[j * cols + i]
        if (f < 0) continue
        foodColor(f, scratch)
        ctx.fillStyle = `#${scratch.getHexString()}`
        ctx.fillRect(i * px, j * px, px + 1, px + 1)
      }
    }
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
