import * as THREE from 'three'

// Golden-age theatrical-cartoon look: flat saturated toon ramps + bold ink
// outlines of CONSTANT SCREEN WIDTH. No textures, no assets, no dependencies.
//
// Ink is drawn by an inverted hull whose expansion happens in the vertex
// shader, in clip space, scaled by w. That makes the shell project to the same
// pixel width whatever the object's size or distance — the single property that
// separates hand-inked animation from cel-shaded 3D. Callers no longer pass a
// world-space thickness; there is one global constant.

const INK = 0x1a1208

/**
 * Default ink weight in CSS pixels at devicePixelRatio 1.
 *
 * 2.2px across a 1600px frame is a hairline: it reads as an edge shader, not as
 * a drawn line. 3.4 is the midfield weight a pen would lay down.
 */
const INK_PIXELS = 3.4

/**
 * Hand-inked animation does NOT use one line weight for everything — that is
 * the single loudest tell that a frame was rendered rather than drawn. The pen
 * gets heavier for the subject the shot is about, lighter for the forms behind
 * it, and thins toward nothing at the horizon. Pass these as `pixels` so the
 * hierarchy is stated in one place instead of scattered as magic numbers.
 */
export const INK_WEIGHT = {
  /** The shot's subject: the hen, the egg, the pig, the figures. */
  HERO: 4.5,
  /** Characters one step back, and the near props they actually handle. */
  PROP: INK_PIXELS,
  /**
   * No ink at all. The weight almost every object in the frame should take.
   *
   * A painted cartoon background carries NO black contour: the barn, the silo,
   * the shed, the fences and the hills are separated from the sky and from each
   * other by COLOUR, and the only lines on them are thin LIGHT trim — battens,
   * rake boards, a cream ridge cap. Ink is what marks a drawing as a character
   * cel laid over that painting, which is why inking the whole frame at HERO /
   * PROP / FAR is the single loudest "toon shader" tell there is: everything
   * gets the treatment reserved for the things that move.
   *
   * addOutline skips shell construction entirely at this weight — it is not a
   * hairline, it is nothing — so a background object costs no hull geometry, no
   * crease extraction and no extra draw call either.
   */
  BACKGROUND: 0,
  /**
   * Drawn ground shapes — a road in a cartoon is a shape, not a texture.
   *
   * Flat coplanar geometry cannot be inked by an inverted hull at all (see
   * `flat` in addOutline), so this weight used to be declared and never drawn:
   * the road, the pond and the patch all dissolved into the grass on a soft
   * colour blend. It is a real drawn boundary line now.
   */
  DECAL: 3.2,
  /**
   * Legacy treeline weight, kept so callers that still name it keep compiling.
   * Scenery takes BACKGROUND now — a horizon landmark holding a 2 px pen is
   * exactly the uniform full-frame outline this hierarchy exists to break.
   */
  FAR: 2.0,
}

/**
 * Below this many pixels there is no line, only shimmer.
 *
 * One constant for both entry points: addOutline refuses to BUILD a shell this
 * thin, setInkWeight hides one that already exists. INK_WEIGHT.BACKGROUND sits
 * under it on purpose.
 */
const INK_OFF = 0.05

/** Ink never eats more than this share of an object's radius (tiny/far props). */
const INK_MAX_FRACTION = 0.32

/**
 * Interior ink sits one step under the silhouette that carries it.
 *
 * A drawn cel has TWO pen weights on every object: the heavy contour that cuts
 * the form out of the background, and a lighter line for every break inside it
 * — where the gambrel meets the wall, where the door frame meets the door. A
 * silhouette-only render has the first and not the second, which is why it
 * reads as shaded 3D no matter how flat the colour is. 0.56 puts HERO 4.5 at
 * 2.5 and PROP 3.4 at 1.9: plainly present, plainly subordinate.
 */
const INTERIOR_RATIO = 0.56
const INTERIOR_MIN_PIXELS = 1.5
/** Zero contour means zero interior: the floor must not resurrect a line on an
 *  object whose whole point is that no pen ever touched it. */
const interiorWeight = (pixels) =>
  pixels <= INK_OFF ? 0 : Math.max(INTERIOR_MIN_PIXELS, pixels * INTERIOR_RATIO)

