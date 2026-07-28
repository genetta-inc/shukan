# 自律開発ループ憲法（agent-loop）

> このファイルは自律開発ループの「1サイクルの手順書」であり、ループの実行系ではない。
> 反復は `/loop`（ネイティブプリミティブ）が担い、本ファイルは毎サイクル読み直される前提で書かれている。
> 生成元: `plugins/loops/templates/agent-loop-template.md`（`/loops:dev-agent-install` が値を埋めて配置する）。
> レシピ本体: `plugins/loops/recipes/loop-dev-agent.md`。

## プロジェクト設定

| 項目 | 値 |
|---|---|
| main ブランチ | main |
| テストコマンド | `npm run test:run` |
| lint コマンド | `npm run lint` |
| ビルドコマンド | `npm run build` |
| dev サーバー起動 | `npm run dev`（URL: http://localhost:3000） |
| ブラウザ実機検証 | あり |
| worktree 置き場 | `~/orca/workspaces/Shukan_ver.1.0` |
| 朝ダイジェスト | 環境変数 `AGENT_DIGEST_HOUR`（デフォルト 7）時以降のその日最初のサイクル |
| 提案ストック上限 | 3 件 |
| Review Queue Project | oratta/6（`<owner>/<番号>` 形式。`なし` なら連携をスキップ） |

## 大原則（全モード共通・違反禁止）

1. **1サイクル1仕事**。複数の issue / PR を1サイクルで扱わない。
2. **main へのマージ・直接 push・コミットは絶対にしない**（push は permission deny ルールと pre-push フックで封鎖済み。マージは人間の仕事）。ループが main チェックアウトで行ってよいのは `.agent-loop/` 配下（git 管理外）への追記だけ。ループが main を動かすと origin と恒常的に分岐し、人間のマージ作業が再生産されるため。
3. **完了・合格の宣言には必ず証拠を付ける**。実行したコマンドと exit code・出力の要約をターン内に表示してから宣言する。自己申告のみの「完了」は禁止。
4. サイクル冒頭で `.agent-loop/GUARDRAILS.md` が存在すれば読む。サイクル中に得た教訓（踏んだ地雷・回避策）があれば1行追記し、**同じ内容を GUARDRAILS バックアップ issue（タイトル「GUARDRAILS: ループの教訓集」）にもコメントする**（ローカルファイルは git 管理外のため、耐久コピーは GitHub 側に置く）。
5. サイクル終了時に `.agent-loop/log.md` に実行ログを1行追記する（形式は末尾）。コミットはしない。サイクル結果の正式な記録は issue / PR へのコメントであり、ローカルのログは朝ダイジェスト集計用のキャッシュにすぎない。
6. 実装前に必ず codebase を grep して既存実装を確認する。「未実装」と決めつけて二重実装しない。
7. プレースホルダ・空実装・コンパイルを通すだけの実装で済ませない。

## コンテキスト管理（ディスパッチャ方式）

ループセッション（メイン）のコンテキストはサイクルを跨いで蓄積するため、メインは**配車係に徹する**。

1. メインが自分で行うのは: レートガード（Step 0）、朝ダイジェスト（Step 0.5）、モード判定と対象選定（gh クエリ）、サブエージェントへの委譲、ログ追記、結果報告のみ。
2. 各モードの作業本体（Step 1 のレビュー、Step 2 の修正、Step 3 の実装、Step 4 の調査・起票文案）は**サブエージェントに委譲**し、毎回まっさらなコンテキストで実行させる。メイン自身でファイルを読み込んで作業しない。
3. サブエージェントへ渡すもの: 本憲法ファイルのパス（該当 Step を読んで従うよう指示）、対象の issue / PR 番号、`.agent-loop/GUARDRAILS.md` のパス。
4. サブエージェントから受け取るもの: 結果サマリ（実行したコマンドと exit code の証拠、作成した PR / コメントの URL を含む）。メインはそれをログと報告に転記する。
5. 作業中の詳細（ファイル内容・テスト出力・試行錯誤）はサブエージェント側に閉じ、サイクル終了とともに破棄される。長期稼働でメインのコンテキストが自動要約されても、状態はすべて外部（ラベル・issue / PR コメント・`.agent-loop/`）にあるため失われて困る記憶はない。

## ラベル定義

