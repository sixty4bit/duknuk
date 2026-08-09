import * as THREE from 'three'
import { makeChicken, makeEgg } from '../art/models.js'
import { findPath } from './pathfind.js'
import * as audio from '../audio.js'

const WALK_SPEED = 1.6
const SAD_SPEED = 0.5
const ARRIVE_EPS = 0.12
const TURN_RATE = 6 // rad/s

const PECK_INTERVAL = 0.45
const PECK_AMOUNT = 0.18
const PECK_DIP_ANGLE = 0.9

const SAD_CLUCK_INTERVAL = 6
const WANDER_INTERVAL = 3.5

const WALK_FREQ = 7
const LEG_SWING = 0.55
const BOB_AMOUNT = 0.05
const ROLL_AMOUNT = 0.06

const PAUSE_DURATION = 0.3
const SQUASH_DURATION = 0.5
const POP_DURATION = 0.2
const SETTLE_DURATION = 0.2
const EGG_SPAWN_AT = PAUSE_DURATION + SQUASH_DURATION
const LAY_DURATION = EGG_SPAWN_AT + POP_DURATION + SETTLE_DURATION

const EGG_POP_TIME = 0.25
const EGG_LIFETIME = 1.5
const EGG_FADE_TIME = 0.4

export class Chicken {
  constructor(scene, world, coop) {
    this.scene = scene
    this.world = world
    this.coop = coop
    this.mesh = makeChicken()
    this.mesh.position.set(coop.door.x, 0, coop.door.z)
    scene.add(this.mesh)

    this._captureBaseTransforms()
    this._thoughtBubble = this._createThoughtBubble()
    this._thoughtBubble.visible = false
    this.mesh.add(this._thoughtBubble)

    this.patch = null
    this._state = 'idle'
    this.belly = 0
    this.path = []
    this.pathIndex = 0
    this._t = 0
    this.eatTimer = 0
    this.layTimer = 0
    this.wanderTimer = 0
    this.sadTimer = 0
    this.eggs = []
    this._eggSpawned = false

    this.onEgg = null
  }

  get position() {
    return this.mesh.position
  }

  get state() {
    return this._state
  }

  _captureBaseTransforms() {
    const p = this.mesh.userData.parts
    this._baseBodyY = p.body.position.y
    this._baseHeadRotX = p.head.rotation.x
    this._baseTailRotZ = p.tail.rotation.z
    this._baseWingLRotZ = p.wingL.rotation.z
    this._baseWingRRotZ = p.wingR.rotation.z
    this._baseBodyScale = p.body.scale.clone()
    this._baseGroupScale = this.mesh.scale.clone()
    this._bubbleBaseY = (p.head.position.y ?? 0.7) + 1.0
  }

  assignPatch(patch) {
    this.patch = patch
    if (this._state === 'idle' || this._state === 'starving' || this._state === 'eat' || this._state === 'walkToPatch') {
      this._enterWalkToPatch()
    }
  }

  update(dt) {
    this._t += dt
    this._updateEggs(dt)
    switch (this._state) {
      case 'idle': this._animateIdle(dt); break
      case 'walkToPatch': this._updateWalkToPatch(dt); break
      case 'eat': this._updateEat(dt); break
      case 'starving': this._updateStarving(dt); break
      case 'walkHome': this._updateWalkHome(dt); break
      case 'layEgg': this._updateLayEgg(dt); break
    }
  }

  // --- state transitions -----------------------------------------------------

  _pathTo(target) {
    const from = { x: this.mesh.position.x, z: this.mesh.position.z }
    this.path = findPath(this.world, from, { x: target.x, z: target.z })
    this.pathIndex = 0
  }

  _enterWalkToPatch() {
    this._state = 'walkToPatch'
    this._thoughtBubble.visible = false
    const target = this.patch.bestSpot(this.position) ?? this.patch.center
    this._pathTo(target)
  }

  _enterStarving() {
    this._state = 'starving'
    this.wanderTimer = 0
    this.sadTimer = SAD_CLUCK_INTERVAL
    this._thoughtBubble.visible = true
  }

  _enterWalkHome() {
    this._state = 'walkHome'
    this._thoughtBubble.visible = false
    this._pathTo(this.coop.door)
  }

  // --- per-state update --------------------------------------------------------

