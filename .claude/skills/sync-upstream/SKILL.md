---
name: sync-upstream
description: >-
  microsoft/vscodeのmainブランチからの変更取り込みを行う。forest CLIでworktreeを作成し、
  upstreamをfetch・mergeしてコンフリクトを1件ずつ解決した後、coderm版バージョニング（キャリーオーバー）を行い、
  PRを作成してmainにマージする。CI監視後にforest finishでworktreeを削除する。
  マージ後はrelease.ymlが自動的にビルド・リリースを実行する。
model: opus
disable-model-invocation: true
---

# Upstream同期（microsoft/vscode追従）

## スキル概要

microsoft/vscode の main ブランチから最新の変更を取り込み、コンフリクトを解決し、
coderm版バージョニング（キャリーオーバー）を行った後、PR経由でmainにマージする一連のワークフローを実行します。
`forest` CLIによるworktree管理でmainブランチを汚さずに作業し、CI監視後にworktreeをクリーンアップします。
マージ後は release.yml が自動的にタグ生成・ビルド・GitHub Release作成を行います。

**基本フロー:** 前提条件チェック & 早期差分検出 → worktree作成（forest start） → upstream merge → コンフリクト解決（1件ずつ報告） → ビルド検証 → coderm版バージョニング → push & PR作成 → CI監視 → PRマージ → forest finish → release.yml自動発火

**前提条件:**
- `main` ブランチから開始すること
- ワーキングツリーがクリーンであること
- upstreamリモートが設定済み（未設定の場合は自動追加）
- `forest` CLIがインストール済み

## ガードレール（絶対に守ること）

