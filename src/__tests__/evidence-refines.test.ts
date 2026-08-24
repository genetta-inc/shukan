// issue #92: エビデンス記事間の関係モデル（refines）と効果計算の同系統重複排除
//
// #34 の articleId 単位 de-dup では防げない「詳細化記事（別 articleId）と粗い記事の
// 二重計上」を、refines チェーンの系統 de-dup（祖先を落として詳細側のみ計上）で塞ぐ。
//   - 計算側: src/lib/impact.ts の dedupeByLineage / calculateDedupedDailyImpact
//   - 検証側: src/lib/evidence/validate.ts の checkRefinesIntegrity（参照先存在・循環・軸乖離）

import { describe, it, expect } from 'vitest';
import {
  calculateDailyImpact,
  calculateDedupedDailyImpact,
  dedupeByLineage,
} from '@/lib/impact';
import { checkRefinesIntegrity, validateEvidence } from '@/lib/evidence/validate';
import type { RefinesCheckArticle } from '@/lib/evidence/validate';
import type { HabitEvidence, LifeImpactArticle } from '@/types/impact';

// --- フィクスチャ: daily_cardio（親）← hiit / jogging（兄弟）← sprint_intervals（孫） ---

function makeArticle(
  id: string,
  params: { health: number; cost: number; income: number; mood: number },
  refines?: string
): LifeImpactArticle {
  return {
    habitCategory: id,
    habitName: id,
    refines,
    article: { researchBody: 'x', sources: [] },
    inferences: { health: 'h', cost: 'c', income: 'i', cumulative: 'm' },
    calculationParams: {
      dailyHealthMinutes: params.health,
      dailyCostSaving: params.cost,
      dailyIncomeGain: params.income,
      dailyPositiveMoodMinutes: params.mood,
    },
    confidenceLevel: 'high',
    defaultHabitType: 'positive',
    defaultIcon: 'person-standing',
  };
}

const mockArticles: Record<string, LifeImpactArticle> = {
  daily_cardio: makeArticle('daily_cardio', { health: 45, cost: 300, income: 500, mood: 60 }),
  hiit: makeArticle('hiit', { health: 60, cost: 300, income: 500, mood: 80 }, 'daily_cardio'),
  jogging: makeArticle('jogging', { health: 50, cost: 200, income: 100, mood: 40 }, 'daily_cardio'),
  sprint_intervals: makeArticle(
    'sprint_intervals',
    { health: 70, cost: 300, income: 500, mood: 90 },
    'hiit'
  ),
  quit_smoking: makeArticle('quit_smoking', { health: 30, cost: 550, income: 200, mood: 0 }),
};

function mockGetArticle(id: string): LifeImpactArticle | undefined {
  return mockArticles[id];
}

const getRefines = (id: string) => mockArticles[id]?.refines;

function ev(habitId: string, articleId: string, weight: number): HabitEvidence {
  return {
    id: `ev-${habitId}-${articleId}`,
    habitId,
    articleId: articleId as HabitEvidence['articleId'],
    weight,
  };
}

const aid = (id: string) => id as HabitEvidence['articleId'];

// --- 系統 de-dup の純粋関数 ---

