---
name: release
description: >-
  このスキルは、ユーザーが「リリースして」「リリース作成」「バージョンアップ」
  「新規リリース」「リリース準備」「バージョン更新」と言った場合、または
  Codermのバージョニングに基づくリリース作業について話している場合に使用される。
  最新リリースとorigin/mainの差分を把握し、リリース種別を判定して
  バージョン管理ファイル（package.json）を更新し、release/{version}ブランチでmainへのPRを作成する。
model: sonnet
---

# Release 作成

## スキル概要

最新リリースとorigin/mainの差分を分析し、リリース種別（upstream追従 / Coderm独自）を判定して
バージョン管理ファイル（`package.json`）を更新し、リリース用PRを作成します。

**基本原則:** 差分把握 → リリース種別判定 → バージョン決定 → バージョンファイル更新 → release/{version}ブランチ作成 → PR作成

**前提条件:**
- origin/main にマージ済みの変更があること
- upstream追従リリースの場合は、upstreamマージがorigin/mainにマージ済みであること（package.jsonのバージョンが自動更新される前提）
- リモートリポジトリが設定されていること

## Codermバージョニング

Codermはupstream（VS Code）のforkであり、独自のバージョニング方式を採用しています。詳細は「仕様・制約」セクションを参照してください。

**フォーマット:** `{upstream_major}.{upstream_minor}.{upstream_patch}-coderm.{coderm_major}.{coderm_minor}.{coderm_patch}`

**リリース種別の判定:** コミット内容から自動推定し、ユーザーに提案。ユーザーが最終決定します。

## ガードレール（絶対に守ること）

| ルール | 理由 |
| ------ | ---- |
| **PR作成は`/create-pr`スキルで実行** | ラベル自動設定・CI監視が含まれるため |
| **CI監視は`/monitor-pr-ci`スキルで実行** | 30秒ポーリング・15分タイムアウトが実装済みのため |
| **GitHub Release作成・タグプッシュは絶対禁止** | タグ生成・Releaseページ作成はCI/CDパイプライン（release.yml）が担当する。AIが手動で実行すると二重実行・競合が発生する |
| **PRマージ後のbranchは必ず削除** | リモート・ローカル両方削除してリポジトリを整理する |
| **バージョンフォーマットは必ずセマンティック（3セグメント）** | Codermバージョンは `X.Y.Z` または `X.Y.Z-coderm.A.B.C` のいずれか。セグメントの省略（例: `coderm.0.10` のように末尾 `.0` を省略）は禁止。Step 3-2・Step 4・Step 6の各タイミングで正規表現検証を必ず実行すること |

## コンテキスト情報

- 現在のブランチ: !`git branch --show-current`
- デフォルトブランチ: !`git remote show origin 2>/dev/null | grep "HEAD branch" | cut -d: -f2 | xargs || echo "main"`
- 最新リリースタグ: !`git describe --tags --abbrev=0 2>/dev/null || echo "（リリースなし）"`
- 最新リリース以降の差分コミット: !`git log $(git describe --tags --abbrev=0 2>/dev/null || echo "HEAD~20")..origin/$(git remote show origin 2>/dev/null | grep "HEAD branch" | cut -d: -f2 | xargs || echo "main") --oneline --no-merges 2>/dev/null | head -20 || echo "差分なし"`

## 手順

### Step 0: タスク管理の開始

**重要:** 以下の10のタスクを順番に作成してください（Step 11は完了報告のみのためタスク管理対象外）。

**実行手順:**
1. 最初にタスク1（前提条件チェック）を作成
2. タスク1の作成完了後、タスク1のIDを確認
3. タスク2を作成し、`addBlockedBy`にタスク1のIDを指定
4. タスク2〜10についても同様に、前のタスクのIDを指定して作成
5. タスクは要約せず、記載通りに個別に作成すること