/**
 * Dihedral angle (degrees) above which an edge counts as a form break.
 *
 * Not 35–40. Every curved surface here is a low-poly primitive, and the facet
 * step on the ones that matter lands just under 45°: an 8-sided cylinder is
 * 45.0, a 9-sided cone a little under. At 38 a fence post's ROUND neighbours
 * get striped with tessellation lines — ink drawn on an artifact of the mesh,
 * which is worse than no ink. 46 keeps every real break (box corners, cap rims,
 * extrude faces and lathe profile corners are all ≥ 60°) and no fake ones.
 * Override per call with `interiorAngle` if a model wants the tighter read.
 */
const INTERIOR_ANGLE = 46

/** Runaway guard: a mesh this creased is a tessellation, not a set of forms. */
const INTERIOR_MAX_EDGES = 4000

/**
 * Darkest ramp step — the multiplier the dark cel plane keeps.
 *
 * At 0.55 the dark plane was only 45% down from the lit one, and world.js's
 * ambient lifted both, so on screen the two planes differed by roughly 15%:
 * grass, shaded barn wall and cast shadow all sat on one mid tone and the frame
 * had no value structure at all. Golden-age flats separate lit and shadow
 * closer to 2:1. Against the 0.45 ambient this lands near 1.75:1 — a real break
 * that still reads as a colour rather than a hole, because SHADOW_WARM carries
 * the dark end toward ochre instead of grey.
 */
const SHADOW_FLOOR = 0.4
/**
 * Characters run the 3-step ramp and are the smallest read in the frame. Their
 * local colours are already mid-value (cream hen, pink pig), so their dark
 * plane sits a hair above the architecture's or the animal goes to mud at
 * viewing size. Still far below the old flat 0.55.
 */
const CHARACTER_STEPS = 3
const CHARACTER_SHADOW_FLOOR = 0.44
/**
 * Background architecture and scenery: a plane break that is a TINT, not a step.
 *
 * A 2:1 lit/shadow break is the right break for a character and the wrong one
 * for everything behind it. On a low-poly sphere or cylinder that break lands as
 * a curved terminator, and a curved terminator is a rendered ball — no amount of
 * flat colour above and below it makes a painted shape out of it. In a painted
 * cartoon background the barn wall is ONE red edge to edge, the silo is ONE
 * blue-teal with a couple of thin darker lines on it, the hill is ONE green:
 * there is no lit plane and shadow plane on background objects at all.
 *
 * 0.84 keeps just enough separation to tell a gable end from a long wall when
 * they meet at a corner, and not enough to sculpt either of them. Anything that
 * wants the real break asks for CHARACTER_STEPS (or the 4-step default).
 */
const BACKGROUND_STEPS = 2
const BACKGROUND_SHADOW_FLOOR = 0.84
/** Hue shift at the dark end: shadows go warm instead of just going down. */
const SHADOW_WARM = [1.16, 0.97, 0.79]

/** Ramps are cached by step count, so the floor can key off it directly. */
function shadowFloorFor(steps) {
  if (steps === BACKGROUND_STEPS) return BACKGROUND_SHADOW_FLOOR
  if (steps === CHARACTER_STEPS) return CHARACTER_SHADOW_FLOOR
  return SHADOW_FLOOR
}

/**
 * Where the lit family of steps begins, as a ramp position.
 *
 * A ramp with EVENLY spaced steps has no single break in it. At four steps the
 * two middle bands sit halfway between the lit plane and the shadow plane, and
 * a cast shadow crossing one of them lands on a third value that belongs to
 * neither — which is precisely how one frame comes to show two different
 * shadow languages: a decisive posterized edge where the shadow crosses a
 * 2-step receiver, and a soft-looking multi-band gradient where it crosses a
 * 4-step one.
 *
 * So the dark plane is held ALONE at 0 and every remaining step is packed into
 * the lit half above this line. Whatever step count a caller asks for, the ramp
 * has exactly ONE decisive break, in the same place, on every receiver in the
 * frame; the extra steps become subtle modelling inside the light, which is
 * what a painted cel does with them.
 */
const LIT_FLOOR = 0.55

