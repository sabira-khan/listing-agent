import type Anthropic from '@anthropic-ai/sdk'
import { normalizePhase, normalizePlot, type PlotDirectory } from './district'
import type { NewListing } from './types'

export interface IntakeImage {
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'
  data: string
}

export interface IntakeInput {
  text: string
  images: IntakeImage[]
}

export interface Extracted {
  phase: string | null
  plot: string | null
  price: number | null
  ownerName: string | null
  ownerPhone: string | null
  notes: string | null
}

export interface Usage {
  inputTokens: number
  outputTokens: number
}

const nullable = (type: string) => ({ anyOf: [{ type }, { type: 'null' }] })

const SCHEMA = {
  type: 'object',
  properties: {
    phase: nullable('string'),
    plot: nullable('string'),
    price: nullable('number'),
    ownerName: nullable('string'),
    ownerPhone: nullable('string'),
    notes: nullable('string')
  },
  required: ['phase', 'plot', 'price', 'ownerName', 'ownerPhone', 'notes'],
  additionalProperties: false
}

const SYSTEM = `You read land offers that property owners send to a real estate office. Staff forward them as they arrived: chat text, photos of plot certificates or site plans, or short notes typed after a call.

Extract one offer:
- phase: the phase or block code of the plot, such as "A2". Null if not stated.
- plot: the plot number only, digits as written. Null if not stated.
- price: the asking price as a full number. Expand shorthand: "270k", "270 thousand" and "270 K" mean 270000. If several prices appear, use the asking price, not offers from others. Never read a phone number, area or plot number as a price. Null if not stated.
- ownerName and ownerPhone: the owner's name and phone number if given.
- notes: one short sentence with anything else useful for the listing, such as "owner prefers cash" or "price negotiable". Null if nothing.

Use null for anything that is not stated. Never guess.`

export async function extractListing(client: Anthropic, model: string, input: IntakeInput): Promise<{ extracted: Extracted; usage: Usage }> {
  const content: Anthropic.ContentBlockParam[] = [
    ...input.images.map((image): Anthropic.ImageBlockParam => ({ type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } })),
    { type: 'text', text: `<offer>\n${input.text || '(no text, see the images)'}\n</offer>` }
  ]
  const res = await client.messages.create({
    model,
    max_tokens: 1024,
    system: SYSTEM,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{ role: 'user', content }]
  })
  const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map(b => b.text).join('')
  const usage = { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens }
  return { extracted: parseExtracted(text), usage }
}

export function parseExtracted(text: string): Extracted {
  let raw: Record<string, unknown> = {}
  try { raw = JSON.parse(text) } catch {}
  const str = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null)
  const price = typeof raw.price === 'number' && Number.isFinite(raw.price) && raw.price > 0 ? raw.price : null
  return {
    phase: str(raw.phase),
    plot: str(raw.plot),
    price,
    ownerName: str(raw.ownerName),
    ownerPhone: str(raw.ownerPhone),
    notes: str(raw.notes)
  }
}

export interface Draft {
  listing: NewListing | null
  problems: string[]
}

export function buildDraft(extracted: Extracted, directory: PlotDirectory, submittedBy: string): Draft {
  const problems: string[] = []
  if (!extracted.plot) problems.push('The plot number is missing.')
  if (extracted.price === null) problems.push('The asking price is missing.')
  else if (extracted.price < 1000) problems.push(`The price ${extracted.price} looks too low. Send the full amount, for example 270000.`)

  let plot = null
  if (extracted.plot) {
    if (extracted.phase) {
      plot = directory.find(extracted.phase, extracted.plot)
      if (!plot) problems.push(`Plot ${normalizePlot(extracted.plot)} was not found in phase ${normalizePhase(extracted.phase)}.`)
    } else {
      const matches = directory.findByNumber(extracted.plot)
      if (matches.length === 1) plot = matches[0]
      else if (matches.length > 1) problems.push(`Plot ${normalizePlot(extracted.plot)} exists in phases ${matches.map(m => m.phase).join(', ')}. Which phase is it?`)
      else problems.push(`Plot ${normalizePlot(extracted.plot)} was not found in ${directory.name}.`)
    }
  }

  if (problems.length || !plot || extracted.price === null) return { listing: null, problems }
  return {
    listing: {
      phase: plot.phase,
      plot: plot.plot,
      areaM2: plot.areaM2,
      frontageM: plot.frontageM,
      depthM: plot.depthM,
      corner: plot.corner,
      waterfront: plot.waterfront,
      price: extracted.price,
      ownerName: extracted.ownerName,
      ownerPhone: extracted.ownerPhone,
      notes: extracted.notes,
      submittedBy
    },
    problems
  }
}
