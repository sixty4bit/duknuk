import * as THREE from 'three'
import { toonMaterial, addOutline } from './art/toon.js'
import { makeBarn, makeFence, makeHaystack, makePig, makeTree } from './art/models.js'

const SIZE = 120
const HALF = SIZE / 2
// Warmed (was 0xc3d4e0, a cool blue-violet within a few percent of the sky's
// horizon band and the far-backdrop disc — fog, sky-horizon and far-ground
// fused into one grey slab). A warm haze separates by hue as well as value.
const FOG_COLOR = 0xd9dcc4

// Side-and-slightly-behind the subject (elevation ~24deg, azimuth roughly
// camera-left) instead of near-overhead — was (26,34,30), which combined with
// the tycoon camera at (2,14,34)/elevation ~41deg put every cast shadow
// behind the eye or straight underneath its own occluder. This position
// throws long shadows laterally across the stage, toward camera-left,
// squarely inside the frame. Shared by _buildLights (the real sun) and
// SHADOW_DIR/the cel contact-shadow decals below, so the two can never drift
// out of sync.
const SUN_POS = new THREE.Vector3(34, 20, -10)

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

/** Painter's-eye grass texture: dense small hand-drawn grass-clump strokes at
 * grass scale (~6 world units/tile). The broad value masses are owned
 * entirely by the vertex-color field bands (applyBroadFieldShading) now — this
 * texture only supplies the fine brushy detail on top, not competing blobs. */
function buildGroundTexture() {
  // 1024px at repeat(20,20) — was 256px at repeat(14,14), which put the same
  // handful of strokes in lockstep across 5-8 visible tiles and read as a
  // checkerboard. A bigger canvas at a tight repeat plus far more, far
  // smaller strokes means no single mark is identifiable as a repeating
  // motif or sized like foliage instead of grass.
  const px = 1024
  const scale = px / 256
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = px
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#7ec852'
  ctx.fillRect(0, 0, px, px)
  const rnd = seededRand(4242)
  // The radial masses previously drawn here (24-40 soft blobs, r up to 26
  // world units) fought the vertex-color field bands, which now own the
  // broad-mass job at a correct 12-18u frequency (see applyBroadFieldShading)
  // — deleted rather than shrunk, since two systems drawing the same masses
  // at different scales is the redundancy the critic flagged.
  const tones = ['#6cb544', '#8fd867', '#5a9e3a']
  ctx.lineCap = 'round'
  // Strokes shrunk from len (18+22)*scale / width (6+6)*scale — 4.7u long by
  // 1.4u wide, prop-sized (as wide as the chicken, 3x longer) — to grass-mark
  // scale (~0.35u long, 0.09u wide), with count raised to stay dense enough
  // not to read as sparse dots at the new tighter repeat.
  const strokeCount = 400
  for (let i = 0; i < strokeCount; i++) {
    const x = rnd() * px
    const y = rnd() * px
    const a = rnd() * Math.PI
    const len = (6 + rnd() * 7) * scale
    ctx.strokeStyle = tones[i % tones.length]
    ctx.lineWidth = (1.6 + rnd() * 1.4) * scale
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.quadraticCurveTo(x + Math.cos(a) * len * 0.5, y + Math.sin(a) * len * 0.5 - 6 * scale, x + Math.cos(a) * len, y + Math.sin(a) * len)
    ctx.stroke()
  }
  const tex = new THREE.CanvasTexture(canvas)
  if ('colorSpace' in tex) tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  // 120-unit plane, repeat 20x so each tile spans 6 world units of painted
  // texture — grass scale, not foliage scale (was repeat(4,4) = 30u/tile).
  tex.repeat.set(20, 20)
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

// Posterized field bands — one hue family (green), value window widened to a
// clearly readable +/-10% (was +/-6%, invisible in every render — the critic
// found zero drawn geography across ~60% of the frame). Grass varies by a
// few percent of hue; the picture's dark should still come from drawn cast
// shadows, never the field tint, but the *masses* now need to actually show.
const FIELD_BANDS = [
  { color: new THREE.Color(0x86c057), value: 0.9 },
  { color: new THREE.Color(0x9ccb5e), value: 1.0 },
  { color: new THREE.Color(0xb2d668), value: 1.1 },
]

/** Low-frequency field variation baked as vertex colors, quantized into
 * discrete painted bands instead of a continuous cool-to-warm airbrush.
 * Wavelength tuned to ~30-32u (25-35u target) so the 120u field carries two
 * or three broad, travel-able masses rather than a fine grid or one flat
 * value — the amplitude above is what actually made those masses show; this
 * frequency is what keeps them broad instead of confetti-sized. */
function applyBroadFieldShading(geo) {
  const pos = geo.attributes.position
  const colors = new Float32Array(pos.count * 3)
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const z = pos.getZ(i)
    const n = Math.sin(x * 0.15 + z * 0.13 + 1.7) * 0.7 + Math.sin(x * 0.03 - z * 0.025) * 0.3
    const t = THREE.MathUtils.clamp(0.5 + n * 0.5, 0, 1)
    const band = FIELD_BANDS[Math.min(FIELD_BANDS.length - 1, Math.floor(t * FIELD_BANDS.length))]
    colors[i * 3] = band.color.r * band.value
    colors[i * 3 + 1] = band.color.g * band.value
    colors[i * 3 + 2] = band.color.b * band.value
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
}

/** Perturbs a CircleGeometry's rim (all vertices but the center) with a
 * low-frequency angular wobble so the disc's silhouette isn't a perfect
 * circle — used to keep the backdrop disc's rim from ever coinciding with
 * the ground plane's own dead-straight edge. Geometry is still flat/planar
 * (XY, pre-rotateX) so it's cheap and normals stay simple. */
function buildWobbledDiscGeometry(radius, segments, amp) {
  const geo = new THREE.CircleGeometry(radius, segments)
  const pos = geo.attributes.position
  for (let i = 1; i < pos.count; i++) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    const angle = Math.atan2(y, x)
    const wobble = 1 + (Math.sin(angle * 7) * 0.6 + Math.sin(angle * 3 + 1.3) * 0.4) * amp
    pos.setX(i, x * wobble)
    pos.setY(i, y * wobble)
  }
  pos.needsUpdate = true
  return geo
}

