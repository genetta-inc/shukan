# auto-merge 運用ガイド（自動マージと巻き戻し）

`agent-review:passed` が付いた PR を、**決定論的な条件だけ**で機械マージするロボットの運用書。
実装は `.github/workflows/auto-merge.yml` と `.github/workflows/revert-pr.yml`
（dev-workflow プラグインの `templates/auto-merge/` から展開したもの）。

**なぜ入れたか**: 人間のマージ操作は実質ボタン押しで、そこに正しさは足されていなかった。
人間の時間は「止めるか続けるか」の意思決定に使い、条件判定は機械に渡す。
代わりに、**壊れたらすぐ止められる／壊れたことを LLM なしで感知できる**手段をセットで用意する
（この文書の「緊急停止」と「巻き戻し」）。

---

## マージされる条件（4つすべて）

| # | 条件 | 判定方法 |
|---|---|---|
| 1 | PR に `agent-review:passed` ラベルが付いている | REST でラベル取得（`gh pr list --label` はコロン入りラベルで 0 件を返すことがあるため使わない） |
| 2 | ci.yml の必須チェックがすべて green | check-runs API を**チェック名の完全一致**で検証。名前ごとに最新 run の conclusion だけを見る |
| 3 | 聖域パスに一切触れていない | PR の変更ファイル一覧を**パス正規表現**で判定。**rename 元のパス（`previous_filename`）も対象**にするので、聖域ファイルを別名に移して迂回することはできない |
| 4 | リポ変数 `AUTOMERGE_PAUSED` が未設定 | 空でない値が入っていたら全停止 |

加えて、次のいずれかに当てはまる PR は対象外（スキップ）:

- draft
- base が `main` 以外（スタック PR。親ブランチへのマージは main に入る内容と一致しないため人間判断に残す）
- `human-merge` / `needs-human-merge` / `human-only` / `needs-approval` のいずれかのラベルが付いている
  （`needs-approval` はレビューゲートスキル（dev-workflow プラグインの `pr-review-gate`）が「主のリスク許容待ち」
  「自力で動作確認できず代行を依頼中」の PR に付ける保留印。`agent-review:passed` と同時に付く事故
  ＝付与順の入れ違いや人間の手動付与に対する防波堤として、合格ラベルより優先して見送る）
- `secrets.AUTOMERGE_PAT` が未設定（**何もマージせず**ログに警告を出して終了する = fail-closed）

マージ方式は **squash**。マージは**検証した HEAD SHA にピンして**行う（REST の
`PUT /repos/{owner}/{repo}/pulls/{n}/merge` に `sha` を渡す）。条件を検証してから実際に
マージするまでの隙に新しいコミットが push された場合は 409 で失敗し、**未検証のコードは
入らない**。その PR は次のイベントで新しい HEAD を最初から検証し直す。
マージ直前にはラベルと PR 状態（base / draft / merged）を取り直し、合格ラベルの取り消しや
保留ラベルの付与が判定後に起きていた場合も止まる。
緊急停止変数（`AUTOMERGE_PAUSED`）は **run 開始時に評価**される（マージ直前の再取得は無い —
GITHUB_TOKEN の permissions キーに variables 相当が存在せず、workflow 内から repo variables の
REST 読み取りは成功しないため。2026-08-03 実測）。run の寿命は数秒なので、変数を設定した後に
開始する run はすべて冒頭で全停止し、緊急停止として機能する。
マージ後、根拠・検証した SHA・判定ログの URL が PR にコメントされる。

### いつ動くか

| トリガー | 目的 |
|---|---|
| `agent-review:passed` ラベル付与時（`pull_request_target: labeled`） | **主経路**。レビュー合格の瞬間に**その PR だけ**を即判定・即マージ（主の運用意図「レビューが通ったらその場でマージ」） |
| CI ワークフロー完了時（`workflow_run`） | バックストップ。ラベル付与時点で CI が未 green だった PR を、CI が green になった瞬間に拾う |
| 毎日 20:23 UTC の cron | 両イベントをすり抜けた PR の最終救済 |
| 手動実行（`workflow_dispatch`） | 検証・臨時実行。`dry_run` / `pr` の入力あり |