| ルール | 理由 |
| ------ | ---- |
| **`forest start` で worktree 作成** | main ブランチをクリーンに保つため |
| **すべての作業は worktree 内で実行** | 隔離性を保証するため |
| **`forest finish` でクリーンアップ** | 手動ブランチ削除ではなく forest に任せるため |
| **ブランチ名は kebab-case のみ（スラッシュ不可）** | forest の制約。`sync-upstream-{date}` 形式を使用 |
| **`/tmp` セッショントラッキングは必須** | worktree-start パターンとの一貫性を保つため |
| **コンフリクト解決は1件ずつ報告** | 各マージ判断の透明性を確保するため |
| **ビルド検証を必ず実施** | マージ後のビルド破壊を防ぐため |
| **product.jsonのCodermカスタム値は絶対に上書きしない** | Codermのブランディング・パス設定が失われるため |
| **`npm run watch`は絶対に実行しない** | CLAUDE.mdルール。`npm run compile`を代わりに使用 |
| **不明なコンフリクトはユーザに確認** | 機能損失を防ぐため。推測で解決しない |
| **PRは `--merge --admin` でマージ（`--squash` は使用しない）** | upstream履歴を保持するため。j4rviscmdがownerでは--adminを許可 |
| **GitHub Release・タグの作成は絶対禁止** | release.ymlが自動実行する。手動実行すると二重実行・競合が発生する |
| **取り込み対象外ファイルはupstreamの変更を反映しない** | README.md, README.en.md, CLAUDE.md, .claude/*, .github/*, .forest.toml, .mcp.json は常にCoderm版を維持 |

## コンテキスト情報

- 現在のブランチ: !`git branch --show-current`
- upstreamリモート: !`git remote get-url upstream 2>/dev/null || echo "未設定"`
- 最新のリリースタグ: !`git describe --tags --abbrev=0 2>/dev/null || echo "（リリースなし）"`
- 最新のupstream同期: !`git log --oneline --grep="Merge remote-tracking branch 'upstream" -1 2>/dev/null || echo "同期履歴なし"`
- アクティブなworktree: !`forest list 2>/dev/null || echo "（なし）"`

## Codermバージョニング（キャリーオーバー）

upstream merge後、`package.json` のversionは純粋なupstreamバージョン（例: `1.122.0`）になります。
Step 6で前回リリースタグからcoderm部分（例: `-coderm.0.15.0`）を抽出し、新しいupstreamバージョンに付加します。

**例:** `1.121.0-coderm.0.15.0`（現状） → upstream merge → `1.122.0` → キャリーオーバー → `1.122.0-coderm.0.15.0`

## upstream取り込み対象外

以下のファイル・ディレクトリはupstreamの変更を取り込まず、常にCoderm版を維持する。

| 対象 | 理由 |
| ---- | ---- |
| `README.md` | Coderm独自のコンテンツ |
| `README.en.md` | upstreamに存在しないCoderm独自ファイル |
| `CLAUDE.md` | Coderm固有のプロジェクト指示 |
| `.claude/*` | Claude Code設定（upstreamに存在しない） |
| `.github/*` | Coderm独自のCI/CDワークフロー |
| `.agents/*` | upstreamのGitHub Copilot agent設定（Codermでは不要） |
| `.forest.toml` | Forest CLIのworktree設定（upstreamに存在しない） |
| `.mcp.json` | MCPサーバー設定（upstreamに存在しない） |

**取り込み対象外ファイルの処理:** `git merge` 後に対象ファイルをマージ前の状態に復元する（Step 3で実施）。コンフリクトが発生した場合でもこれらのファイルは自動的にCoderm版を採用するため、コンフリクト解決の報告は不要。

## upstream merge後のCoderm独自復元項目

upstream mergeでCoderm独自の変更が上書きされる可能性のある項目。merge後（Step 3〜6の間）に必ず確認・復元する。

| 対象 | 復元内容 | 理由 |
| ---- | -------- | ---- |
| `product.json` Coderm設定値 | 下記「product.json復元値」参照 | ブランディング・パス設定がupstream値で上書きされるのを防ぐため |
| `product.json` open-remote-ssh | `builtInExtensions`への拡張追加 + `extensionEnabledApiProposals` | Coderm独自の組み込み拡張。upstreamに存在しないためmerge時に消失 |
| `package.json` scripts | `"dev": "node scripts/dev.js"` | Coderm独自のall-in-one開発コマンド。upstreamに存在しないためmerge時に消失 |

### product.json復元値

以下のキーはupstream merge後、常にCodermの値を維持すること。

```json
{
  "nameShort": "Coderm",
  "nameLong": "Coderm",
  "applicationName": "coderm",
  "dataFolderName": ".coderm",
  "sharedDataFolderName": ".coderm-shared",
  "win32MutexName": "coderm",
  "licenseUrl": "https://github.com/j4rviscmd/Coderm/blob/main/LICENSE.txt",
  "serverLicenseUrl": "https://github.com/j4rviscmd/Coderm/blob/main/LICENSE.txt",
  "serverApplicationName": "coderm-server",
  "serverDataFolderName": ".coderm-server",
  "serverDownloadUrlTemplate": "https://github.com/j4rviscmd/Coderm/releases/download/v${version}/coderm-reh-${os}-${arch}.tar.gz",
  "tunnelApplicationName": "coderm-tunnel",
  "win32DirName": "Coderm",
  "win32NameVersion": "Coderm",
  "win32RegValueName": "Coderm",
  "win32AppUserModelId": "Coderm",
  "win32ShellNameShort": "C&oderm",
  "win32TunnelServiceMutex": "coderm-tunnelservice",
  "win32TunnelMutex": "coderm-tunnel",
  "darwinBundleIdentifier": "com.coderm",
  "linuxIconName": "coderm",
  "urlProtocol": "coderm"
}
```

**組み込み拡張（builtInExtensions）に追加必須:**

```json
{
  "name": "jeanp413.open-remote-ssh",
  "version": "0.1.2",
  "sha256": "4c4305484d35a119eeac6ba57c77e8cc181b1e21a748f80a7b79b967e89a5681",
  "repo": "https://github.com/jeanp413/open-remote-ssh",
  "metadata": {
    "id": "bba2d7c0-c7c8-fe0d-d0aa-86222f28ea39",
    "publisherId": {
      "publisherId": "8f92e487-7d76-f6b0-e49e-cc9e972053dc",
      "publisherName": "jeanp413",
      "displayName": "Jean Pierre",
      "flags": ""
    },
    "publisherDisplayName": "Jean Pierre"
  }
}
```

**extensionEnabledApiProposalsに追加必須:**

```json
{
  "jeanp413.open-remote-ssh": ["resolvers", "contribViewsRemote"]
}
```

## コンフリクト解決方針

### ファイルカテゴリ別の解決ルール

| カテゴリ | 対象ファイル例 | 解決方針 |
|---|---|---|
| **Codermブランディング** | `product.json` | Codermの値を維持。upstream側の新規フィールドのみ追加 |
| **バージョン** | `package.json` | `version`フィールドはupstreamの値を採用。Step 6でcoderm部をキャリーオーバー |
| **Coderm独自コード** | `src/vs/workbench/contrib/coderm/` | Coderm機能を保持。upstream APIの変更に適応させる |
| **Coderm設定・ドキュメント** | `README.md`, `README.en.md`, `CLAUDE.md`, `.claude/*`, `.github/*`, `.forest.toml`, `.mcp.json` | 取り込み対象外（Step 3で自動復元） |
| **CI/CD（参考）** | `.github/workflows/`（上記対象外の個別ファイル） | 該当なし（`.github/*` は全て対象外） |
| **upstream純粋コード** | その他すべて | upstreamを採用。ただしCodermの変更が入っている場合は統合 |

### コンフリクト報告フォーマット

各コンフリクト解決後、以下のフォーマットで報告する:

```
---
### [ファイルパス]
**vscode側の変更:** （upstreamが何を変えようとしたか簡潔に）
**coderm側の変更:** （Codermで独自に変更していた内容）
**マージ判断:** （どちらを採用/どう統合したか + 理由）
---
```

## 手順

### Step 1: 前提条件チェック & 早期差分検出（ベースディレクトリ）

**重要:** worktree作成前にupstream差分を確認し、不要なworktree作成を防止する。

```bash
# 1. ブランチ確認
current_branch=$(git branch --show-current)
if [ "$current_branch" != "main" ]; then
  echo "エラー: mainブランチから開始してください（現在: $current_branch）"
  exit 1
fi

# 2. ワーキングツリーの状態確認
if [ -n "$(git status --porcelain)" ]; then
  echo "エラー: ワーキングツリーがクリーンではありません"
  git status --short
  exit 1
fi

# 3. upstreamリモート確認・自動追加
if ! git remote get-url upstream >/dev/null 2>&1; then
  echo "upstreamリモートが未設定です。自動で追加します。"
  git remote add upstream https://github.com/microsoft/vscode.git
  echo "✅ upstream追加完了: https://github.com/microsoft/vscode.git"
fi

# 4. originと同期
git fetch origin
git pull origin main --ff-only || {
  echo "エラー: origin/mainとの同期に失敗しました"
  exit 1
}

# 5. upstream差分の事前確認（worktree作成前に確認）
echo "⏳ upstreamからfetch中..."
git fetch upstream

commit_count=$(git rev-list --count HEAD..upstream/main)
echo ""
echo "📊 upstream差分情報:"
echo "  取り込み対象コミット数: $commit_count"
echo ""

if [ "$commit_count" -eq 0 ]; then
  echo "✅ upstreamに新しい変更はありません。既に最新です。"
  exit 0
fi

# 主要な変更領域をサマリー表示
echo "主要な変更領域:"
git diff --stat HEAD..upstream/main
echo ""

# sync_date と worktree_name を生成（後続Stepで使用）
sync_date=$(node -p "new Date().toISOString().slice(0,10)")
echo "同期日: $sync_date"
```

### Step 2: Worktree作成（forest start）

```bash
# 1. worktree名生成（同日複数回実行時はサフィックス付与で衝突回避）
wt_name="sync-upstream-${sync_date}"
if forest list 2>/dev/null | grep -q "$wt_name"; then
  wt_name="${wt_name}-$(node -p "Date.now().toString(36)")"
fi
echo "worktree名: $wt_name"

# 2. forest start 実行
forest start . "$wt_name"

# 3. セッショントラッキング
REPO_ROOT="$(pwd)"
REPO_HASH=$(echo "$REPO_ROOT" | (md5 -q 2>/dev/null || md5sum | cut -d' ' -f1))
SESSION_FILE="/tmp/.claude-active-sessions-$REPO_HASH"
TMUX_SESSION=$(tmux display-message -p '#S' 2>/dev/null || echo "none")
echo -e "${wt_name}\t$REPO_ROOT\t$(date -u +%Y-%m-%dT%H:%M:%SZ)\t$TMUX_SESSION\t$$" >> "$SESSION_FILE"

# 4. worktreeディレクトリに移動
cd ".worktrees/${wt_name}"
echo "✅ worktree作成完了: .worktrees/${wt_name}"
echo "   branch: $(git branch --show-current)"
```

**forest start が実行する処理:**
1. kebab-case検証
2. `git worktree add -b {name} .worktrees/{name} HEAD`（ブランチ作成＋チェックアウト）
3. `.forest.toml` の `share` パターンに基づいて `node_modules`, `out`, `.build/builtInExtensions`, `.mcp.json` をコピー
4. `npm install` をworktree内で実行

**終了コード:**

| コード | 意味 |
| ------ | ---- |
| 0 | 成功 |
| 1 | base_pathが存在しない |
| 2 | nameがkebab-caseではない |
| 3 | worktreeが既に存在する |
| 4 | git worktreeの作成に失敗 |
| 5 | startコマンドの実行に失敗 |
| 13 | `.forest.toml` のshareパターンが不正 |

### Step 3: upstream merge & 対象外ファイル復元（worktree内）

```bash
# マージ実行
echo "⏳ upstream/mainをマージ中..."
if git merge upstream/main --no-edit; then
  echo "✅ マージ成功（コンフリクトなし）"
else
  echo "⚠️  コンフリクトが発生しました。解決を開始します。"
  # Step 4へ進む
fi

# 取り込み対象外ファイルをマージ前の状態に復元
echo "⏳ 取り込み対象外ファイルを復元中..."
EXCLUDE_PATTERNS=(
  "README.md"
  "README.en.md"
  "CLAUDE.md"
  ".claude"
  ".github"
  ".agents"
  ".forest.toml"
  ".mcp.json"
)

for pattern in "${EXCLUDE_PATTERNS[@]}"; do
  if git diff --name-only HEAD~1 HEAD -- "$pattern" 2>/dev/null | grep -q .; then
    git checkout --ours -- "$pattern" 2>/dev/null && git add "$pattern" && echo "  復元: $pattern"
  fi
done

# コンフリクト中の対象外ファイルがあればCoderm版を採用
conflict_files=$(git diff --name-only --diff-filter=U 2>/dev/null || true)
if [ -n "$conflict_files" ]; then
  echo "$conflict_files" | while IFS= read -r file; do
    for pattern in "${EXCLUDE_PATTERNS[@]}"; do
      if echo "$file" | grep -q "^${pattern}" || [ "$file" = "$pattern" ]; then
        git checkout --ours -- "$file"
        git add "$file"
        echo "  コンフリクト自動解決（Coderm版採用）: $file"
        break
      fi
    done
  done
fi

# 全コンフリクト解決済みの場合のみamend
restored=$(git diff --cached --name-only 2>/dev/null || true)
remaining=$(git diff --name-only --diff-filter=U)
if [ -n "$restored" ] && [ -z "$remaining" ]; then
  git commit --amend --no-edit
  echo "✅ 対象外ファイルの復元をマージコミットにamend"
elif [ -n "$restored" ]; then
  echo "✅ 対象外ファイルをステージング済み（非対象コンフリクト解決後にコミット）"
else
  echo "✅ 対象外ファイルの変更なし"
fi

# Coderm独自のpackage.json scriptsを復元
echo "⏳ Coderm独自scriptsを確認中..."
if ! grep -q '"dev"' package.json; then
  node -e "const fs=require('fs'),f='package.json',p=JSON.parse(fs.readFileSync(f,'utf8'));p.scripts=p.scripts||{};p.scripts.dev='node scripts/dev.js';fs.writeFileSync(f,JSON.stringify(p,null,2)+'\n')"
  echo "  復元: package.json scripts.dev"
fi

# Coderm独自のproduct.json設定を復元
echo "⏳ product.jsonのCoderm設定を確認中..."
node -e "
const fs = require('fs');
const f = 'product.json';
const p = JSON.parse(fs.readFileSync(f, 'utf8'));

// Coderm固定値（upstreamで上書きされうるキー）
const codermValues = {
  nameShort: 'Coderm',
  nameLong: 'Coderm',
  applicationName: 'coderm',
  dataFolderName: '.coderm',
  sharedDataFolderName: '.coderm-shared',
  win32MutexName: 'coderm',
  licenseUrl: 'https://github.com/j4rviscmd/Coderm/blob/main/LICENSE.txt',
  serverLicenseUrl: 'https://github.com/j4rviscmd/Coderm/blob/main/LICENSE.txt',
  serverApplicationName: 'coderm-server',
  serverDataFolderName: '.coderm-server',
  serverDownloadUrlTemplate: 'https://github.com/j4rviscmd/Coderm/releases/download/v\${version}/coderm-reh-\${os}-\${arch}.tar.gz',
  tunnelApplicationName: 'coderm-tunnel',
  win32DirName: 'Coderm',
  win32NameVersion: 'Coderm',
  win32RegValueName: 'Coderm',
  win32AppUserModelId: 'Coderm',
  win32ShellNameShort: 'C&oderm',
  win32TunnelServiceMutex: 'coderm-tunnelservice',
  win32TunnelMutex: 'coderm-tunnel',
  darwinBundleIdentifier: 'com.coderm',
  linuxIconName: 'coderm',
  urlProtocol: 'coderm'
};

let changed = false;
for (const [key, value] of Object.entries(codermValues)) {
  if (p[key] !== value) {
    console.log('  復元: ' + key + ' (' + p[key] + ' -> ' + value + ')');
    p[key] = value;
    changed = true;
  }
}

// open-remote-ssh組み込み拡張の確認
const ORS_NAME = 'jeanp413.open-remote-ssh';
if (!p.builtInExtensions.some(e => e.name === ORS_NAME)) {
  p.builtInExtensions.push({
    name: ORS_NAME,
    version: '0.1.2',
    sha256: '4c4305484d35a119eeac6ba57c77e8cc181b1e21a748f80a7b79b967e89a5681',
    repo: 'https://github.com/jeanp413/open-remote-ssh',
    metadata: {
      id: 'bba2d7c0-c7c8-fe0d-d0aa-86222f28ea39',
      publisherId: {
        publisherId: '8f92e487-7d76-f6b0-e49e-cc9e972053dc',
        publisherName: 'jeanp413',
        displayName: 'Jean Pierre',
        flags: ''
      },
      publisherDisplayName: 'Jean Pierre'
    }
  });
  console.log('  復元: open-remote-ssh builtInExtension');
  changed = true;
}

// extensionEnabledApiProposalsの確認
if (!p.extensionEnabledApiProposals || !p.extensionEnabledApiProposals[ORS_NAME]) {
  p.extensionEnabledApiProposals = p.extensionEnabledApiProposals || {};
  p.extensionEnabledApiProposals[ORS_NAME] = ['resolvers', 'contribViewsRemote'];
  console.log('  復元: open-remote-ssh extensionEnabledApiProposals');
  changed = true;
}

if (changed) {
  fs.writeFileSync(f, JSON.stringify(p, null, '\t') + '\n');
  console.log('✅ product.json復元完了');
} else {
  console.log('✅ product.json Coderm設定に変更なし');
}
"

# コンフリクトが残っている場合はStep 4へ、なければStep 5へ
remaining=$(git diff --name-only --diff-filter=U)
if [ -n "$remaining" ]; then
  echo "⚠️  残りのコンフリクトをStep 4で解決します"
fi
```

### Step 4: コンフリクト解決（worktree内、条件付き）

**重要:** このステップはマージでコンフリクトが発生した場合のみ実行する。

```bash
# コンフリクトファイル一覧を取得
conflict_files=$(git diff --name-only --diff-filter=U)
conflict_count=$(node -p "process.argv[1].split('\n').filter(Boolean).length" "$conflict_files")
echo ""
echo "📋 コンフリクトファイル一覧 ($conflict_count 件):"
node -e "process.argv[1].split('\n').filter(Boolean).forEach(f=>console.log('  - '+f))" "$conflict_files"
echo ""
```

**各ファイルごとに以下のループを実行:**

1. `git diff --name-only --diff-filter=U` でコンフリクトファイルを取得
2. 各ファイルの内容を読み、コンフリクトマーカー（`<<<<<<<`, `=======`, `>>>>>>>`）を確認
3. ファイルカテゴリに応じた解決方針を適用:
   - **AI自動解決可能:** 方針が明確なもの（product.json、README等）
   - **ユーザ確認必要:** Coderm独自コードとupstreamの変更が複雑に絡む場合
4. 解決後、報告フォーマットで説明を出力
5. `git add [ファイル]`

**解決判断のフローチャート:**

```
コンフリクトファイルを読む
  → product.jsonか？ → Coderm値を維持、新フィールド追加
  → package.jsonか？ → versionはupstream採用、その他はケースバイケース
  → 取り込み対象外か？（README.md, .claude/*, .github/*等） → Step 3で既にCoderm版採用済み
  → contrib/coderm/ 配下か？ → Coderm機能を保持、upstream API変更に適応
  → その他か？
    → Coderm独自変更が含まれるか確認
      → 含まれない → upstreamを採用
      → 含まれる → 統合を試みる、不明ならユーザ確認
```

**全コンフリクト解決後:**

```bash
# 未解決のコンフリクトがないことを確認
remaining=$(git diff --name-only --diff-filter=U)
if [ -n "$remaining" ]; then
  echo "❌ まだ未解決のコンフリクトがあります:"
  echo "$remaining"
  # ユーザに確認
else
  echo "✅ 全コンフリクト解決完了"
  git commit --no-edit
  echo "✅ マージコミット作成完了"
fi
```

### Step 5: ビルド検証（worktree内）

```bash
echo "⏳ ビルド検証中... (npm run compile)"
if npm run compile 2>&1; then
  echo "✅ ビルド成功"
else
  echo "❌ ビルドエラーが発生しました"
  # エラー内容をユーザーに報告し、対応を確認
fi
```

**ビルドエラー時の対応:**
- エラー内容を分析し、upstreamの変更によるCodermコードの破損箇所を特定
- 修正可能なら修正し、amendコミット
- 判断が難しい場合はユーザーに報告して確認

### Step 6: coderm版バージョニング（キャリーオーバー）（worktree内）

「Codermバージョニング（キャリーオーバー）」セクションの通り、前回リリースタグからcoderm部分を抽出して新しいバージョンに付加します。

```bash
# 1. 現在のバージョン（純粋なupstream版）を取得
current_version=$(node -p "require('./package.json').version")
echo "現在のpackage.jsonバージョン: $current_version"

# 2. 前回リリースタグからcoderm部分を取得（codermタグのみを検索）
latest_tag=$(git tag --list '*-coderm*' --sort=-version:refname | head -1)

if [ -n "$latest_tag" ]; then
  # 前回タグからcoderm部分を抽出（例: v1.121.0-coderm.0.15.0 → 0.15.0）
  prev_coderm_part=$(node -p "process.argv[1].replace(/.*-coderm\./,'')" "$latest_tag")
  next_version="${current_version}-coderm.${prev_coderm_part}"
  echo "前回タグ（${latest_tag}）のcoderm部をキャリーオーバー: ${current_version} → ${next_version}"
else
  echo "前回タグにcoderm部がないか、初回リリースのため、キャリーオーバー不要（バージョン: ${current_version}）"
  next_version="${current_version}"
fi

# 3. バージョンフォーマット検証
if ! node -e "/^[0-9]+\.[0-9]+\.[0-9]+(-coderm\.[0-9]+\.[0-9]+\.[0-9]+)?$/.test(process.argv[1])||process.exit(1)" "$next_version"; then
  echo "エラー: バージョンフォーマットが不正です: $next_version"
  echo "期待フォーマット: X.Y.Z または X.Y.Z-coderm.A.B.C"
  exit 1
fi

# 4. package.jsonとpackage-lock.jsonを更新
if [ "$current_version" != "$next_version" ]; then
  node -e "const fs=require('fs'),f='package.json',p=JSON.parse(fs.readFileSync(f,'utf8'));p.version=process.argv[1];fs.writeFileSync(f,JSON.stringify(p,null,2)+'\n')" "$next_version"
  echo "✅ バージョン更新: $current_version → $next_version"
  npm install --package-lock-only
  git add package.json package-lock.json
  git commit --amend --no-edit
  echo "✅ マージコミットにバージョン更新をamend"
else
  echo "✅ バージョン変更なし（$current_version）"
fi
```

### Step 7: push & PR作成（worktreeから）

```bash
# 1. 同期サマリー
echo ""
echo "═══════════════════════════════════════"
echo "  📋 Upstream同期完了サマリー"
echo "═══════════════════════════════════════"
echo ""
echo "  取り込みコミット数: $commit_count"
echo "  コンフリクト解決数: $conflict_count"
echo "  バージョン: $next_version"
echo ""
echo "═══════════════════════════════════════"
echo ""

# 2. ブランチをpush
git push -u origin "$wt_name"

# 3. PR本文を一時ファイルに生成
pr_body_file=$(node -e "const os=require('os'),path=require('path');console.log(path.join(os.tmpdir(),'coderm-pr-body.md'))")
node -e "
const fs = require('fs');
const bt = String.fromCharCode(96);
const body = [
  '## Summary',
  '',
  'Sync upstream changes from microsoft/vscode.',
  '',
  '- Commits merged: ' + process.argv[2],
  '- Conflicts resolved: ' + process.argv[3],
  '- Version: ' + process.argv[4],
  '',
  '## Test plan',
  '',
  '- [x] Build verification (' + bt + 'npm run compile' + bt + ') passed',
  '- [ ] Launch verification (' + bt + './scripts/code.sh' + bt + ')',
  '- [ ] No regression in existing features',
  ''
].join('\n');
fs.writeFileSync(process.argv[1], body);
" "$pr_body_file" "$commit_count" "$conflict_count" "$next_version"

# 4. PR作成
pr_title="chore: sync upstream microsoft/vscode v${next_version} (${sync_date})"
gh pr create \
  --title "$pr_title" \
  --body-file "$pr_body_file"

# 5. 一時ファイルを削除
node -e "require('fs').unlinkSync(process.argv[1])" "$pr_body_file"

# 6. PR番号を記憶（後続Stepで使用）
pr_number=$(gh pr list --head "$wt_name" --json number --jq '.[0].number')
echo "✅ PR作成完了: #$pr_number"
```

### Step 8: CI監視

PRトリガのCIが完了するまで監視する。`monitor-pr-ci` スキルを呼び出して結果を取得する。

**実行:** Skill toolで `monitor-pr-ci` を呼び出す（PR番号を引数として渡す）

**結果に応じた対応:**

| 結果 | アクション |
| ---- | ---------- |
| **OK** | Step 9（PRマージ）へ進む |
| **NG** | エラー内容を報告、AskUserQuestionで次のアクションを確認（修正/再試行/スキップ/中断） |
| **TIMEOUT** | AskUserQuestionで次のアクションを確認（再試行/スキップ/中断） |
| **SKIPPED** | PRトリガworkflowが存在しない。Step 9 へ進む |

**CI失敗時の注意:** upstream マージの自動修正はマージを壊すリスクがあるため、手動介入を優先する。

### Step 9: PRマージ（worktreeから）

```bash
# PRを --merge --admin でマージ（--squash は使用しない。upstream履歴を保持するため）
gh pr merge "$pr_number" --merge --admin
echo "✅ PRマージ完了: #$pr_number"
```

### Step 10: ベースディレクトリ復帰 & forest finish

```bash
# 1. ベースディレクトリに移動
cd "$(git rev-parse --show-toplevel)/../.."
echo "✅ ベースディレクトリに復帰: $(pwd)"

# 2. forest finish でworktreeを削除
forest finish "$wt_name"

# 3. セッションファイルクリーンアップ
REPO_ROOT="$(pwd)"
REPO_HASH=$(echo "$REPO_ROOT" | (md5 -q 2>/dev/null || md5sum | cut -d' ' -f1))
SESSION_FILE="/tmp/.claude-active-sessions-$REPO_HASH"
if [ -f "$SESSION_FILE" ]; then
  awk -F'\t' '$1 != "'"$wt_name"'"' "$SESSION_FILE" > "${SESSION_FILE}.tmp" && mv "${SESSION_FILE}.tmp" "$SESSION_FILE"
  [ ! -s "$SESSION_FILE" ] && rm "$SESSION_FILE"
fi
echo "✅ worktree削除完了: $wt_name"
```

**forest finish が実行する処理:**
1. `.worktrees/<name>/.git` の存在確認
2. 未プッシュコミット検査
3. `git worktree remove`
4. `git pull`（main ブランチ）
5. マージ済みブランチの自動削除
6. `npm install`（`.forest.toml` の `[finish].commands`）

**forest finish の終了コード:**

| コード | 意味 | 対処 |
| ------ | ---- | ---- |
| 0 | 成功 | 次のStepへ |
| 6 | `.worktrees/` が見つからない | cwdがベースディレクトリでない。Step 10 からやり直し |
| 7 | worktreeが見つからない | `{name}` が間違っている。`forest list` で確認 |
| 8 | finishコマンドの実行失敗 | `.forest.toml` の `[finish].commands` を確認 |
| 10 | `git pull` の失敗 | ネットワークやコンフリクトの可能性。手動で `git pull` してから再試行 |
| 11 | `git worktree remove` の失敗 | `git worktree remove --force` を手動実行してから再試行 |
| 12 | 未プッシュコミットが検出された | Step 7 のpushが不完全だった可能性。手動でpushしてから再試行 |

### Step 11: 同期完了サマリー

```bash
echo ""
echo "═══════════════════════════════════════"
echo "  ✅ Upstream同期完了"
echo "═══════════════════════════════════════"
echo ""
echo "  取り込みコミット数: $commit_count"
echo "  コンフリクト解決数: $conflict_count"
echo "  バージョン: $next_version"
echo "  PR: #$pr_number (merged)"
echo "  worktree: 削除済み ($wt_name)"
echo ""
echo "  release.ymlが自動的に以下を実行します:"
echo "  1. タグ（v${next_version}）の生成"
echo "  2. macOS (.dmg arm64) と Windows (.exe x64) のビルド"
echo "  3. GitHub Releaseの作成・ビルド成果物のアップロード"
echo ""
echo "═══════════════════════════════════════"
echo ""
```

AIはタグ生成・GitHub Release作成を一切行わないこと。

## エラーハンドリング

| エラー状況 | 対応 |
|---|---|
| upstreamリモート追加失敗 | ネットワーク確認を促す |
| fetch失敗 | ネットワーク確認を促す |
| `forest start` 失敗 | stderrのエラーメッセージを報告。終了コード別に対処 |
| マージで巨大なコンフリクト | ユーザーに確認し、abort選択肢を提示 |
| ビルドエラー | エラー内容を分析、修正を試みる |
| PR作成失敗 | ブランチはpush済みなので手動でPR作成を提案 |
| CI失敗 | エラー内容を報告、手動介入を優先 |
| PRマージ失敗 | エラー内容を報告、手動マージを提案 |
| `forest finish` 失敗 | 終了コード別に対処（上記Step 10の表を参照） |

## マージ中断

ユーザーが中断を要求した場合:

```bash
# Step 3-4 中（マージ進行中）の場合
git merge --abort

# ベースディレクトリに戻る
cd "$(git rev-parse --show-toplevel)/../.." 2>/dev/null || true

# worktreeを削除
forest finish "$wt_name" 2>/dev/null || git worktree remove --force ".worktrees/$wt_name" 2>/dev/null

# セッションファイルクリーンアップ
REPO_ROOT="$(pwd)"
REPO_HASH=$(echo "$REPO_ROOT" | (md5 -q 2>/dev/null || md5sum | cut -d' ' -f1))
SESSION_FILE="/tmp/.claude-active-sessions-$REPO_HASH"
if [ -f "$SESSION_FILE" ]; then
  awk -F'\t' '$1 != "'"$wt_name"'"' "$SESSION_FILE" > "${SESSION_FILE}.tmp" && mv "${SESSION_FILE}.tmp" "$SESSION_FILE"
  [ ! -s "$SESSION_FILE" ] && rm "$SESSION_FILE"
fi

echo "⚠️  マージを中断しました。mainブランチに戻ります。"
```

## 連携スキル

| ツール | 用途 |
| ------ | ---- |
| `forest` CLI (start/finish/list) | worktree ライフサイクル管理 |
| `monitor-pr-ci` スキル | PR の CI 監視（結果報告のみ、自動修正なし） |
