# first-run-tutorial Delta Specification（tutorial-db-completion-flag）

## MODIFIED Requirements

### Requirement: 起動条件と一度きりの表示制御

システムは、初回チュートリアルの一度きり表示制御を `user_profiles.tutorial_completed_at`（DB）を正として行わなければならない（MUST）。`tutorial_completed_at` が `NULL` のプロファイルは未完了、非 `NULL` は完了済みとして扱う。localStorage（キー `smitch-tutorial`）はネットワーク往復を省くための高速パスキャッシュとしてのみ用いる（MUST）。

オンボーディング完了の書き込み成功時に localStorage へ `pending` を記録する（MUST）。ホーム到着時、ローカルキャッシュが `done`（同期確認済み）であれば DB を参照せず起動しない（MUST）。それ以外の場合は `tutorial_completed_at` を取得し、`NULL` なら起動し、非 `NULL` なら起動せずローカルキャッシュを `done` に更新しなければならない（MUST）。DB 取得に失敗した場合は、ローカルキャッシュが `pending` のときのみ起動する（フォールバック、MUST）。

チュートリアルの完走またはスキップ時は、ローカルキャッシュを即座に `done-unsynced` にした上で `tutorial_completed_at = now()` を DB へ書き込み、成功したらローカルキャッシュを `done` に昇格しなければならない（MUST）。書き込みに失敗した場合はローカルキャッシュを `done-unsynced` のまま残し、以後は自動表示せず、次回 DB 参照時に書き込みを再送しなければならない（MUST）。

URL クエリ `?tutorial=1` が付いている場合は、DB 上の完了状態に関わらず再実行できなければならない（MUST）。この強制再実行は DB を変更してはならない（MUST NOT）。

デプロイ時点で既存のプロファイル（マイグレーション適用時点で存在する行）は `tutorial_completed_at` に `now()` をバックフィルし、デプロイ後に自動起動してはならない（MUST NOT）。

#### Scenario: オンボーディング完了直後に一度だけ起動する
- **WHEN** オンボーディングの [6] スタートで書き込みが成功しホームへ遷移する
- **THEN** 画面が落ち着いた後に「ようこそ」カード（使い方ガイドの開始）が表示される
- **WHEN** チュートリアルを完走またはスキップした後にホームを再訪問する
- **THEN** チュートリアルは表示されない

#### Scenario: クエリで再実行できる
- **WHEN** DB 上で完了済みの状態で `/?tutorial=1` を開く
- **THEN** チュートリアルが最初から起動する
- **THEN** DB の `tutorial_completed_at` は変更されない

#### Scenario: 別端末（クロスデバイス）では自動起動しない
- **WHEN** 端末Aでオンボーディング完了後にチュートリアルを完走またはスキップする
- **THEN** 同一アカウントで別端末Bにログインし localStorage が無い状態でホームを開いても、チュートリアルは自動起動しない

#### Scenario: 新規ユーザーは localStorage が無くても DB 判定で起動する
- **WHEN** オンボーディング完了済み・`tutorial_completed_at` が `NULL` のユーザーが、localStorage を持たない状態（別ブラウザ等）でホームを開く
- **THEN** DB 判定によりチュートリアルが起動する

#### Scenario: 既存プロファイル（バックフィル対象）は自動起動しない
- **WHEN** このマイグレーション適用前から存在するプロファイル（`tutorial_completed_at` がバックフィルで非 `NULL` になっている）でホームを開く
- **THEN** チュートリアルは自動起動しない

#### Scenario: DB 書き込み失敗時は次回リトライする
- **WHEN** チュートリアル完走時に `tutorial_completed_at` の DB 書き込みがオフライン等で失敗する
- **THEN** この端末ではチュートリアルは再表示されない（ローカルキャッシュが `done-unsynced` のため）
- **WHEN** 後日オンライン状態でホームを開き DB 判定が行われる
- **THEN** `tutorial_completed_at` への書き込みが自動的に再送される

#### Scenario: DB 参照に失敗してもローカル pending なら起動する（フォールバック）
- **WHEN** ネットワーク不調で `tutorial_completed_at` の取得に失敗し、かつローカルキャッシュが `pending`（この端末でオンボ完了直後）である
- **THEN** チュートリアルが起動する
