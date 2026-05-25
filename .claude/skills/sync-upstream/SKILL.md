---
name: sync-upstream
description: >-
  microsoft/vscodeのmainブランチからの変更取り込みを行う。upstreamをfetch・mergeし、
  コンフリクトを1件ずつ解決した後、coderm版バージョニング（キャリーオーバー）を行い、
  PRを作成してmainにマージする。マージ後はrelease.ymlが自動的にビルド・リリースを実行する。
model: opus
disable-model-invocation: true
---

# Upstream同期（microsoft/vscode追従）

## スキル概要

microsoft/vscode の main ブランチから最新の変更を取り込み、コンフリクトを解決し、
coderm版バージョニング（キャリーオーバー）を行った後、PR経由でmainにマージする一連のワークフローを実行します。
マージ後は release.yml が自動的にタグ生成・ビルド・GitHub Release作成を行います。

**基本フロー:** 前提条件チェック → sync ブランチ作成 → fetch & merge → コンフリクト解決（1件ずつ報告） → ビルド検証 → coderm版バージョニング → PR作成 → mainマージ → release.yml自動発火

**前提条件:**
- `main` ブランチから開始すること
- ワーキングツリーがクリーンであること
- upstreamリモートが設定済み（未設定の場合は自動追加）

## ガードレール（絶対に守ること）

| ルール | 理由 |
| ------ | ---- |
| **mainブランチから開始し、syncブランチで作業** | upstream追従はPR経由でmainにマージする運用 |
| **コンフリクト解決は1件ずつ報告** | 各マージ判断の透明性を確保するため |
| **ビルド検証を必ず実施** | マージ後のビルド破壊を防ぐため |
| **product.jsonのCodermカスタム値は絶対に上書きしない** | Codermのブランディング・パス設定が失われるため |
| **`npm run watch`は絶対に実行しない** | CLAUDE.mdルール。`npm run compile`を代わりに使用 |
| **不明なコンフリクトはユーザに確認** | 機能損失を防ぐため。推測で解決しない |
| **PRは--adminでマージ** | j4rviscmdがownerのリポジトリでは--adminマージを許可 |
| **GitHub Release・タグの作成は絶対禁止** | release.ymlが自動実行する。手動実行すると二重実行・競合が発生する |

## コンテキスト情報

- 現在のブランチ: !`git branch --show-current`
- upstreamリモート: !`git remote get-url upstream 2>/dev/null || echo "未設定"`
- 最新のリリースタグ: !`git describe --tags --abbrev=0 2>/dev/null || echo "（リリースなし）"`
- 最新のupstream同期: !`git log --oneline --grep="Merge remote-tracking branch 'upstream" -1 2>/dev/null || echo "同期履歴なし"`

## Codermバージョニング（キャリーオーバー）

upstream merge後、`package.json` のversionは純粋なupstreamバージョン（例: `1.122.0`）になります。
Step 5で前回リリースタグからcoderm部分（例: `-coderm.0.15.0`）を抽出し、新しいupstreamバージョンに付加します。

**例:** `1.121.0-coderm.0.15.0`（現状） → upstream merge → `1.122.0` → キャリーオーバー → `1.122.0-coderm.0.15.0`

## コンフリクト解決方針

### ファイルカテゴリ別の解決ルール

| カテゴリ | 対象ファイル例 | 解決方針 |
|---|---|---|
| **Codermブランディング** | `product.json` | Codermの値を維持。upstream側の新規フィールドのみ追加 |
| **バージョン** | `package.json` | `version`フィールドはupstreamの値を採用。Step 5でcoderm部をキャリーオーバー |
| **Coderm独自コード** | `src/vs/workbench/contrib/coderm/` | Coderm機能を保持。upstream APIの変更に適応させる |
| **Coderm独自ドキュメント** | `README.md`, `README.en.md`, `CLAUDE.md` | Codermのドキュメントを保持 |
| **CI/CD** | `.github/workflows/` | 両方の変更を統合。Coderm固有ワークフローは保持 |
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

### Step 1: 前提条件チェック & syncブランチ作成

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

