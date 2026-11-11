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
  const copied: { text: string; surface: string | undefined }[] = []
  const toasts: string[] = []
  const answer = { isCopied: true as boolean, throws: false }
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    if (e.component !== 'AssistantMessage') return <Text>other</Text>
    drawn.push({ text: e.props.text, isFirstOfReply: e.props.isFirstOfReply })
    return <Text>{`${e.props.isFirstOfReply ? '⏺ ' : ''}${e.props.text}`}</Text>
  })
  on('ui.copy', (_, e) => {
    if (answer.throws) throw new Error('clipboard')
    copied.push({ text: e.text, surface: e.surface })
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

  expect(copied).toEqual([{ text: lines('# 引き継ぎ', '## 目的'), surface: 'terminal' }])
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
    // 木が通らなかったときに備えて、最後に全文を渡す
    { text: HANDOFF, isFirstOfReply: true },
  ])
  await ui.unmount()
})

test('「⏺」の付かない返答では、どの区切りにも付けない', async ($, on) => {
  const { drawn } = standInForEngine(on)
  const ui = await $.ui.mount(message(HANDOFF, { isFirstOfReply: false }))

  expect(drawn.map(row => row.isFirstOfReply)).toEqual([false, false, false, false])
  await ui.unmount()
})

test('ブロックが複数あるときは、押したブロックだけをコピーする', async ($, on) => {
  const { copied } = standInForEngine(on)
  const ui = await $.ui.mount(message(lines('```', '1 つ目', '```', '', 'Slack の文面です。', '', '```', '2 つ目', '```')))

  expect(await ui.findAll({ type: 'Button' })).toHaveLength(2)
  await ui.press({ key: 'copy-2' })

  expect(copied.map(c => c.text)).toEqual(['2 つ目'])
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

test('クリップボードへの書き込みが失敗で終わっても、そう知らせる', async ($, on) => {
  const { toasts, answer } = standInForEngine(on)
  answer.throws = true
  const ui = await $.ui.mount(message(HANDOFF))

  await ui.press({ key: 'copy-1' })

  expect(toasts).toEqual(['コピーできませんでした'])
  await ui.unmount()
})

test('ブロックから始まる返答では、「⏺」をブロックの区切りに付ける', async ($, on) => {
  const { drawn, copied } = standInForEngine(on)
  const ui = await $.ui.mount(message(lines('```', '先頭', '```', '', '説明の文です。')))

  await ui.press({ key: 'copy-0' })

  expect(drawn.slice(0, 2)).toEqual([
    { text: lines('```', '先頭', '```'), isFirstOfReply: true },
    { text: '説明の文です。', isFirstOfReply: false },
  ])
  expect(copied.map(c => c.text)).toEqual(['先頭'])
  await ui.unmount()
})

test('2 つ目以降の区切りを 2 桁右へずらし、アイコンをブロックの上の行の右端に重ねる', async ($, on) => {
  standInForEngine(on)
  const ui = await $.ui.mount(message(HANDOFF))

  const boxes = await ui.findAll({ type: 'Box' })
  expect(boxes.map(box => box.props.paddingLeft).filter(padding => padding !== undefined)).toEqual([0, 2, 2])
  const overlay = boxes.filter(box => box.props.position === 'absolute')
  expect(overlay.map(box => [box.props.top, box.props.right])).toEqual([[0, 0]])
  const button = await ui.find({ key: 'copy-1' })
  expect([button?.props.label, button?.props.plain, button?.props.dimColor]).toEqual(['⧉', true, true])
  await ui.unmount()
})

test('「⏺」の付かない返答では、区切りを右へずらさない', async ($, on) => {
  standInForEngine(on)
  const ui = await $.ui.mount(message(HANDOFF, { isFirstOfReply: false }))

  const boxes = await ui.findAll({ type: 'Box' })
  expect(boxes.map(box => box.props.paddingLeft).filter(padding => padding !== undefined)).toEqual([0, 0, 0])
  await ui.unmount()
})

test('fullscreen でない表示では、本体の描画のままにする', async ($, on) => {
  const { drawn } = standInForEngine(on)
  const ui = await $.ui.mount({ ...message(HANDOFF), viewport: { columns: 100, rows: 40, isFullscreen: false } })

  expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
  expect(drawn).toHaveLength(1)
  await ui.unmount()
})

test('fullscreen の表示では、アイコンを出す', async ($, on) => {
  standInForEngine(on)
  const ui = await $.ui.mount({ ...message(HANDOFF), viewport: { columns: 100, rows: 40, isFullscreen: true } })

  expect(await ui.findAll({ type: 'Button' })).toHaveLength(1)
  await ui.unmount()
})