/** Ramp position of step `i` of `n` — 0 is the shadow plane, 1 the lit one. */
function rampPosition(i, n) {
  if (i === 0) return 0
  if (n <= 2) return 1
  return LIT_FLOOR + (1 - LIT_FLOOR) * ((i - 1) / (n - 2))
}

const gradientMaps = new Map()
// Keyed by source geometry so hulls die with the model they belong to (eggs are
// spawned and disposed constantly).
const hullGeometries = new WeakMap()
const creaseGeometries = new WeakMap()
const boundaryGeometries = new WeakMap()
const inkStyles = new Map()

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)
const q = (v) => Math.round(v * 1e4)

// ------------------------------------------------------------------ toon ramp

/** RGB multiplier for ramp position `t` (0 = shadow plane, 1 = lit plane). */
function rampStep(t, floor) {
  const value = floor + (1 - floor) * t
  const warmth = 1 - t
  return SHADOW_WARM.map((w) => clamp01(value * (1 + (w - 1) * warmth)))
}

/** Cached N-step toon ramp as a 1-D RGBA DataTexture with NearestFilter. */
function gradientMap(steps) {
  const n = Math.max(2, Math.min(8, Math.round(steps)))
  const cached = gradientMaps.get(n)
  if (cached) return cached
  const data = new Uint8Array(n * 4)
  const floor = shadowFloorFor(n)
  for (let i = 0; i < n; i++) {
    const [r, g, b] = rampStep(rampPosition(i, n), floor)
    data.set([Math.round(255 * r), Math.round(255 * g), Math.round(255 * b), 255], i * 4)
  }
  const tex = new THREE.DataTexture(data, n, 1, THREE.RGBAFormat)
  tex.minFilter = THREE.NearestFilter
  tex.magFilter = THREE.NearestFilter
  tex.generateMipmaps = false
  tex.unpackAlignment = 1
  tex.needsUpdate = true
  gradientMaps.set(n, tex)
  return tex
}

// three samples only the red channel of a gradient map, which can never shift
// hue. Widen it to RGB so the shadow plane can be a warm colour break.
const GREY_RAMP = 'return vec3( texture2D( gradientMap, coord ).r );'
const RGB_RAMP = 'return texture2D( gradientMap, coord ).rgb;'

function useColouredRamp(shader) {
  if (shader.fragmentShader.includes(GREY_RAMP)) {
    shader.fragmentShader = shader.fragmentShader.replace(GREY_RAMP, RGB_RAMP)
  }
}

/**
 * Cast shadows get the same treatment as the light ramp: ONE hard step.
 *
 * The toon ramp only quantises the diffuse term. The shadow map is multiplied
 * in afterwards as a raw float, and three's PCF filter averages 9 depth taps —
 * so every cast shadow in the frame arrives as a soft dithered gradient laid
 * over flat cel colour. That gradient is the single loudest "generic low-poly
 * mobile game" tell there is: a golden-age flat has a shadow with a decisive
 * edge you could cut out with scissors.
 *
 * `step(0.5, shadow)` says: more than half the taps occluded, it's shadow;
 * otherwise it's light. Nothing interpolates across the boundary, so no
 * dithered ramp survives to the framebuffer no matter what shadow-map size or
 * filter type the renderer is configured with.
 *
 * Both getShadow and getPointShadow end on this line; both are replaced.
 * (Verified against three 0.180's shadowmap_pars_fragment: the string occurs
 * exactly twice, at the tail of each function. If a three upgrade ever renames
 * it, every cast shadow in the frame silently goes back to a PCF gradient —
 * which is the one failure this file cannot detect at runtime, so the split/join
 * below is deliberately a no-op rather than a throw, and the string is the
 * thing to re-check first when shadows start looking photographic.)
 */
const SOFT_SHADOW = 'return mix( 1.0, shadow, shadowIntensity );'
const HARD_SHADOW = 'return mix( 1.0, step( 0.5, shadow ), shadowIntensity );'

function useHardShadows(shader) {
  if (!shader.fragmentShader.includes(SOFT_SHADOW)) return
  shader.fragmentShader = shader.fragmentShader.split(SOFT_SHADOW).join(HARD_SHADOW)
}

/** Every toon material shares this hook, so the whole frame is posterized the
 *  same way: coloured ramp for the light, one hard step for the shadow. */
