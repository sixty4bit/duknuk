import * as THREE from 'three'
import { toonMaterial, addOutline } from './art/toon.js'
import { makeBarn, makeFence, makeHaystack, makePig, makeTree } from './art/models.js'

const SIZE = 120
const HALF = SIZE / 2
// Cool pale blue-violet, not warm cream — recession should read as cool/light,
// never as a warm dessert-beige wash over the played field.
const FOG_COLOR = 0xc3d4e0

// ---------- module-level visual helpers (not part of the exported contract) ----------

function enableShadows(object3d) {
  object3d.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true
      o.receiveShadow = true
    }
  })
  return object3d
}

/** Deterministic wobble so scatter layouts are identical between reloads. */
function seededRand(seed) {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
}

function smooth01(x, a, b) {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}

/** Box-Muller: normal-distributed random, mean 0. Used for clump spread so
 * trees cluster toward a center instead of scattering uniformly. */
function gaussianRandom(stdDev) {
  const u = 1 - Math.random()
  const v = Math.random()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * stdDev
}

// ---------------------------------------------------------------- ground

/** Painter's-eye grass texture: a handful of large soft-edged value masses
 * laid first (the broad shapes a background painter blocks in), then a
 * sparse pass of hand-drawn clump marks on top for readable detail — not
 * stipple. Tiled large via repeat so tiles read as painted shapes, not noise. */
function buildGroundTexture() {
  // 1024px at repeat(4,4) — was 256px at repeat(14,14), which put the same
  // handful of strokes in lockstep across 5-8 visible tiles and read as a
  // checkerboard. A bigger canvas at a low repeat plus far more strokes means
  // no single mark is identifiable as a repeating motif.
  const px = 1024
  const scale = px / 256
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = px
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#7ec852'
  ctx.fillRect(0, 0, px, px)
  const rnd = seededRand(4242)
  const massColors = ['rgba(150,205,84,0.55)', 'rgba(88,150,88,0.5)']
  const massCount = 24 + Math.floor(rnd() * 16) // scaled up for the larger canvas
  for (let i = 0; i < massCount; i++) {
    const x = rnd() * px
    const y = rnd() * px
    const r = (40 + rnd() * 70) * scale
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r)
    grad.addColorStop(0, massColors[i % massColors.length])
    grad.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }
  const tones = ['#6cb544', '#8fd867', '#5a9e3a']
  ctx.lineCap = 'round'
  const strokeCount = 90 // was 20 — dense enough at repeat(4,4) to stay illegible as a motif
  for (let i = 0; i < strokeCount; i++) {
    const x = rnd() * px
    const y = rnd() * px
    const a = rnd() * Math.PI
    const len = (18 + rnd() * 22) * scale
    ctx.strokeStyle = tones[i % tones.length]
    ctx.lineWidth = (6 + rnd() * 6) * scale
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.quadraticCurveTo(x + Math.cos(a) * len * 0.5, y + Math.sin(a) * len * 0.5 - 6 * scale, x + Math.cos(a) * len, y + Math.sin(a) * len)
    ctx.stroke()
  }
  const tex = new THREE.CanvasTexture(canvas)
  if ('colorSpace' in tex) tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  // 120-unit plane, repeat 4x so each tile spans 30 world units of painted
  // texture — large legible shapes, not a lattice.
  tex.repeat.set(4, 4)
  // NearestFilter at ~8.5 units/tile was aliasing, not stylization.
  tex.magFilter = THREE.LinearFilter
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.generateMipmaps = true
  // Renderer isn't available at this contract's constructor(scene) signature;
  // any value here is clamped to the GPU's real max by the renderer, so a
  // generous fixed request is safe without a capabilities query.
  tex.anisotropy = 8
  return tex
}

// Posterized field bands — each its own hue AND value, low/cool to high/warm.
// Hard boundaries between bands (no lerp) is the point: a background painter
// blocks in masses, a smooth gaussian gradient is the strongest 3D-engine tell.
const FIELD_BANDS = [
  { color: new THREE.Color(0x4f8f76), value: 0.72 }, // cool low passages
  { color: new THREE.Color(0x7fae5c), value: 0.85 },
  { color: new THREE.Color(0xa8c95a), value: 1.0 },
  { color: new THREE.Color(0xc9dd5a), value: 1.12 }, // warm lit passages
]

/** Low-frequency field variation baked as vertex colors, quantized into 4
 * discrete painted bands instead of a continuous cool-to-warm airbrush. */
function applyBroadFieldShading(geo) {
  const pos = geo.attributes.position
  const colors = new Float32Array(pos.count * 3)
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const z = pos.getZ(i)
    const n = Math.sin(x * 0.05 + 1.7) * Math.cos(z * 0.045 - 0.6) * 0.6 + Math.sin(x * 0.017 - z * 0.021) * 0.4
    const t = THREE.MathUtils.clamp(0.5 + n * 0.5, 0, 1)
    const band = FIELD_BANDS[Math.min(FIELD_BANDS.length - 1, Math.floor(t * FIELD_BANDS.length))]
    colors[i * 3] = band.color.r * band.value
    colors[i * 3 + 1] = band.color.g * band.value
    colors[i * 3 + 2] = band.color.b * band.value
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
}

