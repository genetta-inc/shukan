import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  calculateDailyImpact,
  calculateImpactSavings,
  calculateMultiEvidenceImpact,
  calculateTotalSavings,
  renderArticle,
  formatHealthMinutes,
  formatCurrency,
} from '@/lib/impact';
import type { HabitEvidence, LifeImpactArticle } from '@/types/impact';
import type { HabitCompletion, HabitWithStats } from '@/types/habit';

// --- Test Fixtures ---

const mockArticleQuitSmoking: LifeImpactArticle = {
  habitCategory: 'quit_smoking',
  habitName: '禁煙',
  article: {
    researchBody: '研究によると{{health_inference}}。コスト面では{{cost_inference}}。収入面では{{income_inference}}。累積では{{cumulative}}。',
    sources: [{ id: 1, text: 'Source 1', url: 'https://example.com' }],
  },
  inferences: {
    health: '寿命が10年延びる',
    cost: '年間20万円の節約',
    income: '生産性が向上する',
    cumulative: '10年で200万円',
  },
  calculationParams: {
    dailyHealthMinutes: 30,
    dailyCostSaving: 550,
    dailyIncomeGain: 200,
    dailyPositiveMoodMinutes: 0, // 未設定（quit_smoking は positiveMood 未設定）
  },
  confidenceLevel: 'high',
  defaultHabitType: 'quit',
  defaultIcon: 'cigarette-off',
};

const mockArticleDailyCardio: LifeImpactArticle = {
  habitCategory: 'daily_cardio',
  habitName: '毎日有酸素運動',
  article: {
    researchBody: '有酸素運動の効果{{health_inference}}',
    sources: [],
  },
  inferences: {
    health: '心疾患リスク低減',
    cost: '医療費削減',
    income: '集中力向上',
    cumulative: '10年で大幅改善',
  },
  calculationParams: {
    dailyHealthMinutes: 45,
    dailyCostSaving: 300,
    dailyIncomeGain: 500,
    dailyPositiveMoodMinutes: 60, // 設定あり（前向きな気持ちの時間 60分/日）
  },
  confidenceLevel: 'high',
  defaultHabitType: 'positive',
  defaultIcon: 'person-standing',
};

function mockGetArticle(id: string): LifeImpactArticle | undefined {
  const articles: Record<string, LifeImpactArticle> = {
    quit_smoking: mockArticleQuitSmoking,
    daily_cardio: mockArticleDailyCardio,
  };
  return articles[id];
}

function makeEvidence(articleId: string, weight: number): HabitEvidence {
  return {
    id: `ev-${articleId}`,
    habitId: 'habit-1',
    articleId: articleId as HabitEvidence['articleId'],
    weight,
  };
}

function makeCompletion(habitId: string, date: string, status: string = 'completed'): HabitCompletion {
  return {
    habitId,
    date,
    completedAt: `${date}T00:00:00.000Z`,
    status: status as HabitCompletion['status'],
  };
}

// --- Tests ---

