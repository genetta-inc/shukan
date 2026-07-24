-- evidence_requests: エビデンス未紐付けのカスタム習慣に対する「エビデンス追加リクエスト」（issue #90）
-- 投票権システム（issue #27）の手動運転版。運営は service_role で件数の多い順に集計し、
-- 週次で evidence-pipeline スキルを回して記事化する。
create table if not exists public.evidence_requests (
  id uuid primary key default gen_random_uuid(),
  habit_id uuid not null references public.habits(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- 習慣名は自由入力のスナップショット（habit 削除後・改名後も集計時の文言が残るように）
  habit_name text not null check (char_length(habit_name) between 1 and 200),
  created_at timestamptz not null default now(),
  -- 同一ユーザーの重複リクエストは1件に（habit_id 単位で冪等。upsert(ignoreDuplicates) で運用）
  unique (habit_id)
);

create index idx_evidence_requests_habit_name on public.evidence_requests(habit_name);

-- RLS: 自分の habit に対するリクエストのみ作成・閲覧可能（article_feedbacks と同じ形）。
-- UPDATE/DELETE ポリシーは定義しない = 送信後は取り消し不可（v1 スコープ外）。
alter table public.evidence_requests enable row level security;

create policy "Users can view own evidence requests"
  on public.evidence_requests for select
  using (auth.uid() = user_id);

create policy "Users can insert own evidence requests"
  on public.evidence_requests for insert
  with check (auth.uid() = user_id and habit_id in (
    select id from public.habits where user_id = auth.uid()
  ));

-- 運営の週次棚卸し用: 習慣名ごとのリクエスト件数（多い順）。
-- article_feedback_stats と同じ形（RLS はビュー越しにも効くため、フルの集計は service_role で見る）。
create or replace view public.evidence_request_stats as
select
  habit_name,
  count(*) as request_count,
  max(created_at) as last_requested_at
from public.evidence_requests
group by habit_name
order by request_count desc;