```bash
# タスク1: 前提条件チェック
TaskCreate:
- subject: 前提条件チェック
- description: |
  リモート設定、ブランチ確認、最新状態確認を実施
  - git remote get-url origin でリモート未設定の場合はエラー
  - git branch --show-current でデフォルトブランチにいるか確認
  - git fetch origin && git status で同期状態を確認
- activeForm: 前提条件をチェック中

# タスク2: 最新リリースと差分の把握
# 注: addBlockedByにタスク1のIDを指定すること
TaskCreate:
- subject: 最新リリースと差分の把握
- description: |
  最新リリースタグを取得し、origin/mainとの差分を分析
  - git describe --tags --abbrev=0 で最新タグ取得
  - git log で変更コミットを一覧（Step 3の対話で使用するため記録すること）
  - Conventional Commitsから変更タイプを集計（feat, fix, BREAKING CHANGE等）
  - upstreamマージコミットの有無を判定
  - 変更タイプの集計結果を記録（Step 3の対話で使用）
- activeForm: 差分を把握中
- addBlockedBy: [タスク1の実際のID]

# タスク3: リリース種別判定とバージョン決定
# 注: addBlockedByにタスク2のIDを指定すること
TaskCreate:
- subject: リリース種別判定とバージョン決定
- description: |
  コミット履歴からリリース種別を推定し、次期バージョンを計算してユーザーに確認
  - upstreamマージコミット有無でupstream追従/Coderm独自を判定
  - Coderm独自の場合: BREAKING CHANGE → coderm_major++, feat → coderm_minor++, fix → coderm_patch++
  - upstream追従の場合: 前回タグのcoderm部をキャリーオーバー + 新upstreamバージョン
  - AskUserQuestionでユーザーに推定結果を提示
- activeForm: バージョンを決定中
- addBlockedBy: [タスク2の実際のID]

# タスク4: バージョン管理ファイルの更新
# 注: addBlockedByにタスク3のIDを指定すること
TaskCreate:
- subject: バージョン管理ファイルの更新
- description: |
  バージョン参照する全ファイルのバージョンを更新
  - package.json: "version" フィールド（sedで正規表現置換、-coderm.X.Y.Z形式対応）
  - extensions/copilot/package.json: "engines.vscode" フィールド（sedで文字列置換）
  - package-lock.json（ルート・extensions/copilot）: バージョン参照（sedで文字列置換）
  - 更新後に grep -rn で旧バージョンの残存がないか検証
  - git diff で更新内容を確認
- activeForm: バージョンファイルを更新中
- addBlockedBy: [タスク3の実際のID]

# タスク5: releaseブランチの作成
# 注: addBlockedByにタスク4のIDを指定すること
TaskCreate:
- subject: releaseブランチの作成
- description: |
  release/{version} ブランチを作成
  - git checkout -b release/{version}
  - 既存ブランチがある場合は削除確認
- activeForm: releaseブランチを作成中
- addBlockedBy: [タスク4の実際のID]

# タスク6: 変更のコミット
# 注: addBlockedByにタスク5のIDを指定すること
TaskCreate:
- subject: 変更のコミット
- description: |
  バージョンファイルの変更をコミット
  - git add でバージョンファイルをステージング
  - git commit で "chore: release v{version}" をコミット
- activeForm: 変更をコミット中
- addBlockedBy: [タスク5の実際のID]

# タスク7: push
# 注: addBlockedByにタスク6のIDを指定すること
TaskCreate:
- subject: push
- description: |
  releaseブランチをリモートにプッシュ
  - git push -u origin release/{version}
- activeForm: push中
- addBlockedBy: [タスク6の実際のID]

# タスク8: PRの作成
# 注: addBlockedByにタスク7のIDを指定すること
TaskCreate:
- subject: PRの作成
- description: |
  /create-pr スキルを呼び出してリリース用PRを作成
  - Skill toolで create-pr を呼び出す
  - ラベル自動設定・言語判定はcreate-prスキルが担当
- activeForm: PRを作成中
- addBlockedBy: [タスク7の実際のID]

# タスク9: CI監視
# 注: addBlockedByにタスク8のIDを指定すること
TaskCreate:
- subject: CI監視
- description: |
  GitHub ActionsのCIが成功するまで監視
  - Skill toolで monitor-pr-ci を呼び出す（pr_numberを引数として渡す）
  - CI成功 → タスク完了
  - CI失敗 → AskUserQuestionで修正/再試行/スキップ/中断を確認
- activeForm: CIを監視中
- addBlockedBy: [タスク8の実際のID]

# タスク10: 次アクションの確認
# 注: addBlockedByにタスク9のIDを指定すること
TaskCreate:
- subject: 次アクションの確認
- description: |
  AskUserQuestionでユーザーに次のアクションを提案
  - 選択肢: PRのマージ / 後でマージ（手動対応）
  - PRのマージ選択時: gh pr merge {pr_number} --squash --delete-branch
    → git checkout {default_branch} && git pull origin {default_branch}
  - 【絶対禁止】GitHub Release作成・タグプッシュはCI/CDが担当するため実行しない
- activeForm: 次のアクションを確認中
- addBlockedBy: [タスク9の実際のID]
```

