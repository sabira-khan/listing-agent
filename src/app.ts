import type Anthropic from '@anthropic-ai/sdk'
import { renderAdPng, renderAllAds, type Brand } from './ad'
import { campaignSource, CHANNEL_ALIASES, parseReferral } from './attribution'
import { runBuyerAgent } from './buyer-agent'
import type { Channel, Inbound } from './channel'
import { formatPrice, normalizePhone, type Config } from './config'
import type { PlotDirectory } from './district'
import { buildDraft, extractListing, type IntakeImage } from './intake'
import { caption, type Publisher } from './publish'
import { buildReport, formatReport, previousMonth } from './report'
import type { Store } from './store'
import type { Lead, Listing } from './types'

export interface AppDeps {
  config: Config
  store: Store
  channel: Channel
  directory: PlotDirectory
  client: Anthropic
  publishers: Publisher[]
}

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const STOP_WORDS = ['stop', 'unsubscribe', 'إيقاف', 'ايقاف']
const START_WORDS = ['start', 'subscribe']

export function brand(config: Config): Brand {
  return { companyName: config.companyName, contactLine: config.contactLine, currency: config.currency }
}

export function role(config: Config, phone: string): 'owner' | 'staff' | 'buyer' {
  const p = normalizePhone(phone)
  if (config.ownerPhones.includes(p)) return 'owner'
  if (config.staffPhones.includes(p)) return 'staff'
  return 'buyer'
}

export async function handleInbound(message: Inbound, deps: AppDeps): Promise<void> {
  const who = role(deps.config, message.from)
  if (who === 'buyer') return handleBuyer(message, deps)
  if (who === 'owner' && (await handleOwnerCommand(message, deps))) return
  return handleSubmission(message, deps)
}

function summary(listing: Listing, currency: string) {
  const features = [listing.waterfront ? 'waterfront' : null, listing.corner ? 'corner' : null].filter(Boolean).join(', ')
  return `${listing.code}: plot ${listing.plot}, phase ${listing.phase}, ${listing.areaM2} m², ${listing.frontageM} m frontage${features ? `, ${features}` : ''}, ${formatPrice(listing.price, currency)}`
}

export async function requestApproval(listing: Listing, deps: AppDeps) {
  const png = renderAdPng(listing, deps.directory, brand(deps.config), 'square')
  const lines = [`New listing ready for approval`, summary(listing, deps.config.currency)]
  if (listing.ownerName || listing.ownerPhone) lines.push(`Owner: ${[listing.ownerName, listing.ownerPhone].filter(Boolean).join(', ')}`)
  if (listing.notes) lines.push(`Notes: ${listing.notes}`)
  for (const owner of deps.config.ownerPhones) {
    await deps.channel.send(owner, {
      kind: 'buttons',
      text: lines.join('\n'),
      png,
      buttons: [
        { id: `publish:${listing.code}`, title: 'Publish' },
        { id: `price:${listing.code}`, title: 'Edit price' },
        { id: `ignore:${listing.code}`, title: 'Ignore' }
      ]
    })
  }
}

async function handleSubmission(message: Inbound, deps: AppDeps) {
  const { store, channel, config } = deps
  const images: IntakeImage[] = []
  for (const media of message.media) {
    if (!IMAGE_TYPES.includes(media.mimeType)) continue
    const file = await channel.download(media.id)
    images.push({ mediaType: media.mimeType as IntakeImage['mediaType'], data: file.data.toString('base64') })
  }
  if (!message.text.trim() && !images.length) {
    await channel.send(message.from, { kind: 'text', text: 'Forward the owner\'s offer as text or a photo, and I will prepare the listing.' })
    return
  }
  const { extracted } = await extractListing(deps.client, config.intakeModel, { text: message.text, images })
  const draft = buildDraft(extracted, deps.directory, normalizePhone(message.from))
  if (!draft.listing) {
    await channel.send(message.from, { kind: 'text', text: `I could not prepare this listing yet:\n- ${draft.problems.join('\n- ')}\nSend the offer again with the missing details.` })
    return
  }
  const existing = store.findActiveListing(draft.listing.phase, draft.listing.plot)
  if (existing) {
    await channel.send(message.from, { kind: 'text', text: `Plot ${existing.plot} in phase ${existing.phase} is already listed as ${existing.code} (${existing.status}).` })
    return
  }
  const listing = store.insertListing(draft.listing)
  store.log(normalizePhone(message.from), 'submitted', listing.code)
  await channel.send(message.from, { kind: 'text', text: `Listing ${listing.code} created and sent for approval.\n${summary(listing, config.currency)}` })
  await requestApproval(listing, deps)
}

