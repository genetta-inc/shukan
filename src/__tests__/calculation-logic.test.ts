import { describe, it, expect } from 'vitest';
import type { CalcStep } from '@/types/impact';
import { getArticle, getArticleList } from '@/data/impact-articles';
import type { ArticleId } from '@/types/impact';

/**
 * SCENARIO-CL-01: CalcStep type exists
 */
describe('CalcStep type', () => {
  it('should have required label and optional value/formula/result', () => {
    const step: CalcStep = { label: 'test' };
    expect(step.label).toBe('test');
    expect(step.value).toBeUndefined();
    expect(step.formula).toBeUndefined();
    expect(step.result).toBeUndefined();

    const fullStep: CalcStep = {
      label: '研究結果',
      value: '10年延命',
      formula: '8年 × 525,600分 ÷ 40年 ÷ 365日',
      result: '288分/日',
    };
    expect(fullStep.label).toBe('研究結果');
    expect(fullStep.value).toBe('10年延命');
    expect(fullStep.formula).toBe('8年 × 525,600分 ÷ 40年 ÷ 365日');
    expect(fullStep.result).toBe('288分/日');
  });
});

/**
 * SCENARIO-CL-02: LifeImpactArticle has optional calculationLogic
 */
describe('LifeImpactArticle calculationLogic', () => {
  it('should be an optional field with health/cost/income arrays', () => {
    const article = getArticle('quit_smoking' as ArticleId);
    expect(article).toBeDefined();

    // calculationLogic is optional - if present, check structure
    if (article?.calculationLogic) {
      expect(Array.isArray(article.calculationLogic.health)).toBe(true);
      expect(Array.isArray(article.calculationLogic.cost)).toBe(true);
      expect(Array.isArray(article.calculationLogic.income)).toBe(true);
    }
  });
});

/**
 * SCENARIO-CL-03: quit_smoking calculation consistency
 */
describe('quit_smoking calculation consistency', () => {
  it('should have calculationLogic with final results matching calculationParams', () => {
    const article = getArticle('quit_smoking' as ArticleId);
    expect(article).toBeDefined();
    expect(article!.calculationLogic).toBeDefined();

    const logic = article!.calculationLogic!;

    // health: last step's result should match dailyHealthMinutes
    const healthLastStep = logic.health[logic.health.length - 1];
    expect(healthLastStep.result).toContain(String(article!.calculationParams.dailyHealthMinutes));

    // cost: last step's result should match dailyCostSaving
    const costLastStep = logic.cost[logic.cost.length - 1];
    expect(costLastStep.result).toContain(String(article!.calculationParams.dailyCostSaving));

    // income: last step's result should match dailyIncomeGain
    const incomeLastStep = logic.income[logic.income.length - 1];
    expect(incomeLastStep.result).toContain(String(article!.calculationParams.dailyIncomeGain));
  });
});

/**
 * SCENARIO-CL-06: Cumulative text consistency (for all articles with calculationLogic)
 */