> **手動実行するときは必ず既定ブランチ（`main`）の ref から実行する。** `workflow_dispatch` は
> 実行時に選んだ ref 側の workflow 定義で動くため、feature ブランチを選ぶとそのブランチ側の
> （まだレビューされていない）判定ロジックが走る。Run workflow の「Use workflow from」は
> `main` のままにすること。

> **素の `pull_request` トリガーは意図的に使っていない**（2026-08-03 のアドバーサリアルレビューで
> critical 指摘）。GitHub Actions の `pull_request` イベントは **PR の head ブランチ側の
> ワークフロー定義**で実行されるため、`auto-merge.yml` を書き換えた PR が「聖域判定を削った
> 自分の改変版」を実行できてしまい、自己参照的な保護が根本から破れる。
>
> ラベル即応に使っている **`pull_request_target` はこれとは別物**で、GitHub 仕様により
> **常に base（main）側の定義**で実行される（改変版はマージされるまで一度も動かない）。
> `pull_request_target` 固有のリスク（fork PR に対しても write 権限トークンとシークレット付きで
> 走ること）が実害になるのは **PR head のコードを checkout / 実行した場合だけ**で、
> この workflow は checkout を一切行わず gh API の読み取り判定のみで完結する。
> この「checkout が存在しない」不変条件は `scripts/test-auto-merge-workflow.sh` の静的 assert が
> 固定しており、checkout を足す変更は CI で必ず落ちて人間の目を通る。
> 上の4系のトリガーはすべて **既定ブランチ（main）側の定義**で実行される。

### レビューゲート側の合格処理（発火確認とフォールバック）

レビューゲート（dev-workflow プラグインの `pr-review-gate` スキル）の合格処理は、
`agent-review:passed` ラベルを付けて終わりにせず、**マージ発火まで確認する**:

1. ラベル付与後、auto-merge の run が起きたことを確認する
   （`https://github.com/<owner>/<repo>/actions/workflows/auto-merge.yml` に
   `pull_request_target` の run が現れる。通常は付与から数十秒以内）
2. labeled イベントが何らかの理由で発火しなかった場合（GitHub 側の配送遅延・障害等）は、
   手動発火にフォールバックする:

   ```sh
   gh workflow run auto-merge.yml --ref main -f pr=<PR番号>
   ```

   （`--ref main` を必ず付ける。feature ブランチの ref で起動すると未レビューの判定ロジックが
   走ってしまう。「いつ動くか」冒頭の注意と同じ理由）

**原則: マージの実行権は常にこのロボット（auto-merge workflow）側にある。**
レビューエージェント（LLM）がやってよいのは合格ラベルの付与と発火ボタン
（上の `gh workflow run`）までで、`gh pr merge` や REST の merge API を LLM が直接叩いて
マージすることは、条件判定（聖域・CI green・SHA ピン・緊急停止）を素通りするため**禁止**。

---

## 聖域パス（常に人間がマージする）

**パスベース判定**であり、内容の意味判定（LLM・レビューエージェント）には一切委ねない。
聖域に触れる PR には `human-merge` ラベルが自動で付き、理由がコメントされ、以後スキップされる。

| パス | なぜ聖域か |
|---|---|
| `.github/workflows/`（**ディレクトリ丸ごと**） | **マージ条件そのもの**。判定ルールをエージェントが書き換えて main に入れる経路を塞ぐ（自己参照的な保護）。ci.yml も新規に足した workflow もすべて含む |
| `CLAUDE.md`（どの階層でも） | 全エージェントに毎ターン効く絶対ルール |
| `.claude/`（ディレクトリ丸ごと） | スキル・設定・フック。エージェントの振る舞いの実体 |
| `docs/agent-loop*.md` と `docs/agent-loop*/` | 自律開発ループの憲法（`agent-loop.md` / `agent-loop-steps.md`。将来ディレクトリに割れても効く） |

リポ固有の憲法 doc があれば `auto-merge.yml` の `SACRED`（`# >>> sacred-paths` マーカーの間）に追記し、
`scripts/test-auto-merge-workflow.sh` の must-match リストにも代表パスを足す（片方だけだとテストが落ちる）。

