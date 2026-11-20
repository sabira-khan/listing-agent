import { test } from 'node:test'
import assert from 'node:assert/strict'
import { handleInbound } from '../src/app'
import { parseReferral, whatsappLink } from '../src/attribution'
import { caption } from '../src/publish'
import { buildReport, formatReport, previousMonth } from '../src/report'
import { makeApp, OWNER, text } from './helpers'

test('ad links carry the listing code and source, and replies are parsed back', () => {
  const link = whatsappLink('+1 555 0100', 'L-0007', 'ig')
  assert.equal(link, 'https://wa.me/15550100?text=Hi%2C%20I\'m%20interested%20in%20L-0007%20%5Big%5D')
  assert.deepEqual(parseReferral(decodeURIComponent(link.split('text=')[1])), { code: 'L-0007', source: 'instagram', text: "Hi, I'm interested in L-0007" })
  assert.deepEqual(parseReferral('is l-0002 still available?'), { code: 'L-0002', source: null, text: 'is l-0002 still available?' })
  assert.deepEqual(parseReferral('hello'), { code: null, source: null, text: 'hello' })
})

test('captions include a tagged WhatsApp link only when a number is configured', () => {
  const { store } = makeApp(() => [])
  const listing = store.getListing('L-0007')!
  assert.match(caption(listing, 'KWD', '', '15550100', 'tt'), /wa\.me\/15550100\?text=.*L-0007%20%5Btt%5D/)
  assert.doesNotMatch(caption(listing, 'KWD', '', '', 'tt'), /wa\.me/)
})

test('the first message decides the source, and leads keep it', async () => {
  const { deps, store, requests } = makeApp((params, call) => {
    if (call === 0) return [{ type: 'tool_use', name: 'hand_off', input: { code: 'L-0007', budget: '280k', timeline: 'this month', summary: 'Wants to view.' } }]
    return [{ type: 'text', text: 'An agent will call you shortly.' }]
  })
  await handleInbound(text('15550777', "Hi, I'm interested in L-0007 [ig]"), deps)
  const contact = store.contact('15550777')
  assert.equal(contact.source, 'instagram')
  assert.equal(contact.sourceListing, 'L-0007')
  assert.ok(contact.firstSeenAt)
  assert.equal(store.leads()[0].source, 'instagram')
  assert.equal(requests[0].messages.at(-1)?.content, "Hi, I'm interested in L-0007")

  await handleInbound(text('15550777', "I'm interested in L-0013 [fb]"), deps)
  assert.equal(store.contact('15550777').source, 'instagram')
})

test('customers who reply to a broadcast are credited to it, and its cost is recorded', async () => {
  const { deps, store } = makeApp(() => [{ type: 'text', text: 'Happy to help.' }])
  store.updateListing('L-0008', { status: 'published' })
  await handleInbound(text(OWNER, 'Send', 'send:L-0008'), deps)
  const spend = store.spend()
  assert.equal(spend.length, 1)
  assert.equal(spend[0].channel, 'broadcast')
  assert.equal(spend[0].listingCode, 'L-0008')
  assert.ok(Math.abs(spend[0].amount - 0.017) < 1e-9)
  await handleInbound(text('15550201', 'tell me more'), deps)
  assert.equal(store.contact('15550201').source, 'broadcast')
  assert.equal(store.contact('15550201').sourceListing, 'L-0008')
  await handleInbound(text('15550999', 'hello'), deps)
  assert.equal(store.contact('15550999').source, 'direct')
})

test('the owner records ad spend by plot and channel', async () => {
  const { deps, store, channel } = makeApp(() => [])
  await handleInbound(text(OWNER, 'spend L-0007 ig 25'), deps)
  assert.deepEqual(store.spend().map(s => [s.listingCode, s.channel, s.amount]), [['L-0007', 'instagram', 25]])
  assert.match((channel.to(OWNER).at(-1) as { text: string }).text, /Recorded 25\.00 USD on instagram for L-0007/)
  await handleInbound(text(OWNER, 'spend L-0007 radio 25'), deps)
  assert.match((channel.to(OWNER).at(-1) as { text: string }).text, /Unknown channel radio/)
  await handleInbound(text(OWNER, 'spend L-9999 tiktok 5'), deps)
  assert.match((channel.to(OWNER).at(-1) as { text: string }).text, /L-9999 was not found/)
  assert.equal(store.spend().length, 1)
})

test('the report counts enquiries, leads and cost per lead by source and plot', () => {
  const { store } = makeApp(() => [])
  let clock = new Date('2026-10-05T10:00:00Z')
  store.now = () => clock
  const at = clock.toISOString()
  store.updateContact('15550301', { source: 'instagram', sourceListing: 'L-0007', firstSeenAt: at })
  store.updateContact('15550302', { source: 'instagram', sourceListing: 'L-0007', firstSeenAt: at })
  store.updateContact('15550303', { source: 'broadcast', sourceListing: 'L-0008', firstSeenAt: at })
  store.addLead({ phone: '15550301', listingCode: 'L-0007', budget: '280k', timeline: 'now', summary: '', source: 'instagram' })
  store.addSpend({ listingCode: 'L-0007', channel: 'instagram', amount: 30, note: null })
  store.addSpend({ listingCode: 'L-0008', channel: 'broadcast', amount: 0.05, note: null })
  store.log(OWNER, 'sold', 'L-0010')
  clock = new Date('2026-11-02T10:00:00Z')
  store.updateContact('15550304', { source: 'tiktok', firstSeenAt: clock.toISOString() })

  const { from, to } = previousMonth(new Date('2026-11-20T00:00:00Z'))
  const report = buildReport(store, from, to)
  assert.equal(report.enquiries, 3)
  assert.equal(report.leads, 1)
  assert.equal(report.spend, 30.05)
  assert.equal(report.costPerLead, 30.05)
  assert.deepEqual(report.sold, ['L-0010'])
  assert.deepEqual(report.sources.map(r => [r.key, r.enquiries, r.leads, r.spend, r.costPerLead]), [['instagram', 2, 1, 30, 30], ['broadcast', 1, 0, 0.05, null]])
  assert.deepEqual(report.listings.map(r => [r.label, r.enquiries, r.leads]), [['L-0007 plot 2520', 2, 1], ['L-0008 plot 2533', 1, 0]])
  const text = formatReport(report, 'USD')
  assert.match(text, /^Report 1 Oct to 31 Oct/)
  assert.match(text, /3 enquiries, 1 leads, 30\.05 USD spent, 30\.05 USD per lead/)
  assert.match(text, /instagram: 2 enquiries, 1 leads, 30\.00 USD, 30\.00 USD per lead/)
})
