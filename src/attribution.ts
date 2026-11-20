export const SOURCE_TAGS: Record<string, string> = {
  ig: 'instagram',
  fb: 'facebook',
  tt: 'tiktok',
  web: 'website'
}

export const CHANNEL_ALIASES: Record<string, string> = {
  ...SOURCE_TAGS,
  instagram: 'instagram',
  facebook: 'facebook',
  tiktok: 'tiktok',
  website: 'website',
  google: 'google',
  whatsapp: 'whatsapp'
}

export interface Referral {
  code: string | null
  source: string | null
  text: string
}

const TAGGED = /\b(L-\d{4,})\b\s*\[(ig|fb|tt|web)\]/i
const CODE = /\b(L-\d{4,})\b/i

export function parseReferral(text: string): Referral {
  const tagged = text.match(TAGGED)
  if (tagged) {
    return { code: tagged[1].toUpperCase(), source: SOURCE_TAGS[tagged[2].toLowerCase()], text: text.replace(/\s*\[(ig|fb|tt|web)\]/i, '').trim() }
  }
  const code = text.match(CODE)
  return { code: code ? code[1].toUpperCase() : null, source: null, text }
}

export function whatsappLink(number: string, code: string, tag: string): string {
  const message = `Hi, I'm interested in ${code} [${tag}]`
  return `https://wa.me/${number.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`
}

export function campaignSource(campaign: string | null): { source: string; listing: string | null } | null {
  if (!campaign) return null
  const [kind, code] = campaign.split(':')
  return { source: kind, listing: code || null }
}
