import * as THREE from 'three'
import { toonMaterial, addOutline } from './art/toon.js'
import { makeBarn, makeFence, makeHaystack, makePig, makeTree } from './art/models.js'

const SIZE = 120
const HALF = SIZE / 2
const FOG_COLOR = 0xffd9a0

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

// ---------------------------------------------------------------- ground

/** Blade-scale grass texture: hard-edged hatch marks + clumps, tiled small via repeat. */
function buildGroundTexture() {
  const px = 256
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = px
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#7ec852'
  ctx.fillRect(0, 0, px, px)
  const tones = ['#6cb544', '#8fd867', '#5a9e3a']
  const rnd = seededRand(4242)
  ctx.lineCap = 'round'
  for (let i = 0; i < 110; i++) {
    const x = rnd() * px
    const y = rnd() * px
    const a = rnd() * Math.PI
    const len = 6 + rnd() * 9
    ctx.strokeStyle = tones[i % tones.length]
    ctx.lineWidth = 2 + rnd() * 2
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.quadraticCurveTo(x + Math.cos(a) * len * 0.5, y + Math.sin(a) * len * 0.5 - 3, x + Math.cos(a) * len, y + Math.sin(a) * len)
    ctx.stroke()
  }
  for (let i = 0; i < 45; i++) {
    ctx.fillStyle = tones[(i + 1) % tones.length]
    ctx.beginPath()
    ctx.arc(rnd() * px, rnd() * px, 3 + rnd() * 3, 0, Math.PI * 2)
    ctx.fill()
  }
  const tex = new THREE.CanvasTexture(canvas)
  if ('colorSpace' in tex) tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  // Plane is 120 world units across; repeat 80x so each tile lands ~1.5
  // world units (grass scale) instead of the old single 512px stretch
  // (which put a ~10-unit blob on screen).
  tex.repeat.set(80, 80)
  tex.magFilter = THREE.NearestFilter
  tex.minFilter = THREE.NearestFilter
  tex.generateMipmaps = false
  return tex
}

/** Low-frequency brightness variation baked as vertex colors — a second,
 * non-repeating channel of interest separate from the blade texture, and the
 * only source of large-scale value change on an otherwise single-normal plane. */
function applyBroadFieldShading(geo) {
  const pos = geo.attributes.position
  const colors = new Float32Array(pos.count * 3)
  const c = new THREE.Color()
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const z = pos.getZ(i)
    const n = Math.sin(x * 0.05 + 1.7) * Math.cos(z * 0.045 - 0.6) * 0.6 + Math.sin(x * 0.017 - z * 0.021) * 0.4
    const shade = THREE.MathUtils.clamp(0.88 + n * 0.1, 0.78, 1.04)
    c.setRGB(shade, shade, shade)
    colors[i * 3] = c.r
    colors[i * 3 + 1] = c.g
    colors[i * 3 + 2] = c.b
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
}

/** Huge flat desaturated backdrop disc under the 120-unit playfield so the
 * field never terminates on a hard edge; fog finishes the job past its rim. */
function buildFarBackdropGround(size) {
  const geo = new THREE.CircleGeometry(size * 3.2, 48)
  geo.rotateX(-Math.PI / 2)
  const mat = toonMaterial(0x6f9a5a, { steps: 2 })
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
  const horizon = new THREE.Color(FOG_COLOR)
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
  const horizonY = h * 0.5
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

function contactShadowTexture() {
  if (sharedShadowTex) return sharedShadowTex
  const px = 128
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = px
  const ctx = canvas.getContext('2d')
  const g = ctx.createRadialGradient(px / 2, px / 2, 0, px / 2, px / 2, px / 2)
  g.addColorStop(0, 'rgba(40,26,14,0.42)')
  g.addColorStop(0.7, 'rgba(40,26,14,0.2)')
  g.addColorStop(1, 'rgba(40,26,14,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, px, px)
  sharedShadowTex = new THREE.CanvasTexture(canvas)
  return sharedShadowTex
}

/** One shared unit-circle geometry + material, scaled per-instance — a soft
 * painted contact shadow under every prop instead of relying solely on the
 * (necessarily coarse) shadow map for grounding. */
function buildContactShadow(radius) {
  if (!unitShadowGeo) {
    unitShadowGeo = new THREE.CircleGeometry(1, 24)
    unitShadowGeo.rotateX(-Math.PI / 2)
  }
  if (!sharedShadowMat) {
    sharedShadowMat = new THREE.MeshBasicMaterial({ map: contactShadowTexture(), transparent: true, depthWrite: false, fog: false })
  }
  const mesh = new THREE.Mesh(unitShadowGeo, sharedShadowMat)
  mesh.scale.setScalar(radius)
  mesh.renderOrder = 1
  return mesh
}

// ------------------------------------------------------------------ path

/** Ribbon strip along a Catmull-Rom curve through world-space points. */
function buildPathMesh(points, width) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p.x, 0.02, p.z)))
  const samples = curve.getSpacedPoints(48)
  const verts = []
  const uvs = []
  for (let i = 0; i < samples.length; i++) {
    const t = i / (samples.length - 1)
    const tangent = curve.getTangentAt(t)
    const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize()
    const p = samples[i]
    verts.push(p.x + (normal.x * width) / 2, p.y, p.z + (normal.z * width) / 2)
    verts.push(p.x - (normal.x * width) / 2, p.y, p.z - (normal.z * width) / 2)
    uvs.push(0, t, 1, t)
  }
  const idx = []
  for (let i = 0; i < samples.length - 1; i++) {
    const a = i * 2
    const b = i * 2 + 1
    const cIdx = i * 2 + 2
    const d = i * 2 + 3
    idx.push(a, b, cIdx, b, d, cIdx)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geo.setIndex(idx)
  geo.computeVertexNormals()
  const mesh = new THREE.Mesh(geo, toonMaterial(0xb08a55, { steps: 3 }))
  mesh.receiveShadow = true
  return addOutline(mesh, { thickness: 0.04 })
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
 * reads as agriculture instead of a bare grid of chevrons. */
function buildCropPatch(seed = 1) {
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
  const leafMat = toonMaterial(0x5fa838, { steps: 3 })
  for (let r = 0; r < rows; r++) {
    for (let cIdx = 0; cIdx < cols; cIdx++) {
      const h = 0.85 + rnd() * 0.35
      const jitter = (rnd() - 0.5) * 0.18
      const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.22, h, 6), leafMat)
      leaf.position.set(
        (cIdx * bedW * 0.85) / (cols - 1) - (bedW * 0.85) / 2 + jitter,
        h / 2 + 0.08,
        r * (bedD / rows) - bedD / 2 + bedD / (rows * 2) + jitter
      )
      group.add(leaf)
    }
  }
  return addOutline(group, { thickness: 0.025 })
}

