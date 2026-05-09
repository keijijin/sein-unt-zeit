#!/usr/bin/env node
/**
 * ja-sections.json（§ごとの日本語訳）から、doc/overview/No.XX.md を生成する。
 *
 * 使い方（リポジトリルートで）:
 *   export ANTHROPIC_API_KEY=...
 *   node scripts/generate-overviews.mjs
 *
 * オプション:
 *   --from=1 --to=83     範囲（デフォルト 1〜83）
 *   --force              既存 No.XX.md を上書き
 *   --dry-run            API を呼ばず対象数だけ表示
 *   --sleep=800          各 API 呼び出し後の待ち ms
 *
 * 注意:
 * - 解説は「ハイデガーと一般人を結ぶ仲介者」として、No.01〜03 の文体に寄せる。
 * - 入力の日本語訳本文は長いので、APIの制限に応じて適宜分割する必要がある場合がある。
 *   まずは短い節から試すのがおすすめ。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')

const JA_PATH = path.join(ROOT, 'web', 'public', 'data', 'ja-sections.json')
const OUT_DIR = path.join(ROOT, 'doc', 'overview')

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
  const out = { from: 1, to: 83, force: false, dryRun: false, sleep: 800 }
  for (const a of argv.slice(2)) {
    if (a === '--force') out.force = true
    else if (a === '--dry-run') out.dryRun = true
    else if (a.startsWith('--from=')) out.from = Number(a.slice(7))
    else if (a.startsWith('--to=')) out.to = Number(a.slice(5))
    else if (a.startsWith('--sleep=')) out.sleep = Number(a.slice(8))
    else if (a === '--help' || a === '-h') {
      console.log('Usage: node scripts/generate-overviews.mjs [--from=N] [--to=N] [--force] [--dry-run] [--sleep=ms]')
      process.exit(0)
    }
  }
  return out
}

function parseJaTitles() {
  // web/src/jaGuides.ts の const T からタイトルを抽出（簡易パーサ）
  const p = path.join(ROOT, 'web', 'src', 'jaGuides.ts')
  const raw = fs.readFileSync(p, 'utf8')
  const map = new Map()
  const m = raw.match(/const T: Record<number, string> = \\{([\\s\\S]*?)\\n\\}/)
  if (!m) return map
  const body = m[1]
  const re = /\\n\\s*(\\d+):\\s*'([^']+)'\\s*,?/g
  for (;;) {
    const r = re.exec(body)
    if (!r) break
    map.set(Number(r[1]), r[2])
  }
  return map
}

function parseSectionTitlesDe() {
  // web/src/sections.ts のオブジェクト配列から {n,titleDe} を抽出（簡易）
  const p = path.join(ROOT, 'web', 'src', 'sections.ts')
  const raw = fs.readFileSync(p, 'utf8')
  const map = new Map()
  const re = /\\{\\s*n:\\s*(\\d+)\\s*,\\s*bookPage:\\s*\\d+\\s*,\\s*titleDe:\\s*\"([^\"]+)\"\\s*\\}/g
  for (;;) {
    const r = re.exec(raw)
    if (!r) break
    map.set(Number(r[1]), r[2])
  }
  return map
}

const SYSTEM = `あなたは、ハイデガーと一般人を結ぶ仲介者です。読者は哲学に不慣れです。\n\n目的:\n- 入力として与えられる『存在と時間』の日本語訳全文を参照し、その節の「主張（何を言いたいのか）」と「論証の流れ（どう言っているのか）」が、一般人にもすっきり分かる解説Markdownを作る。\n\n文体・構成（厳守）:\n- 出力はMarkdownのみ（前置きの挨拶、メタ説明、箇条書きだけの投げっぱなしは禁止）。\n- 先頭は次の形にする:\n  1) 見出し行: ## 「<節タイトル日本語>」はどこにあるのか  または  ## 「<節タイトル日本語>」は何だと言っているのか\n  2) 空行\n  3) *ハイデガー『存在と時間』第<節番号>節*\n  4) 空行\n  5) ---\n- 本文は ### 見出しを複数使い、節の中の「論点の段階」を分ける。\n- 章の区切りには --- を適宜入れる（No.01 のリズムに合わせる）。\n- 議論の流れが複雑な場合は、mermaid の flowchart TD を1つ入れて良い（必須ではないが推奨）。\n- 重要点の整理には表（Markdown table）を1つ以上入れて良い（推奨）。\n\n内容上の注意:\n- できるだけ少ない専門語で説明する。使う専門語（例: ダザイン、存在、存在者、配慮など）は、初出で短く説明する。\n- 原文の文言を引くときは引用ブロック（>）にし、必要最小限の長さにする（長大な引用の貼り付けは禁止）。\n- 推測で断言しない。入力の日本語訳の中で言っている範囲に限定して、主張と根拠を対応させる。`

function makeUserPrompt({ n, titleJa, titleDe, jaTranslation }) {
  const q =
    /必要性|必然|根拠|要請|要求/.test(titleJa)
      ? `「${titleJa}」はどこにあるのか`
      : `「${titleJa}」は何だと言っているのか`
  return `次の資料にもとづき、No.01.md と同様の「読みやすい解説Markdown」を作ってください。\n\n必須の書式（この骨組みを崩さない）:\n- 先頭行: ## ${q}\n- 2行目: 空行\n- 3行目: *ハイデガー『存在と時間』第${n}節*\n- その後に区切り線（---）を置き、### 見出しを使って段階的に解説する。\n\n内容の狙い:\n- 「この節の結論は結局どこにあるのか／何が言いたいのか」を最初に短く示し、次に「どういう段取りでそこへ到達するか」を整理して説明する。\n- 必要なら mermaid の flowchart と、要点の表を入れる。\n\n【節タイトル】\n- 日本語: ${titleJa}\n- 原文: ${titleDe}\n\n【日本語訳全文】\n\n${jaTranslation}`
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

async function callAnthropicOnce({ apiKey, model, prompt }) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system: SYSTEM,
      messages: [{ role: 'user', content: prompt }],
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

async function callClaude({ apiKey, model, prompt }) {
  let attempt = 0
  for (;;) {
    try {
      return await callAnthropicOnce({ apiKey, model, prompt })
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

async function main() {
  loadDotEnv()
  const args = parseArgs(process.argv)

  if (!fs.existsSync(JA_PATH)) {
    console.error(`Missing ${JA_PATH} — run translation first.`)
    process.exit(1)
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  const model = process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-20241022'
  if (!args.dryRun && !apiKey) {
    console.error('Set ANTHROPIC_API_KEY in the environment or in .env at the repo root.')
    process.exit(1)
  }

  const jaMap = JSON.parse(fs.readFileSync(JA_PATH, 'utf8'))
  const titlesJa = parseJaTitles()
  const titlesDe = parseSectionTitlesDe()

  fs.mkdirSync(OUT_DIR, { recursive: true })

  for (let n = args.from; n <= args.to; n++) {
    const no = String(n).padStart(2, '0')
    const outPath = path.join(OUT_DIR, `No.${no}.md`)
    if (!args.force && fs.existsSync(outPath)) {
      console.log(`No.${no}: skip (exists, use --force)`)
      continue
    }
    const jaTranslation = String(jaMap[String(n)] || '').trim()
    if (!jaTranslation) {
      console.log(`No.${no}: skip (missing ja translation for §${n})`)
      continue
    }

    const titleJa = titlesJa.get(n) || `§${n}`
    const titleDe = titlesDe.get(n) || `§${n}`

    console.log(`No.${no}: generating…`)
    if (args.dryRun) continue
    const prompt = makeUserPrompt({ n, titleJa, titleDe, jaTranslation })
    const mdBody = await callClaude({ apiKey, model, prompt })
    fs.writeFileSync(outPath, mdBody + '\n', 'utf8')
    if (args.sleep > 0) await sleep(args.sleep)
  }

  console.log('Done.', OUT_DIR)
}

main().catch((e) => {
  const status = e.status
  const raw = e.raw ?? ''
  const apiMsg = e.apiMessage || parseAnthropicErrorMessage(raw) || ''
  const network = isRetriableNetworkError(e) || (e instanceof TypeError && /fetch/i.test(String(e.message)))

  console.error('')
  if (network) {
    console.error('【ネットワーク】API への接続が途中で切れました（ECONNRESET / fetch failed 等）。')
    console.error('  しばらくしてから同じコマンドを再実行してください（--from で失敗した No. から続けられます）。')
  } else if (status === 400 || status === 401) {
    if (/credit balance|purchase credits/i.test(apiMsg + raw)) {
      console.error('【Anthropic】クレジット残高が不足しています（HTTP ' + status + '）。')
    } else if (apiMsg) {
      console.error('【Anthropic】' + apiMsg)
    }
  }
  console.error('')
  console.error(e)
  process.exit(1)
})

