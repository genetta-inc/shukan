#!/usr/bin/env bash
# select-target.sh — 自律開発ループ Step 1〜4 の「モード選定」を決定論的に行う。
#
# なぜ存在するか: モード選定（どのモードで・どの issue/PR 番号を対象にするか）は
# 完全に決定論的なのに、LLM が gh 出力を目視して選ぶと存在しない番号を「対象」に
# 捏造する事故が起きうる（実例: 2026-07-07 に存在しない issue #20 を対象化）。
# レートガード（憲法 Step 0）を jq でスクリプト化したのと同じ理由で、選定も
# ここに閉じ込め、LLM は本スクリプトの出力する target/mode に従うだけにする。
#
# 出力: stdout に JSON 1 オブジェクト。診断は stderr。gh/jq 失敗時は mode:"error"。
# 契約: LLM は candidates に無い番号を絶対に対象にしてはならない。
#
# 環境変数: AGENT_PROPOSE_LIMIT — 提案ストック上限（未設定時 3）
#
# 移植元: genetta-inc/flatmate scripts/agent-loop-select.sh（2026-07-25 時点、issue #106）。
# このリポジトリでの変更点: `gh pr list --label` フィルタは、org transfer 後の
# genetta-inc/shukan で「付いているラベルを空配列で返す」偽陰性が複数回実測されている
# （.agent-loop/GUARDRAILS.md 2026-07-25 参照）ため、`--label` を使わず全件取得 +
# jq でのローカルフィルタに置き換えている。
set -uo pipefail

PROPOSE_LIMIT="${AGENT_PROPOSE_LIMIT:-3}"

emit() { printf '%s\n' "$1"; exit 0; }
fail() { jq -n --arg m "$1" '{mode:"error",target:null,target_kind:null,reason:$m,candidates:[]}'; exit 0; }

command -v gh >/dev/null 2>&1 || fail "gh 未インストール"
command -v jq >/dev/null 2>&1 || fail "jq 未インストール"

# --- Step 0.7 相当: 最初の gh 呼び出し前に主 clone を origin/main へ最新化する（issue #72） ---
# 毎サイクル必ず走るこの決定論スクリプトに同期を組み込むことで、全開発住人が共有する同一 clone を
# 機械的に最新化し、stale な origin/main を起点に worktree が生える 18 コミット遅れ事故を構造的に断つ。
# repo-sync.sh は fail-open（fetch/pull 失敗・dirty でも exit 0・作業破棄なし）なのでループを止めない。
# このリポジトリには repo-sync.sh が未導入（issue #106 のスコープ外）のため、存在しなければ
# 単に "No such file or directory" で失敗し `|| true` に吸収されて次へ進む。
"$(dirname "$0")/repo-sync.sh" || true

# --- Step 1: agent-review:pending の最古 PR → レビューモード ---
# `--label` フィルタは使わず全件取得してから jq でラベル名を照合する（偽陰性対策）。
pending_all=$(gh pr list --state open --json number,createdAt,labels 2>/dev/null) \
  || fail "gh pr list (pending) 失敗"
