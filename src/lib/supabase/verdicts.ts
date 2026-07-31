import { createClient } from './client';
import type { ArticleVerdict } from '@/lib/verdicts';

// issue #89: 構造化投票（1ユーザー1記事1票・変更可）のデータ層。
// article_feedbacks（bad mark / comment、追記型）とは別テーブル article_verdicts を使う。

export async function submitVerdict(
  userId: string,
  articleId: string,
  verdict: ArticleVerdict,
  voterStreakDays: number
): Promise<void> {
  const supabase = createClient();

  const { error } = await supabase.from('article_verdicts').upsert(
    {
      user_id: userId,
      article_id: articleId,
      verdict,
      voter_streak_days: voterStreakDays,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,article_id' }
  );

  if (error) throw error;
}

export async function getUserVerdict(
  userId: string,
  articleId: string
): Promise<{ verdict: ArticleVerdict | null }> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from('article_verdicts')
    .select('verdict')
    .eq('user_id', userId)
    .eq('article_id', articleId)
    .maybeSingle();

  if (error) {
    console.error('Failed to get user verdict:', error);
    return { verdict: null };
  }

  return { verdict: (data?.verdict as ArticleVerdict | undefined) ?? null };
}