/** Flat desaturated backdrop disc past the played field so it never
 * terminates on a hard edge. Pushed to radius 170 (was HALF+10 = 70, which
 * sat only ~0.8deg / 17px from the ground plane's own z=-60 edge and fused
 * into one dead-straight horizon line) and dropped/tilted so its rim never
 * runs parallel to the ground plane's edge — and still past fog.far (110,
 * see World constructor) so the disc is fully fog-tinted well before its own
 * edge could present as a seam. Rim is wobbled, not a clean circle, for the
 * same reason. Recolored distinctly greener and darker than FOG_COLOR/the
 * sky horizon (was 0xaec2ba, a few percent off both) so it reads as
 * continuing pasture receding into haze, not as a third slab of sky. */
function buildFarBackdropGround() {
  const radius = 170
  const geo = buildWobbledDiscGeometry(radius, 64, 0.03)
  geo.rotateX(-Math.PI / 2)
  const mat = toonMaterial(0x9db78a, { steps: 2 })
  const disc = new THREE.Mesh(geo, mat)
  disc.position.y = -1.2
  disc.rotation.x = THREE.MathUtils.degToRad(0.5)
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

/** Five-puff cloud massing — this shape reads fine at any scale; it was only
 * ever the count/size in drawPaintedClouds that fused clouds into a slab.
 * `alpha`/`fill` let a far, hazier rank sit behind the near rank without a
 * second drawing routine. */
function drawCloudShape(ctx, cx, cy, s, { alpha = 0.94, fill = '#fffaf2' } = {}) {
  ctx.globalAlpha = 0.16 * (alpha / 0.94)
  ctx.fillStyle = '#3b587a'
  ctx.beginPath()
  ctx.ellipse(cx, cy + s * 0.18, s * 1.1, s * 0.32, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalAlpha = alpha
  ctx.fillStyle = fill
  const puffs = [[0, 0, 1], [0.7, 0.15, 0.65], [-0.7, 0.12, 0.68], [0.25, -0.35, 0.55], [-0.3, -0.3, 0.5]]
  for (const [dx, dy, r] of puffs) {
    ctx.beginPath()
    ctx.ellipse(cx + dx * s, cy + dy * s * 0.6, r * s * 0.75, r * s * 0.42, 0, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1
}

/** Painted-flat clouds baked straight into the backdrop so they are visible
 * from frame one regardless of where the camera is orbited to. cy/scale are
 * pinned to the dome's actually-visible band (elevation = 90 - 180*(y/h); the
 * default camera only ever sees roughly -6.5..+4.4deg, i.e. y = h*0.475..0.537).
 * Cut from 9 clouds at 30-55px to 4-5 at 12-22px — nine clouds that size on a
 * 1024px dome each subtend 21-38deg of azimuth, more than the full
 * circumference once the seam duplicates are counted, which is what fused
 * them into one continuous white bar. A far rank (half scale, greyer, lower
 * alpha) sits behind a near rank (full scale/alpha) so the two ranks read as
 * depth instead of one flat layer, and a minimum angular separation keeps
 * real sky visible between every cloud. */
function drawPaintedClouds(ctx, w, h) {
  const rnd = seededRand(99)
  const accepted = []
  const place = (scale, cyMin, cyMax, opts) => {
    for (let tries = 0; tries < 24; tries++) {
      const cx = rnd() * w
      const minSep = scale * 2.5
      const clash = accepted.some((a) => Math.min(Math.abs(a - cx), w - Math.abs(a - cx)) < minSep)
      if (clash) continue
      accepted.push(cx)
      const cy = h * (cyMin + rnd() * (cyMax - cyMin))
      drawCloudShape(ctx, cx, cy, scale, opts)
      if (cx < scale * 1.5) drawCloudShape(ctx, cx + w, cy, scale, opts)
      if (cx > w - scale * 1.5) drawCloudShape(ctx, cx - w, cy, scale, opts)
      return
    }
  }
  // Far rank first so the near rank can sit visually in front of it.
  for (let i = 0; i < 2; i++) {
    const nearScale = 12 + rnd() * 10
    place(nearScale * 0.5, 0.45, 0.478, { alpha: 0.6, fill: '#d7dbe0' })
  }
  for (let i = 0; i < 3; i++) {
    place(12 + rnd() * 10, 0.478, 0.505)
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
  // The fog, the sky's horizon band and the far-backdrop disc all need to
  // separate by value or they fuse into one grey slab (the critic's "haze
  // soup"). Sky horizon is now the lightest of the three — lifted toward
  // white off FOG_COLOR rather than darkened (was *0.88) — with the fog
  // itself in between and the far-backdrop disc (buildFarBackdropGround)
  // the darkest, greenest of the three so it reads as pasture, not more sky.
  const horizon = new THREE.Color(FOG_COLOR).lerp(new THREE.Color(0xffffff), 0.18)
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
  // Was h*0.44, computed against the wrong occluder. The real constraint is
  // the dome's own elevation mapping: elevation = 90 - 180*(y/h), and the
  // default camera's visible band is only ~-6.5..+4.4deg — i.e. y =
  // h*0.475..0.537. h*0.44 (elevation +10.8deg) was off the top of the frame
  // entirely, which is why the ridge/treeline never rendered on screen.
  const horizonY = h * 0.505
  // Three receding painted planes instead of two (hill, treeline) — the hill
  // was near-black-adjacent to the treeline's own near-black (#1f2e1a next to
  // sky), so the treeline read as a rendering artifact and the hill nearly
  // vanished a value off the sky. Each band gets its own bump count/amplitude
  // (not a uniform scale of one another) so the three don't read as one
  // printed, repeating wobble — and the nearest (treeline) band carries the
  // largest, most irregular scallops, per how a painted flat recedes.
  drawSilhouetteBand(ctx, w, horizonY - h * 0.015, horizonY - h * 0.001, '#7d95a8', 5, h * 0.005) // far hill
  drawSilhouetteBand(ctx, w, horizonY - h * 0.005, horizonY + h * 0.005, '#5a7263', 8, h * 0.0055) // mid ridge
  drawSilhouetteBand(ctx, w, h * 0.512 - h * 0.013, h * 0.512 + h * 0.006, '#3c5240', 7, h * 0.011) // near treeline
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

// Derived from the real sun vector (see SUN_POS/_buildLights) rather than a
// hardcoded pair — a hardcoded direction is exactly what let the sun move to
// (26,34,30) while these shadows kept pointing as if it were still overhead.
// Cel shadows fall away from the light and get a squash/skew toward that
// direction so they read as drawn shapes that were placed, not grey blobs
// stamped straight down.
const SHADOW_DIR = new THREE.Vector2(-SUN_POS.x, -SUN_POS.z).normalize()
const SHADOW_ANGLE = Math.atan2(SHADOW_DIR.x, SHADOW_DIR.y)
// Raked up from 1.35 — a low-elevation sun (~24deg) casts long stretched
// shadows, not near-circular ones; the ellipse now reads as a cast shape.
const SHADOW_SQUASH = 2.0
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

/** Lobed cloud-shape silhouette (same five-puff massing as drawCloudShape),
 * filled flat and softened with a short blur — a cloud shadow is a drawn
 * lobed shape with a readable edge, not a bell-curve airbrush. Raised to
 * rgba(20,46,28,0.42) at a 2px blur (was 0.24 at 6px, ~6% value drop that was
 * invisible against mid-green grass) so the silhouette actually holds a
 * drawn contour, plus a second, smaller inner-lobe pass at 0.15 alpha so the
 * mass reads as two values (a core and a penumbra) instead of one flat tone.
 * Shared/cached like the contact-shadow texture above. */
function cloudShadowTexture() {
  if (cloudShadowTex) return cloudShadowTex
  const px = 256
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = px
  const ctx = canvas.getContext('2d')
  const s = px * 0.34
  const puffs = [[0, 0, 1], [0.7, 0.15, 0.65], [-0.7, 0.12, 0.68], [0.25, -0.35, 0.55], [-0.3, -0.3, 0.5]]
  const drawLobes = (scale, alpha) => {
    ctx.filter = 'blur(2px)'
    ctx.fillStyle = `rgba(20,46,28,${alpha})`
    for (const [dx, dy, r] of puffs) {
      ctx.beginPath()
      ctx.ellipse(px / 2 + dx * s * scale, px / 2 + dy * s * 0.6 * scale, r * s * 0.75 * scale, r * s * 0.42 * scale, 0, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  drawLobes(1, 0.42)
  drawLobes(0.62, 0.15)
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
 * depth test against the ground via negative polygon offset instead.
 * `color`/`steps` are parameterized (not just the dirt-path defaults) so the
 * same ribbon builder can draw the mown-stripe boundary in _placeMownStripe
 * without duplicating this geometry code. */
function buildPathMesh(points, width, { color = 0xc09a63, steps = 3, y = 0.02 } = {}) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p.x, y, p.z)))
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
    toonMaterial(color, { steps, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
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

/** Was three values of one brown with no cross-bracing, no hoop bands, no
 * ladder, no finial — at horizon distance it resolved to a flat untextured
 * box next to the silo, which reads instantly at the same distance purely
 * because its red cap is a hue/value break. Cream tank body separates it from
 * its own brown legs; hoop bands separate the tank from the cream itself;
 * cross-bracing, ladder and finial are the small silhouette breaks that read
 * as "built structure" rather than placeholder geometry. Scaled 1.35x as a
 * horizon landmark that needs to out-read the silo, not undersell it. */
function buildWaterTower() {
  const g = new THREE.Group()
  const legMat = toonMaterial(0x6a4a2c, { steps: 3 })
  const legSpots = [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]]
  for (const [sx, sz] of legSpots) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 6, 6), legMat)
    leg.position.set(sx, 3, sz)
    leg.rotation.z = -sx * 0.06
    leg.rotation.x = sz * 0.06
    g.add(leg)
  }
  const braceMat = toonMaterial(0x4a2f1a, { steps: 2 })
  const faces = [
    { pos: [0, 3, -0.9], axis: 'z' },
    { pos: [0, 3, 0.9], axis: 'z' },
    { pos: [-0.9, 3, 0], axis: 'x' },
    { pos: [0.9, 3, 0], axis: 'x' },
  ]
  for (const f of faces) {
    for (const sign of [1, -1]) {
      const brace = new THREE.Mesh(new THREE.BoxGeometry(0.08, 4.5, 0.08), braceMat)
      brace.position.set(...f.pos)
      if (f.axis === 'z') brace.rotation.z = sign * 0.62
      else brace.rotation.x = sign * 0.62
      g.add(brace)
    }
  }
  const ladderMat = toonMaterial(0x3a2a1c, { steps: 2 })
  const ladderX = 0.9
  const ladderZ = -1.05
  for (const dx of [-0.15, 0.15]) {
    const upright = new THREE.Mesh(new THREE.BoxGeometry(0.05, 6, 0.05), ladderMat)
    upright.position.set(ladderX + dx, 3, ladderZ)
    g.add(upright)
  }
  for (let i = 0; i < 6; i++) {
    const rung = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, 0.05), ladderMat)
    rung.position.set(ladderX, 0.6 + i * 0.95, ladderZ)
    g.add(rung)
  }
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.8, 2.4, 14), toonMaterial(0xe8dcc0, { steps: 3 }))
  tank.position.y = 7.2
  g.add(tank)
  const bandMat = toonMaterial(0x3a2a1c, { steps: 2 })
  for (const y of [6.4, 8.0]) {
    const band = new THREE.Mesh(new THREE.TorusGeometry(1.85, 0.08, 8, 20), bandMat)
    band.rotation.x = Math.PI / 2
    band.position.y = y
    g.add(band)
  }
  const roof = new THREE.Mesh(new THREE.ConeGeometry(2.0, 1.2, 14), toonMaterial(0x4a2f1a, { steps: 2 }))
  roof.position.y = 9.0
  g.add(roof)
  const finial = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 8), toonMaterial(0xc9a227, { steps: 2 }))
  finial.position.y = 9.75
  g.add(finial)
  g.scale.setScalar(1.35)
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