n=$(printf '%s' "$pending_all" | jq -r '
  [.[] | select([.labels[].name] | index("agent-review:pending"))]
  | sort_by(.createdAt) | (.[0].number // empty)')
if [ -n "$n" ]; then
  emit "$(jq -n --argjson t "$n" '{mode:"review",target:$t,target_kind:"pr",reason:"agent-review:pending の最古 PR",candidates:[$t]}')"
fi

# --- Step 1.6: agent-review:passed かつ CONFLICTING な PR → コンフリクト解消モード ---
# なぜここか: passed（レビュー通過済み）でも origin/main が進むと mergeable=CONFLICTING
# になり、人間もループも拾えず滞留する（実例 #45/#44 が数日滞留）。skip/propose（やる
# ことなし）はもちろん、fix/implement より前に 1 サイクル 1 本ずつ機械的マージで解消する。
# 憲法の Step 1.6（< Step 2）に対応。既に実装/レビューを回している pending だけが上位。
passed_all=$(gh pr list --state open --json number,createdAt,labels 2>/dev/null) \
  || fail "gh pr list (passed) 失敗"
passed=$(printf '%s' "$passed_all" | jq '[.[] | select([.labels[].name] | index("agent-review:passed"))]')
# createdAt 昇順（＝最古が先頭）で番号を並べる。以降この順を維持する。
# needs-human-merge が付いた PR は意味的競合で機械解消できず人間へ委譲済みなので候補から除外する。
# 除外しないと、解決不能な最古 PR が毎サイクル target に選ばれ続け（無限再選定）、後続の
# 機械的に解消可能な CONFLICTING PR に永久に到達しない（先頭ブロッキング）。
passed_nums=$(printf '%s' "$passed" | jq -r '[.[] | select([(.labels // [])[].name] | contains(["needs-human-merge"]) | not)] | sort_by(.createdAt) | .[].number')
conflict_cands=""
for pnum in $passed_nums; do
  # gh の mergeable は遅延評価。算出前は "UNKNOWN" を返すことがあるので、その PR は
  # 今サイクルでは判定保留（次サイクルに回す）。CONFLICTING と確定したものだけ拾い、
  # 誤って CLEAN/UNKNOWN を解消対象にしない。
  mstate=$(gh pr view "$pnum" --json mergeable --jq '.mergeable' 2>/dev/null || printf 'UNKNOWN')
  [ "$mstate" = "CONFLICTING" ] && conflict_cands="$conflict_cands $pnum"
done
conflict_cands="${conflict_cands# }"
if [ -n "$conflict_cands" ]; then
  cc_json=$(printf '%s\n' $conflict_cands | jq -R 'tonumber' | jq -s '.')
  first=$(printf '%s\n' $conflict_cands | head -n1)
  emit "$(jq -n --argjson t "$first" --argjson c "$cc_json" '{mode:"resolve-conflict",target:$t,target_kind:"pr",reason:"agent-review:passed かつ mergeable=CONFLICTING の最古 PR（origin/main 先行で滞留）。git merge origin/main で機械的に解消。意味的競合なら abort して needs-human-merge に委ねる",candidates:$c}')"
fi

# --- Step 2: agent-review:failed の最古 PR → 修正モード ---
failed_all=$(gh pr list --state open --json number,createdAt,labels 2>/dev/null) \
  || fail "gh pr list (failed) 失敗"
n=$(printf '%s' "$failed_all" | jq -r '
  [.[] | select([.labels[].name] | index("agent-review:failed"))]
  | sort_by(.createdAt) | (.[0].number // empty)')
if [ -n "$n" ]; then
  emit "$(jq -n --argjson t "$n" '{mode:"fix",target:$t,target_kind:"pr",reason:"agent-review:failed の最古 PR",candidates:[$t]}')"
fi

# --- Step 3: 実装可能な issue → 実装モード ---
# 適格 = open ∧ agent-ready ∧ ¬(agent-wip|agent-blocked|size:large)
issues=$(gh issue list --state open --limit 100 --json number,labels 2>/dev/null) \
  || fail "gh issue list 失敗"
label_eligible=$(printf '%s' "$issues" | jq -r '
  [ .[] | . as $i | ([$i.labels[].name]) as $l
    | select($l|index("agent-ready"))
    | select(($l|index("agent-wip"))|not)
    | select(($l|index("agent-blocked"))|not)
    | select(($l|index("size:large"))|not)
    | $i.number ] | sort | .[]')

cands=""
for num in $label_eligible; do
  # open な PR が既に紐づく issue は除外
  linked=$(gh pr list --state open --search "$num in:body" --json number 2>/dev/null | jq 'length' 2>/dev/null || printf '0')
  [ "${linked:-0}" != "0" ] && continue
  # open issue に blocked_by されているものは除外（API 非対応/失敗時は 0=非ブロック扱いで続行）
  blk=$(gh api "repos/{owner}/{repo}/issues/$num/dependencies/blocked_by" \
        --jq '[.[] | select(.state=="open")] | length' 2>/dev/null || printf '0')
  [ "${blk:-0}" != "0" ] && continue
  cands="$cands $num"
done

cands="${cands# }"
if [ -n "$cands" ]; then
  cand_json=$(printf '%s\n' $cands | jq -R 'tonumber' | jq -s 'sort')
  emit "$(jq -n --argjson c "$cand_json" '{mode:"implement",target:($c[0]),target_kind:"issue",reason:"実装可能 issue の最小番号（受け入れ条件の測定可能性は LLM が最終確認し、不適なら candidates 内の次番号へ）",candidates:$c}')"
fi

# --- Step 4: 上記に該当なし → 提案モード or skip ---
proposed=$(printf '%s' "$issues" | jq -r '[.[] | select([.labels[].name]|index("agent-proposed"))] | length')
if [ "${proposed:-0}" -ge "$PROPOSE_LIMIT" ]; then
  emit "$(jq -n --argjson c "$proposed" --argjson lim "$PROPOSE_LIMIT" '{mode:"skip",target:null,target_kind:null,reason:"未トリアージ提案が \($c) 件（上限 \($lim)）。新規起票せず報告のみ",candidates:[]}')"
else
  emit "$(jq -n --argjson c "$proposed" '{mode:"propose",target:null,target_kind:null,reason:"該当モードなし。提案枠に空き（現 \($c) 件）",candidates:[]}')"
fi
