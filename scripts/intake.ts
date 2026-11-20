import Anthropic from '@anthropic-ai/sdk'
import { readFileSync } from 'node:fs'
import { extname } from 'node:path'
import { loadConfig } from '../src/config'
import { GeoJsonDistrict } from '../src/district'
import { buildDraft, extractListing, type IntakeImage } from '../src/intake'

const config = loadConfig()
const args = process.argv.slice(2)
const files = args.filter(a => /\.(png|jpe?g|webp)$/i.test(a))
const text = args.filter(a => !files.includes(a)).join(' ')
const types: Record<string, IntakeImage['mediaType']> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }
const images = files.map(f => ({ mediaType: types[extname(f).toLowerCase()], data: readFileSync(f).toString('base64') }))
if (!text && !images.length) {
  console.log('Usage: npm run intake -- "owner message" [photo.jpg ...]')
  process.exit(1)
}
const { extracted, usage } = await extractListing(new Anthropic(), config.intakeModel, { text, images })
const draft = buildDraft(extracted, GeoJsonDistrict.fromFile(config.districtPath), 'cli')
console.log(JSON.stringify({ extracted, draft, usage }, null, 2))
