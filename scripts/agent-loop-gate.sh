#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# agent-loop-gate.sh — dev-cycle の work-gate（決定論プリチェック）
#
# なぜ存在するか: dev-cycle は「やることなし」でも毎時 LLM ターンを起こし、
# 空振り1回あたり数万〜十数万トークン（cache write 中心）を消費していた
# （2026-07 実測: 開発住人4体で空振りが週約145ターン＝GO の約7割）。
# 仕事の有無は gh で決定論的に判定できるので、rate-guard フック（UserPromptSubmit）
# の work-gate 機構からこのスクリプトを呼び、LLM 起動前にゼロトークンで止める。
#
# 出力契約（rate-guard.py の work-gate 仕様）:
#   stdout 最終行に JSON 1 オブジェクト {"decision":"GO"|"SKIP","reason":"..."}
#   exit 非0・タイムアウト・JSON 以外の出力は rate-guard 側で GO 扱い（fail-open）。
#
# GO を返す条件（いずれか1つでも該当すれば LLM サイクルを起こす）:
#   1. 朝ダイジェスト未実施（AGENT_DIGEST_HOUR 時以降で .agent-loop/log.md の最終行が今日より前）
#   2. agent-loop-select.sh の mode が skip 以外（review / fix / implement / propose。
#      error も GO = fail-open で LLM 側の Step 0 に判断を戻す）
#   3. Review Queue ボードに人間のドラッグ操作が未同期の issue がある
#      （State=着手可能 なのに agent-ready 無し ＝承認未反映 / State=トリアージ なのに
#       agent-ready 付き ＝承認取り消し未反映）。次サイクルの Step 0.8 が同期する必要がある
#   それ以外 → SKIP（reason に select の理由を添える）
#
# 判定不能（gh/jq 不在・API エラー・設定行の解析不能など）はすべて GO に倒す
# （fail-open。gate の不調でループを黙らせない）。飢餓防止（最悪ケースの取りこぼし回収）
# は rate-guard 側の max_silence 機構が担う。
#
# 移植元: genetta-inc/flatmate scripts/agent-loop-gate.sh（2026-07-25 時点、issue #106）。
# 変更なし（`--label` フィルタを使っていないため select.sh のような偽陰性対策は不要）。
# ─────────────────────────────────────────────────────────────
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

command -v jq >/dev/null 2>&1 || { printf '{"decision":"GO","reason":"jq 未インストール (fail-open)"}\n'; exit 0; }

# -c（コンパクト）必須: rate-guard.py は stdout の「最終行だけ」を json.loads する。
# jq の既定はプリティ出力（複数行）で、最終行が "}" だけになりパースが必ず失敗し、
# fail-open で常時 GO に倒れる（＝ work-gate が無効化される）。単一行で出すこと。
go()   { jq -nc --arg r "$1" '{decision:"GO",reason:$r}'; exit 0; }
skip() { jq -nc --arg r "$1" '{decision:"SKIP",reason:$r}'; exit 0; }

command -v gh >/dev/null 2>&1 || go "gh 未インストール (fail-open)"

# --- 1. 朝ダイジェスト（憲法 Step 0.5）が今日まだなら GO ---
DIGEST_HOUR="${AGENT_DIGEST_HOUR:-7}"
HOUR="$(date +%H)"
TODAY="$(date +%Y-%m-%d)"
if [ "$((10#$HOUR))" -ge "$((10#$DIGEST_HOUR))" ] 2>/dev/null; then
  last_date="$(tail -1 .agent-loop/log.md 2>/dev/null | grep -oE '2[0-9]{3}-[0-9]{2}-[0-9]{2}' | head -1 || true)"
  if [ -z "$last_date" ] || [ "$last_date" \< "$TODAY" ]; then
    go "朝ダイジェスト未実施（log.md 最終行: ${last_date:-なし}）"
  fi
fi

# --- 2. モード選定（決定論セレクタ）。skip 以外なら GO ---
SELECT_OUT="$("$SCRIPT_DIR/agent-loop-select.sh" 2>/dev/null)" || go "select 実行失敗 (fail-open)"
MODE="$(printf '%s' "$SELECT_OUT" | jq -r '.mode // empty' 2>/dev/null || true)"
[ -z "$MODE" ] && go "select 出力を解析できない (fail-open)"
if [ "$MODE" != "skip" ]; then
  TARGET="$(printf '%s' "$SELECT_OUT" | jq -r '.target // empty' 2>/dev/null || true)"
  go "select: mode=$MODE${TARGET:+ target=$TARGET}"
fi
SELECT_REASON="$(printf '%s' "$SELECT_OUT" | jq -r '.reason // "仕事なし"' 2>/dev/null || printf '仕事なし')"

# --- 3. Review Queue ボードの未同期操作（憲法 Step 0.8 の要否）---
# docs/agent-loop.md の設定表から「Review Queue Project」（<owner>/<番号>）を読む。
# 未設定・「なし」・解析不能ならこのチェックはスキップ（select の結果だけで判定）。
RQ="$(grep -E '\|[[:space:]]*Review Queue Project[[:space:]]*\|' docs/agent-loop.md 2>/dev/null \
      | head -1 | awk -F'|' '{print $3}' | tr -d ' `' || true)"
if [ -n "$RQ" ] && [ "$RQ" != "なし" ] && printf '%s' "$RQ" | grep -qE '^[^/]+/[0-9]+$'; then
  RQ_OWNER="${RQ%%/*}"
  RQ_NUM="${RQ##*/}"
  THIS_REPO="$(gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null || true)"
  ITEMS="$(gh project item-list "$RQ_NUM" --owner "$RQ_OWNER" --format json --limit 200 2>/dev/null || true)"
  if [ -n "$THIS_REPO" ] && [ -n "$ITEMS" ]; then
    # State=着手可能 の issue（このリポジトリ分）。フィールド名の揺れは fail-open 側
    # （一致しない＝未検出→ SKIP に進む。最悪でも rate-guard の max_silence が回収する）。
    while IFS= read -r n; do
      [ -n "$n" ] || continue
      has_ready="$(gh issue view "$n" --json labels --jq '[.labels[].name]|index("agent-ready")' 2>/dev/null || printf 'null')"
      if [ "$has_ready" = "null" ]; then
        go "ボード承認が未同期: issue #$n が State=着手可能 だが agent-ready 無し（Step 0.8 が必要）"
      fi
    done <<EOF
$(printf '%s' "$ITEMS" | jq -r --arg repo "$THIS_REPO" \
  '.items[]? | select((.content.type // "")=="Issue" and (.content.repository // "")==$repo)
             | select(((.state // .State) // "")=="着手可能") | .content.number' 2>/dev/null || true)
EOF
    # 逆方向: State=トリアージ なのに agent-ready 付き（承認取り消しの未同期）
    while IFS= read -r n; do
      [ -n "$n" ] || continue
      has_ready="$(gh issue view "$n" --json labels --jq '[.labels[].name]|index("agent-ready")' 2>/dev/null || printf 'null')"
      if [ "$has_ready" != "null" ]; then
        go "ボード承認取り消しが未同期: issue #$n が State=トリアージ だが agent-ready 付き（Step 0.8 が必要）"
      fi
    done <<EOF
$(printf '%s' "$ITEMS" | jq -r --arg repo "$THIS_REPO" \
  '.items[]? | select((.content.type // "")=="Issue" and (.content.repository // "")==$repo)
             | select(((.state // .State) // "")=="トリアージ") | .content.number' 2>/dev/null || true)
EOF
  fi
fi

skip "select: ${SELECT_REASON}（work-gate 判定・LLM 未起動）"
