import * as THREE from 'three'
import { toonMaterial, addOutline, INK_WEIGHT } from '../art/toon.js'
import { findPath } from './pathfind.js'

// A Looney-Tunes-*esque* background character: a hired hand who walks an
// endless route between coops, scoops out whatever egg value has piled up,
// and drifts back to loiter by the barn when there's nothing left to collect.
// Built entirely from primitives (models.js exports no humanoid helpers) in
// the same toonMaterial + addOutline idiom the rest of the art uses.

const WALK_SPEED = 2.0
const ARRIVE_EPS = 0.15
const TURN_RATE = 5.5

const WALK_FREQ = 5.4
const LEG_SWING = 0.5
const ARM_SWING = 0.42
const LEAN_FORWARD = 0.1
const BOB_AMOUNT = 0.03
const SWAY_AMOUNT = 0.03

const STOOP_DURATION = 0.9
const STOOP_BEND = 0.9
const STOOP_ARM_SWEEP = 1.15

const BASKET_APPEAR = 0.25
const BASKET_HOLD = 1.4
const BASKET_FADE = 0.6
const BASKET_TOTAL = BASKET_APPEAR + BASKET_HOLD + BASKET_FADE

// Barn doors — the same walkable ground point world.js's cart-track path
// routes through as its first waypoint (_placePath). Nothing exposes the
// barn's position through World's public API, so this is pinned here as the
// natural "hangs around near the barn" spot for an idle hand.
const BARN_IDLE = { x: 11.2, z: -10.8 }
const IDLE_WANDER_RADIUS = 2.5
const IDLE_PAUSE = 3.5

const P = {
  skin: 0xead2a3,
  nose: 0xdb8f66,
  overalls: 0x3f6fb5,
  overallsShade: 0x2c4f87,
  shirt: 0xfff4d6,
  straw: 0xe8c15c,
  strawShade: 0xc7982a,
  shoe: 0x3a2a1c,
  basket: 0xb07a3e,
  basketDark: 0x8a5a2e,
}

// ---------------------------------------------------------------- primitives

function meshOf(geometry, color, steps = 3) {
  const m = new THREE.Mesh(geometry, toonMaterial(color, { steps }))
  m.castShadow = true
  m.receiveShadow = true
  return m
}
const ball = (r, color, seg = 16) => meshOf(new THREE.SphereGeometry(r, seg, Math.max(8, seg >> 1)), color)
const box = (w, h, d, color) => meshOf(new THREE.BoxGeometry(w, h, d), color)
const tube = (rTop, rBot, h, color, seg = 12) => meshOf(new THREE.CylinderGeometry(rTop, rBot, h, seg), color)
const at = (o, x, y, z) => (o.position.set(x, y, z), o)
const scl = (o, x, y = x, z = x) => (o.scale.set(x, y, z), o)

// ------------------------------------------------------------------ farmhand

const HIP_Y = 0.56
const WAIST_Y = 0.58
const STANCE = 0.15
const SHOULDER_Y = 0.58
const ARM_SPAN = 0.3

function farmhandShoe(side) {
  return at(box(0.19, 0.13, 0.36, P.shoe), 0.02 * side, -0.5, 0.08)
}

/** Leg group pivots at the hip so the scissor swing never drags the torso. */
function farmhandLeg(side) {
  const leg = at(new THREE.Group(), STANCE * side, HIP_Y, 0)
  leg.add(at(tube(0.095, 0.11, 0.46, P.overalls, 10), 0, -0.23, 0))
  leg.add(farmhandShoe(side))
  return leg
}

/** Arm group pivots at the shoulder; the basket (on the right hand) rides in
 *  the arm's own rest frame, so it swings with the arm for free. */
function farmhandArm(side) {
  const arm = at(new THREE.Group(), ARM_SPAN * side, SHOULDER_Y, 0)
  arm.add(at(tube(0.055, 0.07, 0.34, side < 0 ? P.overalls : P.shirt, 8), 0, -0.17, 0))
  arm.add(at(ball(0.075, P.skin, 10), 0, -0.36, 0))
  return arm
}

