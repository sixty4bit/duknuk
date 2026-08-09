import * as THREE from 'three'
import { toonMaterial, addOutline } from './art/toon.js'
import { makeBarn, makeFence, makeHaystack, makePig, makeTree } from './art/models.js'

const SIZE = 120
const HALF = SIZE / 2

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

function buildGroundTexture() {
  const px = 512
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = px
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#79c850'
  ctx.fillRect(0, 0, px, px)
  const blotches = ['#6ab642', '#8ed35f', '#5fa838', '#94d873', '#71bd4a', '#a9dd85']
  for (let i = 0; i < 160; i++) {
    const r = 14 + Math.random() * 44
    ctx.globalAlpha = 0.14 + Math.random() * 0.16
    ctx.fillStyle = blotches[i % blotches.length]
    ctx.beginPath()
    ctx.ellipse(Math.random() * px, Math.random() * px, r, r * (0.55 + Math.random() * 0.5), Math.random() * Math.PI, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1
  const tex = new THREE.CanvasTexture(canvas)
  if ('colorSpace' in tex) tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

function smooth01(x, a, b) {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}

function buildSkyDome() {
  const radius = 280
  const geo = new THREE.SphereGeometry(radius, 32, 20)
  const pos = geo.attributes.position
  const colors = new Float32Array(pos.count * 3)
  const zenith = new THREE.Color(0x7ec8e3)
  const horizon = new THREE.Color(0xffd9a0)
  const c = new THREE.Color()
  for (let i = 0; i < pos.count; i++) {
    const t = smooth01(pos.getY(i), -radius * 0.05, radius * 0.5)
    c.copy(horizon).lerp(zenith, t)
    colors[i * 3] = c.r
    colors[i * 3 + 1] = c.g
    colors[i * 3 + 2] = c.b
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false })
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

function buildCropPatch() {
  const group = new THREE.Group()
  const leafMat = toonMaterial(0x5fa838, { steps: 3 })
  const rows = 3
  const cols = 4
  for (let r = 0; r < rows; r++) {
    for (let cIdx = 0; cIdx < cols; cIdx++) {
      const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.5, 6), leafMat)
      leaf.position.set(cIdx * 0.9 - (cols - 1) * 0.45, 0.25, r * 0.9 - (rows - 1) * 0.45)
      group.add(leaf)
    }
  }
  addOutline(group, { color: 0x1a1208, thickness: 0.03 })
  return group
}

// ---------- World ----------

export class World {
  constructor(scene) {
    this.scene = scene
    this.size = SIZE
    this.obstacles = []
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
      { x: -34, y: 42, z: -42, s: 1.3, ry: 0.4 },
      { x: 20, y: 50, z: -50, s: 1.7, ry: 1.1 },
      { x: 42, y: 44, z: 8, s: 1.1, ry: 2.3 },
    ]
    for (const spot of spots) {
      const cloud = buildCloud()
      cloud.position.set(spot.x, spot.y, spot.z)
      cloud.scale.setScalar(spot.s)
      cloud.rotation.y = spot.ry
      this.scene.add(cloud)
    }
  }

  _buildLights() {
    const sun = new THREE.DirectionalLight(0xfff0d0, 2.2)
    sun.position.set(42, 55, 22)
    sun.target.position.set(0, 0, 0)
    sun.castShadow = true
    const reach = HALF + 15
    Object.assign(sun.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach, near: 1, far: 180 })
    sun.shadow.mapSize.set(2048, 2048)
    sun.shadow.bias = -0.0015
    this.scene.add(sun, sun.target)
    this.scene.add(new THREE.AmbientLight(0xbcd9ff, 0.55))
  }

  _buildGround() {
    const geo = new THREE.PlaneGeometry(this.size, this.size, 1, 1)
    geo.rotateX(-Math.PI / 2)
    const mat = toonMaterial(0xffffff, { steps: 3 })
    mat.map = buildGroundTexture()
    mat.needsUpdate = true
    const ground = new THREE.Mesh(geo, mat)
    ground.receiveShadow = true
    this.scene.add(ground)
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

  _placeObstacles() {
    this._placeBarn()
    this._placeFences()
    this._placeHaystacks()
    this._placeTrees()
    this._placePig()
    this._placeCrops()
  }

  _placeBarn() {
    this._place(makeBarn(), 11, -14, 5.6, 0)
  }

  _placeFences() {
    this._placeFenceLine(8, 3, -9, 0)
    this._placeFenceLine(8, 19, -9, 0)
    this._placeFenceLine(20, 28, 2, Math.PI / 2)
    this._placeFenceLine(16, 10, 22, 0)
  }

  _placeHaystacks() {
    const spots = [
      { x: 17, z: -9, r: 1.3 },
      { x: 19.5, z: -11, r: 1.2 },
      { x: 15.5, z: -6.5, r: 1.2 },
    ]
    for (const s of spots) this._place(makeHaystack(), s.x, s.z, s.r, Math.random() * Math.PI * 2)
  }

  _placeTrees() {
    const spots = [
      { x: -24, z: -22 }, { x: -21, z: -19 }, { x: -26, z: -17 },
      { x: 24, z: 20 }, { x: 27, z: 17 },
      { x: 4, z: -21 },
    ]
    for (const s of spots) this._place(makeTree(), s.x, s.z, 1.1, Math.random() * Math.PI * 2)
  }

  _placePig() {
    this._place(makePig(), 2, 6, 1.3, Math.random() * Math.PI * 2)
  }

  _placeCrops() {
    const spots = [{ x: -15, z: 11 }, { x: -6, z: 17 }, { x: -18, z: 18 }]
    for (const s of spots) {
      const crop = buildCropPatch()
      crop.position.set(s.x, this.groundHeightAt(s.x, s.z), s.z)
      enableShadows(crop)
      this.scene.add(crop)
    }
  }
}
