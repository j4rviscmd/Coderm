# Coderm

VSCode (microsoft/vscode) のforkプロジェクト。Neovimmer/Vimmer向けにtmuxライクなペイン操作・ターミナル指向の機能を追加したElectron版カスタムエディタ。

**名前の由来**: vscode + term(inal) → Coderm

## プロジェクト概要

| 項目       | 内容                                                         |
| ---------- | ------------------------------------------------------------ |
| リポジトリ | j4rviscmd/coderm (private)                                   |
| ベース     | microsoft/vscode (Electron版)                                |
| fork戦略   | Traditional fork（直接コード変更）                           |
| コンセプト | Neovimmer/Vimmer向け。tmuxライクなペイン操作・ターミナル指向 |

## ビルド・配布

| 項目                 | 内容                                                  |
| -------------------- | ----------------------------------------------------- |
| 対象プラットフォーム | macOS (arm64), Windows (x64)                          |
| 配布形式             | macOS: `.dmg`(intel版は対象外。arm64版のみ対象), Windows: `.exe` (Inno Setup)           |
| コード署名           | ad-hoc（署名なし）                                    |
| 配布先               | GitHub Releases                                       |
| リリース戦略         | ハイブリッド（upstream追従 + 機能追加の両タイミング） |
| 拡張ギャラリー       | Microsoft Marketplace（そのまま）                     |

## 設定・パス

| 項目                 | 内容                                                                |
| -------------------- | ------------------------------------------------------------------- |
| 設定パス             | Coderm独自パス（`~/Library/Application Support/Coderm/` 等）        |
| settings.json prefix | `coderm.*`                                                          |
| テレメトリ           | 最小限（`enableTelemetry` デフォルト `false` のみ。コード削除なし） |

## upstream追従

- 頻度: 月次
- 方法: `git fetch upstream && git merge upstream/main`
- 自動化: GitHub Actions で月次にマージPRを自動作成（issue #9）
- コンフリクト: 手動解決

## 独自機能一覧（設定プレフィックス）

### 1. tmux-like pane control keybindings

- `coderm.workbench.editor.resizePaneRight` — 右方向にペインリサイズ
- `coderm.workbench.editor.resizePaneLeft` — 左方向にペインリサイズ
- `coderm.workbench.editor.resizePaneUp` — 上方向にペインリサイズ
- `coderm.workbench.editor.resizePaneDown` — 下方向にペインリサイズ

### 2. エディタグループにインデックスプレフィックス表示

- `coderm.workbench.editor.editorGroupIndexInTab` (boolean, default: `false`)

### 3. 最小ペインの自動最大化抑制

- `coderm.workbench.editor.autoMaximizeOnFocus` (boolean, default: `true`)

### 4. カーソル自動非表示

- `coderm.cursorAutoHide.enabled` (boolean, default: `false`)
- `coderm.cursorAutoHide.delay` (number, default: `3000`, ms)

### 5. アクティブペイン境界線ハイライト

- `coderm.activePaneBorder.enabled` (boolean, default: `false`)
- `coderm.activePaneBorder.color` (string, default: `""` = theme focusBorder)
- `coderm.activePaneBorder.width` (number, default: `1`, px, 1-5)

### 6. ターミナル水平パディング

- `coderm.terminal.horizontalPadding` (number, default: `0`, px, 0-100)

### 7. Quick Openからターミナルエディタ除外

- `coderm.quickOpen.includeTerminals` (boolean, default: `false`)

## product.json 変更項目

- `nameShort`: `"Coderm"`
- `nameLong`: `"Coderm"`
- `applicationName`: `"coderm"`
- `darwinBundleIdentifier`: `"com.coderm"`
- `win32AppUserModelId`: `"Coderm"`
- `win32DirName`: `"Coderm"`
- `quality`: `"coderm"`
- `updateURL`: Coderm用（または空）

## 開発ルール