各ステップ完了後にTaskUpdateでstatusをcompletedに更新してください。

### Step 1: 前提条件チェック

1. **リモート確認**: `git remote get-url origin 2>/dev/null` - リモート未設定の場合はエラー終了
2. **ブランチ確認**: `git branch --show-current` - デフォルトブランチにいない場合は切り替え
3. **最新状態確認**: `git fetch origin && git status` - 「Your branch is behind」の場合はpullを促す

### Step 2: 最新リリースと差分の把握

```bash
# 最新リリースタグの取得
latest_tag=$(git describe --tags --abbrev=0 2>/dev/null)
default_branch=$(git remote show origin 2>/dev/null | grep "HEAD branch" | cut -d: -f2 | xargs || echo "main")

if [ -z "$latest_tag" ]; then
  echo "リリースタグがありません。初回リリースとして処理します。"
  latest_tag=$(git rev-list --max-parents=0 HEAD)
  initial_release=true
  commits=$(git log --oneline --no-merges | head -50)
  changed_files=$(git ls-tree -r --name-only ${default_branch})
else
  echo "最新リリース: $latest_tag"
  initial_release=false
  commits=$(git log ${latest_tag}..${default_branch} --oneline --no-merges)
  changed_files=$(git diff --name-only ${latest_tag} ${default_branch})
fi

echo "変更コミット:"
echo "$commits"
echo ""
echo "変更ファイル:"
echo "$changed_files" | head -30

# Conventional Commits から変更タイプを集計
feat_count=$(echo "$commits" | grep -cE "^feat(\(.+\))?:" || echo "0")
fix_count=$(echo "$commits" | grep -cE "^fix(\(.+\))?:" || echo "0")
refactor_count=$(echo "$commits" | grep -cE "^refactor(\(.+\))?:" || echo "0")
docs_count=$(echo "$commits" | grep -cE "^docs(\(.+\))?:" || echo "0")
chore_count=$(echo "$commits" | grep -cE "^chore(\(.+\))?:" || echo "0")
test_count=$(echo "$commits" | grep -cE "^test(\(.+\))?:" || echo "0")
breaking_count=$(echo "$commits" | grep -c "BREAKING CHANGE" || echo "0")

# upstreamマージコミットの検出
upstream_merge=$(echo "$commits" | grep -c "upstream\|Merge remote-tracking" || echo "0")

echo ""
echo "変更タイプ集計:"
echo "  feat: $feat_count"
echo "  fix: $fix_count"
echo "  refactor: $refactor_count"
echo "  docs: $docs_count"
echo "  chore: $chore_count"
echo "  test: $test_count"
echo "  BREAKING CHANGE: $breaking_count"
echo "  upstreamマージ: $upstream_merge"
```

### Step 3: リリース種別判定とバージョン決定

#### 3-1: 現在バージョンの取得とリリース種別判定

