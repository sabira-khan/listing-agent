import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createHmac } from 'node:crypto'
import { handleInbound } from '../src/app'
import { SAFE_REPLY } from '../src/buyer-agent'
import { planFollowUps, runFollowUps } from '../src/followups'
import { createHandler } from '../src/server'
import { lastUserText, makeApp, OWNER, STAFF, text } from './helpers'

const intake = (json: Record<string, unknown>) => () => [{ type: 'text' as const, text: JSON.stringify({ phase: null, plot: null, price: null, ownerName: null, ownerPhone: null, notes: null, ...json }) }]

test('a forwarded offer becomes a pending listing sent to the owner for approval', async () => {
  const { deps, store, channel, requests } = makeApp(intake({ plot: '2561', price: 310000, ownerName: 'Walid', ownerPhone: '+1 555 0150' }))
  await handleInbound(text(STAFF, 'Plot 2561 for sale, 310k, owner Walid +1 555 0150'), deps)
  assert.ok(requests[0].output_config?.format)
  const listing = store.getListing('L-0015')
  assert.equal(listing?.status, 'pending')
  assert.equal(listing?.phase, 'A2')
  assert.match((channel.to(STAFF)[0] as { text: string }).text, /L-0015 created/)
  const approval = channel.to(OWNER)[0]
  assert.equal(approval.kind, 'buttons')
  if (approval.kind !== 'buttons') return
  assert.ok(approval.png && approval.png.length > 1000)
  assert.deepEqual(approval.buttons.map(b => b.id), ['publish:L-0015', 'price:L-0015', 'ignore:L-0015'])
  assert.match(approval.text, /Owner: Walid, \+1 555 0150/)
})

test('offers with missing details are sent back with the problems', async () => {
  const { deps, store, channel } = makeApp(intake({ plot: '2561' }))
  await handleInbound(text(STAFF, 'plot 2561, call me'), deps)
  assert.equal(store.listListings().length, 14)
  assert.match((channel.to(STAFF)[0] as { text: string }).text, /asking price is missing/)
  assert.equal(channel.to(OWNER).length, 0)
})

test('a plot that is already listed is not listed twice', async () => {
  const { deps, store, channel } = makeApp(intake({ plot: '2520', price: 260000 }))
  await handleInbound(text(STAFF, 'plot 2520 260k'), deps)
  assert.equal(store.listListings().length, 14)
  assert.match((channel.to(STAFF)[0] as { text: string }).text, /already listed as L-0007/)
})

test('publishing posts the ad, offers a broadcast with its cost and sends it on confirmation', async () => {
  const { deps, store, channel, publisher } = makeApp(intake({ plot: '2561', price: 210000 }))
  await handleInbound(text(STAFF, 'plot 2561 210k'), deps)
  channel.clear()
  await handleInbound(text(OWNER, 'Publish', 'publish:L-0015'), deps)
  assert.equal(store.getListing('L-0015')?.status, 'published')
  assert.deepEqual(publisher.published[0].sizes, ['square', 'portrait', 'story'])
  const offer = channel.to(OWNER)[0]
  assert.equal(offer.kind, 'buttons')
  if (offer.kind !== 'buttons') return
  assert.match(offer.text, /1 opted-in customer matches/)
  assert.match(offer.text, /0\.02 USD/)
  channel.clear()
  await handleInbound(text(OWNER, 'Send to 1', 'send:L-0015'), deps)
  const recipients = channel.sent.filter(s => s.message.kind === 'template').map(s => s.to).sort()
  assert.deepEqual(recipients, ['15550201'])
  assert.match((channel.to(OWNER).at(-1) as { text: string }).text, /sent to 1 of 1/)
  assert.ok(store.events().some(e => e.action === 'broadcast' && e.detail === '1 of 1'))
})

test('the owner can change the price before approving', async () => {
  const { deps, store, channel } = makeApp(intake({}))
  await handleInbound(text(OWNER, 'Edit price', 'price:L-0014'), deps)
  assert.match((channel.to(OWNER)[0] as { text: string }).text, /new price for L-0014/)
  await handleInbound(text(OWNER, '168,000'), deps)
  assert.equal(store.getListing('L-0014')?.price, 168000)
  assert.equal(store.getState(`pending:${OWNER}`), null)
  const again = channel.to(OWNER).at(-1)
  assert.equal(again?.kind, 'buttons')
  assert.ok(store.events().some(e => e.action === 'price_changed' && e.detail === '175000 to 168000'))
})

