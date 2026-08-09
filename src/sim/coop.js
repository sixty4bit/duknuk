import * as THREE from 'three'
import { makeCoop } from '../art/models.js'
import { toonMaterial, addOutline, INK_WEIGHT } from '../art/toon.js'

const INK = 0x1a1208

// --------------------------------------------------------- range ring

// A territory reference, not a mechanic's live boundary — patch.js's ring
// (buildOutline + addOutline's `flat: true` path) draws a solid, opaque
// INK_WEIGHT.DECAL line because that ring IS the grazing edge. This one only
// has to whisper "this is roughly how far she'll walk," so it borrows the
// same flat, ground-level, ink-colored circle language but breaks it into
// dashes and drops it to near-transparency — a native LineDashedMaterial loop
// rather than a drawn decal, since toon.js's ink shader has no opacity knob
// and a 1px reference line is exactly right for a selection-only overlay.
const RING_SEGMENTS = 96
const RING_Y = 0.04
const RING_DASH = 0.9
const RING_GAP = 0.55
const RING_OPACITY = 0.35

function buildRangeRing(radius) {
  const points = []
  for (let i = 0; i <= RING_SEGMENTS; i++) {
    const a = (i / RING_SEGMENTS) * Math.PI * 2
    points.push(new THREE.Vector3(Math.cos(a) * radius, RING_Y, Math.sin(a) * radius))
  }
  const geo = new THREE.BufferGeometry().setFromPoints(points)
  const mat = new THREE.LineDashedMaterial({
    color: INK,
    transparent: true,
    opacity: RING_OPACITY,
    dashSize: RING_DASH,
    gapSize: RING_GAP,
    depthWrite: false,
  })
  const line = new THREE.Line(geo, mat)
  line.computeLineDistances()
  line.visible = false
  return line
}

// ------------------------------------------------ egg-basket collect pop

// Self-driven off the wall clock, the same pattern models.js's egg pop uses
// (see driveEgg there) — so `.collect()` can fire this and walk away without
// Coop needing an `.update(dt)` of its own.
const POP_DURATION = 0.5
/** [time, scale] keys: pop up past full size, settle, gone. */
const POP_KEYS = [[0, 0], [0.16, 1.2], [0.32, 1], [POP_DURATION, 0]]

const clockNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000

function popScale(t) {
  const last = POP_KEYS.length - 1
  if (t >= POP_KEYS[last][0]) return 0
  let i = 0
  while (t > POP_KEYS[i + 1][0]) i++
  const [t0, s0] = POP_KEYS[i]
  const [t1, s1] = POP_KEYS[i + 1]
  const k = (t - t0) / (t1 - t0)
  const eased = k * k * (3 - 2 * k)
  return s0 + (s1 - s0) * eased
}

/** Small wicker egg basket, primitives + toon + ink. */
function buildBasketPop() {
  const g = new THREE.Group()
  const basket = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.12, 0.2, 10), toonMaterial(0xb07a3e, { steps: 3 }))
  basket.position.y = 0.1
  g.add(basket)
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.025, 6, 12), toonMaterial(0x8a6338, { steps: 2 }))
  rim.rotation.x = Math.PI / 2
  rim.position.y = 0.2
  g.add(rim)
  return addOutline(g, { pixels: INK_WEIGHT.PROP })
}

function disposeObject(object) {
  object.traverse((o) => {
    o.geometry?.dispose()
    o.material?.dispose()
  })
}

function spawnCollectPop(scene, door) {
  const pop = buildBasketPop()
  pop.position.set(door.x, 0.04, door.z)
  pop.scale.setScalar(0.01)
  scene.add(pop)
  const born = clockNow()
  const driver = pop.children[0]
  driver.onBeforeRender = () => {
    const t = clockNow() - born
    pop.scale.setScalar(Math.max(0.01, popScale(t)))
    if (t < POP_DURATION) return
    scene.remove(pop)
    disposeObject(pop)
    driver.onBeforeRender = null
  }
}

// -------------------------------------------------------------- Coop

export class Coop {
  static RANGE = 20
  static MIN_SPACING = 26
  static CAPACITY = 4
  static COST = 250

  constructor(scene, world, position) {
    this.scene = scene
    this.world = world
    this.position = { x: position.x, z: position.z }
    this.chickens = []
    this.product = 0
    this.selected = false

    this.mesh = makeCoop()
    const gh = world.groundHeightAt(position.x, position.z)
    this.mesh.position.set(position.x, gh, position.z)
    scene.add(this.mesh)

    this.obstacle = world.addObstacle(position.x, position.z, 2.2)

    const doorLocal = this.mesh.userData.door?.position ?? new THREE.Vector3(0, 0, 1.98)
    const doorWorld = this.mesh.localToWorld(doorLocal.clone())
    this.door = { x: doorWorld.x, z: doorWorld.z }

    this._range = buildRangeRing(Coop.RANGE)
    this._range.position.set(this.door.x, 0, this.door.z)
    scene.add(this._range)
  }

  addProduct(v) {
    this.product += v
  }

  collect() {
    const value = this.product
    if (value <= 0) return 0
    this.product = 0
    spawnCollectPop(this.scene, this.door)
    return value
  }

  setSelected(selected) {
    this.selected = selected
    this._range.visible = selected
  }

  inRange(x, z) {
    return Math.hypot(x - this.door.x, z - this.door.z) <= Coop.RANGE
  }

  dispose() {
    this.scene.remove(this.mesh)
    disposeObject(this.mesh)
    this.scene.remove(this._range)
    disposeObject(this._range)
    const idx = this.world.obstacles.indexOf(this.obstacle)
    if (idx >= 0) this.world.obstacles.splice(idx, 1)
  }
}