/** Flat desaturated backdrop disc under the 120-unit playfield so the field
 * never terminates on a hard edge. Radius cut to just past the treeline ring
 * (HALF+6) so its rim sits among the tree trunks instead of exposed as a bare
 * ring in the two deliberate treeline gaps — was size*1.9 (228u), fully
 * fog-saturated under the old near fog, so pushing fog back would have
 * revealed a hard-edged ring circumscribing the field. Cool desaturated tone
 * (was warm 0x8fae86) matching the field's cool end; fog (near 85/far 200)
 * plus the sky dome's painted horizon carry everything past this rim. */
function buildFarBackdropGround(size) {
  const radius = size / 2 + 10
  const geo = new THREE.CircleGeometry(radius, 48)
  geo.rotateX(-Math.PI / 2)
  const mat = toonMaterial(0x7d9e9a, { steps: 2 })
  const disc = new THREE.Mesh(geo, mat)
  disc.position.y = -0.04
  disc.receiveShadow = true
  return disc
}

// ------------------------------------------------------------------- sky

/** Painted horizontal silhouette band with a wavy top edge (sine sum, integer
 * multiples so the seam matches at u=0/1 on the wrapped dome texture). */
function drawSilhouetteBand(ctx, w, topY, baseY, color, bumps, amp) {
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(0, baseY)
  const steps = 64
  for (let i = 0; i <= steps; i++) {
    const u = i / steps
    const wobble = Math.sin(u * Math.PI * 2 * bumps) * amp + Math.sin(u * Math.PI * 2 * bumps * 2.3) * amp * 0.4
    ctx.lineTo(u * w, THREE.MathUtils.clamp(topY + wobble, 0, baseY))
  }
  ctx.lineTo(w, baseY)
  ctx.closePath()
  ctx.fill()
}

function drawCloudShape(ctx, cx, cy, s) {
  ctx.globalAlpha = 0.16
  ctx.fillStyle = '#3b587a'
  ctx.beginPath()
  ctx.ellipse(cx, cy + s * 0.18, s * 1.1, s * 0.32, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalAlpha = 0.94
  ctx.fillStyle = '#fffaf2'
  const puffs = [[0, 0, 1], [0.7, 0.15, 0.65], [-0.7, 0.12, 0.68], [0.25, -0.35, 0.55], [-0.3, -0.3, 0.5]]
  for (const [dx, dy, r] of puffs) {
    ctx.beginPath()
    ctx.ellipse(cx + dx * s, cy + dy * s * 0.6, r * s * 0.75, r * s * 0.42, 0, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1
}

/** Painted-flat clouds baked straight into the backdrop so they are visible
 * from frame one regardless of where the camera is orbited to. */
function drawPaintedClouds(ctx, w, h) {
  const rnd = seededRand(99)
  for (let i = 0; i < 9; i++) {
    const cx = rnd() * w
    const cy = h * (0.1 + rnd() * 0.26)
    const scale = 40 + rnd() * 70
    drawCloudShape(ctx, cx, cy, scale)
    if (cx < scale * 1.5) drawCloudShape(ctx, cx + w, cy, scale)
    if (cx > w - scale * 1.5) drawCloudShape(ctx, cx - w, cy, scale)
  }
}

/** Backdrop painted as a theatrical set piece: gradient sky, a warm haze band,
 * a blue-grey hill ridge, a dark scalloped treeline, and baked-in clouds. */
function buildSkyTexture() {
  const w = 1024
  const h = 1024
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  const zenith = new THREE.Color(0x6fb8de)
  const upperHaze = new THREE.Color(0xffe2ae)
  // Decoupled from FOG_COLOR (was literally the same value, so fog and
  // backdrop fused into one continuous slab with zero value break at the
  // horizon) — ~12% darker so a distinct horizon line survives.
  const horizon = new THREE.Color(FOG_COLOR).multiplyScalar(0.88)
  const c = new THREE.Color()
  for (let y = 0; y < h; y++) {
    const v = y / h
    const worldY = Math.cos(v * Math.PI) // +1 zenith .. 0 horizon .. -1 nadir
    const t = smooth01(worldY, -0.02, 0.12)
    c.copy(horizon).lerp(zenith, t)
    if (worldY > 0.02 && worldY < 0.16) c.lerp(upperHaze, 0.35 * smooth01(worldY, 0.02, 0.09))
    ctx.fillStyle = `rgb(${(c.r * 255) | 0},${(c.g * 255) | 0},${(c.b * 255) | 0})`
    ctx.fillRect(0, y, w, 1)
  }
  // Was h*0.5 — from the default camera (y=11.5) the geometric horizon
  // (backdrop disc + fog) sat above these painted bands and occluded both, so
  // the ridge and treeline never appeared on screen. Raised so they clear it.
  const horizonY = h * 0.44
  drawSilhouetteBand(ctx, w, horizonY - h * 0.035, horizonY - h * 0.008, '#9fb4c4', 5, h * 0.01)
  drawSilhouetteBand(ctx, w, horizonY - h * 0.016, horizonY + h * 0.004, '#1f2e1a', 11, h * 0.016)
  drawPaintedClouds(ctx, w, h)
  const tex = new THREE.CanvasTexture(canvas)
  if ('colorSpace' in tex) tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = THREE.RepeatWrapping
  return tex
}

function buildSkyDome() {
  const radius = 280
  const geo = new THREE.SphereGeometry(radius, 32, 20)
  const mat = new THREE.MeshBasicMaterial({ map: buildSkyTexture(), side: THREE.BackSide, fog: false, depthWrite: false })
  const dome = new THREE.Mesh(geo, mat)
  dome.renderOrder = -1000
  return dome
}

function buildCloud() {
  const group = new THREE.Group()
  const mat = toonMaterial(0xfff8ec, { steps: 3 })
  const puffs = [
    { x: 0, y: 0, z: 0, r: 3.2 },
    { x: 2.6, y: 0.35, z: 0.3, r: 2.2 },
    { x: -2.6, y: 0.3, z: -0.2, r: 2.3 },
    { x: 0.8, y: 1.1, z: 0.6, r: 1.8 },
    { x: -1.1, y: 1.0, z: -0.5, r: 1.9 },
  ]
  for (const p of puffs) {
    const puff = new THREE.Mesh(new THREE.SphereGeometry(p.r, 12, 10), mat)
    puff.position.set(p.x, p.y, p.z)
    group.add(puff)
  }
  addOutline(group, { color: 0x1a1208, thickness: 0.05 })
  group.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = false
      o.receiveShadow = false
    }
  })
  return group
}

