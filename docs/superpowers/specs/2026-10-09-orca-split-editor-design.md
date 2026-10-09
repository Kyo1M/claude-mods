# orca-split-editor 設計

## 目的

Claude Code の返答を見ながら、使い慣れたエディタ(hx)でプロンプトを書けるようにする。

標準の Ctrl+G(外部エディタ)はターミナル全体をエディタに切り替えるため、書いている間は会話が見えない。この mod は Orca のペインを上下に分割して下側でエディタを開き、上側の Claude Code の会話はそのまま残す。エディタを保存して閉じると、書いた文がプロンプト欄に入る。

## 操作の流れ

1. ヒト：プロンプト欄で Ctrl+G を押す(`/edit` でも起動できる)。
2. mod：プロンプト欄の今の下書きを一時ファイルに書き出す。
3. mod：`orca terminal split` で今の Orca ペインを上下に分割し、下側で `$VISUAL`(無ければ `$EDITOR`、それも無ければ `vi`)を開く。プロンプト欄の上の帯に「hx で編集中(保存して閉じるとプロンプト欄に入ります)」と出す。
4. ヒト：上側で会話を見ながら、下側のエディタで書いて保存して閉じる。
5. mod：`orca terminal wait --for exit` でエディタの終了を受け取り、分割ペインを閉じ、一時ファイルの内容でプロンプト欄を置き換える(末尾の改行 1 つは落とす)。
6. ヒト：内容を確かめて Enter で送信する(mod は自動送信しない)。

保存せずに閉じた場合(`:q!` 等)は一時ファイルが元の下書きのままなので、プロンプト欄も変わらない。

## 構成

リポジトリ `~/Developer/claude-mods/`(git 管理)に mod を置き、`~/.claude/settings.json` の `env.CLAUDE_CODE_PLUGIN_DIRS` で読み込む。対話セッションでは、このフォルダを保存すると mod が読み直される。

この設定が効くのは次に起動したセッションからなので、開発中のセッションでは `~/.claude/dev-mods/<セッション ID>/orca-split-editor` にリポジトリのフォルダへのシンボリックリンクを置き、保存のたびに読み直されるようにする。

```
claude-mods/
  orca-split-editor/
    .claude-plugin/plugin.json   名前・版・説明
    hooks/hooks.json             { "modules": ["./register.tsx"] }
    hooks/register.tsx           イベントの登録(キー・コマンド・帯の描画)
    hooks/editor.ts              分割して開き、終了を待ち、取り込む処理
    hooks/editor.test.ts         editor.ts のテスト
    types/index.d.ts             $.state の型(編集中かどうか)
  docs/superpowers/specs/        この設計書
```

### register.tsx

- `session.start`:`/edit` を登録する(`$.command.register`)。
- `command.run`(`/edit`):`startEdit` を呼ぶ。
- `ui.render`(`AbovePrompt`):Orca 内では 1 行の帯を描く。
  - 待機中は「Ctrl+G: hx で書く」を薄く出す。押すと `startEdit`。
  - 編集中は「hx で編集中(保存して閉じるとプロンプト欄に入ります)」を出す。
  - 帯の Button に `action`(後述のキー割り当て)を付け、Ctrl+G で押されるようにする。
  - Orca の外では `next(e)` を返して何も描かない。

### editor.ts(`startEdit`)

1. 編集中ならトースト「すでに編集中です」を出し、`orca terminal focus` で分割ペインへ移る。新しくは開かない。
2. `printenv` で `ORCA_TERMINAL_HANDLE`・`VISUAL`・`EDITOR` を読む。ハンドルが無ければトースト「Orca の外では使えません(Ctrl+X Ctrl+E で標準の外部エディタ)」を出して終わる。
3. `$.prompt.read()` で下書きを取り、`/tmp/claude-orca-split-editor/draft-<時刻>.md` に書く(`$.fs.write`)。
4. `orca terminal split --terminal <ハンドル> --direction horizontal --command "exec <エディタ> '<ファイル>'" --json` を実行し、JSON から新しいペインのハンドルを取る。失敗したらトーストで理由を出して終わる。
5. 状態を「編集中」にする(帯が切り替わる)。
6. `orca terminal wait --terminal <新ハンドル> --for exit --timeout-ms 600000` を `$.process.spawn` で待ち、上限が切れたら待ち直す(`$.process.run` は最長 10 分で切れるため、長文の編集に備えて spawn を使う)。待つ処理はフックから切り離し、Claude Code の操作を止めない。
7. 終了を確認できたら `orca terminal close --terminal <新ハンドル>` で分割ペインを閉じ(すでに閉じていても害はない)、`orca terminal focus` で Claude Code のペインへ戻る。
8. ファイルを読み、`$.prompt.fill({ text, mode: "replace" })` で入れる。状態を「待機中」に戻し、一時ファイルは残す(取り込みに失敗したときに手で拾えるように)。