/** Strips the ink hull makeTree() baked in via addOutline() and rebuilds it
 * at a distance-scaled pixel weight, using addOutline's own exported `pixels`
 * option — no reach into models.js/toon.js internals. A far, ghost-saturation
 * canopy holding the same full-weight hairline as a near tree is what made
 * the pale left-side trees read as a rendering glitch rather than haze; `t`
 * (0..1, same value used for the canopy's fog blend) fades the line out in
 * step with the color so a fully fogged tree loses its outline almost
 * entirely. */
function fadeOutlineWithDistance(tree, t) {
  const shells = []
  tree.traverse((o) => {
    if (o.isMesh && o.userData.isOutline) shells.push(o)
  })
  for (const shell of shells) {
    shell.parent?.remove(shell)
    shell.geometry?.dispose?.()
  }
  tree.traverse((o) => {
    if (o.isMesh) o.userData.hasOutline = false
  })
  addOutline(tree, { pixels: Math.max(0.5, 2.2 * (1 - t * 0.75)) })
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
    // Pulled back in (was 85/200, under which the farthest visible ground —
    // ~90u — received essentially zero fog, so distant grass held the same
    // saturation/value as foreground grass: the single strongest
    // "game engine, not painting" tell). far pulled further, 140 -> 110, so
    // the near treeline rank (r~72) keeps some canopy saturation instead of
    // dissolving into the haze before it's even reached the horizon band.
    this.scene.fog = new THREE.Fog(FOG_COLOR, 30, 110)
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
    // Far and high: radius 130..190 keeps every cloud well past the treeline
    // so none can loom prop-sized over the field; y 20..30 at that distance
    // subtends roughly +2..+6deg from the default camera — inside the sky band
    // but above the painted ridge. (y=4..9 at radius 55..90 put whole clouds
    // ON the lawn; a ~14-unit puff 60 units out filled a third of the frame.)
    const spots = [
      { x: -120, y: 22, z: -95, s: 1.4, ry: 0.4 },
      { x: -55, y: 25, z: -150, s: 1.7, ry: 1.1 },
      { x: 40, y: 28, z: -165, s: 1.2, ry: 2.3 },
      { x: 130, y: 24, z: -80, s: 1.5, ry: 3.0 },
      { x: 165, y: 21, z: 30, s: 1.1, ry: 0.7 },
      { x: -150, y: 26, z: 40, s: 1.3, ry: 2.0 },
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
    // Sun at SUN_POS: side-and-slightly-behind the subject, elevation ~24deg
    // (was (26,34,30), behind the (2,14,34) tycoon camera at ~41deg elevation
    // — every shadow fell away from the eye and behind its own occluder, so
    // the frame contained zero visible cast shadows). Warmer key (was
    // 0xfff0d0, nearly white) so lit grass goes yellow-green and the whole
    // picture reads as one warm-cool separation instead of one hue.
    const sun = new THREE.DirectionalLight(0xffe4a8, 2.2)
    sun.position.copy(SUN_POS)
    sun.target.position.set(0, 0, 0)
    sun.castShadow = true
    // Widened 30 -> 42: a grazing-elevation sun throws longer shadows, and
    // SHADOW_SQUASH going 1.35 -> 2.0 stretches the painted contact-shadow
    // ellipses too — both need the real shadow-map frustum to reach back
    // further or the lengthened shapes clip at the map's edge.
    const reach = 42
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
    this.scene.add(buildFarBackdropGround())
    this._placeCloudShadowMass()
  }

  /** Cloud-shadow decal repositioned so its edge crosses the barn (11,-14)
   * and the paddock's south fence run (roughly x8-30, z~-9/-11) — a dark mass
   * needs to fall across a readable object to be legible as cast tone with a
   * cause; parked over open grass it reads as nothing (or a stain) no matter
   * how the value is tuned. A real 3D cloud sits along the sun's ray from the
   * mass so the shadow has a visible source. */
  _placeCloudShadowMass() {
    const mass = buildCloudShadowMass(55, 30)
    mass.position.set(14, 0.03, -8)
    mass.rotation.y = 0.4
    this.scene.add(mass)
    // Offset from the mass in the same direction as SUN_POS - massPos, so the
    // shadow's implied light source is the sun's actual direction, not an
    // arbitrary "somewhere up there."
    const cause = buildCloud()
    cause.scale.set(2.2, 2.2 * 0.55, 2.2)
    cause.position.set(34, 36, -14)
    this.scene.add(cause)
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

  _placeGate(x, z, rotY = 0) {
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
    g.rotation.y = -0.55 + rotY // swung open into the paddock, plus paddock rotation
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
    this._placeMownStripe()
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
    this._place(buildWaterTower(), -8, -54, 1.75, 0.8) // radius bumped for the 1.35x model scale
  }

  _placeBarn() {
    this._place(makeBarn(), 11, -14, 5.6, 0)
  }

  /** Closed loop with a gate gap on the south side and a swing-gate prop
   * bridging it, rotated ~22deg off the view ray and shifted east. The west
   * run used to sit at x=2 running along z with the camera at x=6 — almost
   * directly away from the eye, so it projected as one unbroken line from
   * the bottom edge to the barn and split the frame in two. Rotating the
   * whole assembly means no run stays parallel to any view ray, and shifting
   * east (x 12..38) clears the near-center where the chicken/player action
   * happens. */
  _placePaddock() {
    const rot = THREE.MathUtils.degToRad(22)
    const shiftX = 10
    const pivot = { x: 26, z: 5 }
    const rotate = (x, z) => {
      const dx = x + shiftX - pivot.x
      const dz = z - pivot.z
      return {
        x: pivot.x + dx * Math.cos(rot) - dz * Math.sin(rot),
        z: pivot.z + dx * Math.sin(rot) + dz * Math.cos(rot),
      }
    }
    const runs = [
      { len: 12, x: 8, z: -9, r: 0 }, // south, west of gate
      { len: 12, x: 24, z: -9, r: 0 }, // south, east of gate
      { len: 28, x: 30, z: 5, r: Math.PI / 2 }, // east
      { len: 28, x: 16, z: 19, r: 0 }, // north
      { len: 28, x: 2, z: 5, r: Math.PI / 2 }, // west
    ]
    for (const run of runs) {
      const p = rotate(run.x, run.z)
      this._placeFenceLine(run.len, p.x, p.z, run.r + rot)
    }
    const gate = rotate(16, -9)
    this._placeGate(gate.x, gate.z, rot)
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
    // then west (was continuing east through (20,24)/(27,38)/(32,54), which
    // tracked the paddock's east fence run closely enough to double as one
    // thick rail and exit the same bottom-right corner). Swinging the lower
    // points west sends the path under the camera and in front of the
    // player's patch instead, and gives the empty near-center a drawn shape.
    const pts = [
      { x: 11, z: -10.5 },
      { x: 16, z: -9 },
      { x: 19, z: -2 },
      { x: 15, z: 8 },
      { x: 14, z: 26 },
      { x: 8, z: 40 },
      { x: 4, z: 56 },
    ]
    const path = buildPathMesh(pts, 3.8)
    enableShadows(path)
    path.receiveShadow = true
    this.scene.add(path)
  }

  /** Drawn boundary across the empty left-center third — the largest dead
   * area once the field's own broad-mass bands (applyBroadFieldShading) still
   * only carry grain, not shape. A pale mown swath, lighter/less saturated
   * than the field bands, reads as tended pasture and gives that region a
   * travel-able line rather than flat unbroken green. */
  _placeMownStripe() {
    const pts = [
      { x: -48, z: -36 },
      { x: -34, z: -14 },
      { x: -18, z: 10 },
      { x: -2, z: 34 },
    ]
    const stripe = buildPathMesh(pts, 2.8, { color: 0xb9d382, steps: 2, y: 0.012 })
    stripe.receiveShadow = true
    this.scene.add(stripe)
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

  /** Deliberate near-camera silhouette arch (repoussoir) — was placed at
   * (40,30)/(44,18)/(34,42), all with a negative dot product against the
   * default camera's (6,8,20)->(-6,0,-22) forward vector, i.e. entirely
   * behind the eye and never rendered. Moved inside the near third of the
   * frustum so crowns break the top edge and trunks break the left/right
   * edges. Tint pushed darker still (was 0x2f6b28) — a wing flat should read
   * as a near-black shape, not a competing green. */
  _placeForegroundFrame() {
    // Start camera: (2,14,34) → (2,2.5,-14), h-half-FOV ≈ 28°. Side edges at
    // forward distance d sit at |x-2| ≈ 0.54·d, so wings must hug x≈-10/+15
    // at z≈12-16 to actually break the frame; the old ±24-30 never rendered.
    const spots = [{ x: -10, z: 14, s: 2.6 }, { x: 14.5, z: 12, s: 2.4 }, { x: -30, z: 16, s: 1.6 }]
    for (const spot of spots) {
      const tree = tintCanopy(makeTree(), 0x24541f)
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
   * and per-instance canopy hue — never the same silhouette/size/hue twice.
   * Recession (fog blend + outline weight) is derived per-tree from its
   * actual post-jitter radius via smoothstep(60,115,r), not from which rank
   * called this method — a per-rank constant let a near-rank tree sitting
   * beyond a far-rank tree hold full saturation while its nearer neighbour
   * washed out, which read as two unrelated backdrops instead of one
   * receding space. ringR itself is jittered per clump (+/-12) so the near
   * and far ranks overlap in actual distance instead of forming two discrete
   * shells. */
  _placeTreeClump(baseAngle, ringR, { scaleMin = 0.7, scaleMax = 1.7 } = {}) {
    const clumpR = ringR + (Math.random() * 2 - 1) * 12
    const treeCount = 4 + Math.floor(Math.random() * 4)
    for (let i = 0; i < treeCount; i++) {
      const angle = baseAngle + gaussianRandom(0.06)
      const r = clumpR + gaussianRandom(4)
      const x = Math.cos(angle) * r
      const z = Math.sin(angle) * r
      const scale = scaleMin + Math.random() * (scaleMax - scaleMin)
      if (!this._isClearSpot(x, z, 1.1 * scale)) continue
      const t = smooth01(r, 60, 115)
      const base = TREE_BASE_HUES[Math.floor(Math.random() * TREE_BASE_HUES.length)]
      const hueDeg = (Math.random() - 0.5) * 24
      let hex = jitterCanopyColor(base, hueDeg, 0)
      if (t > 0) hex = new THREE.Color(hex).lerp(new THREE.Color(FOG_COLOR), t).getHex()
      const tree = tintCanopy(makeTree(), hex)
      if (t > 0.03) fadeOutlineWithDistance(tree, t)
      tree.scale.setScalar(scale)
      this._place(tree, x, z, 1.1 * scale, Math.random() * Math.PI * 2)
    }
  }

  /** Forest border built as two depth ranks instead of one uniform ring. The
   * old ring treated all 10 candidate slots as equally likely to be seen, but
   * against the default camera (forward ~(-6,0,-22), 34deg half-FOV off-axis)
   * only 3 of 10 ever fell inside frame — the other 7 were behind/beside the
   * eye, and random gaps could delete a third of the 3 that mattered. Now 6
   * clumps are spread across the camera-facing arc only (195-345deg, i.e.
   * negative-z / away-from-camera) and NEVER gapped, each doubled into a near
   * rank (r=72, bold, small) and a far rank (r=100, larger). Recession itself
   * (fog blend, outline weight) is no longer a property of the rank — see
   * _placeTreeClump — so the two ranks' jittered radii overlap into one
   * continuous depth gradient rather than reading as two discrete shells. 4
   * sparse clumps cover the rest of the ring for when the player orbits
   * around. */
  _placeTreeline() {
    const nearR = 72
    const farR = 100
    const facingCount = 6
    for (let i = 0; i < facingCount; i++) {
      const t = facingCount === 1 ? 0 : i / (facingCount - 1)
      const angleDeg = 195 + t * (345 - 195)
      const baseAngle = THREE.MathUtils.degToRad(angleDeg) + (Math.random() - 0.5) * 0.15
      this._placeTreeClump(baseAngle, nearR, { scaleMin: 1.4, scaleMax: 2.2 })
      this._placeTreeClump(baseAngle, farR, { scaleMin: 2.0, scaleMax: 3.0 })
    }
    const sparseCount = 4
    for (let i = 0; i < sparseCount; i++) {
      const angleDeg = 345 + Math.random() * 210 // wraps through 360 to 195
      const baseAngle = THREE.MathUtils.degToRad(angleDeg % 360)
      const far = Math.random() < 0.5
      this._placeTreeClump(baseAngle, far ? farR : nearR, { scaleMin: 1.2, scaleMax: 2.4 })
    }
  }
}
