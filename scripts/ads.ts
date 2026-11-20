import { mkdirSync, writeFileSync } from 'node:fs'
import { renderAllAds } from '../src/ad'
import { brand } from '../src/app'
import { loadConfig } from '../src/config'
import { GeoJsonDistrict } from '../src/district'
import { Store } from '../src/store'

const config = loadConfig()
const store = new Store(config.dbPath)
const directory = GeoJsonDistrict.fromFile(config.districtPath)
const codes = process.argv.slice(2)
const listings = codes.length ? codes.map(c => store.getListing(c)).filter(l => l !== null) : store.listListings()
mkdirSync('out', { recursive: true })
for (const listing of listings) {
  for (const [size, png] of Object.entries(renderAllAds(listing, directory, brand(config)))) {
    writeFileSync(`out/${listing.code}-${size}.png`, png)
  }
}
console.log(`Rendered ${listings.length * 3} ads into out/`)
