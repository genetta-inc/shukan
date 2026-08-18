#!/bin/sh
# ─────────────────────────────────────────────────────────────
# test-auto-merge-workflow.sh — auto-merge workflow の安全不変条件を機械的に assert する
# （dev-workflow プラグイン templates/auto-merge/ から展開。CI で毎 PR 実行すること）
#
# auto-merge は「人間のマージ操作を機械に置き換える」仕組みなので、条件判定が壊れたことに
# 気付けないと main が黙って汚れる。ネットワークを使わずに検証できる不変条件をここで固定する:
#
#   (1) 聖域パス判定の**実物の正規表現**を workflow から抜き出し、聖域パス群に一致し、
#       それ以外のパスに一致しないことを実際に grep で確かめる（文字列の目視ではなく挙動）
#   (2) 必須チェック名（REQUIRED_CHECKS）と ci.yml のジョブ名が**完全に一致**する
#       （GitHub Free private は branch protection が使えず、名前一致だけが CI green の
#       判定根拠。ズレると原因不明の停滞に見えるので、ズレた瞬間に CI で落とす）
#   (3) 4条件（agent-review:passed / CI green / 聖域 / AUTOMERGE_PAUSED）と
#       PAT 未設定時の fail-closed が workflow に存在する
#   (4) revert workflow は revert PR を作るだけでマージしない
#   (5) 運用ドキュメント（docs/auto-merge.md）に停止方法・PAT 発行・聖域一覧がある
#   (6) workflow に埋め込まれたシェルスクリプトが構文的に正しい（bash -n）
#
# 破壊的操作なし・ネットワーク不要。リポジトリ内のファイルを読むだけ。
# ─────────────────────────────────────────────────────────────
set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# AUTOMERGE_TEST_ROOT で検査対象ツリーを差し替えられる（テンプレート自体の自己検証用。
# 展開先リポの CI では未設定のまま = scripts/ の親をリポルートとして検査する）
ROOT="${AUTOMERGE_TEST_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"

WF="$ROOT/.github/workflows/auto-merge.yml"
RV="$ROOT/.github/workflows/revert-pr.yml"
CI="$ROOT/.github/workflows/ci.yml"
DOC="$ROOT/docs/auto-merge.md"

PASS=0
FAIL=0
ok() { echo "PASS  $1"; PASS=$((PASS + 1)); }
ng() { echo "FAIL  $1"; FAIL=$((FAIL + 1)); }

has() { grep -qF -- "$2" "$1"; }

# workflow 内のマーカー（# >>> name … # <<< name）で囲まれた範囲を取り出す。
extract_block() {
  sed -n "/# >>> $2/,/# <<< $2/p" "$1"
}

# YAML ブロックスカラー（run: |）の埋め込みスクリプトを取り出して dedent する。
extract_script() {
  extract_block "$1" "$2" | sed 's/^          //'
}

echo "auto-merge ワークフローテスト（安全不変条件の assert）"
echo "----------------------------------------"

# ── (0) ファイル存在 ─────────────────────────────────────────
missing=0
for f in "$WF" "$RV" "$CI" "$DOC"; do
  [ -f "$f" ] || { ng "未存在: $f"; missing=1; }
done
if [ "$missing" -eq 1 ]; then
  echo "----------------------------------------"
  echo "$PASS passed, $FAIL failed"
  exit 1
fi
ok "auto-merge.yml / revert-pr.yml / ci.yml / docs/auto-merge.md が実在する"

TMPD=$(mktemp -d)
trap 'rm -rf "$TMPD"' EXIT INT TERM

# ── (1) 聖域パス判定: 実物の正規表現を挙動で検査 ──────────────
SACRED=$(extract_block "$WF" "sacred-paths" | grep "SACRED='" | sed "s/^ *SACRED='//; s/'\$//")
if [ -z "$SACRED" ]; then
  ng "聖域パスの正規表現を auto-merge.yml から抽出できない（# >>> sacred-paths マーカーを確認）"
