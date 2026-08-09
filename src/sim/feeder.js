import * as THREE from 'three'
import { toonMaterial, addOutline, INK_WEIGHT } from '../art/toon.js'

const CREAM = 0xfff4d6
const BARN_RED = 0xc8352b
const WOOD_DARK = 0x7d5228

/** Four splayed legs holding the hopper clear of the dirt. */
function hopperLegs() {
  const legs = new THREE.Group()
  const mat = toonMaterial(WOOD_DARK, { steps: 2 })
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.4, 6), mat)
      leg.position.set(sx * 0.2, 0.2, sz * 0.2)
      leg.rotation.set(sz * 0.14, 0, -sx * 0.14)
      legs.add(leg)
    }
  }
  return legs
}

/** Feed tray, inverted funnel, barrel and peaked lid — a classic gravity
 *  hopper. Cream body, barn-red band, the palette's two saturated notes. */
function hopperBody() {
  const body = new THREE.Group()
  body.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.2, 0.06, 12), toonMaterial(WOOD_DARK, { steps: 2 })), 0.4))
  body.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.28, 0.28, 10), toonMaterial(CREAM, { steps: 3 })), 0.54))
  body.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.3, 10), toonMaterial(BARN_RED, { steps: 3 })), 0.83))
  body.add(at(new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.16, 10), toonMaterial(BARN_RED, { steps: 2 })), 1.06))
  return body
}

function at(mesh, y) {
  mesh.position.y = y
  return mesh
}

function buildHopperMesh() {
  const g = new THREE.Group()
  g.add(hopperLegs(), hopperBody())
  return addOutline(g, { pixels: INK_WEIGHT.PROP })
}

export class Feeder {
  static COST = 100

  constructor(scene, world, position) {
    this.scene = scene
    this.world = world
    this.position = { x: position.x, z: position.z }

    this.mesh = buildHopperMesh()
    const gh = world.groundHeightAt(position.x, position.z)
    this.mesh.position.set(position.x, gh, position.z)
    scene.add(this.mesh)

    this.obstacle = world.addObstacle(position.x, position.z, 0.7)
  }

  hasFeed() {
    return true
  }

  dispose() {
    this.scene.remove(this.mesh)
    this.mesh.traverse((o) => {
      o.geometry?.dispose()
      o.material?.dispose()
    })
    const idx = this.world.obstacles.indexOf(this.obstacle)
    if (idx >= 0) this.world.obstacles.splice(idx, 1)
  }
}
