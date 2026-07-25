#!/usr/bin/env bash
# agent-loop-gate.test.sh — agent-loop-gate.sh / agent-loop-select.sh のシナリオテスト。
#
# なぜ必要か: gate.sh / select.sh は `gh` の live 出力に依存するため、通常の実行では
# その時点のリポジトリ状態（pending PR の有無・agent-ready issue の有無など）でしか
# 検証できない。特に「やることが無い状態で decision:"SKIP" を返す」（issue #106 の
# 受け入れ条件）は、実リポジトリが常に空とは限らないため、フェイクの `gh` を PATH に
# 差し込んでシナリオを固定した上で決定論的に検証する。
#
# 実行方法: bash scripts/agent-loop-gate.test.sh
# 前提: リポジトリルートで実行する（gate.sh が docs/agent-loop.md を相対参照するため）。
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT" || exit 1

FAILURES=0
PASSES=0

assert_eq() {
  local desc="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    printf 'PASS: %s\n' "$desc"
    PASSES=$((PASSES + 1))
  else
    printf 'FAIL: %s (expected=%q actual=%q)\n' "$desc" "$expected" "$actual"
    FAILURES=$((FAILURES + 1))
  fi
}

# --- フェイク gh を用意する ---
# シナリオは環境変数 GH_FAKE_SCENARIO で切り替える。
MOCK_DIR="$(mktemp -d)"
trap 'rm -rf "$MOCK_DIR"' EXIT

cat > "$MOCK_DIR/gh" <<'MOCKGH'
#!/usr/bin/env bash
# シナリオ別の固定応答を返すフェイク gh。実 gh は一切呼ばない。
set -uo pipefail
SCEN="${GH_FAKE_SCENARIO:-empty}"

# --- repo view ---
if [ "$1" = "repo" ] && [ "$2" = "view" ]; then
  echo "genetta-inc/shukan"
  exit 0
fi

# --- pr list ---
if [ "$1" = "pr" ] && [ "$2" = "list" ]; then
  # --search "<n> in:body" 呼び出し（実装可能 issue の PR 紐付け確認）
  for a in "$@"; do
    if [ "$a" = "--search" ]; then
      echo "[]"
      exit 0
    fi
  done
  case "$SCEN" in
    empty|propose-limit)
      echo "[]"
      ;;
    has-pending)
      echo '[{"number":201,"createdAt":"2026-01-01T00:00:00Z","labels":[{"name":"agent-review:pending"}]}]'
      ;;
    has-failed)
      echo '[{"number":202,"createdAt":"2026-01-01T00:00:00Z","labels":[{"name":"agent-review:failed"}]}]'
      ;;
    has-implement)
      echo "[]"
      ;;
  esac
  exit 0
fi

# --- pr view (mergeable) ---
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
  echo "CLEAN"
  exit 0
fi

# --- issue list ---
if [ "$1" = "issue" ] && [ "$2" = "list" ]; then
  case "$SCEN" in
    empty|has-pending|has-failed)
      echo "[]"
      ;;
    propose-limit)
      echo '[{"number":301,"labels":[{"name":"agent-proposed"}]},{"number":302,"labels":[{"name":"agent-proposed"}]},{"number":303,"labels":[{"name":"agent-proposed"}]}]'
      ;;
    has-implement)
      echo '[{"number":401,"labels":[{"name":"agent-ready"}]}]'
      ;;
  esac
  exit 0
fi

# --- api (dependencies/blocked_by 等) ---
if [ "$1" = "api" ]; then
  for a in "$@"; do
    case "$a" in
      *blocked_by*)
        # 実 gh は --jq 'length' 済みの数値を返す。ブロッカー無し = 0。
        echo "0"
        exit 0
        ;;
    esac
  done
  echo "[]"
  exit 0
fi

# --- project item-list ---
if [ "$1" = "project" ] && [ "$2" = "item-list" ]; then
  echo '{"items":[]}'
  exit 0