  _updateWalkToPatch(dt) {
    const arrived = this._followPath(dt, WALK_SPEED)
    this._animateWalk()
    if (arrived) {
      this._state = 'eat'
      this.eatTimer = 0
    }
  }

  _updateEat(dt) {
    this._animateEat()
    if (!this.patch) { this._state = 'idle'; return }
    this.eatTimer -= dt
    if (this.eatTimer > 0) return
    this.eatTimer = PECK_INTERVAL
    const p = this.mesh.position
    const consumed = this.patch.eatAt(p.x, p.z, PECK_AMOUNT)
    this.belly = Math.min(1, this.belly + Math.max(0, consumed))
    if (this.belly >= 1) { this._enterWalkHome(); return }
    if (consumed <= 0) this._handleDepletedCell()
  }

  _handleDepletedCell() {
    const next = this.patch.bestSpot(this.position)
    if (next) {
      this._pathTo(next)
      this._state = 'walkToPatch'
    } else {
      this._enterStarving()
    }
  }

  _updateStarving(dt) {
    this._animateSad()
    this.sadTimer += dt
    if (this.sadTimer >= SAD_CLUCK_INTERVAL) {
      this.sadTimer = 0
      audio.cluckSad()
    }
    if (this.patch) {
      const spot = this.patch.bestSpot(this.position)
      if (spot) { this._enterWalkToPatch(); return }
    }
    this._wander(dt)
  }

  _wander(dt) {
    this.wanderTimer -= dt
    if (this.wanderTimer <= 0 && this.patch) {
      this.wanderTimer = WANDER_INTERVAL
      this._pathTo(randomPointInPatch(this.patch))
    }
    this._followPath(dt, SAD_SPEED)
  }

  _updateWalkHome(dt) {
    const arrived = this._followPath(dt, WALK_SPEED)
    this._animateWalk()
    if (arrived) {
      this._state = 'layEgg'
      this.layTimer = 0
      this._eggSpawned = false
    }
  }

  _updateLayEgg(dt) {
    this.layTimer += dt
    const t = this.layTimer
    this._animateLay(t)
    if (!this._eggSpawned && t >= EGG_SPAWN_AT) {
      this._eggSpawned = true
      this._spawnEgg()
      this.onEgg?.()
    }
    if (t >= LAY_DURATION) {
      this.mesh.scale.copy(this._baseGroupScale)
      this.belly = 0
      if (this.patch) this._enterWalkToPatch()
      else this._state = 'idle'
    }
  }

  // --- movement / facing ---------------------------------------------------

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

  // --- procedural animation --------------------------------------------------

  _animateIdle(dt) {
    const p = this.mesh.userData.parts
    p.legL.rotation.x = lerpTowards(p.legL.rotation.x, 0, dt * 6)
    p.legR.rotation.x = lerpTowards(p.legR.rotation.x, 0, dt * 6)
    p.body.position.y = this._baseBodyY + Math.sin(this._t * 2) * 0.02
    this.mesh.rotation.z = lerpTowards(this.mesh.rotation.z, 0, dt * 6)
  }

  _animateWalk() {
    const p = this.mesh.userData.parts
    const phase = this._t * WALK_FREQ
    const swing = Math.sin(phase) * LEG_SWING
    p.legL.rotation.x = swing
    p.legR.rotation.x = -swing
    p.body.position.y = this._baseBodyY + Math.abs(Math.sin(phase)) * BOB_AMOUNT
    this.mesh.rotation.z = Math.sin(phase) * ROLL_AMOUNT
  }

  _animateEat() {
    const p = this.mesh.userData.parts
    const phase = 1 - Math.max(0, this.eatTimer) / PECK_INTERVAL
    const dip = Math.sin(phase * Math.PI)
    p.head.rotation.x = this._baseHeadRotX + dip * PECK_DIP_ANGLE
    p.body.scale.y = this._baseBodyScale.y * (1 - dip * 0.12)
    p.body.scale.x = this._baseBodyScale.x * (1 + dip * 0.06)
    p.tail.rotation.z = this._baseTailRotZ + Math.sin(this._t * 12) * 0.25
  }