| ラベル | 対象 | 意味 |
|---|---|---|
| `agent-ready` | issue | 人間が承認済み。ループが拾ってよい |
| `agent-proposed` | issue | ループの自己生成タスク案。人間が `agent-ready` に昇格するまで実行禁止 |
| `agent-wip` | issue | ループが着手中（二重着手防止） |
| `agent-blocked` | issue | 2回失敗して隔離。人間の判断待ち |
| `needs-approval` | issue | 準備までは可、実行に人間の承認が必要 |
| `human-only` | issue | ループは触らない（秘密情報・外部アカウント・設計判断など） |
| `size:large` | issue | 1サイクルに収まらない大型。着手せず分割提案のみ |
| `agent-review:pending` | PR | 実装済み・レビューエージェント待ち |
| `agent-review:passed` | PR | レビュー合格。人間はマージ判断のみでよい |
| `agent-review:failed` | PR | レビュー不合格。修正モードの対象 |

## Review Queue 連携（プロジェクト横断レビューボード）

Review Queue Project が `なし` 以外なら、**人間の対応を待っているもの**（PR と issue の両方）をユーザーレベルの
GitHub Project に反映する。人間はこのボード1枚で全リポジトリの「マージ判断待ち PR」「トリアージ待ち issue」
「隔離された issue」を横断で捌く。操作はすべて決定論的な `gh` コマンドで行う。

`State`（単一選択フィールド）はラベルと1対1で対応させる。**ラベルを付け替えたら、同じ手順内で必ず State も揃える**:

| 対象 | ラベル | State | 人間の対応 |
|---|---|---|---|
| PR | `agent-review:pending` | レビュー中 | 不要（ループが処理中） |
| PR | `agent-review:failed` | 修正中 | 不要（ループが処理中） |
| PR | `agent-review:passed` | マージ判断 | **マージするか判断** |
| issue | `agent-proposed` / `needs-approval` | トリアージ | **実行を承認するか判断** |
| issue | `agent-ready`（未着手） | 着手可能 | 不要（ループの実行待ち） |
| issue | `agent-blocked` | 要介入 | **2回失敗の原因を判断** |

**ボード上のドラッグが承認操作になる**: 人間が issue カードを トリアージ → 着手可能 へ動かすと、
次サイクル冒頭の Step 0.8 がラベルを `agent-ready` に同期する。**issue の item は State（ボード）が正、
PR の item はラベルが正**（PR の State はループだけが動かす）。

`Blocked count`（数値フィールド）= その item が塞いでいる後続タスク数。人間が「どれから捌くか」を決める
ソートキーになる（ボードは Blocked count 降順）。算出は **GitHub ネイティブの issue dependencies** を正とする:

```bash
# PR の場合: 対象 issue（Closes #<N> の N）が blocking している open issue 数
# issue の場合: その issue 自身が blocking している open issue 数
BLOCKED=$(gh api repos/<owner>/<repo>/issues/<N>/dependencies/blocking \
  --jq '[.[] | select(.state == "open")] | length')
```

dependencies API がエラーの場合のフォールバック: `#<N>` を本文参照している open な `agent-ready` issue 数
（`gh issue list --state open --label agent-ready --json number,body --jq '[.[] | select(.body | test("#<N>([^0-9]|$)"))] | length'`）。

登録・更新の手順（`<owner>/<番号>` はプロジェクト設定の Review Queue Project の値）:

```bash
PROJECT_ID=$(gh project view <番号> --owner <owner> --format json --jq .id)
# 登録（登録済み URL に対しては既存 item が返るため冪等）
ITEM_ID=$(gh project item-add <番号> --owner <owner> --url <PR/issueのURL> --format json --jq .id)
# field id / option id を取得してから書き込む
gh project field-list <番号> --owner <owner> --format json
gh project item-edit --project-id $PROJECT_ID --id $ITEM_ID \
  --field-id <State_の_field_id> --single-select-option-id <対応する_option_id>
gh project item-edit --project-id $PROJECT_ID --id $ITEM_ID \
  --field-id <Blocked_count_の_field_id> --number $BLOCKED
```

- **item の削除**: 人間の対応が済んで待ちが解消した issue（トリアージ済みで `agent-ready` に昇格した、
  または `agent-blocked` が解除された）は、ループが着手する時点（Step 3 の着手宣言時）に
  `gh project item-delete <番号> --owner <owner> --id $ITEM_ID` でボードから外す。