describe('calculateDailyImpact', () => {
  it('単一エビデンス（weight=100）の場合、記事のパラメータがそのまま返る', () => {
    const evidences = [makeEvidence('quit_smoking', 100)];
    const result = calculateDailyImpact(evidences, mockGetArticle);
    expect(result).toEqual({
      healthMinutes: 30,
      costSaving: 550,
      incomeGain: 200,
      positiveMoodMinutes: 0,
    });
  });

  it('単一エビデンス（weight=50）の場合、パラメータが半分になる', () => {
    const evidences = [makeEvidence('quit_smoking', 50)];
    const result = calculateDailyImpact(evidences, mockGetArticle);
    expect(result).toEqual({
      healthMinutes: 15,
      costSaving: 275,
      incomeGain: 100,
      positiveMoodMinutes: 0,
    });
  });

  // A-S1: 4KPI（positiveMoodMinutes 含む）の重み付き合算
  it('positiveMoodMinutes も重み付きで合算される（A-S1）', () => {
    const evidences = [
      makeEvidence('daily_cardio', 100), // positiveMood 60 → 60
    ];
    const result = calculateDailyImpact(evidences, mockGetArticle);
    expect(result.positiveMoodMinutes).toBe(60);

    const half = calculateDailyImpact([makeEvidence('daily_cardio', 50)], mockGetArticle);
    expect(half.positiveMoodMinutes).toBe(30); // 60 * 0.5
  });

  it('0=未設定記事と設定済み記事の混在で positiveMoodMinutes が正しく合算される（A-S5前提）', () => {
    const evidences = [
      makeEvidence('quit_smoking', 100), // positiveMood 0
      makeEvidence('daily_cardio', 100), // positiveMood 60
    ];
    const result = calculateDailyImpact(evidences, mockGetArticle);
    expect(result.positiveMoodMinutes).toBe(60); // 0 + 60
  });

  it('複数エビデンスの重み付き合算', () => {
    const evidences = [
      makeEvidence('quit_smoking', 100),  // 30, 550, 200
      makeEvidence('daily_cardio', 60),   // 45*0.6=27, 300*0.6=180, 500*0.6=300
    ];
    const result = calculateDailyImpact(evidences, mockGetArticle);
    expect(result.healthMinutes).toBe(57);  // 30 + 27
    expect(result.costSaving).toBe(730);    // 550 + 180
    expect(result.incomeGain).toBe(500);    // 200 + 300
  });

  it('エビデンス0件の場合、全て0', () => {
    const result = calculateDailyImpact([], mockGetArticle);
    expect(result).toEqual({ healthMinutes: 0, costSaving: 0, incomeGain: 0, positiveMoodMinutes: 0 });
  });

  it('存在しないarticleIdはスキップされる', () => {
    const evidences = [
      makeEvidence('quit_smoking', 100),
      makeEvidence('nonexistent' as string, 100),
    ];
    const result = calculateDailyImpact(evidences, mockGetArticle);
    expect(result).toEqual({
      healthMinutes: 30,
      costSaving: 550,
      incomeGain: 200,
      positiveMoodMinutes: 0,
    });
  });
});

describe('calculateImpactSavings', () => {
  it('完了日数に応じた累積インパクトを計算', () => {
    const completions = [
      makeCompletion('habit-1', '2026-03-01'),
      makeCompletion('habit-1', '2026-03-02'),
      makeCompletion('habit-1', '2026-03-03'),
    ];
    const result = calculateImpactSavings('habit-1', completions, mockArticleQuitSmoking);
    expect(result.completedDays).toBe(3);
    expect(result.healthMinutes).toBe(90);   // 3 * 30
    expect(result.costSaving).toBe(1650);    // 3 * 550
    expect(result.incomeGain).toBe(600);     // 3 * 200
    expect(result.positiveMoodMinutes).toBe(0); // 3 * 0（未設定）
  });

  // A-S2: 累積に positiveMoodMinutes が含まれ完了日数で加算される
  it('positiveMoodMinutes が完了日数に応じて累積される（A-S2）', () => {
    const completions = [
      makeCompletion('habit-1', '2026-03-01'),
      makeCompletion('habit-1', '2026-03-02', 'rocket_used'),
      makeCompletion('habit-1', '2026-03-03', 'failed'), // カウントされない
    ];
    const result = calculateImpactSavings('habit-1', completions, mockArticleDailyCardio);
    expect(result.completedDays).toBe(2); // completed + rocket_used のみ
    expect(result.positiveMoodMinutes).toBe(120); // 2 * 60
  });

  it('rocket_usedもcompletedとしてカウントされる', () => {
    const completions = [
      makeCompletion('habit-1', '2026-03-01', 'completed'),
      makeCompletion('habit-1', '2026-03-02', 'rocket_used'),
    ];
    const result = calculateImpactSavings('habit-1', completions, mockArticleQuitSmoking);
    expect(result.completedDays).toBe(2);
  });

  it('failedはカウントされない', () => {
    const completions = [
      makeCompletion('habit-1', '2026-03-01', 'completed'),
      makeCompletion('habit-1', '2026-03-02', 'failed'),
    ];
    const result = calculateImpactSavings('habit-1', completions, mockArticleQuitSmoking);
    expect(result.completedDays).toBe(1);
  });

  it('他の習慣のcompletionは含まれない', () => {
    const completions = [
      makeCompletion('habit-1', '2026-03-01'),
      makeCompletion('habit-2', '2026-03-02'),
    ];
    const result = calculateImpactSavings('habit-1', completions, mockArticleQuitSmoking);
    expect(result.completedDays).toBe(1);
  });
});