else
  ok "聖域パスの正規表現を抽出できた"

  # 聖域に**必ず**一致しなければならないパス（既定4系統）。
  # .github/workflows/ は「ディレクトリ丸ごと」であることを、まだ存在しないファイル名
  # （evil.yml / nested/）でも確かめる — 個別ファイル列挙に退行したら落ちる。
  # 【展開時】auto-merge.yml の SACRED にリポ固有の聖域を足したら、ここにも代表パスを足す。
  for p in \
    ".github/workflows/ci.yml" \
    ".github/workflows/auto-merge.yml" \
    ".github/workflows/revert-pr.yml" \
    ".github/workflows/evil.yml" \
    ".github/workflows/nested/deploy.yml" \
    "CLAUDE.md" \
    "workspace/moko/CLAUDE.md" \
    ".claude/skills/cron-triggers/SKILL.md" \
    ".claude/settings.json" \
    "docs/agent-loop.md" \
    "docs/agent-loop-steps.md" \
    "docs/agent-loop/steps.md"; do
    if printf '%s\n' "$p" | grep -qE "$SACRED"; then
      ok "聖域と判定される: $p"
    else
      ng "聖域と判定されない（自動マージされてしまう）: $p"
    fi
  done

  # 聖域に一致してはならないパス（通常の実装・ドキュメント変更が止まらないこと）
  for p in \
    "scripts/lint.sh" \
    "scripts/test-auto-merge-workflow.sh" \
    "docs/auto-merge.md" \
    "docs/context-guard.md" \
    "README.md" \
    "notCLAUDE.md" \
    ".github/ISSUE_TEMPLATE/bug.md" \
    "openspec/specs/rate-guard/spec.md"; do
    if printf '%s\n' "$p" | grep -qE "$SACRED"; then
      ng "聖域と誤判定される（人間マージに落ちてしまう）: $p"
    else
      ok "聖域ではないと判定される: $p"
    fi
  done
fi

# ── (1-b) 攻撃再現: 聖域ファイルを非聖域パスへ rename して迂回する ───
# filename（変更後）だけを見ていると、docs/agent-loop.md → docs/innocuous.md の rename が
# 素通りする。workflow が実際に使う jq プログラムを抜き出し、rename の fixture に当てて
# 「rename 元パスが列挙される」→「聖域判定が発火する」ことを確かめる。
FILES_JQ=$(extract_block "$WF" "sacred-paths-jq" | grep "FILES_JQ='" | sed "s/^ *FILES_JQ='//; s/'\$//")
if [ -z "$FILES_JQ" ]; then
  ng "変更ファイル列挙の jq プログラムを抽出できない（# >>> sacred-paths-jq マーカーを確認）"
elif ! command -v jq >/dev/null 2>&1; then
  echo "SKIP  jq が無いため rename 迂回テストを省略"
else
  cat > "$TMPD/files.json" <<'JSON'
[
  {"filename": "docs/innocuous-notes.md", "previous_filename": "docs/agent-loop.md", "status": "renamed"},
  {"filename": "scripts/feature.sh", "status": "modified"},
  {"filename": ".github/workflows/ci.yml", "status": "removed"}
]
JSON
  jq -r "$FILES_JQ" "$TMPD/files.json" > "$TMPD/paths.txt" 2>/dev/null || true

  if grep -qxF "docs/agent-loop.md" "$TMPD/paths.txt"; then
    ok "rename 元パス（previous_filename）が判定対象に列挙される"
  else
    ng "rename 元パスが列挙されない（聖域ファイルを rename すれば迂回できてしまう）"
  fi

  # 攻撃そのものの再現: 変更後の名前だけでは聖域に当たらない（＝防御が要る証明）
  if printf '%s\n' "docs/innocuous-notes.md" | grep -qE "$SACRED"; then
    ng "fixture の rename 先が偶然に聖域一致している（テストとして無効）"
  else
    ok "攻撃再現: rename 後の名前だけでは聖域に一致しない"
  fi

  if grep -E "$SACRED" "$TMPD/paths.txt" >/dev/null; then
    ok "rename fixture 全体では聖域判定が発火する（迂回が塞がれている）"
  else
    ng "rename fixture で聖域判定が発火しない（迂回可能）"
  fi

  # 削除も聖域: .github/workflows/ci.yml を消す PR は human-merge に落ちる
  if printf '%s\n' ".github/workflows/ci.yml" | grep -qE "$SACRED"; then
    ok "聖域ファイルの削除（status=removed）も聖域判定に当たる"
  else
    ng "聖域ファイルの削除が聖域判定に当たらない"
  fi
fi

