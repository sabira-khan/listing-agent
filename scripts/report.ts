import { loadConfig } from '../src/config'
import { buildReport, formatReport, previousMonth } from '../src/report'
import { Store } from '../src/store'
import { WhatsAppCloud } from '../src/whatsapp'

const config = loadConfig()
const store = new Store(config.dbPath)
const days = Number(process.argv.find(a => a.startsWith('--days='))?.slice('--days='.length))
const now = new Date()
const range = days ? { from: new Date(now.getTime() - days * 24 * 3600 * 1000), to: now } : previousMonth(now)
const text = formatReport(buildReport(store, range.from, range.to), config.spendCurrency)
console.log(text)
if (process.argv.includes('--send')) {
  const channel = new WhatsAppCloud({ ...config.whatsapp, language: config.templateLanguage })
  for (const owner of config.ownerPhones) await channel.send(owner, { kind: 'text', text })
  console.log(`\nSent to ${config.ownerPhones.length} owners.`)
}
