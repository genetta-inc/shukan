import { describe, it, expect } from 'vitest';
import { KPI_CATALOG, KPI_KEYS, getKpi } from '@/data/kpi/catalog';
import type { KpiKey } from '@/data/kpi/catalog';
import { HABIT_PRESETS, getPresetsForKpi } from '@/data/habit-presets';
import { getLifeExpectancy, LIFE_EXPECTANCY_TABLE } from '@/data/life-expectancy';
import { getAverageIncome, AVERAGE_INCOME_TABLE } from '@/data/average-income';
import { isValidArticleId } from '@/data/impact-articles';

/**
 * A-S9: KPI定義カタログ4件（確定文言）
 */
describe('KPI catalog (A-S9)', () => {
  it('4件の KPI 定義がある', () => {
    expect(KPI_CATALOG.length).toBe(4);
    expect(KPI_KEYS).toEqual(['health_lifespan', 'positive_mood', 'cost_saving', 'earning']);
  });

  it('health_lifespan: 健康寿命 / 分 / 長く健康でいられる自分へ', () => {
    const k = getKpi('health_lifespan');
    expect(k).toBeDefined();
    expect(k!.name).toBe('健康寿命');
    expect(k!.unit).toBe('分');
    expect(k!.headline).toBe('長く健康でいられる自分へ');
    expect(k!.kind).toBe('time_quantity');
    expect(k!.description).toBe('習慣の積み重ねが健康寿命を何分延ばすかを記録します');
  });

  it('positive_mood: 前向きな気持ちの時間 / 分 / 前向きな気持ちで過ごせる自分へ', () => {
    const k = getKpi('positive_mood');
    expect(k).toBeDefined();
    expect(k!.name).toBe('前向きな気持ちの時間');
    expect(k!.unit).toBe('分');
    expect(k!.headline).toBe('前向きな気持ちで過ごせる自分へ');
    expect(k!.kind).toBe('time_quality');
    expect(k!.description).toBe('前向きでいられる時間が何分増えるかを記録します');
  });

  it('cost_saving: 出費削減 / 円 / お金で諦めない自分へ', () => {
    const k = getKpi('cost_saving');
    expect(k).toBeDefined();
    expect(k!.name).toBe('出費削減');
    expect(k!.unit).toBe('円');
    expect(k!.headline).toBe('お金で諦めない自分へ');
    expect(k!.kind).toBe('money_out');
    expect(k!.description).toBe('生涯の出費をいくら（円）減らせるかを記録します');
  });

  it('earning: 増える収入 / 円 / 稼ぐ力のある自分へ', () => {
    const k = getKpi('earning');
    expect(k).toBeDefined();
    expect(k!.name).toBe('増える収入');
    expect(k!.unit).toBe('円');
    expect(k!.headline).toBe('稼ぐ力のある自分へ');
    expect(k!.kind).toBe('money_in');
    expect(k!.description).toBe('生涯で増える収入がいくら（円）上がるかを記録します');
  });

  it('全定義に icon がある', () => {
    for (const def of KPI_CATALOG) {
      expect(typeof def.icon).toBe('string');
      expect(def.icon.length).toBeGreaterThan(0);
    }
  });

  it('getKpi は未知キーで undefined を返す', () => {
    expect(getKpi('unknown' as KpiKey)).toBeUndefined();
    expect(getKpi('' as KpiKey)).toBeUndefined();
  });
});

/**
 * A-S10: 習慣プリセット（各KPI 3個以上・参照妥当性）
 *
 * オンボーディング v3 確定リストで health_lifespan / positive_mood の
 * プリセットを拡充したため、旧「各 KPI 3〜5 個」の上限（5）は撤廃。
 * 各 KPI に最低 3 個という下限のみを不変条件として維持する。
 */
