/** 返答の本文を、コピーの対象のブロックとそれ以外に分けた 1 区切り */
export type Segment =
  | { kind: 'text'; raw: string }
  | {
      kind: 'block'
      /** 囲みの行を含む、描画に渡す文 */
      raw: string
      /** 囲みの行を除いた、コピーする中身 */
      body: string
    }

/** 貼り付けて使う文面とみなす言語指定(指定なしは '') */
const COPY_LANGUAGES = new Set(['', 'markdown', 'md', 'text', 'txt'])

/** 行頭から数えて、ここまでの空白なら箇条書きの外のブロックとみなす */
const MAX_TOP_INDENT = 3

type Fence = {
  /** 行頭の空白の桁数(タブは 4 桁) */
  indent: number
  /** 箇条書き・引用の記号の桁数。記号の無い行は 0 */
  prefix: number
  mark: string
  language: string
  /** 箇条書きや引用の中にあるブロックか */
  isNested: boolean
}

const OPEN = /^([ \t]*)((?:(?:[-*+]|\d{1,9}[.)])[ \t]+|>[ \t]?)*)(`{3,}|~{3,})([^\n]*)$/
const LIST_ITEM = /^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+/
const CLOSE = /^([ \t]*)(`{3,}|~{3,})[ \t]*\r?$/
/** 参照形式のリンクや脚注の定義(`[名前]: 行き先`) */
const REFERENCE = /^ {0,3}\[[^\]]+\]:[ \t]*\S/

const columns = (space: string) => [...space].reduce((sum, c) => sum + (c === '\t' ? 4 : 1), 0)

function openFence(line: string, isInList: boolean): Fence | null {
  const m = OPEN.exec(line)
  if (!m) return null
  const [, space = '', prefix = '', mark = '', info = ''] = m
  // ` の囲みは、言語指定に ` を含められない(行内のコードと区別するため)
  if (mark.startsWith('`') && info.includes('`')) return null
  const indent = columns(space)
  return {
    indent,
    prefix: prefix.length,
    mark,
    language: (info.trim().split(/\s+/)[0] ?? '').toLowerCase(),
    isNested: prefix.length > 0 || indent > MAX_TOP_INDENT || (indent > 0 && isInList),
  }
}

function isCloseOf(fence: Fence, line: string): boolean {
  const m = CLOSE.exec(line)
  if (!m) return false
  const [, space = '', mark = ''] = m
  if (mark[0] !== fence.mark[0] || mark.length < fence.mark.length) return false
  const indent = columns(space)
  // 箇条書きの外のブロックは、深く字下げされた ``` を中身として持てる
  if (!fence.isNested) return indent <= MAX_TOP_INDENT
  // 箇条書きの中のブロックは、箇条書きの外の ``` では閉じない
  return indent >= (fence.prefix > 0 ? fence.indent + 1 : Math.max(1, fence.indent - MAX_TOP_INDENT))
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
 * 対象は、行頭から始まり、閉じていて、空白以外の中身があり、言語指定が無いか
 * markdown・md・text・txt のブロック。それ以外のブロックは前後の文に含める。
 * 区切ると描画が変わる本文(参照形式のリンクの定義を持つもの)は区切らない。
 */
export function splitBlocks(text: string): Segment[] {
  const lines = text.split('\n')
  const segments: Segment[] = []
  let pending: string[] = []
  let hasReference = false
  let isInList = false

  const flushText = () => {
    const kept = trimBlankLines(pending)
    if (kept.length > 0) segments.push({ kind: 'text', raw: kept.join('\n') })
    pending = []
  }

  let i = 0
  while (i < lines.length) {
    const line = lines[i] ?? ''
    const fence = openFence(line, isInList)
    if (!fence) {
      if (REFERENCE.test(line)) hasReference = true
      // 箇条書きは、字下げの無い文が来るまで続くとみなす
      if (LIST_ITEM.test(line)) isInList = true
      else if (/^\S/.test(line)) isInList = false
      pending.push(line)
      i++
      continue
    }

    let close = i + 1
    while (close < lines.length && !isCloseOf(fence, lines[close] ?? '')) close++
    if (close >= lines.length) {
      // 箇条書きの中の閉じていない ``` は、その行だけを文にして先を読む
      if (fence.isNested) {
        pending.push(line)
        i++
        continue
      }
      // 閉じていないブロック(返答の途中)は、以降をすべて文として扱う
      pending.push(...lines.slice(i))
      break
    }

    const body = lines.slice(i + 1, close).join('\n')
    const isTarget =
      fence.indent === 0 && fence.prefix === 0 && COPY_LANGUAGES.has(fence.language) && body.trim() !== ''
    if (isTarget) {
      flushText()
      segments.push({ kind: 'block', raw: lines.slice(i, close + 1).join('\n'), body })
    } else {
      // 対象外のブロックは丸ごと文に含め、中の ``` を数えない
      pending.push(...lines.slice(i, close + 1))
    }
    // 行頭から始まるブロックは箇条書きを終わらせる
    if (fence.indent === 0 && fence.prefix === 0) isInList = false
    i = close + 1
  }

  flushText()
  // 定義と使う箇所が別の区切りに分かれると、リンクとして描かれなくなる
  if (hasReference) return text.trim() === '' ? [] : [{ kind: 'text', raw: text }]
  return segments
}