async function handleOwnerCommand(message: Inbound, deps: AppDeps): Promise<boolean> {
  const { store, channel, config } = deps
  const owner = normalizePhone(message.from)
  const text = message.text.trim()

  const [action, code] = (message.buttonId ?? '').split(':')
  if (action && code) {
    const listing = store.getListing(code)
    if (!listing) {
      await channel.send(owner, { kind: 'text', text: `Listing ${code} was not found.` })
      return true
    }
    if (action === 'publish') return publish(listing, owner, deps).then(() => true)
    if (action === 'ignore') {
      store.updateListing(code, { status: 'ignored' })
      store.log(owner, 'ignored', code)
      await channel.send(owner, { kind: 'text', text: `${code} ignored.` })
      return true
    }
    if (action === 'price') {
      store.setState(`pending:${owner}`, `price:${code}`)
      await channel.send(owner, { kind: 'text', text: `Send the new price for ${code}, for example 265000.` })
      return true
    }
    if (action === 'send') return broadcast(listing, owner, deps).then(() => true)
    if (action === 'skip') {
      await channel.send(owner, { kind: 'text', text: `No broadcast sent for ${code}.` })
      return true
    }
  }

  const pending = store.getState(`pending:${owner}`)
  if (pending?.startsWith('price:')) {
    const amount = parseAmount(text)
    if (amount) {
      const code = pending.slice('price:'.length)
      store.setState(`pending:${owner}`, null)
      const before = store.getListing(code)
      const listing = store.updateListing(code, { price: amount })
      store.log(owner, 'price_changed', code, `${before?.price} to ${amount}`)
      if (listing.status === 'published') await publish(listing, owner, deps)
      else await requestApproval(listing, deps)
      return true
    }
  }

  const spent = text.match(/^spend\s+(L-\d+)\s+([a-z]+)\s+(\d+(?:\.\d+)?)$/i)
  if (spent) {
    const listing = store.getListing(spent[1])
    const spendChannel = CHANNEL_ALIASES[spent[2].toLowerCase()]
    if (!spendChannel) {
      await channelSend(deps, owner, `Unknown channel ${spent[2]}. Use ${Object.keys(CHANNEL_ALIASES).filter(k => k.length > 3).join(', ')}.`)
      return true
    }
    if (!listing) {
      await channelSend(deps, owner, `Listing ${spent[1].toUpperCase()} was not found.`)
      return true
    }
    store.addSpend({ listingCode: listing.code, channel: spendChannel, amount: Number(spent[3]), note: 'entered by owner' })
    store.log(owner, 'spend', listing.code, `${spendChannel} ${spent[3]}`)
    await channelSend(deps, owner, `Recorded ${Number(spent[3]).toFixed(2)} ${config.spendCurrency} on ${spendChannel} for ${listing.code}.`)
    return true
  }

  if (/^report$/i.test(text)) {
    const now = store.now()
    const report = buildReport(store, new Date(now.getTime() - 30 * 24 * 3600 * 1000), now)
    await channelSend(deps, owner, formatReport(report, config.spendCurrency))
    return true
  }

  const sold = text.match(/^sold\s+(L-\d+)$/i)
  if (sold) {
    const listing = store.getListing(sold[1])
    if (!listing) {
      await channel.send(owner, { kind: 'text', text: `Listing ${sold[1].toUpperCase()} was not found.` })
      return true
    }
    store.updateListing(listing.code, { status: 'sold' })
    store.log(owner, 'sold', listing.code)
    await channel.send(owner, { kind: 'text', text: `${listing.code} marked as sold. The assistant will stop offering it.` })
    return true
  }

  if (/^help$/i.test(text)) {
    await channel.send(owner, { kind: 'text', text: 'Forward an owner\'s offer to create a listing. Use the buttons to publish, edit the price or ignore it. Send "sold L-0001" when a plot is sold, "spend L-0001 instagram 25" to record ad spend, and "report" for the last 30 days.' })
    return true
  }
  return false
}

function channelSend(deps: AppDeps, to: string, text: string) {
  return deps.channel.send(to, { kind: 'text', text })
}

export async function sendMonthlyReport(deps: AppDeps, now = deps.store.now()) {
  const { from, to } = previousMonth(now)
  const text = formatReport(buildReport(deps.store, from, to), deps.config.spendCurrency)
  for (const owner of deps.config.ownerPhones) await channelSend(deps, owner, text)
  return text
}

export function parseAmount(text: string): number | null {
  const match = text.replace(/,/g, '').match(/^\s*(\d+(?:\.\d+)?)\s*(k|thousand)?\s*$/i)
  if (!match) return null
  const value = Number(match[1]) * (match[2] ? 1000 : 1)
  return value >= 1000 ? value : null
}