# ── (1-c) 攻撃再現: head ブランチ側の改変版 workflow を自分で実行する ───
# GitHub Actions の**素の pull_request** イベントは PR の head 側の定義で実行されるため、
# auto-merge.yml を書き換えた PR が改変版の自分自身を動かせてしまう（自己参照防御の破れ）。
# 一方 **pull_request_target は常に base（main）側の定義**で実行される（GitHub 仕様）ため、
# この攻撃は成立しない（改変版はマージされるまで一度も実行されない）。よって assert は
# 旧「pull_request(_target) が無い」から次の2段に分ける（レビュー合格 → 即マージの即応経路
# として pull_request_target: [labeled] を意図的に使うため）:
#   ①素の pull_request が無いこと（これだけが head 側定義で動く危険トリガー）
#   ②pull_request_target は labeled のみ（イベント種の押し広げを検知する）
if grep -qE '^ *pull_request: *($|\[)' "$WF" || awk '/^on:/{f=1;next} /^[^ #]/{f=0} f' "$WF" | grep -qE '^ *pull_request:'; then
  ng "auto-merge.yml に素の pull_request トリガーがある（head 側の改変版が実行され自己参照防御が破れる）"
else
  ok "素の pull_request トリガーが無い（head 側の改変版は実行されない）"
fi

awk '/^on:/{f=1;next} /^[^ #]/{f=0} f' "$WF" > "$TMPD/on-block.txt"
for t in pull_request_target workflow_run schedule workflow_dispatch; do
  if grep -qE "^ *$t:" "$TMPD/on-block.txt"; then
    ok "トリガーに $t がある（既定ブランチ側の定義で実行される）"
  else
    ng "トリガーに $t が無い"
  fi
done

# pull_request_target のイベント種は labeled **のみ**。synchronize / opened 等を足しても
# base 側定義で動くこと自体は変わらないが、「合格ラベル付与の即応」という意図を超えた
# 押し広げ（push のたびに write トークン付きで走る等）はここで検知して人間に問う。
PT_TYPES=$(awk '/^  pull_request_target:/{f=1;next} /^  [a-z_]/{f=0} f' "$TMPD/on-block.txt" \
  | grep -E '^ *types:' | sed 's/^ *//')
if [ "$PT_TYPES" = "types: [labeled]" ]; then
  ok "pull_request_target は labeled のみ（イベント種が押し広げられていない）"
else
  ng "pull_request_target のイベント種が labeled のみでない（actual: ${PT_TYPES:-未検出}）"
fi

# **pull_request_target の安全性の根拠（この assert が破られたら target は危険になる）**:
# target イベントは fork PR に対しても write 権限の GITHUB_TOKEN とシークレット
# （AUTOMERGE_PAT 含む）を持って走る。そのリスクが実害になるのは「PR head のコードを
# checkout / 実行した場合」だけで、本 workflow は gh API の読み取り判定のみで完結する。
# つまり「checkout が存在しない」ことが target 採用の安全性を支える不変条件そのもの。
# checkout（や head の clone）を足す変更は、この assert を落として必ず人間の目を通す。
# コメント行（説明でこの不変条件に言及する行）は除外し、実行される定義行だけを見る
# （checkout は uses: ステップか run: 内のコマンドとして現れ、どちらも非コメント行）。
if grep -vE '^ *#' "$WF" | grep -qE 'actions/checkout|git +clone|gh pr checkout'; then
  ng "auto-merge.yml に checkout / clone がある（pull_request_target で PR head のコードが実行されうる。checkout を消すか pull_request_target を外すこと）"
else
  ok "checkout / clone が無い（pull_request_target でも PR head のコードは一切実行されない）"
fi

# labeled 即応はイベントの対象 PR **だけ**を判定する（全 PR 走査は workflow_run / schedule の
# 役割のまま）。分岐が「対象の絞り込み」であって「条件の緩和」でないことは、判定本体が
# TARGETS ループ内で共通なことにより担保される。番号は数値形式検査を通す（形式固定）。
LABELED_BLOCK=$(extract_block "$WF" "labeled-target")
if printf '%s' "$LABELED_BLOCK" | grep -qF 'TARGETS="$EVENT_PR"' \
   && printf '%s' "$LABELED_BLOCK" | grep -qF "*[!0-9]*" \
   && extract_script "$WF" "automerge-script" | grep -qF '"$EVENT_NAME" = "pull_request_target"'; then
  ok "labeled イベントは対象 PR だけを判定する（番号の数値検査つき。全 PR 走査は他イベントのまま）"
else
  ng "labeled イベントの対象 PR 限定分岐が無い／数値形式検査が無い（# >>> labeled-target マーカーを確認）"
fi

if has "$WF" 'head ブランチ'; then
  ok "ヘッダに素の pull_request を使わない理由（head 側定義で実行される仕様）が書かれている"