// --------------------------------------------------------- contact shadows

let unitShadowGeo = null
let sharedShadowMat = null
let sharedShadowTex = null

// Sun sits at (26, 34, 30) — see _buildLights. Cel shadows fall away from the
// light and get a slight squash/skew toward that direction so they read as
// drawn shapes that were placed, not grey blobs stamped straight down.
const SHADOW_DIR = new THREE.Vector2(-26, -30).normalize()
const SHADOW_ANGLE = Math.atan2(SHADOW_DIR.x, SHADOW_DIR.y)
const SHADOW_SQUASH = 1.35
const SHADOW_OFFSET = 0.4

/** Hard-edged drawn ellipse, not a photographic soft blob: solid fill out to
 * ~78% of the radius, a short feather, then nothing. Warm brown, not grey. */
function contactShadowTexture() {
  if (sharedShadowTex) return sharedShadowTex
  const px = 128
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = px
  const ctx = canvas.getContext('2d')
  const g = ctx.createRadialGradient(px / 2, px / 2, 0, px / 2, px / 2, px / 2)
  g.addColorStop(0, 'rgba(74,44,20,0.34)')
  g.addColorStop(0.78, 'rgba(74,44,20,0.34)')
  g.addColorStop(0.84, 'rgba(74,44,20,0)')
  g.addColorStop(1, 'rgba(74,44,20,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, px, px)
  sharedShadowTex = new THREE.CanvasTexture(canvas)
  return sharedShadowTex
}

/** One shared unit-circle geometry + material, scaled/squashed per-instance —
 * a hard-edged painted contact shadow under every prop instead of relying
 * solely on the (necessarily coarse) shadow map for grounding. */
function buildContactShadow(radius) {
  if (!unitShadowGeo) {
    unitShadowGeo = new THREE.CircleGeometry(1, 24)
    unitShadowGeo.rotateX(-Math.PI / 2)
  }
  if (!sharedShadowMat) {
    sharedShadowMat = new THREE.MeshBasicMaterial({ map: contactShadowTexture(), transparent: true, depthWrite: false, fog: false })
  }
  const mesh = new THREE.Mesh(unitShadowGeo, sharedShadowMat)
  mesh.scale.set(radius, 1, radius * SHADOW_SQUASH)
  mesh.rotation.y = SHADOW_ANGLE
  mesh.renderOrder = 1
  return mesh
}

let cloudShadowTex = null

/** Soft dark-green radial falloff, no hard edge — a cloud-shadow mass, not a
 * contact shadow. Shared/cached like the contact-shadow texture above. */
function cloudShadowTexture() {
  if (cloudShadowTex) return cloudShadowTex
  const px = 256
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = px
  const ctx = canvas.getContext('2d')
  const g = ctx.createRadialGradient(px / 2, px / 2, 0, px / 2, px / 2, px / 2)
  g.addColorStop(0, 'rgba(18,42,24,0.4)')
  g.addColorStop(0.55, 'rgba(18,42,24,0.32)')
  g.addColorStop(1, 'rgba(18,42,24,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, px, px)
  cloudShadowTex = new THREE.CanvasTexture(canvas)
  return cloudShadowTex
}

/** A single large soft dark-green decal across the foreground so the picture
 * has a dark to read the midtone field against — the value structure the
 * near-overhead-sun/flat-midtone composition was missing entirely. No
 * outline: a cloud shadow is a mass of tone, not a drawn silhouette. */
function buildCloudShadowMass(width, depth) {
  const geo = new THREE.PlaneGeometry(width, depth)
  geo.rotateX(-Math.PI / 2)
  const mat = new THREE.MeshBasicMaterial({ map: cloudShadowTexture(), transparent: true, depthWrite: false, fog: false })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.renderOrder = 1
  return mesh
}

// ------------------------------------------------------------------ path

/** Ribbon strip along a Catmull-Rom curve through world-space points. Flat
 * ground decal: explicit up normals (not computeVertexNormals(), which — combined
 * with the old winding — produced downward normals and got backface-culled
 * from the tycoon camera entirely) and a winding order that faces the sky.
 * No ink hull: a flat decal shouldn't carry an inverted-hull outline. Wins the
 * depth test against the ground via negative polygon offset instead. */
function buildPathMesh(points, width) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p.x, 0.02, p.z)))
  const samples = curve.getSpacedPoints(48)
  const verts = []
  const uvs = []
  const normals = []
  for (let i = 0; i < samples.length; i++) {
    const t = i / (samples.length - 1)
    const tangent = curve.getTangentAt(t)
    const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize()
    const p = samples[i]
    verts.push(p.x + (normal.x * width) / 2, p.y, p.z + (normal.z * width) / 2)
    verts.push(p.x - (normal.x * width) / 2, p.y, p.z - (normal.z * width) / 2)
    uvs.push(0, t, 1, t)
    normals.push(0, 1, 0, 0, 1, 0)
  }
  const idx = []
  for (let i = 0; i < samples.length - 1; i++) {
    const a = i * 2
    const b = i * 2 + 1
    const cIdx = i * 2 + 2
    const d = i * 2 + 3
    idx.push(a, cIdx, b, b, cIdx, d)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geo.setIndex(idx)
  const mesh = new THREE.Mesh(
    geo,
    toonMaterial(0xc09a63, { steps: 3, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
  )
  mesh.receiveShadow = true
  return mesh
}

// ------------------------------------------------------------- scatter props

function buildRock(seed) {
  const rnd = seededRand(seed)
  const g = new THREE.Group()
  const mesh = new THREE.Mesh(new THREE.DodecahedronGeometry(0.35 + rnd() * 0.25, 0), toonMaterial(0x8d8f92, { steps: 3 }))
  mesh.scale.set(1, 0.6 + rnd() * 0.3, 1)
  mesh.rotation.y = rnd() * Math.PI * 2
  mesh.position.y = mesh.geometry.parameters.radius * 0.35
  g.add(mesh)
  return addOutline(g, { thickness: 0.02 })
}

function buildStump() {
  const g = new THREE.Group()
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.38, 0.5, 10), toonMaterial(0x7d5228, { steps: 3 }))
  trunk.position.y = 0.25
  g.add(trunk)
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.04, 10), toonMaterial(0xc99a5c, { steps: 3 }))
  cap.position.y = 0.51
  g.add(cap)
  return addOutline(g, { thickness: 0.025 })
}

