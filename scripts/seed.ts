import { existsSync, rmSync } from 'node:fs'
import { loadConfig } from '../src/config'
import { GeoJsonDistrict } from '../src/district'
import { seedStore } from '../src/seed'
import { Store } from '../src/store'

const config = loadConfig()
if (existsSync(config.dbPath)) {
  if (!process.argv.includes('--reset')) {
    console.log(`${config.dbPath} already exists. Run with --reset to replace it.`)
    process.exit(1)
  }
  rmSync(config.dbPath)
}
const store = new Store(config.dbPath)
seedStore(store, GeoJsonDistrict.fromFile(config.districtPath))
console.log(`Seeded ${store.listListings().length} listings and ${store.contacts().length} contacts into ${config.dbPath}`)
store.close()