else
  ng "素の pull_request を使わない理由がコメントに無い（将来また足されてしまう）"
fi

if has "$WF" 'checkout しない' || has "$WF" 'checkout を一切行わず'; then
  ok "ヘッダに pull_request_target の安全条件（head を checkout しない不変条件）が書かれている"
else
  ng "pull_request_target の安全条件がコメントに無い（将来 checkout が足されてしまう）"
fi

# ── (1-d) 攻撃再現: 検証後に新コミットを push して未検証コードを混ぜる ───
# gh pr merge は「今の head」をマージするため、CI・聖域を検証してからマージするまでの
# 隙に push されたコミットを取り込む（TOCTOU）。REST の merge に検証済み SHA を渡す。
# コメント行での言及は無視し、実行されるコードだけを見る
extract_script "$WF" "automerge-script" | sed 's/#.*//' > "$TMPD/am-code.txt"
if grep -qF 'gh pr merge' "$TMPD/am-code.txt"; then
  ng "auto-merge.yml が gh pr merge を使っている（SHA ピンが効かず TOCTOU が残る）"
else
  ok "gh pr merge を使っていない（SHA ピン可能な REST に置き換え済み）"
fi

MERGE_CALL=$(grep -A 2 'gh api -X PUT "repos/\$REPO/pulls/\$N/merge"' "$WF" || true)
if printf '%s' "$MERGE_CALL" | grep -qF -- '-f sha="$HEAD_SHA"'; then
  ok "マージ呼び出しが検証済み HEAD SHA にピンされている（head が動けば 409 で失敗する）"
else
  ng "マージ呼び出しに sha パラメータが無い（検証後に push されたコミットがマージされうる）"
fi

if printf '%s' "$MERGE_CALL" | grep -qF -- '-f merge_method=squash'; then
  ok "マージ方式が squash に固定されている"
else
  ng "マージ方式が指定されていない"
fi

# ── (1-e) マージ直前の再確認（TOCTOU: ラベル・緊急停止）───────
if has "$WF" 'LABELS_NOW' && has "$WF" 'マージ直前に agent-review:passed が消えていた'; then
  ok "マージ直前にラベルを取り直している（合格取り消し・保留付与の直後に走らない）"
else
  ng "マージ直前のラベル再取得が無い"
fi

# ── (1-e2) 緊急停止は run 開始時評価に一本化（variables API 再取得の再導入禁止）───
# 経緯: GITHUB_TOKEN の permissions キーには variables 相当が存在せず、repo variables の
# REST 読み取りは workflow 内では設計上決して成功しない（2026-08-03 実測: actions: read を
# 付けても失敗）。旧実装①番兵方式はエラー JSON 混入で誤停止（run 30805787152）、
# 旧実装②fail-open フォールバックは失敗を隠して「直前中止が効いている」と誤認させ、
# 旧実装③fail-closed 化は全マージを恒久停止させた（run 30819256368）。
# どの形でも「動かない読み取り」を残す限り事故るため、再導入自体を assert で禁止する。
if grep -qF 'actions/variables' "$WF"; then
  ng "workflow が repo variables API を読んでいる（GITHUB_TOKEN では成功しない。緊急停止は run 開始時の vars 展開で評価する）"
else
  ok "workflow が repo variables API に依存していない（緊急停止は run 開始時の vars 展開に一本化）"
fi

if has "$WF" 'PAUSED_NOW'; then
  ng "マージ直前の PAUSED 再取得コードが残っている（動かない読み取りの残骸。再導入禁止）"
else
  ok "マージ直前の PAUSED 再取得コードが無い（設計どおり）"
fi

# actions: read は variables 再取得のためだけに付与されていた。再取得を撤去した今、
# 残す理由が無い（least privilege。check-runs は checks: read、コミット状態は statuses: read）
if awk '/^permissions:/{f=1;next} /^[^ #]/{f=0} f' "$WF" | grep -qE '^ *actions: read'; then
  ng "permissions に不要な actions: read が残っている（variables 再取得の撤去後は用途が無い）"
else
  ok "permissions に actions: read が無い（least privilege）"
fi

# 攻撃再現: 初回チェック通過後に base を別ブランチへ付け替える。
# SHA ピンは「何をマージするか」しか固定しないため、「どこへマージするか」＝ base は
# 直前に取り直さないと既定ブランチ以外へマージされうる（PAT は repo 全体 contents:write）。
extract_block "$WF" "pre-merge-recheck" > "$TMPD/recheck.txt"
if [ ! -s "$TMPD/recheck.txt" ]; then
  ng "マージ直前の再確認ブロックを抽出できない（# >>> pre-merge-recheck マーカーを確認）"
