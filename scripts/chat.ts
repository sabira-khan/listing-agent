import Anthropic from '@anthropic-ai/sdk'
import { createInterface } from 'node:readline/promises'
import { handleInbound } from '../src/app'
import { ConsoleChannel } from '../src/channel'
import { loadConfig } from '../src/config'
import { GeoJsonDistrict } from '../src/district'
import { seedStore } from '../src/seed'
import { Store } from '../src/store'

const config = { ...loadConfig(), ownerPhones: ['10000000001'], staffPhones: [] }
const store = new Store()
const directory = GeoJsonDistrict.fromFile(config.districtPath)
seedStore(store, directory)
const deps = { config, store, directory, client: new Anthropic(), channel: new ConsoleChannel(), publishers: [] }
const phone = process.argv.includes('--owner') ? config.ownerPhones[0] : '15550999'
let turn = 0
const say = (text: string) => handleInbound({ from: phone, id: String(turn++), text, buttonId: text.startsWith('#') ? text.slice(1) : null, media: [] }, deps)

const scripted = process.argv.slice(2).filter(a => a !== '--owner')
if (scripted.length) {
  for (const text of scripted) {
    console.log(`\n> ${text}`)
    await say(text)
  }
} else {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  console.log(`Chatting as ${phone === config.ownerPhones[0] ? 'the owner' : 'a buyer'} with seeded sample listings. Ctrl+C to quit.`)
  while (true) await say(await rl.question('\n> '))
}