async function publish(listing: Listing, owner: string, deps: AppDeps) {
  const { store, channel, config } = deps
  const current = store.updateListing(listing.code, { status: 'published' })
  const images = renderAllAds(current, deps.directory, brand(config))
  const captionFor = (tag: string) => caption(current, config.currency, config.contactLine, config.whatsappNumber, tag)
  const results: string[] = []
  for (const publisher of deps.publishers) {
    try {
      const ref = await publisher.publish(current, images, captionFor)
      store.log(owner, 'published', current.code, `${publisher.name} ${ref}`)
      results.push(`${publisher.name}: done`)
    } catch (err) {
      store.log(owner, 'publish_failed', current.code, `${publisher.name} ${(err as Error).message}`)
      results.push(`${publisher.name}: failed (${(err as Error).message})`)
    }
  }
  const audience = store.segment(current)
  const lines = [`${current.code} is published.`, ...results]
  if (!audience.length) {
    await channel.send(owner, { kind: 'text', text: [...lines, 'No opted-in customers match this plot yet.'].join('\n') })
    return
  }
  const cost = audience.length * config.messageCost
  await channel.send(owner, {
    kind: 'buttons',
    text: [...lines, `${audience.length} opted-in ${audience.length === 1 ? 'customer matches' : 'customers match'} its price and phase. Sending costs about ${cost.toFixed(2)} USD.`].join('\n'),
    buttons: [
      { id: `send:${current.code}`, title: `Send to ${audience.length}` },
      { id: `skip:${current.code}`, title: 'Skip' }
    ]
  })
}

async function broadcast(listing: Listing, owner: string, deps: AppDeps) {
  const { store, channel, config } = deps
  if (listing.status !== 'published') {
    await channel.send(owner, { kind: 'text', text: `${listing.code} is not published, so it was not sent.` })
    return
  }
  const png = renderAdPng(listing, deps.directory, brand(config), 'square')
  const audience = store.segment(listing)
  let sent = 0
  for (const contact of audience) {
    try {
      await channel.send(contact.phone, {
        kind: 'template',
        name: config.listingTemplate,
        png,
        params: [listing.plot, listing.phase, `${listing.areaM2} m²`, formatPrice(listing.price, config.currency), listing.code]
      })
      store.updateContact(contact.phone, { shown: [...new Set([...contact.shown, listing.code])], lastCampaign: `broadcast:${listing.code}` })
      sent++
    } catch (err) {
      store.log('system', 'broadcast_failed', listing.code, `${contact.phone} ${(err as Error).message}`)
    }
  }
  store.log(owner, 'broadcast', listing.code, `${sent} of ${audience.length}`)
  if (sent) store.addSpend({ listingCode: listing.code, channel: 'broadcast', amount: sent * config.messageCost, note: `${sent} messages` })
  await channel.send(owner, { kind: 'text', text: `${listing.code} sent to ${sent} of ${audience.length} customers.` })
}

async function handleBuyer(message: Inbound, deps: AppDeps) {
  const { store, channel, config } = deps
  const phone = normalizePhone(message.from)
  const word = message.text.trim().toLowerCase()
  const referral = parseReferral(message.text)
  const contact = store.contact(phone)
  const at = store.now().toISOString()
  const firstTouch = contact.source
    ? {}
    : (() => {
        const campaign = campaignSource(contact.lastCampaign)
        return {
          source: referral.source ?? campaign?.source ?? 'direct',
          sourceListing: referral.code ?? campaign?.listing ?? null,
          firstSeenAt: at
        }
      })()
  store.updateContact(phone, { lastInboundAt: at, followUps: 0, ...firstTouch })

  if (STOP_WORDS.includes(word)) {
    store.updateContact(phone, { optedOut: true, optedIn: false })
    store.log(phone, 'opted_out')
    await channel.send(phone, { kind: 'text', text: 'You will not receive new offers from us. Send START to subscribe again.' })
    return
  }
  if (START_WORDS.includes(word)) {
    store.updateContact(phone, { optedOut: false, optedIn: true })
    store.log(phone, 'opted_in')
    await channel.send(phone, { kind: 'text', text: 'You are subscribed to new offers that match what you are looking for. Send STOP at any time.' })
    return
  }
  if (!message.text.trim()) {
    await channel.send(phone, { kind: 'text', text: 'Hi! Tell me what kind of plot you are looking for and your budget.' })
    return
  }

  const result = await runBuyerAgent(phone, referral.text, {
    client: deps.client,
    model: config.agentModel,
    store,
    companyName: config.companyName,
    districtName: deps.directory.name.replace(/\s*\(sample\)$/, ''),
    phases: deps.directory.phases(),
    currency: config.currency
  })
  for (const code of result.ads) {
    const listing = store.getListing(code)
    if (!listing) continue
    await channel.send(phone, { kind: 'image', png: renderAdPng(listing, deps.directory, brand(config), 'square'), caption: summary(listing, config.currency) })
  }
  await channel.send(phone, { kind: 'text', text: result.reply })
  if (result.lead) await notifyLead(result.lead, deps)
}

export async function notifyLead(lead: Lead, deps: AppDeps) {
  const listing = lead.listingCode ? deps.store.getListing(lead.listingCode) : null
  const text = [
    'Serious buyer, please call them',
    listing ? summary(listing, deps.config.currency) : 'No specific plot yet',
    `Budget: ${lead.budget || 'not given'}`,
    `Timeline: ${lead.timeline || 'not given'}`,
    lead.summary,
    `Customer: +${lead.phone}`
  ].join('\n')
  for (const owner of deps.config.ownerPhones) await deps.channel.send(owner, { kind: 'text', text })
}