function patchToonShader(shader) {
  useColouredRamp(shader)
  useHardShadows(shader)
}

const rampCacheKey = () => 'duknuk-rgb-ramp'

/**
 * Flat cel-shaded material.
 * @param {number|string|THREE.Color} color
 * @param {{steps?: number}} [opts] extra keys pass straight to MeshToonMaterial.
 *   The step count IS the profile — three of them, and they are not
 *   interchangeable:
 *   - `steps: 2` — background architecture and scenery. Near-flat: the plane
 *     break is a 0.84 tint, so a wall is one painted shape rather than a lit
 *     plane and a shadow plane. Everything the camera is not about.
 *   - `steps: 3` — characters. The full 2:1 break, where it belongs.
 *   - `steps: 4` (default) — the strong break with extra modelling inside the
 *     light; for anything that wants sculpting stated explicitly.
 */
export function toonMaterial(color, { steps = 4, ...rest } = {}) {
  const mat = new THREE.MeshToonMaterial({ color, gradientMap: gradientMap(steps), ...rest })
  mat.onBeforeCompile = patchToonShader
  mat.customProgramCacheKey = rampCacheKey
  return mat
}

// ----------------------------------------------------------------- ink shader

// Shared by every ink material, so one write updates the whole frame.
const inkResolution = { value: new THREE.Vector2(1280, 720) }

function syncInkResolution() {
  if (typeof window === 'undefined') return
  inkResolution.value.set(
    Math.max(1, window.innerWidth || 1280),
    Math.max(1, window.innerHeight || 720)
  )
}
syncInkResolution()
if (typeof window !== 'undefined') window.addEventListener('resize', syncInkResolution)

const INK_VERT = /* glsl */ `
uniform vec2 uResolution;
uniform float uPixels;
attribute vec4 aInk;
#include <fog_pars_vertex>

void main() {
  vec4 mv = modelViewMatrix * vec4( position, 1.0 );
  vec4 clip = projectionMatrix * mv;
  vec3 n = aInk.xyz;

  if ( dot( n, n ) > 1e-8 ) {
    // vec4(dir, 0) drops the projection's translation column: pure direction.
    vec3 nClip = ( projectionMatrix * vec4( normalize( normalMatrix * n ), 0.0 ) ).xyz;
    vec2 nPix = vec2( nClip.x * uResolution.x, nClip.y * uResolution.y );
    float lenPix = length( nPix );
    if ( lenPix > 1e-6 ) {
      float px = uPixels;
      if ( aInk.w > 0.0 ) {
        // World units covered by one pixel at this depth (perspective or ortho).
        float perPixel = ( 2.0 * clip.w ) / ( uResolution.y * projectionMatrix[1][1] );
        float scale = length( ( modelViewMatrix * vec4( n, 0.0 ) ).xyz );
        px = min( px, ( aInk.w * scale ) / max( perPixel, 1e-6 ) );
      }
      clip.xy += ( nPix / lenPix ) * ( 2.0 * px / uResolution ) * clip.w;
    }
  }

  gl_Position = clip;
  #ifdef USE_FOG
    vFogDepth = - mv.z;
  #endif
}
`

const INK_FRAG = /* glsl */ `
uniform vec3 uColor;
#include <fog_pars_fragment>

void main() {
  gl_FragColor = vec4( uColor, 1.0 );
  #include <fog_fragment>
  #include <colorspace_fragment>
}
`

// Interior lines are real crease edges expanded into camera-facing quads. The
// same clip-space, w-scaled trick as the hull, so an interior line is the same
// number of pixels wide at 5 m and at 50 m — a pen weight, not a wireframe.
// (LineSegments cannot do this: `linewidth` is 1px on every desktop driver.)
const INTERIOR_VERT = /* glsl */ `
uniform vec2 uResolution;
uniform float uPixels;
attribute vec3 aOther;
attribute float aSide;
#include <fog_pars_vertex>

void main() {
  vec4 mv = modelViewMatrix * vec4( position, 1.0 );
  vec4 clip = projectionMatrix * mv;
  vec4 far = projectionMatrix * modelViewMatrix * vec4( aOther, 1.0 );
  // Behind the eye w flips sign and the screen-space direction inverts; the
  // clamp keeps a segment straddling the near plane from whipping across frame.
  vec2 here = ( clip.xy / max( clip.w, 1e-4 ) ) * uResolution;
  vec2 there = ( far.xy / max( far.w, 1e-4 ) ) * uResolution;
  vec2 along = here - there;
  float len = length( along );
  if ( len > 1e-5 ) {
    vec2 across = vec2( -along.y, along.x ) / len;
    // aSide * uPixels / res * w == half of uPixels pixels, either side.
    clip.xy += across * ( aSide * uPixels ) * ( clip.w / uResolution );
  }
  gl_Position = clip;
  #ifdef USE_FOG
    vFogDepth = - mv.z;
  #endif
}
`