else
  if grep -qF 'BASE_REF_NOW' "$TMPD/recheck.txt" && grep -qF '"$BASE_REF_NOW" != "$BASE_BRANCH"' "$TMPD/recheck.txt"; then
    ok "マージ直前に base を取り直して既定ブランチと突き合わせている"
  else
    ng "マージ直前の base 再チェックが無い（初回通過後に base を付け替えると別ブランチへマージされうる）"
  fi

  if grep -qF 'DRAFT_NOW' "$TMPD/recheck.txt"; then
    ok "マージ直前に draft へ戻されていないか確認している"
  else
    ng "マージ直前の draft 再チェックが無い"
  fi

  if grep -qF 'MERGED_NOW' "$TMPD/recheck.txt"; then
    ok "マージ直前に既マージでないか確認している"
  else
    ng "マージ直前の merged 再チェックが無い"
  fi

  # 再確認がマージ呼び出しより前にあること（順序が逆なら意味が無い）
  RECHECK_END=$(grep -n '# <<< pre-merge-recheck' "$WF" | head -1 | cut -d: -f1)
  MERGE_LINE=$(grep -n 'gh api -X PUT "repos/\$REPO/pulls/\$N/merge"' "$WF" | head -1 | cut -d: -f1)
  if [ -n "$RECHECK_END" ] && [ -n "$MERGE_LINE" ] && [ "$RECHECK_END" -lt "$MERGE_LINE" ]; then
    ok "マージ直前の再確認がマージ呼び出しより前にある"
  else
    ng "再確認とマージ呼び出しの順序が不正（再確認が後ろにあると効かない）"
  fi
fi

# ── (2) 必須チェック名 == ci.yml のジョブ名（完全一致）────────
extract_block "$WF" "required-checks" \
  | grep -v '# >>>' | grep -v '# <<<' \
  | sed "s/^ *//; s/^REQUIRED_CHECKS='//; s/'\$//" \
  | grep -v '^$' | LC_ALL=C sort > "$TMPD/required.txt"

# ci.yml のジョブ名（ジョブ直下の name: はインデント4）。トップレベルの `name: CI` は拾わない。
grep -E '^    name: ' "$CI" | sed 's/^    name: //' | LC_ALL=C sort > "$TMPD/jobs.txt"

if [ ! -s "$TMPD/required.txt" ]; then
  ng "REQUIRED_CHECKS を auto-merge.yml から抽出できない（# >>> required-checks マーカーを確認）"
elif [ ! -s "$TMPD/jobs.txt" ]; then
  ng "ci.yml からジョブ名を抽出できない"
elif diff "$TMPD/required.txt" "$TMPD/jobs.txt" >/dev/null 2>&1; then
  ok "必須チェック名が ci.yml のジョブ名と完全一致する（$(tr '\n' '/' < "$TMPD/required.txt")）"
else
  ng "必須チェック名と ci.yml のジョブ名がズレている（auto-merge が永久に green と判定しない）"
  echo "      REQUIRED_CHECKS: $(tr '\n' '/' < "$TMPD/required.txt")"
  echo "      ci.yml jobs:     $(tr '\n' '/' < "$TMPD/jobs.txt")"
fi

# ── (3) 4条件と fail-closed ──────────────────────────────────
if has "$WF" 'agent-review:passed'; then
  ok "条件1: agent-review:passed を判定している"
else
  ng "条件1: agent-review:passed の判定が無い"
fi

if has "$WF" 'check-runs'; then
  ok "条件2: check-runs API で CI green を自前検証している"
else
  ng "条件2: CI green の判定が無い"
fi

if has "$WF" 'labels[]=human-merge'; then
  ok "条件3: 聖域接触 PR に human-merge を付与している"
else
  ng "条件3: 聖域接触時の human-merge 付与が無い"
fi

if has "$WF" 'AUTOMERGE_PAUSED' && extract_script "$WF" "automerge-script" | grep -q 'if \[ -n "\$AUTOMERGE_PAUSED" \]'; then
  ok "条件4: AUTOMERGE_PAUSED が空でなければ全停止する"
else
  ng "条件4: AUTOMERGE_PAUSED による緊急停止が無い"
fi

if extract_script "$WF" "automerge-script" | grep -q 'if \[ -z "\$MERGE_TOKEN" \]'; then
  ok "PAT 未設定時は何もマージしない（fail-closed）"