# 5. syncブランチ作成（同日複数回実行時はサフィックス付与で衝突回避）
sync_date=$(node -p "new Date().toISOString().slice(0,10)")
sync_branch="sync/upstream-${sync_date}"
if git show-ref --verify --quiet "refs/heads/${sync_branch}" 2>/dev/null; then
  sync_branch="${sync_branch}-$(node -p "Date.now().toString(36)")"
fi
git checkout -b "$sync_branch"
echo "✅ syncブランチ作成: $sync_branch"
```

### Step 2: upstream fetch & マージ開始

```bash
# 1. upstream fetch
echo "⏳ upstreamからfetch中..."
git fetch upstream

# 2. 差分確認
commit_count=$(git rev-list --count HEAD..upstream/main)
echo ""
echo "📊 upstream差分情報:"
echo "  取り込み対象コミット数: $commit_count"
echo ""

if [ "$commit_count" -eq 0 ]; then
  echo "✅ upstreamに新しい変更はありません。既に最新です。"
  git checkout main
  git branch -d "$sync_branch"
  exit 0
fi

# 主要な変更領域をサマリー表示
echo "主要な変更領域:"
git diff --stat HEAD..upstream/main
echo ""

# 3. マージ実行
echo "⏳ upstream/mainをマージ中..."
if git merge upstream/main --no-edit; then
  echo "✅ マージ成功（コンフリクトなし）"
  # Step 4（ビルド検証）へ進む
else
  echo "⚠️  コンフリクトが発生しました。解決を開始します。"
  # Step 3へ進む
fi
```

### Step 3: コンフリクト解決

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
  → README.md/README.en.mdか？ → Coderm版を保持
  → CLAUDE.mdか？ → Coderm版を保持
  → contrib/coderm/ 配下か？ → Coderm機能を保持、upstream API変更に適応
  → .github/workflows/ 配下か？ → 両方統合
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

### Step 4: ビルド検証

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

### Step 5: coderm版バージョニング（キャリーオーバー）

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

### Step 6: マージ結果サマリー & PR作成

```bash
# マージ結果のサマリー
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
```

syncブランチをpushし、mainへ向けたPRを作成する。

**PRタイトルテンプレート:**
```
chore: sync upstream microsoft/vscode v{version} ({date})
```

```bash
# 1. syncブランチをpush
git push -u origin "$sync_branch"

# 2. PR本文を一時ファイルに生成
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

# 3. PR作成
pr_title="chore: sync upstream microsoft/vscode v${next_version} (${sync_date})"
gh pr create \
  --title "$pr_title" \
  --body-file "$pr_body_file"

# 4. 一時ファイルを削除
node -e "require('fs').unlinkSync(process.argv[1])" "$pr_body_file"
```

### Step 7: PRマージ → mainに戻る → 完了

```bash
# 1. PRを--adminでマージ（CI完了を待たず即時マージ。Step 4でビルド検証済みのため）
gh pr merge "$sync_branch" --merge --admin

# 2. mainに切り替えて最新を取得
git checkout main
git pull origin main

# 3. ローカルのsyncブランチを削除
git branch -d "$sync_branch"
```

**マージ後、release.ymlが自動的に以下を実行します:**
1. `package.json` からバージョンを読み取り、タグ（`v{version}`）を生成
2. macOS (`.dmg` arm64) と Windows (`.exe` x64) のビルド
3. GitHub Releaseを作成し、ビルド成果物をアップロード

AIはタグ生成・GitHub Release作成を一切行わないこと。

## エラーハンドリング

| エラー状況 | 対応 |
|---|---|
| upstreamリモート追加失敗 | ネットワーク確認を促す |
| fetch失敗 | ネットワーク確認を促す |
| マージで巨大なコンフリクト | ユーザーに確認し、abort選択肢を提示 |
| ビルドエラー | エラー内容を分析、修正を試みる |
| PR作成失敗 | ブランチはpush済みなので手動でPR作成を提案 |
| PRトリガCI失敗 | エラー内容を報告、自動fixを試みる |
| PRマージ失敗 | エラー内容を報告、手動マージを提案 |

## マージ中断

ユーザーが中断を要求した場合:

```bash
# マージ中の場合
git merge --abort

# syncブランチにいる場合
git checkout main
git branch -D "$sync_branch" 2>/dev/null || true
echo "⚠️  マージを中断しました。mainブランチに戻ります。"
```
