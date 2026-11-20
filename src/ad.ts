import { Resvg } from '@resvg/resvg-js'
import { formatPrice } from './config'
import { bbox, centroid, openRing, toMeters, type Position } from './geo'
import type { PlotDirectory } from './district'
import type { Listing } from './types'

export type AdSize = 'square' | 'portrait' | 'story'

export const AD_SIZES: Record<AdSize, { width: number; height: number; map: number; price: number; title: number; stats: number; badges: number }> = {
  square: { width: 1080, height: 1080, map: 440, price: 665, title: 728, stats: 790, badges: 880 },
  portrait: { width: 1080, height: 1350, map: 700, price: 945, title: 1010, stats: 1075, badges: 1160 },
  story: { width: 1080, height: 1920, map: 1080, price: 1350, title: 1420, stats: 1530, badges: 1650 }
}

export interface Brand {
  companyName: string
  contactLine: string
  currency: string
}

const COLORS = {
  ink: '#10213a',
  paper: '#ffffff',
  land: '#eef1ec',
  plot: '#c7cfc4',
  road: '#ffffff',
  water: '#8cc3e6',
  accent: '#f0a830',
  muted: '#5b6b80'
}

const FONT = 'Inter, Helvetica Neue, Helvetica, Arial, sans-serif'
const HEADER = 120