/** Straw hat: wide brim, a shaded underband, a bulging crown. */
function farmhandHat() {
  const hat = new THREE.Group()
  hat.add(at(tube(0.4, 0.42, 0.05, P.straw, 16), 0, 0.15, 0))
  hat.add(at(tube(0.22, 0.26, 0.06, P.strawShade, 16), 0, 0.19, 0))
  hat.add(at(tube(0.16, 0.2, 0.2, P.straw, 16), 0, 0.32, 0))
  return hat
}

/** Big round nose leads the face, per the brief — the silhouette's identifier,
 *  same as the comb does for the hen. */
function farmhandHead() {
  const head = new THREE.Group()
  head.add(ball(0.2, P.skin, 14))
  head.add(at(ball(0.1, P.nose, 12), 0, -0.02, 0.19))
  head.add(farmhandHat())
  return head
}

/** Pear body: a wide belly ball, a strap climbing each shoulder — the
 *  overalls read that says "farmhand" before anything else does. */
function farmhandBib() {
  const bib = new THREE.Group()
  bib.add(at(scl(ball(0.3, P.overalls, 14), 1, 1.18, 0.92), 0, 0.24, 0))
  for (const s of [-1, 1]) bib.add(at(box(0.06, 0.34, 0.05, P.overallsShade), 0.18 * s, 0.5, -0.05))
  return bib
}

/** Small woven basket, tucked in the right hand. Hidden by default — see
 *  Collector._updateBasket — and popped/faded there rather than here. */
function buildBasket() {
  const basket = new THREE.Group()
  basket.add(tube(0.09, 0.11, 0.13, P.basket, 10))
  basket.add(at(tube(0.1, 0.1, 0.02, P.basketDark, 10), 0, 0.06, 0))
  return basket
}

function farmhandTorso() {
  const torso = at(new THREE.Group(), 0, WAIST_Y, 0)
  torso.add(farmhandBib())
  torso.add(at(scl(ball(0.22, P.shirt, 14), 1, 0.9, 0.9), 0, 0.58, 0.02))
  const head = at(farmhandHead(), 0, 0.82, 0.02)
  const armL = farmhandArm(-1)
  const armR = farmhandArm(1)
  const basket = at(buildBasket(), 0, -0.34, 0.1)
  armR.add(basket)
  torso.add(head, armL, armR)
  torso.userData.parts = { head, armL, armR, basket }
  return torso
}

/** ~1.9 tall farmhand: pear body, big nose, straw hat, overalls, big shoes,
 *  inked at INK_WEIGHT.PROP — a background character, one weight step under
 *  the hen and the buildings. */
function buildFarmhand() {
  const g = new THREE.Group()
  const legL = farmhandLeg(-1)
  const legR = farmhandLeg(1)
  const torso = farmhandTorso()
  g.add(legL, legR, torso)
  g.userData.parts = { legL, legR, torso, ...torso.userData.parts }
  return addOutline(g, { pixels: INK_WEIGHT.PROP, interior: true })
}

// ------------------------------------------------------------------ helpers