function buildFlowerTuft(petalColor) {
  const g = new THREE.Group()
  const stemMat = toonMaterial(0x4c8a34, { steps: 3 })
  const petalMat = toonMaterial(petalColor, { steps: 3 })
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2
    const r = 0.08 + (i % 2) * 0.05
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.22, 5), stemMat)
    stem.position.set(Math.cos(a) * r, 0.11, Math.sin(a) * r)
    g.add(stem)
    const petal = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 5), petalMat)
    petal.position.set(Math.cos(a) * r, 0.24, Math.sin(a) * r)
    g.add(petal)
  }
  return addOutline(g, { thickness: 0.015 })
}

function buildTrough() {
  const g = new THREE.Group()
  const outer = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.4, 0.6), toonMaterial(0x7d5228, { steps: 3 }))
  outer.position.y = 0.2
  g.add(outer)
  const inner = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.12, 0.42), toonMaterial(0x5fb8d6, { steps: 3 }))
  inner.position.y = 0.36
  g.add(inner)
  return addOutline(g, { thickness: 0.02 })
}

function buildWheelbarrow() {
  const g = new THREE.Group()
  const bin = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.35, 0.55), toonMaterial(0xb3401f, { steps: 3 }))
  bin.position.set(0, 0.35, 0)
  bin.rotation.x = -0.12
  g.add(bin)
  const wood = toonMaterial(0x7d5228, { steps: 3 })
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.05, 8, 14), wood)
  wheel.position.set(0, 0.2, 0.5)
  g.add(wheel)
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.3, 0.06), wood)
    leg.position.set(0.3 * s, 0.15, -0.15)
    g.add(leg)
  }
  return addOutline(g, { thickness: 0.015 })
}

// -------------------------------------------------------- vertical landmarks

/** Tall silhouette props near the horizon band — the composition had no
 * vertical accents anywhere between the coop and the barn, so it read as a
 * stack of horizontals (fences, coop, barn ridge). ~9u tall, chunky, readable
 * as a silhouette at distance. */
function buildSilo() {
  const g = new THREE.Group()
  const body = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 7, 14), toonMaterial(0xc7cdd2, { steps: 3 }))
  body.position.y = 3.5
  g.add(body)
  const cap = new THREE.Mesh(new THREE.ConeGeometry(1.55, 1.6, 14), toonMaterial(0x8a3226, { steps: 3 }))
  cap.position.y = 7.8
  g.add(cap)
  const bandMat = toonMaterial(0x9aa2a8, { steps: 2 })
  for (const y of [2, 4.2, 6.2]) {
    const band = new THREE.Mesh(new THREE.TorusGeometry(1.42, 0.06, 6, 16), bandMat)
    band.rotation.x = Math.PI / 2
    band.position.y = y
    g.add(band)
  }
  return addOutline(g, { thickness: 0.04 })
}

function buildWindmill() {
  const g = new THREE.Group()
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.9, 8, 8), toonMaterial(0xb3401f, { steps: 3 }))
  tower.position.y = 4
  g.add(tower)
  const hub = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 8), toonMaterial(0x3a2a1c, { steps: 2 }))
  hub.position.y = 8.1
  g.add(hub)
  const bladeMat = toonMaterial(0xf0e6cf, { steps: 3 })
  for (let i = 0; i < 4; i++) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.6, 0.05), bladeMat)
    blade.position.y = 8.1
    blade.rotation.z = (i / 4) * Math.PI * 2
    blade.translateY(1.3)
    g.add(blade)
  }
  return addOutline(g, { thickness: 0.035 })
}