```bash
# バージョンファイル（Codermはpackage.jsonのみ使用）
version_file="package.json"

if [ ! -f "$version_file" ]; then
  echo "エラー: package.jsonが見つかりません"
  exit 1
fi

current_version=$(grep -o '"version"\s*:\s*"[^"]*"' "$version_file" | head -1 | sed 's/.*: "\(.*\)".*/\1/')
echo ""
echo "バージョンファイル: $version_file"
echo "現在のバージョン: $current_version"

# リリース種別の自動推定
if [ "$upstream_merge" -gt 0 ]; then
  suggested_type="upstream"
  type_reason="upstreamマージコミットが $upstream_merge 件検出されました"
elif [ "$breaking_count" -gt 0 ]; then
  suggested_type="coderm-major"
  type_reason="Coderm BREAKING CHANGE が $breaking_count 件含まれています"
elif [ "$feat_count" -gt 0 ]; then
  suggested_type="coderm-minor"
  type_reason="Coderm 新機能（feat:）が $feat_count 件含まれています"
elif [ "$fix_count" -gt 0 ]; then
  suggested_type="coderm-patch"
  type_reason="Coderm バグ修正（fix:）が $fix_count 件含まれています"
else
  suggested_type="coderm-patch"
  type_reason="Coderm ドキュメント・リファクタリング等の変更です"
fi

echo ""
echo "推定されるリリース種別: $suggested_type"
echo "理由: $type_reason"
```

#### 3-2: 次期バージョンの計算

```bash
# 現在バージョンをパース（フォーマットは「仕様・制約」セクション参照）
# セグメント位置: {1}.{2}.{3}-coderm.{4}.{5}.{6}

# upstream部分（第1-3セグメント）を抽出
upstream_version=$(echo "$current_version" | sed 's/-coderm.*//')
upstream_major=$(echo "$upstream_version" | cut -d. -f1)
upstream_minor=$(echo "$upstream_version" | cut -d. -f2)
upstream_patch=$(echo "$upstream_version" | cut -d. -f3)

# coderm部分（第4-6セグメント）を抽出（サフィックスがない場合は0.0.0）
if echo "$current_version" | grep -q "-coderm\."; then
  coderm_part=$(echo "$current_version" | sed 's/.*-coderm\.//')
  coderm_major=$(echo "$coderm_part" | cut -d. -f1)
  coderm_minor=$(echo "$coderm_part" | cut -d. -f2)
  coderm_patch=$(echo "$coderm_part" | cut -d. -f3)
else
  coderm_major=0
  coderm_minor=0
  coderm_patch=0
fi

echo "パース結果:"
echo "  upstream: $upstream_major.$upstream_minor.$upstream_patch"
echo "  coderm: $coderm_major.$coderm_minor.$coderm_patch"

# リリース種別に基づいて次期バージョンを計算
# 変更ルールの詳細は「仕様・制約」セクションのテーブルを参照
case "$suggested_type" in
  upstream)
    # upstream追従: 新upstream部 + 前回タグのcoderm部をキャリーオーバー
    # package.jsonはマージで純粋なupstreamバージョンになっているため、
    # 前回タグ（$latest_tag、Step 2で取得済み）からcoderm部分を取得して付加
    if [ -n "$latest_tag" ] && echo "$latest_tag" | grep -q "\-coderm\."; then
      prev_coderm_part=$(echo "$latest_tag" | sed 's/.*-coderm\.//')
      next_version="${upstream_major}.${upstream_minor}.${upstream_patch}-coderm.${prev_coderm_part}"
      version_reason="upstream追従リリース。前回タグ（${latest_tag}）のcoderm部分をキャリーオーバーします。"
    else
      # 前回タグにcoderm部がない場合（初回upstream追従等）はcoderm.0.0.0を付加
      next_version="${upstream_major}.${upstream_minor}.${upstream_patch}-coderm.0.0.0"
      version_reason="upstream追従リリース。前回タグにcoderm部がないため、coderm.0.0.0を付加します。"
    fi
    ;;
  coderm-major)
    # 第4セグメント+1、第5-6を0にリセット
    next_version="${upstream_major}.${upstream_minor}.${upstream_patch}-coderm.$((coderm_major + 1)).0.0"
    version_reason="Coderm破壊的変更"
    ;;
  coderm-minor)
    # 第5セグメント+1、第6を0にリセット
    next_version="${upstream_major}.${upstream_minor}.${upstream_patch}-coderm.${coderm_major}.$((coderm_minor + 1)).0"
    version_reason="Coderm機能追加"
    ;;
  coderm-patch)
    # 第6セグメントのみ+1（第4-5はそのまま）
    next_version="${upstream_major}.${upstream_minor}.${upstream_patch}-coderm.${coderm_major}.${coderm_minor}.$((coderm_patch + 1))"
    version_reason="Codermバグ修正"
    ;;
esac

echo ""
echo "次期バージョン: $next_version"
echo "理由: $version_reason"

# 次期バージョンのフォーマット検証（必須）
if ! echo "$next_version" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+(-coderm\.[0-9]+\.[0-9]+\.[0-9]+)?$'; then
  echo "エラー: 次期バージョンのフォーマットが不正です: $next_version"
  echo "期待フォーマット: X.Y.Z または X.Y.Z-coderm.A.B.C（coderm部は3セグメント必須）"
  echo "よくある誤り: coderm.0.10（×）→ coderm.0.10.0（〇）"
  exit 1
fi

# 初回リリースの場合: upstream追従でなければ、coderm部が0.0.0ならcoderm.0.1.0を強制使用
if [ "$initial_release" = true ] && [ "$suggested_type" != "upstream" ]; then
  if [ "$coderm_major" -eq 0 ] && [ "$coderm_minor" -eq 0 ] && [ "$coderm_patch" -eq 0 ]; then
    next_version="${upstream_major}.${upstream_minor}.${upstream_patch}-coderm.0.1.0"
    echo "初回リリースのため、バージョン $next_version を使用します"
  fi
fi
```

