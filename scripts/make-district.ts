import { writeFileSync } from 'node:fs'
import { toLonLat, type Position } from '../src/geo'
import type { Feature, FeatureCollection } from '../src/district'

const ORIGIN: Position = [12.5, 31.2]
const PHASES = ['A1', 'A2', 'A3']
const PHASE_WIDTH = 420
const PHASE_GAP = 24
const ROAD = 14

let seed = 7
function random() {
  seed = (seed * 16807) % 2147483647
  return seed / 2147483647
}

function polygon(x1: number, y1: number, x2: number, y2: number): Position[] {
  const ring = toLonLat([[x1, y1], [x2, y1], [x2, y2], [x1, y2]], ORIGIN)
  return [...ring, ring[0]].map(([lon, lat]) => [Number(lon.toFixed(7)), Number(lat.toFixed(7))])
}

function feature(properties: Feature['properties'], ring: Position[]): Feature {
  return { type: 'Feature', properties, geometry: { type: 'Polygon', coordinates: [ring] } }
}

const rows = [
  { y1: 545, y2: 580, frontEdge: 2, waterfront: true },
  { y1: 500, y2: 531, frontEdge: 2, waterfront: false },
  { y1: 469, y2: 500, frontEdge: 0, waterfront: false },
  { y1: 424, y2: 455, frontEdge: 2, waterfront: false },
  { y1: 393, y2: 424, frontEdge: 0, waterfront: false }
]
const roads = [
  { y1: 531, y2: 545 },
  { y1: 455, y2: 469 },
  { y1: 379, y2: 393 }
]

const features: Feature[] = []
const totalWidth = PHASES.length * PHASE_WIDTH + (PHASES.length + 1) * PHASE_GAP
features.push(feature({ kind: 'water' }, polygon(0, 595, totalWidth, 760)))
for (const road of roads) features.push(feature({ kind: 'road' }, polygon(0, road.y1, totalWidth, road.y2)))

let number = 2401
PHASES.forEach((phase, index) => {
  const x0 = PHASE_GAP + index * (PHASE_WIDTH + PHASE_GAP)
  features.push(feature({ kind: 'road' }, polygon(x0 - PHASE_GAP + 5, 379, x0 - 5, 595)))
  for (const row of rows) {
    let x = x0
    const widths: number[] = []
    while (true) {
      const width = Math.round((15 + random() * 9) * 10) / 10
      if (x + width > x0 + PHASE_WIDTH) break
      widths.push(width)
      x += width
    }
    x = x0
    widths.forEach((width, i) => {
      features.push(feature({
        kind: 'plot',
        number: String(number++),
        phase,
        frontEdge: row.frontEdge,
        corner: i === 0 || i === widths.length - 1,
        waterfront: row.waterfront
      }, polygon(x, row.y1, x + width, row.y2)))
      x += width
    })
  }
})
features.push(feature({ kind: 'road' }, polygon(totalWidth - PHASE_GAP + 5, 379, totalWidth - 5, 595)))

const collection: FeatureCollection = { type: 'FeatureCollection', name: 'Harbor Point (sample)', features }
writeFileSync(new URL('../data/sample-district.geojson', import.meta.url), JSON.stringify(collection))
console.log(`${features.filter(f => f.properties.kind === 'plot').length} plots, numbers 2401 to ${number - 1}`)