function buildWaterTower() {
  const g = new THREE.Group()
  const legMat = toonMaterial(0x6a4a2c, { steps: 3 })
  for (const [sx, sz] of [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 6, 6), legMat)
    leg.position.set(sx, 3, sz)
    leg.rotation.z = -sx * 0.06
    leg.rotation.x = sz * 0.06
    g.add(leg)
  }
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.8, 2.4, 14), toonMaterial(0x7d5228, { steps: 3 }))
  tank.position.y = 7.2
  g.add(tank)
  const roof = new THREE.Mesh(new THREE.ConeGeometry(2.0, 1.2, 14), toonMaterial(0x4a2f1a, { steps: 2 }))
  roof.position.y = 9.0
  g.add(roof)
  return addOutline(g, { thickness: 0.04 })
}

const TREE_BASE_HUES = [0x4fa33c, 0x74c94b, 0x3f8f34]

/** Per-instance canopy color: +/-12deg hue jitter off a base green, with
 * distance (farT 0..1) pushing further toward cool/desaturated/light so far
 * clumps read as haze rather than holding full contrast to the frame edge. */
function jitterCanopyColor(baseHex, hueDeg, farT) {
  const c = new THREE.Color(baseHex)
  const hsl = { h: 0, s: 0, l: 0 }
  c.getHSL(hsl)
  hsl.h = (hsl.h + hueDeg / 360 + 0.03 * farT + 1) % 1
  hsl.s = THREE.MathUtils.clamp(hsl.s * (1 - farT * 0.35), 0, 1)
  hsl.l = THREE.MathUtils.clamp(hsl.l + farT * 0.16, 0, 1)
  c.setHSL(hsl.h, hsl.s, hsl.l)
  return c.getHex()
}

/** Tints canopy meshes (world Y above the trunk) without touching models.js —
 * every ball() in makeTree() gets its own material instance, so this is safe. */
function tintCanopy(tree, hex) {
  const color = new THREE.Color(hex)
  const wp = new THREE.Vector3()
  tree.traverse((o) => {
    if (!o.isMesh || o.userData.isOutline) return
    o.getWorldPosition(wp)
    if (wp.y > 1.8) o.material.color.copy(color)
  })
  return tree
}

// ------------------------------------------------------------- crop patch

/** Tilled bed with furrow stripes under staggered, height-varied plants —
 * reads as agriculture instead of a bare grid of chevrons. Yellower green
 * than the field so crops read as a distinct hue, not more grass; `withFruit`
 * scatters red-orange fruit notes so one bed reads as a different crop
 * entirely rather than a re-skin of the others. */
function buildCropPatch(seed = 1, withFruit = false) {
  const rnd = seededRand(seed)
  const group = new THREE.Group()
  const bedW = 4.2
  const bedD = 3.6
  const rows = 3
  const cols = 4
  const bed = new THREE.Mesh(new THREE.BoxGeometry(bedW, 0.08, bedD), toonMaterial(0x6b4a2a, { steps: 3 }))
  bed.position.y = 0.04
  group.add(bed)
  const furrowMat = toonMaterial(0x50331c, { steps: 3 })
  for (let r = 0; r < rows; r++) {
    const furrow = new THREE.Mesh(new THREE.BoxGeometry(bedW * 0.94, 0.02, 0.16), furrowMat)
    furrow.position.set(0, 0.085, r * (bedD / rows) - bedD / 2 + bedD / (rows * 2))
    group.add(furrow)
  }
  const leafMat = toonMaterial(0x8fbb3a, { steps: 3 })
  const fruitMat = toonMaterial(0xe0532a, { steps: 3 })
  for (let r = 0; r < rows; r++) {
    for (let cIdx = 0; cIdx < cols; cIdx++) {
      const h = 0.85 + rnd() * 0.35
      const jitter = (rnd() - 0.5) * 0.18
      const px = (cIdx * bedW * 0.85) / (cols - 1) - (bedW * 0.85) / 2 + jitter
      const pz = r * (bedD / rows) - bedD / 2 + bedD / (rows * 2) + jitter
      const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.22, h, 6), leafMat)
      leaf.position.set(px, h / 2 + 0.08, pz)
      group.add(leaf)
      if (withFruit && rnd() > 0.45) {
        const fruit = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), fruitMat)
        fruit.position.set(px, h * 0.7 + 0.08, pz)
        group.add(fruit)
      }
    }
  }
  return addOutline(group, { thickness: 0.025 })
}

// -------------------------------------------------------------------- pond

/** Small cool-complement accent — a painted water disc with an ink rim so the
 * field has a saturated blue note to sit against, not just green everywhere.
 * The rim is a slightly-larger dark disc peeking out from under the water,
 * not an inverted-hull outline: a flat circle's vertex normals are all
 * identical (straight up), so a normal-offset hull just shifts the whole
 * disc rather than expanding its edge — the same defect the path had. */
function buildPond(radius) {
  const g = new THREE.Group()
  const rim = new THREE.Mesh(new THREE.CircleGeometry(radius * 1.08, 28), toonMaterial(0x1a1208, { steps: 2 }))
  rim.rotation.x = -Math.PI / 2
  rim.position.y = 0.025
  g.add(rim)
  const water = new THREE.Mesh(new THREE.CircleGeometry(radius, 28), toonMaterial(0x4a9fc9, { steps: 3 }))
  water.rotation.x = -Math.PI / 2
  water.position.y = 0.04
  g.add(water)
  const highlight = new THREE.Mesh(new THREE.CircleGeometry(radius * 0.5, 22), toonMaterial(0x7ecbe8, { steps: 2 }))
  highlight.rotation.x = -Math.PI / 2
  highlight.position.set(radius * 0.18, 0.045, -radius * 0.12)
  g.add(highlight)
  return g
}

