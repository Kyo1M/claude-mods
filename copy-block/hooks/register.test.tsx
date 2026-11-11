import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

const lines = (...rows: string[]) => rows.join('\n')

const HANDOFF = lines('引き継ぎ文です。', '', '```', '# 引き継ぎ', '## 目的', '```', '', '以上です。')

const message = (text: string, more: { isFirstOfReply?: boolean; isSummary?: true } = {}) =>
  ({
    plugin: 'copy-block',
    surface: 'terminal',
    component: 'AssistantMessage',
    requestId: 'm1',
    props: { text, isFirstOfReply: more.isFirstOfReply ?? true, ...(more.isSummary ? { isSummary: true as const } : {}) },
  }) as const

type On = Parameters<TestBody>[1]

/** 本体の代わりに、渡された本文と「⏺」の有無を 1 行で描く */
function standInForEngine(on: On) {
  const drawn: { text: string; isFirstOfReply: boolean }[] = []
  const copied: string[] = []
  const toasts: string[] = []
  const answer = { isCopied: true as boolean }
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    if (e.component !== 'AssistantMessage') return <Text>other</Text>
    drawn.push({ text: e.props.text, isFirstOfReply: e.props.isFirstOfReply })
    return <Text>{`${e.props.isFirstOfReply ? '⏺ ' : ''}${e.props.text}`}</Text>
  })
  on('ui.copy', (_, e) => {
    copied.push(e.text)
    return { value: answer.isCopied ? { isCopied: true } : { isCopied: false, reason: 'no-clipboard' } }
  })
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  return { drawn, copied, toasts, answer }
}

test('ブロックのアイコンを押すと、中身をそのままコピーする', async ($, on) => {
  const { copied, toasts } = standInForEngine(on)
  const ui = await $.ui.mount(message(HANDOFF))

  expect(await ui.findAll({ type: 'Button' })).toHaveLength(1)
  await ui.press({ key: 'copy-1' })

  expect(copied).toEqual([lines('# 引き継ぎ', '## 目的')])
  expect(toasts).toEqual(['コピーしました(2行)'])
  await ui.unmount()
})

test('本文を区切りごとに本体へ渡し、「⏺」は最初の区切りだけにする', async ($, on) => {
  const { drawn } = standInForEngine(on)
  const ui = await $.ui.mount(message(HANDOFF))

  expect(drawn).toEqual([
    { text: '引き継ぎ文です。', isFirstOfReply: true },
    { text: lines('```', '# 引き継ぎ', '## 目的', '```'), isFirstOfReply: false },
    { text: '以上です。', isFirstOfReply: false },
  ])
  await ui.unmount()
})

test('「⏺」の付かない返答では、どの区切りにも付けない', async ($, on) => {
  const { drawn } = standInForEngine(on)
  const ui = await $.ui.mount(message(HANDOFF, { isFirstOfReply: false }))

  expect(drawn.map(row => row.isFirstOfReply)).toEqual([false, false, false])
  await ui.unmount()
})

test('ブロックが複数あるときは、押したブロックだけをコピーする', async ($, on) => {
  const { copied } = standInForEngine(on)
  const ui = await $.ui.mount(message(lines('```', '1 つ目', '```', '', 'Slack の文面です。', '', '```', '2 つ目', '```')))

  expect(await ui.findAll({ type: 'Button' })).toHaveLength(2)
  await ui.press({ key: 'copy-2' })

  expect(copied).toEqual(['2 つ目'])
  await ui.unmount()
})

test('対象のブロックが無い返答は、本体の描画のままにする', async ($, on) => {
  const { drawn } = standInForEngine(on)
  for (const text of ['こんにちは。', lines('例です。', '', '```ts', 'const a = 1', '```')]) {
    drawn.length = 0
    const ui = await $.ui.mount(message(text))

    expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
    expect(drawn).toEqual([{ text, isFirstOfReply: true }])
    await ui.unmount()
  }
})

test('要約の行は、本体の描画のままにする', async ($, on) => {
  const { drawn } = standInForEngine(on)
  const ui = await $.ui.mount(message(HANDOFF, { isSummary: true }))

  expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
  expect(drawn).toHaveLength(1)
  await ui.unmount()
})

test('コピーできなかったときは、そう知らせる', async ($, on) => {
  const { toasts, answer } = standInForEngine(on)
  answer.isCopied = false
  const ui = await $.ui.mount(message(HANDOFF))

  await ui.press({ key: 'copy-1' })

  expect(toasts).toEqual(['コピーできませんでした'])
  await ui.unmount()
})

test('ターミナル以外では、本体の描画のままにする', async ($, on) => {
  const { drawn } = standInForEngine(on)
  for (const surface of ['desktop', 'vscode', 'mobile'] as const) {
    drawn.length = 0
    const ui = await $.ui.mount({ ...message(HANDOFF), surface })

    expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
    expect(drawn).toHaveLength(1)
    await ui.unmount()
  }
})