test('sold listings stop being offered', async () => {
  const { deps, store, channel } = makeApp(intake({}))
  await handleInbound(text(OWNER, 'sold l-0007'), deps)
  assert.equal(store.getListing('L-0007')?.status, 'sold')
  assert.match((channel.to(OWNER)[0] as { text: string }).text, /marked as sold/)
  assert.ok(!store.searchPublished({}, 50).some(l => l.code === 'L-0007'))
})

test('customers can opt out and back in without reaching the agent', async () => {
  const { deps, store, requests } = makeApp(intake({}))
  await handleInbound(text('15550201', 'STOP'), deps)
  assert.equal(store.contact('15550201').optedOut, true)
  await handleInbound(text('15550201', 'start'), deps)
  assert.equal(store.contact('15550201').optedOut, false)
  assert.equal(requests.length, 0)
})

test('a serious buyer is handed off to the owner with a summary', async () => {
  const { deps, store, channel } = makeApp((params, call) => {
    if (call === 0) return [{ type: 'tool_use', name: 'get_listing', input: { plot: '2520' } }]
    if (call === 1) return [{ type: 'tool_use', name: 'hand_off', input: { code: 'L-0007', budget: '250k to 300k', timeline: 'within a month', summary: 'Wants plot 2520 and asked about 250k.' } }]
    return [{ type: 'text', text: 'Thanks! One of our agents will call you shortly.' }]
  })
  await handleInbound(text('15550999', 'I want plot 2520, budget 250 to 300, buying this month. can you do 250?'), deps)
  const reply = channel.to('15550999').at(-1)
  assert.equal(reply?.kind, 'text')
  const lead = channel.to(OWNER)[0]
  assert.equal(lead.kind, 'text')
  if (lead.kind !== 'text') return
  assert.match(lead.text, /Serious buyer/)
  assert.match(lead.text, /L-0007: plot 2520/)
  assert.match(lead.text, /Customer: \+15550999/)
  assert.ok(store.contact('15550999').handedOffAt)
  assert.equal(store.leads('L-0007').length, 1)
})

test('replies that contain owner details are blocked', async () => {
  const { deps, channel, store } = makeApp(() => [{ type: 'text', text: 'The owner is Karim Aziz, call him on +1 555 0107.' }])
  await handleInbound(text('15550999', 'who owns plot 2520?'), deps)
  assert.deepEqual(channel.to('15550999').at(-1), { kind: 'text', text: SAFE_REPLY })
  assert.ok(store.events().some(e => e.action === 'blocked_reply'))
})

test('the agent sends ad images before its reply and keeps the conversation', async () => {
  const { deps, channel, store, requests } = makeApp((params, call) => {
    if (call === 0) return [{ type: 'tool_use', name: 'search_listings', input: { waterfront: true, max_price: 430000 } }]
    if (call === 1) return [{ type: 'text', text: '*Plot 2412*, phase A1: 395,000 KWD.' }, { type: 'tool_use', name: 'send_ad', input: { code: 'L-0002' } }]
    return [{ type: 'text', text: lastUserText(params) }]
  })
  await handleInbound(text('15550999', 'waterfront under 430k?'), deps)
  const sent = channel.to('15550999')
  assert.deepEqual(sent.map(m => m.kind), ['image', 'text'])
  assert.equal(requests.length, 2)
  const search = JSON.parse(String((requests[1].messages.at(-1)!.content as { content: string }[])[0].content))
  assert.ok(search.results.length > 0 && search.results.every((r: { waterfront: boolean }) => r.waterfront))
  assert.ok(search.results.every((r: Record<string, unknown>) => !('ownerName' in r) && !('ownerPhone' in r)))
  assert.deepEqual(store.contact('15550999').shown, ['L-0002'])
  assert.ok(store.conversation('15550999').length >= 3)
})

