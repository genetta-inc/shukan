# Tasks: tutorial-db-completion-flag

- [x] `user_profiles` に `tutorial_completed_at TIMESTAMPTZ NULL` を追加するマイグレーションを作成し、既存行を `now()` でバックフィルする
- [x] マイグレーションを dev（`smitch-dev`）に適用する
- [x] `src/lib/supabase/profiles.ts` に `tutorialCompletedAt` フィールドと `markTutorialCompleted()` を追加する
- [x] `src/lib/tutorial.ts` に DB 正の起動判定を担う純関数 `resolveAutoStart()` と localStorage 状態機械（`pending` / `done` / `done-unsynced`）を追加する
- [x] `src/components/tutorial/tutorial-overlay.tsx` の起動判定・完走/スキップ処理を DB 連携に更新する
- [x] 単体テスト（マイグレーション SQL 検証・`resolveAutoStart` 純ロジック・`toUserProfile` マッピング・`markTutorialCompleted` の update 呼び出し）を追加する
- [x] 実 DB で RLS を検証する（本人の書き込み成功／他人の書き込み拒否／未認証の書き込み拒否）
- [x] `npm run test:run` / `npm run lint` / `npm run build` / `npm run check:migrations` が通ることを確認する
- [x] `openspec/specs/first-run-tutorial/spec.md` の「起動条件と一度きりの表示制御」要件を更新する delta を作成する（本 change。archive 時に反映）
