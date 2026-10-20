import type { Editing } from '../types'

export const ORCA = '/Applications/Orca.app/Contents/Resources/bin/orca'
export const DRAFT_DIR = '/tmp/claude-orca-split-editor'

export type RunResult = { exitCode: number; stdout: string; stderr: string }

/** 外の世界との接点。register.tsx が $ でつなぎ、テストは差し替える */
export type Deps = {
  run: (argv: readonly string[]) => Promise<RunResult>
  /** run と同じだが時間制限なし(エディタの終了待ちに使う) */
  runLong: (argv: readonly string[]) => Promise<RunResult>
  readPrompt: () => Promise<string>
  readClipboard: () => Promise<string>
  /** 入れられたら true */
  fillPrompt: (text: string) => Promise<boolean>
  readFile: (path: string) => Promise<string>
  writeFile: (path: string, text: string) => Promise<void>
  now: () => Promise<number>
  toast: (text: string) => void
  getEditing: () => Promise<Editing | null>
  setEditing: (editing: Editing | null) => Promise<void>
}

export type HostEnv = { handle: string | null; editor: string }

/** `env` の出力から Orca のハンドルとエディタを読む */
export async function readHostEnv(run: Deps['run']): Promise<HostEnv> {
  const { stdout } = await run(['/usr/bin/env'])
  const vars = new Map<string, string>()
  for (const line of stdout.split('\n')) {
    const at = line.indexOf('=')
    if (at > 0) vars.set(line.slice(0, at), line.slice(at + 1))
  }
  return {
    handle: vars.get('ORCA_TERMINAL_HANDLE') || null,
    editor: vars.get('VISUAL') || vars.get('EDITOR') || 'vi',
  }
}

/** 1 回の待ちの上限。切れたら待ち直す */
export const WAIT_SLICE_MS = 600_000

/** エディタが終わるまで待つ。終了を確認できたら true、確認できない失敗なら false */
export async function waitForEditor(deps: Deps, handle: string): Promise<boolean> {
  for (;;) {
    const r = await deps.runLong([
      ORCA, 'terminal', 'wait', '--terminal', handle,
      '--for', 'exit', '--timeout-ms', String(WAIT_SLICE_MS), '--json',
    ])
    let json: any
    try {
      json = JSON.parse(r.stdout)
    } catch {
      return false
    }
    if (json?.ok === true && json.result?.wait?.satisfied === true) return true
    const isTimeout =
      (json?.ok === false && json.error?.code === 'timeout') ||
      (json?.ok === true && json.result?.wait?.satisfied === false)
    if (!isTimeout) return false
  }
}

/** 本体が長い貼り付けを折りたたんだ印。中身は mod から読めない */
const PASTE_MARK = /\[Pasted text #(\d+)(?: \+(\d+) lines)?\]/g

/** 本体はこの長さを超えるか、3 行以上の貼り付けを折りたたむ */
const PASTE_FOLD_CHARS = 800
const ANSI_ESCAPE = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g

/** 本体の貼り付け処理と同じく、色などの制御文字を除き、改行を \n に、タブを空白 4 つにそろえる */
export function normalizePaste(text: string): string {
  return text.replace(ANSI_ESCAPE, '').replace(/\r\n|\r/g, '\n').replaceAll('\t', '    ')
}

export type Expanded = {
  text: string
  /** 最後の貼り付けがクリップボードと合わず、戻せなかったか */
  isMismatched: boolean
  /** 戻す対象にならない、それより前の貼り付けの数 */
  older: number
}

/**
 * 折りたたまれた貼り付けのうち最後のもの(番号が最大)を、クリップボードの中身に戻す。
 * 貼り付けた後に別のものをコピーしていることがあるので、行数が印と合い、
 * 本体が折りたたむ大きさのときだけ戻す。
 */
export function expandPaste(draft: string, clipboard: string): Expanded {
  const marks = [...draft.matchAll(PASTE_MARK)]
  const last = marks.reduce<RegExpMatchArray | undefined>(
    (a, b) => (a && Number(a[1]) > Number(b[1]) ? a : b),
    undefined,
  )
  if (!last) return { text: draft, isMismatched: false, older: 0 }
  const older = marks.length - 1
  const content = normalizePaste(clipboard)
  const lines = content.match(/\n/g)?.length ?? 0
  const isFoldable = lines > 2 || content.length > PASTE_FOLD_CHARS
  if (!isFoldable || lines !== Number(last[2] ?? 0)) return { text: draft, isMismatched: true, older }
  const at = last.index!
  return {
    text: draft.slice(0, at) + content + draft.slice(at + last[0].length),
    isMismatched: false,
    older,
  }
}

function firstLine(r: RunResult): string {
  return (r.stderr.trim() || r.stdout.trim()).split('\n')[0] ?? ''
}

/**
 * 今の下書きを一時ファイルに書き、Orca を上下に分割してエディタで開く。
 * エディタが閉じたら分割ペインを閉じ、ファイルの中身でプロンプト欄を置き換える。
 */
export async function startEdit(deps: Deps): Promise<void> {
  const current = await deps.getEditing()
  if (current) {
    deps.toast('すでに編集中です')
    await deps.run([ORCA, 'terminal', 'focus', '--terminal', current.handle, '--json'])
    return
  }

  const env = await readHostEnv(deps.run)
  if (!env.handle) {
    deps.toast('Orca の外では使えません(Ctrl+X Ctrl+E で標準の外部エディタ)')
    return
  }

  let draft = await deps.readPrompt()
  if (draft.includes('[Pasted text #')) {
    const expanded = expandPaste(draft, await deps.readClipboard().catch(() => ''))
    draft = expanded.text
    const notes = [
      expanded.isMismatched ? '最後の貼り付けはクリップボードと合わない' : '',
      expanded.older > 0 ? `前の貼り付け ${expanded.older} 件は戻せない` : '',
    ].filter(Boolean)
    if (notes.length > 0) deps.toast(`${notes.join('・')}ため、折りたたんだまま開きます`)
  }
  const file = `${DRAFT_DIR}/draft-${await deps.now()}.md`
  await deps.writeFile(file, draft)

  const split = await deps.run([
    ORCA, 'terminal', 'split',
    '--terminal', env.handle,
    '--direction', 'horizontal',
    '--command', `exec ${env.editor} ${file}`,
    '--json',
  ])
  let handle: string | undefined
  try {
    handle = JSON.parse(split.stdout)?.result?.split?.handle
  } catch {
    handle = undefined
  }
  if (split.exitCode !== 0 || !handle) {
    deps.toast(`分割できませんでした: ${firstLine(split)}`)
    return
  }

  await deps.setEditing({ handle, file })
  try {
    if (!(await waitForEditor(deps, handle))) {
      // 書きかけを失わないよう、ペインは閉じず取り込みもしない
      deps.toast(`エディタの終了を確認できませんでした。下書き: ${file}`)
      return
    }
    await deps.run([ORCA, 'terminal', 'close', '--terminal', handle, '--json']).catch(() => undefined)
    await deps.run([ORCA, 'terminal', 'focus', '--terminal', env.handle, '--json']).catch(() => undefined)

    let text: string
    try {
      text = await deps.readFile(file)
    } catch {
      deps.toast(`下書きを読めませんでした: ${file}`)
      return
    }
    const isFilled = await deps.fillPrompt(text.replace(/\n$/, ''))
    if (!isFilled) deps.toast(`プロンプト欄に入れられませんでした: ${file}`)
  } finally {
    await deps.setEditing(null)
  }
}
