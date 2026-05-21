#!/usr/bin/env node
/**
 * ja-sections.json を 10 節ずつ UTF-8 の .txt に分割出力する。
 *
 * 使い方（リポジトリルートで）:
 *   node scripts/export-ja-txt.mjs
 *
 * オプション:
 *   --out=doc/ja-txt     出力ディレクトリ（デフォルト doc/ja-txt）
 *   --chunk=10           1 ファイルあたりの節数（デフォルト 10）
 *   --from=1 --to=83     範囲（デフォルト 1〜83）
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')

const JA_PATH = path.join(ROOT, 'web', 'public', 'data', 'ja-sections.json')
const GUIDES_PATH = path.join(ROOT, 'web', 'src', 'jaGuides.ts')
const DEFAULT_OUT = path.join(ROOT, 'doc', 'ja-txt')

function parseArgs(argv) {
  const out = { outDir: DEFAULT_OUT, chunk: 10, from: 1, to: 83 }
  for (const a of argv.slice(2)) {
    const m = a.match(/^--out=(.+)$/)
    if (m) {
      out.outDir = path.isAbsolute(m[1]) ? m[1] : path.join(ROOT, m[1])
      continue
    }
    const c = a.match(/^--chunk=(\d+)$/)
    if (c) {
      out.chunk = Number(c[1])
      continue
    }
    const f = a.match(/^--from=(\d+)$/)
    if (f) {
      out.from = Number(f[1])
      continue
    }
    const t = a.match(/^--to=(\d+)$/)
    if (t) {
      out.to = Number(t[1])
    }
  }
  return out
}

function loadTitleJa() {
  const raw = fs.readFileSync(GUIDES_PATH, 'utf8')
  const start = raw.indexOf('const T: Record<number, string> = {')
  if (start < 0) return {}
  const end = raw.indexOf('\n}', start)
  const block = raw.slice(start, end)
  const titles = {}
  for (const m of block.matchAll(/^\s+(\d+):\s*'((?:\\'|[^'])*)'/gm)) {
    titles[Number(m[1])] = m[2].replace(/\\'/g, "'")
  }
  return titles
}

function pad2(n) {
  return String(n).padStart(2, '0')
}

function buildFileBody(fromN, toN, ja, titles) {
  const lines = []
  lines.push(`存在と時間 — 日本語訳（§${fromN}–§${toN}）`)
  lines.push('出典: web/public/data/ja-sections.json（Claude API 生成）')
  lines.push('')

  for (let n = fromN; n <= toN; n++) {
    const text = ja[String(n)]
    if (typeof text !== 'string' || !text.trim()) {
      lines.push('='.repeat(72))
      lines.push(`§${n}  ${titles[n] ?? '（タイトル未登録）'}`)
      lines.push('='.repeat(72))
      lines.push('')
      lines.push('（この § の日本語訳はまだありません）')
      lines.push('')
      continue
    }
    lines.push('='.repeat(72))
    lines.push(`§${n}  ${titles[n] ?? ''}`.trimEnd())
    lines.push('='.repeat(72))
    lines.push('')
    lines.push(text.trim())
    lines.push('')
  }

  return lines.join('\n')
}

function main() {
  const { outDir, chunk, from, to } = parseArgs(process.argv)

  if (!fs.existsSync(JA_PATH)) {
    console.error(`見つかりません: ${JA_PATH}`)
    console.error('先に npm run translate:ja を実行してください。')
    process.exit(1)
  }

  const ja = JSON.parse(fs.readFileSync(JA_PATH, 'utf8'))
  const titles = loadTitleJa()

  fs.mkdirSync(outDir, { recursive: true })

  const written = []
  for (let start = from; start <= to; start += chunk) {
    const end = Math.min(start + chunk - 1, to)
    const name = `ja-${pad2(start)}-${pad2(end)}.txt`
    const filePath = path.join(outDir, name)
    const body = buildFileBody(start, end, ja, titles)
    fs.writeFileSync(filePath, body, 'utf8')
    written.push({ name, start, end, bytes: Buffer.byteLength(body, 'utf8') })
  }

  console.log(`Wrote ${written.length} file(s) to ${outDir}`)
  for (const w of written) {
    console.log(`  ${w.name}  §${w.start}–§${w.end}  (${(w.bytes / 1024).toFixed(1)} KiB)`)
  }
}

main()
