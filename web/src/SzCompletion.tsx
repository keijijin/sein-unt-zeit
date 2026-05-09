import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { marked } from 'marked'
import mermaid from 'mermaid'

export type SzCompletionSection = {
  id: string
  title: string
}

export type SzCompletionChapter = {
  key: string
  label: string
  sections: SzCompletionSection[]
}

export type SzCompletionPart = {
  key: string
  label: string
  chapters: SzCompletionChapter[]
}

export type SzCompletionManifest = {
  version: number
  title: string
  description?: string
  parts: SzCompletionPart[]
}

/** Vite の base（サブディレクトリ配信時も動くようにする） */
function publicAssetUrl(path: string): string {
  const base = import.meta.env.BASE_URL || '/'
  const normalized = path.startsWith('/') ? path.slice(1) : path
  if (base === '/' || base === '') return `/${normalized}`
  const prefix = base.endsWith('/') ? base : `${base}/`
  return `${prefix}${normalized}`
}

const MANIFEST_URL = publicAssetUrl('sz-completion/manifest.json')
const ARTICLE_BASE = publicAssetUrl('sz-completion/articles')

function unescapeHtml(s: string) {
  return s
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
}

function flattenSections(m: SzCompletionManifest): SzCompletionSection[] {
  const out: SzCompletionSection[] = []
  for (const p of m.parts) {
    for (const c of p.chapters) {
      for (const s of c.sections) out.push(s)
    }
  }
  return out
}

type Props = {
  onBack: () => void
}

export function SzCompletion({ onBack }: Props) {
  const [manifest, setManifest] = useState<SzCompletionManifest | null>(null)
  const [manifestErr, setManifestErr] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [md, setMd] = useState<string | null>(null)
  const [mdErr, setMdErr] = useState<string | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(MANIFEST_URL)
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
        const data = (await res.json()) as SzCompletionManifest
        if (!cancelled) {
          setManifest(data)
          setManifestErr(null)
          const first = data.parts[0]?.chapters[0]?.sections[0]?.id ?? null
          setSelectedId(first)
        }
      } catch (e) {
        if (!cancelled) {
          setManifest(null)
          setManifestErr(e instanceof Error ? e.message : String(e))
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'default' })
  }, [])

  useEffect(() => {
    if (!selectedId) return
    let cancelled = false
    setMd(null)
    setMdErr(null)
    const url = `${ARTICLE_BASE}/${selectedId}.md`
    ;(async () => {
      try {
        const res = await fetch(url)
        if (!res.ok) {
          if (res.status === 404) {
            if (!cancelled)
              setMdErr(
                'この節の原稿はまだありません。リポジトリルートで API キーを設定し、web ディレクトリから npm run completion:gen を実行後、npm run completion:sync を実行してください。',
              )
            return
          }
          throw new Error(`${res.status} ${res.statusText}`)
        }
        const text = await res.text()
        if (!cancelled) {
          setMd(text)
          setMdErr(null)
        }
      } catch (e) {
        if (!cancelled) setMdErr(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [selectedId])

  const overviewHtml = useMemo(() => {
    if (!md) return null
    marked.setOptions({ gfm: true, breaks: false, async: false } as any)
    const raw = marked.parse(md) as unknown as string
    return String(raw)
      .replaceAll(
        /<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>/g,
        (_m: string, code: string) => `<pre class="mermaid">${unescapeHtml(code)}</pre>`,
      )
      .replaceAll(/<pre class="mermaid">\s*<\/pre>/g, '')
  }, [md])

  useEffect(() => {
    if (!overviewHtml) return
    const el = bodyRef.current
    if (!el) return
    ;(async () => {
      try {
        await mermaid.run({ nodes: el.querySelectorAll('.mermaid') })
      } catch {
        // ignore
      }
    })()
  }, [overviewHtml, selectedId])

  const flat = useMemo(() => (manifest ? flattenSections(manifest) : []), [manifest])

  const select = useCallback((id: string) => {
    setSelectedId(id)
  }, [])

  return (
    <div className="sz-completion">
      <header className="sz-completion__top">
        <div className="sz-completion__brand">
          <button type="button" className="ghost sz-completion__back" onClick={onBack}>
            ← 読書室に戻る
          </button>
          <div>
            <h1 className="sz-completion__title">{manifest?.title ?? '内的完結稿'}</h1>
            <p className="sz-completion__sub">
              『存在と時間』既刊の論理から続く第三編・第二部の各節原稿。生成は <code>npm run completion:gen</code>、公開用コピーは{' '}
              <code>npm run completion:sync</code>。
            </p>
          </div>
        </div>
      </header>

      {manifestErr && (
        <p className="de-status de-status--err sz-completion__banner">
          マニフェストを読み込めませんでした（{manifestErr}）。<code>npm run completion:sync</code> を実行し、
          <code>web/public/sz-completion/manifest.json</code> を配置してください。
        </p>
      )}

      {manifest && (
        <div className="sz-completion__grid">
          <nav className="sz-completion__toc" aria-label="内的完結稿 目次">
            {manifest.parts.map((p) => (
              <div key={p.key} className="sz-completion__part">
                <div className="sz-completion__part-label">{p.label}</div>
                {p.chapters.map((c) => (
                  <div key={c.key} className="sz-completion__chapter">
                    <div className="sz-completion__chapter-label">{c.label}</div>
                    <ul className="sz-completion__sec-list">
                      {c.sections.map((s) => (
                        <li key={s.id}>
                          <button
                            type="button"
                            className={`sz-completion__sec ${selectedId === s.id ? 'is-active' : ''}`}
                            onClick={() => select(s.id)}
                          >
                            <span className="sz-completion__sec-id">{s.id}</span>
                            <span className="sz-completion__sec-title">{s.title}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ))}
          </nav>

          <section className="sz-completion__main" aria-label="本文">
            <div className="sz-completion__main-head">
              <span className="muted">
                {selectedId ? `${flat.findIndex((x) => x.id === selectedId) + 1} / ${flat.length}` : ''}
              </span>
            </div>
            <div className="sz-completion__body">
              {mdErr && <p className="de-status de-status--err">{mdErr}</p>}
              {!mdErr && md === null && selectedId && <p className="de-status">読み込み中…</p>}
              {!mdErr && overviewHtml && (
                <div className="overview-html sz-completion__html" ref={bodyRef} dangerouslySetInnerHTML={{ __html: overviewHtml }} />
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
