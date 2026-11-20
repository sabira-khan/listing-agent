import { readFileSync } from 'node:fs'
import { edgeLength, ringArea, round, type Position } from './geo'

export interface FeatureProperties {
  kind: 'plot' | 'road' | 'water'
  number?: string
  phase?: string
  frontEdge?: number
  corner?: boolean
  waterfront?: boolean
}

export interface Feature {
  type: 'Feature'
  properties: FeatureProperties
  geometry: { type: 'Polygon'; coordinates: Position[][] }
}

export interface FeatureCollection {
  type: 'FeatureCollection'
  name?: string
  features: Feature[]
}

export interface PlotInfo {
  phase: string
  plot: string
  areaM2: number
  frontageM: number
  depthM: number
  corner: boolean
  waterfront: boolean
  ring: Position[]
}

export interface PlotDirectory {
  name: string
  find(phase: string, plot: string): PlotInfo | null
  findByNumber(plot: string): PlotInfo[]
  phases(): string[]
  features(): Feature[]
}

export function normalizePhase(phase: string): string {
  return phase.toUpperCase().replace(/[\s-]+/g, '')
}

export function normalizePlot(plot: string): string {
  return plot.trim().replace(/^0+(?=\d)/, '')
}

export class GeoJsonDistrict implements PlotDirectory {
  readonly name: string
  private readonly all: Feature[]
  private readonly plots = new Map<string, PlotInfo>()

  constructor(collection: FeatureCollection) {
    this.name = collection.name ?? 'District'
    this.all = collection.features
    for (const feature of collection.features) {
      const p = feature.properties
      if (p.kind !== 'plot' || !p.number || !p.phase) continue
      const ring = feature.geometry.coordinates[0]
      const areaM2 = ringArea(ring)
      const frontageM = edgeLength(ring, p.frontEdge ?? 0)
      const info: PlotInfo = {
        phase: normalizePhase(p.phase),
        plot: normalizePlot(p.number),
        areaM2: round(areaM2, 0),
        frontageM: round(frontageM),
        depthM: round(areaM2 / frontageM),
        corner: Boolean(p.corner),
        waterfront: Boolean(p.waterfront),
        ring
      }
      this.plots.set(key(info.phase, info.plot), info)
    }
  }

  static fromFile(path: string): GeoJsonDistrict {
    return new GeoJsonDistrict(JSON.parse(readFileSync(path, 'utf8')))
  }

  find(phase: string, plot: string): PlotInfo | null {
    return this.plots.get(key(normalizePhase(phase), normalizePlot(plot))) ?? null
  }

  findByNumber(plot: string): PlotInfo[] {
    const number = normalizePlot(plot)
    return [...this.plots.values()].filter(info => info.plot === number)
  }

  phases(): string[] {
    return [...new Set([...this.plots.values()].map(info => info.phase))].sort()
  }

  features(): Feature[] {
    return this.all
  }
}

function key(phase: string, plot: string) {
  return `${phase}/${plot}`
}
