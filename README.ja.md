<!-- markdownlint-disable MD036 -->
<div align="center">

# Coderm

<img src="./.github/assets/workbench.png" alt="Coderm">

日本語 | [English](README.md)

[![Windows](https://img.shields.io/badge/Windows-Supported-0078D6?style=for-the-badge&logo=windows&logoColor=white)](https://github.com/j4rviscmd/Coderm/releases/latest/download/CodermSetup-x64.exe)
[![macOS](https://img.shields.io/badge/macOS-Supported-000000?style=for-the-badge&logo=apple&logoColor=white)](https://github.com/j4rviscmd/Coderm/releases/latest/download/Coderm-arm64.dmg)
[![Downloads](https://img.shields.io/github/downloads/j4rviscmd/Coderm/total?style=for-the-badge&logo=github)](https://github.com/j4rviscmd/Coderm/releases/latest)<br/>
[![Latest Release](https://img.shields.io/github/v/release/j4rviscmd/Coderm?style=for-the-badge&label=Latest&logo=github)](https://github.com/j4rviscmd/Coderm/releases/latest)
[![CI](https://img.shields.io/github/actions/workflow/status/j4rviscmd/Coderm/ci.yml?style=for-the-badge&label=CI&logo=githubactions)](https://github.com/j4rviscmd/Coderm/actions)
[![License](https://img.shields.io/badge/License-MIT-018FF5?style=for-the-badge&logo=opensourceinitiative)](LICENSE.txt)

---

**Coderm = VS Code + Terminal**

VS Codeのフォーク。本家にはないUI/UX改善を追加した(していく)エディタです。

</div>

---

## モチベーション

- 本家VS Codeにはマージされない・されにくいUI/UX改善を爆速に・自由に組み込みたい
- Vim/Neovimユーザーが快適に使える設定を提供したい
- 本家の最新機能・セキュリティパッチを定期的(月1想定)にマージして追従する

---

## インストール

| プラットフォーム      | インストーラ                                                                               |
| :-------------------- | :----------------------------------------------------------------------------------------- |
| macOS (Apple Silicon) | [`.dmg`](https://github.com/j4rviscmd/Coderm/releases/latest/download/Coderm-arm64.dmg)    |
| Windows (x64)         | [`.exe`](https://github.com/j4rviscmd/Coderm/releases/latest/download/CodermSetup-x64.exe) |

> [!NOTE]
> macOSビルドはad-hoc署名（Apple公証なし）です。初回起動時に**システム設定 > プライバシーとセキュリティ**から「このまま開く」をクリックしてください。または以下を実行:
>
> ```sh
> xattr -dr com.apple.quarantine "/Applications/Coderm.app"
> ```

---

## Coderm独自設定

本家VS Codeにはない、Coderm固有の設定項目です。

| 設定キー                                         | 型         | デフォルト                                       | 説明                                               |
| :----------------------------------------------- | :--------- | :----------------------------------------------- | :------------------------------------------------- |
| `coderm.activePaneBorder.enabled`                | `boolean`  | `true`                                           | アクティブペインの境界線ハイライトを有効化         |
| `coderm.activePaneBorder.color`                  | `string`   | `""`                                             | 境界線の色（空文字 = テーマの`focusBorder`）       |
| `coderm.activePaneBorder.width`                  | `number`   | `1`                                              | 境界線の太さ（px, 1–5）                            |
| `coderm.activePaneBorder.radius`                 | `number`   | `5`                                              | 角丸半径（px, 0–20、0 = 角丸なし）                |
| `coderm.cursorAutoHide.enabled`                  | `boolean`  | `true`                                           | 無操作時にマウスカーソルを自動的に非表示にする     |
| `coderm.cursorAutoHide.delay`                    | `number`   | `3000`                                           | カーソル非表示までの遅延（ms）                     |
| `coderm.cursorAutoHide.suppressHover`            | `boolean`  | `true`                                           | カーソル非表示時にエディタhoverを抑制する          |
| `coderm.workbench.editor.editorGroupIndexInTab`  | `boolean`  | `false`                                          | タブにエディタグループ番号`[N]`を表示              |
| `coderm.workbench.editor.autoMaximizeOnFocus`    | `boolean`  | `true`                                           | 最小ペインにフォーカス時の自動最大化を制御         |
| `coderm.workbench.editor.preventNewGroupOnFocus` | `boolean`  | `false`                                          | フォーカス時に新しいエディタグループの作成を抑制   |
| `coderm.extensions.eagerActivation`              | `string[]` | `["asvetliakov.vscode-neovim", "vscodevim.vim"]` | 起動時に即座にアクティベートする拡張機能IDのリスト |
| `coderm.workbench.editor.resizeIncrement`        | `number`   | `60`                                             | ペインリサイズの増分（px）                         |
| `coderm.terminal.horizontalPadding`              | `number`   | `20`                                             | ターミナルの水平パディング（px, 0–100）            |
| `coderm.quickOpen.includeTerminals`              | `boolean`  | `true`                                           | Quick Openにターミナルエディタを含める             |
| `coderm.updateDownloadProgress.enabled`          | `boolean`  | `true`                                           | アップデートダウンロード時に進捗通知を表示         |
| `coderm.terminal.closeEmptyPaneOnKill`           | `boolean`  | `true`                                           | ターミナルkill時に空ペインを閉じてフォーカス復帰   |

---

## Coderm独自コマンド

| コマンド                                  | 説明                     |
| :---------------------------------------- | :----------------------- |
| `coderm.workbench.editor.resizePaneUp`    | ペインを上方向にリサイズ |
| `coderm.workbench.editor.resizePaneDown`  | ペインを下方向にリサイズ |
| `coderm.workbench.editor.resizePaneLeft`  | ペインを左方向にリサイズ |
| `coderm.workbench.editor.resizePaneRight` | ペインを右方向にリサイズ |

> [!TIP]
> **[psmux](https://github.com/psmux/psmux)利用者向け:** `terminal.integrated.enableWin32InputMode: true` を設定すると、psmuxなどのターミナルマルチプレクサで修飾キー付きキーイベント（Ctrl+J等）を正しく区別できるようになります。

---

## 既知の制限事項

| 機能                                 | 制限                                   | 備考                                                                                                          |
| :----------------------------------- | :------------------------------------- | :------------------------------------------------------------------------------------------------------------ |
| Settings Sync                        | 本家VS Code限定サービスのため利用不可  |                                                                                                               |
| `ms-python.vscode-pylance`           | プロプライエタリ依存のためブロック     | [BasedPyright](https://marketplace.visualstudio.com/items?itemName=detachhead.basedpyright)を使用してください |
| `ms-vscode-remote.remote-ssh`        | 本家サーバーインフラ依存のためブロック | ビルトインの`Open Remote - SSH`を使用してください                                                             |
| `ms-vscode-remote.remote-ssh-edit`   | 同上                                   |                                                                                                               |
| `ms-vscode.remote-explorer`          | 同上                                   |                                                                                                               |
| `ms-vscode-remote.remote-containers` | 同上                                   |                                                                                                               |
| `ms-vscode-remote.remote-wsl`        | 同上                                   |                                                                                                               |
| `ms-vscode.remote-tunnels`           | 同上                                   |                                                                                                               |

---

## ライセンス

MIT License — [LICENSE.txt](LICENSE.txt)を参照。