- **連携の失敗でサイクルを止めない**: `gh project` / dependencies 系コマンドがエラーになっても警告として
  報告するだけにとどめ、本来の仕事（実装・レビュー・修正）は完了させる。
- マージ・クローズされた PR / issue の後片付けは Project 側の built-in workflow（auto-archive）に任せる。

## 状態機械

Step 0 と 0.5 は毎サイクル評価する。Step 1〜4 は**上から順に評価し、最初に該当した1つのモードだけ**を実行する。

### Step 0: レートガード（ペース基準の動的閾値）

**標準（flatmate 常駐運転）**: 配線側の rate-guard hook（UserPromptSubmit）が [tick] プロンプトを発火前に判定するため、このステップはスキップされる前提。

**フォールバック（単独 /loop 運転時のみ）**: 以下の判定を実行する。閾値は環境変数 `RATE_5H_MAX` / `RATE_5H_HEADROOM` / `RATE_7D_MAX` / `RATE_7D_HEADROOM`（デフォルト 70/20/85/10）で与える。

固定閾値ではなく**枠の経過率に連動した動的閾値**で判定する。同じ使用率でも、枠の序盤なら「行き過ぎ」としてスキップし、終盤ならハードキャップまで許容する。

- 判定式: `動的閾値 = min(ハードキャップ, 枠の経過率% + ヘッドルーム)`
  - 枠の経過率 = `(枠の長さ − (resets_at − 現在時刻)) ÷ 枠の長さ × 100`（0〜100 にクランプ。枠の長さ: 5時間枠 = 18000 秒、7日枠 = 604800 秒）
  - 消費ペースが時間経過ペースをヘッドルーム分を超えて上回っていたらスキップ。枠の開始直後はヘッドルームがそのまま下限の閾値になる
  - `resets_at` が無い（null）枠はハードキャップのみで判定する（従来動作へのフォールバック）

1. 以下のコマンドで判定する（決定論的作業のスクリプト化。LLM が暗算しない）:

   ```bash
   jq -r --argjson now "$(date +%s)" \
      --argjson cap5 "${RATE_5H_MAX:-70}"  --argjson head5 "${RATE_5H_HEADROOM:-20}" \
      --argjson cap7 "${RATE_7D_MAX:-85}"  --argjson head7 "${RATE_7D_HEADROOM:-10}" '
     def clamp: if . < 0 then 0 elif . > 100 then 100 else . end;
     def th(resets; win; cap; head):
       if resets == null then cap
       else [cap, ((100 * (win - (resets - $now)) / win) | clamp) + head] | min end;
     . as $s
     | th($s.five_hour_resets_at; 18000; $cap5; $head5) as $t5
     | th($s.seven_day_resets_at; 604800; $cap7; $head7) as $t7
     | "\(if ($s.five_hour_pct > $t5) or ($s.seven_day_pct > $t7) then "SKIP" else "GO" end) 5h=\($s.five_hour_pct)%(閾値\($t5|floor)%) 7d=\($s.seven_day_pct)%(閾値\($t7|floor)%) ts=\($s.ts)"
   ' "$HOME/.claude/.rate-limit-snapshot"
   ```

2. 出力が `SKIP` なら、このサイクルは**何もせずスキップ**し、出力（現在値と動的閾値）と復帰見込み（`*_resets_at`）を報告して終了する。
3. `ts` が現在時刻より2時間以上古い場合は「スナップショットが古い」と明記した上で続行してよい。
4. ファイルが存在しない・jq が失敗する場合はガードなしで続行し、その旨を報告に含める。

### Step 0.5: 朝ダイジェスト（報告のみ・手は止めない）

環境変数 `AGENT_DIGEST_HOUR`（デフォルト 7）時以降のその日最初のサイクルなら、通常のモード実行の**前に**以下を報告する:

- マージ待ち PR（`agent-review:passed`）の件数と最古の経過日数
- トリアージ待ち提案（`agent-proposed`）の件数
- 隔離中 issue（`agent-blocked`）の件数
- 直近1週間のレビュー検出率（レビューした PR のうち failed になった割合。`.agent-loop/log.md` から集計）

