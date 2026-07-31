-- ============================================
-- Migration: habits.graduation_declined_at
-- ============================================
-- 連続30日到達時の「卒業」提案導線（issue #91）で、ユーザーが「まだ続ける」を選んだ
-- 習慣には二度と提案しないための恒久フラグ。値が入っていれば以後の提案対象から除外する。
-- 「卒業する」を選んだ場合は既存の status='established'（20260627000000_habit_status.sql）に
-- 遷移するため、このカラムへの書き込みは不要。
--
-- 後方互換: nullable で追加するため、既存行はすべて NULL（= 未選択 = 提案対象になり得る）で
-- 壊れない。既存の RLS（user_id 単位の select/insert/update/delete）はそのまま適用される。

alter table public.habits
  add column if not exists graduation_declined_at timestamptz;
