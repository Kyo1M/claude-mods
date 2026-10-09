import type { Editing } from '../types'

export const ORCA = '/Applications/Orca.app/Contents/Resources/bin/orca'
export const DRAFT_DIR = '/tmp/claude-orca-split-editor'

export type RunResult = { exitCode: number; stdout: string; stderr: string }

/** 外の世界との接点。register.tsx が $ でつなぎ、テストは差し替える */
export type Deps = {
  run: (argv: readonly string[]) => Promise<RunResult>
  /** 分割ペインのエディタが終わるまで待つ(時間制限なし) */
  waitExit: (handle: string) => Promise<void>
  readPrompt: () => Promise<string>
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

  const draft = await deps.readPrompt()
  const file = `${DRAFT_DIR}/draft-${await deps.now()}.md`
  await deps.writeFile(file, draft)

  const split = await deps.run([
    ORCA, 'terminal', 'split',
    '--terminal', env.handle,
    '--direction', 'vertical',
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
    try {
      await deps.waitExit(handle)
    } catch {
      deps.toast('エディタの終了を確認できませんでした。書いた分を取り込みます')
    }
    await deps.run([ORCA, 'terminal', 'close', '--terminal', handle, '--json']).catch(() => undefined)

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
