export type Position = [number, number]

const EARTH_RADIUS = 6371008.8

export function toMeters(points: Position[], origin: Position): Position[] {
  const lat0 = (origin[1] * Math.PI) / 180
  return points.map(([lon, lat]) => [
    (((lon - origin[0]) * Math.PI) / 180) * EARTH_RADIUS * Math.cos(lat0),
    (((lat - origin[1]) * Math.PI) / 180) * EARTH_RADIUS
  ])
}

export function toLonLat(points: Position[], origin: Position): Position[] {
  const lat0 = (origin[1] * Math.PI) / 180
  return points.map(([x, y]) => [
    origin[0] + ((x / (EARTH_RADIUS * Math.cos(lat0))) * 180) / Math.PI,
    origin[1] + ((y / EARTH_RADIUS) * 180) / Math.PI
  ])
}

export function openRing(ring: Position[]): Position[] {
  const first = ring[0]
  const last = ring[ring.length - 1]
  return ring.length > 1 && first[0] === last[0] && first[1] === last[1] ? ring.slice(0, -1) : ring
}

export function ringArea(ring: Position[]): number {
  const points = openRing(ring)
  const origin = points[0]
  const meters = toMeters(points, origin)
  let sum = 0
  for (let i = 0; i < meters.length; i++) {
    const [x1, y1] = meters[i]
    const [x2, y2] = meters[(i + 1) % meters.length]
    sum += x1 * y2 - x2 * y1
  }
  return Math.abs(sum) / 2
}

export function edgeLength(ring: Position[], edge: number): number {
  const points = openRing(ring)
  const a = points[edge % points.length]
  const b = points[(edge + 1) % points.length]
  const [ma, mb] = toMeters([a, b], a)
  return Math.hypot(mb[0] - ma[0], mb[1] - ma[1])
}

export function bbox(rings: Position[][]): [number, number, number, number] {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const ring of rings) {
    for (const [x, y] of ring) {
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }
  return [minX, minY, maxX, maxY]
}

export function centroid(ring: Position[]): Position {
  const points = openRing(ring)
  const x = points.reduce((sum, p) => sum + p[0], 0) / points.length
  const y = points.reduce((sum, p) => sum + p[1], 0) / points.length
  return [x, y]
}

export function round(value: number, digits = 1): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}
