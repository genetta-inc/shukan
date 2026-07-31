/**
 * エビデンス記事への構造化投票（issue #89）の純粋ロジック。
 * UI（evidence-article-sheet）と分離してユニットテスト可能にする。
 *
 * 4択: 「効果が大きすぎる」「効果が小さすぎる」「妥当だと思う」「間違いがある」。
 * 投票時に投票者の該当習慣の継続日数をスナップショット保存する
 * （重み付け集計は issue #27 のスコープ。ここでは事実の保存のみ）。
 */

import { calculateStreak } from '@/lib/habits';
import type { Habit, HabitCompletion } from '@/types/habit';

export const ARTICLE_VERDICTS = ['too_high', 'too_low', 'fair', 'incorrect'] as const;
export type ArticleVerdict = (typeof ARTICLE_VERDICTS)[number];

export function isArticleVerdict(value: string): value is ArticleVerdict {
  return (ARTICLE_VERDICTS as readonly string[]).includes(value);
}

/**
 * 指定した articleId に紐づく（アクティブな）習慣を探し、その継続日数（current streak）を返す。
 * 複数の習慣が同じ記事にひも付いている場合は最大値を採用する。
 * 紐づく習慣が無い場合（Discover 未追加・オンボーディング中等）は 0。
 */
export function findVoterStreakForArticle(
  habits: Habit[],
  completions: HabitCompletion[],
  articleId: string
): number {
  const linkedHabits = habits.filter(
    (h) =>
      !h.archived &&
      (h.evidences.some((e) => e.articleId === articleId) || h.impactArticleId === articleId)
  );

  if (linkedHabits.length === 0) return 0;

  return Math.max(
    ...linkedHabits.map((h) => calculateStreak(h.id, completions, h).current)
  );
}
