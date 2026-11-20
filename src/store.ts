import { DatabaseSync } from 'node:sqlite'
import type { AuditEvent, Contact, Lead, Listing, ListingStatus, NewListing, SpendEntry } from './types'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS listings (
  code TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  phase TEXT NOT NULL,
  plot TEXT NOT NULL,
  areaM2 REAL NOT NULL,
  frontageM REAL NOT NULL,
  depthM REAL NOT NULL,
  corner INTEGER NOT NULL,
  waterfront INTEGER NOT NULL,
  price REAL NOT NULL,
  ownerName TEXT,
  ownerPhone TEXT,
  notes TEXT,
  submittedBy TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS contacts (
  phone TEXT PRIMARY KEY,
  name TEXT,
  budgetMin REAL,
  budgetMax REAL,
  phases TEXT NOT NULL DEFAULT '[]',
  timeline TEXT,
  optedIn INTEGER NOT NULL DEFAULT 0,
  optedOut INTEGER NOT NULL DEFAULT 0,
  lastInboundAt TEXT,
  lastFollowUpAt TEXT,
  followUps INTEGER NOT NULL DEFAULT 0,
  handedOffAt TEXT,
  shown TEXT NOT NULL DEFAULT '[]',
  source TEXT,
  sourceListing TEXT,
  firstSeenAt TEXT,
  lastCampaign TEXT
);
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT NOT NULL,
  listingCode TEXT,
  budget TEXT,
  timeline TEXT,
  summary TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'direct',
  createdAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS spend (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  listingCode TEXT,
  channel TEXT NOT NULL,
  amount REAL NOT NULL,
  note TEXT
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  listingCode TEXT,
  detail TEXT
);
CREATE TABLE IF NOT EXISTS conversations (
  phone TEXT PRIMARY KEY,
  messages TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`

export interface ListingSearch {
  phase?: string
  minPrice?: number
  maxPrice?: number
  minArea?: number
  waterfront?: boolean
  corner?: boolean
}

type Row = Record<string, unknown>

export class Store {
  private readonly db: DatabaseSync
  now: () => Date = () => new Date()

  constructor(path = ':memory:') {
    this.db = new DatabaseSync(path)
    this.db.exec(SCHEMA)
    this.addMissingColumns('contacts', { source: 'TEXT', sourceListing: 'TEXT', firstSeenAt: 'TEXT', lastCampaign: 'TEXT' })
    this.addMissingColumns('leads', { source: "TEXT NOT NULL DEFAULT 'direct'" })
  }

  private addMissingColumns(table: string, columns: Record<string, string>) {
    const existing = new Set((this.db.prepare(`PRAGMA table_info(${table})`).all() as Row[]).map(r => String(r.name)))
    for (const [name, type] of Object.entries(columns)) {
      if (!existing.has(name)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`)
    }
  }

  close() {
    this.db.close()
  }

  private stamp() {
    return this.now().toISOString()
  }

  nextCode(): string {
    const current = Number(this.getState('listingSequence') ?? '0') + 1
    this.setState('listingSequence', String(current))
    return `L-${String(current).padStart(4, '0')}`
  }

  insertListing(input: NewListing): Listing {
    const at = this.stamp()
    const listing: Listing = { ...input, status: input.status ?? 'pending', code: this.nextCode(), createdAt: at, updatedAt: at }
    this.db.prepare(`INSERT INTO listings (code, status, phase, plot, areaM2, frontageM, depthM, corner, waterfront, price, ownerName, ownerPhone, notes, submittedBy, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      listing.code, listing.status, listing.phase, listing.plot, listing.areaM2, listing.frontageM, listing.depthM,
      Number(listing.corner), Number(listing.waterfront), listing.price, listing.ownerName, listing.ownerPhone,
      listing.notes, listing.submittedBy, listing.createdAt, listing.updatedAt
    )
    return listing
  }

  getListing(code: string): Listing | null {
    const row = this.db.prepare('SELECT * FROM listings WHERE code = ?').get(code.toUpperCase())
    return row ? toListing(row) : null
  }

  findActiveListing(phase: string, plot: string): Listing | null {
    const row = this.db.prepare(`SELECT * FROM listings WHERE phase = ? AND plot = ? AND status IN ('pending', 'published') ORDER BY createdAt DESC LIMIT 1`).get(phase, plot)
    return row ? toListing(row) : null
  }

  updateListing(code: string, patch: Partial<Pick<Listing, 'status' | 'price' | 'notes'>>): Listing {
    const current = this.getListing(code)
    if (!current) throw new Error(`Unknown listing ${code}`)
    const next = { ...current, ...patch, updatedAt: this.stamp() }
    this.db.prepare('UPDATE listings SET status = ?, price = ?, notes = ?, updatedAt = ? WHERE code = ?').run(next.status, next.price, next.notes, next.updatedAt, next.code)
    return next
  }

  listListings(status?: ListingStatus): Listing[] {
    const rows = status
      ? this.db.prepare('SELECT * FROM listings WHERE status = ? ORDER BY createdAt DESC, code DESC').all(status)
      : this.db.prepare('SELECT * FROM listings ORDER BY createdAt DESC, code DESC').all()
    return rows.map(toListing)
  }

  searchPublished(search: ListingSearch, limit = 5): Listing[] {
    return this.listListings('published')
      .filter(l => !search.phase || l.phase === search.phase.toUpperCase().replace(/\s+/g, ''))
      .filter(l => search.minPrice === undefined || l.price >= search.minPrice)
      .filter(l => search.maxPrice === undefined || l.price <= search.maxPrice)
      .filter(l => search.minArea === undefined || l.areaM2 >= search.minArea)
      .filter(l => search.waterfront === undefined || l.waterfront === search.waterfront)
      .filter(l => search.corner === undefined || l.corner === search.corner)
      .sort((a, b) => a.price - b.price)
      .slice(0, limit)
  }

  privateValues(): { names: string[]; phones: string[] } {
    const rows = this.db.prepare('SELECT ownerName, ownerPhone FROM listings').all() as Row[]
    return {
      names: rows.map(r => r.ownerName).filter((v): v is string => typeof v === 'string' && v.trim().length >= 4),
      phones: rows.map(r => r.ownerPhone).filter((v): v is string => typeof v === 'string' && v.replace(/\D/g, '').length >= 7)
    }
  }

  contact(phone: string): Contact {
    const row = this.db.prepare('SELECT * FROM contacts WHERE phone = ?').get(phone)
    if (row) return toContact(row)
    this.db.prepare('INSERT INTO contacts (phone) VALUES (?)').run(phone)
    return toContact(this.db.prepare('SELECT * FROM contacts WHERE phone = ?').get(phone)!)
  }

  updateContact(phone: string, patch: Partial<Omit<Contact, 'phone'>>): Contact {
    const next = { ...this.contact(phone), ...patch }
    this.db.prepare(`UPDATE contacts SET name = ?, budgetMin = ?, budgetMax = ?, phases = ?, timeline = ?, optedIn = ?, optedOut = ?,
      lastInboundAt = ?, lastFollowUpAt = ?, followUps = ?, handedOffAt = ?, shown = ?, source = ?, sourceListing = ?, firstSeenAt = ?, lastCampaign = ? WHERE phone = ?`).run(
      next.name, next.budgetMin, next.budgetMax, JSON.stringify(next.phases), next.timeline, Number(next.optedIn), Number(next.optedOut),
      next.lastInboundAt, next.lastFollowUpAt, next.followUps, next.handedOffAt, JSON.stringify(next.shown),
      next.source, next.sourceListing, next.firstSeenAt, next.lastCampaign, phone
    )
    return next
  }

  contacts(): Contact[] {
    return this.db.prepare('SELECT * FROM contacts ORDER BY phone').all().map(toContact)
  }

  segment(listing: Listing, tolerance = 0.1): Contact[] {
    return this.contacts().filter(c =>
      c.optedIn && !c.optedOut &&
      (c.budgetMax === null || listing.price <= c.budgetMax * (1 + tolerance)) &&
      (c.budgetMin === null || listing.price >= c.budgetMin * (1 - tolerance)) &&
      (!c.phases.length || c.phases.includes(listing.phase))
    )
  }

  addLead(lead: Omit<Lead, 'id' | 'createdAt'>): Lead {
    const createdAt = this.stamp()
    const result = this.db.prepare('INSERT INTO leads (phone, listingCode, budget, timeline, summary, source, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(lead.phone, lead.listingCode, lead.budget, lead.timeline, lead.summary, lead.source, createdAt)
    return { ...lead, id: Number(result.lastInsertRowid), createdAt }
  }

  leads(listingCode?: string): Lead[] {
    const rows = listingCode
      ? this.db.prepare('SELECT * FROM leads WHERE listingCode = ? ORDER BY id DESC').all(listingCode)
      : this.db.prepare('SELECT * FROM leads ORDER BY id DESC').all()
    return rows as unknown as Lead[]
  }

  log(actor: string, action: string, listingCode: string | null = null, detail: string | null = null) {
    this.db.prepare('INSERT INTO events (at, actor, action, listingCode, detail) VALUES (?, ?, ?, ?, ?)').run(this.stamp(), actor, action, listingCode, detail)
  }

  events(limit = 50): AuditEvent[] {
    return this.db.prepare('SELECT * FROM events ORDER BY id DESC LIMIT ?').all(limit) as unknown as AuditEvent[]
  }

  addSpend(spend: Omit<SpendEntry, 'id' | 'at'>): SpendEntry {
    const at = this.stamp()
    const result = this.db.prepare('INSERT INTO spend (at, listingCode, channel, amount, note) VALUES (?, ?, ?, ?, ?)').run(at, spend.listingCode, spend.channel, spend.amount, spend.note)
    return { ...spend, id: Number(result.lastInsertRowid), at }
  }

  spend(from?: string, to?: string): SpendEntry[] {
    return (this.db.prepare('SELECT * FROM spend WHERE at >= ? AND at < ? ORDER BY id').all(from ?? '', to ?? '9999') as Row[]).map(r => ({
      id: Number(r.id), at: String(r.at), listingCode: (r.listingCode as string | null) ?? null, channel: String(r.channel), amount: Number(r.amount), note: (r.note as string | null) ?? null
    }))
  }

  conversation<T>(phone: string): T[] {
    const row = this.db.prepare('SELECT messages FROM conversations WHERE phone = ?').get(phone) as Row | undefined
    return row ? JSON.parse(String(row.messages)) : []
  }

  saveConversation(phone: string, messages: unknown[]) {
    this.db.prepare('INSERT INTO conversations (phone, messages) VALUES (?, ?) ON CONFLICT(phone) DO UPDATE SET messages = excluded.messages').run(phone, JSON.stringify(messages))
  }

  getState(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM state WHERE key = ?').get(key) as Row | undefined
    return row ? String(row.value) : null
  }

  setState(key: string, value: string | null) {
    if (value === null) this.db.prepare('DELETE FROM state WHERE key = ?').run(key)
    else this.db.prepare('INSERT INTO state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
  }
}

function toListing(row: Row): Listing {
  return {
    code: String(row.code),
    status: row.status as ListingStatus,
    phase: String(row.phase),
    plot: String(row.plot),
    areaM2: Number(row.areaM2),
    frontageM: Number(row.frontageM),
    depthM: Number(row.depthM),
    corner: Boolean(row.corner),
    waterfront: Boolean(row.waterfront),
    price: Number(row.price),
    ownerName: (row.ownerName as string | null) ?? null,
    ownerPhone: (row.ownerPhone as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    submittedBy: String(row.submittedBy),
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt)
  }
}

function toContact(row: Row): Contact {
  return {
    phone: String(row.phone),
    name: (row.name as string | null) ?? null,
    budgetMin: row.budgetMin === null ? null : Number(row.budgetMin),
    budgetMax: row.budgetMax === null ? null : Number(row.budgetMax),
    phases: JSON.parse(String(row.phases)),
    timeline: (row.timeline as string | null) ?? null,
    optedIn: Boolean(row.optedIn),
    optedOut: Boolean(row.optedOut),
    lastInboundAt: (row.lastInboundAt as string | null) ?? null,
    lastFollowUpAt: (row.lastFollowUpAt as string | null) ?? null,
    followUps: Number(row.followUps),
    handedOffAt: (row.handedOffAt as string | null) ?? null,
    shown: JSON.parse(String(row.shown)),
    source: (row.source as string | null) ?? null,
    sourceListing: (row.sourceListing as string | null) ?? null,
    firstSeenAt: (row.firstSeenAt as string | null) ?? null,
    lastCampaign: (row.lastCampaign as string | null) ?? null
  }
}