describe('Habit presets (A-S10)', () => {
  it('各 KPI に primaryKpis を含むプリセットが 3 個以上ある', () => {
    for (const key of KPI_KEYS) {
      const presets = getPresetsForKpi(key);
      expect(presets.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('全プリセットの articleIds は登録済み35記事のID（空配列なし）', () => {
    expect(HABIT_PRESETS.length).toBeGreaterThan(0);
    for (const preset of HABIT_PRESETS) {
      expect(preset.articleIds.length).toBeGreaterThan(0);
      for (const id of preset.articleIds) {
        expect(isValidArticleId(id)).toBe(true);
      }
    }
  });

  it('全プリセットの primaryKpis は 4 つの KpiKey のいずれか（空配列なし）', () => {
    for (const preset of HABIT_PRESETS) {
      expect(preset.primaryKpis.length).toBeGreaterThan(0);
      for (const kpi of preset.primaryKpis) {
        expect(KPI_KEYS).toContain(kpi);
      }
    }
  });

  it('各プリセットは id / name / defaultHabitType / icon を持つ', () => {
    const ids = new Set<string>();
    for (const preset of HABIT_PRESETS) {
      expect(typeof preset.id).toBe('string');
      expect(preset.id.length).toBeGreaterThan(0);
      expect(ids.has(preset.id)).toBe(false); // id は一意
      ids.add(preset.id);
      expect(typeof preset.name).toBe('string');
      expect(['positive', 'quit']).toContain(preset.defaultHabitType);
      expect(typeof preset.icon).toBe('string');
    }
  });
});

/**
 * A-S11: 平均余命表・平均年収表の引き当てとフォールバック
 */
describe('Life expectancy table (A-S11)', () => {
  it('40〜44ブラケット×男性の値が返る（42, male）', () => {
    const v = getLifeExpectancy(42, 'male');
    expect(typeof v).toBe('number');
    expect(v).toBeGreaterThan(0);
    // 40-44 male ブラケットの値と一致
    const bracket = LIFE_EXPECTANCY_TABLE.find((b) => 42 >= b.ageMin && 42 <= b.ageMax);
    expect(bracket).toBeDefined();
    expect(v).toBe(bracket!.male);
  });

  it('範囲外の年齢は最近傍ブラケットにフォールバック（エラーなし）', () => {
    const tooYoung = getLifeExpectancy(0, 'male');
    const tooOld = getLifeExpectancy(200, 'male');
    expect(typeof tooYoung).toBe('number');
    expect(typeof tooOld).toBe('number');
    expect(Number.isNaN(tooYoung)).toBe(false);
    expect(Number.isNaN(tooOld)).toBe(false);
  });

  it('gender other / unspecified は男女平均にフォールバック', () => {
    const other = getLifeExpectancy(42, 'other');
    const unspecified = getLifeExpectancy(42, 'unspecified');
    const male = getLifeExpectancy(42, 'male');
    const female = getLifeExpectancy(42, 'female');
    expect(other).toBe((male + female) / 2);
    expect(unspecified).toBe((male + female) / 2);
  });
});

describe('Average income table (A-S11)', () => {
  it('40〜44ブラケット×男性の値が返る（42, male）', () => {
    const v = getAverageIncome(42, 'male');
    expect(typeof v).toBe('number');
    expect(v).toBeGreaterThan(0);
    const bracket = AVERAGE_INCOME_TABLE.find((b) => 42 >= b.ageMin && 42 <= b.ageMax);
    expect(bracket).toBeDefined();
    expect(v).toBe(bracket!.male);
  });

  it('範囲外の年齢は最近傍ブラケットにフォールバック', () => {
    expect(Number.isNaN(getAverageIncome(0, 'female'))).toBe(false);
    expect(Number.isNaN(getAverageIncome(200, 'female'))).toBe(false);
    expect(getAverageIncome(0, 'female')).toBeGreaterThan(0);
  });

  it('gender other / unspecified は男女平均にフォールバック、NaN にならない', () => {
    const other = getAverageIncome(42, 'other');
    const male = getAverageIncome(42, 'male');
    const female = getAverageIncome(42, 'female');
    expect(other).toBe((male + female) / 2);
    expect(Number.isNaN(other)).toBe(false);
  });
});
