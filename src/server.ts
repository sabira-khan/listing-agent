import Anthropic from '@anthropic-ai/sdk'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { AD_SIZES, renderAdPng, type AdSize } from './ad'
import { brand, handleInbound, type AppDeps } from './app'
import { loadConfig, type Config } from './config'
import { renderDashboard } from './dashboard'
import { GeoJsonDistrict } from './district'
import { runFollowUps } from './followups'
import { FacebookPagePublisher, InstagramPublisher, OutboxPublisher, type Publisher } from './publish'
import { Store } from './store'
import { parseWebhook, validSignature, verifyChallenge, WhatsAppCloud } from './whatsapp'

export function createDeps(config: Config): AppDeps {
  const imageUrl = (code: string, size: AdSize) => `${config.publicBaseUrl}/media/${code}/${size}.png`
  const meta = { graphVersion: config.whatsapp.graphVersion, imageUrl }
  const publishers: Publisher[] = [new OutboxPublisher('outbox')]
  if (config.instagram) publishers.push(new InstagramPublisher(config.instagram.userId, { ...meta, token: config.instagram.token }))
  if (config.facebook) publishers.push(new FacebookPagePublisher(config.facebook.pageId, { ...meta, token: config.facebook.token }))
  return {
    config,
    store: new Store(config.dbPath),
    directory: GeoJsonDistrict.fromFile(config.districtPath),
    client: new Anthropic(),
    channel: new WhatsAppCloud({ ...config.whatsapp, language: config.templateLanguage }),
    publishers
  }
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function same(a: string, b: string) {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

function authorized(req: IncomingMessage, password: string) {
  if (!password) return false
  const header = req.headers.authorization ?? ''
  if (!header.startsWith('Basic ')) return false
  const [, pass = ''] = Buffer.from(header.slice(6), 'base64').toString().split(':')
  return same(pass, password)
}

function send(res: ServerResponse, status: number, body: string | Buffer, type = 'text/plain; charset=utf-8', headers: Record<string, string> = {}) {
  res.writeHead(status, { 'Content-Type': type, ...headers })
  res.end(body)
}

export function createHandler(deps: AppDeps) {
  const { config, store } = deps
  const cache = new Map<string, Buffer>()

  return async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    try {
      if (url.pathname === '/webhook' && req.method === 'GET') {
        const challenge = verifyChallenge(url.searchParams, config.whatsapp.verifyToken)
        return challenge ? send(res, 200, challenge) : send(res, 403, 'Forbidden')
      }
      if (url.pathname === '/webhook' && req.method === 'POST') {
        const raw = await readBody(req)
        if (!validSignature(config.whatsapp.appSecret, raw, req.headers['x-hub-signature-256'] as string | undefined)) return send(res, 401, 'Invalid signature')
        send(res, 200, 'OK')
        for (const message of parseWebhook(JSON.parse(raw.toString('utf8')))) {
          await handleInbound(message, deps).catch(err => {
            store.log('system', 'error', null, (err as Error).message)
            console.error(err)
          })
        }
        return
      }
      const media = url.pathname.match(/^\/(media|admin\/ad)\/(L-\d+)\/(square|portrait|story)\.png$/)
      if (media && req.method === 'GET') {
        const [, scope, code, size] = media
        if (scope === 'admin/ad' && !authorized(req, config.adminPassword)) return send(res, 401, 'Unauthorized', 'text/plain', { 'WWW-Authenticate': 'Basic realm="admin"' })
        const listing = store.getListing(code)
        if (!listing || (scope === 'media' && listing.status !== 'published')) return send(res, 404, 'Not found')
        const key = `${code}/${size}/${listing.updatedAt}/${listing.status}`
        const png = cache.get(key) ?? renderAdPng(listing, deps.directory, brand(config), size as keyof typeof AD_SIZES)
        cache.set(key, png)
        return send(res, 200, png, 'image/png', { 'Cache-Control': 'public, max-age=300' })
      }
      if (url.pathname === '/admin' && req.method === 'GET') {
        if (!authorized(req, config.adminPassword)) return send(res, 401, 'Unauthorized', 'text/plain', { 'WWW-Authenticate': 'Basic realm="admin"' })
        return send(res, 200, renderDashboard(store, config), 'text/html; charset=utf-8')
      }
      if (url.pathname === '/tasks/follow-ups' && req.method === 'POST') {
        if (!authorized(req, config.adminPassword)) return send(res, 401, 'Unauthorized')
        const result = await runFollowUps({ store, channel: deps.channel, directory: deps.directory, brand: brand(config), followUpTemplate: config.followUpTemplate, listingTemplate: config.listingTemplate })
        return send(res, 200, JSON.stringify(result), 'application/json')
      }
      if (url.pathname === '/health') return send(res, 200, 'ok')
      return send(res, 404, 'Not found')
    } catch (err) {
      console.error(err)
      if (!res.headersSent) send(res, 500, 'Server error')
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = loadConfig()
  const deps = createDeps(config)
  const port = Number(process.env.PORT) || 3000
  createServer(createHandler(deps)).listen(port, () => console.log(`Listening on :${port}`))
}