fi

echo "MOCK gh: unhandled args: $*" >&2
echo "[]"
exit 0
MOCKGH
chmod +x "$MOCK_DIR/gh"

run_gate() {
  local scenario="$1"
  GH_FAKE_SCENARIO="$scenario" AGENT_DIGEST_HOUR=99 PATH="$MOCK_DIR:$PATH" \
    bash scripts/agent-loop-gate.sh 2>/dev/null | tail -1
}

run_select() {
  local scenario="$1"
  GH_FAKE_SCENARIO="$scenario" PATH="$MOCK_DIR:$PATH" \
    bash scripts/agent-loop-select.sh 2>/dev/null
}

echo "=== select.sh シナリオ検証 ==="

out=$(run_select empty)
mode=$(printf '%s' "$out" | jq -r '.mode')
assert_eq "select: 何もない → mode=propose" "propose" "$mode"

out=$(run_select propose-limit)
mode=$(printf '%s' "$out" | jq -r '.mode')
assert_eq "select: 提案上限到達 → mode=skip" "skip" "$mode"

out=$(run_select has-pending)
mode=$(printf '%s' "$out" | jq -r '.mode')
target=$(printf '%s' "$out" | jq -r '.target')
assert_eq "select: pending PR あり → mode=review" "review" "$mode"
assert_eq "select: pending PR あり → target=201" "201" "$target"

out=$(run_select has-failed)
mode=$(printf '%s' "$out" | jq -r '.mode')
target=$(printf '%s' "$out" | jq -r '.target')
assert_eq "select: failed PR あり → mode=fix" "fix" "$mode"
assert_eq "select: failed PR あり → target=202" "202" "$target"

out=$(run_select has-implement)
mode=$(printf '%s' "$out" | jq -r '.mode')
target=$(printf '%s' "$out" | jq -r '.target')
assert_eq "select: agent-ready issue あり → mode=implement" "implement" "$mode"
assert_eq "select: agent-ready issue あり → target=401" "401" "$target"

echo ""
echo "=== gate.sh シナリオ検証（受け入れ条件本体） ==="

out=$(run_gate propose-limit)
decision=$(printf '%s' "$out" | jq -r '.decision')
assert_eq "gate: やることなし（提案上限到達） → decision=SKIP" "SKIP" "$decision"
assert_eq "gate: 出力はJSON最終行1行" "$out" "$(printf '%s' "$out" | jq -c .)"

out=$(run_gate has-pending)
decision=$(printf '%s' "$out" | jq -r '.decision')
assert_eq "gate: pending PR あり → decision=GO" "GO" "$decision"

out=$(run_gate has-failed)
decision=$(printf '%s' "$out" | jq -r '.decision')
assert_eq "gate: failed PR あり → decision=GO" "GO" "$decision"

out=$(run_gate has-implement)
decision=$(printf '%s' "$out" | jq -r '.decision')
assert_eq "gate: agent-ready issue あり → decision=GO" "GO" "$decision"

echo ""
echo "=== 実 gh を使った疎通確認（fail-open系） ==="
# gh 未インストール相当（PATH から隠す）でも exit 0 かつ GO を返すことを確認する。
EMPTY_PATH_DIR="$(mktemp -d)"
out=$(PATH="$EMPTY_PATH_DIR:/usr/bin:/bin" bash scripts/agent-loop-gate.sh 2>/dev/null | tail -1)
rc=$?
decision=$(printf '%s' "$out" | jq -r '.decision' 2>/dev/null || echo "")
assert_eq "gate: gh 不在でも exit 0" "0" "$rc"
assert_eq "gate: gh 不在は fail-open で GO" "GO" "$decision"
rm -rf "$EMPTY_PATH_DIR"

echo ""
echo "=== 結果: PASS=$PASSES FAIL=$FAILURES ==="
[ "$FAILURES" -eq 0 ]
