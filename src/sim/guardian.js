import * as THREE from 'three'
import { makeRooster, makeGuardDog, makeShotgunGuy, makeTurret } from '../art/models.js'

// The protection chain. Each tier is a bigger painted zone for more money —
// escalating cost, coverage and absurdity per DESIGN.md. One Guardian entity
// climbs the chain in place via upgrade(); the zone stays where the player
// painted it.
export const GUARDIAN_TIERS = [
  { id: 'rooster', label: 'Rooster', cost: 150, radius: 9, make: makeRooster },
  { id: 'dog', label: 'Guard Dog', cost: 400, radius: 14, make: makeGuardDog },
  { id: 'shotgun', label: 'Shotgun Guy', cost: 1000, radius: 20, make: makeShotgunGuy },
  { id: 'turret', label: 'Turret', cost: 2500, radius: 28, make: makeTurret },
]

const WALK_SPEED = 3.4
const INK = 0x1a1208
const RING_SEGMENTS = 96
const RING_Y = 0.07
// The zone must be readable WITHOUT selecting: a protection ring the player
// can't see is coverage they can't reason about. Faint always, bold selected.
const RING_IDLE_OPACITY = 0.22
const RING_SELECTED_OPACITY = 0.8

function buildZoneRing(radius) {
  const points = []
  for (let i = 0; i <= RING_SEGMENTS; i++) {
    const a = (i / RING_SEGMENTS) * Math.PI * 2
    points.push(new THREE.Vector3(Math.cos(a) * radius, RING_Y, Math.sin(a) * radius))
  }
  const geo = new THREE.BufferGeometry().setFromPoints(points)
  const mat = new THREE.LineDashedMaterial({
    color: INK,
    transparent: true,
    opacity: RING_IDLE_OPACITY,
    dashSize: 0.9,
    gapSize: 0.55,
    depthWrite: false,
  })
  const line = new THREE.Line(geo, mat)
  line.computeLineDistances()
  return line
}

export class Guardian {
  constructor(scene, world, position) {
    this.scene = scene
    this.world = world
    this.tier = 0
    this.position = { x: position.x, z: position.z }
    this._target = null
    this._selected = false
    this._t = Math.random() * 10 // desync idle animations between guardians
    this.mesh = null
    this._ring = null
    this._buildMesh()
    this._buildRing()
  }

  get spec() {
    return GUARDIAN_TIERS[this.tier]
  }

  get radius() {
    return this.spec.radius
  }

  /** Next tier spec, or null at the top of the chain. */
  get nextSpec() {
    return GUARDIAN_TIERS[this.tier + 1] ?? null
  }

  covers(x, z) {
    return Math.hypot(x - this.position.x, z - this.position.z) <= this.radius
  }

  /** Repaint the zone somewhere else — the guardian walks to its new post. */
  moveTo({ x, z }) {
    this._target = { x, z }
  }

  upgrade() {
    if (!this.nextSpec) return false
    this.tier += 1
    this._buildMesh()
    this._buildRing()
    return true
  }

  setSelected(selected) {
    this._selected = selected
    this._ring.material.opacity = selected ? RING_SELECTED_OPACITY : RING_IDLE_OPACITY
  }

  _buildMesh() {
    const yaw = this.mesh?.rotation.y ?? Math.random() * Math.PI * 2
    if (this.mesh) this._disposeNode(this.mesh)
    this.mesh = this.spec.make()
    this.parts = this.mesh.userData.parts ?? {}
    const gh = this.world.groundHeightAt(this.position.x, this.position.z)
    this.mesh.position.set(this.position.x, gh, this.position.z)
    this.mesh.rotation.y = yaw
    this.scene.add(this.mesh)
  }

  _buildRing() {
    if (this._ring) this._disposeNode(this._ring)
    this._ring = buildZoneRing(this.radius)
    this._ring.position.set(this.position.x, 0, this.position.z)
    this._ring.material.opacity = this._selected ? RING_SELECTED_OPACITY : RING_IDLE_OPACITY
    this.scene.add(this._ring)
  }

  update(dt) {
    this._t += dt
    this._walk(dt)
    this._idle()
  }

  _walk(dt) {
    if (!this._target) return
    const dx = this._target.x - this.position.x
    const dz = this._target.z - this.position.z
    const dist = Math.hypot(dx, dz)
    if (dist < 0.1) {
      this._target = null
      return
    }
    const step = Math.min(dist, WALK_SPEED * dt)
    this.position.x += (dx / dist) * step
    this.position.z += (dz / dist) * step
    this.mesh.position.x = this.position.x
    this.mesh.position.z = this.position.z
    this.mesh.rotation.y = Math.atan2(dx, dz)
    // Walk bob — guardians cut across everything (a dog lopes over the road),
    // so no pathfinding: the zone move must always land where painted.
    this.mesh.position.y = Math.abs(Math.sin(this._t * 9)) * 0.12
    this._ring.position.x = this.position.x
    this._ring.position.z = this.position.z
  }

  /** Tiny per-tier idle so nothing on the farm stands frozen. */
  _idle() {
    if (this._target) return
    this.mesh.position.y = 0
    const { head, tail, barrels, light, gun } = this.parts
    if (head) head.rotation.y = Math.sin(this._t * 0.8) * 0.5
    if (tail) tail.rotation.z = 0.4 + Math.sin(this._t * 6) * 0.25
    if (barrels) barrels.rotation.y = Math.sin(this._t * 0.5) * 0.9
    if (light) light.material.color.setHex(Math.sin(this._t * 4) > 0 ? 0xe23c30 : 0x7a2019)
    if (gun) gun.rotation.z = -0.18 + Math.sin(this._t * 1.2) * 0.04
  }

  _disposeNode(node) {
    this.scene.remove(node)
    node.traverse?.((o) => {
      o.geometry?.dispose()
      o.material?.dispose()
    })
    node.geometry?.dispose()
    node.material?.dispose()
  }

  dispose() {
    this._disposeNode(this.mesh)
    this._disposeNode(this._ring)
  }
}