ディレクトリは**プレフィックスで丸ごと**聖域にしている（個別ファイル名を列挙すると、
ci.yml の隣に新しい workflow を置くだけで素通りできてしまうため）。

判定は**変更後のパスと rename 元のパスの両方**に当てる。したがって次のどれも聖域として止まる:

- 聖域ファイルの変更（`modified`）
- 聖域ファイルの削除（`removed`。消えたパスがそのまま判定対象に残る）
- **聖域ファイルを非聖域パスへ移動（`renamed`）**。変更後の名前だけを見ていると迂回できるため、
  `previous_filename` も列挙して判定する

聖域判定は `AUTOMERGE_PAUSED` の状態と無関係に必ず通る（停止中は何もマージしないので、
どちらに転んでも聖域 PR が機械マージされることはない）。

### 見送りラベルの使い分け（どれが付いていてもマージしない）

| ラベル | 誰が付ける | 意味 |
|---|---|---|
| `human-merge` | auto-merge ロボット（自動） | 聖域パスに触れているので機械マージ対象外。中身は正常 |
| `needs-human-merge` | 開発ループ | コンフリクトが意味的競合で機械的に解けず、マージを人間に委ねた |
| `needs-approval` | レビューゲートスキル（dev-workflow プラグインの `pr-review-gate`） | 主のリスク許容待ち、または自力で動作確認できず代行を依頼中の保留 |
| `human-only` | 人間・トリアージ | ループが触らない印（PR に付いていたら機械マージもしない） |

`agent-review:passed` が付いていても、これらのどれか1つが付いていればマージしない
（**合格ラベルだけを見て素通りさせない**。付与順の入れ違いで両方付く事故への防波堤）。
`human-merge` を**手で付ければ**任意の PR を機械マージから外せる
（＝人間が判断を留保したい PR の印としても使える）。

---

## 緊急停止（主の操作・スマホから可）

リポジトリ変数 `AUTOMERGE_PAUSED` に**空でない値**（例: `1`）を入れるだけで全停止する。
ワークフローは実行されるが、何もマージせず警告を出して終了する。
効くのは**設定後に開始する run から**（実行中の run には効かない。run の寿命は数秒。
理由は「いつ動くか」節の run 開始時評価の説明を参照）。

- 設定画面: `https://github.com/<owner>/<repo>/settings/variables/actions`
- 「New repository variable」→ Name: `AUTOMERGE_PAUSED` / Value: `1` → Add
- **再開**は同じ画面で変数を**削除**する（`0` を入れても「空でない値」なので停止のまま。
  停止を解くには削除が必要 = fail-closed）。

CLI からなら:

```sh
gh api -X POST repos/<owner>/<repo>/actions/variables -f name=AUTOMERGE_PAUSED -f value=1   # 停止
gh api -X DELETE repos/<owner>/<repo>/actions/variables/AUTOMERGE_PAUSED                    # 再開
```

---

## 巻き戻し（revert PR のワンクリック生成）

マージ済み PR の番号を入れると、**revert PR を作るところまで**を自動でやる。
マージはしない（壊れたと思ったものが実は正しく、revert が二次被害になりうるため、
巻き戻すかどうかの判断は人間に残す）。

1. `https://github.com/<owner>/<repo>/actions/workflows/revert-pr.yml` を開く
2. 「Run workflow」→ `pr` に巻き戻したい **マージ済み PR の番号**、`reason` に理由（任意）
3. 生成された revert PR（`revert/pr-<番号>-<run id>` ブランチ）を確認してマージ

補足:

- squash マージ（このロボットの既定）と merge commit の両方に対応する（親コミット数を見て
  `git revert -m 1` の要否を自動で切り替える）。
- revert PR には `human-merge` が付くので、auto-merge が拾うことはない。
- revert がコンフリクトした場合はワークフローが失敗する。その場合は手で revert ブランチを作る。
- `AUTOMERGE_PAT` が未設定でも revert PR は作れる（緊急時に「PAT が無いから巻き戻せない」を
  作らないため GITHUB_TOKEN にフォールバックする）。ただしその PR では CI が自動起動しないので、
  空コミットの push か手動 re-run で CI を回してからマージする。