#### 3-3: バージョン計算の自己検証（必須）

**AskUserQuestionを表示する前に、以下の検証を必ず実行してください。**

計算した `next_version` が正しいことを、セグメントごとに照合します:

1. 現在バージョン `{A.B.C-coderm.D.E.F}` の各セグメントを確認
2. リリース種別に対応するセグメントのみが変更されているか確認（「仕様・制約」セクションのテーブル参照）
3. **よくある誤り**: coderm-patchなのに第5セグメントを+1して `0.19.0` にしてしまう → 正しくは第6セグメントのみ+1で `0.18.2`
4. 検証OKの場合のみ、次のAskUserQuestionに進む

#### 3-4: 対話的な確認

AskUserQuestionツールでユーザーに確認します。

```text
質問: 推定されたバージョン更新で正しいですか？

## 変更内容の要約
{Step 2で取得した変更コミットリストを表示（最大10件まで）}

## 変更タイプ集計
- feat: {feat_count} 件
- fix: {fix_count} 件
- BREAKING CHANGE: {breaking_count} 件
- その他: {refactor_count + docs_count + chore_count + test_count} 件

## リリース種別
{upstream追従 / Coderm機能追加 / Codermバグ修正 / Coderm破壊的変更}

## 推奨バージョン
v{next_version}

推奨理由: {version_reason}

選択肢:
1. はい - v{next_version} でリリース
2. いいえ - 別のバージョンを指定
```

### Step 4: バージョン管理ファイルの更新

