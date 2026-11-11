import { expect, test } from 'claude-code/testing'

import { splitBlocks } from './blocks'

const lines = (...rows: string[]) => rows.join('\n')

test('言語指定の無いブロックを前後の文と分ける', async () => {
  const text = lines('引き継ぎ文です。', '', '```', '# 引き継ぎ', '', '## 目的', '```', '', '以上です。')

  expect(splitBlocks(text)).toEqual([
    { kind: 'text', raw: '引き継ぎ文です。' },
    { kind: 'block', raw: lines('```', '# 引き継ぎ', '', '## 目的', '```'), body: lines('# 引き継ぎ', '', '## 目的') },
    { kind: 'text', raw: '以上です。' },
  ])
})

test('markdown・md・text・txt のブロックも対象にする', async () => {
  for (const language of ['markdown', 'md', 'text', 'txt', 'Markdown']) {
    const segments = splitBlocks(lines('```' + language, '本文', '```'))

    expect(segments).toEqual([{ kind: 'block', raw: lines('```' + language, '本文', '```'), body: '本文' }])
  }
})

test('コードのブロックは文に含める', async () => {
  const text = lines('例です。', '', '```ts', 'const a = 1', '```', '', '以上です。')

  expect(splitBlocks(text)).toEqual([{ kind: 'text', raw: text }])
})

test('コードのブロックの中の ``` を数えない', async () => {
  const text = lines('````ts', 'const s = `', '```', '`', '````', '', '```', '文面', '```')

  expect(splitBlocks(text)).toEqual([
    { kind: 'text', raw: lines('````ts', 'const s = `', '```', '`', '````') },
    { kind: 'block', raw: lines('```', '文面', '```'), body: '文面' },
  ])
})

test('4 つの ` で囲んだブロックは、中の ``` ごとコピーする', async () => {
  const text = lines('````', '次を実行する。', '```', 'ls', '```', '````')

  expect(splitBlocks(text)).toEqual([
    { kind: 'block', raw: text, body: lines('次を実行する。', '```', 'ls', '```') },
  ])
})

test('~~~ のブロックも対象にする', async () => {
  expect(splitBlocks(lines('~~~', '文面', '~~~'))).toEqual([
    { kind: 'block', raw: lines('~~~', '文面', '~~~'), body: '文面' },
  ])
})

test('閉じていないブロックは文として扱う', async () => {
  const text = lines('引き継ぎ文です。', '', '```', '# 引き継ぎ')

  expect(splitBlocks(text)).toEqual([{ kind: 'text', raw: text }])
})

test('字下げされたブロックは文に含める', async () => {
  const text = lines('- 手順', '  ```', '  文面', '  ```', '- 次の手順')

  expect(splitBlocks(text)).toEqual([{ kind: 'text', raw: text }])
})

test('中身の無いブロックは文に含める', async () => {
  const text = lines('```', '', '```')

  expect(splitBlocks(text)).toEqual([{ kind: 'text', raw: text }])
})

test('続けて並ぶブロックは、間の空行を区切りにしない', async () => {
  const text = lines('```', '1 つ目', '```', '', '```', '2 つ目', '```')

  expect(splitBlocks(text)).toEqual([
    { kind: 'block', raw: lines('```', '1 つ目', '```'), body: '1 つ目' },
    { kind: 'block', raw: lines('```', '2 つ目', '```'), body: '2 つ目' },
  ])
})

test('ブロックの中身は、行頭と行末の空白を変えない', async () => {
  const text = lines('```', '  字下げ  ', '', '\t末尾', '```')

  expect(splitBlocks(text)).toEqual([{ kind: 'block', raw: text, body: lines('  字下げ  ', '', '\t末尾') }])
})

test('ブロックの無い文は 1 区切りで返す', async () => {
  expect(splitBlocks('こんにちは。')).toEqual([{ kind: 'text', raw: 'こんにちは。' }])
  expect(splitBlocks('')).toEqual([])
})
