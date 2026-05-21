import { useCallback, useEffect, useMemo, useState } from 'react'

import {
  FAQ_CATEGORIES,
  FAQ_DEFAULT_ID,
  FAQ_INTRO,
  flattenFaqItems,
  findFaqItem,
  type FaqItem,
} from './faqData'

import './Faq.css'

function publicAssetUrl(path: string): string {
  const base = import.meta.env.BASE_URL || '/'
  const normalized = path.startsWith('/') ? path.slice(1) : path
  if (base === '/' || base === '') return `/${normalized}`
  const prefix = base.endsWith('/') ? base : `${base}/`
  return `${prefix}${normalized}`
}

const MANGA_URL = publicAssetUrl('faq/question-and-answer-manga.png')

type Props = {
  onBack: () => void
}

function parseAnswerBlocks(text: string): Array<{ type: 'p' | 'ol'; content: string | string[] }> {
  const blocks: Array<{ type: 'p' | 'ol'; content: string | string[] }> = []
  const parts = text.split(/\n\n+/)
  let listItems: string[] | null = null

  const flushList = () => {
    if (listItems && listItems.length > 0) {
      blocks.push({ type: 'ol', content: listItems })
      listItems = null
    }
  }

  for (const part of parts) {
    const trimmed = part.trim()
    if (!trimmed) continue
    const lines = trimmed.split('\n')
    const allNumbered = lines.every((l) => /^\d+\.\s/.test(l.trim()))
    if (allNumbered && lines.length > 1) {
      flushList()
      blocks.push({
        type: 'ol',
        content: lines.map((l) => l.replace(/^\d+\.\s*/, '').trim()),
      })
      continue
    }
    if (/^\d+\.\s/.test(trimmed) && !trimmed.includes('\n')) {
      if (!listItems) listItems = []
      listItems.push(trimmed.replace(/^\d+\.\s*/, ''))
      continue
    }
    flushList()
    blocks.push({ type: 'p', content: trimmed })
  }
  flushList()
  return blocks
}

function FaqAnswer({ item }: { item: FaqItem }) {
  if (!item.answer) {
    return (
      <p className="faq-answer__pending">
        この問いへの回答は準備中です。<code>doc/FAQ.md</code> に追記後、<code>web/src/faqData.ts</code>{' '}
        を同期してください。
      </p>
    )
  }

  const blocks = parseAnswerBlocks(item.answer)
  return (
    <div className="faq-answer">
      {blocks.map((block, i) =>
        block.type === 'ol' ? (
          <ol key={i} className="faq-answer__ol">
            {(block.content as string[]).map((li, j) => (
              <li key={j}>{li}</li>
            ))}
          </ol>
        ) : (
          <p key={i}>{block.content as string}</p>
        ),
      )}
    </div>
  )
}

export function Faq({ onBack }: Props) {
  const flat = useMemo(() => flattenFaqItems(), [])
  const answeredCount = flat.filter((i) => i.answer).length

  const [selectedId, setSelectedId] = useState(FAQ_DEFAULT_ID)

  const select = useCallback((id: string) => {
    setSelectedId(id)
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href)
      url.hash = id
      window.history.replaceState(null, '', url)
    }
  }, [])

  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, '')
    if (hash && findFaqItem(hash)) setSelectedId(hash)
  }, [])

  const item = findFaqItem(selectedId) ?? findFaqItem(FAQ_DEFAULT_ID)!
  const index = flat.findIndex((x) => x.id === item.id)

  return (
    <div className="faq-page">
      <header className="faq-page__top">
        <div className="faq-page__brand">
          <button type="button" className="ghost faq-page__back" onClick={onBack}>
            ← 読書室に戻る
          </button>
          <div>
            <h1 className="faq-page__title">『存在と時間』FAQ</h1>
            <p className="faq-page__sub">
              ハイデガーに尋ねる想定の問いと回答（{answeredCount} / {flat.length} 件に回答あり）。原稿は{' '}
              <code>doc/FAQ.md</code>。
            </p>
          </div>
        </div>
      </header>

      <p className="faq-page__intro">{FAQ_INTRO}</p>

      <div className="faq-page__grid">
        <nav className="faq-page__toc" aria-label="FAQ 目次">
          {FAQ_CATEGORIES.map((cat) => (
            <div key={cat.id} className="faq-page__cat">
              <div className="faq-page__cat-label">{cat.title}</div>
              <ul className="faq-page__q-list">
                {cat.items.map((q) => (
                  <li key={q.id}>
                    <button
                      type="button"
                      className={`faq-page__q ${selectedId === q.id ? 'is-active' : ''} ${q.answer ? 'has-answer' : ''}`}
                      onClick={() => select(q.id)}
                    >
                      <span className="faq-page__q-label">{q.label}</span>
                      <span className="faq-page__q-text">{q.question}</span>
                      {q.answer ? (
                        <span className="faq-page__badge" aria-label="回答あり">
                          回答
                        </span>
                      ) : (
                        <span className="faq-page__badge faq-page__badge--pending" aria-label="準備中">
                          準備中
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <article className="faq-page__main" aria-labelledby="faq-question-heading">
          <div className="faq-page__main-head">
            <span className="muted">
              {index + 1} / {flat.length}
            </span>
            <span className="faq-page__main-label">{item.label}</span>
          </div>

          <div className="faq-page__body">
            {item.id === 'q-star-1' && (
              <figure className="faq-manga">
                <img
                  src={MANGA_URL}
                  alt="問いと答えのイラスト（マンガ風）"
                  width={400}
                  height={400}
                  loading="lazy"
                />
              </figure>
            )}

            <h2 id="faq-question-heading" className="faq-question">
              {item.question}
            </h2>

            {item.note && <p className="faq-note">{item.note}</p>}

            <section className="faq-answer-wrap" aria-label="回答">
              <h3 className="faq-answer__kicker">回答</h3>
              <FaqAnswer item={item} />
            </section>
          </div>
        </article>
      </div>
    </div>
  )
}
