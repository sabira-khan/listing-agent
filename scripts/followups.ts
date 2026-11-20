import { brand } from '../src/app'
import { loadConfig } from '../src/config'
import { GeoJsonDistrict } from '../src/district'
import { planFollowUps, runFollowUps } from '../src/followups'
import { Store } from '../src/store'
import { WhatsAppCloud } from '../src/whatsapp'

const config = loadConfig()
const store = new Store(config.dbPath)
if (!process.argv.includes('--send')) {
  const plan = planFollowUps(store)
  console.log(`Due: ${plan.first.length} first follow-ups, ${plan.second.length} with a similar listing. Run with --send to send them.`)
  process.exit(0)
}
const result = await runFollowUps({
  store,
  channel: new WhatsAppCloud({ ...config.whatsapp, language: config.templateLanguage }),
  directory: GeoJsonDistrict.fromFile(config.districtPath),
  brand: brand(config),
  followUpTemplate: config.followUpTemplate,
  listingTemplate: config.listingTemplate,
  messageCost: config.messageCost
})
console.log(`Sent ${result.first} first follow-ups and ${result.second} with a similar listing.`)
