import * as THREE from 'three'

// Golden-age theatrical-cartoon look: flat saturated toon ramps + bold
// inverted-hull ink outlines. No textures, no assets, no dependencies.

const INK = 0x1a1208
const SHADOW_FLOOR = 0.42 // darkest ramp step (keeps shadows saturated, never muddy)

const gradientMaps = new Map()
// Keyed by source geometry so hulls die with the model they belong to (eggs are
// spawned and disposed constantly).
const hullGeometries = new WeakMap()

/** Cached N-step toon ramp as a 1-D DataTexture with NearestFilter. */
function gradientMap(steps) {
  const n = Math.max(2, Math.min(8, Math.round(steps)))
  const cached = gradientMaps.get(n)
  if (cached) return cached
  const data = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1)
    data[i] = Math.round(255 * (SHADOW_FLOOR + (1 - SHADOW_FLOOR) * t))
  }
  const tex = new THREE.DataTexture(data, n, 1, THREE.RedFormat)
  tex.minFilter = THREE.NearestFilter
  tex.magFilter = THREE.NearestFilter
  tex.generateMipmaps = false
  tex.unpackAlignment = 1
  tex.needsUpdate = true
  gradientMaps.set(n, tex)
  return tex
}

/**
 * Flat cel-shaded material.
 * @param {number|string|THREE.Color} color
 * @param {{steps?: number}} [opts] extra keys pass straight to MeshToonMaterial.
 */
export function toonMaterial(color, { steps = 4, ...rest } = {}) {
  return new THREE.MeshToonMaterial({ color, gradientMap: gradientMap(steps), ...rest })
}

const q = (v) => Math.round(v * 1e4)

/** Average normals of coincident vertices so hard-edged shapes inflate without splitting. */
function weldedNormals(geometry) {
  const pos = geometry.attributes.position
  const nrm = geometry.attributes.normal
  const welded = new Map()
  for (let i = 0; i < pos.count; i++) {
    const key = `${q(pos.getX(i))},${q(pos.getY(i))},${q(pos.getZ(i))}`
    let acc = welded.get(key)
    if (!acc) welded.set(key, (acc = [0, 0, 0]))
    acc[0] += nrm.getX(i)
    acc[1] += nrm.getY(i)
    acc[2] += nrm.getZ(i)
  }
  return { pos, welded }
}

/** Push every vertex outward along its welded normal; `scale` compensates parent scaling. */
function buildHull(geometry, thickness, scale) {
  const geo = geometry.clone()
  if (!geo.attributes.normal) geo.computeVertexNormals()
  const { pos, welded } = weldedNormals(geo)
  const n = new THREE.Vector3()
  for (let i = 0; i < pos.count; i++) {
    const acc = welded.get(`${q(pos.getX(i))},${q(pos.getY(i))},${q(pos.getZ(i))}`)
    n.set(acc[0], acc[1], acc[2])
    if (n.lengthSq() < 1e-10) continue
    n.normalize()
    pos.setXYZ(
      i,
      pos.getX(i) + (n.x * thickness) / scale.x,
      pos.getY(i) + (n.y * thickness) / scale.y,
      pos.getZ(i) + (n.z * thickness) / scale.z
    )
  }
  pos.needsUpdate = true
  geo.computeBoundingSphere()
  return geo
}

function hullFor(geometry, thickness, scale) {
  let variants = hullGeometries.get(geometry)
  if (!variants) hullGeometries.set(geometry, (variants = new Map()))
  const key = `${q(thickness)}|${q(scale.x)},${q(scale.y)},${q(scale.z)}`
  let hull = variants.get(key)
  if (!hull) variants.set(key, (hull = buildHull(geometry, thickness, scale)))
  return hull
}

function outlineFor(mesh, color, thickness) {
  const scale = mesh.getWorldScale(new THREE.Vector3())
  scale.set(Math.abs(scale.x) || 1, Math.abs(scale.y) || 1, Math.abs(scale.z) || 1)
  const shell = new THREE.Mesh(
    hullFor(mesh.geometry, thickness, scale),
    new THREE.MeshBasicMaterial({ color, side: THREE.BackSide, fog: true })
  )
  shell.name = 'outline'
  shell.userData.isOutline = true
  shell.castShadow = false
  shell.receiveShadow = false
  shell.renderOrder = -1
  return shell
}

/**
 * Bold inverted-hull outline on every Mesh descendant. Outlines are parented to
 * their source mesh, so they follow procedural animation for free. Meshes with
 * `userData.noOutline` (tiny eye pupils, nostrils) are skipped.
 * @returns {THREE.Object3D} the same object, for chaining.
 */
export function addOutline(object3d, { color = INK, thickness = 0.035 } = {}) {
  object3d.updateWorldMatrix(true, true)
  const targets = []
  object3d.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return
    if (o.userData.isOutline || o.userData.noOutline || o.userData.hasOutline) return
    o.userData.hasOutline = true
    targets.push(o)
  })
  for (const mesh of targets) mesh.add(outlineFor(mesh, color, thickness))
  return object3d
}
