-- ============================================
-- user_profiles: tutorial_completed_at 追加（issue #117）
-- ============================================
-- 初回チュートリアル（コーチマーク）の一度きり表示制御を、端末単位の localStorage
-- から DB（user_profiles）へ移す。NULL = 未完了。localStorage は以後ネットワーク
-- 往復を省く高速パスのキャッシュとしてのみ使う（src/lib/tutorial.ts）。
--
-- 既存ユーザー（このマイグレーション適用時点で行が存在するプロファイル）は
-- バックフィルで now() を入れ、デプロイ後に自動起動させない。

alter table public.user_profiles
  add column if not exists tutorial_completed_at timestamptz;

update public.user_profiles
  set tutorial_completed_at = now()
  where tutorial_completed_at is null;
