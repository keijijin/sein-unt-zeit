#!/usr/bin/env node
/**
 * de-sections.json の各 § を Claude API で日本語に翻訳し、ja-sections.json を生成する。
 *
 * 使い方（リポジトリルートで）:
 *   export ANTHROPIC_API_KEY=sk-ant-...
 *   node scripts/translate-sections.mjs
 *
 * オプション:
 *   --from=1 --to=83     範囲（デフォルト 1〜83）
 *   --force              既に訳がある § も上書き
 *   --dry-run            API を呼ばずチャンク数だけ表示
 *   --chunk=3200        1リクエストあたりのドイツ語最大文字数（目安）
 *   --sleep=800         各 API 呼び出し後の待ち ms
 *
 * .env に ANTHROPIC_API_KEY（任意で ANTHROPIC_MODEL）を書いても読み込む。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')

const DE_PATH = path.join(ROOT, 'web', 'public', 'data', 'de-sections.json')
const JA_PATH = path.join(ROOT, 'web', 'public', 'data', 'ja-sections.json')
const PARTIAL_PATH = path.join(ROOT, 'web', 'public', 'data', 'ja-sections.partial.json')

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
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1)
    }
    if (process.env[k] === undefined) process.env[k] = v
  }
}

function parseArgs(argv) {
  const out = { from: 1, to: 83, force: false, dryRun: false, chunk: 3200, sleep: 800 }
  for (const a of argv.slice(2)) {
    if (a === '--force') out.force = true
    else if (a === '--dry-run') out.dryRun = true
    else if (a.startsWith('--from=')) out.from = Number(a.slice(7))
    else if (a.startsWith('--to=')) out.to = Number(a.slice(5))
    else if (a.startsWith('--chunk=')) out.chunk = Number(a.slice(8))
    else if (a.startsWith('--sleep=')) out.sleep = Number(a.slice(8))
    else if (a === '--help' || a === '-h') {
      console.log(`Usage: node scripts/translate-sections.mjs [--from=N] [--to=N] [--force] [--dry-run] [--chunk=N] [--sleep=ms]`)
      process.exit(0)
    }
  }
  return out
}

/** 段落境界を優先しつつ、長いブロックを max 文字程度に分割 */
function chunkGerman(text, maxChars) {
  const t = text.trim()
  if (!t) return []
  const chunks = []
  let start = 0
  while (start < t.length) {
    let end = Math.min(start + maxChars, t.length)
    if (end < t.length) {
      const slice = t.slice(start, end)
      let cut = slice.lastIndexOf('\n\n')
      if (cut < maxChars * 0.25) cut = slice.lastIndexOf('\n')
      if (cut < maxChars * 0.25) cut = slice.lastIndexOf(' ')
      if (cut > 0) end = start + cut
    }
    if (end <= start) end = Math.min(start + maxChars, t.length)
    const piece = t.slice(start, end).trim()
    if (piece) chunks.push(piece)
    start = end
  }
  return chunks
}

const SYSTEM = `あなたはドイツ哲学の専門的な翻訳者です。ハイデガーの文体と用語を尊重し、日本語として自然で読みやすい学術文体にしてください。`

function userPrompt(germanChunk) {
  return `以下はハイデガー『存在と時間』（Sein und Zeit）のドイツ語本文の一部です。日本語に全文翻訳してください。

厳守:
- 出力は翻訳本文のみ（前置き・後書き・見出しの再掲・「以下に翻訳します」等は禁止）
- 原文の改行・空行のリズムを可能な限り保つ（段落の区切りは \\n\\n を維持）
- 定訳に近い哲学用語を用いる（例: Dasein→ダザイン、Sein→存在、Seiende→存在者、Sorge→配慮、In-der-Welt-sein→世界内存在 など）。初出で迷う語は括弧内にドイツ語を残してよい
- 引用符・脚注番号は原文に合わせる

【ドイツ語】

${germanChunk}`
}

function parseAnthropicErrorMessage(raw) {
  try {
    const j = JSON.parse(raw)
    return j?.error?.message ?? null
  } catch {
    return null
  }
}