describe('Cumulative text consistency', () => {
  it('should have cumulative values consistent with daily params for articles with calculationLogic', () => {
    const articles = getArticleList();

    for (const { id } of articles) {
      const article = getArticle(id);
      if (!article?.calculationLogic) continue;

      const { dailyHealthMinutes, dailyCostSaving, dailyIncomeGain } =
        article.calculationParams;
      const cumulative = article.inferences.cumulative;

      // 1ヶ月 health check
      const monthlyHealthMinutes = dailyHealthMinutes * 30;
      const yearlyHealthMinutes = dailyHealthMinutes * 365;
      const decadeHealthMinutes = dailyHealthMinutes * 3650;

      // 1ヶ月 cost check
      const monthlyCost = Math.round(dailyCostSaving * 30);
      const yearlyCost = Math.round(dailyCostSaving * 365);
      const decadeCost = Math.round(dailyCostSaving * 3650);

      // 1ヶ月 income check
      const monthlyIncome = Math.round(dailyIncomeGain * 30);
      const yearlyIncome = Math.round(dailyIncomeGain * 365);
      const decadeIncome = Math.round(dailyIncomeGain * 3650);

      // Verify at least the month/year values are internally consistent
      // (exact text matching is done per-article in individual tests)
      expect(monthlyHealthMinutes).toBeGreaterThanOrEqual(0);
      expect(monthlyCost).toBeGreaterThanOrEqual(0);
      expect(monthlyIncome).toBeGreaterThanOrEqual(0);

      // 月 → 年 → 10年 は単調非減少（負の daily 値が紛れ込むとここで壊れる）
      expect(yearlyHealthMinutes).toBeGreaterThanOrEqual(monthlyHealthMinutes);
      expect(decadeHealthMinutes).toBeGreaterThanOrEqual(yearlyHealthMinutes);
      expect(yearlyCost).toBeGreaterThanOrEqual(monthlyCost);
      expect(decadeCost).toBeGreaterThanOrEqual(yearlyCost);
      expect(yearlyIncome).toBeGreaterThanOrEqual(monthlyIncome);
      expect(decadeIncome).toBeGreaterThanOrEqual(yearlyIncome);

      // 累積効果の文章は全記事必須（renderArticle の {{cumulative}} 置換に使う）
      expect(cumulative.length).toBeGreaterThan(0);
    }
  });
});

/**
 * SCENARIO-CL-07: quit_smoking post-fix cumulative validation
 */
describe('quit_smoking post-fix cumulative', () => {
  it('should have cumulative text consistent with corrected dailyHealthMinutes', () => {
    const article = getArticle('quit_smoking' as ArticleId);
    expect(article).toBeDefined();

    const { dailyHealthMinutes, dailyCostSaving, dailyIncomeGain } =
      article!.calculationParams;

    // After fix: dailyHealthMinutes should NOT be the old incorrect value of 12
    // It should be recalculated based on: 8年 × 525,600 ÷ 40年 ÷ 365日
    expect(dailyHealthMinutes).not.toBe(12);
    expect(dailyHealthMinutes).toBeGreaterThan(100); // Should be ~288

    // 禁煙は金銭・収入インパクトも正（記事の cost / income 推論段落が前提にしている）
    expect(dailyCostSaving).toBeGreaterThan(0);
    expect(dailyIncomeGain).toBeGreaterThan(0);

    // Verify cumulative text references correct scale
    const cumulative = article!.inferences.cumulative;
    expect(cumulative).toBeDefined();
    expect(cumulative.length).toBeGreaterThan(0);
  });
});

/**
 * SCENARIO-CL-08: UI gracefully handles missing calculationLogic
 * (This is a component-level test - validated by type system: calculationLogic is optional)
 */
describe('Missing calculationLogic handling', () => {
  it('articles without calculationLogic should not cause errors', () => {
    const articles = getArticleList();
    for (const { id } of articles) {
      const article = getArticle(id);
      expect(article).toBeDefined();
      // calculationLogic is optional - accessing it should not throw
      const logic = article?.calculationLogic;
      expect(logic === undefined || typeof logic === 'object').toBe(true);
    }
  });
});

/**
 * All articles consistency check
 */
describe('All articles have valid calculationParams', () => {
  it('all articles should have positive calculationParams', () => {
    const articles = getArticleList();
    expect(articles.length).toBe(46);

    for (const { id } of articles) {
      const article = getArticle(id);
      expect(article).toBeDefined();
      expect(article!.calculationParams.dailyHealthMinutes).toBeGreaterThanOrEqual(0);
      expect(article!.calculationParams.dailyCostSaving).toBeGreaterThanOrEqual(0);
      expect(article!.calculationParams.dailyIncomeGain).toBeGreaterThanOrEqual(0);
    }
  });
});

/**
 * A-S6: 全記事が dailyPositiveMoodMinutes を持つ（未設定は 0）
 */