/** Colour + weight uniform objects, shared by reference across every shell. */
function inkStyle(color, pixels) {
  const key = `${new THREE.Color(color).getHexString()}|${q(pixels)}`
  let style = inkStyles.get(key)
  if (!style) {
    style = { uColor: { value: new THREE.Color(color) }, uPixels: { value: pixels } }
    inkStyles.set(key, style)
  }
  return style
}

/**
 * Each shell owns its material — callers dispose models by traversing and
 * disposing every material they find, and a shared one would take the whole
 * frame's ink with it. Only the uniform objects are shared, so a single write
 * to `inkResolution` still re-weights the entire scene.
 */
function inkMaterial(color, pixels) {
  const style = inkStyle(color, pixels)
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog])
  uniforms.uResolution = inkResolution
  uniforms.uPixels = style.uPixels
  uniforms.uColor = style.uColor
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: INK_VERT,
    fragmentShader: INK_FRAG,
    side: THREE.BackSide,
    fog: true,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  })
}

/**
 * Interior-line material. Coplanar with the surface it is drawn on, so it
 * needs the depth bias pulled TOWARD the camera (negative offset) — the hull's
 * positive offset pushes away, which is the opposite problem. Depth test stays
 * on so a line is still hidden by whatever stands in front of it; depth write
 * stays off so two lines crossing don't fight.
 */
function interiorMaterial(color, pixels) {
  const style = inkStyle(color, pixels)
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog])
  uniforms.uResolution = inkResolution
  uniforms.uPixels = style.uPixels
  uniforms.uColor = style.uColor
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: INTERIOR_VERT,
    fragmentShader: INK_FRAG,
    side: THREE.DoubleSide,
    fog: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  })
}

/**
 * Ground-shape ink. Same constant-pixel line as the interior pass, but it has
 * to beat the decal it rims AND the terrain under that, both of which already
 * carry their own negative offset — hence the deeper bias — and it is the
 * outermost thing on the ground, so it draws last.
 */
function decalMaterial(color, pixels) {
  const mat = interiorMaterial(color, pixels)
  mat.polygonOffsetFactor = -12
  mat.polygonOffsetUnits = -12
  return mat
}

// ------------------------------------------------------------- interior lines

/** [which endpoint, which side] for the two triangles of one line quad. */
const QUAD = [[0, -1], [1, -1], [1, 1], [0, -1], [1, 1], [0, 1]]

/**
 * Line segments as a quad strip: each vertex carries the segment's OTHER
 * endpoint plus a side sign, which is everything the vertex shader needs to
 * lay a constant-pixel-width line down the edge.
 * @param {Array<[THREE.Vector3, THREE.Vector3]>} segments
 * @returns {THREE.BufferGeometry|null} null when there is nothing to draw.
 */
function quadStrip(segments) {
  const count = segments.length
  if (!count || count > INTERIOR_MAX_EDGES) return null
  const position = new Float32Array(count * 18)
  const other = new Float32Array(count * 18)
  const side = new Float32Array(count * 6)
  segments.forEach((ends, e) => {
    QUAD.forEach(([end, s], k) => {
      const i = (e * 6 + k) * 3
      ends[end].toArray(position, i)
      ends[1 - end].toArray(other, i)
      side[e * 6 + k] = s
    })
  })
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(position, 3))
  geo.setAttribute('aOther', new THREE.BufferAttribute(other, 3))
  geo.setAttribute('aSide', new THREE.BufferAttribute(side, 1))
  geo.computeBoundingSphere()
  // The quads widen in screen space after culling is decided; a little slack
  // stops a line popping off at the edge of frame.
  if (geo.boundingSphere) geo.boundingSphere.radius *= 1.08
  return geo
}

