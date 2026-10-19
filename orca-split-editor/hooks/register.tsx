import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Editing } from '../types'
import { readHostEnv, startEdit } from './editor'
import type { Deps } from './editor'

const editing = atom({ plugin: 'orca-split-editor', key: 'editing' } as const, null as Editing | null)
const inOrca = atom({ plugin: 'orca-split-editor', key: 'inOrca' } as const, false)
const editor = atom({ plugin: 'orca-split-editor', key: 'editor' } as const, 'vi')

// keybindings.json で Global の ctrl+g をこの action に割り当てる。
// 本体の処理が常駐しない action なので、帯の Button が Ctrl+G で押される。
const KEY_ACTION = 'app:toggleReplTab'

function depsOf($: EngineInterface): Deps {
  return {
    run: argv => $.process.run(argv),
    runLong: async argv => {
      // $.process.run は最長 10 分で切れるので spawn で読み切る
      const stream = $.process.spawn({ argv })
      let stdout = ''
      let stderr = ''
      for await (const chunk of stream) {
        if (chunk.stream === 'stdout') stdout += chunk.text
        else stderr += chunk.text
      }
      const { code } = await stream.result
      return { exitCode: code ?? 1, stdout, stderr }
    },
    readPrompt: async () => (await $.prompt.read()).text,
    fillPrompt: async text => (await $.prompt.fill({ text, mode: 'replace' })).isFilled,
    readFile: async path => String(await $.fs.read(path)),
    writeFile: (path, text) => $.fs.write(path, text),
    now: () => $.clock.now(),
    toast: text => $.ui.toast(text),
    getEditing: () => read($, editing),
    setEditing: async value => {
      await update($, editing, () => value)
    },
  }
}

function launch($: EngineInterface): void {
  void startEdit(depsOf($)).catch(error => $.ui.toast(`エディタを開けませんでした: ${String(error)}`))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // 読み直しで待ちの処理は切れるので、編集中の印を消しておく
    await update($, editing, () => null)
    const env = await readHostEnv(argv => $.process.run(argv))
    await update($, inOrca, () => env.handle !== null)
    await update($, editor, () => env.editor)
    await $.command.register({
      name: 'edit',
      description: 'Orca を上下に分割し、エディタでプロンプトを書く',
    })
    return next(e)
  })

  on('command.run', { command: 'edit' }, $ => {
    launch($)
    return {}
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || !(await read($, inOrca))) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const name = (await read($, editor)).split(' ')[0]?.split('/').pop() ?? 'editor'
    const isEditing = (await read($, editing)) !== null

    // 待機中のボタンは隠す。Ctrl+G で押すために描画には残す
    return (
      <Box>
        <Box display={isEditing ? 'flex' : 'none'}>
          <Button
            key="edit"
            label="Ctrl+G: 編集中のペインへ"
            action={KEY_ACTION}
            plain
            dimColor
            onPress={() => launch($)}
          />
          <Text dimColor>  {name} で編集中(保存して閉じるとプロンプト欄に入ります)</Text>
        </Box>
      </Box>
    )
  })
}
