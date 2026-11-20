import Anthropic from '@anthropic-ai/sdk'
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { escapeXml, svgToPng } from '../src/ad'
import { handleInbound } from '../src/app'
import { MemoryChannel, type Outgoing } from '../src/channel'
import { loadConfig } from '../src/config'
import { GeoJsonDistrict } from '../src/district'
import { seedStore } from '../src/seed'
import { Store } from '../src/store'

interface Bubble {
  phone: 'owner' | 'buyer'
  out: boolean
  text: string
  image?: Buffer
  buttons?: string[]
  step: string
}

const OWNER = '10000000001'
const BUYER = '15550888'
const config = { ...loadConfig(), ownerPhones: [OWNER], staffPhones: [], contactLine: 'WhatsApp +1 555 0100', whatsappNumber: '15550100' }
const store = new Store()
const directory = GeoJsonDistrict.fromFile(config.districtPath)
seedStore(store, directory)
const channel = new MemoryChannel()
const deps = { config, store, directory, client: new Anthropic(), channel, publishers: [] }
const bubbles: Bubble[] = []
let step = ''

function record(message: Outgoing, to: string) {
  const phone = to === OWNER ? 'owner' : to === BUYER ? 'buyer' : null
  if (!phone) return
  if (message.kind === 'text') bubbles.push({ phone, out: false, text: message.text, step })
  if (message.kind === 'image') bubbles.push({ phone, out: false, text: message.caption, image: message.png, step })
  if (message.kind === 'buttons') bubbles.push({ phone, out: false, text: message.text, image: message.png, buttons: message.buttons.map(b => b.title), step })
}

const send = channel.send.bind(channel)
channel.send = async (to, message) => {
  record(message, to)
  return send(to, message)
}

async function say(phone: 'owner' | 'buyer', text: string, label: string, buttonId: string | null = null) {
  step = label
  bubbles.push({ phone, out: true, text, step })
  await handleInbound({ from: phone === 'owner' ? OWNER : BUYER, id: String(bubbles.length), text, buttonId, media: [] }, deps)
}

await say('owner', 'Owner Walid wants to sell plot 2561, asking 210k. His number is 555-0150', '1. Staff forward an owner\'s offer. Claude extracts it and the ad is generated from the plot map')
await say('owner', 'Publish', '2. The owner approves on WhatsApp and the ad is published', 'publish:L-0015')
await say('buyer', "Hi, I'm interested in L-0015 [ig]", '3. A buyer taps the link in the Instagram ad. The source is recorded')
await say('buyer', 'How big is the frontage? And can the owner do 190k?', '4. The assistant answers from the listing and never negotiates')
await say('buyer', 'My budget is up to 215k and I want to buy this month. Can I see it on Saturday?', '5. Once budget and timeline are known, the buyer is handed to a person')

const W = 1000
const H = 860
const PHONE = { w: 400, h: 720, y: 30 }
const CHAT_TOP = 70
const FONT = 'Helvetica Neue, Helvetica, Arial, sans-serif'

function wrap(text: string, max = 40): string[] {
  const lines: string[] = []
  for (const para of text.replace(/\*/g, '').split('\n')) {
    let line = ''
    for (const word of para.split(/\s+/)) {
      if ((line + ' ' + word).trim().length > max) {
        if (line) lines.push(line)
        line = word
      } else line = (line + ' ' + word).trim()
    }
    lines.push(line)
  }
  return lines
}

