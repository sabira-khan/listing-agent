export interface Button {
  id: string
  title: string
}

export type Outgoing =
  | { kind: 'text'; text: string }
  | { kind: 'image'; png: Buffer; caption: string }
  | { kind: 'buttons'; text: string; buttons: Button[]; png?: Buffer }
  | { kind: 'template'; name: string; params: string[]; png?: Buffer }

export interface Inbound {
  from: string
  id: string
  text: string
  buttonId: string | null
  media: { id: string; mimeType: string }[]
}

export interface Channel {
  send(to: string, message: Outgoing): Promise<void>
  download(mediaId: string): Promise<{ mimeType: string; data: Buffer }>
}

export class MemoryChannel implements Channel {
  readonly sent: { to: string; message: Outgoing }[] = []
  readonly media = new Map<string, { mimeType: string; data: Buffer }>()

  async send(to: string, message: Outgoing) {
    this.sent.push({ to, message })
  }

  async download(mediaId: string) {
    const item = this.media.get(mediaId)
    if (!item) throw new Error(`Unknown media ${mediaId}`)
    return item
  }

  to(phone: string) {
    return this.sent.filter(s => s.to === phone).map(s => s.message)
  }

  clear() {
    this.sent.length = 0
  }
}

export class ConsoleChannel implements Channel {
  async send(to: string, message: Outgoing) {
    if (message.kind === 'text') console.log(`[to ${to}] ${message.text}`)
    if (message.kind === 'image') console.log(`[to ${to}] (image) ${message.caption}`)
    if (message.kind === 'buttons') console.log(`[to ${to}] ${message.text}\n  ${message.buttons.map(b => `[${b.title}]`).join(' ')}`)
    if (message.kind === 'template') console.log(`[to ${to}] (template ${message.name}) ${message.params.join(' | ')}`)
  }

  async download(): Promise<{ mimeType: string; data: Buffer }> {
    throw new Error('ConsoleChannel cannot download media')
  }
}