describe('calculateMultiEvidenceImpact', () => {
  it('複数エビデンスの重み付き累積インパクト', () => {
    const completions = [
      makeCompletion('habit-1', '2026-03-01'),
      makeCompletion('habit-1', '2026-03-02'),
    ];
    const evidences = [
      makeEvidence('quit_smoking', 100),  // daily: 30, 550, 200
      makeEvidence('daily_cardio', 50),   // daily: 22.5, 150, 250
    ];
    const result = calculateMultiEvidenceImpact('habit-1', completions, evidences, mockGetArticle);
    expect(result.completedDays).toBe(2);
    expect(result.healthMinutes).toBe(2 * (30 + 22.5)); // 105
    expect(result.costSaving).toBe(2 * (550 + 150));     // 1400
    expect(result.incomeGain).toBe(2 * (200 + 250));     // 900
    // quit_smoking positiveMood 0 + daily_cardio 60*0.5=30 → daily 30, ×2日 = 60
    expect(result.positiveMoodMinutes).toBe(2 * (0 + 30)); // 60
  });
});

describe('calculateTotalSavings', () => {
  it('全習慣のインパクトを合算', () => {
    const habits: HabitWithStats[] = [
      { impactSavings: { completedDays: 5, healthMinutes: 100, costSaving: 1000, incomeGain: 500, positiveMoodMinutes: 0 } },
      { impactSavings: { completedDays: 3, healthMinutes: 60, costSaving: 300, incomeGain: 200, positiveMoodMinutes: 0 } },
    ] as HabitWithStats[];

    const result = calculateTotalSavings(habits);
    expect(result.completedDays).toBe(8);
    expect(result.healthMinutes).toBe(160);
    expect(result.costSaving).toBe(1300);
    expect(result.incomeGain).toBe(700);
  });

  it('impactSavingsがない習慣はスキップ', () => {
    const habits: HabitWithStats[] = [
      { impactSavings: { completedDays: 5, healthMinutes: 100, costSaving: 1000, incomeGain: 500, positiveMoodMinutes: 0 } },
      {} as HabitWithStats,  // no impactSavings
    ] as HabitWithStats[];

    const result = calculateTotalSavings(habits);
    expect(result.completedDays).toBe(5);
  });

  // A-S5: positiveMoodMinutes の総和（値あり・なし混在、0=未設定のみの習慣の寄与は0）
  it('各習慣の positiveMoodMinutes を総和する（値あり・なし混在）（A-S5）', () => {
    const habits: HabitWithStats[] = [
      { impactSavings: { completedDays: 5, healthMinutes: 100, costSaving: 1000, incomeGain: 500, positiveMoodMinutes: 300 } },
      { impactSavings: { completedDays: 3, healthMinutes: 60, costSaving: 300, incomeGain: 200, positiveMoodMinutes: 0 } }, // 未設定のみ
      { impactSavings: { completedDays: 2, healthMinutes: 40, costSaving: 200, incomeGain: 100, positiveMoodMinutes: 120 } },
    ] as HabitWithStats[];

    const result = calculateTotalSavings(habits);
    expect(result.positiveMoodMinutes).toBe(420); // 300 + 0 + 120
  });

  it('0=未設定記事のみの習慣でも positiveMoodMinutes は 0 でエラーにならない（A-S5）', () => {
    const habits: HabitWithStats[] = [
      { impactSavings: { completedDays: 4, healthMinutes: 80, costSaving: 400, incomeGain: 300, positiveMoodMinutes: 0 } },
    ] as HabitWithStats[];

    const result = calculateTotalSavings(habits);
    expect(result.positiveMoodMinutes).toBe(0);
  });
});