/**
 * Crease edges of `source` as a line quad strip.
 * @returns {THREE.BufferGeometry|null} null when the mesh has no form breaks.
 */
function buildCreases(source, thresholdAngle) {
  const edges = new THREE.EdgesGeometry(source, thresholdAngle)
  const line = edges.attributes.position
  const segments = []
  for (let e = 0; e < line.count >> 1; e++) {
    segments.push([
      new THREE.Vector3().fromBufferAttribute(line, e * 2),
      new THREE.Vector3().fromBufferAttribute(line, e * 2 + 1),
    ])
  }
  edges.dispose()
  return quadStrip(segments)
}

function creasesFor(geometry, thresholdAngle) {
  let variants = creaseGeometries.get(geometry)
  if (!variants) creaseGeometries.set(geometry, (variants = new Map()))
  const key = q(thresholdAngle)
  if (!variants.has(key)) variants.set(key, buildCreases(geometry, thresholdAngle))
  return variants.get(key)
}

function interiorFor(mesh, color, pixels, thresholdAngle) {
  const geo = creasesFor(mesh.geometry, thresholdAngle)
  if (!geo) return null
  const lines = new THREE.Mesh(geo, interiorMaterial(color, pixels))
  lines.name = 'interior-ink'
  lines.userData.isOutline = true
  lines.userData.isInteriorInk = true
  lines.userData.inkColor = color
  lines.castShadow = false
  lines.receiveShadow = false
  // After the surface it sits on, so the equal-depth bias resolves one way.
  lines.renderOrder = 1
  return lines
}

// ------------------------------------------------------------------ ink hulls

const vkey = (pos, i) => `${q(pos.getX(i))},${q(pos.getY(i))},${q(pos.getZ(i))}`

/** Accumulate a direction onto a welded vertex key. */
function accumulate(map, key, x, y, z) {
  let acc = map.get(key)
  if (!acc) map.set(key, (acc = [0, 0, 0]))
  acc[0] += x
  acc[1] += y
  acc[2] += z
}

/** Average normals of coincident vertices so hard edges inflate without splitting. */
function weldedNormals(geometry) {
  const pos = geometry.attributes.position
  const nrm = geometry.attributes.normal
  const welded = new Map()
  for (let i = 0; i < pos.count; i++) {
    accumulate(welded, vkey(pos, i), nrm.getX(i), nrm.getY(i), nrm.getZ(i))
  }
  return welded
}

/** Triangles as [i, j, k] index triples, indexed or not. */
function triangles(geometry) {
  const index = geometry.index
  const count = index ? index.count : geometry.attributes.position.count
  const tris = []
  for (let i = 0; i < count; i += 3) {
    if (index) tris.push([index.getX(i), index.getX(i + 1), index.getX(i + 2)])
    else tris.push([i, i + 1, i + 2])
  }
  return tris
}

const EDGES = [[0, 1, 2], [1, 2, 0], [2, 0, 1]]

