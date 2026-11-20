import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { FacebookPagePublisher, InstagramPublisher, caption } from '../src/publish'
import { seedStore } from '../src/seed'
import { Store } from '../src/store'
import { parseWebhook, validSignature, verifyChallenge, WhatsAppCloud } from '../src/whatsapp'
import { directory } from './helpers'

function fakeFetch(responses: Record<string, unknown>) {
  const calls: { url: string; init: RequestInit }[] = []
  const fn = async (url: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(url), init })
    const key = Object.keys(responses).find(k => String(url).endsWith(k)) ?? ''
    return new Response(JSON.stringify(responses[key] ?? {}), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  return { fetch: fn as typeof fetch, calls }
}

test('webhook signatures are checked against the raw body', () => {
  const body = '{"entry":[]}'
  const header = `sha256=${createHmac('sha256', 'secret').update(body).digest('hex')}`
  assert.ok(validSignature('secret', body, header))
  assert.ok(!validSignature('secret', body + ' ', header))
  assert.ok(!validSignature('other', body, header))
  assert.ok(!validSignature('', body, header))
  assert.ok(!validSignature('secret', body, null))
})

test('webhook verification echoes the challenge only for the right token', () => {
  const params = new URLSearchParams({ 'hub.mode': 'subscribe', 'hub.verify_token': 'tok', 'hub.challenge': '42' })
  assert.equal(verifyChallenge(params, 'tok'), '42')
  assert.equal(verifyChallenge(params, 'nope'), null)
  assert.equal(verifyChallenge(params, ''), null)
})

test('webhook payloads become inbound messages', () => {
  const messages = parseWebhook({
    entry: [{ changes: [{ value: { messages: [
      { from: '15550201', id: 'a', type: 'text', text: { body: 'hello' } },
      { from: '10000000001', id: 'b', type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'publish:L-0001', title: 'Publish' } } },
      { from: '10000000002', id: 'c', type: 'image', image: { id: 'm1', mime_type: 'image/jpeg', caption: 'plot 2520, 270k' } }
    ] } }] }]
  })
  assert.deepEqual(messages.map(m => [m.from, m.text, m.buttonId, m.media.length]), [
    ['15550201', 'hello', null, 0],
    ['10000000001', 'Publish', 'publish:L-0001', 0],
    ['10000000002', 'plot 2520, 270k', null, 1]
  ])
  assert.deepEqual(parseWebhook({ entry: [{ changes: [{ value: { statuses: [{}] } }] }] }), [])
})

test('cloud API messages upload images and limit buttons', async () => {
  const { fetch, calls } = fakeFetch({ '/media': { id: 'media-1' }, '/messages': { messages: [{ id: 'x' }] } })
  const wa = new WhatsAppCloud({ token: 't', phoneNumberId: 'PN', graphVersion: 'v23.0', language: 'en', fetch })
  await wa.send('15550201', {
    kind: 'buttons',
    text: 'Approve?',
    png: Buffer.from('png'),
    buttons: [{ id: 'a', title: 'A very long button title here' }, { id: 'b', title: 'B' }, { id: 'c', title: 'C' }, { id: 'd', title: 'D' }]
  })
  assert.equal(calls[0].url, 'https://graph.facebook.com/v23.0/PN/media')
  const body = JSON.parse(String(calls[1].init.body))
  assert.equal(body.to, '15550201')
  assert.equal(body.interactive.header.image.id, 'media-1')
  assert.equal(body.interactive.action.buttons.length, 3)
  assert.equal(body.interactive.action.buttons[0].reply.title.length, 20)

  await wa.send('15550201', { kind: 'template', name: 'new_listing', params: ['2520', 'A2'] })
  const template = JSON.parse(String(calls[2].init.body)).template
  assert.deepEqual(template, { name: 'new_listing', language: { code: 'en' }, components: [{ type: 'body', parameters: [{ type: 'text', text: '2520' }, { type: 'text', text: 'A2' }] }] })
})

test('instagram and facebook publishers post the public image URL', async () => {
  const store = new Store()
  seedStore(store, directory)
  const listing = store.getListing('L-0007')!
  const text = caption(listing, 'KWD', 'WhatsApp +1 555 0100')
  assert.match(text, /Plot 2520, Phase A2: 270,000 KWD/)
  assert.match(text, /waterfront/)
  assert.doesNotMatch(text, /Karim/)

  const imageUrl = (code: string, size: string) => `https://example.com/media/${code}/${size}.png`
  const ig = fakeFetch({ '/media': { id: 'container' }, '/media_publish': { id: 'post' } })
  const ref = await new InstagramPublisher('IG', { token: 't', graphVersion: 'v23.0', imageUrl, fetch: ig.fetch }).publish(listing, {} as never, () => text)
  assert.equal(ref, 'instagram:post')
  assert.equal(JSON.parse(String(ig.calls[0].init.body)).image_url, 'https://example.com/media/L-0007/portrait.png')
  assert.equal(JSON.parse(String(ig.calls[1].init.body)).creation_id, 'container')

  const fb = fakeFetch({ '/photos': { id: 'photo', post_id: 'page_post' } })
  assert.equal(await new FacebookPagePublisher('PG', { token: 't', graphVersion: 'v23.0', imageUrl, fetch: fb.fetch }).publish(listing, {} as never, () => text), 'facebook:page_post')
})
