export type ListingStatus = 'pending' | 'published' | 'ignored' | 'sold'

export interface Listing {
  code: string
  status: ListingStatus
  phase: string
  plot: string
  areaM2: number
  frontageM: number
  depthM: number
  corner: boolean
  waterfront: boolean
  price: number
  ownerName: string | null
  ownerPhone: string | null
  notes: string | null
  submittedBy: string
  createdAt: string
  updatedAt: string
}

export type NewListing = Omit<Listing, 'code' | 'status' | 'createdAt' | 'updatedAt'> & { status?: ListingStatus }

export interface PublicListing {
  code: string
  phase: string
  plot: string
  areaM2: number
  frontageM: number
  depthM: number
  corner: boolean
  waterfront: boolean
  price: number
  available: boolean
}

export function publicView(listing: Listing): PublicListing {
  return {
    code: listing.code,
    phase: listing.phase,
    plot: listing.plot,
    areaM2: listing.areaM2,
    frontageM: listing.frontageM,
    depthM: listing.depthM,
    corner: listing.corner,
    waterfront: listing.waterfront,
    price: listing.price,
    available: listing.status === 'published'
  }
}

export interface Contact {
  phone: string
  name: string | null
  budgetMin: number | null
  budgetMax: number | null
  phases: string[]
  timeline: string | null
  optedIn: boolean
  optedOut: boolean
  lastInboundAt: string | null
  lastFollowUpAt: string | null
  followUps: number
  handedOffAt: string | null
  shown: string[]
}

export interface Lead {
  id: number
  phone: string
  listingCode: string | null
  budget: string | null
  timeline: string | null
  summary: string
  createdAt: string
}

export interface AuditEvent {
  id: number
  at: string
  actor: string
  action: string
  listingCode: string | null
  detail: string | null
}