function bubbleSvg(b: Bubble, y: number): { svg: string; height: number } {
  const maxW = 300
  const lines = wrap(b.text)
  const imgH = b.image ? 270 : 0
  const textH = lines.length * 19 + 16
  const buttonsH = (b.buttons?.length ?? 0) * 34
  const width = b.image ? maxW : Math.min(maxW, Math.max(...lines.map(l => l.length)) * 7.3 + 24)
  const height = imgH + textH + buttonsH
  const x = b.out ? PHONE.w - 14 - width : 14
  const fill = b.out ? '#d9fdd3' : '#ffffff'
  const image = b.image ? `<image x="${x + 6}" y="${y + 6}" width="${width - 12}" height="${imgH - 12}" href="data:image/png;base64,${b.image.toString('base64')}"/>` : ''
  const text = lines.map((l, i) => `<text x="${x + 12}" y="${y + imgH + 22 + i * 19}" font-size="14" fill="#111b21">${escapeXml(l)}</text>`).join('')
  const buttons = (b.buttons ?? []).map((t, i) => {
    const by = y + imgH + textH + i * 34
    return `<line x1="${x}" y1="${by}" x2="${x + width}" y2="${by}" stroke="#e3e3e3"/><text x="${x + width / 2}" y="${by + 22}" font-size="14" font-weight="600" fill="#027eb5" text-anchor="middle">${escapeXml(t)}</text>`
  }).join('')
  return { svg: `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="10" fill="${fill}"/>${image}${text}${buttons}`, height }
}

function phoneSvg(kind: 'owner' | 'buyer', visible: Bubble[], x: number): string {
  const chatH = PHONE.h - CHAT_TOP - 14
  const parts: string[] = []
  let y = 10
  for (const b of visible.filter(v => v.phone === kind)) {
    const { svg, height } = bubbleSvg(b, y)
    parts.push(svg)
    y += height + 10
  }
  const offset = Math.min(0, chatH - y)
  const title = kind === 'owner' ? 'Office owner' : 'Buyer'
  const subtitle = kind === 'owner' ? 'Listing Agent' : 'Harbor Point Realty'
  return `<g transform="translate(${x} ${PHONE.y})">
<rect width="${PHONE.w}" height="${PHONE.h}" rx="34" fill="#111"/>
<rect x="8" y="8" width="${PHONE.w - 16}" height="${PHONE.h - 16}" rx="28" fill="#efeae2"/>
<path d="M8 36a28 28 0 0 1 28-28h${PHONE.w - 72}a28 28 0 0 1 28 28v${CHAT_TOP - 36}H8Z" fill="#075e54"/>
<text x="30" y="40" font-size="17" font-weight="700" fill="#fff">${subtitle}</text>
<text x="30" y="60" font-size="13" fill="#cfe9e4">${title}'s WhatsApp</text>
<clipPath id="clip-${kind}"><rect x="8" y="${CHAT_TOP}" width="${PHONE.w - 16}" height="${chatH}"/></clipPath>
<g clip-path="url(#clip-${kind})"><g transform="translate(0 ${CHAT_TOP + offset})">${parts.join('')}</g></g>
</g>`
}

function frame(visible: Bubble[], caption: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="${FONT}">
<rect width="${W}" height="${H}" fill="#f6f7f9"/>
${phoneSvg('owner', visible, 70)}
${phoneSvg('buyer', visible, W - 70 - PHONE.w)}
<text x="${W / 2}" y="${H - 50}" font-size="21" font-weight="700" fill="#10213a" text-anchor="middle">${escapeXml(caption)}</text>
</svg>`
}

const dir = join('out', 'demo-frames')
rmSync(dir, { recursive: true, force: true })
mkdirSync(dir, { recursive: true })
const list: string[] = []
bubbles.forEach((b, i) => {
  const file = `frame-${String(i).padStart(3, '0')}.png`
  writeFileSync(join(dir, file), svgToPng(frame(bubbles.slice(0, i + 1), b.step)))
  const hold = b.out ? 1.4 : b.image ? 3 : Math.min(4.5, 1.8 + b.text.length / 90)
  list.push(`file '${file}'`, `duration ${i === bubbles.length - 1 ? 6 : hold}`)
})
list.push(`file '${`frame-${String(bubbles.length - 1).padStart(3, '0')}.png`}'`)
writeFileSync(join(dir, 'frames.txt'), list.join('\n'))
writeFileSync(join('out', 'demo-transcript.json'), JSON.stringify(bubbles.map(({ image, ...b }) => ({ ...b, image: Boolean(image) })), null, 2))
mkdirSync('docs', { recursive: true })
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', join(dir, 'frames.txt'),
  '-vf', 'fps=10,scale=800:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=4',
  '-loop', '0', join('docs', 'demo.gif')])
console.log(`docs/demo.gif from ${bubbles.length} messages`)
