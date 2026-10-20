# claude-mods

Claude Code の mod(画面や動きを変える hooks プラグイン)を置くリポジトリです。リポジトリ全体がプラグインのマーケットプレイスになっているので、mod ごとに 1 行で入れられます。

## mod 一覧

| mod | できること | 前提 |
|---|---|---|
| [orca-split-editor](orca-split-editor/) | Ctrl+G か `/edit` で Orca のペインを上下に分割し、下側のエディタでプロンプトを書く。保存して閉じると書いた文がプロンプト欄に入る。`[Pasted text #N]` に折りたたまれた最後の貼り付けはクリップボードから戻して開く | Orca 上の Claude Code、`$VISUAL` か `$EDITOR` |

## 入れ方

Claude Code のプロンプト欄で次の 1 行を入力します。

```
/plugin install orca-split-editor --marketplace Kyo1M/claude-mods
```

マーケットプレイスの追加を聞かれたら `y` を押し、スコープは user を選びます。

対話なしで入れるとき(セットアップを Claude に任せるとき等)は、ターミナルで次の 2 行を実行します。

```sh
claude plugin marketplace add Kyo1M/claude-mods
claude plugin install orca-split-editor@claude-mods --scope user
```

更新は `claude plugin marketplace update claude-mods` → `claude plugin update orca-split-editor@claude-mods` → Claude Code で `/reload-plugins` です。

### orca-split-editor のキー割り当て

mod は本体の Ctrl+G(外部エディタ)を横取りできないため、`~/.claude/keybindings.json` で Ctrl+G を本体から外し、mod に回します。標準の外部エディタは既定の Ctrl+X Ctrl+E で引き続き使えます。

```json
{
  "$schema": "https://www.schemastore.org/claude-code-keybindings.json",
  "$docs": "https://code.claude.com/docs/en/keybindings",
  "bindings": [
    { "context": "Chat", "bindings": { "ctrl+g": null } },
    { "context": "Global", "bindings": { "ctrl+g": "app:toggleReplTab" } }
  ]
}
```

`app:toggleReplTab` は、プロンプト欄の上の帯にある mod のボタンを Ctrl+G で押すための割り当てです。キー割り当てを変えなくても `/edit` で使えます。

## 手元で開発する

このリポジトリのフォルダをマーケットプレイスとして登録すると、インストールした mod はこのフォルダから直接読み込まれます。

```sh
claude plugin marketplace add ~/Developer/claude-mods
claude plugin install orca-split-editor@claude-mods --scope user
```

ファイルを直したら、Claude Code で `/reload-plugins` を実行すると反映されます。GitHub から入れている環境に届けるときは、`<mod 名>/.claude-plugin/plugin.json` の `version` を上げてから push します(入れた側は版の番号で入れ替わるため)。

確認は mod ごとに次の 2 つで行います。

```sh
claude plugin validate orca-split-editor
claude plugin test orca-split-editor
```

新しい mod は `<mod 名>/` にフォルダを作り、`.claude-plugin/marketplace.json` の `plugins` とこの README の一覧に追記します。設計書は `docs/superpowers/specs/` に置きます。