```bash
# バージョンを更新（Coderm版）
# 正規表現は標準フォーマット（1.121.0）とCodermフォーマット（1.121.0-coderm.0.1.0）の両方にマッチ
if [ "$next_version" != "$current_version" ]; then
  sed -i '' -E 's/"version"\s*:\s*"[0-9]+\.[0-9]+\.[0-9]+(-coderm\.[0-9]+\.[0-9]+\.[0-9]+)?"/"version": "'"$next_version"'"/' "$version_file"
  echo ""
  echo "バージョンを更新: $version_file"
  echo "  $current_version → $next_version"
else
  echo ""
  echo "バージョン変更なし（$current_version）"
fi

# extensions/copilot/package.json の engines.vscode も更新
# pre-commit hook（hygiene）が engines.vscode と package.json#version の一致を検証するため、
# この更新を忘れるとコミットが拒否される
copilot_pkg="extensions/copilot/package.json"
if [ -f "$copilot_pkg" ]; then
  sed -i '' "s/${current_version}/${next_version}/g" "$copilot_pkg"
  echo "バージョンを更新: $copilot_pkg"
  echo "  $current_version → $next_version"
fi

# package-lock.json（ルート・extensions/copilot）のバージョン参照も更新
lock_files=("package-lock.json" "extensions/copilot/package-lock.json")

for lock_file in "${lock_files[@]}"; do
  if [ -f "$lock_file" ]; then
    sed -i '' "s/${current_version}/${next_version}/g" "$lock_file"
    echo "バージョンを更新: $lock_file"
    echo "  $current_version → $next_version"
  fi
done

# 更新後の検証: 旧バージョン文字列の残存チェック
# これにより、更新漏れがあった場合は確実に検出できる
stale_refs=$(grep -rn "$current_version" --include="*.json" --include="*.ts" --include="*.js" . 2>/dev/null | grep -v "node_modules" | grep -v ".git/" | grep -v "out/" || true)
if [ -n "$stale_refs" ]; then
  echo ""
  echo "⚠️ 警告: 旧バージョンの参照が残存しています:"
  echo "$stale_refs"
  echo ""
  echo "上記ファイルのバージョン参照も更新してください"
fi

echo ""
echo "更新内容:"
git diff

# 更新後のバージョンフォーマット検証（必須）
updated_version=$(grep -o '"version"\s*:\s*"[^"]*"' "$version_file" | head -1 | sed 's/.*: "\(.*\)".*/\1/')
if ! echo "$updated_version" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+(-coderm\.[0-9]+\.[0-9]+\.[0-9]+)?$'; then
  echo "エラー: 更新後のバージョンフォーマットが不正です: $updated_version"
  echo "期待フォーマット: X.Y.Z または X.Y.Z-coderm.A.B.C（coderm部は3セグメント必須）"
  echo "よくある誤り: coderm.0.10（×）→ coderm.0.10.0（〇）"
  exit 1
fi
echo "フォーマット検証OK: $updated_version"
```

### Step 5: releaseブランチの作成

```bash
branch_name="release/$next_version"

# 既存ブランチのチェック
if git show-ref --verify --quiet refs/heads/"$branch_name"; then
  echo "警告: ブランチ $branch_name は既に存在します"
  → AskUserQuestionでユーザーに既存ブランチの削除確認を行う
  → 削除選択時: git branch -D "$branch_name"
  → 中断選択時: 処理を中断
fi

git checkout -b "$branch_name"
echo "ブランチを作成: $branch_name"
```

### Step 6: 変更のコミット

```bash
commit_message="chore: release v$next_version"

# コミット前の最終バージョンフォーマット検証（必須）
final_version=$(grep -o '"version"\s*:\s*"[^"]*"' "$version_file" | head -1 | sed 's/.*: "\(.*\)".*/\1/')
if ! echo "$final_version" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+(-coderm\.[0-9]+\.[0-9]+\.[0-9]+)?$'; then
  echo "エラー: コミット前のバージョンフォーマットが不正です: $final_version"
  echo "期待フォーマット: X.Y.Z または X.Y.Z-coderm.A.B.C（coderm部は3セグメント必須）"
  echo "よくある誤り: coderm.0.10（×）→ coderm.0.10.0（〇）"
  exit 1
fi

# バージョンファイルとpackage-lock.jsonとcopilot package.jsonをステージング
git add "$version_file" package-lock.json extensions/copilot/package.json
if [ -f "extensions/copilot/package-lock.json" ]; then
  git add extensions/copilot/package-lock.json
fi

# upstream追従等でバージョン変更がない場合は空コミットを許可（通常発生しないが安全策）
if git diff --cached --quiet; then
  echo "コミットすべき変更がありません（upstream追従リリース等）"
  git commit --allow-empty -m "$commit_message"
else
  git commit -m "$commit_message"
fi
echo "コミット完了: $commit_message"
```

