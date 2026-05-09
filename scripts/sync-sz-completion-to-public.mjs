#!/usr/bin/env node
/**
 * doc/sein-zeit-logical-completion/sections-manifest.json と
 * doc/sein-zeit-logical-completion/generated/*.md を
 * web/public/sz-completion/ にコピーする（静的配信用）。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')

const SRC_MANIFEST = path.join(ROOT, 'doc', 'sein-zeit-logical-completion', 'sections-manifest.json')
const SRC_GEN = path.join(ROOT, 'doc', 'sein-zeit-logical-completion', 'generated')
const DST = path.join(ROOT, 'web', 'public', 'sz-completion')
const DST_ART = path.join(DST, 'articles')

if (!fs.existsSync(SRC_MANIFEST)) {
  console.error(`Missing ${SRC_MANIFEST}`)
  process.exit(1)
}

fs.mkdirSync(DST_ART, { recursive: true })
fs.copyFileSync(SRC_MANIFEST, path.join(DST, 'manifest.json'))

for (const ent of fs.readdirSync(DST_ART, { withFileTypes: true })) {
  if (ent.isFile() && ent.name.endsWith('.md')) {
    fs.unlinkSync(path.join(DST_ART, ent.name))
  }
}

let n = 0
if (fs.existsSync(SRC_GEN)) {
  for (const ent of fs.readdirSync(SRC_GEN, { withFileTypes: true })) {
    if (!ent.isFile() || !ent.name.endsWith('.md')) continue
    fs.copyFileSync(path.join(SRC_GEN, ent.name), path.join(DST_ART, ent.name))
    n++
  }
}

console.log(`synced manifest -> ${path.join(DST, 'manifest.json')}`)
console.log(`synced ${n} article(s) -> ${DST_ART}`)
