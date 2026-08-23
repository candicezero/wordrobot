#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Build assets/dictionary.json from 《上海市中考英语考纲词汇默写本.pdf》.

Parsing logic ported from ../scripts/fix_wrong_sheet_from_pdf.py (verified).
Run on any machine with Python 3.10+ and PyMuPDF (`pip install pymupdf`):

    python tools/build_dictionary.py [--pdf PATH] [--dump PATH] [--out PATH]

Output format (word key = PDF word lowercased):
    { "ability": { "phonetic": "/ə'bɪləti/", "meaning": "n. 能力；才能",
                   "starred": false, "pdf_index": 2 } }
"""
from __future__ import annotations

import argparse
import io
import json
import re
import sys
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Optional

if sys.stdout.encoding and sys.stdout.encoding.lower() not in ('utf-8', 'utf8'):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

ROOT = Path(__file__).resolve().parents[1]          # WordRobot/
DEFAULT_PDF = ROOT.parent / 'WordTest' / '上海市中考英语考纲词汇默写本.pdf'
DEFAULT_DUMP = ROOT.parent / 'artifacts' / 'pdf_text_dump.txt'
DEFAULT_OUT = ROOT / 'assets' / 'dictionary.json'

INDEX_RE = re.compile(r'^(\d+)\.\s*$')
PAGE_JUNK_RE = re.compile(r'^(?:z|x|k|\.|c|o|m|zx|xx|zx\.xk\.com)$', re.I)
DEFAULT_PART2_MARKER = 'Part 2 上海市中学英语考纲词汇默写本【默写中文版】'


def extract_pdf_text(pdf_path: Path, dump_path: Optional[Path]) -> str:
    if dump_path is not None and dump_path.exists():
        return dump_path.read_text(encoding='utf-8')
    import fitz  # type: ignore

    doc = fitz.open(pdf_path.as_posix())
    text = '\n'.join(page.get_text() for page in doc)
    if dump_path is not None:
        dump_path.parent.mkdir(parents=True, exist_ok=True)
        dump_path.write_text(text, encoding='utf-8')
    return text


def is_junk_line(s: str) -> bool:
    if not s:
        return True
    if PAGE_JUNK_RE.match(s):
        return True
    if s.startswith('学科网') or s.startswith('上海中考英语') or s.startswith('考纲词汇默写本'):
        return True
    if s.startswith('Part') or s in {'序号', '单词默写', '音标', '词性&中文', '是否掌握'}:
        return True
    if s.isdigit():
        return True
    return False


def normalize_phonetic(parts: Iterable[str]) -> str:
    joined = ''.join(p.strip() for p in parts if p.strip())
    joined = re.sub(r'\s+', ' ', joined).strip()
    joined = joined.replace('/ /', '/').replace('//', '/')
    if joined and not joined.startswith('/'):
        joined = '/' + joined
    if joined and not joined.endswith('/'):
        joined = joined + '/'
    return joined


def parse_part2_chunk(idx: int, raw_lines: List[str]) -> Optional[Dict[str, Any]]:
    lines = [s.strip() for s in raw_lines if not is_junk_line(s.strip())]
    if not lines:
        return None

    word_line = ''
    word_pos = -1
    for i, line in enumerate(lines):
        if '/' in line:
            continue
        word_line = line
        word_pos = i
        break
    if not word_line:
        return None

    is_starred = word_line.startswith('*')
    word = re.sub(r'\s+', ' ', word_line.lstrip('*').strip())

    phonetic_parts: List[str] = []
    for line in lines[word_pos + 1:]:
        if '/' in line or phonetic_parts:
            phonetic_parts.append(line)
            if normalize_phonetic(phonetic_parts).count('/') >= 2 and line.endswith('/'):
                break
    phonetic = normalize_phonetic(phonetic_parts)

    return {
        'index': idx,
        'word': word,
        'phonetic': phonetic,
        'is_starred': is_starred,
        'meaning': '',
    }


POS_TAG_RE = re.compile(r'^(?:n|v|adj|adv|prep|conj|pron|num|int|interj|art|aux|abbr|vi|vt)\b\.', re.I)
CJK_RE = re.compile(r'[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]')


def is_meaning_line(line: str) -> bool:
    """Meaning-ish line: contains CJK or starts with a part-of-speech tag.

    Used to recover meanings whose phonetic line is missing/unclosed in the
    PDF text dump (e.g. happy/harm/steam), which the original state machine
    would skip.
    """
    return bool(CJK_RE.search(line) or POS_TAG_RE.match(line))


def parse_part1_meaning_chunk(idx: int, raw_lines: List[str]) -> str:
    lines = [s.strip() for s in raw_lines if not is_junk_line(s.strip())]
    if not lines:
        return ''

    meaning_lines: List[str] = []
    in_phonetic = False
    phonetic_seen = False
    for line in lines:
        if not phonetic_seen:
            if '/' in line:
                phonetic_seen = True
                if line.count('/') >= 2:
                    after = line.split('/', 2)[2].strip()
                    if after:
                        meaning_lines.append(after)
                    in_phonetic = False
                else:
                    in_phonetic = True
                continue
            if is_meaning_line(line):
                meaning_lines.append(line)
                continue
            continue

        if in_phonetic:
            if is_meaning_line(line):
                meaning_lines.append(line)
                in_phonetic = False
                continue
            if '/' in line:
                after = line.split('/', 1)[1].strip()
                if after:
                    meaning_lines.append(after)
                in_phonetic = False
                continue
            continue

        if '/' in line and not is_meaning_line(line):
            continue
        if not is_meaning_line(line) and re.fullmatch(r'[\s.,;()·]+', line):
            continue
        stripped_phonetic = re.match(r'^/[^/]*?/\s*(.+)$', line)
        if stripped_phonetic and is_meaning_line(stripped_phonetic.group(1)):
            line = stripped_phonetic.group(1)

        meaning_lines.append(line)

    return ' '.join(meaning_lines).strip()


def parse_indexed_chunks(lines: List[str], parser: Callable[[int, List[str]], Any]) -> Dict[int, Any]:
    by_idx: Dict[int, Any] = {}
    cur_idx: Optional[int] = None
    cur_lines: List[str] = []

    def flush() -> None:
        nonlocal cur_idx, cur_lines
        if cur_idx is None:
            return
        value = parser(cur_idx, cur_lines)
        if value:
            by_idx[cur_idx] = value
        cur_idx = None
        cur_lines = []

    for raw in lines:
        line = raw.strip()
        m = INDEX_RE.match(line)
        if m:
            flush()
            cur_idx = int(m.group(1))
            cur_lines = []
            continue
        if cur_idx is not None:
            cur_lines.append(line)
    flush()
    return by_idx


def build_word_map(text: str, part2_marker: str) -> Dict[str, Dict[str, Any]]:
    part2_pos = text.rfind(part2_marker)
    if part2_pos < 0:
        raise RuntimeError(f'Cannot locate Part 2 marker in PDF text: {part2_marker}')
    part1_lines = text[:part2_pos].splitlines()
    part2_lines = text[part2_pos:].splitlines()

    by_idx = parse_indexed_chunks(part2_lines, parse_part2_chunk)
    meanings = parse_indexed_chunks(part1_lines, parse_part1_meaning_chunk)

    rows: List[Dict[str, Any]] = []
    for idx in sorted(by_idx):
        row = by_idx[idx]
        row['meaning'] = meanings.get(idx, '')
        w = (row.get('word') or '').strip().lower()
        if not w:
            continue
        row['key'] = w
        rows.append(row)

    # Dedup by lowercased word: prefer entries with phonetic, then with meaning.
    word_map: Dict[str, Dict[str, Any]] = {}
    for row in rows:
        w = row['key']
        cur = word_map.get(w)
        if cur is None or _row_score(row) > _row_score(cur):
            merged = dict(row)
            if cur is not None:
                merged['meaning'] = row['meaning'] or cur['meaning']
                merged['phonetic'] = row['phonetic'] or cur['phonetic']
                merged['is_starred'] = bool(row['is_starred'] or cur['is_starred'])
            word_map[w] = merged

    return {w: {
        'phonetic': r['phonetic'],
        'meaning': r['meaning'],
        'starred': bool(r['is_starred']),
        'pdf_index': r['index'],
    } for w, r in word_map.items()}


def _row_score(row: Dict[str, Any]) -> int:
    return (2 if row.get('phonetic') else 0) + (1 if row.get('meaning') else 0)


def validate(word_map: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
    no_meaning = [w for w, r in word_map.items() if not r['meaning'].strip()]
    no_phonetic = [w for w, r in word_map.items() if not r['phonetic'].strip()]
    starred = [w for w, r in word_map.items() if r['starred']]
    samples = {w: word_map.get(w) for w in ('ability', 'about', 'laboratory', 'cafe', 'café', 'january')}
    return {
        'total_entries': len(word_map),
        'starred_count': len(starred),
        'missing_meaning': {'count': len(no_meaning), 'words': no_meaning[:20]},
        'missing_phonetic': {'count': len(no_phonetic), 'words': no_phonetic[:20]},
        'sample_lookup': samples,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description='Build dictionary.json from the workbook PDF.')
    parser.add_argument('--pdf', type=Path, default=DEFAULT_PDF)
    parser.add_argument('--dump', type=Path, default=DEFAULT_DUMP,
                        help='Text dump cache (reuse if present). Pass empty string to force re-extract.')
    parser.add_argument('--out', type=Path, default=DEFAULT_OUT)
    parser.add_argument('--part2-marker', default=DEFAULT_PART2_MARKER)
    args = parser.parse_args()

    dump = args.dump if str(args.dump) else None
    text = extract_pdf_text(args.pdf, dump)
    word_map = build_word_map(text, args.part2_marker)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(word_map, ensure_ascii=False, separators=(',', ':'))
    args.out.write_text(payload, encoding='utf-8')

    report = validate(word_map)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    size_kb = args.out.stat().st_size / 1024
    print(f'\nwrote {args.out} ({size_kb:.1f} KB, {len(word_map)} entries)')


if __name__ == '__main__':
    main()