describe('renderArticle', () => {
  it('プレースホルダーをinferencesで置換する', () => {
    const result = renderArticle(mockArticleQuitSmoking);
    expect(result).toContain('寿命が10年延びる');
    expect(result).toContain('年間20万円の節約');
    expect(result).toContain('生産性が向上する');
    expect(result).toContain('10年で200万円');
    expect(result).not.toContain('{{');
  });

  it('未知のプレースホルダーはそのまま残る', () => {
    const article: LifeImpactArticle = {
      ...mockArticleQuitSmoking,
      article: {
        ...mockArticleQuitSmoking.article,
        researchBody: '{{unknown_key}}は不明',
      },
    };
    const result = renderArticle(article);
    expect(result).toContain('{{unknown_key}}');
  });

  // 4KPI化: inferences.positiveMood 設定時は {{positive_mood_inference}} が置換される
  it('positiveMood 設定時は positive_mood_inference プレースホルダーが置換される', () => {
    const articleWithMood: LifeImpactArticle = {
      ...mockArticleQuitSmoking,
      inferences: {
        ...mockArticleQuitSmoking.inferences,
        positiveMood: 'これは前向きな気持ちの推論段落',
      },
      calculationParams: {
        ...mockArticleQuitSmoking.calculationParams,
        dailyPositiveMoodMinutes: 240,
      },
      article: {
        ...mockArticleQuitSmoking.article,
        researchBody:
          '{{health_inference}}/{{cost_inference}}/{{income_inference}}/{{cumulative}}/{{positive_mood_inference}}',
      },
    };
    const result = renderArticle(articleWithMood);
    // 既存4プレースホルダーは従来どおり置換される
    expect(result).toContain('寿命が10年延びる');
    expect(result).toContain('年間20万円の節約');
    expect(result).toContain('生産性が向上する');
    expect(result).toContain('10年で200万円');
    // positiveMood の推論段落が挿入される
    expect(result).toContain('これは前向きな気持ちの推論段落');
    expect(result).not.toContain('{{positive_mood_inference}}');
  });

  // inferences.positiveMood 未設定（フィクスチャ等）ではプレースホルダーが残り、設定漏れに気付ける
  it('positiveMood 未設定時は positive_mood_inference プレースホルダーが残る', () => {
    const article: LifeImpactArticle = {
      ...mockArticleQuitSmoking,
      article: {
        ...mockArticleQuitSmoking.article,
        researchBody: '{{health_inference}}/{{positive_mood_inference}}',
      },
    };
    const result = renderArticle(article);
    expect(result).toContain('寿命が10年延びる');
    expect(result).toContain('{{positive_mood_inference}}');
  });
});

describe('formatHealthMinutes', () => {
  it('60分未満は「X分」', () => {
    expect(formatHealthMinutes(30)).toBe('30分');
    expect(formatHealthMinutes(0)).toBe('0分');
    expect(formatHealthMinutes(59)).toBe('59分');
  });

  it('60分以上は「X時間Y分」', () => {
    expect(formatHealthMinutes(60)).toBe('1時間');
    expect(formatHealthMinutes(90)).toBe('1時間30分');
    expect(formatHealthMinutes(150)).toBe('2時間30分');
  });

  it('1440分以上は「X日Y時間」', () => {
    expect(formatHealthMinutes(1440)).toBe('1日');
    expect(formatHealthMinutes(1500)).toBe('1日1時間');
    expect(formatHealthMinutes(2880)).toBe('2日');
  });

  it('小数は四捨五入される', () => {
    expect(formatHealthMinutes(30.4)).toBe('30分');
    expect(formatHealthMinutes(30.6)).toBe('31分');
  });

  it('カスタム単位', () => {
    const units = { min: 'min', hour: 'hr', day: 'd' };
    expect(formatHealthMinutes(90, units)).toBe('1hr30min');
  });
});