`orca` は `/Applications/Orca.app/Contents/Resources/bin/orca` を使う(`/usr/local/bin/orca` のリンクは権限の都合で動かないことを確認済み)。

## キー割り当て

mod は本体の Ctrl+G(`chat:externalEditor`)を横取りできない。本体の処理がある間は mod のキーが効かない仕様のため。そこで `~/.claude/keybindings.json` を次のように変える。

- Chat の `ctrl+g` を外す(`null`)。標準の外部エディタは既定の `ctrl+x ctrl+e` で引き続き使える。
- Global の `ctrl+g` を、本体の処理が常駐していない action に割り当てる。帯の Button が同じ action を名乗り、Ctrl+G で押される。

この方式はまだ試していないため、mod 本体より先に、使い捨ての mod で次の 2 つを順に試す。

1. 帯の Button の `action`:既定のキーが無い action(`app:toggleDiffPreSession`・`app:toggleDiffNoiseFilter`・`app:toggleReplTab`)を Ctrl+G に割り当て、Button が押されるか試す。いずれも Global の action なので、本体の処理が常駐していて押されない可能性がある。
2. `prompt.edit`:Chat の `ctrl+g` を外したうえで、Ctrl+G が `prompt.edit` に `e.key` 付きで届くか試す。届けばそのキーを消費して `startEdit` を呼べるため、帯は要らない。

2 が使えれば 2 を採る(帯を常に出さずに済み、簡単なため)。どちらも効かなかった場合は、`/edit` だけで済ませずに、mod なしの案(`$VISUAL` を「Orca を分割してエディタを開き、閉じるまで待つ」スクリプトに差し替える案)と比べて相談し直す。

Ctrl+E は、プロンプト欄で行末へ移るキーなので使わない。

## 失敗したとき

| 状況 | 動き |
|---|---|
| Orca の外(ハンドルが無い) | 帯を出さない。`/edit` はトーストで案内して終わる |
| `orca terminal split` が失敗 | トーストに orca の出力の 1 行目を出す。状態は待機中のまま |
| 編集中にもう一度起動 | 分割ペインへ移るだけ |
| `orca terminal wait` の上限(1 回 10 分)が切れた | 待ち直す |
| エディタの終了を確認できない(`wait` の失敗) | ペインは閉じず取り込みもしない。トーストに一時ファイルのパスを出し、待機中に戻す |
| ファイルが読めない | トーストに一時ファイルのパスを出す |
| プロンプト欄に入らない(`fill` が `isFilled: false`。ダイアログ表示中など) | トーストに一時ファイルのパスを出す |
| mod の読み直し(保存時) | 待機中の処理は切れる。状態だけ「編集中」が残るので、`session.start` で待機中に戻す |

## テスト

`hooks/editor.test.ts` を `claude plugin test` で回す。`$.process`・`$.fs`・`$.prompt` は差し替える。

1. 正常：下書き「abc」→ 分割 → 終了後ファイルが「xyz\n」→ プロンプト欄が「xyz」になる。
2. Orca の外：ハンドルが空なら分割を呼ばず、トーストを出す。
3. 分割の失敗：`orca` が非 0 で終わったらトーストを出し、状態が待機中のまま。
4. 二重起動：編集中に呼ぶと split を呼ばず focus を呼ぶ。

あわせて `claude plugin validate` と `tsc -p orca-split-editor` を通す。

## 完了条件

- Orca 上の Claude Code で Ctrl+G を押すと、下側に hx が今の下書き入りで開き、上側の会話は見えたままである。
- hx で保存して閉じると、書いた文がプロンプト欄に入る。`:q!` で閉じると下書きは変わらない。
- `/edit` でも同じ動きをする。
- テスト 6 件・validate・tsc が通る。

## 実装時に確かめたこと

- キー割り当て:使い捨ての mod で試し、方法 1(帯の Button の `action`)は 3 つの候補すべてで押された。方法 2 は、Chat の `ctrl+g` を外しても Ctrl+G が `prompt.edit` に届かなかった。そこで方法 1 を採り、`app:toggleReplTab` を使う。
- 上下の分割は `--direction horizontal`。Orca の手順書には `vertical` が上下とあるが、実際に試すと `vertical` は左右に分かれた。
- `/edit` は手元の commands・skills と重ならない。

`--command` の文字列がシェルで解釈されること(`;` と `exit` が効く)は確認済み。一時ファイルのパスには空白を含めない。