export function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function renderAdSvg(listing: Listing, directory: PlotDirectory, brand: Brand, size: AdSize): string {
  const { width, height, map, price: priceY, title: titleY, stats: statsY, badges: badgeY } = AD_SIZES[size]
  const target = directory.find(listing.phase, listing.plot)
  const mapSvg = target ? renderMap(directory, listing, target.ring, width, map) : ''
  const badges = [listing.waterfront ? 'Waterfront' : null, listing.corner ? 'Corner plot' : null].filter((b): b is string => Boolean(b))
  const stats = [
    { label: 'AREA', value: `${fmt(listing.areaM2, 0)} m²` },
    { label: 'FRONTAGE', value: `${fmt(listing.frontageM, 1)} m` },
    { label: 'DEPTH', value: `${fmt(listing.depthM, 1)} m` }
  ]
  const sold = listing.status === 'sold'

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${FONT}">
<rect width="${width}" height="${height}" fill="${COLORS.paper}"/>
<rect width="${width}" height="${HEADER}" fill="${COLORS.ink}"/>
<text x="56" y="76" font-size="40" font-weight="700" fill="${COLORS.paper}">${escapeXml(brand.companyName)}</text>
<rect x="${width - 256}" y="34" width="200" height="54" rx="27" fill="${COLORS.accent}"/>
<text x="${width - 156}" y="71" font-size="28" font-weight="700" fill="${COLORS.ink}" text-anchor="middle">${sold ? 'SOLD' : 'FOR SALE'}</text>
<g transform="translate(0 ${HEADER})">${mapSvg}</g>
<text x="56" y="${priceY}" font-size="96" font-weight="800" fill="${COLORS.ink}">${escapeXml(formatPrice(listing.price, brand.currency))}</text>
<text x="56" y="${titleY}" font-size="44" font-weight="600" fill="${COLORS.muted}">Plot ${escapeXml(listing.plot)} · Phase ${escapeXml(listing.phase)} · ${escapeXml(directory.name.replace(/\s*\(sample\)$/, ''))}</text>
${stats.map((s, i) => `<g transform="translate(${56 + i * 330} ${statsY})"><text font-size="26" font-weight="700" fill="${COLORS.muted}" letter-spacing="2">${s.label}</text><text y="56" font-size="52" font-weight="700" fill="${COLORS.ink}">${escapeXml(s.value)}</text></g>`).join('\n')}
${badges.map((b, i) => `<g transform="translate(${56 + i * 280} ${badgeY})"><rect width="${b.length * 19 + 48}" height="56" rx="28" fill="none" stroke="${COLORS.ink}" stroke-width="3"/><text x="${(b.length * 19 + 48) / 2}" y="38" font-size="28" font-weight="600" fill="${COLORS.ink}" text-anchor="middle">${escapeXml(b)}</text></g>`).join('\n')}
<line x1="56" y1="${height - 110}" x2="${width - 56}" y2="${height - 110}" stroke="${COLORS.plot}" stroke-width="2"/>
<text x="56" y="${height - 50}" font-size="32" font-weight="600" fill="${COLORS.ink}">${escapeXml(brand.contactLine)}</text>
<text x="${width - 56}" y="${height - 50}" font-size="32" font-weight="700" fill="${COLORS.muted}" text-anchor="end">Ref ${escapeXml(listing.code)}</text>
</svg>`
}

function renderMap(directory: PlotDirectory, listing: Listing, targetRing: Position[], width: number, height: number): string {
  const origin = targetRing[0]
  const phaseRings = directory.features()
    .filter(f => f.properties.kind === 'plot' && f.properties.phase?.toUpperCase() === listing.phase)
    .map(f => toMeters(f.geometry.coordinates[0], origin))
  const target = toMeters(targetRing, origin)
  const [minX, minY, maxX, maxY] = bbox(phaseRings.length ? phaseRings : [target])
  const margin = 40
  const scale = Math.min((width - margin * 2) / (maxX - minX), (height - margin * 2) / (maxY - minY))
  const [cx, cy] = [(minX + maxX) / 2, (minY + maxY) / 2]
  const project = ([x, y]: Position): Position => [width / 2 + (x - cx) * scale, height / 2 - (y - cy) * scale]
  const path = (ring: Position[]) => 'M' + openRing(ring).map(p => project(p).map(v => v.toFixed(1)).join(' ')).join('L') + 'Z'

  const layers = directory.features().map(f => {
    const ring = toMeters(f.geometry.coordinates[0], origin)
    if (f.properties.kind === 'water') return `<path d="${path(ring)}" fill="${COLORS.water}"/>`
    if (f.properties.kind === 'road') return `<path d="${path(ring)}" fill="${COLORS.road}"/>`
    return `<path d="${path(ring)}" fill="${COLORS.land}" stroke="${COLORS.plot}" stroke-width="1.5"/>`
  })
  const [tx] = project(centroid(target))
  const ty = Math.min(...target.map(p => project(p)[1]))
  const labelY = Math.max(70, ty - 70)
  const label = `Plot ${listing.plot}`
  const labelWidth = label.length * 20 + 40
  const lx = Math.min(Math.max(tx, labelWidth / 2 + 16), width - labelWidth / 2 - 16)
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<rect width="${width}" height="${height}" fill="#dfe6dc"/>
${layers.join('\n')}
<path d="${path(target)}" fill="${COLORS.accent}" stroke="${COLORS.ink}" stroke-width="4"/>
<line x1="${tx.toFixed(1)}" y1="${(labelY + 10).toFixed(1)}" x2="${tx.toFixed(1)}" y2="${ty.toFixed(1)}" stroke="${COLORS.ink}" stroke-width="4"/>
<rect x="${(lx - labelWidth / 2).toFixed(1)}" y="${(labelY - 50).toFixed(1)}" width="${labelWidth}" height="60" rx="12" fill="${COLORS.ink}"/>
<text x="${lx.toFixed(1)}" y="${(labelY - 10).toFixed(1)}" font-size="34" font-weight="700" fill="${COLORS.paper}" text-anchor="middle">${escapeXml(label)}</text>
</svg>`
}

function fmt(value: number, digits: number) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value)
}

export function svgToPng(svg: string, fontFiles: string[] = []): Buffer {
  const resvg = new Resvg(svg, { font: { loadSystemFonts: true, fontFiles, defaultFontFamily: 'Arial' } })
  return Buffer.from(resvg.render().asPng())
}

export function fontFilesFromEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.FONT_FILES ?? '').split(',').map(f => f.trim()).filter(Boolean)
}

export function renderAdPng(listing: Listing, directory: PlotDirectory, brand: Brand, size: AdSize, fontFiles = fontFilesFromEnv()): Buffer {
  return svgToPng(renderAdSvg(listing, directory, brand, size), fontFiles)
}

export function renderAllAds(listing: Listing, directory: PlotDirectory, brand: Brand): Record<AdSize, Buffer> {
  return {
    square: renderAdPng(listing, directory, brand, 'square'),
    portrait: renderAdPng(listing, directory, brand, 'portrait'),
    story: renderAdPng(listing, directory, brand, 'story')
  }
}
