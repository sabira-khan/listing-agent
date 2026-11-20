import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderAdPng, renderAdSvg } from '../src/ad'
import { leaksPrivate } from '../src/buyer-agent'
import { parseAmount } from '../src/app'
import { edgeLength, ringArea, toLonLat } from '../src/geo'
import { buildDraft, parseExtracted, type Extracted } from '../src/intake'
import { seedStore } from '../src/seed'
import { Store } from '../src/store'
import { directory } from './helpers'

const brand = { companyName: 'Sand & Sea Realty', contactLine: 'WhatsApp +1 555 0100', currency: 'KWD' }

const extracted = (patch: Partial<Extracted>): Extracted => ({ phase: null, plot: null, price: null, ownerName: null, ownerPhone: null, notes: null, ...patch })

test('geometry measures a 20 by 30 meter rectangle', () => {
  const ring = toLonLat([[0, 0], [20, 0], [20, 30], [0, 30], [0, 0]], [12.5, 31.2])
  assert.ok(Math.abs(ringArea(ring) - 600) < 0.5)
  assert.ok(Math.abs(edgeLength(ring, 0) - 20) < 0.05)
  assert.ok(Math.abs(edgeLength(ring, 1) - 30) < 0.05)
})

test('district lookups normalize phase and plot numbers', () => {
  assert.deepEqual(directory.phases(), ['A1', 'A2', 'A3'])
  const plot = directory.find('a 1', '02401')
  assert.ok(plot)
  assert.equal(plot.plot, '2401')
  assert.equal(plot.areaM2, 525)
  assert.equal(plot.frontageM, 15)
  assert.equal(plot.depthM, 35)
  assert.ok(plot.waterfront && plot.corner)
  assert.equal(directory.findByNumber('2520')[0].phase, 'A2')
  assert.equal(directory.find('A1', '2520'), null)
})

test('drafts fill plot measurements and infer a unique phase', () => {
  const draft = buildDraft(extracted({ plot: '2520', price: 270000, ownerName: 'Karim' }), directory, '1')
  assert.deepEqual(draft.problems, [])
  assert.equal(draft.listing?.phase, 'A2')
  assert.equal(draft.listing?.areaM2, 585)
  assert.equal(draft.listing?.frontageM, 16.7)
  assert.equal(draft.listing?.waterfront, true)
})

test('drafts report missing or implausible details', () => {
  assert.deepEqual(buildDraft(extracted({}), directory, '1').problems, ['The plot number is missing.', 'The asking price is missing.'])
  assert.match(buildDraft(extracted({ plot: '2520', price: 270 }), directory, '1').problems[0], /too low/)
  assert.match(buildDraft(extracted({ plot: '2520', phase: 'A1', price: 270000 }), directory, '1').problems[0], /not found in phase A1/)
  assert.match(buildDraft(extracted({ plot: '9999', price: 270000 }), directory, '1').problems[0], /not found in Harbor Point/)
})

test('extraction output is parsed defensively', () => {
  assert.deepEqual(parseExtracted('not json'), extracted({}))
  assert.equal(parseExtracted('{"price": -5, "plot": " 2520 "}').price, null)
  assert.equal(parseExtracted('{"price": -5, "plot": " 2520 "}').plot, '2520')
})

test('store assigns codes, searches published listings and segments customers', () => {
  const store = new Store()
  seedStore(store, directory)
  assert.equal(store.listListings().length, 14)
  assert.equal(store.getListing('l-0001')?.plot, '2405')
  const cheap = store.searchPublished({ maxPrice: 200000 })
  assert.deepEqual(cheap.map(l => l.plot), ['2640', '2533'])
  assert.ok(store.searchPublished({ phase: 'a3' }).every(l => l.phase === 'A3'))
  assert.ok(store.searchPublished({ waterfront: true }).every(l => l.waterfront))
  assert.ok(!store.searchPublished({}, 50).some(l => l.status !== 'published'))

  const plot2533 = store.listListings().find(l => l.plot === '2533')!
  assert.deepEqual(store.segment(plot2533).map(c => c.name), ['Adam'])
  store.updateContact('15550201', { optedOut: true })
  assert.deepEqual(store.segment(plot2533), [])
  const plot2490 = store.listListings().find(l => l.plot === '2490')!
  assert.deepEqual(store.segment(plot2490).map(c => c.name), ['Bilal'])
})

test('amounts accept separators and shorthand', () => {
  assert.equal(parseAmount('265,000'), 265000)
  assert.equal(parseAmount('265k'), 265000)
  assert.equal(parseAmount('265 thousand'), 265000)
  assert.equal(parseAmount('265'), null)
  assert.equal(parseAmount('make it 265k'), null)
})

test('ads show the listing details and render at each size', () => {
  const store = new Store()
  seedStore(store, directory)
  const listing = store.getListing('L-0007')!
  const svg = renderAdSvg(listing, directory, brand, 'square')
  assert.match(svg, /270,000 KWD/)
  assert.match(svg, /Plot 2520 · Phase A2/)
  assert.match(svg, /Ref L-0007/)
  assert.match(svg, /Sand &amp; Sea Realty/)
  assert.match(svg, /Waterfront/)
  assert.doesNotMatch(svg, /Karim/)
  for (const [size, w, h] of [['square', 1080, 1080], ['portrait', 1080, 1350], ['story', 1080, 1920]] as const) {
    const png = renderAdPng(listing, directory, brand, size)
    assert.equal(png.readUInt32BE(16), w)
    assert.equal(png.readUInt32BE(20), h)
  }
  assert.match(renderAdSvg(store.updateListing('L-0007', { status: 'sold' }), directory, brand, 'square'), />SOLD</)
})

test('private owner details are detected in replies', () => {
  const values = { names: ['Karim Aziz'], phones: ['+1 555 0107'] }
  assert.ok(leaksPrivate('The owner is karim aziz.', values))
  assert.ok(leaksPrivate('Call 1-555-0107', values))
  assert.ok(leaksPrivate('Call 15550107 today', values))
  assert.ok(!leaksPrivate('Plot 2520 is 270,000 KWD, ref L-0007.', values))
})