describe('dedupeByLineage（issue #92: 系統 de-dup）', () => {
  it('祖先と子孫が両方あれば祖先（粗い側）を落とし、詳細側のみ残す', () => {
    const out = dedupeByLineage(
      [{ articleId: aid('daily_cardio') }, { articleId: aid('hiit') }],
      getRefines
    );
    expect(out.map((e) => e.articleId)).toEqual(['hiit']);
  });

  it('兄弟（同じ親を refines する2記事）は両方残す', () => {
    const out = dedupeByLineage(
      [{ articleId: aid('hiit') }, { articleId: aid('jogging') }],
      getRefines
    );
    expect(out.map((e) => e.articleId)).toEqual(['hiit', 'jogging']);
  });

  it('2段チェーン（孫・子・親が全て存在）では孫のみ残す', () => {
    const out = dedupeByLineage(
      [
        { articleId: aid('daily_cardio') },
        { articleId: aid('hiit') },
        { articleId: aid('sprint_intervals') },
      ],
      getRefines
    );
    expect(out.map((e) => e.articleId)).toEqual(['sprint_intervals']);
  });

  it('親が集合に無ければ何も落とさない（推移的な祖先も集合に無い限り無関係）', () => {
    const out = dedupeByLineage(
      [{ articleId: aid('sprint_intervals') }, { articleId: aid('quit_smoking') }],
      getRefines
    );
    expect(out.map((e) => e.articleId)).toEqual(['sprint_intervals', 'quit_smoking']);
  });

  it('祖先を落とした後も兄弟は両方計上される（hiit + jogging + daily_cardio 同時紐付け）', () => {
    const out = dedupeByLineage(
      [
        { articleId: aid('daily_cardio') },
        { articleId: aid('hiit') },
        { articleId: aid('jogging') },
      ],
      getRefines
    );
    expect(out.map((e) => e.articleId)).toEqual(['hiit', 'jogging']);
  });

  it('refines が循環していても無限ループしない（防御。正しさは validate が error で担保）', () => {
    const cycleMap: Record<string, string | undefined> = { a: 'b', b: 'a' };
    const cyc = (id: string) => cycleMap[id];
    const out = dedupeByLineage(
      [{ articleId: aid('a') }, { articleId: aid('b') }],
      cyc
    );
    // 互いに祖先扱いになり両方落ちるが、ハングしないことがこのテストの主眼。
    expect(out.length).toBeLessThanOrEqual(2);
  });
});

// --- ホーム集計への組込み（#34 の articleId de-dup → #92 の系統 de-dup の順） ---

describe('calculateDedupedDailyImpact への系統 de-dup 組込み（issue #92 受け入れ条件）', () => {
  it('refines 祖先（daily_cardio）と子孫（hiit）を同時に紐付けても効果値は詳細側のみで計算される', () => {
    const habitA = [ev('habit-a', 'daily_cardio', 100)];
    const habitB = [ev('habit-b', 'hiit', 100)];

    const deduped = calculateDedupedDailyImpact([habitA, habitB], mockGetArticle);
    const hiitOnly = calculateDailyImpact(habitB, mockGetArticle);
    const naiveSum = calculateDailyImpact([...habitA, ...habitB], mockGetArticle);

    expect(deduped).toEqual(hiitOnly);
    expect(deduped.healthMinutes).toBeLessThan(naiveSum.healthMinutes);
  });

  it('兄弟（hiit + jogging）は両方計上される', () => {
    const deduped = calculateDedupedDailyImpact(
      [[ev('habit-a', 'hiit', 100)], [ev('habit-b', 'jogging', 100)]],
      mockGetArticle
    );
    // 60+50=110分, 300+200=500円, 500+100=600円, 80+40=120分
    expect(deduped).toEqual({
      healthMinutes: 110,
      costSaving: 500,
      incomeGain: 600,
      positiveMoodMinutes: 120,
    });
  });

  it('祖先も同時に紐付いた兄弟ケース（hiit + jogging + daily_cardio）は祖先だけ落ちる', () => {
    const deduped = calculateDedupedDailyImpact(
      [
        [ev('habit-a', 'hiit', 100)],
        [ev('habit-b', 'jogging', 100)],
        [ev('habit-c', 'daily_cardio', 100)],
      ],
      mockGetArticle
    );
    const siblingsOnly = calculateDedupedDailyImpact(
      [[ev('habit-a', 'hiit', 100)], [ev('habit-b', 'jogging', 100)]],
      mockGetArticle
    );
    expect(deduped).toEqual(siblingsOnly);
  });

  it('2段チェーン（sprint_intervals + hiit + daily_cardio）は孫のみ計上される', () => {
    const deduped = calculateDedupedDailyImpact(
      [
        [ev('habit-a', 'daily_cardio', 100)],
        [ev('habit-b', 'hiit', 100)],
        [ev('habit-c', 'sprint_intervals', 100)],
      ],
      mockGetArticle
    );
    expect(deduped).toEqual(
      calculateDailyImpact([ev('habit-c', 'sprint_intervals', 100)], mockGetArticle)
    );
  });

  it('#34 の articleId de-dup（最大ウェイト採用）は系統 de-dup の前段で従来どおり効く', () => {
    const deduped = calculateDedupedDailyImpact(
      [
        [ev('habit-a', 'hiit', 60)],
        [ev('habit-b', 'hiit', 100)],
        [ev('habit-c', 'daily_cardio', 100)],
      ],
      mockGetArticle
    );
    expect(deduped).toEqual(calculateDailyImpact([ev('habit-b', 'hiit', 100)], mockGetArticle));
  });

  it('refines を持たない記事同士は従来どおり合算される（デグレなし）', () => {
    const deduped = calculateDedupedDailyImpact(
      [[ev('habit-a', 'quit_smoking', 100)], [ev('habit-b', 'daily_cardio', 100)]],
      mockGetArticle
    );
    expect(deduped).toEqual(
      calculateDailyImpact(
        [ev('habit-a', 'quit_smoking', 100), ev('habit-b', 'daily_cardio', 100)],
        mockGetArticle
      )
    );
  });
});