**注意:** リリースコミットメッセージは固定（`chore: release v{version}`）のため、言語判定は不要です。

### Step 7: push

```bash
git push -u origin "$branch_name"
echo "push完了: origin/$branch_name"
```

### Step 8: PRの作成

**目的**: `/create-pr` スキルを呼び出してリリース用PRを作成

**実行**: Skill toolで `create-pr` を呼び出す

```text
Skill tool:
  skill: "create-pr"
```

`create-pr` スキルが以下を自動処理する:
- PRテンプレートの検索・適用
- `detect-language` による言語判定
- ラベル自動設定
- PRタイトル・本文の生成（`chore: release v{next_version}` 形式を指示すること）

**完了アクション**（この順序で実行）:
1. `create-pr` スキルからPR番号とURLを受け取り記憶する（Step 9で使用）
2. TaskUpdateで「PRの作成」を`status: "completed"`に更新
3. **即座に** Step 9（CI監視）を開始

**【絶対禁止】**:
- `gh pr create` を直接呼び出す行為
- `create-pr` スキルを呼び出さずにPRを作成する行為
- スキル完了後に停止・待機する行為

---

### Step 9: CI監視

**目的**: GitHub ActionsのCIが成功するまで監視

**実行**: Skill toolで `monitor-pr-ci` を呼び出す（Step 8で取得したPR番号を引数として渡す）

**完了アクション**（この順序で実行）:
1. `monitor-pr-ci` スキル結果を受け取る
2. CI成功の場合はTaskUpdateで「CI監視」を`status: "completed"`に更新
3. CI失敗の場合はエラー内容を報告してAskUserQuestionで次のアクションを確認（e.g. 修正/再試行/スキップ/中断）

**【絶対禁止】**:
- `monitor-pr-ci` スキルを呼び出さずにCIを監視する行為
- スキル完了後に停止・待機する行為

---

### Step 10: 次アクションの確認

**目的**: 次のアクションをユーザーに提案

**要件**:
- AskUserQuestionツールで次のアクションを確認
- 選択肢: 「PRをマージする」 / 「後でマージする（手動対応）」

**PRのマージを選択した場合の処理**（この順序で実行）:
1. `gh pr merge {pr_number} --squash --delete-branch`（リモートブランチも削除）
2. `git checkout {default_branch}`
3. `git pull origin {default_branch}`

**【絶対禁止】**:
- GitHub Release の作成（`gh release create` 等）
- タグのプッシュ（`git tag` / `git push --tags` 等）
- 上記はCI/CDパイプライン（release.yml）が自動実行するため、AIが手動実行すると二重実行・競合が発生する

**完了アクション**（この順序で実行）:
1. TaskUpdateで「次アクションの確認」を`status: "completed"`に更新
2. すべてのタスクをTaskUpdateで`status: "deleted"`に設定してクリーンアップ
3. **即座に** Step 11（完了報告）を出力

---

### Step 11: 完了報告

```text
## Release PR作成完了

- **バージョン**: v{current_version} → v{next_version}
- **リリース種別**: {upstream追従 / Coderm機能追加 / Codermバグ修正 / Coderm破壊的変更}
- **ブランチ**: release/{next_version} → {default_branch}
- **PR URL**: {PRのURL}
- **CI**: {CI結果}
- **マージ**: {マージ済みの場合}完了

GitHub Release作成・タグプッシュはCI/CDが自動実行します（手動操作不要）
```

## エラーハンドリング

| エラー状況 | 対応 |
| --- | --- |
| リモート未設定 | エラー終了し、リモート設定を促す |
| デフォルトブランチ以外にいる | デフォルトブランチに切り替えを促す |
| origin/main と同期していない | pull を促す |
| package.jsonが見つからない | エラー終了 |
| 既存ブランチが存在する | 削除確認または処理中断 |
| プッシュ失敗 | エラーメッセージを表示 |