/** リトライしても解消しないクライアント起因のエラー */
function isFatalAccountError(status, raw) {
  const msg = (parseAnthropicErrorMessage(raw) || '') + (typeof raw === 'string' ? raw : '')
  if (status === 401) return true
  if (status === 400) {
    if (/credit balance|purchase credits|billing|invalid_api_key|authentication/i.test(msg))
      return true
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

/** TLS / プロキシ / 一時障害など、再試行で直る可能性があるエラー */
function isRetriableNetworkError(e) {
  const c = e?.cause
  const code = c?.code || e?.code
  if (code && RETRYABLE_SOCKET_CODES.has(code)) return true
  const msg = `${e?.message || ''} ${c?.message || ''}`
  if (/fetch failed|socket hang up|TLS/i.test(msg)) return true
  return false
}

async function callClaude({ apiKey, model, germanChunk, maxTokens }) {
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
      system: SYSTEM,
      messages: [{ role: 'user', content: userPrompt(germanChunk) }],
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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function translateSection(deText, opts) {
  const chunks = chunkGerman(deText, opts.chunk)
  if (opts.dryRun) return { chunks: chunks.length, text: '' }

  const parts = []
  const maxTokens = 8192
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i]
    let attempt = 0
    for (;;) {
      try {
        const ja = await callClaude({
          apiKey: opts.apiKey,
          model: opts.model,
          germanChunk: c,
          maxTokens,
        })
        parts.push(ja)
        break
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
          console.warn(`  chunk ${i + 1}/${chunks.length}: retry ${attempt}/7 after ${wait}ms (${label})`)
          await sleep(wait)
          continue
        }
        throw e
      }
    }
    if (opts.sleep > 0) await sleep(opts.sleep)
  }
  return { chunks: chunks.length, text: parts.join('\n\n').trim() }
}

function main() {
  loadDotEnv()
  const args = parseArgs(process.argv)

  if (!fs.existsSync(DE_PATH)) {
    console.error(`Missing ${DE_PATH} — run python3 scripts/extract_de_sections.py first`)
    process.exit(1)
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  const model =
    process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-20241022'

  if (!args.dryRun && !apiKey) {
    console.error('Set ANTHROPIC_API_KEY in the environment or in .env at the repo root.')
    process.exit(1)
  }

  const deMap = JSON.parse(fs.readFileSync(DE_PATH, 'utf8'))
  let jaMap = {}
  if (fs.existsSync(JA_PATH)) {
    try {
      jaMap = JSON.parse(fs.readFileSync(JA_PATH, 'utf8'))
    } catch {
      jaMap = {}
    }
  }

  const savePartial = () => {
    fs.writeFileSync(PARTIAL_PATH, JSON.stringify(jaMap, null, 0) + '\n', 'utf8')
  }

  ;(async () => {
    for (let n = args.from; n <= args.to; n++) {
      const key = String(n)
      const de = deMap[key]
      if (!de) {
        console.warn(`§${n}: no German source, skip`)
        continue
      }
      if (!args.force && jaMap[key] && String(jaMap[key]).trim().length > 0) {
        console.log(`§${n}: skip (already translated, use --force)`)
        continue
      }

      console.log(`§${n}: translating (${de.length} chars)…`)
      const { chunks, text } = await translateSection(de, {
        ...args,
        apiKey,
        model,
      })
      console.log(`  → ${chunks} API chunk(s)`)
      if (args.dryRun) continue

      jaMap[key] = text
      savePartial()
      fs.writeFileSync(JA_PATH, JSON.stringify(jaMap, null, 0) + '\n', 'utf8')
      console.log(`  saved §${n}`)
    }

    if (!args.dryRun && fs.existsSync(PARTIAL_PATH)) {
      try {
        fs.unlinkSync(PARTIAL_PATH)
      } catch {
        /* ignore */
      }
    }
    console.log('Done.', JA_PATH)
  })().catch((e) => {
    const status = e.status
    const raw = e.raw ?? ''
    const apiMsg = e.apiMessage || parseAnthropicErrorMessage(raw) || ''
    const network = isRetriableNetworkError(e) || (e instanceof TypeError && /fetch/i.test(String(e.message)))

    console.error('')
    if (network) {
      console.error('【ネットワーク】API への接続が途中で切れました（ECONNRESET / fetch failed 等）。')
      console.error('  Wi‑Fi・VPN・プロキシを確認し、しばらくしてから同じコマンドを再実行してください。')
    } else if (status === 400 || status === 401) {
      if (/credit balance|purchase credits/i.test(apiMsg + raw)) {
        console.error('【Anthropic】クレジット残高が不足しています（HTTP ' + status + '）。')
        console.error('  コンソール https://console.anthropic.com/ の「Plans & Billing」で')
        console.error('  プランの変更やクレジット購入を行ってください。')
      } else if (status === 401 || /invalid_api_key|authentication/i.test(apiMsg + raw)) {
        console.error('【Anthropic】API キーが無効か、権限がありません（HTTP ' + status + '）。')
        console.error('  .env の ANTHROPIC_API_KEY を確認してください。')
      } else if (apiMsg) {
        console.error('【Anthropic】' + apiMsg)
      }
    }

    console.error('')
    console.error('中断までに保存した訳はそのまま次のファイルに残っています:')
    console.error('  ', JA_PATH)
    if (network) {
      console.error('再実行すると「未訳の §」だけ続きから進みます（--force は不要です）。')
    } else {
      console.error('課金・キー・ネットワークを直したあと、同じコマンドを再実行すると「未訳の §」だけ続きます（--force は不要です）。')
    }
    console.error('')
    console.error(e)
    process.exit(1)
  })
}

main()