  _animateSad() {
    const p = this.mesh.userData.parts
    p.head.rotation.x = this._baseHeadRotX + 0.2 + Math.sin(this._t * 1.2) * 0.03
    p.legL.rotation.x = Math.sin(this._t * 1.5) * 0.15
    p.legR.rotation.x = -Math.sin(this._t * 1.5) * 0.15
    p.body.position.y = this._baseBodyY - 0.03
    this._thoughtBubble.position.set(0, this._bubbleBaseY + Math.sin(this._t * 1.5) * 0.05, 0)
  }

  _animateLay(t) {
    const p = this.mesh.userData.parts
    const popStart = PAUSE_DURATION + SQUASH_DURATION
    const settleStart = popStart + POP_DURATION
    let squashAmt = 0
    if (t >= PAUSE_DURATION && t < popStart) {
      squashAmt = (t - PAUSE_DURATION) / SQUASH_DURATION
    } else if (t >= popStart && t < settleStart) {
      squashAmt = 1 - (t - popStart) / POP_DURATION
    }
    const flapping = t >= PAUSE_DURATION && t < settleStart
    const flap = flapping ? Math.sin(t * 24) * 0.9 : 0
    p.wingL.rotation.z = this._baseWingLRotZ + flap
    p.wingR.rotation.z = this._baseWingRRotZ - flap
    const sy = 1 - squashAmt * 0.3
    const sxz = 1 + squashAmt * 0.15
    this.mesh.scale.set(this._baseGroupScale.x * sxz, this._baseGroupScale.y * sy, this._baseGroupScale.z * sxz)
  }

  // --- egg lifecycle -----------------------------------------------------------

  _spawnEgg() {
    const egg = makeEgg()
    egg.position.set(this.coop.door.x, 0, this.coop.door.z)
    egg.scale.setScalar(0.01)
    this.scene.add(egg)
    this.eggs.push({ mesh: egg, age: 0 })
  }

  _updateEggs(dt) {
    for (let i = this.eggs.length - 1; i >= 0; i--) {
      const e = this.eggs[i]
      e.age += dt
      this._animateEgg(e)
      if (e.age >= EGG_LIFETIME) {
        this.scene.remove(e.mesh)
        disposeObject(e.mesh)
        this.eggs.splice(i, 1)
      }
    }
  }

  _animateEgg(e) {
    const t = Math.min(1, e.age / EGG_POP_TIME)
    const pop = t < 1 ? 1 + 0.3 * Math.sin(t * Math.PI) : 1
    e.mesh.scale.setScalar(pop)
    const fadeStart = EGG_LIFETIME - EGG_FADE_TIME
    if (e.age > fadeStart) {
      const alpha = 1 - (e.age - fadeStart) / EGG_FADE_TIME
      setOpacity(e.mesh, Math.max(0, alpha))
    }
  }

  // --- thought bubble -----------------------------------------------------------

  _createThoughtBubble() {
    const material = new THREE.SpriteMaterial({
      map: createThoughtBubbleTexture(),
      transparent: true,
      depthTest: false,
    })
    const sprite = new THREE.Sprite(material)
    sprite.scale.set(0.7, 0.7, 1)
    sprite.renderOrder = 10
    return sprite
  }
}

// --- module-level helpers --------------------------------------------------------

function wrapAngle(a) {
  return ((a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI
}

function lerpTowards(a, b, t) {
  return a + (b - a) * Math.min(1, Math.max(0, t))
}

function randomPointInPatch(patch) {
  const angle = Math.random() * Math.PI * 2
  const r = Math.random() * patch.radius * 0.8
  return { x: patch.center.x + Math.cos(angle) * r, z: patch.center.z + Math.sin(angle) * r }
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

function circle(ctx, x, y, r) {
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
}

function createThoughtBubbleTexture() {
  const size = 128
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const ctx = c.getContext('2d')
  ctx.fillStyle = '#fff4d6'
  ctx.strokeStyle = '#1a1208'
  ctx.lineWidth = 4
  circle(ctx, 24, 104, 7)
  circle(ctx, 38, 86, 11)
  ctx.beginPath()
  ctx.ellipse(78, 46, 40, 32, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  ctx.strokeStyle = '#8a9a3a'
  ctx.lineWidth = 5
  ctx.beginPath()
  ctx.moveTo(78, 64)
  ctx.quadraticCurveTo(66, 40, 80, 20)
  ctx.stroke()
  const tex = new THREE.CanvasTexture(c)
  tex.needsUpdate = true
  return tex
}
