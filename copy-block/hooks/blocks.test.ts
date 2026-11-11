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

test('深く字下げされた ``` は、ブロックの中身として扱う', async () => {
  const text = lines('```', '手順:', '', '1. 次を実行', '', '    ```', '    ls', '    ```', '', '2. 終わり', '```', '', '以上')

  expect(splitBlocks(text)).toEqual([
    {
      kind: 'block',
      raw: lines('```', '手順:', '', '1. 次を実行', '', '    ```', '    ls', '    ```', '', '2. 終わり', '```'),
      body: lines('手順:', '', '1. 次を実行', '', '    ```', '    ls', '    ```', '', '2. 終わり'),
    },
    { kind: 'text', raw: '以上' },
  ])
  expect(splitBlocks(lines('```', '前半', '\t```', '後半', '```'))).toEqual([
    { kind: 'block', raw: lines('```', '前半', '\t```', '後半', '```'), body: lines('前半', '\t```', '後半') },
  ])
})

test('箇条書きの記号と同じ行で始まるブロックの後も、対象のブロックを拾う', async () => {
  const list = lines('- ```ts', '  const a = 1', '  ```')

  expect(splitBlocks(lines(list, '', '```text', '引き継ぎ文', '```'))).toEqual([
    { kind: 'text', raw: list },
    { kind: 'block', raw: lines('```text', '引き継ぎ文', '```'), body: '引き継ぎ文' },
  ])
})

test('箇条書きの中の閉じていない ``` は、後ろの対象のブロックを巻き込まない', async () => {
  for (const head of [lines('- 手順', '  ```sh', '  ls'), lines('    ```', '    説明'), lines('> ```', '> 引用')]) {
    expect(splitBlocks(lines(head, '', '```', '文面', '```'))).toEqual([
      { kind: 'text', raw: head },
      { kind: 'block', raw: lines('```', '文面', '```'), body: '文面' },
    ])
  }
})

test('閉じたブロックの後の閉じていないブロックは文として扱う', async () => {
  expect(splitBlocks(lines('```', '1 つ目', '```', '', '```', '途中'))).toEqual([
    { kind: 'block', raw: lines('```', '1 つ目', '```'), body: '1 つ目' },
    { kind: 'text', raw: lines('```', '途中') },
  ])
})

test('``` と ~~~ は互いを閉じない', async () => {
  const text = lines('```', '文面', '~~~', '続き', '```')

  expect(splitBlocks(text)).toEqual([{ kind: 'block', raw: text, body: lines('文面', '~~~', '続き') }])
})

test('言語指定に ` を含む行は、ブロックの始まりにしない', async () => {
  const text = lines('``` `a` ```', '文です。')

  expect(splitBlocks(text)).toEqual([{ kind: 'text', raw: text }])
})

test('言語指定の後ろの属性は、言語の判定に使わない', async () => {
  expect(splitBlocks(lines('```markdown title="x"', '文面', '```'))).toHaveLength(1)
  expect(splitBlocks(lines('```markdown title="x"', '文面', '```'))[0]?.kind).toBe('block')
  expect(splitBlocks(lines('```ts title="x"', 'const a = 1', '```'))[0]?.kind).toBe('text')
})

test('前後に空行の無いブロックと、中身の先頭と末尾の空行', async () => {
  expect(splitBlocks(lines('前の文', '```', '', '文面', '', '```', '後の文'))).toEqual([
    { kind: 'text', raw: '前の文' },
    { kind: 'block', raw: lines('```', '', '文面', '', '```'), body: lines('', '文面', '') },
    { kind: 'text', raw: '後の文' },
  ])
})

test('改行が CRLF の本文でも対象のブロックを拾う', async () => {
  const segments = splitBlocks('```text\r\n1 行目\r\n2 行目\r\n```')

  expect(segments).toEqual([{ kind: 'block', raw: '```text\r\n1 行目\r\n2 行目\r\n```', body: '1 行目\r\n2 行目\r' }])
})

test('参照形式のリンクの定義を持つ本文は区切らない', async () => {
  const text = lines('[資料][ref]', '', '```', '文面', '```', '', '[ref]: https://example.com')

  expect(splitBlocks(text)).toEqual([{ kind: 'text', raw: text }])
})

test('ブロックの中の定義に見える行は、区切りを妨げない', async () => {
  const text = lines('```', '[ref]: https://example.com', '```')

  expect(splitBlocks(text)).toEqual([{ kind: 'block', raw: text, body: '[ref]: https://example.com' }])
})
