---
name: sync-upstream
description: >-
  microsoft/vscodeのmainブランチからの変更取り込みを行う。upstreamをfetch・mergeし、コンフリクトを1件ずつ解決（各解決内容を報告）した後、/releaseスキルを自動発動してupstream追従リリースを作成する
model: opus
disable-model-invocation: true
---

# Upstream同期（microsoft/vscode追従）

## スキル概要

microsoft/vscode の main ブランチから最新の変更を取り込み、コンフリクトを解決し、
upstream追従リリースを作成する一連のワークフローを実行します。

**基本フロー:** 前提条件チェック → fetch & merge → コンフリクト解決（1件ずつ報告） → ビルド検証 → /release スキル発動

**前提条件:**
- `main` ブランチで実行すること
- ワーキングツリーがクリーンであること
- upstreamリモートが設定済み（未設定の場合は自動追加）

## ガードレール（絶対に守ること）

| ルール | 理由 |
| ------ | ---- |
| **mainブランチで実行** | upstream追従はmainに直接マージする運用 |
| **コンフリクト解決は1件ずつ報告** | 各マージ判断の透明性を確保するため |
| **ビルド検証を必ず実施** | マージ後のビルド破壊を防ぐため |
| **product.jsonのCodermカスタム値は絶対に上書きしない** | Codermのブランディング・パス設定が失われるため |
| **`npm run watch`は絶対に実行しない** | CLAUDE.mdルール。`npm run compile`を代わりに使用 |
| **不明なコンフリクトはユーザに確認** | 機能損失を防ぐため。推測で解決しない |

## コンテキスト情報

- 現在のブランチ: !`git branch --show-current`
- upstreamリモート: !`git remote get-url upstream 2>/dev/null || echo "未設定"`
- 最新のupstream同期: !`git log --oneline --grep="Merge remote-tracking branch 'upstream" -1 2>/dev/null || echo "同期履歴なし"`

## コンフリクト解決方針

### ファイルカテゴリ別の解決ルール

| カテゴリ | 対象ファイル例 | 解決方針 |
|---|---|---|
| **Codermブランディング** | `product.json` | Codermの値を維持。upstream側の新規フィールドのみ追加 |
| **バージョン** | `package.json` | `version`フィールドはupstreamの値を採用（リリーススキルがそのまま使用） |
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

### Step 1: 前提条件チェック

```bash
# 1. ブランチ確認
current_branch=$(git branch --show-current)
if [ "$current_branch" != "main" ]; then
  echo "エラー: mainブランチで実行してください（現在: $current_branch）"
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
  exit 0
fi

# 主要な変更領域をサマリー表示
echo "主要な変更領域:"
git diff --stat HEAD..upstream/main | tail -5
echo ""

# 3. マージ実行
echo "⏳ upstream/mainをマージ中..."
git merge upstream/main --no-edit
merge_exit=$?

if [ $merge_exit -eq 0 ]; then
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
conflict_count=$(echo "$conflict_files" | wc -l | xargs)
echo ""
echo "📋 コンフリクトファイル一覧 ($conflict_count 件):"
echo "$conflict_files" | while read -r f; do echo "  - $f"; done
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
npm run compile 2>&1

if [ $? -eq 0 ]; then
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

### Step 5: マージ結果サマリー & /release スキル発動

```bash
# マージ結果のサマリー
echo ""
echo "═══════════════════════════════════════"
echo "  📋 Upstream同期完了サマリー"
echo "═══════════════════════════════════════"
echo ""
echo "  取り込みコミット数: $commit_count"
echo "  コンフリクト解決数: $conflict_count"
echo "  upstreamバージョン: $(grep -o '\"version\"\s*:\s*\"[^\"]*\"' package.json | head -1 | sed 's/.*: \"\(.*\)\".*/\1/')"
echo ""
echo "═══════════════════════════════════════"
echo ""
```

**その後、`/release` スキルを自動発動する。**

releaseスキルが自動的にupstream追従リリースとして判定し、適切なバージョンでリリースPRを作成する。

## エラーハンドリング

| エラー状況 | 対応 |
|---|---|
| upstreamリモート追加失敗 | ネットワーク確認を促す |
| fetch失敗 | ネットワーク確認を促す |
| マージで巨大なコンフリクト | ユーザーに確認し、abort選択肢を提示 |
| ビルドエラー | エラー内容を分析、修正を試みる |
| /release失敗 | エラー内容を報告、手動対応を提案 |

## マージ中断

ユーザーが中断を要求した場合:

```bash
git merge --abort
echo "⚠️  マージを中断しました。mainブランチはマージ前の状態に戻っています。"
```