// ---------- World ----------

export class World {
  constructor(scene) {
    this.scene = scene
    this.size = SIZE
    this.obstacles = []
    this.scene.fog = new THREE.Fog(FOG_COLOR, 90, 260)
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
    // Sun raised toward-overhead so shadows sit tight/short instead of
    // raking long diagonals across open grass.
    const sun = new THREE.DirectionalLight(0xfff0d0, 2.2)
    sun.position.set(18, 70, 26)
    sun.target.position.set(0, 0, 0)
    sun.castShadow = true
    const reach = 46 // tightened to the played area — was HALF+15 (75)
    Object.assign(sun.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach, near: 1, far: 150 })
    sun.shadow.mapSize.set(2048, 2048)
    sun.shadow.bias = -0.0015
    sun.shadow.radius = 1.5 // small PCF blur radius for a crisper, inkier edge
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
    shadow.position.set(x, 0.015, z)
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
    this._placeScatter()
    this._placePath()
    this._placeTrees()
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
    const spots = [
      { x: 18, z: -11, r: 1.3 },
      { x: 21, z: -12.5, r: 1.2 },
      { x: 18, z: -13.5, r: 1.2 },
    ]
    for (const s of spots) this._place(makeHaystack(), s.x, s.z, s.r, Math.random() * Math.PI * 2)
  }

  _placePig() {
    this._place(makePig(), -3, 6, 1.3, Math.random() * Math.PI * 2)
  }

  _placeCrops() {
    const spots = [{ x: -15, z: 11, seed: 11 }, { x: -6, z: 17, seed: 22 }, { x: -18, z: 18, seed: 33 }]
    for (const s of spots) this._addToScene(buildCropPatch(s.seed), s.x, s.z, Math.random() * Math.PI * 2)
  }

  _placeScatter() {
    this._placeFlowerTufts()
    this._placeRocks()
    this._placeStumps()
    this._placeYardProps()
  }

  _placeFlowerTufts() {
    const colors = [0xe6483c, 0xf2c230, 0xc060d6]
    const clusters = [
      { x: 6, z: -4, spread: 16, count: 9 },
      { x: -12, z: 8, spread: 22, count: 7 },
      { x: 5, z: 32, spread: 34, count: 6 },
    ]
    let i = 0
    for (const cl of clusters) {
      for (let n = 0; n < cl.count; n++) {
        const spot = this._findScatterSpot(cl.x, cl.z, cl.spread)
        if (!spot) continue
        this._addToScene(buildFlowerTuft(colors[i++ % colors.length]), spot.x, spot.z, Math.random() * Math.PI * 2)
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
    const path = buildPathMesh(pts, 3.2)
    enableShadows(path)
    path.receiveShadow = true
    this.scene.add(path)
  }

  _placeTrees() {
    const grove = [{ x: -24, z: -22 }, { x: -21, z: -19 }, { x: -26, z: -17 }, { x: 4, z: -21 }]
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

  /** Forest ring along the border so the playfield is enclosed instead of
   * ending at a plane edge; skips spots already occupied by other obstacles. */
  _placeTreeline() {
    const ringR = HALF - 3
    const count = 46
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2
      const r = ringR + (Math.random() - 0.5) * 5
      const x = Math.cos(a) * r
      const z = Math.sin(a) * r
      if (!this.isWalkable(x, z)) continue
      this._place(makeTree(), x, z, 1.1, Math.random() * Math.PI * 2)
    }
  }
}
