import { readFileSync } from 'node:fs'
import type { PlotDirectory } from './district'
import type { Store } from './store'
import type { ListingStatus } from './types'

interface SeedFile {
  listings: { plot: string; phase?: string; price: number; status: ListingStatus; ownerName: string | null; ownerPhone: string | null; notes: string | null }[]
  contacts: { phone: string; name: string | null; budgetMin: number | null; budgetMax: number | null; phases: string[]; timeline: string | null; optedIn: boolean }[]
}

export function loadSeed(path = 'data/sample-listings.json'): SeedFile {
  return JSON.parse(readFileSync(path, 'utf8'))
}

export function seedStore(store: Store, directory: PlotDirectory, seed: SeedFile = loadSeed()) {
  for (const item of seed.listings) {
    const plot = item.phase ? directory.find(item.phase, item.plot) : directory.findByNumber(item.plot)[0]
    if (!plot) throw new Error(`Seed plot ${item.plot} is not in ${directory.name}`)
    store.insertListing({
      phase: plot.phase,
      plot: plot.plot,
      areaM2: plot.areaM2,
      frontageM: plot.frontageM,
      depthM: plot.depthM,
      corner: plot.corner,
      waterfront: plot.waterfront,
      price: item.price,
      ownerName: item.ownerName,
      ownerPhone: item.ownerPhone,
      notes: item.notes,
      submittedBy: 'seed',
      status: item.status
    })
  }
  for (const c of seed.contacts) {
    store.contact(c.phone)
    store.updateContact(c.phone, { name: c.name, budgetMin: c.budgetMin, budgetMax: c.budgetMax, phases: c.phases, timeline: c.timeline, optedIn: c.optedIn })
  }
}
