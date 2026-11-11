/** 返答の本文を、コピーの対象のブロックとそれ以外に分けた 1 区切り */
export type Segment =
  | { kind: 'text'; raw: string }
  | {
      kind: 'block'
      /** ``` の行を含む、描画に渡す文 */
      raw: string
      /** ``` の行を除いた、コピーする中身 */
      body: string
    }

/** 貼り付けて使う文面とみなす言語指定(指定なしは '') */
const COPY_LANGUAGES = new Set(['', 'markdown', 'md', 'text', 'txt'])

type Fence = { indent: string; mark: string; language: string }

function openFence(line: string): Fence | null {
  const m = /^(\s*)(`{3,}|~{3,})(.*)$/.exec(line)
  if (!m) return null
  const [, indent = '', mark = '', info = ''] = m
  // ` の囲みは、言語指定に ` を含められない(行内のコードと区別するため)
  if (mark.startsWith('`') && info.includes('`')) return null
  return { indent, mark, language: (info.trim().split(/\s+/)[0] ?? '').toLowerCase() }
}

function isCloseOf(fence: Fence, line: string): boolean {
  const m = /^\s*(`{3,}|~{3,})\s*$/.exec(line)
  const mark = m?.[1]
  return mark !== undefined && mark[0] === fence.mark[0] && mark.length >= fence.mark.length
}

function trimBlankLines(lines: string[]): string[] {
  let start = 0
  let end = lines.length
  while (start < end && lines[start]?.trim() === '') start++
  while (end > start && lines[end - 1]?.trim() === '') end--
  return lines.slice(start, end)
}

/**
 * 返答の本文を上から読み、コピーの対象のブロックの前後で区切る。
 *
 * 対象は、行頭から始まり、閉じていて、中身があり、言語指定が無いか
 * markdown・md・text・txt のブロック。それ以外のブロックは前後の文に含める。
 */
export function splitBlocks(text: string): Segment[] {
  const lines = text.split('\n')
  const segments: Segment[] = []
  let pending: string[] = []

  const flushText = () => {
    const kept = trimBlankLines(pending)
    if (kept.length > 0) segments.push({ kind: 'text', raw: kept.join('\n') })
    pending = []
  }

  let i = 0
  while (i < lines.length) {
    const line = lines[i] ?? ''
    const fence = openFence(line)
    if (!fence) {
      pending.push(line)
      i++
      continue
    }

    let close = i + 1
    while (close < lines.length && !isCloseOf(fence, lines[close] ?? '')) close++
    // 閉じていないブロック(返答の途中)は、以降をすべて文として扱う
    if (close >= lines.length) {
      pending.push(...lines.slice(i))
      break
    }

    const body = lines.slice(i + 1, close).join('\n')
    const isTarget = fence.indent === '' && COPY_LANGUAGES.has(fence.language) && body.trim() !== ''
    if (isTarget) {
      flushText()
      segments.push({ kind: 'block', raw: lines.slice(i, close + 1).join('\n'), body })
    } else {
      // 対象外のブロックは丸ごと文に含め、中の ``` を数えない
      pending.push(...lines.slice(i, close + 1))
    }
    i = close + 1
  }

  flushText()
  return segments
}
