<div align="center">

# Coderm

<img src="./.github/assets/workbench.png" alt="Coderm">

[日本語](README.md) | English

[![Windows](https://img.shields.io/badge/Windows-Supported-0078D6?style=for-the-badge&logo=windows&logoColor=white)](https://github.com/j4rviscmd/Coderm/releases/latest/download/CodermSetup-x64.exe)
[![macOS](https://img.shields.io/badge/macOS-Supported-000000?style=for-the-badge&logo=apple&logoColor=white)](https://github.com/j4rviscmd/Coderm/releases/latest/download/Coderm-arm64.dmg)
[![Downloads](https://img.shields.io/github/downloads/j4rviscmd/Coderm/total?style=for-the-badge&logo=github)](https://github.com/j4rviscmd/Coderm/releases/latest)<br/>
[![Latest Release](https://img.shields.io/github/v/release/j4rviscmd/Coderm?style=for-the-badge&label=Latest&logo=github)](https://github.com/j4rviscmd/Coderm/releases/latest)
[![CI](https://img.shields.io/github/actions/workflow/status/j4rviscmd/Coderm/ci.yml?style=for-the-badge&label=CI&logo=githubactions)](https://github.com/j4rviscmd/Coderm/actions)
[![License](https://img.shields.io/badge/License-MIT-018FF5?style=for-the-badge&logo=opensourceinitiative)](LICENSE.txt)

---

**A customized fork of VS Code with UI/UX improvements not found in upstream.**

</div>

---

## Motivation

- Freely integrate UX improvements that are unlikely to be merged into upstream VS Code
- Provide settings and keybindings optimized for Vim/Neovim users
- Regularly merge upstream features and security patches (monthly cadence)

---

## Installation

| Platform              | Installer                                                                                  |
| :-------------------- | :----------------------------------------------------------------------------------------- |
| macOS (Apple Silicon) | [`.dmg`](https://github.com/j4rviscmd/Coderm/releases/latest/download/Coderm-arm64.dmg)    |
| Windows (x64)         | [`.exe`](https://github.com/j4rviscmd/Coderm/releases/latest/download/CodermSetup-x64.exe) |

> [!NOTE]
> macOS builds use ad-hoc code signing (not Apple-notarized). On first launch, go to **System Settings > Privacy & Security** and click **Open Anyway**. Alternatively, run:
>
> ```sh
> xattr -dr com.apple.quarantine "/Applications/Coderm.app"
> ```

---

## Coderm-Specific Settings

Settings unique to Coderm that are not available in upstream VS Code.

| Setting                                          | Type      | Default | Description                                       |
| :----------------------------------------------- | :-------- | :------ | :------------------------------------------------ |
| `coderm.activePaneBorder.enabled`                | `boolean` | `true`  | Enable active pane border highlight               |
| `coderm.activePaneBorder.color`                  | `string`  | `""`    | Border color (empty = theme's `focusBorder`)      |
| `coderm.activePaneBorder.width`                  | `number`  | `1`     | Border thickness (px, 1–5)                        |
| `coderm.cursorAutoHide.enabled`                  | `boolean` | `true`  | Auto-hide mouse cursor after inactivity           |
| `coderm.cursorAutoHide.delay`                    | `number`  | `3000`  | Delay before hiding cursor (ms)                   |
| `coderm.workbench.editor.editorGroupIndexInTab`  | `boolean` | `false` | Show editor group index `[N]` in tab              |
| `coderm.workbench.editor.autoMaximizeOnFocus`    | `boolean` | `true`  | Control auto-maximize when focusing smallest pane |
| `coderm.workbench.editor.preventNewGroupOnFocus` | `boolean` | `false` | Prevent creating new editor group on focus        |
| `coderm.workbench.editor.resizeIncrement`        | `number`  | `60`    | Pane resize increment (px)                        |
| `coderm.terminal.horizontalPadding`              | `number`  | `20`    | Terminal horizontal padding (px, 0–100)           |
| `coderm.quickOpen.includeTerminals`              | `boolean` | `true`  | Include terminal editors in Quick Open            |
| `coderm.updateDownloadProgress.enabled`          | `boolean` | `true`  | Show progress notification during update download |
| `coderm.terminal.closeEmptyPaneOnKill`           | `boolean` | `true`  | Close empty pane and restore focus on terminal kill |

---

## Coderm-Specific Commands

| Command                                   | Description           |
| :---------------------------------------- | :-------------------- |
| `coderm.workbench.editor.resizePaneUp`    | Resize pane upward    |
| `coderm.workbench.editor.resizePaneDown`  | Resize pane downward  |
| `coderm.workbench.editor.resizePaneLeft`  | Resize pane leftward  |
| `coderm.workbench.editor.resizePaneRight` | Resize pane rightward |

---

## Known Limitations

| Feature                              | Limitation                                    | Notes                                        |
| :----------------------------------- | :-------------------------------------------- | :------------------------------------------- |
| Settings Sync                        | Unavailable (exclusive to official VS Code)   |                                              |
| `ms-vscode-remote.remote-ssh`        | Blocked (depends on proprietary server infra) | Use the built-in `Open Remote - SSH` instead |
| `ms-vscode-remote.remote-ssh-edit`   | Same as above                                 |                                              |
| `ms-vscode.remote-explorer`          | Same as above                                 |                                              |
| `ms-vscode-remote.remote-containers` | Same as above                                 |                                              |
| `ms-vscode-remote.remote-wsl`        | Same as above                                 |                                              |
| `ms-vscode.remote-tunnels`           | Same as above                                 |                                              |

---

## License

MIT License — see [LICENSE.txt](LICENSE.txt).
