// Grid A* pathfinding over World.isWalkable, with agent-radius obstacle
// inflation and a straight-line-of-sight smoothing pass. Never throws:
// on any failure it falls back to the destination point.

const AGENT_RADIUS_INFLATION = 0.4
const LOS_STEP = 0.4
const MAX_SNAP_RING = 40

export function findPath(world, from, to) {
  try {
    return computePath(world, from, to)
  } catch {
    return [{ x: to.x, z: to.z }]
  }
}

function computePath(world, from, to) {
  const size = Math.max(2, world.size ?? 120)
  const half = size / 2
  const dim = Math.max(2, Math.round(size))
  const blocked = (gx, gz) => cellBlocked(world, half, dim, gx, gz)

  const startSnap = snapToGrid(half, dim, from)
  const goalSnap = snapToGrid(half, dim, to)
  const start = nearestWalkable(blocked, dim, startSnap.gx, startSnap.gz)
  const goal = nearestWalkable(blocked, dim, goalSnap.gx, goalSnap.gz)
  if (!start || !goal) return [{ x: to.x, z: to.z }]

  const gridPath = astar(blocked, dim, start, goal)
  if (!gridPath) return [{ x: to.x, z: to.z }]

  const pts = gridPath.map((c) => cellCenter(half, c.gx, c.gz))
  const raw = [{ x: from.x, z: from.z }, ...pts, { x: to.x, z: to.z }]
  return smooth(world, raw)
}

// --- walkability -----------------------------------------------------------

function isWalkableInflated(world, x, z) {
  if (!world.isWalkable(x, z)) return false
  const obstacles = world.obstacles || []
  for (let i = 0; i < obstacles.length; i++) {
    const o = obstacles[i]
    const dx = x - o.x
    const dz = z - o.z
    const rr = o.r + AGENT_RADIUS_INFLATION
    if (dx * dx + dz * dz < rr * rr) return false
  }
  return true
}

function cellBlocked(world, half, dim, gx, gz) {
  if (gx < 0 || gz < 0 || gx >= dim || gz >= dim) return true
  const { x, z } = cellCenter(half, gx, gz)
  return !isWalkableInflated(world, x, z)
}

// --- grid helpers ------------------------------------------------------------

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v))
}

function snapToGrid(half, dim, p) {
  return {
    gx: clamp(Math.floor(p.x + half), 0, dim - 1),
    gz: clamp(Math.floor(p.z + half), 0, dim - 1),
  }
}

function cellCenter(half, gx, gz) {
  return { x: gx - half + 0.5, z: gz - half + 0.5 }
}

function nearestWalkable(blocked, dim, gx, gz) {
  if (!blocked(gx, gz)) return { gx, gz }
  for (let r = 1; r <= MAX_SNAP_RING; r++) {
    const found = ringSearch(blocked, dim, gx, gz, r)
    if (found) return found
  }
  return null
}

function ringSearch(blocked, dim, gx, gz, r) {
  for (let dx = -r; dx <= r; dx++) {
    for (let dz = -r; dz <= r; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue
      const nx = gx + dx
      const nz = gz + dz
      if (nx < 0 || nz < 0 || nx >= dim || nz >= dim) continue
      if (!blocked(nx, nz)) return { gx: nx, gz: nz }
    }
  }
  return null
}

// --- A* ----------------------------------------------------------------------

const DIRS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
]

function heuristic(a, b) {
  const dx = Math.abs(a.gx - b.gx)
  const dz = Math.abs(a.gz - b.gz)
  return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz)
}

function heapPush(heap, item) {
  heap.push(item)
  let i = heap.length - 1
  while (i > 0) {
    const p = (i - 1) >> 1
    if (heap[p].f <= heap[i].f) break
    ;[heap[p], heap[i]] = [heap[i], heap[p]]
    i = p
  }
}

function heapPop(heap) {
  const top = heap[0]
  const last = heap.pop()
  if (heap.length) {
    heap[0] = last
    sinkDown(heap, 0)
  }
  return top
}

function sinkDown(heap, i) {
  for (;;) {
    const l = i * 2 + 1
    const r = i * 2 + 2
    let m = i
    if (l < heap.length && heap[l].f < heap[m].f) m = l
    if (r < heap.length && heap[r].f < heap[m].f) m = r
    if (m === i) break
    ;[heap[m], heap[i]] = [heap[i], heap[m]]
    i = m
  }
}

function expandNeighbors(cur, ctx) {
  const { blocked, dim, gScore, cameFrom, open, goal, key } = ctx
  const curG = gScore.get(key(cur.gx, cur.gz))
  for (const [dx, dz] of DIRS) {
    const nx = cur.gx + dx
    const nz = cur.gz + dz
    if (nx < 0 || nz < 0 || nx >= dim || nz >= dim || blocked(nx, nz)) continue
    if (dx !== 0 && dz !== 0 && (blocked(cur.gx + dx, cur.gz) || blocked(cur.gx, cur.gz + dz))) continue
    const step = dx !== 0 && dz !== 0 ? Math.SQRT2 : 1
    const tentative = curG + step
    const nk = key(nx, nz)
    if (tentative < (gScore.get(nk) ?? Infinity)) {
      gScore.set(nk, tentative)
      cameFrom.set(nk, cur)
      heapPush(open, { f: tentative + heuristic({ gx: nx, gz: nz }, goal), gx: nx, gz: nz })
    }
  }
}

function reconstruct(cameFrom, endNode) {
  const path = [endNode]
  let k = `${endNode.gx},${endNode.gz}`
  while (cameFrom.has(k)) {
    const p = cameFrom.get(k)
    path.push(p)
    k = `${p.gx},${p.gz}`
  }
  return path.reverse()
}

function astar(blocked, dim, start, goal) {
  const key = (gx, gz) => `${gx},${gz}`
  const goalKey = key(goal.gx, goal.gz)
  const open = []
  const gScore = new Map([[key(start.gx, start.gz), 0]])
  const cameFrom = new Map()
  const visited = new Set()
  heapPush(open, { f: heuristic(start, goal), gx: start.gx, gz: start.gz })

  while (open.length) {
    const cur = heapPop(open)
    const ck = key(cur.gx, cur.gz)
    if (visited.has(ck)) continue
    visited.add(ck)
    if (ck === goalKey) return reconstruct(cameFrom, cur)
    expandNeighbors(cur, { blocked, dim, gScore, cameFrom, open, goal, key })
  }
  return null
}

// --- line-of-sight smoothing --------------------------------------------------

function lineOfSight(world, a, b) {
  const dist = Math.hypot(b.x - a.x, b.z - a.z)
  const steps = Math.max(1, Math.ceil(dist / LOS_STEP))
  for (let s = 1; s < steps; s++) {
    const t = s / steps
    const x = a.x + (b.x - a.x) * t
    const z = a.z + (b.z - a.z) * t
    if (!isWalkableInflated(world, x, z)) return false
  }
  return true
}

function smooth(world, points) {
  if (points.length <= 2) return points
  const result = [points[0]]
  let i = 0
  while (i < points.length - 1) {
    let j = points.length - 1
    while (j > i + 1 && !lineOfSight(world, points[i], points[j])) j--
    result.push(points[j])
    i = j
  }
  return result
}