describe('formatCurrency', () => {
  it('10万以上は「¥X万」', () => {
    expect(formatCurrency(100000)).toBe('¥10万');
    expect(formatCurrency(500000)).toBe('¥50万');
  });

  it('1万-10万は「¥X.X万」', () => {
    expect(formatCurrency(15000)).toBe('¥1.5万');
    expect(formatCurrency(10000)).toBe('¥1.0万');
  });

  it('1万未満は「¥X,XXX」', () => {
    expect(formatCurrency(5000)).toBe('¥5,000');
    expect(formatCurrency(550)).toBe('¥550');
  });

  it('useMan=falseでは万表記しない', () => {
    expect(formatCurrency(100000, false)).toBe('¥100,000');
  });

  it('useMan=falseで大きな金額も具体的数字', () => {
    expect(formatCurrency(547500, false)).toBe('¥547,500');
    expect(formatCurrency(1712000, false)).toBe('¥1,712,000');
  });

  it('useMan=falseで1万未満は同じ結果', () => {
    expect(formatCurrency(5000, false)).toBe('¥5,000');
    expect(formatCurrency(550, false)).toBe('¥550');
  });
});

describe('Daily impact aggregation for DailyImpactSummary', () => {
  it('複数習慣のデイリーインパクト合計を正しく算出', () => {
    // Simulate: 3 habits, 2 with evidences, 1 without
    const ev1 = [makeEvidence('quit_smoking', 100)]; // 30min, ¥550, ¥200
    const ev2 = [makeEvidence('daily_cardio', 100)]; // 45min, ¥300, ¥500

    const daily1 = calculateDailyImpact(ev1, mockGetArticle);
    const daily2 = calculateDailyImpact(ev2, mockGetArticle);

    // Total = sum of all habits with evidences
    const totalHealth = daily1.healthMinutes + daily2.healthMinutes;
    const totalCost = daily1.costSaving + daily2.costSaving;
    const totalIncome = daily1.incomeGain + daily2.incomeGain;

    expect(totalHealth).toBe(75);   // 30 + 45
    expect(totalCost).toBe(850);    // 550 + 300
    expect(totalIncome).toBe(700);  // 200 + 500
    // positiveMood: quit_smoking 0 + daily_cardio 60
    const totalMood = daily1.positiveMoodMinutes + daily2.positiveMoodMinutes;
    expect(totalMood).toBe(60);

    // Earned = only completed habits (simulate habit1 completed, habit2 not)
    const earnedHealth = daily1.healthMinutes;
    const earnedCost = daily1.costSaving;
    const earnedIncome = daily1.incomeGain;

    expect(earnedHealth).toBe(30);
    expect(earnedCost).toBe(550);
    expect(earnedIncome).toBe(200);
  });
});

// ───────── F10: DailyImpactSummary は4軸目（前向きな気持ちの時間）を常時表示 ─────────
describe('DailyImpactSummary の4軸目常時表示（F10）', () => {
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const src = readFileSync(
    resolve(projectRoot, 'src/components/habits/daily-impact-summary.tsx'),
    'utf-8'
  );

  it('前向きな気持ちの時間（dailyPositiveMood）を描画する', () => {
    expect(src).toContain('dailyPositiveMood');
  });

  it('positiveMoodMinutes > 0 の表示ガードを持たない（値0でも常時表示）', () => {
    // 今日・5日間いずれの mood 軸も `... positiveMoodMinutes > 0 &&` で条件描画しない。
    expect(src).not.toContain('positiveMoodMinutes > 0');
  });
});

// ───────── F16: ImpactBadge（習慣カード展開／習慣詳細）も4軸目を常時表示 ─────────
describe('ImpactBadge の4軸目常時表示（F16）', () => {
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const src = readFileSync(
    resolve(projectRoot, 'src/components/habits/impact-badge.tsx'),
    'utf-8'
  );

  it('前向きな気持ちの時間（dailyPositiveMood）を描画する', () => {
    expect(src).toContain('dailyPositiveMood');
  });

  it('positiveMoodMinutes > 0 の表示ガードを持たない（値0でも4軸目を常時表示）', () => {
    expect(src).not.toContain('positiveMoodMinutes > 0');
  });
});
