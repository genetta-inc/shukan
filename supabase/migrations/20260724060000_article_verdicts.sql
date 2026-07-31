-- article_verdicts: エビデンス記事の推定値への構造化投票（issue #89）
-- 「効果が過大/過小/妥当/間違い」の4択投票 + 投票時点の該当習慣の継続日数スナップショット。
-- 既存 article_feedbacks（👎＋自由記述コメント）とは別テーブルにする:
--   - feedbacks は「複数回・追記型」（bad mark のON/OFF, comment は都度追加）
--   - verdicts は「1ユーザー1記事1票・上書き型」（upsert on (user_id, article_id)）
-- で書き込みパターンが異なるため、同一テーブルに type カラムで混在させない。
--
-- 重み付け集計（issue #27: 投票権システム）はこの issue のスコープ外。
-- voter_streak_days は「後で重み付け集計に使うための事実」として保存するのみで、
-- 本 issue では単純カウントの集計ビュー（article_verdict_stats）のみを提供する。

create table if not exists public.article_verdicts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  article_id text not null,
  verdict text not null check (verdict in ('too_high', 'too_low', 'fair', 'incorrect')),
  -- 投票時点の、この記事に紐づく習慣の継続日数スナップショット。
  -- 紐づく習慣が無い（Discover 未追加・オンボーディング中等）場合は 0。
  voter_streak_days integer not null default 0 check (voter_streak_days >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, article_id)
);

-- パフォーマンス用インデックス（記事単位の集計・存在チェック）
create index idx_article_verdicts_article
  on public.article_verdicts(article_id);

-- RLS: 自分の投票のみ読み書き可能（article_feedbacks と同方針）
alter table public.article_verdicts enable row level security;

create policy "Users can view own verdict"
  on public.article_verdicts for select
  using (auth.uid() = user_id);

create policy "Users can insert own verdict"
  on public.article_verdicts for insert
  with check (auth.uid() = user_id);

create policy "Users can update own verdict"
  on public.article_verdicts for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 投票の変更を許可するが削除（取り消し）は今回のスコープ外のため delete policy は追加しない。

-- 集計ビュー（service_role キーでのみ全体集計可能。article_feedback_stats と同方針）
create or replace view public.article_verdict_stats as
select
  article_id,
  count(*) filter (where verdict = 'too_high') as too_high_count,
  count(*) filter (where verdict = 'too_low') as too_low_count,
  count(*) filter (where verdict = 'fair') as fair_count,
  count(*) filter (where verdict = 'incorrect') as incorrect_count,
  count(*) as total_count,
  max(created_at) as last_voted_at
from public.article_verdicts
group by article_id;
