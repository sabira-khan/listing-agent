import Anthropic from '@anthropic-ai/sdk'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { runBuyerAgent } from '../src/buyer-agent'
import { loadConfig } from '../src/config'
import { GeoJsonDistrict } from '../src/district'
import { buildDraft, extractListing, type Extracted } from '../src/intake'
import { seedStore } from '../src/seed'
import { Store } from '../src/store'
import { checkExtraction, checkGroundedPrices, checkNoInternals, checkNoLeak, checkPattern, checkProblem, checkTools, type Check } from './checks'
import { certificatePng } from './fixtures'
import { judge } from './judge'

interface IntakeCase { id: string; category: string; text: string; image?: string; expect: Partial<Extracted>; problem?: string }
interface Turn { user: string; expectTools?: string[]; expectAnyTools?: string[]; forbidTools?: string[]; expectArgs?: Record<string, Record<string, unknown>>; mustMatch?: string; mustMatchAlso?: string; rubric?: string }
interface BuyerCase { id: string; category: string; turns: Turn[] }
interface Result { id: string; category: string; run: number; pass: boolean; checks: Check[]; transcript: unknown; latencyMs: number[]; inputTokens: number; outputTokens: number; error?: string }

const PRICES: Record<string, [number, number]> = {
  'claude-haiku-5-5': [0.1, 0.5],
  'claude-sonnet-5-5': [2, 10],
  'claude-opus-5-5': [4, 20]
}

const { values } = parseArgs({
  options: {
    suite: { type: 'string', default: 'all' },
    repeat: { type: 'string', default: '1' },
    case: { type: 'string' },
    category: { type: 'string' },
    concurrency: { type: 'string', default: '4' },
    'no-judge': { type: 'boolean', default: false },
    'agent-model': { type: 'string' },
    'intake-model': { type: 'string' },
    'judge-model': { type: 'string' }
  }
})

const config = loadConfig()
const agentModel = values['agent-model'] ?? config.agentModel
const intakeModel = values['intake-model'] ?? config.intakeModel
const judgeModel = values['judge-model'] ?? process.env.EVAL_JUDGE_MODEL ?? 'claude-sonnet-5-5'
const repeat = Math.max(1, Number(values.repeat) || 1)
const client = new Anthropic({ maxRetries: 4 })
const directory = GeoJsonDistrict.fromFile(config.districtPath)
const certificate = certificatePng().toString('base64')
const judgeUsage = { inputTokens: 0, outputTokens: 0 }

const load = <T>(name: string): T[] => JSON.parse(readFileSync(new URL(`./cases/${name}.json`, import.meta.url), 'utf8'))
const pick = <T extends { id: string; category: string }>(cases: T[]) => cases.filter(c => (!values.case || c.id === values.case) && (!values.category || c.category === values.category))
const intakeCases = values.suite === 'buyer' ? [] : pick(load<IntakeCase>('intake'))
const buyerCases = values.suite === 'intake' ? [] : pick(load<BuyerCase>('buyer'))

async function runIntake(c: IntakeCase, run: number): Promise<Result> {
  const started = Date.now()
  const images = c.image === 'certificate' ? [{ mediaType: 'image/png' as const, data: certificate }] : []
  const { extracted, usage } = await extractListing(client, intakeModel, { text: c.text, images })
  const draft = buildDraft(extracted, directory, 'eval')
  const checks = [...checkExtraction(extracted, c.expect), checkProblem(draft.problems, c.problem, Boolean(draft.listing))]
  return { id: c.id, category: c.category, run, pass: checks.every(ch => ch.pass), checks, transcript: { extracted, problems: draft.problems }, latencyMs: [Date.now() - started], ...usage }
}

async function runBuyer(c: BuyerCase, run: number): Promise<Result> {
  const store = new Store()
  seedStore(store, directory)
  const phone = '19990000000'
  const known = store.listListings().map(l => l.price)
  const privateValues = store.privateValues()
  const transcript: { user: string; reply: string; tools: { name: string; input: unknown }[] }[] = []
  const checks: Check[] = []
  const latencyMs: number[] = []
  let inputTokens = 0
  let outputTokens = 0
  for (const [index, turn] of c.turns.entries()) {
    const started = Date.now()
    const result = await runBuyerAgent(phone, turn.user, {
      client, model: agentModel, store, companyName: config.companyName,
      districtName: directory.name.replace(/\s*\(sample\)$/, ''), phases: directory.phases(), currency: config.currency, budgetMs: 45000
    })
    latencyMs.push(Date.now() - started)
    inputTokens += result.usage.inputTokens
    outputTokens += result.usage.outputTokens
    transcript.push({ user: turn.user, reply: result.reply, tools: result.toolCalls })
    const label = (ch: Check) => ({ ...ch, name: c.turns.length > 1 ? `turn ${index + 1}: ${ch.name}` : ch.name })
    const turnChecks: Check[] = [
      checkNoLeak(result.reply, result.blocked, privateValues),
      checkNoInternals(result.reply),
      checkGroundedPrices(result.reply, known, transcript.map(t => t.user)),
      ...checkTools(result.toolCalls, turn),
      ...checkPattern(result.reply, turn.mustMatch, 'mentions expected detail'),
      ...checkPattern(result.reply, turn.mustMatchAlso, 'mentions second detail')
    ]
    if (turn.rubric && !values['no-judge']) {
      const verdict = await judge(client, judgeModel, transcript.map(t => ({ user: t.user, reply: t.reply })), turn.rubric)
      judgeUsage.inputTokens += verdict.inputTokens
      judgeUsage.outputTokens += verdict.outputTokens
      turnChecks.push({ name: 'judge', pass: verdict.pass, detail: verdict.reason })
    }
    checks.push(...turnChecks.map(label))
  }
  return { id: c.id, category: c.category, run, pass: checks.every(ch => ch.pass !== false), checks, transcript, latencyMs, inputTokens, outputTokens }
}

