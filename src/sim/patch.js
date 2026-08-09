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
// most legible line on screen. Drawn via addOutline's `flat: true` path (the
// same mechanism world.js uses to ink the road/rut boundary onto a flat
// ground decal), which traces the literal open-edge boundary of the disc
// geometry itself — see the addOutline call in _buildVisuals. Because the
// ring is built FROM the disc's own geometry (not a separately-shaped wall),
// fill and ring can never disagree about where the patch ends: no coincident
// second shape to drift out of sync, no depth-order fight against the ground
// decals it may sit over (decalMaterial's polygonOffset already wins against
// both the road and the terrain — see toon.js). Depth test stays on via that
// same mechanism — real geometry standing on the patch (chickens, the pig)
// still occludes it.
const RING_INK_PIXELS = 4
// Gaussian blur radius (in canvas px) applied over the raw cell fill so cell
// boundaries feather instead of stair-stepping. At PIXELS_PER_CELL=24 there
// is enough resolution for this to actually hide the per-cell grid.
const FEATHER_PX = 3.5

// Lush must read as the *richest* grass in the picture — visibly higher
// value AND saturation than the field base (world.js's ground tones run
// ~0x86c057 to 0xb2d668, HSV V~0.75-0.84 / S~0.45-0.57), not just a deeper
// hue that reads as the same green at a glance. A full patch is the hero
// mechanic's payoff and must read as a bright disc, not an outline with an
// interior indistinguishable from the surrounding grass. #48c91c carries
// V≈0.79 / S≈0.86 — roughly +13-15% over the pre-fix #57b02c (V≈0.69,
// S≈0.75) and pushed a few degrees cooler in hue — so it clears the field's
// own V/S range on both axes instead of landing inside it. Grazed-out still
// fades through dusty gold to dark umber. Tuned against the *decoded* (sRGB
// colorSpace) texture output, not raw canvas hex — see the colorSpace
// assignment in _buildVisuals.
const LUSH = new THREE.Color('#48c91c')
const THIN = new THREE.Color('#cf9f2e')
const BARE = new THREE.Color('#96652f')

// Depletion must read as *shrinkage*, not a slow tint shift: the per-cell
// food value t (0..1) is eased through this power curve before it drives the
// color ramp below, so losing only the first ~30% of a cell's food already
// visibly retreats it out of the lush band. Solved so t=0.7 (30% eaten)
// lands right at the lush/thin midpoint (0.7^2 = 0.49) — cells nearest the
// rim (eaten first) drop out of "lush" fast, so the lush core visibly
// retreats inward from the boundary instead of the whole disc fading
// together.
const DEPLETION_CURVE_POWER = 2

function easedFood(t) {
  return Math.pow(Math.max(0, t), DEPLETION_CURVE_POWER)
}

function foodColor(t, target = new THREE.Color()) {
  const e = easedFood(t)
  if (e >= 0.5) return target.copy(THIN).lerp(LUSH, (e - 0.5) * 2)
  return target.copy(BARE).lerp(THIN, e * 2)
}

// Grass-stroke overlay tuning — same visual language as world.js's
// buildGroundTexture (short curved hand-drawn strokes, tonal variation), but
// per-cell and food-driven instead of a static repeating tile. Cells below
// GRASS_STROKE_MIN_FOOD paint as bare dirt with no strokes at all — depletion
// is meant to read as texture loss, not just a hue shift.
const GRASS_STROKE_MIN_FOOD = 0.05
const GRASS_MAX_STROKES_PER_CELL = 6
// Steeper than DEPLETION_CURVE_POWER so blade texture thins out and drops
// to zero earlier than the color itself finishes its lush->bare transition —
// depletion reads as shrinkage *plus* texture loss stacking on top of each
// other, not a single slow tint shift standing in for both.
const GRASS_STROKE_FALLOFF_POWER = 3.5
// Strokes are tinted darker than the cell's own fill so they read as blades
// catching shadow, not a different material. 0.8 = "~20% darker"; the tones
// below spread a little variation around that so strokes in the same cell
// aren't a single flat repeated value (mirrors buildGroundTexture's 3-tone
// array).
const GRASS_STROKE_DARKEN = 0.8
const GRASS_STROKE_TONES = [0.85, 1, 1.15]
// Target stroke size in *world units*, matched to buildGroundTexture's own
// ~0.14-0.3u long / ~0.04-0.07u wide marks so a patch's grass and the
// surrounding field's grass read as the same brush. Multiplied by pxPerCell
// (px per 1 world unit, since CELL_SIZE = 1) to land in canvas space.
const GRASS_STROKE_LEN_MIN = 0.14
const GRASS_STROKE_LEN_SPREAD = 0.16
const GRASS_STROKE_WIDTH_MIN = 0.04
const GRASS_STROKE_WIDTH_SPREAD = 0.03

// Deterministic per-seed RNG (same LCG shape as world.js's local helper) so a
// cell's stroke *positions* stay fixed across redraws — only how many of them
// are drawn changes with food, which reads as grass filling in / wearing away
// rather than the whole patch re-jittering every tick.
function seededRand(seed) {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
}

// Dominant lobe count for the scalloped boundary — a single low frequency
// in this range (not the higher secondary jitter below) is what reads as
// hand-drawn scallops instead of a mechanically-perfect circle.
const SCALLOP_LOBES = 7
const SCALLOP_AMPLITUDE = 0.08

