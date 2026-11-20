export interface Config {
  companyName: string
  contactLine: string
  currency: string
  ownerPhones: string[]
  staffPhones: string[]
  agentModel: string
  intakeModel: string
  dbPath: string
  districtPath: string
  publicBaseUrl: string
  adminPassword: string
  messageCost: number
  templateLanguage: string
  listingTemplate: string
  followUpTemplate: string
  whatsapp: {
    token: string
    phoneNumberId: string
    appSecret: string
    verifyToken: string
    graphVersion: string
  }
  instagram: { userId: string; token: string } | null
  facebook: { pageId: string; token: string } | null
}

export function phoneList(value: string | undefined): string[] {
  return (value ?? '').split(',').map(normalizePhone).filter(Boolean)
}

export function normalizePhone(phone: string): string {
  return phone.replace(/[^\d]/g, '')
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const graphVersion = env.META_GRAPH_VERSION || 'v23.0'
  return {
    companyName: env.COMPANY_NAME || 'Harbor Point Realty',
    contactLine: env.CONTACT_LINE || '',
    currency: env.CURRENCY || 'KWD',
    ownerPhones: phoneList(env.OWNER_PHONES),
    staffPhones: phoneList(env.STAFF_PHONES),
    agentModel: env.AGENT_MODEL || 'claude-haiku-5-5',
    intakeModel: env.INTAKE_MODEL || 'claude-sonnet-5-5',
    dbPath: env.DB_PATH || 'data/listings.db',
    districtPath: env.DISTRICT_PATH || 'data/sample-district.geojson',
    publicBaseUrl: (env.PUBLIC_BASE_URL || 'http://localhost:3000').replace(/\/$/, ''),
    adminPassword: env.ADMIN_PASSWORD || '',
    messageCost: Number(env.MESSAGE_COST) || 0.017,
    templateLanguage: env.TEMPLATE_LANGUAGE || 'en',
    listingTemplate: env.LISTING_TEMPLATE || 'new_listing',
    followUpTemplate: env.FOLLOW_UP_TEMPLATE || 'listing_follow_up',
    whatsapp: {
      token: env.WHATSAPP_TOKEN || '',
      phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID || '',
      appSecret: env.WHATSAPP_APP_SECRET || '',
      verifyToken: env.WHATSAPP_VERIFY_TOKEN || '',
      graphVersion
    },
    instagram: env.INSTAGRAM_USER_ID && env.META_ACCESS_TOKEN ? { userId: env.INSTAGRAM_USER_ID, token: env.META_ACCESS_TOKEN } : null,
    facebook: env.FACEBOOK_PAGE_ID && env.META_ACCESS_TOKEN ? { pageId: env.FACEBOOK_PAGE_ID, token: env.META_ACCESS_TOKEN } : null
  }
}

export function formatPrice(price: number, currency: string): string {
  return `${new Intl.NumberFormat('en-US').format(price)} ${currency}`
}
