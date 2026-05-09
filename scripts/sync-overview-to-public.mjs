#!/usr/bin/env node
/**
 * doc/overview を web/public/overview にコピーする（Webから参照するため）。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')

const SRC = path.join(ROOT, 'doc', 'overview')
const DST = path.join(ROOT, 'web', 'public', 'overview')

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true })
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name)
    const d = path.join(dst, ent.name)
    if (ent.isDirectory()) copyDir(s, d)
    else if (ent.isFile()) fs.copyFileSync(s, d)
  }
}

if (!fs.existsSync(SRC)) {
  console.error(`Missing ${SRC}`)
  process.exit(1)
}
fs.rmSync(DST, { recursive: true, force: true })
copyDir(SRC, DST)
console.log(`synced ${SRC} -> ${DST}`)

