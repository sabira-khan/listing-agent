import type Anthropic from '@anthropic-ai/sdk'
import type { AppDeps } from '../src/app'
import { MemoryChannel } from '../src/channel'
import { loadConfig } from '../src/config'
import { GeoJsonDistrict } from '../src/district'
import type { AdImages, CaptionFor, Publisher } from '../src/publish'
import { seedStore } from '../src/seed'
import { Store } from '../src/store'
import type { Listing } from '../src/types'

export const OWNER = '10000000001'
export const STAFF = '10000000002'

export type Block = { type: 'text'; text: string } | { type: 'tool_use'; name: string; input: Record<string, unknown> }
export type Script = (params: Anthropic.MessageCreateParams, call: number) => Block[]

export function fakeClient(script: Script) {
  const requests: Anthropic.MessageCreateParams[] = []
  const client = {
    messages: {
      async create(params: Anthropic.MessageCreateParams) {
        requests.push(structuredClone(params))
        const blocks = script(params, requests.length - 1)
        const content = blocks.map((b, i) => (b.type === 'text' ? { type: 'text', text: b.text, citations: null } : { type: 'tool_use', id: `tool_${requests.length}_${i}`, name: b.name, input: b.input }))
        return {
          id: `msg_${requests.length}`,
          type: 'message',
          role: 'assistant',
          model: params.model,
          content,
          stop_reason: blocks.some(b => b.type === 'tool_use') ? 'tool_use' : 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 100, output_tokens: 20 }
        }
      }
    }
  }
  return { client: client as unknown as Anthropic, requests }
}

export function lastUserText(params: Anthropic.MessageCreateParams): string {
  for (let i = params.messages.length - 1; i >= 0; i--) {
    const m = params.messages[i]
    if (m.role === 'user' && typeof m.content === 'string') return m.content
  }
  return ''
}

export class MemoryPublisher implements Publisher {
  readonly name = 'memory'
  readonly published: { listing: Listing; sizes: string[]; caption: string }[] = []

  async publish(listing: Listing, images: AdImages, captionFor: CaptionFor) {
    this.published.push({ listing, sizes: Object.keys(images), caption: captionFor('ig') })
    return `memory:${listing.code}`
  }
}

export const directory = GeoJsonDistrict.fromFile('data/sample-district.geojson')

export function makeApp(script: Script, options: { seed?: boolean } = {}) {
  const config = { ...loadConfig({}), ownerPhones: [OWNER], staffPhones: [STAFF], contactLine: 'WhatsApp +1 555 0100', whatsappNumber: '15550100' }
  const store = new Store()
  if (options.seed !== false) seedStore(store, directory)
  const channel = new MemoryChannel()
  const publisher = new MemoryPublisher()
  const { client, requests } = fakeClient(script)
  const deps: AppDeps = { config, store, channel, directory, client, publishers: [publisher] }
  return { deps, store, channel, publisher, requests }
}

export function text(from: string, body: string, buttonId: string | null = null) {
  return { from, id: Math.random().toString(36).slice(2), text: body, buttonId, media: [] }
}
