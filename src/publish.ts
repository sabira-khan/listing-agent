import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AdSize } from './ad'
import { whatsappLink } from './attribution'
import { formatPrice } from './config'
import type { Listing } from './types'

export type AdImages = Record<AdSize, Buffer>

export type CaptionFor = (tag: string) => string

export interface Publisher {
  name: string
  publish(listing: Listing, images: AdImages, captionFor: CaptionFor): Promise<string>
}

export function caption(listing: Listing, currency: string, contactLine: string, whatsappNumber = '', tag = ''): string {
  const features = [listing.waterfront ? 'waterfront' : null, listing.corner ? 'corner plot' : null].filter(Boolean)
  return [
    `Plot ${listing.plot}, Phase ${listing.phase}: ${formatPrice(listing.price, currency)}`,
    `${listing.areaM2} m², ${listing.frontageM} m frontage${features.length ? `, ${features.join(', ')}` : ''}.`,
    contactLine ? `${contactLine}, ref ${listing.code}` : `Ref ${listing.code}`,
    ...(whatsappNumber && tag ? [`Message us: ${whatsappLink(whatsappNumber, listing.code, tag)}`] : [])
  ].join('\n')
}

export class OutboxPublisher implements Publisher {
  readonly name = 'outbox'

  constructor(private readonly dir: string) {}

  async publish(listing: Listing, images: AdImages, captionFor: CaptionFor) {
    const folder = join(this.dir, listing.code)
    await mkdir(folder, { recursive: true })
    await Promise.all(Object.entries(images).map(([size, png]) => writeFile(join(folder, `${size}.png`), png)))
    for (const [platform, tag] of [['instagram', 'ig'], ['facebook', 'fb'], ['tiktok', 'tt']]) {
      await writeFile(join(folder, `caption-${platform}.txt`), `${captionFor(tag)}\n`)
    }
    return folder
  }
}

interface MetaOptions {
  token: string
  graphVersion: string
  imageUrl: (code: string, size: AdSize) => string
  fetch?: typeof fetch
}

async function graph(fetchFn: typeof fetch, url: string, params: Record<string, string>) {
  const res = await fetchFn(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params) })
  const json: any = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`Graph API ${res.status}: ${json?.error?.message ?? 'request failed'}`)
  return json
}

export class InstagramPublisher implements Publisher {
  readonly name = 'instagram'

  constructor(private readonly userId: string, private readonly options: MetaOptions) {}

  async publish(listing: Listing, _images: AdImages, captionFor: CaptionFor) {
    const text = captionFor('ig')
    const fetchFn = this.options.fetch ?? fetch
    const base = `https://graph.facebook.com/${this.options.graphVersion}/${this.userId}`
    const container = await graph(fetchFn, `${base}/media`, { image_url: this.options.imageUrl(listing.code, 'portrait'), caption: text, access_token: this.options.token })
    const published = await graph(fetchFn, `${base}/media_publish`, { creation_id: String(container.id), access_token: this.options.token })
    return `instagram:${published.id}`
  }
}

export class FacebookPagePublisher implements Publisher {
  readonly name = 'facebook'

  constructor(private readonly pageId: string, private readonly options: MetaOptions) {}

  async publish(listing: Listing, _images: AdImages, captionFor: CaptionFor) {
    const text = captionFor('fb')
    const fetchFn = this.options.fetch ?? fetch
    const url = `https://graph.facebook.com/${this.options.graphVersion}/${this.pageId}/photos`
    const json = await graph(fetchFn, url, { url: this.options.imageUrl(listing.code, 'square'), message: text, access_token: this.options.token })
    return `facebook:${json.post_id ?? json.id}`
  }
}