test('follow-ups go to quiet customers after 48 hours, then with a similar listing after a week', async () => {
  const { deps, store, channel } = makeApp(intake({}))
  const now = new Date('2026-11-20T12:00:00Z')
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600 * 1000).toISOString()
  store.updateContact('15550201', { lastInboundAt: hoursAgo(50) })
  store.updateContact('15550202', { lastInboundAt: hoursAgo(10) })
  store.updateContact('15550203', { lastInboundAt: hoursAgo(50), handedOffAt: hoursAgo(49) })
  store.updateContact('15550204', { lastInboundAt: hoursAgo(50), optedOut: true })
  assert.deepEqual(planFollowUps(store, now).first.map(c => c.phone), ['15550201'])

  const followDeps = { store, channel, directory: deps.directory, brand: { companyName: 'X', contactLine: '', currency: 'KWD' }, followUpTemplate: 'follow', listingTemplate: 'listing' }
  assert.deepEqual(await runFollowUps(followDeps, now), { first: 1, second: 0 })
  assert.equal(store.contact('15550201').followUps, 1)
  assert.deepEqual(planFollowUps(store, now), { first: [], second: [] })

  const later = new Date(now.getTime() + 6 * 24 * 3600 * 1000)
  const second = planFollowUps(store, later).second
  assert.equal(second.length, 1)
  assert.ok(second[0].listing.price <= 220000 * 1.1 && ['A2', 'A3'].includes(second[0].listing.phase))
  await runFollowUps(followDeps, later)
  assert.equal(store.contact('15550201').followUps, 2)
  assert.deepEqual(channel.to('15550201').map(m => m.kind === 'template' && m.name), ['follow', 'listing'])
})

test('the server checks signatures, hides unpublished ads and protects the dashboard', async () => {
  const { deps } = makeApp(intake({}))
  deps.config.whatsapp.appSecret = 'secret'
  deps.config.whatsapp.verifyToken = 'tok'
  deps.config.adminPassword = 'pw'
  const server = createServer(createHandler(deps))
  await new Promise<void>(resolve => server.listen(0, resolve))
  const base = `http://localhost:${(server.address() as AddressInfo).port}`
  try {
    assert.equal(await (await fetch(`${base}/webhook?hub.mode=subscribe&hub.verify_token=tok&hub.challenge=99`)).text(), '99')
    assert.equal((await fetch(`${base}/webhook?hub.mode=subscribe&hub.verify_token=bad&hub.challenge=99`)).status, 403)
    const body = JSON.stringify({ entry: [] })
    assert.equal((await fetch(`${base}/webhook`, { method: 'POST', body, headers: { 'X-Hub-Signature-256': 'sha256=bad' } })).status, 401)
    const signature = `sha256=${createHmac('sha256', 'secret').update(body).digest('hex')}`
    assert.equal((await fetch(`${base}/webhook`, { method: 'POST', body, headers: { 'X-Hub-Signature-256': signature } })).status, 200)

    const published = await fetch(`${base}/media/L-0007/story.png`)
    assert.equal(published.headers.get('content-type'), 'image/png')
    assert.equal((await fetch(`${base}/media/L-0014/square.png`)).status, 404)
    assert.equal((await fetch(`${base}/admin`)).status, 401)
    const auth = { Authorization: `Basic ${Buffer.from('admin:pw').toString('base64')}` }
    const dashboard = await fetch(`${base}/admin`, { headers: auth })
    assert.match(await dashboard.text(), /Karim Aziz/)
    assert.equal((await fetch(`${base}/admin/ad/L-0014/square.png`, { headers: auth })).status, 200)
  } finally {
    server.close()
  }
})

test('looking up a sold plot by number says it was sold', async () => {
  const { deps, requests } = makeApp((params, call) => {
    if (call === 0) return [{ type: 'tool_use', name: 'get_listing', input: { plot: '2604' } }]
    return [{ type: 'text', text: 'Plot 2604 has been sold.' }]
  })
  await handleInbound(text('15550999', 'what about plot 2604?'), deps)
  const result = JSON.parse(String((requests[1].messages.at(-1)!.content as { content: string }[])[0].content))
  assert.deepEqual(result, { code: 'L-0010', available: false, note: 'This plot has been sold.' })
})