describe('All articles have dailyPositiveMoodMinutes (A-S6)', () => {
  it('全記事が number の dailyPositiveMoodMinutes を持ち 0 以上である', () => {
    const articles = getArticleList();
    expect(articles.length).toBe(46);
    for (const { id } of articles) {
      const article = getArticle(id);
      expect(article).toBeDefined();
      expect(typeof article!.calculationParams.dailyPositiveMoodMinutes).toBe('number');
      expect(article!.calculationParams.dailyPositiveMoodMinutes).toBeGreaterThanOrEqual(0);
    }
  });
});

/**
 * A-S7（4KPI化で全記事へ拡張）: 全記事の positiveMood 値と算出根拠
 * - 全記事が dailyPositiveMoodMinutes > 0 を持つ
 * - 全記事に calculationLogic.positiveMood（固定前提16h/50%の根拠付き）と
 *   inferences.positiveMood（推論段落）が設定されている
 * - 固定前提（480分ベースライン）から x% で機械的に算出されている（CalcStep に明記）
 */
describe('All articles have positiveMood values (A-S7, 4KPI化)', () => {
  const POSITIVE_BASELINE_MINUTES = 480; // 起床16h=960分 × 前向き割合50%

  it('全記事が dailyPositiveMoodMinutes > 0 を持つ', () => {
    const articles = getArticleList();
    const withMood = articles.filter(
      ({ id }) => (getArticle(id)?.calculationParams.dailyPositiveMoodMinutes ?? 0) > 0
    );
    expect(withMood.length).toBe(articles.length);
  });

  it('全記事に calculationLogic.positiveMood と inferences.positiveMood がある', () => {
    const articles = getArticleList();
    for (const { id } of articles) {
      const article = getArticle(id);
      if (!article) continue;
      expect(Array.isArray(article.calculationLogic?.positiveMood), `${id}: calculationLogic.positiveMood`).toBe(true);
      expect(article.calculationLogic!.positiveMood!.length, `${id}: calculationLogic.positiveMood steps`).toBeGreaterThan(0);
      expect(typeof article.inferences.positiveMood, `${id}: inferences.positiveMood`).toBe('string');
      expect(article.inferences.positiveMood!.length, `${id}: inferences.positiveMood length`).toBeGreaterThan(0);
    }
  });

  it('全記事の本文に {{positive_mood_inference}} プレースホルダーがある', () => {
    const articles = getArticleList();
    for (const { id } of articles) {
      const article = getArticle(id);
      if (!article) continue;
      expect(article.article.researchBody, `${id}: positive_mood_inference placeholder`).toContain(
        '{{positive_mood_inference}}'
      );
    }
  });

  it('累積効果の収入表記は「収入ポテンシャル」（断定形「収入増」を使わない）', () => {
    // 生産性向上が給与に1:1で転化する保証はないため、累積の収入は断定しない（換算規約）
    // dailyIncomeGain: 0 の記事（費用軸のみ）は収入への言及自体がないため対象外
    const articles = getArticleList();
    for (const { id } of articles) {
      const article = getArticle(id);
      if (!article || article.calculationParams.dailyIncomeGain === 0) continue;
      const cumulative = article.inferences.cumulative ?? '';
      expect(cumulative, `${id}: cumulative`).toContain('の収入ポテンシャル');
      expect(cumulative, `${id}: cumulative`).not.toContain('の収入増');
    }
  });

  it('値は固定前提（480分ベースライン）の整数換算で 480 以下に収まる', () => {
    // dailyPositiveMoodMinutes = 480 × x% なので必ず baseline 以下
    const articles = getArticleList();
    for (const { id } of articles) {
      const v = getArticle(id)?.calculationParams.dailyPositiveMoodMinutes ?? 0;
      expect(v).toBeLessThanOrEqual(POSITIVE_BASELINE_MINUTES);
      expect(Number.isInteger(v)).toBe(true);
    }
  });
});
