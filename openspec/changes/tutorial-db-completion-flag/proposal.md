# Proposal: tutorial-db-completion-flag

Refs: #117（first-run-tutorial の追補。元 change: 2026-07-18-first-run-tutorial）

## Why

PR #115 の初回チュートリアル（コーチマーク）は表示制御が localStorage のみ（キー `smitch-tutorial`、`pending`→`done`）。端末/ブラウザ単位の制御のため、別端末・別ブラウザでログインしても再表示され、逆にブラウザデータ削除後は `?tutorial=1` を知らないユーザーは二度と見られない。「一度きり表示」の正が端末に散らばっている状態はローンチ前に解消する必要がある（launch-blocker）。

## What Changes

- `user_profiles` に `tutorial_completed_at TIMESTAMPTZ NULL` を追加（NULL=未完了）。既存行はマイグレーションで `now()` にバックフィルし、デプロイ後に自動起動しないようにする
- 起動判定を「DB を正、localStorage を高速パスキャッシュ」に変更:
  - localStorage が `done`（この端末で同期確認済み）なら DB を参照せず終了（高速パス）
  - それ以外は `user_profiles.tutorial_completed_at` を取得し、`NULL` なら起動、非 `NULL` なら起動しない（かつローカルを `done` に昇格しキャッシュ化する）
  - DB 取得に失敗した場合は、従来どおりローカルの `pending` 判定にのみフォールバックする
- 完走・スキップ時: ローカルを即座に `done-unsynced` にしてから DB へ `tutorial_completed_at = now()` を書き込み、成功したら `done` に昇格する。書き込みに失敗した場合は `done-unsynced` のまま残り、次回 DB 参照時に自動で再送する（オフライン下でも二重表示は起きない）
- `?tutorial=1` の強制再実行は現状維持（DB を書き換えない）
- オンボーディング完了時の `markTutorialPending()`（localStorage）は残す。別端末ではこの値が無くても DB 判定だけで起動できる

## Capabilities

### Modified Capabilities
- `first-run-tutorial`: 「起動条件と一度きりの表示制御」要件を、localStorage 単独の表示制御から DB（`user_profiles.tutorial_completed_at`）を正としクロスデバイスで一度きりにする内容へ更新する。ステップ構成・スポットライト制御・離脱手段・アンカー不在フォールバックの各要件は変更しない

## Impact

- **DB**: `supabase/migrations/20260725100000_user_profiles_tutorial_completed_at.sql`（追加カラム＋既存行バックフィル）。dev（`smitch-dev`, ref `xhqddzdpcpvxpprxykct`）に適用済み
- **変更**: `src/lib/supabase/profiles.ts`（`UserProfile`/`UserProfileRow` に `tutorialCompletedAt`/`tutorial_completed_at` 追加、`markTutorialCompleted()` 新設）、`src/lib/tutorial.ts`（DB 正の起動判定を担う純関数 `resolveAutoStart()` と localStorage 状態機械 `'pending' | 'done' | 'done-unsynced'` を追加）、`src/components/tutorial/tutorial-overlay.tsx`（起動判定・完走/スキップ処理を DB 連携に更新）、`src/lib/onboarding.ts`（計算専用の合成 `UserProfile` に `tutorialCompletedAt: null` を追加し型エラーを解消）
- **テスト**: `src/__tests__/tutorial-completed-at-migration.test.ts`（マイグレーション SQL 検証）、`src/__tests__/tutorial-logic.test.ts`（`resolveAutoStart` の純ロジック検証を追加）、`src/__tests__/profiles.test.ts`（`tutorialCompletedAt` マッピング検証を追加）、`src/__tests__/tutorial-completed-write.test.ts`（`markTutorialCompleted()` の update 呼び出し検証、supabase クライアントをモック）
- **実DB検証**: fixture user 2 名 + anon で、本人の書き込み成功／他人の書き込み拒否（RLS, 0 行）／未認証の書き込み拒否を確認済み（検証後、行とユーザーを削除済み）