- マージする時は `--admin` を使用してよい
- **アーキテクチャ選定の基準**: forkプロジェクトでは「差分の局所化」が「クリーンアーキテクチャ」より実務上重要。upstream追従時のコンフリクト範囲を最小化するため、独自コードは可能な限り1箇所に集約する（例: `contrib/coderm/`）。機能単位ディレクトリの方が美的ではあるが、マージ運用コストを優先する
- settings.jsonに新規設定を追加する場合は、第一階層に `coderm` を追加すること（例: `coderm.newSetting`）。このプレフィックスは独自機能の設定を区別するためのもの
  - ユーザに機能アピールするためにデフォルト設定値はenabled相当にすること
  - 独自設定プロパティを追加時には、`CLAUDE.md`の独自機能一覧セクションに追記すること
- ユーザに動確依頼を出す前にはビルド（`npm run watch`）しておき、ユーザはキャッシュビルドで即起動できるようにすること
  - **`npm run watch`はユーザーが手動で実行すること。AIは実行しない**（初期化時に`out/`がクリーンされ、プロセス中断時に`out/`が空のまま残るリスクがあるため）
  - 動確をする前のビルドでシンボリックリンクを生成しないこと
  - ユーザによる動確は作業中worktree上で`./scripts/code.sh`を実行する

### Playwright CDP デバッグ

`./scripts/code.sh`はデフォルトで`--remote-debugging-port=9222`付きで起動する。
Claude Codeの`playwright-cdp` MCPサーバー（`.mcp.json`）がこのポートに接続し、起動中のアプリのスクリーンショット・DOM検査・UI操作が可能。

- ポート9222を使用するため、並行起動は不可（単一起動前提）
- 並行開発（ディレクトリコピー）時はMCP接続を期待しない運用とする

#### トリガ発話

以下のユーザ発話で`playwright-cdp` MCPツール（`browser_snapshot`, `browser_take_screenshot`等）を使用する:

- 「デバッグして」「debug」
- 「スクリーンショット撮って」「画面見て」「画面どうなってる」「UI確認して」
- 「DOM見て」「要素確認して」「アクセシビリティツリー見て」
- 「クリックして」「入力して」「操作して」
- 「レイアウト確認して」「スタイル見て」「CSS確認して」
- 「コンソール見て」「ログ確認して」
- 「UIテストして」「操作テストして」「E2Eテスト」

### 動確手順

ビルド & 起動

1. 依存関係のインストール（初回のみ）
   `npm install`

2. アプリ起動(all in one)
	`npm run dev`
	※ `npm run watch`および`./scripts/code.sh`を組み合わせたall in oneコマンド

<!-- 2. 初回起動（フルビルド込み） -->
<!--    `./scripts/code.sh` -->
<!--    ※初回はコンパイル・拡張機能ビルド・Electron取得が走るため時間がかかります -->
<!---->
<!-- 3. 開発中のリアルタイム反映（修正サイクル用） -->
<!--    別ターミナルで `npm run watch` を実行しっぱなしにする -->
<!--    ※2回目以降の起動はwatchがあれば差分ビルドで高速に反映されます -->

補足

- `./scripts/code.sh`は`out/`が存在しない場合のみ内部で`npm run compile`を実行します（`build/lib/preLaunch.ts`の`ensureCompiled()`）
- **`npm run watch`はユーザーが手動で実行すること。AIは実行しない**（初期化時の`cleanDir`で`out/`がクリーンされるため、プロセス中断時に`out/`が空のまま残るリスクがある）
- 修正サイクルでは`npm run watch`が動いていることでコード変更がリアルタイムで反映されます
  - 代わりに`npm run compile`をAIが行い、完了したらユーザに動確依頼をすること
- 動作確認の際は `./scripts/code.sh`を作業ブランチ上で実行してください
- release skillにてリリース実行マスト。自動でtag/release作成してくれるスキル

## 関連プロジェクト

- [vscodeee](https://github.com/j4rviscmd/vscodeee) — Tauri 2.0版VSCode（別プロジェクト）。独自機能の元ネタ。