/** Undirected edge table keyed on welded endpoints; also sums the plane normal. */
function collectEdges(pos, tris, normalOut) {
  const [a, b, c, ac] = [0, 0, 0, 0].map(() => new THREE.Vector3())
  const edges = new Map()
  for (const t of tris) {
    a.fromBufferAttribute(pos, t[0])
    b.fromBufferAttribute(pos, t[1])
    c.fromBufferAttribute(pos, t[2])
    normalOut.add(b.sub(a).cross(ac.subVectors(c, a)))
    for (const [i, j, k] of EDGES) {
      const [ka, kb] = [vkey(pos, t[i]), vkey(pos, t[j])]
      const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`
      const seen = edges.get(key)
      if (seen) seen.count++
      else edges.set(key, { count: 1, a: t[i], b: t[j], c: t[k] })
    }
  }
  return edges
}

/**
 * The open edges of a mesh — every edge with exactly one triangle on it — as a
 * line quad strip.
 *
 * This is what inks a ground shape. The inverted hull cannot do it: a decal's
 * vertex normals all point at the sky, so the shell inflates straight upward
 * and the ring it should have drawn never appears, which is why the road, the
 * pond and the patch all blended softly into the grass while INK_WEIGHT.DECAL
 * sat declared and unused. A drawn line down the boundary is the thing a pen
 * would actually do, and it keeps its width in PIXELS like every other line in
 * the frame rather than in ground units.
 * @returns {THREE.BufferGeometry|null} null when the mesh is closed.
 */
function buildBoundary(geometry) {
  const pos = geometry.attributes.position
  const edges = collectEdges(pos, triangles(geometry), new THREE.Vector3())
  const segments = []
  for (const e of edges.values()) {
    if (e.count !== 1) continue
    segments.push([
      new THREE.Vector3().fromBufferAttribute(pos, e.a),
      new THREE.Vector3().fromBufferAttribute(pos, e.b),
    ])
  }
  return quadStrip(segments)
}

function boundaryFor(geometry) {
  if (!boundaryGeometries.has(geometry)) boundaryGeometries.set(geometry, buildBoundary(geometry))
  return boundaryGeometries.get(geometry)
}

/** The drawn edge of a flat ground shape, as a line ON the boundary itself. */
function boundaryInkFor(mesh, color, pixels) {
  const geo = boundaryFor(mesh.geometry)
  if (!geo) return null
  const ring = new THREE.Mesh(geo, decalMaterial(color, pixels))
  ring.name = 'decal-ink'
  ring.userData.isOutline = true
  ring.userData.inkColor = color
  ring.castShadow = false
  ring.receiveShadow = false
  ring.renderOrder = 2
  return ring
}

/** Clone of `geometry` carrying vec4 aInk = (expansion direction, local cap). */
function buildHull(geometry, maxLocalWidth) {
  const geo = geometry.clone()
  if (!geo.attributes.normal) geo.computeVertexNormals()
  const pos = geo.attributes.position
  const dirs = weldedNormals(geo)
  const ink = new Float32Array(pos.count * 4)
  const n = new THREE.Vector3()
  for (let i = 0; i < pos.count; i++) {
    const acc = dirs.get(vkey(pos, i)) || [0, 0, 0]
    n.set(acc[0], acc[1], acc[2])
    if (n.lengthSq() > 1e-10) n.normalize()
    else n.set(0, 0, 0)
    ink.set([n.x, n.y, n.z, maxLocalWidth], i * 4)
  }
  geo.deleteAttribute('normal')
  geo.deleteAttribute('uv')
  geo.setAttribute('aInk', new THREE.BufferAttribute(ink, 4))
  geo.computeBoundingSphere()
  return geo
}

function hullFor(geometry, maxLocalWidth) {
  let variants = hullGeometries.get(geometry)
  if (!variants) hullGeometries.set(geometry, (variants = new Map()))
  const key = q(maxLocalWidth)
  let hull = variants.get(key)
  if (!hull) variants.set(key, (hull = buildHull(geometry, maxLocalWidth)))
  return hull
}

/** Widest world-space extent the ink may reach on this object. */
function inkWidthCap(object3d) {
  const sphere = new THREE.Box3().setFromObject(object3d).getBoundingSphere(new THREE.Sphere())
  return Number.isFinite(sphere.radius) ? sphere.radius * INK_MAX_FRACTION : 0
}

function outlineFor(mesh, color, pixels, maxWorldWidth) {
  const scale = mesh.getWorldScale(new THREE.Vector3())
  const s = Math.max(Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z)) || 1
  const hull = hullFor(mesh.geometry, maxWorldWidth / s)
  const shell = new THREE.Mesh(hull, inkMaterial(color, pixels))
  shell.name = 'outline'
  shell.userData.isOutline = true
  // Kept so setInkWeight() can re-key the shared uniform without a re-walk.
  shell.userData.inkColor = color
  shell.castShadow = false
  shell.receiveShadow = false
  // Draws before its source mesh, so a coincident decal wins the equal-depth
  // test over the shell's interior and only the boundary ring survives.
  shell.renderOrder = -1
  return shell
}

/**
 * Bold ink outline on every Mesh descendant, at a constant on-screen width.
 * Outlines are parented to their source mesh, so they follow procedural
 * animation for free. Meshes with `userData.noOutline` (pupils, nostrils) skip.
 * @param {THREE.Object3D} object3d
 * @param {{color?: number, thickness?: number, pixels?: number, flat?: boolean,
 *   interior?: boolean, interiorPixels?: number, interiorAngle?: number}} [opts]
 *   `thickness` is legacy world-space weight and is ignored — ink weight is a
 *   global constant now. `pixels` places the object in the weight hierarchy;
 *   use `INK_WEIGHT`. At `INK_WEIGHT.BACKGROUND` (0, or anything under
 *   INK_OFF) NO shell and NO interior line is built at all and the call is a
 *   no-op: a background object is a painted shape, and a sub-pixel contour on
 *   it is worse than none — it reads as an edge shader over the whole frame.
 *   `flat: true` inks a ground decal (road ribbon, pond, spill,
 *   patch disc) by DRAWING ITS BOUNDARY — see buildBoundary. Use it on any mesh
 *   that lies in the ground plane; the hull draws nothing on those.
 *
 *   `interior: true` adds the SECOND pen: every form break inside the
 *   silhouette (roof-to-wall, tank-to-leg, door frame to door) gets a crease
 *   line at `interiorPixels`, one weight step under the contour. Opt in for
 *   anything the camera gets near; leave it off for treeline and horizon props,
 *   where an extra line per facet is cost with nothing to show for it. Meshes
 *   can veto individually with `userData.noInteriorInk`.
 * @returns {THREE.Object3D} the same object, for chaining.
 */
export function addOutline(
  object3d,
  {
    color = INK,
    thickness = 0.035,
    pixels = INK_PIXELS,
    flat = false,
    interior = false,
    interiorPixels = interiorWeight(pixels),
    interiorAngle = INTERIOR_ANGLE,
  } = {}
) {
  void thickness // signature kept; world-space weight is what we are fixing.
  // A flat decal has one plane and no interior: every crease it owns is already
  // its boundary, which the ring draws.
  const drawContour = pixels > INK_OFF
  const drawInterior = interior && !flat && interiorPixels > INK_OFF
  // BACKGROUND weight: nothing to draw, nothing to walk, nothing to build.
  if (!drawContour && !drawInterior) return object3d
  object3d.updateWorldMatrix(true, true)
  const targets = []
  object3d.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return
    if (o.userData.isOutline || o.userData.noOutline || o.userData.hasOutline) return
    o.userData.hasOutline = true
    targets.push(o)
  })
  const maxWorldWidth = drawContour ? inkWidthCap(object3d) : 0
  for (const mesh of targets) {
    if (drawContour) {
      const shell = flat
        ? boundaryInkFor(mesh, color, pixels)
        : outlineFor(mesh, color, pixels, maxWorldWidth)
      if (shell) mesh.add(shell)
    }
    if (!drawInterior || mesh.userData.noInteriorInk) continue
    const lines = interiorFor(mesh, color, interiorPixels, interiorAngle)
    if (lines) mesh.add(lines)
  }
  return object3d
}

/**
 * Re-weight an already-inked object's line, in place.
 *
 * The lever for atmospheric perspective on the things that DO carry a pen:
 * thin a figure's ink with distance so it recedes instead of holding the same
 * weight as the hen. `pixels <= INK_OFF` hides the shells outright rather
 * than drawing a sub-pixel shimmer. Cheap — it only swaps a shared uniform
 * object reference, so call it at placement time, not per frame.
 * @param {THREE.Object3D} object3d an object already passed through addOutline.
 * @param {number} pixels new on-screen weight.
 * @returns {THREE.Object3D} the same object, for chaining.
 */
export function setInkWeight(object3d, pixels) {
  object3d.traverse((o) => {
    if (!o.userData?.isOutline || !o.material?.uniforms) return
    if (pixels <= INK_OFF) {
      o.visible = false
      return
    }
    o.visible = true
    // Interior lines keep their step under the contour as the object recedes,
    // so thinning a treeline never inverts the hierarchy on the way to zero.
    const weight = o.userData.isInteriorInk ? interiorWeight(pixels) : pixels
    o.material.uniforms.uPixels = inkStyle(o.userData.inkColor ?? INK, weight).uPixels
  })
  return object3d
}