function wrapAngle(a) {
  return (((a + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) - Math.PI
}

function lerpTowards(a, b, t) {
  return a + (b - a) * Math.min(1, Math.max(0, t))
}

function setOpacity(object, alpha) {
  object.traverse((child) => {
    if (!child.isMesh) return
    const materials = Array.isArray(child.material) ? child.material : [child.material]
    for (const m of materials) {
      m.transparent = true
      m.opacity = alpha
    }
  })
}

function disposeObject(object) {
  object.traverse((child) => {
    if (!child.isMesh) return
    child.geometry?.dispose()
    const materials = Array.isArray(child.material) ? child.material : [child.material]
    for (const m of materials) m?.dispose()
  })
}

// ------------------------------------------------------------------ Collector

export class Collector {
  static COST = 300
  static WAGE = 0

  constructor(scene, world, coops) {
    this.scene = scene
    this.world = world
    this.coops = coops
    this.mesh = buildFarmhand()
    this.mesh.position.set(BARN_IDLE.x, 0, BARN_IDLE.z)
    scene.add(this.mesh)

    this.onCollect = null

    this._state = 'idle'
    this._walkPurpose = null
    this._target = null
    this.path = []
    this.pathIndex = 0
    this._t = 0
    this._stoopTimer = 0
    this._collected = false
    this._basketTimer = null
    this._idlePauseTimer = IDLE_PAUSE
    setOpacity(this.mesh.userData.parts.basket, 0)
  }

  get position() {
    return this.mesh.position
  }

  get state() {
    return this._state
  }

  update(dt) {
    this._t += dt
    this._updateBasket(dt)
    switch (this._state) {
      case 'idle': this._updateIdle(dt); break
      case 'walk': this._updateWalk(dt); break
      case 'stoop': this._updateStoop(dt); break
    }
  }

  dispose() {
    this.scene.remove(this.mesh)
    disposeObject(this.mesh)
  }

  // --- targeting -------------------------------------------------------------

  _pickTarget() {
    let best = null
    for (const c of this.coops) {
      if (c.product > 0 && (!best || c.product > best.product)) best = c
    }
    return best
  }

  /** Falls back to the coop's own position if its door happens to be blocked
   *  (e.g. mid-placement); world.isWalkable is the same check pathfind.js
   *  uses internally, kept here so a bad door never even starts a route. */
  _doorTarget(coop) {
    const door = coop.door ?? coop.position
    return this.world.isWalkable(door.x, door.z) ? door : coop.position
  }

  _wanderSpot() {
    for (let i = 0; i < 6; i++) {
      const a = Math.random() * Math.PI * 2
      const r = Math.random() * IDLE_WANDER_RADIUS
      const x = BARN_IDLE.x + Math.cos(a) * r
      const z = BARN_IDLE.z + Math.sin(a) * r
      if (this.world.isWalkable(x, z)) return { x, z }
    }
    return BARN_IDLE
  }

  _pathTo(point) {
    const from = { x: this.mesh.position.x, z: this.mesh.position.z }
    this.path = findPath(this.world, from, { x: point.x, z: point.z })
    this.pathIndex = 0
  }

  // --- states ------------------------------------------------------------------

  _updateIdle(dt) {
    this._animateIdle(dt)
    const target = this._pickTarget()
    if (target) {
      this._target = target
      this._pathTo(this._doorTarget(target))
      this._walkPurpose = 'collect'
      this._state = 'walk'
      return
    }
    this._idlePauseTimer -= dt
    if (this._idlePauseTimer > 0) return
    this._pathTo(this._wanderSpot())
    this._walkPurpose = 'wander'
    this._state = 'walk'
  }

  _updateWalk(dt) {
    const arrived = this._followPath(dt, WALK_SPEED)
    this._animateWalk(dt)
    if (!arrived) return
    if (this._walkPurpose === 'collect') this._enterStoop()
    else {
      this._state = 'idle'
      this._idlePauseTimer = IDLE_PAUSE
    }
  }

  _enterStoop() {
    this._state = 'stoop'
    this._stoopTimer = 0
    this._collected = false
  }

  _updateStoop(dt) {
    this._stoopTimer += dt
    this._animateStoop(this._stoopTimer, dt)
    if (!this._collected && this._stoopTimer >= STOOP_DURATION * 0.5) this._collect()
    if (this._stoopTimer < STOOP_DURATION) return
    this._target = null
    this._state = 'idle'
  }

  _collect() {
    this._collected = true
    const value = this._target?.collect?.() ?? 0
    if (value <= 0) return
    this.onCollect?.(value)
    this._basketTimer = 0
  }

  // --- movement / facing -----------------------------------------------------

  _followPath(dt, speed) {
    if (!this.path || this.pathIndex >= this.path.length) return true
    const target = this.path[this.pathIndex]
    const p = this.mesh.position
    const dx = target.x - p.x
    const dz = target.z - p.z
    const dist = Math.hypot(dx, dz)
    if (dist < ARRIVE_EPS) {
      this.pathIndex++
      return this.pathIndex >= this.path.length
    }
    const step = Math.min(dist, speed * dt)
    p.x += (dx / dist) * step
    p.z += (dz / dist) * step
    this._faceDirection(dx, dz, dt)
    return false
  }

  _faceDirection(dx, dz, dt) {
    if (dx === 0 && dz === 0) return
    const desired = Math.atan2(dx, dz)
    const delta = wrapAngle(desired - this.mesh.rotation.y)
    const turn = Math.min(Math.abs(delta), TURN_RATE * dt) * Math.sign(delta)
    this.mesh.rotation.y += turn
  }

  // --- procedural animation ----------------------------------------------------

  _animateIdle(dt) {
    const p = this.mesh.userData.parts
    p.legL.rotation.x = lerpTowards(p.legL.rotation.x, 0, dt * 6)
    p.legR.rotation.x = lerpTowards(p.legR.rotation.x, 0, dt * 6)
    p.armL.rotation.x = lerpTowards(p.armL.rotation.x, 0, dt * 6)
    p.armR.rotation.x = lerpTowards(p.armR.rotation.x, 0, dt * 6)
    p.torso.rotation.x = lerpTowards(p.torso.rotation.x, 0, dt * 6)
    p.torso.rotation.z = Math.sin(this._t * 1.4) * SWAY_AMOUNT
  }

  /** Leg scissor + opposite-arm swing + a slight forward lean — the classic
   *  bow-legged farmhand shuffle. */
  _animateWalk(dt) {
    const p = this.mesh.userData.parts
    const phase = this._t * WALK_FREQ
    const swing = Math.sin(phase) * LEG_SWING
    const armSwing = Math.sin(phase) * ARM_SWING
    p.legL.rotation.x = swing
    p.legR.rotation.x = -swing
    p.armR.rotation.x = armSwing
    p.armL.rotation.x = -armSwing
    p.torso.rotation.x = lerpTowards(p.torso.rotation.x, LEAN_FORWARD, dt * 8)
    p.torso.rotation.z = Math.sin(phase) * SWAY_AMOUNT
    p.torso.position.y = WAIST_Y + Math.abs(Math.sin(phase)) * BOB_AMOUNT
    this.mesh.rotation.z = Math.sin(phase) * 0.03
  }

  /** Bend at the waist, arms sweep down as if scooping eggs into the basket,
   *  ease back up — one continuous stoop, no hold. */
  _animateStoop(t, dt) {
    const p = this.mesh.userData.parts
    const bend = Math.sin(Math.min(1, t / STOOP_DURATION) * Math.PI)
    p.torso.rotation.x = LEAN_FORWARD + bend * STOOP_BEND
    p.torso.position.y = WAIST_Y - bend * 0.05
    p.armL.rotation.x = -bend * STOOP_ARM_SWEEP * 0.6
    p.armR.rotation.x = -bend * STOOP_ARM_SWEEP
    p.legL.rotation.x = lerpTowards(p.legL.rotation.x, 0, dt * 8)
    p.legR.rotation.x = lerpTowards(p.legR.rotation.x, 0, dt * 8)
  }

  // --- basket pop/fade -----------------------------------------------------------

  /** A little basket appears in the collecting hand as the route continues,
   *  then fades back out — the visible receipt for a coop just emptied. */
  _updateBasket(dt) {
    if (this._basketTimer === null) return
    this._basketTimer += dt
    const t = this._basketTimer
    const alpha = basketAlpha(t)
    setOpacity(this.mesh.userData.parts.basket, alpha)
    if (t >= BASKET_TOTAL) this._basketTimer = null
  }
}

function basketAlpha(t) {
  if (t < BASKET_APPEAR) return t / BASKET_APPEAR
  if (t < BASKET_APPEAR + BASKET_HOLD) return 1
  if (t < BASKET_TOTAL) return 1 - (t - BASKET_APPEAR - BASKET_HOLD) / BASKET_FADE
  return 0
}
