import type { HabitCompletion, HabitWithStats } from '@/types/habit';
import type { HabitEvidence, LifeImpactArticle, LifeImpactSavings } from '@/types/impact';

/**
 * 1日あたりのインパクト値（重み付き合計）
 */
export interface DailyImpact {
  healthMinutes: number;
  costSaving: number;
  incomeGain: number;
  positiveMoodMinutes: number;
}

/**
 * 年間インパクト値
 */
export interface AnnualImpact {
  healthMinutes: number;
  costSaving: number;
  incomeGain: number;
  positiveMoodMinutes: number;
}

const DAYS_PER_YEAR = 365;

/** de-dup 計算に必要な最小形（articleId + weight）。HabitEvidence を包含する。 */
export type EvidenceRef = Pick<HabitEvidence, 'articleId' | 'weight'>;

/**
 * articleId 単位の de-dup（issue #34: エビデンス重複加算の防止）。
 * 同一 articleId は1回だけ計上し、strength（weight や達成率）が最大の項目を採用する。
 * 順序は初出順を保つ（Map の挿入順）。
 */
export function dedupeByArticleId<T extends { articleId: HabitEvidence['articleId'] }>(
  items: readonly T[],
  getStrength: (item: T) => number
): T[] {
  const byArticle = new Map<HabitEvidence['articleId'], T>();
  for (const item of items) {
    const existing = byArticle.get(item.articleId);
    if (!existing || getStrength(item) > getStrength(existing)) {
      byArticle.set(item.articleId, item);
    }
  }
  return [...byArticle.values()];
}

/** evidences を articleId de-dup（最大ウェイト採用）で1本化する。 */
export function dedupeEvidences<T extends EvidenceRef>(evidences: readonly T[]): T[] {
  return dedupeByArticleId(evidences, (e) => e.weight);
}

/** 記事IDから refines 親（詳細化元の記事ID）を引く関数。親を持たない記事は undefined。 */
export type GetRefines = (articleId: string) => string | undefined;

/**
 * 系統 de-dup（issue #92: refines 関係による同系統重複排除）。
 * エビデンス集合内に refines チェーンで結ばれた「祖先–子孫」が両方存在する場合、
 * 詳細側（子孫）だけを計上し、粗い側（祖先）を落とす。詳細記事のほうがユーザーの
 * 実態に近い効果値を持つため。兄弟（同じ親を refines する記事同士）は別の実活動なので
 * 両方残す。articleId 単位の de-dup（#34: dedupeEvidences）の後段に適用すること。
 * refines の循環は validate-evidence が error で弾く前提だが、無限ループしないよう防御している。
 */
export function dedupeByLineage<T extends { articleId: HabitEvidence['articleId'] }>(
  items: readonly T[],
  getRefines: GetRefines
): T[] {
  // 集合内のいずれかの記事の（真の）祖先に当たる articleId を集める。
  const ancestorsOfPresent = new Set<string>();
  for (const item of items) {
    const visited = new Set<string>([item.articleId]);
    let parent = getRefines(item.articleId);
    while (parent !== undefined && !visited.has(parent)) {
      visited.add(parent);
      ancestorsOfPresent.add(parent);
      parent = getRefines(parent);
    }
  }
  return items.filter((item) => !ancestorsOfPresent.has(item.articleId));
}

/**
 * 日次インパクトを年間に変換
 */
export function calculateAnnualImpact(daily: DailyImpact): AnnualImpact {
  return {
    healthMinutes: daily.healthMinutes * DAYS_PER_YEAR,
    costSaving: daily.costSaving * DAYS_PER_YEAR,
    incomeGain: daily.incomeGain * DAYS_PER_YEAR,
    positiveMoodMinutes: daily.positiveMoodMinutes * DAYS_PER_YEAR,
  };
}

/**
 * 複数エビデンスの重み付き合計で日次インパクトを計算
 */
export function calculateDailyImpact(
  evidences: readonly EvidenceRef[],
  getArticleFn: (id: HabitEvidence['articleId']) => LifeImpactArticle | undefined
): DailyImpact {
  let healthMinutes = 0;
  let costSaving = 0;
  let incomeGain = 0;
  let positiveMoodMinutes = 0;
  for (const ev of evidences) {
    const article = getArticleFn(ev.articleId);
    if (!article) continue;
    const w = ev.weight / 100;
    healthMinutes += article.calculationParams.dailyHealthMinutes * w;
    costSaving += article.calculationParams.dailyCostSaving * w;
    incomeGain += article.calculationParams.dailyIncomeGain * w;
    positiveMoodMinutes += article.calculationParams.dailyPositiveMoodMinutes * w;
  }
  return { healthMinutes, costSaving, incomeGain, positiveMoodMinutes };
}

/**
 * 複数習慣ぶんの evidences を横断して日次インパクトを計算する（issue #34 / #92）。
 * ① 同一 articleId は1回だけ（最大ウェイト採用）計上する（#34）。
 * ② refines チェーンの祖先–子孫が両方あれば詳細側（子孫）だけを計上する（#92）。
 * ホーム集計（DailyImpactSummary 等）の習慣横断合算はこちらを使うこと。
 */
