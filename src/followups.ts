import { renderAdPng, type Brand } from './ad'
import type { Channel } from './channel'
import { formatPrice } from './config'
import type { PlotDirectory } from './district'
import type { Store } from './store'
import type { Contact, Listing } from './types'

export interface FollowUpDeps {
  store: Store
  channel: Channel
  directory: PlotDirectory
  brand: Brand
  followUpTemplate: string
  listingTemplate: string
}

export interface FollowUpPlan {
  first: Contact[]
  second: { contact: Contact; listing: Listing }[]
}

const HOUR = 60 * 60 * 1000

function age(at: string | null, now: Date) {
  return at ? now.getTime() - new Date(at).getTime() : 0
}

export function similarListing(store: Store, contact: Contact): Listing | null {
  return store.listListings('published')
    .filter(l => !contact.shown.includes(l.code))
    .filter(l => contact.budgetMax === null || l.price <= contact.budgetMax * 1.1)
    .filter(l => contact.budgetMin === null || l.price >= contact.budgetMin * 0.9)
    .filter(l => !contact.phases.length || contact.phases.includes(l.phase))
    .sort((a, b) => a.price - b.price)[0] ?? null
}

export function planFollowUps(store: Store, now = store.now()): FollowUpPlan {
  const plan: FollowUpPlan = { first: [], second: [] }
  for (const contact of store.contacts()) {
    if (contact.optedOut || contact.handedOffAt || !contact.lastInboundAt) continue
    if (contact.followUps === 0 && age(contact.lastInboundAt, now) >= 48 * HOUR) plan.first.push(contact)
    else if (contact.followUps === 1 && age(contact.lastInboundAt, now) >= 7 * 24 * HOUR && contact.optedIn) {
      const listing = similarListing(store, contact)
      if (listing) plan.second.push({ contact, listing })
    }
  }
  return plan
}

export async function runFollowUps(deps: FollowUpDeps, now = deps.store.now()) {
  const { store, channel } = deps
  const plan = planFollowUps(store, now)
  for (const contact of plan.first) {
    await channel.send(contact.phone, { kind: 'template', name: deps.followUpTemplate, params: [contact.name ?? 'there'] })
    store.updateContact(contact.phone, { followUps: 1, lastFollowUpAt: now.toISOString() })
    store.log('system', 'follow_up', null, contact.phone)
  }
  for (const { contact, listing } of plan.second) {
    await channel.send(contact.phone, {
      kind: 'template',
      name: deps.listingTemplate,
      png: renderAdPng(listing, deps.directory, deps.brand, 'square'),
      params: [listing.plot, listing.phase, `${listing.areaM2} m²`, formatPrice(listing.price, deps.brand.currency), listing.code]
    })
    store.updateContact(contact.phone, { followUps: 2, lastFollowUpAt: now.toISOString(), shown: [...contact.shown, listing.code] })
    store.log('system', 'follow_up_listing', listing.code, contact.phone)
  }
  return { first: plan.first.length, second: plan.second.length }
}