「その日最初」の判定は `.agent-loop/log.md` の最終行の日付が今日より前かどうかで行う。

### Step 0.8: Review Queue ボード同期（連携時のみ・毎サイクル）

Project にはフィールド変更のリアルタイム通知が無いため、人間のドラッグ操作を毎サイクル冒頭でラベルへ反映する。

1. `gh project item-list <番号> --owner <owner> --format json` から**このリポジトリの issue item** を抽出する。
2. State とラベルの食い違いを **State に合わせて**解消する:
   - State=着手可能 なのに `agent-proposed` / `needs-approval` / `agent-blocked` が付いている →
     それらを外して `agent-ready` を付け、issue に「Review Queue ボードから承認」とコメントする。
   - State=トリアージ なのに `agent-ready` が付いている → `agent-ready` を外して `agent-proposed` を付ける（承認の取り消し）。
3. 逆方向の反映: このリポジトリの open な `agent-ready` issue（`agent-wip` 無し）でボード未登録のものを
   State=着手可能 で登録する（着手可能列 = 実行待ちキューの一覧を常に完全に保つ）。
4. 同期の失敗はサイクルを止めない（警告のみ報告して次の Step へ進む）。

### Step 1: レビューモード — `agent-review:pending` の PR がある

`gh pr list --label "agent-review:pending" --state open` で最も古い1件を選ぶ。

1. PR ブランチを `~/orca/workspaces/Shukan_ver.1.0` 配下の worktree に checkout する。
2. **main 追従**: `git fetch origin` → `origin/main` をブランチにマージする（rebase + force-push は禁止）。
   - コンフリクトが軽微（機械的に解消可能）なら解消して続行し、解消内容を PR コメントに記録する。
   - 解消に実装判断が必要な規模なら `agent-review:failed` に付け替え、理由を PR コメントに書いて終了。
3. 最新化した状態で `npm run test:run` / `npm run lint` / `npm run build` を**独立に再実行**する（実装エージェントの報告を信用しない）。
4. ブラウザ実機検証が「あり」の場合: `npm run dev` で dev サーバーを起動し、元 issue の**受け入れ条件をブラウザ上で再現**する。実装者が想定していない操作経路・エッジケースを最低1つ試す。
5. ソースコードレビュー: 受け入れ条件を根拠に「落とせる欠陥を探す」姿勢で diff を読む（正しさ・エッジケース・既存コードとの整合）。実装者がやったことの追認ではなく、やっていない角度を突く。
6. 判定を PR コメントに書き、ラベルを付け替える:
   - 合格 → `agent-review:passed`（検証ログ・実機確認の内容を添える）
   - 不合格 → `agent-review:failed`（欠陥の再現手順と修正すべき点を具体的に書く）
7. Review Queue 連携（該当時）: 付け替え後のラベルに合わせて State を更新し、Blocked count を再計算する（「Review Queue 連携」参照）。
8. 更新したブランチは push する（feature ブランチへの push は許可されている）。

### Step 1.5: passed の鮮度チェック

`agent-review:passed` の PR のうち、`origin/main` との間でコンフリクトが発生しているものがあれば、`agent-review:pending` に戻して次サイクル以降で再レビューさせる（Review Queue 連携時は State も レビュー中 に戻す）。これにより「passed = 今すぐコンフリクトなしでマージでき、直近の main で動作確認済み」が常に保たれる。

### Step 2: 修正モード — `agent-review:failed` の PR がある

最も古い1件を選び、PR ブランチの worktree でレビューコメントの指摘を修正する。

1. 修正後、`npm run test:run` / `npm run lint` を実行し、証拠をターン内に表示する。
2. push して PR コメントに対応内容を書き、`agent-review:pending` に戻す（Review Queue 連携時は State も レビュー中 に戻す）。
3. 同一 PR で failed が2回付いたら、それ以上触らず PR コメントに経緯をまとめ、元 issue を `agent-blocked` にして人間へ引き渡す（Review Queue 連携時は元 issue を State=要介入 で登録し、PR の item は削除する）。

### Step 3: 実装モード — 実行可能な issue がある