export function calculateDedupedDailyImpact(
  evidenceGroups: readonly (readonly EvidenceRef[])[],
  getArticleFn: (id: HabitEvidence['articleId']) => LifeImpactArticle | undefined
): DailyImpact {
  const flattened: EvidenceRef[] = [];
  for (const group of evidenceGroups) flattened.push(...group);
  const byArticle = dedupeEvidences(flattened);
  const byLineage = dedupeByLineage(byArticle, (id) =>
    getArticleFn(id as HabitEvidence['articleId'])?.refines
  );
  return calculateDailyImpact(byLineage, getArticleFn);
}

/**
 * 1つの習慣のインパクト貯金を計算（multi-evidence対応）
 */
export function calculateImpactSavings(
  habitId: string,
  completions: HabitCompletion[],
  article: LifeImpactArticle
): LifeImpactSavings {
  const completedDays = completions.filter(
    (c) => c.habitId === habitId &&
           (c.status === 'completed' || c.status === 'rocket_used')
  ).length;

  return {
    completedDays,
    healthMinutes: completedDays * article.calculationParams.dailyHealthMinutes,
    costSaving: completedDays * article.calculationParams.dailyCostSaving,
    incomeGain: completedDays * article.calculationParams.dailyIncomeGain,
    positiveMoodMinutes: completedDays * article.calculationParams.dailyPositiveMoodMinutes,
  };
}

/**
 * 複数エビデンスからインパクト貯金を計算
 */
export function calculateMultiEvidenceImpact(
  habitId: string,
  completions: HabitCompletion[],
  evidences: HabitEvidence[],
  getArticleFn: (id: HabitEvidence['articleId']) => LifeImpactArticle | undefined
): LifeImpactSavings {
  const completedDays = completions.filter(
    (c) => c.habitId === habitId &&
           (c.status === 'completed' || c.status === 'rocket_used')
  ).length;

  const daily = calculateDailyImpact(evidences, getArticleFn);
  return {
    completedDays,
    healthMinutes: completedDays * daily.healthMinutes,
    costSaving: completedDays * daily.costSaving,
    incomeGain: completedDays * daily.incomeGain,
    positiveMoodMinutes: completedDays * daily.positiveMoodMinutes,
  };
}

/**
 * 全習慣の合計インパクト貯金
 */
export function calculateTotalSavings(
  habits: HabitWithStats[]
): LifeImpactSavings {
  const initial: LifeImpactSavings = {
    completedDays: 0,
    healthMinutes: 0,
    costSaving: 0,
    incomeGain: 0,
    positiveMoodMinutes: 0,
  };
  return habits.reduce((total, habit) => {
    if (!habit.impactSavings) return total;
    return {
      completedDays: total.completedDays + habit.impactSavings.completedDays,
      healthMinutes: total.healthMinutes + habit.impactSavings.healthMinutes,
      costSaving: total.costSaving + habit.impactSavings.costSaving,
      incomeGain: total.incomeGain + habit.impactSavings.incomeGain,
      positiveMoodMinutes: total.positiveMoodMinutes + habit.impactSavings.positiveMoodMinutes,
    };
  }, initial);
}

/**
 * researchBody + inferences を結合して完成記事を生成
 */
export function renderArticle(article: LifeImpactArticle): string {
  const replacements: Record<string, string> = {
    health_inference: article.inferences.health,
    cost_inference: article.inferences.cost,
    income_inference: article.inferences.income,
    cumulative: article.inferences.cumulative,
  };
  // 4軸目「前向きな気持ちの時間」の推論段落。全記事が設定する前提だが、
  // 未設定の場合はプレースホルダーを残す（未知キーと同じ扱い）ことで気付けるようにする。
  if (article.inferences.positiveMood) {
    replacements.positive_mood_inference = article.inferences.positiveMood;
  }

  return article.article.researchBody.replace(
    /\{\{(\w+)\}\}/g,
    (_, key) => replacements[key] ?? `{{${key}}}`
  );
}

export interface TimeUnits {
  min: string;
  hour: string;
  day: string;
}

/**
 * 分を人間が読める形式に変換
 */
export function formatHealthMinutes(
  totalMinutes: number,
  units: TimeUnits = { min: '分', hour: '時間', day: '日' }
): string {
  const rounded = Math.round(totalMinutes);
  if (rounded < 60) return `${rounded}${units.min}`;
  if (rounded < 1440) {
    const h = Math.floor(rounded / 60);
    const m = rounded % 60;
    if (m === 0) return `${h}${units.hour}`;
    return `${h}${units.hour}${m}${units.min}`;
  }
  const days = Math.floor(rounded / 1440);
  const hours = Math.floor((rounded % 1440) / 60);
  if (hours === 0) return `${days}${units.day}`;
  return `${days}${units.day}${hours}${units.hour}`;
}

/**
 * 金額をフォーマット（V2: JPYのみ）
 */
export function formatCurrency(amount: number, useMan = true): string {
  if (useMan && amount >= 100_000) return `¥${Math.floor(amount / 10000)}万`;
  if (useMan && amount >= 10_000) return `¥${(amount / 10000).toFixed(1)}万`;
  return `¥${Math.round(amount).toLocaleString()}`;
}