## 注意事項

- GitHub CLI（gh）を使用すること
- 対話的な確認を通じて、誤ったバージョン更新を防ぐこと
- 破壊的変更（BREAKING CHANGE）がある場合は、必ず coderm_major を更新すること

## 仕様・制約

### Coderm独自バージョニング

Codermはupstream（VS Code）のforkであり、独自のバージョニング方式を使用します。

**フォーマット:** `{upstream_major}.{upstream_minor}.{upstream_patch}-coderm.{coderm_major}.{coderm_minor}.{coderm_patch}`

セグメント位置: `{1}.{2}.{3}-coderm.{4}.{5}.{6}`

| フィールド | セグメント位置 | 意味 |
|---|---|---|
| `{upstream_major}.{upstream_minor}.{upstream_patch}` | 第1-3 | upstream VS Codeバージョン |
| `coderm_major` | 第4 | Coderm破壊的変更（当面`0`固定） |
| `coderm_minor` | 第5 | Coderm機能追加 |
| `coderm_patch` | 第6 | Codermバグ修正 |

**リリース種別の判定とバージョン更新:**

コミット内容からリリース種別を自動判定します。判定優先度は上から順です。

| コミット内容（判定優先度順） | リリース種別 | バージョン更新 | 変更セグメント |
|---|---|---|---|
| upstreamマージコミットあり | upstream追従 | 新upstream部 + 前回タグのcoderm部をキャリーオーバー | 第1-3 |
| `BREAKING CHANGE` 含む | Coderm破壊的変更 | `coderm_major++` | 第4を+1, 第5-6を0 |
| `feat:` 含む（upstreamマージなし） | Coderm機能追加 | `coderm_minor++` | 第5を+1, 第6を0 |
| `fix:` のみ | Codermバグ修正 | `coderm_patch++` | **第6のみ+1** |
| `refactor:`, `docs:`, `chore:`, `test:` | Codermバグ修正 | `coderm_patch++` | 第6のみ+1 |

**例:**
- upstream追従: `1.121.0-coderm.0.15.0` → `1.122.0-coderm.0.15.0`（coderm部をキャリーオーバー）
- Coderm機能追加: `1.121.0-coderm.0.1.0` → `1.121.0-coderm.0.2.0`（第5セグメント+1）
- Codermバグ修正: `1.121.0-coderm.0.1.0` → `1.121.0-coderm.0.1.1`（**第6セグメントのみ+1**）

### バージョンファイル

Codermは `package.json` の `version` フィールドを唯一のsource of truthとして使用します。リリース時には以下のファイルのバージョン参照を同期して更新します:

| ファイル | 更新対象フィールド | 備考 |
|---|---|---|
| `package.json` | `"version"` | source of truth |
| `extensions/copilot/package.json` | `"engines.vscode"` | pre-commit hookがpackage.json#versionとの一致を検証 |
| `package-lock.json` | `"version"` 等 | ルート |
| `extensions/copilot/package-lock.json` | `"vscode"` | copilot拡張 |

package.jsonの`version`に`-coderm.X.Y.Z`プレリリース識別子を含めることで、バージョン管理をpackage.jsonで一元化しています。ビルド時に `quality="coderm"` に基づいて `-coderm` サフィックスが付加され、`product.json#version` に書き込まれます（二重付加を防止するロジックが`gulpfile.vscode.ts`に実装済み）。

### CI/CDパイプライン（release.yml）

PRがmainにマージされると、release.ymlが自動的に以下を実行します:
1. タグを生成（`v{version}`）
2. macOS (`.dmg` arm64/x64) と Windows (`.exe` Inno Setup x64) のビルドを実行
3. GitHub Releaseを作成し、ビルド成果物をアップロード

コード署名はad-hoc（署名なし）です。AIはこれらの手動実行を一切行わないこと。

### Conventional Commits 解析

上記テーブルの通り、コミット内容からバージョン更新タイプを決定します。判定優先度: upstreamマージ > BREAKING CHANGE > feat > fix > その他。
