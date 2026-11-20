import { createHmac, timingSafeEqual } from 'node:crypto'
import type { Channel, Inbound, Outgoing } from './channel'

export interface WhatsAppOptions {
  token: string
  phoneNumberId: string
  graphVersion: string
  language: string
  fetch?: typeof fetch
}

export function validSignature(appSecret: string, rawBody: string | Buffer, header: string | null | undefined): boolean {
  if (!appSecret || !header?.startsWith('sha256=')) return false
  const expected = Buffer.from(createHmac('sha256', appSecret).update(rawBody).digest('hex'))
  const given = Buffer.from(header.slice('sha256='.length))
  return expected.length === given.length && timingSafeEqual(expected, given)
}

export function verifyChallenge(params: URLSearchParams, verifyToken: string): string | null {
  if (!verifyToken) return null
  return params.get('hub.mode') === 'subscribe' && params.get('hub.verify_token') === verifyToken ? params.get('hub.challenge') : null
}

export function parseWebhook(body: any): Inbound[] {
  const inbound: Inbound[] = []
  for (const entry of body?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      for (const m of change?.value?.messages ?? []) {
        const media = [m.image, m.document].filter(Boolean).map((x: any) => ({ id: String(x.id), mimeType: String(x.mime_type ?? '') }))
        const text = m.text?.body ?? m.image?.caption ?? m.document?.caption ?? m.button?.text ?? m.interactive?.button_reply?.title ?? ''
        inbound.push({
          from: String(m.from),
          id: String(m.id),
          text: String(text),
          buttonId: m.interactive?.button_reply?.id ?? m.button?.payload ?? null,
          media
        })
      }
    }
  }
  return inbound
}

export class WhatsAppCloud implements Channel {
  private readonly fetch: typeof fetch
  private readonly base: string

  constructor(private readonly options: WhatsAppOptions) {
    this.fetch = options.fetch ?? fetch
    this.base = `https://graph.facebook.com/${options.graphVersion}`
  }

  private async call(path: string, init: RequestInit) {
    const res = await this.fetch(`${this.base}/${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${this.options.token}`, ...(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }) }
    })
    const json: any = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(`WhatsApp API ${res.status}: ${json?.error?.message ?? 'request failed'}`)
    return json
  }

  async upload(png: Buffer): Promise<string> {
    const form = new FormData()
    form.append('messaging_product', 'whatsapp')
    form.append('type', 'image/png')
    form.append('file', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'ad.png')
    const json = await this.call(`${this.options.phoneNumberId}/media`, { method: 'POST', body: form })
    return String(json.id)
  }

  async payload(message: Outgoing): Promise<Record<string, unknown>> {
    if (message.kind === 'text') return { type: 'text', text: { body: message.text, preview_url: false } }
    if (message.kind === 'image') return { type: 'image', image: { id: await this.upload(message.png), caption: message.caption } }
    if (message.kind === 'buttons') {
      return {
        type: 'interactive',
        interactive: {
          type: 'button',
          ...(message.png ? { header: { type: 'image', image: { id: await this.upload(message.png) } } } : {}),
          body: { text: message.text.slice(0, 1024) },
          action: { buttons: message.buttons.slice(0, 3).map(b => ({ type: 'reply', reply: { id: b.id, title: b.title.slice(0, 20) } })) }
        }
      }
    }
    const components: unknown[] = []
    if (message.png) components.push({ type: 'header', parameters: [{ type: 'image', image: { id: await this.upload(message.png) } }] })
    if (message.params.length) components.push({ type: 'body', parameters: message.params.map(text => ({ type: 'text', text })) })
    return { type: 'template', template: { name: message.name, language: { code: this.options.language }, components } }
  }

  async send(to: string, message: Outgoing) {
    const body = { messaging_product: 'whatsapp', recipient_type: 'individual', to, ...(await this.payload(message)) }
    await this.call(`${this.options.phoneNumberId}/messages`, { method: 'POST', body: JSON.stringify(body) })
  }

  async download(mediaId: string) {
    const meta = await this.call(mediaId, { method: 'GET' })
    const res = await this.fetch(String(meta.url), { headers: { Authorization: `Bearer ${this.options.token}` } })
    if (!res.ok) throw new Error(`WhatsApp media ${res.status}`)
    return { mimeType: String(meta.mime_type ?? res.headers.get('content-type') ?? ''), data: Buffer.from(await res.arrayBuffer()) }
  }
}
