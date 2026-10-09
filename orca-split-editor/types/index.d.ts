/** 分割ペインで編集中の下書き */
export type Editing = { handle: string; file: string }

declare module 'claude-code' {
  interface PluginState {
    'orca-split-editor': {
      /** 編集中なら分割ペインのハンドルと一時ファイル、待機中は null */
      editing: Editing | null
      /** Orca の中で動いているか(帯を出すかどうか) */
      inOrca: boolean
      /** 開くエディタのコマンド($VISUAL → $EDITOR → vi) */
      editor: string
    }
  }
}