// ---------- World ----------

export class World {
  constructor(scene) {
    this.scene = scene
    this.size = SIZE
    this.obstacles = []
    // Near/far pushed out (was 32/105, which washed the whole 120-unit field
    // to one cream value past the fence line) so fog only touches the
    // treeline ring (HALF+6 = 66u) and never the played field itself.
    this.scene.fog = new THREE.Fog(FOG_COLOR, 85, 200)
    this._buildSky()
    this._buildLights()
    this._buildGround()
    this._placeObstacles()
  }

  addObstacle(x, z, r) {
    const obstacle = { x, z, r }
    this.obstacles.push(obstacle)
    return obstacle
  }

  isWalkable(x, z) {
    if (x < -HALF || x > HALF || z < -HALF || z > HALF) return false
    for (const o of this.obstacles) {
      const dx = x - o.x
      const dz = z - o.z
      if (dx * dx + dz * dz < o.r * o.r) return false
    }
    return true
  }

  groundHeightAt(_x, _z) {
    return 0
  }

  _buildSky() {
    this.scene.add(buildSkyDome())
    const spots = [
      { x: -46, y: 15, z: -18, s: 1.4, ry: 0.4 },
      { x: -20, y: 18, z: -46, s: 1.7, ry: 1.1 },
      { x: 18, y: 16, z: -50, s: 1.2, ry: 2.3 },
      { x: 46, y: 20, z: -10, s: 1.5, ry: 3.0 },
      { x: 50, y: 14, z: 24, s: 1.1, ry: 0.7 },
      { x: -12, y: 22, z: 48, s: 1.3, ry: 2.0 },
    ]
    for (const spot of spots) {
      const cloud = buildCloud()
      cloud.position.set(spot.x, spot.y, spot.z)
      cloud.scale.set(spot.s, spot.s * 0.55, spot.s)
      cloud.rotation.y = spot.ry
      this.scene.add(cloud)
    }
  }

