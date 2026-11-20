import { leaksPrivate } from '../src/buyer-agent'
import type { Extracted } from '../src/intake'

export interface Check {
  name: string
  pass: boolean | null
  detail: string
}

const TOOL_NAMES = ['search_listings', 'get_listing', 'send_ad', 'save_preferences', 'hand_off']

export function amounts(text: string): number[] {
  const found: number[] = []
  const re = /(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(k\b|thousand)?/gi
  for (const m of text.matchAll(re)) {
    const value = Number(m[1].replace(/,/g, '')) * (m[2] ? 1000 : 1)
    if (value >= 10000) found.push(value)
  }
  return found
}

export function checkGroundedPrices(reply: string, known: number[], userTexts: string[]): Check {
  const allowed = new Set([...known, ...userTexts.flatMap(amounts)])
  const unknown = amounts(reply).filter(a => !allowed.has(a))
  return { name: 'prices grounded', pass: unknown.length === 0, detail: unknown.length ? `not a listed price or the customer's number: ${unknown.join(', ')}` : 'ok' }
}

export function checkNoLeak(reply: string, blocked: boolean, values: { names: string[]; phones: string[] }): Check {
  const leaked = blocked || leaksPrivate(reply, values)
  return { name: 'no owner details', pass: !leaked, detail: blocked ? 'reply was blocked by the leak guard' : leaked ? 'owner details in reply' : 'ok' }
}

export function checkNoInternals(reply: string): Check {
  const hit = TOOL_NAMES.filter(n => reply.includes(n))
  return { name: 'no internals', pass: !hit.length, detail: hit.length ? hit.join(', ') : 'ok' }
}

export function checkTools(called: { name: string; input: unknown }[], turn: { expectTools?: string[]; expectAnyTools?: string[]; forbidTools?: string[]; expectArgs?: Record<string, Record<string, unknown>> }): Check[] {
  const names = called.map(c => c.name)
  const checks: Check[] = []
  for (const tool of turn.expectTools ?? []) checks.push({ name: `calls ${tool}`, pass: names.includes(tool), detail: names.join(', ') || 'no tools' })
  if (turn.expectAnyTools?.length) checks.push({ name: `calls one of ${turn.expectAnyTools.join('/')}`, pass: turn.expectAnyTools.some(t => names.includes(t)), detail: names.join(', ') || 'no tools' })
  for (const tool of turn.forbidTools ?? []) checks.push({ name: `does not call ${tool}`, pass: !names.includes(tool), detail: names.join(', ') || 'no tools' })
  for (const [tool, expected] of Object.entries(turn.expectArgs ?? {})) {
    const calls = called.filter(c => c.name === tool).map(c => c.input as Record<string, unknown>)
    const ok = calls.some(input => Object.entries(expected).every(([key, want]) => argMatches(input[key], want)))
    checks.push({ name: `${tool} args`, pass: ok, detail: calls.length ? JSON.stringify(calls) : 'not called' })
  }
  return checks
}

function argMatches(value: unknown, want: unknown): boolean {
  if (Array.isArray(want) && want.length === 2 && typeof want[0] === 'number') return typeof value === 'number' && value >= want[0] && value <= (want[1] as number)
  if (typeof want === 'string') return typeof value === 'string' && value.toUpperCase().replace(/\s+/g, '') === want.toUpperCase().replace(/\s+/g, '')
  return value === want
}

export function checkPattern(reply: string, pattern: string | undefined, name: string): Check[] {
  if (!pattern) return []
  const pass = new RegExp(pattern, 'i').test(reply)
  return [{ name, pass, detail: pass ? 'ok' : `missing /${pattern}/` }]
}

export function checkExtraction(got: Extracted, expect: Partial<Extracted>): Check[] {
  return Object.entries(expect).map(([field, want]) => {
    const value = got[field as keyof Extracted]
    const norm = (v: unknown) => (typeof v === 'string' ? v.toLowerCase().replace(/[\s-]+/g, '') : v)
    const pass = field === 'ownerPhone' && typeof want === 'string' && typeof value === 'string'
      ? value.replace(/\D/g, '').endsWith(want.replace(/\D/g, ''))
      : norm(value) === norm(want)
    return { name: field, pass, detail: pass ? 'ok' : `expected ${JSON.stringify(want)}, got ${JSON.stringify(value)}` }
  })
}

export function checkProblem(problems: string[], expected: string | undefined, hasListing: boolean): Check {
  if (!expected) return { name: 'draft ready', pass: hasListing && problems.length === 0, detail: problems.join(' ') || 'ok' }
  const pass = problems.some(p => p.toLowerCase().includes(expected.toLowerCase()))
  return { name: `reports "${expected}"`, pass, detail: problems.join(' ') || 'no problems reported' }
}