// A stable (non-random) wobble so the boundary reads as hand-drawn but never
// re-jitters between rebuilds. Both the fill disc and the ink-outline rim
// wall are built from these exact points, so they can never drift apart —
// the fill can neither bleed past nor fall short of the line. The primary
// term is the low-frequency scallop (SCALLOP_LOBES lobes, SCALLOP_AMPLITUDE
// of the radius) that makes the ring read as drawn rather than a perfect
// circle; the secondary term is a smaller, higher-frequency wobble layered
// on top purely for hand-drawn irregularity, kept subordinate in amplitude
// so it doesn't wash out the scallop read.
function buildWobbledOutline(radius, segments = 72) {
  const centers = []
  for (let s = 0; s <= segments; s++) {
    const t = (s / segments) * Math.PI * 2
    const wobble =
      1 + SCALLOP_AMPLITUDE * Math.sin(t * SCALLOP_LOBES + 1.3) + 0.025 * Math.sin(t * 17 + 0.6)
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
  // (1 + SCALLOP_AMPLITUDE + 0.025 = 1.105x radius) so outward-wobble arcs
  // never push uv to/past 1.0 and clamp — that clamp was stretching the edge
  // texel radially outward, smearing fill past the boundary on those arcs.
  const uvDiameter = radius * 2 * 1.12
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
    //
    // polygonOffsetFactor/Units match world.js's road/rut decals (buildPathMesh)
    // exactly, not just "some negative bias": those decals resolve who wins
    // the ground purely by comparing equal offsets against actual world
    // height (see buildWagonRuts — ruts sit higher than the road and win with
    // the *same* offset the road uses). The disc previously carried a weaker
    // -1/-1 bias than the road's -2/-2, so the artificial offset could beat
    // the disc's real height advantage (RENDER_Y=0.03 vs the road's y≈0.02)
    // and the fill vanished under the road — the critic's "hose with nothing
    // attached" regression. Matching the road's own offset restores height as
    // the tiebreaker, so the disc's extra 0.01 legitimately wins.
    const mat = toonMaterial(0xffffff, {
      steps: 3,
      map: this._texture,
      transparent: true,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    })
    this._discMesh = new THREE.Mesh(buildDiscGeometry(this.radius, outline), mat)
    this._discMesh.renderOrder = 5
    this.group.add(this._discMesh)

    // Boundary ring via addOutline's `flat: true` path (toon.js) — the same
    // mechanism world.js uses to ink the road/rut edge onto a flat ground
    // decal. This traces the LITERAL open-edge boundary of the disc geometry
    // just built (buildDiscGeometry's outer rim edges, each used by exactly
    // one fan triangle), so the ring is not a second shape that could drift
    // out of sync with the fill — it IS the fill's own edge. Its decal
    // material (toon.js) carries a polygonOffset far deeper than either the
    // disc's or the road's, tuned specifically to beat both the decal it
    // rims and the terrain under it, so it wins against the road even on
    // arcs where the fill's own offset match above only ties.
    addOutline(this._discMesh, { color: RING_COLOR, pixels: RING_INK_PIXELS, flat: true })
  }

  _disposeVisuals() {
    if (this._discMesh) {
      this.group.remove(this._discMesh)
      // Traverses the disc mesh AND its addOutline-added flat ink-ring child
      // — each shell owns its own material/geometry (see toon.js), so both
      // must be disposed here.
      this._discMesh.traverse((o) => {
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
    this._paintGrassStrokes()
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

  // Paints hand-drawn grass strokes on top of the feathered fill, crisp
  // (not blurred, unlike the base fill) so they read as brush detail rather
  // than getting mushed into the feather pass — same intent as
  // buildGroundTexture's strokes in world.js, just per-cell and food-driven:
  // a full cell gets a dense little cluster of dark-green marks, a thin cell
  // gets a sparse few, a bare cell gets none at all (just the dirt fill).
  // This is what makes depletion read as texture loss, not only color loss.
  _paintGrassStrokes() {
    const ctx = this._ctx
    const cols = this._cols
    const px = this._pxPerCell
    const base = new THREE.Color()
    const shade = new THREE.Color()
    ctx.save()
    ctx.clip(this._outlineClipPath())
    ctx.lineCap = 'round'
    for (let j = 0; j < cols; j++) {
      for (let i = 0; i < cols; i++) {
        const f = this._food[j * cols + i]
        if (f < GRASS_STROKE_MIN_FOOD) continue
        const count = Math.round(Math.pow(f, GRASS_STROKE_FALLOFF_POWER) * GRASS_MAX_STROKES_PER_CELL)
        if (count === 0) continue
        foodColor(f, base)
        const rnd = seededRand(((j * cols + i) * 2654435761) >>> 0)
        const cx = i * px
        const cy = j * px
        for (let s = 0; s < count; s++) {
          const tone = GRASS_STROKE_TONES[s % GRASS_STROKE_TONES.length]
          shade.copy(base).multiplyScalar(GRASS_STROKE_DARKEN * tone)
          ctx.strokeStyle = `#${shade.getHexString()}`
          ctx.lineWidth = (GRASS_STROKE_WIDTH_MIN + rnd() * GRASS_STROKE_WIDTH_SPREAD) * px
          const x = cx + rnd() * px
          const y = cy + rnd() * px
          const a = rnd() * Math.PI * 2
          const len = (GRASS_STROKE_LEN_MIN + rnd() * GRASS_STROKE_LEN_SPREAD) * px
          ctx.beginPath()
          ctx.moveTo(x, y)
          ctx.quadraticCurveTo(
            x + Math.cos(a) * len * 0.5,
            y + Math.sin(a) * len * 0.5 - len * 0.2,
            x + Math.cos(a) * len,
            y + Math.sin(a) * len
          )
          ctx.stroke()
        }
      }
    }
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