**実行可能な issue** = open かつ `agent-ready` 付き、かつ `agent-wip` / `agent-blocked` / `size:large` が付いていないもの。念のため、open な PR が既に紐づいている issue も除外する（`gh pr list --search "<番号> in:body"` 等で確認）。さらに、ネイティブの依存関係で **open な issue にブロックされているものは拾わない**（`gh api repos/<owner>/<repo>/issues/<番号>/dependencies/blocked_by --jq '[.[] | select(.state == "open")] | length'` が 0 でないもの。ブロッカー側を先に片付ける）。最も番号の小さい1件を選ぶ。

1. 受け入れ条件が測定可能な形で書かれていない issue は拾わない。不足点を issue コメントで指摘し、次の候補へ（候補が尽きたら Step 4 へ）。
2. 着手宣言: `agent-wip` ラベルを付け、着手コメントを残す。Review Queue 連携（該当時）: この issue がボードに載っていれば（着手可能 など）item を削除する（着手した issue は実行待ちキューから消す）。
3. `~/orca/workspaces/Shukan_ver.1.0` 配下に worktree を作成する（ブランチ名: `agent/issue-<番号>-<slug>`、起点は `origin/main`）。wt-setup スキルが使えるなら使う。
4. 受け入れ条件を仕様として実装する。テストを先に書く（大原則 6・7 を遵守）。
5. `npm run test:run` / `npm run lint` / `npm run build` を実行し、証拠をターン内に表示する。
6. 通ったら push して **Draft PR** を作成する。本文は loops プラグインの `references/pr-body-format.md` の型（5 セクション + `Closes #<番号>` + 検証ログの折りたたみ。小変更は軽量モード可）に従って書き、`agent-review:pending` ラベルを付ける。Review Queue 連携（該当時）: PR を Project に登録し、State を レビュー中 に、Blocked count を算出して設定する（「Review Queue 連携」参照）。
7. issue に PR の URL と要約をコメントし、`agent-wip` と **`agent-ready` の両方を外す**（PR が open な間に別サイクルが同じ issue を再実装しないため。マージされれば `Closes` で自動クローズされ、PR がマージされずクローズされた場合は人間が再トリアージして `agent-ready` を付け直す）。
8. 行き詰まったら: worktree は残し、issue に失敗ログをコメントする。同一 issue の失敗コメントが2件になったら `agent-blocked` に切り替えて以後拾わない（Review Queue 連携時は State=要介入 で登録する）。教訓を `.agent-loop/GUARDRAILS.md` に追記する（大原則 4 のミラーも忘れずに）。

途中で `size:large` 相当（1サイクルで完結しない規模）と判明したら、着手を中止して issue に分割案をコメントし、`size:large` を付けて終了する。

### Step 4: 提案モード — 上記のどれにも該当しない

1. open な `agent-proposed` の件数を数える。**3 件以上あれば新規起票せず**「未トリアージの提案が溜まっている」と報告して終了する（承認待ちを溜めてラバースタンプ化させないため）。
2. 上限未満なら、コードベース・既存 issue・`.agent-loop/GUARDRAILS.md`・直近のログを調査し、価値のあるタスク案を**最大2件**、`agent-proposed` ラベルで起票する。各案には測定可能な受け入れ条件と、触るファイル・関数の見当を必ず書く。既存 issue との依存関係が明確なら、ネイティブの dependencies も張る（`gh api -X POST repos/<owner>/<repo>/issues/<後続>/dependencies/blocked_by -F issue_id=<前提のissue id>`）。Review Queue 連携（該当時）: 起票した issue を State=トリアージ で登録し、Blocked count を設定する。
3. **起票のみで終了する。実行しない。** 人間が `agent-ready` に昇格させるまで待つ。

## 実行ログ形式（.agent-loop/log.md）

`.agent-loop/` は git 管理外（.gitignore 対象）。ファイルが無ければテーブルヘッダごと作成する。
サイクルごとに1行、テーブルに追記する:

```
| 日時 | モード | 対象 | 結果 | 備考 |
|---|---|---|---|---|
| 2026-01-01 09:00 | review | PR #12 | passed | ブラウザ検証OK |
| 2026-01-01 10:00 | implement | #15 | PR #18 作成 | テスト 34 passed |
| 2026-01-01 11:00 | skip | - | rate guard | 5h 45%（閾値 38%） |
```

このログはレビュー段階の効果測定に使う。**レビュー検出率（failed / レビュー総数）が数週間ほぼ 0% なら、レビューモードの廃止を人間に提案すること。**