  _buildLights() {
    // Sun dropped low (was near-overhead at (18,70,26)) so props throw long,
    // decisive raking shadows across open grass — the cartoon staging device
    // a near-overhead sun erases entirely by tucking every shadow underneath.
    // Warmer key (was 0xfff0d0, nearly white) so lit grass goes yellow-green
    // and the whole picture reads as one warm-cool separation instead of one hue.
    const sun = new THREE.DirectionalLight(0xffe4a8, 2.2)
    sun.position.set(26, 34, 30)
    sun.target.position.set(0, 0, 0)
    sun.castShadow = true
    const reach = 30 // tightened to the actually-played area — was 46 — doubles texel density
    Object.assign(sun.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach, near: 1, far: 150 })
    sun.shadow.mapSize.set(2048, 2048)
    // normalBias (not bias) is the correct control for acne on geometry with
    // depth like the barn eaves — the old bias-only setup was reading on
    // screen as a shadow-moiré crosshatch pattern on the barn's trim.
    sun.shadow.bias = -0.0005
    sun.shadow.normalBias = 0.05
    sun.shadow.radius = 0 // hard map edge — cel shadows are drawn shapes, not photographic blur
    this.scene.add(sun, sun.target)
    // Warm ambient (was cool blue 0xbcd9ff) so shadowed faces keep their hue
    // instead of draining to grey-green, and read brighter (~55-60%).
    this.scene.add(new THREE.AmbientLight(0xffe6c0, 0.75))
  }

  _buildGround() {
    const segs = 48
    const geo = new THREE.PlaneGeometry(this.size, this.size, segs, segs)
    geo.rotateX(-Math.PI / 2)
    applyBroadFieldShading(geo)
    const mat = toonMaterial(0xffffff, { steps: 3, vertexColors: true })
    mat.map = buildGroundTexture()
    mat.needsUpdate = true
    const ground = new THREE.Mesh(geo, mat)
    ground.receiveShadow = true
    this.scene.add(ground)
    this.scene.add(buildFarBackdropGround(this.size))
    this._placeCloudShadowMass()
  }

  /** Large soft dark-green cloud-shadow decal across the bottom ~20% of the
   * field (the foreground band nearest the default camera at z=30, looking
   * toward -z) — anchors the composition with a dark mass to read the
   * midtone field against, per the dark-foreground/light-middle staging a
   * theatrical background needs and the flat single-midtone slab lacked. */
  _placeCloudShadowMass() {
    const mass = buildCloudShadowMass(100, 28)
    mass.position.set(8, 0.03, 46)
    mass.rotation.y = 0.12
    this.scene.add(mass)
  }

  _addToScene(mesh, x, z, rotY = 0) {
    mesh.position.set(x, this.groundHeightAt(x, z), z)
    mesh.rotation.y = rotY
    enableShadows(mesh)
    this.scene.add(mesh)
    return mesh
  }

  _place(mesh, x, z, r, rotY = 0) {
    this._addToScene(mesh, x, z, rotY)
    const shadow = buildContactShadow(r * 1.3)
    shadow.position.set(x + SHADOW_DIR.x * r * SHADOW_OFFSET, 0.015, z + SHADOW_DIR.y * r * SHADOW_OFFSET)
    this.scene.add(shadow)
    this.addObstacle(x, z, r)
    return mesh
  }

  _placeFenceLine(length, x, z, rotY) {
    this._addToScene(makeFence(length), x, z, rotY)
    // a straight fence isn't one blocking circle: approximate it with a
    // string of post-sized circles along its run so isWalkable stays honest.
    const steps = Math.max(2, Math.round(length / 3))
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps - 0.5) * length
      this.addObstacle(x + Math.cos(rotY) * t, z - Math.sin(rotY) * t, 0.55)
    }
  }

  _placeGate(x, z) {
    const g = new THREE.Group()
    const mat = toonMaterial(0xb07a3e, { steps: 3 })
    for (const y of [0.84, 0.46]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.15, 0.12), mat)
      rail.position.y = y
      g.add(rail)
    }
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.2, 0.2), mat)
    post.position.set(-1.8, 0.55, 0)
    g.add(post)
    g.rotation.y = -0.55 // swung open into the paddock
    g.position.set(x, 0, z)
    addOutline(g, { thickness: 0.03 })
    enableShadows(g)
    this.scene.add(g)
  }

  _findScatterSpot(cx, cz, spread, maxTries = 10) {
    for (let i = 0; i < maxTries; i++) {
      const x = cx + (Math.random() - 0.5) * spread
      const z = cz + (Math.random() - 0.5) * spread
      if (this.isWalkable(x, z)) return { x, z }
    }
    return null
  }

  _placeObstacles() {
    this._placeBarn()
    this._placePaddock()
    this._placeHaystacks()
    this._placePig()
    this._placeCrops()
    this._placePond()
    this._placeScatter()
    this._placePath()
    this._placeTrees()
    this._placeLandmarks()
  }

  /** Vertical accents near the horizon band that break up the composition's
   * horizontal banding (fences, coop, barn ridge) and give the eye somewhere
   * to travel between the coop and the barn. */
  _placeLandmarks() {
    this._place(buildSilo(), -42, -34, 1.6, 0.3)
    this._place(buildWindmill(), 30, -50, 1.0, -0.4)
    this._place(buildWaterTower(), -8, -54, 1.3, 0.8)
  }

  _placeBarn() {
    this._place(makeBarn(), 11, -14, 5.6, 0)
  }

  _placePaddock() {
    // Closed loop (was four orphaned runs) with a gate gap on the south
    // side and a swing-gate prop bridging it.
    this._placeFenceLine(12, 8, -9, 0) // south, west of gate
    this._placeFenceLine(12, 24, -9, 0) // south, east of gate
    this._placeFenceLine(28, 30, 5, Math.PI / 2) // east
    this._placeFenceLine(28, 16, 19, 0) // north
    this._placeFenceLine(28, 2, 5, Math.PI / 2) // west
    this._placeGate(16, -9)
  }

  _placeHaystacks() {
    // Barn-side cluster plus a second, smaller cluster in the left third —
    // the hay gold was jammed into one corner with the barn red; this
    // distributes the saturated warm note instead of leaving two thirds of
    // the frame monochrome green.
    const spots = [
      { x: 18, z: -11, r: 1.3 },
      { x: 21, z: -12.5, r: 1.2 },
      { x: 18, z: -13.5, r: 1.2 },
      { x: -28, z: -9, r: 1.2 },
      { x: -25.5, z: -7.3, r: 1.1 },
    ]
    for (const s of spots) this._place(makeHaystack(), s.x, s.z, s.r, Math.random() * Math.PI * 2)
  }

  _placePig() {
    const pig = makePig()
    this._place(pig, -3, 6, 1.3, pig.userData.restYaw ?? -0.4)
  }

  _placeCrops() {
    const spots = [
      { x: -15, z: 11, seed: 11 },
      { x: -6, z: 17, seed: 22, fruit: true },
      { x: -18, z: 18, seed: 33 },
    ]
    for (const s of spots) this._addToScene(buildCropPatch(s.seed, !!s.fruit), s.x, s.z, Math.random() * Math.PI * 2)
  }

  /** Cool complement placed before the rock/flower scatter passes so their
   * _findScatterSpot obstacle-avoidance keeps clear of it automatically.
   * Pulled inward (was -20,-3, out where fog ate it) so the left midfield
   * carries real mass at readable scale. */
  _placePond() {
    const x = -14
    const z = -6
    const r = 3.2
    this._addToScene(buildPond(r), x, z, 0)
    this.addObstacle(x, z, r)
  }

  _placeScatter() {
    this._placeFlowerTufts()
    this._placeRocks()
    this._placeStumps()
    this._placeYardProps()
  }

  /** Grouped by color — one drift of red, one of yellow, one of purple — so
   * each cluster reads as a single accent mass instead of scattering as
   * mixed-color confetti (was one `colors` array cycled per-instance across
   * every cluster). Tripled scale + tightened per-drift count to the 5-6
   * readable-mass range the critic called for (was 9/7/6 at 1x scale). */
  _placeFlowerTufts() {
    const drifts = [
      { x: 6, z: -4, spread: 10, count: 5, color: 0xe6483c },
      { x: -12, z: 8, spread: 10, count: 6, color: 0xf2c230 },
      { x: 5, z: 32, spread: 12, count: 5, color: 0xc060d6 },
    ]
    for (const d of drifts) {
      for (let n = 0; n < d.count; n++) {
        const spot = this._findScatterSpot(d.x, d.z, d.spread)
        if (!spot) continue
        const tuft = buildFlowerTuft(d.color)
        tuft.scale.setScalar(3)
        this._addToScene(tuft, spot.x, spot.z, Math.random() * Math.PI * 2)
      }
    }
  }

  _placeRocks() {
    const clusters = [
      { x: 20, z: -2, spread: 20, count: 5 },
      { x: -30, z: 0, spread: 30, count: 5 },
      { x: 0, z: 40, spread: 30, count: 4 },
    ]
    let seed = 500
    for (const cl of clusters) {
      for (let n = 0; n < cl.count; n++) {
        const spot = this._findScatterSpot(cl.x, cl.z, cl.spread)
        if (!spot) continue
        this._place(buildRock(seed++), spot.x, spot.z, 0.4)
      }
    }
  }

  _placeStumps() {
    for (let i = 0; i < 6; i++) {
      const a = Math.random() * Math.PI * 2
      const r = HALF - 8 + Math.random() * 4
      const spot = this._findScatterSpot(Math.cos(a) * r, Math.sin(a) * r, 3)
      if (!spot) continue
      this._place(buildStump(), spot.x, spot.z, 0.45)
    }
  }

  _placeYardProps() {
    const trough = this._findScatterSpot(6, -6, 6)
    if (trough) this._place(buildTrough(), trough.x, trough.z, 0.9)
    const barrow = this._findScatterSpot(6, -17, 5)
    if (barrow) this._place(buildWheelbarrow(), barrow.x, barrow.z, 0.6, Math.random() * Math.PI * 2)
  }

  _placePath() {
    // Leading line: barn doors, through the paddock gate, across the field,
    // off toward the camera-side edge.
    const pts = [
      { x: 11, z: -10.5 },
      { x: 16, z: -9 },
      { x: 19, z: -2 },
      { x: 15, z: 8 },
      { x: 20, z: 24 },
      { x: 27, z: 38 },
      { x: 32, z: 54 },
    ]
    const path = buildPathMesh(pts, 3.8)
    enableShadows(path)
    path.receiveShadow = true
    this.scene.add(path)
  }

  _placeTrees() {
    // Pulled inward (was -24..-26,-17..-22 — pushed out where fog ate it) to
    // x -18..-8, z -18..-8 so the left midfield carries real mass at
    // readable scale instead of leaving that depth band undifferentiated.
    const grove = [{ x: -16, z: -16 }, { x: -10, z: -11 }, { x: -9, z: -17 }, { x: -15, z: -11 }]
    for (const s of grove) this._place(makeTree(), s.x, s.z, 1.1, Math.random() * Math.PI * 2)
    this._placeForegroundFrame()
    this._placeTreeline()
  }

  /** Deliberate near-camera silhouette arch (was two accidental trees
   * hanging inside the start camera's near view) — darker, cooler leaf tone
   * so it reads as a frame rather than competing with the field. */
  _placeForegroundFrame() {
    const spots = [{ x: 40, z: 30, s: 1.5 }, { x: 44, z: 18, s: 1.3 }, { x: 34, z: 42, s: 1.4 }]
    for (const spot of spots) {
      const tree = tintCanopy(makeTree(), 0x2f6b28)
      tree.scale.setScalar(spot.s)
      this._place(tree, spot.x, spot.z, 1.4 * spot.s, Math.random() * Math.PI * 2)
    }
  }

  /** Overlap check that ignores world bounds (the treeline deliberately sits
   * past HALF, in the fog) and only guards against stacking on obstacles. */
  _isClearSpot(x, z, margin) {
    for (const o of this.obstacles) {
      const dx = x - o.x
      const dz = z - o.z
      const rr = o.r + margin
      if (dx * dx + dz * dz < rr * rr) return false
    }
    return true
  }

  /** One clump: 4-7 trees gaussian-scattered around baseAngle, varied scale
   * and per-instance canopy hue — never the same silhouette/size/hue twice. */
  _placeTreeClump(baseAngle, ringR) {
    const treeCount = 4 + Math.floor(Math.random() * 4)
    for (let i = 0; i < treeCount; i++) {
      const angle = baseAngle + gaussianRandom(0.1)
      const r = ringR + gaussianRandom(6)
      const x = Math.cos(angle) * r
      const z = Math.sin(angle) * r
      const scale = 0.7 + Math.random() * 1.0
      if (!this._isClearSpot(x, z, 1.1 * scale)) continue
      const farT = smooth01(r, ringR - 6, ringR + 16)
      const base = TREE_BASE_HUES[Math.floor(Math.random() * TREE_BASE_HUES.length)]
      const hueDeg = (Math.random() - 0.5) * 24
      const tree = tintCanopy(makeTree(), jitterCanopyColor(base, hueDeg, farT))
      tree.scale.setScalar(scale)
      this._place(tree, x, z, 1.1 * scale, Math.random() * Math.PI * 2)
    }
  }

  /** Forest border as clumps, not an evenly-spaced ring of identical
   * lollipops: 7-9 clusters (2 of 10 candidate slots left as deliberate gaps
   * so the eye can see through to the backdrop) pushed past HALF so the
   * fog knee (near=85) actually reaches them before the frame edge. */
  _placeTreeline() {
    const ringR = HALF + 6
    const slots = 10
    const gapSlots = new Set()
    while (gapSlots.size < 2) gapSlots.add(Math.floor(Math.random() * slots))
    for (let slot = 0; slot < slots; slot++) {
      if (gapSlots.has(slot)) continue
      const baseAngle = (slot / slots) * Math.PI * 2 + (Math.random() - 0.5) * 0.3
      this._placeTreeClump(baseAngle, ringR)
    }
  }
}