---

## 主の作業: PAT（`AUTOMERGE_PAT`）の発行

**この登録が終わるまで、auto-merge は 1 件もマージしない**（警告ログを出して終了する）。

GITHUB_TOKEN でマージすると、その push が後続ワークフローを起動しない（GitHub の再帰防止仕様）。
そのため**マージ操作だけ** PAT を使う。参照・ラベル付与・コメントは GITHUB_TOKEN のまま。

1. https://github.com/settings/personal-access-tokens/new （Fine-grained personal access token）
2. Resource owner: **リポの owner** / Repository access: **Only select repositories → 対象リポ**
3. Repository permissions:
   - **Contents: Read and write**（マージ＝ push 相当）
   - **Pull requests: Read and write**
   - Metadata: Read-only（自動で付く）
4. 有効期限は任意（切れると auto-merge が黙って止まる＝安全側に倒れる。カレンダーに更新を入れておく）
5. 生成したトークンを `https://github.com/<owner>/<repo>/settings/secrets/actions` で
   **Name: `AUTOMERGE_PAT`** として登録する

> トークンの値はこのリポジトリのファイルには絶対に書かない（GitHub Secrets と
> agents 保管庫にのみ置く）。

### 登録前に挙動を確かめたいとき（dry run）

PAT なしでも判定ログだけ出せる:

1. `https://github.com/<owner>/<repo>/actions/workflows/auto-merge.yml` → Run workflow
2. `dry_run` にチェック（必要なら `pr` に PR 番号を入れて 1 件だけ判定）
3. ログに「全条件を満たしています」「聖域接触」「CI 未 green」等の判定理由が出る。マージはされない

---

## ci.yml を変えるときの注意（最も踏みやすい落とし穴）

GitHub Free の private リポジトリでは branch protection が使えないため、
CI green の判定は**チェック名の完全一致**で auto-merge が自前検証している。

- 必須チェック名の一覧は `auto-merge.yml` 内の `REQUIRED_CHECKS`（`# >>> required-checks` マーカーの間）
- ci.yml のジョブ名（`name:`）を変えたり、ジョブを増やしたら `REQUIRED_CHECKS` も直す
- 一致しないと「green にならない」＝マージされない側（fail-closed）に倒れるので危険はないが、
  原因不明の停滞に見える
- この一致は `scripts/test-auto-merge-workflow.sh` が CI で機械的に検証する（ズレたらテストが落ちる）

---

## マージされないときの調べ方

1. `https://github.com/<owner>/<repo>/actions/workflows/auto-merge.yml` で直近の run のログを見る
   （PR ごとに「なぜスキップしたか」を必ず 1 行出している）
2. `AUTOMERGE_PAUSED` が残っていないか（停止したまま忘れているケース）
3. PR に `human-merge` / `needs-human-merge` / `human-only` / `needs-approval` が付いていないか
4. `agent-review:passed` が付いているか、draft でないか、base が `main` か
5. CI が green か。green に見えるのに通らないなら `REQUIRED_CHECKS` とジョブ名のズレを疑う
6. `AUTOMERGE_PAT` の期限切れ（ログに「未設定」と出る）
7. ラベル付与（`agent-review:passed`）では即時に判定が走る（`pull_request_target: labeled`）。
   その run のログを見る。付与時点で CI が未 green だった場合はスキップされるのが正常で、
   次の CI 完了（`workflow_run`）か日次 cron が拾う。急ぐときは手動実行で `pr` に番号を入れる
8. ログに 409 が出ていないか（判定後に新しいコミットが push されると SHA ピンで拒否される。
   次のイベントで新しい HEAD を検証し直すので、放置しても最終的にマージされる）

---

## この仕組みが担保していないこと（受容済みの残リスク）

テストで拾えない意味的な破壊はこのゲートを通過しうる。その守りは main マージ後の検知
（デプロイ後スモーク・稼働監視・この文書の巻き戻し手順）としてリポごとに別途用意する。
本ドキュメントが扱うのは**マージ前のゲートと緊急停止・巻き戻し**まで。
