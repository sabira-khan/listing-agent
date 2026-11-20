import { escapeXml as esc } from './ad'
import { formatPrice, type Config } from './config'
import type { Store } from './store'

export function renderDashboard(store: Store, config: Config): string {
  const listings = store.listListings()
  const leads = store.leads()
  const contacts = store.contacts()
  const events = store.events(30)
  const counts = (['pending', 'published', 'sold', 'ignored'] as const).map(s => ({ status: s, n: listings.filter(l => l.status === s).length }))
  const leadCount = (code: string) => leads.filter(l => l.listingCode === code).length

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(config.companyName)} listings</title>
<style>
:root{--ink:#10213a;--muted:#5b6b80;--line:#dde3ea;--bg:#f6f7f9;--card:#fff;--accent:#f0a830}
@media (prefers-color-scheme:dark){:root{--ink:#e8edf3;--muted:#9aa8b8;--line:#2a3442;--bg:#0f141b;--card:#161d27}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,sans-serif}
main{max-width:1100px;margin:0 auto;padding:24px 16px 48px}
h1{font-size:1.5rem;margin:0 0 16px}
h2{font-size:1.1rem;margin:28px 0 10px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px}
.stat{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px}
.stat b{display:block;font-size:1.6rem}
.scroll{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:10px}
table{width:100%;border-collapse:collapse;min-width:640px}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--muted);font-weight:600;font-size:.85rem}
tr:last-child td{border-bottom:0}
.pill{display:inline-block;padding:1px 8px;border-radius:99px;border:1px solid var(--line);font-size:.8rem}
.published{background:var(--accent);color:#10213a;border-color:transparent}
a{color:inherit}
</style>
</head>
<body>
<main>
<h1>${esc(config.companyName)}</h1>
<div class="stats">
${counts.map(c => `<div class="stat"><b>${c.n}</b>${c.status}</div>`).join('')}
<div class="stat"><b>${leads.length}</b>leads</div>
<div class="stat"><b>${contacts.filter(c => c.optedIn && !c.optedOut).length}</b>opted-in customers</div>
</div>
<h2>Listings</h2>
<div class="scroll"><table>
<tr><th>Ref</th><th>Status</th><th>Plot</th><th>Area</th><th>Price</th><th>Owner</th><th>Leads</th><th>Ad</th></tr>
${listings.map(l => `<tr><td>${esc(l.code)}</td><td><span class="pill ${l.status}">${l.status}</span></td><td>${esc(l.plot)} · ${esc(l.phase)}${l.waterfront ? ' · waterfront' : ''}${l.corner ? ' · corner' : ''}</td><td>${l.areaM2} m²</td><td>${esc(formatPrice(l.price, config.currency))}</td><td>${esc([l.ownerName, l.ownerPhone].filter(Boolean).join(', ') || '')}</td><td>${leadCount(l.code)}</td><td><a href="/admin/ad/${esc(l.code)}/square.png">view</a></td></tr>`).join('\n')}
</table></div>
<h2>Leads</h2>
<div class="scroll"><table>
<tr><th>When</th><th>Customer</th><th>Plot</th><th>Budget</th><th>Timeline</th><th>Summary</th></tr>
${leads.map(l => `<tr><td>${esc(l.createdAt.slice(0, 16).replace('T', ' '))}</td><td>+${esc(l.phone)}</td><td>${esc(l.listingCode ?? '')}</td><td>${esc(l.budget ?? '')}</td><td>${esc(l.timeline ?? '')}</td><td>${esc(l.summary)}</td></tr>`).join('\n')}
</table></div>
<h2>Activity</h2>
<div class="scroll"><table>
<tr><th>When</th><th>Who</th><th>Action</th><th>Ref</th><th>Detail</th></tr>
${events.map(e => `<tr><td>${esc(e.at.slice(0, 16).replace('T', ' '))}</td><td>${esc(e.actor)}</td><td>${esc(e.action)}</td><td>${esc(e.listingCode ?? '')}</td><td>${esc(e.detail ?? '')}</td></tr>`).join('\n')}
</table></div>
</main>
</body>
</html>`
}