else
  ng "PAT 未設定時の fail-closed が無い"
fi

if has "$WF" 'secrets.AUTOMERGE_PAT' && grep -qF 'GH_TOKEN="$MERGE_TOKEN" gh api -X PUT' "$TMPD/am-code.txt"; then
  ok "マージだけ secrets.AUTOMERGE_PAT を使う（後続 workflow を発火させるため）"
else
  ng "マージに AUTOMERGE_PAT を使っていない"
fi

# マージを見送るラベル。コメントでの言及ではなく BLOCKING_LABELS の**実体**を見る
# （needs-approval はレビューゲートスキルの保留印。agent-review:passed と同時に付く
#  事故に対する防波堤なので、抜けたら合格ラベルだけで素通りしてしまう）
sed -n "/BLOCKING_LABELS='/,/'\$/p" "$WF" \
  | sed "s/^ *//; s/^BLOCKING_LABELS='//; s/'\$//" \
  | grep -v '^$' > "$TMPD/blocking.txt"

for L in human-merge needs-human-merge human-only needs-approval; do
  if grep -qxF -- "$L" "$TMPD/blocking.txt"; then
    ok "$L が BLOCKING_LABELS に含まれる（マージを見送る）"
  else
    ng "$L が BLOCKING_LABELS に無い（この印が付いた PR がマージされてしまう）"
  fi
done

# ── (4) revert workflow: revert PR を作るだけ・マージはしない ──
if has "$RV" 'workflow_dispatch'; then
  ok "revert: workflow_dispatch で手動起動できる"
else
  ng "revert: workflow_dispatch が無い"
fi

if has "$RV" 'git revert' && has "$RV" 'gh pr create'; then
  ok "revert: git revert して revert PR を作る"
else
  ng "revert: git revert / gh pr create が無い"
fi

if grep -qF 'gh pr merge' "$RV"; then
  ng "revert: マージしてはいけない（gh pr merge が含まれている）"
else
  ok "revert: マージはしない（gh pr merge を含まない）"
fi

if has "$RV" 'labels[]=human-merge'; then
  ok "revert: 生成 PR に human-merge を付けて auto-merge の対象外にする"
else
  ng "revert: 生成 PR が auto-merge の対象外になっていない"
fi

if has "$RV" '-m 1'; then
  ok "revert: merge commit（親2つ以上）に -m 1 を使い分けている"
else
  ng "revert: merge commit の revert に対応していない"
fi

# ── (5) 運用ドキュメント ─────────────────────────────────────
for token in \
  'AUTOMERGE_PAUSED' \
  'AUTOMERGE_PAT' \
  'dry_run' \
  'revert-pr.yml' \
  '.github/workflows/' \
  'CLAUDE.md' \
  '.claude/' \
  'docs/agent-loop*.md' \
  'REQUIRED_CHECKS'; do
  if has "$DOC" "$token"; then
    ok "docs/auto-merge.md が $token に言及している"
  else
    ng "docs/auto-merge.md に $token の記載が無い"
  fi
done

# ── (6) 埋め込みスクリプトの構文チェック ─────────────────────
if command -v bash >/dev/null 2>&1; then
  for pair in "$WF:automerge-script" "$RV:revert-script"; do
    f=${pair%:*}
    marker=${pair##*:}
    extract_script "$f" "$marker" > "$TMPD/embedded.sh"
    if [ ! -s "$TMPD/embedded.sh" ]; then
      ng "埋め込みスクリプトを抽出できない: $(basename "$f") ($marker)"
    elif bash -n "$TMPD/embedded.sh" 2>"$TMPD/err"; then
      ok "埋め込みスクリプトの構文が正しい: $(basename "$f")"
    else
      ng "埋め込みスクリプトの構文エラー: $(basename "$f") — $(head -3 "$TMPD/err")"
    fi
  done
else
  echo "SKIP  bash が無いため埋め込みスクリプトの構文チェックを省略"
fi

# actionlint があれば workflow 全体も検証する（無ければスキップ。CI の必須条件にはしない）
if command -v actionlint >/dev/null 2>&1; then
  if actionlint "$WF" "$RV" >"$TMPD/al" 2>&1; then
    ok "actionlint: 指摘なし"
  else
    ng "actionlint: 指摘あり — $(head -3 "$TMPD/al")"
  fi
else
  echo "SKIP  actionlint 未導入のため workflow 全体の検証を省略（brew install actionlint）"
fi

echo "----------------------------------------"
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