async function pool<T>(tasks: (() => Promise<T>)[], size: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(size, tasks.length) }, async () => {
    while (next < tasks.length) {
      const i = next++
      results[i] = await tasks[i]()
    }
  }))
  return results
}

function safe(kind: string, c: { id: string; category: string }, run: number, fn: () => Promise<Result>) {
  return async (): Promise<Result & { kind: string }> => {
    try {
      return { kind, ...(await fn()) }
    } catch (err) {
      return { kind, id: c.id, category: c.category, run, pass: false, checks: [], transcript: null, latencyMs: [], inputTokens: 0, outputTokens: 0, error: (err as Error).message }
    }
  }
}

const tasks = [
  ...intakeCases.flatMap(c => Array.from({ length: repeat }, (_, r) => safe('intake', c, r, () => runIntake(c, r)))),
  ...buyerCases.flatMap(c => Array.from({ length: repeat }, (_, r) => safe('buyer', c, r, () => runBuyer(c, r))))
]
console.log(`Running ${tasks.length} runs (intake ${intakeModel}, agent ${agentModel}, judge ${values['no-judge'] ? 'off' : judgeModel})`)
const results = await pool(tasks, Number(values.concurrency) || 4)

const cost = (model: string, input: number, output: number) => {
  const [i, o] = PRICES[model] ?? [0, 0]
  return (input * i + output * o) / 1e6
}
const percentile = (xs: number[], p: number) => {
  if (!xs.length) return 0
  const sorted = [...xs].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]
}

const rows: string[] = []
for (const kind of ['intake', 'buyer']) {
  const group = results.filter(r => r.kind === kind)
  if (!group.length) continue
  const categories = [...new Set(group.map(r => r.category))]
  rows.push(`\n${kind === 'intake' ? `Intake (${intakeModel})` : `Buyer agent (${agentModel})`}`)
  rows.push('| Category | Passed | Pass rate |', '|---|---|---|')
  for (const cat of categories) {
    const g = group.filter(r => r.category === cat)
    const n = g.filter(r => r.pass).length
    rows.push(`| ${cat} | ${n}/${g.length} | ${Math.round((n / g.length) * 100)}% |`)
  }
  const n = group.filter(r => r.pass).length
  rows.push(`| **Overall** | **${n}/${group.length}** | **${Math.round((n / group.length) * 100)}%** |`)
  const latencies = group.flatMap(r => r.latencyMs)
  const model = kind === 'intake' ? intakeModel : agentModel
  const total = group.reduce((s, r) => s + cost(model, r.inputTokens, r.outputTokens), 0)
  rows.push(`\nLatency p50 ${(percentile(latencies, 50) / 1000).toFixed(1)} s, p95 ${(percentile(latencies, 95) / 1000).toFixed(1)} s. Cost per ${kind === 'intake' ? 'offer' : 'conversation'} $${(total / group.length).toFixed(4)}.`)
}
console.log(rows.join('\n'))

const failures = results.filter(r => !r.pass)
if (failures.length) {
  console.log('\nFailures')
  for (const f of failures) {
    const failed = f.checks.filter(c => c.pass === false).map(c => `${c.name}: ${c.detail}`)
    console.log(`- ${f.id} (run ${f.run + 1}): ${f.error ?? failed.join('; ')}`)
  }
}
const flaky = [...new Set(results.map(r => r.id))].filter(id => {
  const runs = results.filter(r => r.id === id)
  return runs.some(r => r.pass) && runs.some(r => !r.pass)
})
if (repeat > 1) console.log(`\nFlaky cases: ${flaky.length ? flaky.join(', ') : 'none'}`)
const skipped = results.flatMap(r => r.checks).filter(c => c.pass === null).length
if (skipped) console.log(`Judge gave no verdict on ${skipped} checks (counted as skipped).`)
console.log(`Judge cost $${cost(judgeModel, judgeUsage.inputTokens, judgeUsage.outputTokens).toFixed(4)}`)

mkdirSync(new URL('./results/', import.meta.url), { recursive: true })
const file = new URL(`./results/${new Date().toISOString().replace(/[:.]/g, '-')}.json`, import.meta.url)
writeFileSync(file, JSON.stringify({ intakeModel, agentModel, judgeModel, repeat, results }, null, 2))
console.log(`Results written to ${file.pathname}`)
