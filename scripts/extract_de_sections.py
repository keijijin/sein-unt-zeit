#!/usr/bin/env python3
"""PDF（Sein und Zeit）から本文§ごとのドイツ語テキストを抽出し web/public/data/de-sections.json を生成する。"""

from __future__ import annotations

import json
import re
from pathlib import Path

from pdfminer.high_level import extract_text

ROOT = Path(__file__).resolve().parents[1]
PDF = ROOT / "doc" / "Heidegger_Sein_und_Zeit.pdf"
OUT = ROOT / "web" / "public" / "data" / "de-sections.json"

# 目次・表紙を除き、本文が始まる付近（0始まりページ番号）
FIRST_BODY_PAGE = 12

# §見出し: 「§ 1. 」「§ 42, 」「§ 49- 」「§ 57 Das」のような揺れを吸収
SECTION_HEAD = re.compile(
    r"(?:^|\n)§\s*(\d+)(?:[.,]\s*|-\s+|\s{1,3}(?=[A-ZÄÖÜ„\"»\(0-9]))",
    re.MULTILINE,
)


def normalize(text: str) -> str:
    text = text.replace("\x0c", "\n")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def main() -> None:
    if not PDF.exists():
        raise SystemExit(f"PDF not found: {PDF}")

    raw = extract_text(str(PDF), page_numbers=list(range(FIRST_BODY_PAGE, 450)))
    matches = list(SECTION_HEAD.finditer(raw))
    if len(matches) != 83:
        raise SystemExit(f"expected 83 § headings, found {len(matches)}")

    sections: dict[str, str] = {}
    for i, m in enumerate(matches):
        n = int(m.group(1))
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(raw)
        body = raw[start:end]
        body = normalize(body)
        sections[str(n)] = body

    keys = sorted(sections.keys(), key=int)
    if keys != [str(i) for i in range(1, 84)]:
        raise SystemExit(f"unexpected keys: {keys[:5]}…")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(sections, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {OUT} ({OUT.stat().st_size // 1024} KiB)")


if __name__ == "__main__":
    main()
