import type { Store } from './store'

export interface ReportRow {
  key: string
  label: string
  enquiries: number
  leads: number
  spend: number
  costPerLead: number | null
}

export interface Report {
  from: string
  to: string
  enquiries: number
  leads: number
  spend: number
  costPerLead: number | null
  sold: string[]
  published: string[]
  sources: ReportRow[]
  listings: ReportRow[]
}

function row(key: string, label: string, enquiries: number, leads: number, spend: number): ReportRow {
  return { key, label, enquiries, leads, spend: Math.round(spend * 100) / 100, costPerLead: leads ? Math.round((spend / leads) * 100) / 100 : null }
}

export function buildReport(store: Store, from: Date, to: Date): Report {
  const [f, t] = [from.toISOString(), to.toISOString()]
  const inRange = (at: string | null) => Boolean(at && at >= f && at < t)
  const contacts = store.contacts().filter(c => inRange(c.firstSeenAt))
  const leads = store.leads().filter(l => inRange(l.createdAt))
  const spend = store.spend(f, t)
  const events = store.events(100000).filter(e => inRange(e.at))

  const sourceKeys = [...new Set([...contacts.map(c => c.source ?? 'direct'), ...leads.map(l => l.source), ...spend.map(s => s.channel)])]
  const sources = sourceKeys.map(key => row(
    key, key,
    contacts.filter(c => (c.source ?? 'direct') === key).length,
    leads.filter(l => l.source === key).length,
    spend.filter(s => s.channel === key).reduce((sum, s) => sum + s.amount, 0)
  )).sort((a, b) => b.leads - a.leads || b.enquiries - a.enquiries)

  const codes = [...new Set([...contacts.map(c => c.sourceListing), ...leads.map(l => l.listingCode), ...spend.map(s => s.listingCode)].filter((c): c is string => Boolean(c)))]
  const listings = codes.map(code => {
    const listing = store.getListing(code)
    return row(
      code, listing ? `${code} plot ${listing.plot}` : code,
      contacts.filter(c => c.sourceListing === code).length,
      leads.filter(l => l.listingCode === code).length,
      spend.filter(s => s.listingCode === code).reduce((sum, s) => sum + s.amount, 0)
    )
  }).sort((a, b) => b.leads - a.leads || b.enquiries - a.enquiries)

  const total = spend.reduce((sum, s) => sum + s.amount, 0)
  return {
    from: f,
    to: t,
    enquiries: contacts.length,
    leads: leads.length,
    spend: Math.round(total * 100) / 100,
    costPerLead: leads.length ? Math.round((total / leads.length) * 100) / 100 : null,
    sold: [...new Set(events.filter(e => e.action === 'sold' && e.listingCode).map(e => e.listingCode!))],
    published: [...new Set(events.filter(e => e.action === 'published' && e.listingCode).map(e => e.listingCode!))],
    sources,
    listings
  }
}

export function previousMonth(now: Date): { from: Date; to: Date } {
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
  return { from, to }
}

function day(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

export function formatReport(report: Report, currency: string): string {
  const money = (n: number) => `${n.toFixed(2)} ${currency}`
  const perLead = (r: { costPerLead: number | null }) => (r.costPerLead === null ? 'no leads' : `${money(r.costPerLead)} per lead`)
  const last = new Date(new Date(report.to).getTime() - 1).toISOString()
  const lines = [
    `Report ${day(report.from)} to ${day(last)}`,
    `${report.enquiries} enquiries, ${report.leads} leads, ${money(report.spend)} spent, ${perLead(report)}`,
    `Published: ${report.published.length ? report.published.join(', ') : 'none'}. Sold: ${report.sold.length ? report.sold.join(', ') : 'none'}.`
  ]
  if (report.sources.length) {
    lines.push('', 'By source')
    for (const r of report.sources) lines.push(`${r.label}: ${r.enquiries} enquiries, ${r.leads} leads, ${money(r.spend)}, ${perLead(r)}`)
  }
  if (report.listings.length) {
    lines.push('', 'Top plots')
    for (const r of report.listings.slice(0, 5)) lines.push(`${r.label}: ${r.enquiries} enquiries, ${r.leads} leads, ${money(r.spend)}`)
  }
  return lines.join('\n')
}