// --- validate:evidence の refines チェック ---

function fixture(
  params: { health: number; cost: number; income: number },
  refines?: string
): RefinesCheckArticle {
  return {
    refines,
    calculationParams: {
      dailyHealthMinutes: params.health,
      dailyCostSaving: params.cost,
      dailyIncomeGain: params.income,
      dailyPositiveMoodMinutes: 0,
    },
  };
}

describe('checkRefinesIntegrity（issue #92: refines の整合チェック）', () => {
  it('存在しない refines 参照を error で弾く', () => {
    const findings = checkRefinesIntegrity({
      hiit: fixture({ health: 60, cost: 300, income: 500 }, 'no_such_article'),
    });
    expect(findings.some((f) => f.level === 'error' && f.code === 'refines-unknown')).toBe(true);
  });

  it('循環参照（a → b → a）を error で弾く', () => {
    const findings = checkRefinesIntegrity({
      a: fixture({ health: 10, cost: 0, income: 0 }, 'b'),
      b: fixture({ health: 10, cost: 0, income: 0 }, 'a'),
    });
    expect(findings.some((f) => f.level === 'error' && f.code === 'refines-cycle')).toBe(true);
  });

  it('自己参照も循環として error で弾く', () => {
    const findings = checkRefinesIntegrity({
      a: fixture({ health: 10, cost: 0, income: 0 }, 'a'),
    });
    expect(findings.some((f) => f.level === 'error' && f.code === 'refines-cycle')).toBe(true);
  });

  it('親子で health/cost/income の非ゼロ軸が乖離していたら warning を出す', () => {
    const findings = checkRefinesIntegrity({
      daily_cardio: fixture({ health: 45, cost: 300, income: 500 }),
      // 子は health のみ非ゼロ → 親の [health, cost, income] と乖離
      hiit: fixture({ health: 60, cost: 0, income: 0 }, 'daily_cardio'),
    });
    const w = findings.filter((f) => f.code === 'refines-axis-mismatch');
    expect(w).toHaveLength(1);
    expect(w[0].level).toBe('warning');
    expect(w[0].article).toBe('hiit');
  });

  it('親子で非ゼロ軸が一致していれば warning を出さない（正常な詳細化）', () => {
    const findings = checkRefinesIntegrity({
      daily_cardio: fixture({ health: 45, cost: 300, income: 500 }),
      hiit: fixture({ health: 60, cost: 300, income: 500 }, 'daily_cardio'),
    });
    expect(findings).toEqual([]);
  });

  it('refines を持たない記事だけなら findings なし', () => {
    const findings = checkRefinesIntegrity({
      daily_cardio: fixture({ health: 45, cost: 300, income: 500 }),
      quit_smoking: fixture({ health: 30, cost: 550, income: 200 }),
    });
    expect(findings).toEqual([]);
  });
});

describe('現行コーパスの refines 整合（validateEvidence 経由）', () => {
  it('既存39記事は refines なし（フラット）のため refines-* の findings が無い', () => {
    const refinesFindings = validateEvidence().filter((f) => f.code.startsWith('refines-'));
    expect(refinesFindings).toEqual([]);
  });
});
