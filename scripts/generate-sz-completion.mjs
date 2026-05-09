#!/usr/bin/env node
/**
 * doc/sein-zeit-logical-completion/sections-manifest.json に基づき、
 * 各節の本文（Markdown）を Anthropic API で生成し、
 * doc/sein-zeit-logical-completion/generated/<id>.md に保存する。
 *
 * 使い方（リポジトリルート、または web から npm script）:
 *   node scripts/generate-sz-completion.mjs
 *
 * オプション:
 *   --from=1 --to=27     フラットな節番号（1 始まり、全27節）
 *   --id=P1-III-01-01    単一の節 id のみ
 *   --force              既存 .md を上書き
 *   --dry-run            API を呼ばず対象を表示
 *   --sleep=800          各成功後の待ち ms
 *
 * 公開用コピー:
 *   npm run completion:sync   （web ディレクトリ）
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')

const MANIFEST_PATH = path.join(ROOT, 'doc', 'sein-zeit-logical-completion', 'sections-manifest.json')
const OUT_DIR = path.join(ROOT, 'doc', 'sein-zeit-logical-completion', 'generated')

function loadDotEnv() {
  const envPath = path.join(ROOT, '.env')
  if (!fs.existsSync(envPath)) return
  const raw = fs.readFileSync(envPath, 'utf8')
  for (const line of raw.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i <= 0) continue
    const k = t.slice(0, i).trim()
    let v = t.slice(i + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (process.env[k] === undefined) process.env[k] = v
  }
}

function parseArgs(argv) {
  const out = { from: 1, to: 999, force: false, dryRun: false, sleep: 800, id: null }
  for (const a of argv.slice(2)) {
    if (a === '--force') out.force = true
    else if (a === '--dry-run') out.dryRun = true
    else if (a.startsWith('--from=')) out.from = Number(a.slice(7))
    else if (a.startsWith('--to=')) out.to = Number(a.slice(5))
    else if (a.startsWith('--sleep=')) out.sleep = Number(a.slice(8))
    else if (a.startsWith('--id=')) out.id = a.slice(5)
    else if (a === '--help' || a === '-h') {
      console.log(`Usage: node scripts/generate-sz-completion.mjs [--from=N] [--to=N] [--id=ID] [--force] [--dry-run] [--sleep=ms]`)
      process.exit(0)
    }
  }
  return out
}

function flattenManifest(manifest) {
  const list = []
  for (const part of manifest.parts ?? []) {
    for (const ch of part.chapters ?? []) {
      for (const sec of ch.sections ?? []) {
        list.push({
          id: sec.id,
          title: sec.title,
          conclusion: sec.conclusion,
          sketch: sec.sketch ?? [],
          partLabel: part.label,
          chapterLabel: ch.label,
        })
      }
    }
  }
  return list
}

function parseAnthropicErrorMessage(raw) {
  try {
    const j = JSON.parse(raw)
    return j?.error?.message ?? null
  } catch {
    return null
  }
}

function isFatalAccountError(status, raw) {
  const msg = (parseAnthropicErrorMessage(raw) || '') + (typeof raw === 'string' ? raw : '')
  if (status === 401) return true
  if (status === 400) {
    if (/credit balance|purchase credits|billing|invalid_api_key|authentication/i.test(msg)) return true
  }
  return false
}

const RETRYABLE_SOCKET_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  'ECONNREFUSED',
  'ENETUNREACH',
])

function isRetriableNetworkError(e) {
  const c = e?.cause
  const code = c?.code || e?.code
  if (code && RETRYABLE_SOCKET_CODES.has(code)) return true
  const msg = `${e?.message || ''} ${c?.message || ''}`
  if (/fetch failed|socket hang up|TLS/i.test(msg)) return true
  return false
}

async function callAnthropicOnce({ apiKey, model, system, user, maxTokens }) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  })
  const raw = await res.text()
  if (!res.ok) {
    const apiMsg = parseAnthropicErrorMessage(raw)
    const summary = apiMsg || raw.slice(0, 400)
    const err = new Error(`Anthropic API ${res.status}: ${summary}`)
    err.status = res.status
    err.raw = raw
    err.apiMessage = apiMsg
    throw err
  }
  let data
  try {
    data = JSON.parse(raw)
  } catch {
    throw new Error(`Invalid JSON from API: ${raw.slice(0, 200)}`)
  }
  const text = data?.content?.find((b) => b.type === 'text')?.text
  if (typeof text !== 'string') throw new Error('No text content in API response')
  return text.trim()
}

async function callClaude({ apiKey, model, system, user, maxTokens }) {
  let attempt = 0
  for (;;) {
    try {
      return await callAnthropicOnce({ apiKey, model, system, user, maxTokens })
    } catch (e) {
      const status = e.status ?? 0
      const raw = e.raw ?? ''
      if (isFatalAccountError(status, raw)) throw e
      attempt++
      const net = isRetriableNetworkError(e)
      const retriableHttp = status === 429 || status >= 500
      if ((net || retriableHttp) && attempt < 8) {
        const wait = net
          ? Math.min(90_000, 2500 * attempt)
          : Math.min(60_000, 2000 * 2 ** Math.min(attempt, 5))
        const label = net ? `network ${e.cause?.code || e.code || '?'}` : String(status)
        console.warn(`  retry ${attempt}/7 after ${wait}ms (${label})`)
        await sleep(wait)
        continue
      }
      throw e
    }
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

const SYSTEM = `あなたは哲学テキストの執筆者である。依拠するのは『存在と時間』1927年刊の**既刊部分（第一部第一編・第二編）**の概念運動のみとする。ハイデガーの他著作を引用したり、外部研究書の名前を出す必要はない（出さない）。

文体:
- 学術的な現代日本語。読者は哲学に不慣れな人も含むため、専門語は初出で短く定義する。
- 断定調だが、テキストが明示していない推測で「ハイデガーは必ずこう書いた」とは言わない。与えられた「結論の一句」と「論述のスケッチ」を**論理的に膨らませる**にとどめる。

出力形式（厳守）:
- Markdown のみ（前置き・謝罪・メタ説明なし）。
- 1行目: ## <節タイトル>（入力の節タイトルをそのまま使う）
- 空行
- 2行目付近: *内的完結稿 — <部ラベル> / <章ラベル> / 節 id: <id>*
- 空行、---
- 本文は ### 見出しを複数使い、800〜2200 字程度の日本語（漢字仮名交じり）で展開する。
- 必要に応じて箇条書きは補助に留め、段落による論証を主とする。
- 1 つの mermaid flowchart TD または要点の Markdown 表を入れてもよい（必須ではない）。`

function buildUserPrompt(entry) {
  const sketchBlock = entry.sketch.map((s) => `- ${s}`).join('\n')
  return `次の節について、設計どおりに**本文を執筆**せよ。

【位置づけ】
- 部: ${entry.partLabel}
- 章: ${entry.chapterLabel}
- 節 id: ${entry.id}

【節タイトル】
${entry.title}

【結論の一句（この節の核となる命題）】
${entry.conclusion}

【論述のスケッチ（この順序・論点を尊重すること）】
${sketchBlock}

【執筆上の注意】
- 『存在と時間』既刊で既に用いられている語（ダザイン、世界性、配慮、開示、時間性、歴史性、常人、死、良心、決断性、流俗時間、内時間性、存在論的差異 等）を優先して用いる。
- 第三編・第二部は「続書」としての**論理的必然**を示すことが目的である。`
}

async function main() {
  loadDotEnv()
  const args = parseArgs(process.argv)

  if (!fs.existsSync(MANIFEST_PATH)) {
    console.error(`Missing ${MANIFEST_PATH}`)
    process.exit(1)
  }

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'))
  const flat = flattenManifest(manifest)
  if (flat.length === 0) {
    console.error('Manifest has no sections.')
    process.exit(1)
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  const model = process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-20241022'
  const maxTokens = Number(process.env.ANTHROPIC_MAX_TOKENS_SZC || '8192')

  if (!args.dryRun && !apiKey) {
    console.error('Set ANTHROPIC_API_KEY in the environment or in .env at the repo root.')
    process.exit(1)
  }

  fs.mkdirSync(OUT_DIR, { recursive: true })

  let targets
  if (args.id) {
    targets = flat.filter((e) => e.id === args.id)
    if (targets.length === 0) {
      console.error(`No section with id=${args.id}`)
      process.exit(1)
    }
  } else {
    targets = flat.slice(args.from - 1, args.to)
    if (targets.length === 0) {
      console.error('No sections in range (check --from / --to).')
      process.exit(1)
    }
  }

  console.log(`Sections to generate: ${targets.length} (model=${model})`)

  for (let i = 0; i < targets.length; i++) {
    const entry = targets[i]
    const outPath = path.join(OUT_DIR, `${entry.id}.md`)
    if (!args.force && fs.existsSync(outPath)) {
      console.log(`[skip] ${entry.id} (exists, use --force)`)
      continue
    }

    if (args.dryRun) {
      console.log(`[dry-run] ${entry.id} ${entry.title}`)
      continue
    }

    const globalIndex = flat.findIndex((e) => e.id === entry.id) + 1
    console.log(`[${globalIndex}/${flat.length}] ${entry.id}: generating…`)

    const user = buildUserPrompt(entry)
    const md = await callClaude({
      apiKey,
      model,
      system: SYSTEM,
      user,
      maxTokens: Number.isFinite(maxTokens) ? maxTokens : 8192,
    })

    fs.writeFileSync(outPath, md + '\n', 'utf8')
    console.log(`  wrote ${outPath}`)

    if (args.sleep > 0 && i < targets.length - 1) await sleep(args.sleep)
  }

  console.log('Done. Run: cd web && npm run completion:sync')
}

main().catch((e) => {
  const status = e.status
  const raw = e.raw ?? ''
  const apiMsg = e.apiMessage || parseAnthropicErrorMessage(raw) || ''
  const network = isRetriableNetworkError(e) || (e instanceof TypeError && /fetch/i.test(String(e.message)))

  console.error('')
  if (network) {
    console.error('【ネットワーク】接続が切れました。しばらくしてから --id または --from で再実行してください。')
  } else if (status === 400 || status === 401) {
    if (/credit balance|purchase credits/i.test(apiMsg + raw)) {
      console.error('【Anthropic】クレジット不足など（HTTP ' + status + '）。')
    } else if (apiMsg) console.error('【Anthropic】' + apiMsg)
  }
  console.error(e)
  process.exit(1)
})
