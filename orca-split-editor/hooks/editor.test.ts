import { expect, test } from 'claude-code/testing'

import type { Editing } from '../types'
import { ORCA, startEdit } from './editor'
import type { Deps, RunResult } from './editor'

const SPLIT_OK = JSON.stringify({ ok: true, result: { split: { handle: 'term_new' } } })

const WAIT_DONE = JSON.stringify({ ok: true, result: { wait: { satisfied: true, status: 'exited' } } })
const WAIT_TIMEOUT = JSON.stringify({ ok: false, error: { code: 'timeout', message: 'timeout' } })

function fakeDeps(opts: {
  env?: string
  split?: RunResult
  afterEdit?: string
  editing?: Editing | null
  waits?: string[]
  prompt?: string
  clipboard?: string | Error
}) {
  const files = new Map<string, string>()
  const calls: string[][] = []
  const toasts: string[] = []
  let prompt = opts.prompt ?? 'abc'
  let editing: Editing | null = opts.editing ?? null
  const waits = [...(opts.waits ?? [WAIT_DONE])]
  const deps: Deps = {
    run: async argv => {
      calls.push([...argv])
      if (argv[0] === '/usr/bin/env') return { exitCode: 0, stdout: opts.env ?? '', stderr: '' }
      if (argv[2] === 'split') return opts.split ?? { exitCode: 0, stdout: SPLIT_OK, stderr: '' }
      return { exitCode: 0, stdout: '{"ok":true}', stderr: '' }
    },
    runLong: async argv => {
      calls.push([...argv])
      const stdout = waits.shift() ?? WAIT_DONE
      // 終了を返すときは、エディタで書き換えて閉じたことにする
      if (stdout === WAIT_DONE) {
        for (const path of files.keys()) files.set(path, opts.afterEdit ?? files.get(path)!)
      }
      return { exitCode: stdout === WAIT_DONE ? 0 : 1, stdout, stderr: '' }
    },
    readPrompt: async () => prompt,
    readClipboard: async () => {
      if (opts.clipboard instanceof Error) throw opts.clipboard
      return opts.clipboard ?? ''
    },
    fillPrompt: async text => {
      prompt = text
      return true
    },
    readFile: async path => files.get(path)!,
    writeFile: async (path, text) => {
      files.set(path, text)
    },
    now: async () => 1,
    toast: text => {
      toasts.push(text)
    },
    getEditing: async () => editing,
    setEditing: async value => {
      editing = value
    },
  }
  return { deps, calls, toasts, files, prompt: () => prompt, editing: () => editing }
}

const ORCA_ENV = 'ORCA_TERMINAL_HANDLE=term_me\nVISUAL=hx\n'

test('分割してエディタで書いた文がプロンプト欄に入る', async () => {
  const f = fakeDeps({ env: ORCA_ENV, afterEdit: 'xyz\n' })
  await startEdit(f.deps)
  expect(f.prompt()).toBe('xyz')
  const split = f.calls.find(c => c[2] === 'split')!
  expect(split).toEqual([
    ORCA, 'terminal', 'split', '--terminal', 'term_me', '--direction', 'horizontal',
    '--command', 'exec hx /tmp/claude-orca-split-editor/draft-1.md', '--json',
  ])
  expect(f.files.size).toBe(1)
  expect(f.calls.some(c => c[2] === 'close' && c[4] === 'term_new')).toBe(true)
  expect(f.editing()).toBe(null)
  expect(f.toasts).toEqual([])
})

test('Orca の外では分割せずに知らせる', async () => {
  const f = fakeDeps({ env: 'VISUAL=hx\n' })
  await startEdit(f.deps)
  expect(f.calls.some(c => c[2] === 'split')).toBe(false)
  expect(f.toasts).toHaveLength(1)
  expect(f.prompt()).toBe('abc')
})

test('分割に失敗したら知らせて待機中のまま', async () => {
  const f = fakeDeps({ env: ORCA_ENV, split: { exitCode: 1, stdout: '', stderr: 'terminal_handle_stale\nmore' } })
  await startEdit(f.deps)
  expect(f.toasts).toEqual(['分割できませんでした: terminal_handle_stale'])
  expect(f.editing()).toBe(null)
  expect(f.prompt()).toBe('abc')
})

test('編集中にもう一度呼ぶと分割ペインへ移るだけ', async () => {
  const f = fakeDeps({ env: ORCA_ENV, editing: { handle: 'term_old', file: '/tmp/x.md' } })
  await startEdit(f.deps)
  expect(f.calls.some(c => c[2] === 'split')).toBe(false)
  expect(f.calls.some(c => c[2] === 'focus' && c[4] === 'term_old')).toBe(true)
  expect(f.editing()).toEqual({ handle: 'term_old', file: '/tmp/x.md' })
})

test('待ちの上限が切れたら待ち直し、閉じてから取り込む', async () => {
  const f = fakeDeps({ env: ORCA_ENV, afterEdit: 'long\n', waits: [WAIT_TIMEOUT, WAIT_DONE] })
  await startEdit(f.deps)
  const kinds = f.calls.map(c => c[2]).filter(k => k === 'wait' || k === 'close')
  expect(kinds).toEqual(['wait', 'wait', 'close'])
  expect(f.prompt()).toBe('long')
})

test('終了を確認できなければペインを閉じず取り込まない', async () => {
  const f = fakeDeps({ env: ORCA_ENV, afterEdit: 'xyz', waits: ['not json'] })
  await startEdit(f.deps)
  expect(f.calls.some(c => c[2] === 'close')).toBe(false)
  expect(f.prompt()).toBe('abc')
  expect(f.editing()).toBe(null)
  expect(f.toasts).toHaveLength(1)
})

test('折りたたまれた貼り付けをクリップボードの中身に戻して開き、そのまま入れる', async () => {
  const f = fakeDeps({
    env: ORCA_ENV,
    prompt: 'see [Pasted text #1 +2 lines] end',
    clipboard: 'a\r\nb\tc\n',
  })
  await startEdit(f.deps)
  expect([...f.files.values()]).toEqual(['see a\nb    c\n end'])
  expect(f.prompt()).toBe('see a\nb    c\n end')
  expect(f.toasts).toEqual([])
})

test('クリップボードと行数が合わなければ折りたたんだまま開いて知らせる', async () => {
  const f = fakeDeps({ env: ORCA_ENV, prompt: 'x [Pasted text #1 +5 lines]', clipboard: 'other' })
  await startEdit(f.deps)
  expect([...f.files.values()]).toEqual(['x [Pasted text #1 +5 lines]'])
  expect(f.toasts).toHaveLength(1)
})

test('貼り付けが複数あれば最後のものだけ戻す', async () => {
  const f = fakeDeps({
    env: ORCA_ENV,
    prompt: '[Pasted text #1 +3 lines] / [Pasted text #2]',
    clipboard: 'long single line',
  })
  await startEdit(f.deps)
  expect([...f.files.values()]).toEqual(['[Pasted text #1 +3 lines] / long single line'])
  expect(f.toasts).toEqual(['貼り付け 1 件はクリップボードと合わないため、折りたたんだまま開きます'])
})

test('クリップボードを読めなければ折りたたんだまま開いて知らせる', async () => {
  const f = fakeDeps({ env: ORCA_ENV, prompt: '[Pasted text #1]', clipboard: new Error('pbpaste') })
  await startEdit(f.deps)
  expect([...f.files.values()]).toEqual(['[Pasted text #1]'])
  expect(f.toasts).toHaveLength(1)
})
