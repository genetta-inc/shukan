// オンボーディング v3「段階タップ診断」の判断ロジック・完了時書き込み（純粋関数中心）。
//
// UI（src/components/onboarding/*）はこのモジュールの関数を使うだけにし、レンダリングと
// ロジックを分離する。これにより node 環境の Vitest で state 遷移・バリデーション・
// 達成率記録・書き込み変換を単体検証できる。
//
// v3 の要点（plan.md change-C + 完了フロー刷新・ユーザーフィードバック 2026-07-02）:
//   - 画面は [0]イントロ [1]プロフィール [2]段階タップ診断 [3]計算中 [4]結果
//     [5]KPI選択 [6]習慣選択 の7つ。
//   - [2] は精査済み15習慣のみを 1画面1習慣・4択（0/0.3/0.7/1）で提示し、達成率を記録する。
//   - 達成率は DB に永続化しない（イメージ喚起用の UI・plan スコープ確定）。WizardState 内のみ。
//   - [5] で「人生で何を充実させたいか」を 4KPI から1つ選び、[6] でその KPI に
//     伸びしろ（未達成分 × インパクト）の大きい習慣トップ5から取り組むものをチェックする。
//     達成率→status の自動変換は廃止し、チェックした習慣だけを一律 status='active' で登録する
//     （習慣化済み扱いは日々の実行ログの実績から。100% の習慣は伸びしろゼロのため候補に出さない）。
//   - trackedKpis は完了時に全 KpiKey を保存（v2 と同じ D5。[5] の選択は候補絞り込み専用の UI）。
//   - 過去累積（established_since ベース）・セクションA/B・「いつから」入力は v3 で廃止。

import type { HabitInsertInput } from '@/types/habit';
import type { KpiKey } from '@/data/kpi/catalog';
import { getKpi, KPI_KEYS } from '@/data/kpi/catalog';
import { getHabitPreset, type HabitPreset } from '@/data/habit-presets';
import { getArticle } from '@/data/impact-articles';
import type { LifeImpactArticle } from '@/types/impact';
import type { ProfileGender, UserProfile } from '@/lib/supabase/profiles';
import { upsertUserProfile } from '@/lib/supabase/profiles';
import { insertHabit, replaceHabitEvidences } from '@/lib/supabase/habits';
import type { AchievementRate, HabitSelection } from '@/lib/diagnosis-v3';

// 性別の選択肢（DB の CHECK 制約と一致。UI では male/female/other を提示）
export type OnboardingGender = 'male' | 'female' | 'other';

export interface OnboardingProfileInput {
  age: number | null;
  gender: OnboardingGender | null;
  country: string;
  annualIncome: number | null;
}

/** 画面ステップ（[0]イントロ 〜 [4]結果 → [5]KPI選択 → [6]習慣選択）。 */
export type OnboardingStep = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface WizardState {
  step: OnboardingStep;
  profile: OnboardingProfileInput;
  /** presetId → 達成率（0/0.3/0.7/1）。未回答のプリセットはキーを持たない。 */
  rates: Record<string, AchievementRate>;
  /** [2] で現在表示中の習慣インデックス（0-based・ONBOARDING_V3_PRESET_IDS 上の位置）。 */
  habitIndex: number;
  /** [2] タップ後の余韻（次の習慣へ遷移中）。true の間はタップ・戻るを受け付けない（連打スキップ防止）。 */
  advancing: boolean;
  /** [5] で選んだ「充実させたい」KPI。候補絞り込み専用（DB には保存しない）。 */
  focusKpi: KpiKey | null;
  /** [6] でチェックした「取り組む」プリセットID。登録は一律 status='active'。 */
  chosenPresetIds: string[];
}

// バリデーション定数
export const MIN_AGE = 1;
export const MAX_AGE = 120;
export const DEFAULT_CURRENCY = 'JPY';

/** 初期状態。永続化しないため、リロード/再アクセス時はこの初期状態（[0]）に戻る。 */
export function createInitialWizardState(): WizardState {
  return {
    step: 0,
    profile: { age: null, gender: null, country: 'JP', annualIncome: null },
    rates: {},
    habitIndex: 0,
    advancing: false,
    focusKpi: null,
    chosenPresetIds: [],
  };
}

// ───────── [1] プロフィール ─────────

export interface ProfileErrors {
  age?: string;
  gender?: string;
  country?: string;
  annualIncome?: string;
}

/** フィールド別バリデーション（C-S9）。エラーがなければ各キーは undefined。 */
export function validateProfileInput(input: OnboardingProfileInput): ProfileErrors {
  const errors: ProfileErrors = {};

  if (
    input.age === null ||
    !Number.isFinite(input.age) ||
    !Number.isInteger(input.age) ||
    input.age < MIN_AGE ||
    input.age > MAX_AGE
  ) {
    errors.age = 'invalid';
  }

  if (input.gender !== 'male' && input.gender !== 'female' && input.gender !== 'other') {
    errors.gender = 'required';
  }

  if (!input.country || input.country.trim() === '') {
    errors.country = 'required';
  }

  if (
    input.annualIncome !== null &&
    (!Number.isFinite(input.annualIncome) || input.annualIncome < 0)
  ) {
    errors.annualIncome = 'invalid';
  }

  return errors;
}

/** 必須が揃い不正値がなければ次へ進める（年収空欄でも可・C-S9）。 */
export function canAdvanceFromProfile(input: OnboardingProfileInput): boolean {
  return Object.keys(validateProfileInput(input)).length === 0;
}

// ───────── [2] 段階タップ診断（精査済み15習慣） ─────────

/**
 * オンボーディング [2] に出す精査済み15習慣（明示リスト・表示順）。
 * 残置7プリセット（daily_saving_habit / stop_impulse_buying / cook_at_home /
 * deep_focus_work / morning_routine / cut_digital_distraction / keep_learning）は
 * v3 診断には出さない（この配列に含めないことで保証する）。
 * 並びはプロト（onboarding-step2-proto.html）に準拠（健康→前向き→出費削減）。
 */
export const ONBOARDING_V3_PRESET_IDS: readonly string[] = [
  'daily_cardio_habit',
  'solid_sleep',
  'eat_vegetables_habit',
  'drink_water_habit',
  'quit_sugar_habit',
  'quit_junk_food_habit',
  'daily_strength_habit',
  'fermented_food_habit',
  'quit_smoking_for_health',
  'daily_meditation_habit',
  'daily_journaling_habit',
  'time_in_nature_habit',
  'social_connection_habit',
  'morning_light_habit',
  'quit_alcohol_habit',
] as const;

/** [2] に提示する15プリセット（HabitPreset）を表示順で返す。未知IDは除外（安全側）。 */
export function onboardingV3Presets(): HabitPreset[] {
  return ONBOARDING_V3_PRESET_IDS.map((id) => getHabitPreset(id)).filter(
    (p): p is HabitPreset => p !== undefined
  );
}

/** [2] の全プリセット（互換名。v3 では精査済み15本）。 */
export function allHabitPresets(): HabitPreset[] {
  return onboardingV3Presets();
}

/**
 * 達成率の表示順（2×2グリッド最下部固定・降順）。
 * プロトの LEVELS と同じ「完璧→だいたい→たまに→やってない」。
 */
export const ACHIEVEMENT_RATE_DISPLAY_ORDER: readonly AchievementRate[] = [1, 0.7, 0.3, 0] as const;

/**
 * 中間の達成率（30% / 70%）を選べない「全か無か」の習慣。
 * タバコは1本でも吸うと効果が大きく下がるため 100%(吸わない)/0%(吸う) の二択（effect-model.md §「量・頻度の閾値」）。
 */
export const BINARY_ACHIEVEMENT_PRESET_IDS: ReadonlySet<string> = new Set([
  'quit_smoking_for_health',
]);

/** そのプリセットで選べる達成率を表示順で返す。二択習慣は 30%/70% を除外する。 */
export function availableAchievementRates(presetId: string): AchievementRate[] {
  if (BINARY_ACHIEVEMENT_PRESET_IDS.has(presetId)) return [1, 0];
  return [...ACHIEVEMENT_RATE_DISPLAY_ORDER];
}

/** そのプリセットで達成率が選べる（無効化されていない）か。 */
export function isAchievementRateAvailable(presetId: string, rate: AchievementRate): boolean {
  return availableAchievementRates(presetId).includes(rate);
}

/** プリセットの達成率を記録する（再選択で上書き）。無効な達成率は無視して状態を返す。 */
export function setHabitRate(
  state: WizardState,
  presetId: string,
  rate: AchievementRate
): WizardState {
  if (!isAchievementRateAvailable(presetId, rate)) return state;
  return { ...state, rates: { ...state.rates, [presetId]: rate } };
}

/** 記録済みの達成率を返す（未回答は undefined）。 */
export function getHabitRate(state: WizardState, presetId: string): AchievementRate | undefined {
  return state.rates[presetId];
}

/**
 * [2] 4択タップ: 達成率を記録し、余韻（遷移中）状態に入る。
 * 遷移中の再タップは習慣の無回答スキップを生むため無視する（状態をそのまま返す）。
 * 無効な達成率（二択習慣の 30%/70% 等）も記録せず遷移しない。
 */
export function tapHabitRate(
  state: WizardState,
  presetId: string,
  rate: AchievementRate
): WizardState {
  if (state.advancing) return state;
  const next = setHabitRate(state, presetId, rate);
  if (next === state) return state;
  return { ...next, advancing: true };
}

/**
 * [2] 余韻タイマー満了: 次の習慣へ進む（最後の習慣なら [3] 計算中へ）。
 * 遷移中でないときの呼び出し（連打で余分にスケジュールされたタイマー等）は no-op。
 * これにより同一 tick の連打でタイマーが複数発火しても二重に進まない。
 */
export function completeHabitAdvance(state: WizardState): WizardState {
  if (!state.advancing) return state;
  if (state.habitIndex >= ONBOARDING_V3_PRESET_IDS.length - 1) {
    return { ...state, advancing: false, step: 3 };
  }
  return { ...state, advancing: false, habitIndex: state.habitIndex + 1 };
}

/** [2] 戻る: 前の習慣へ（先頭なら [1] プロフィールへ）。遷移中は無視する。 */
export function backInHabits(state: WizardState): WizardState {
  if (state.advancing) return state;
  if (state.habitIndex <= 0) return { ...state, step: 1 };
  return { ...state, habitIndex: state.habitIndex - 1 };
}

// ───────── [5] KPI選択 / [6] 習慣選択 ─────────

/**
 * [5] 「充実させたい」KPI を選んで [6] 習慣選択へ進む。
 * KPI を選び直したら（同じ KPI の再選択を含め）候補が変わるため、チェック済み習慣はリセットする。
 */
export function chooseFocusKpi(state: WizardState, kpi: KpiKey): WizardState {
  return { ...state, focusKpi: kpi, chosenPresetIds: [], step: 6 };
}

/** [6] 取り組む習慣のチェックをトグルする。 */
export function toggleChosenPreset(state: WizardState, presetId: string): WizardState {
  const chosen = state.chosenPresetIds.includes(presetId)
    ? state.chosenPresetIds.filter((id) => id !== presetId)
    : [...state.chosenPresetIds, presetId];
  return { ...state, chosenPresetIds: chosen };
}

/**
 * 現在の回答から診断入力（selections）を組み立てる。
 * v3 の15習慣のうち達成率が記録済みのものだけを含める（未回答は集計しない）。
 */
export function buildDiagnosisSelections(state: WizardState): HabitSelection[] {
  const selections: HabitSelection[] = [];
  for (const presetId of ONBOARDING_V3_PRESET_IDS) {
    const rate = state.rates[presetId];
    if (rate === undefined) continue;
    selections.push({ presetId, rate });
  }
  return selections;
}

/**
 * [4] 対比表示用: 回答済み習慣を「全部100%身についたら」の達成率=1 で組み立てる。
 * 新規計算ロジックは持たず、buildDiagnosisSelections の presetId 集合を rate=1 に置換するだけ
 * （diagnosis-v3 の既存関数に達成率=1 を渡すのと等価。plan.md change-2 スコープ）。
 */
export function buildFullPotentialSelections(state: WizardState): HabitSelection[] {
  return buildDiagnosisSelections(state).map((sel) => ({ ...sel, rate: 1 }));
}

// ───────── 計算入力の変換 ─────────

/** OnboardingProfileInput を計算用 UserProfile に変換する（保存はしない・計算入力専用）。 */
export function profileInputToUserProfile(input: OnboardingProfileInput): UserProfile {
  const birthYear = input.age !== null ? new Date().getFullYear() - input.age : null;
  return {
    userId: '',
    birthYear,
    gender: (input.gender ?? 'unspecified') as ProfileGender,
    country: input.country,
    annualIncome: input.annualIncome,
    currency: DEFAULT_CURRENCY,
    trackedKpis: [],
    createdAt: '',
    updatedAt: '',
    tutorialCompletedAt: null,
  };
}

// ───────── 1回あたりの効果（per-day 効果の合算・診断計算の建材） ─────────

/** 「1回あたりの効果」の構造化結果（UI 側で i18n を適用するためロケール非依存で返す）。 */
export interface PresetEffect {
  kpi: KpiKey;
  /** 1回あたりの効果量（丸め済み・常に非負）。 */
  value: number;
  /** 出費削減（減らす量）なら true。表示時にマイナス符号を付ける。 */
  isReduction: boolean;
}

/**
 * 記事1本の per-day 効果を KPI 軸で取り出す（calculationParams → KPI のマッピング1箇所化）。
 * presetPerTimeEffectValue と diagnosis-v3 の記事単位 de-dup 集計（issue #34）が共用する。
 */
export function articleKpiPerDay(article: LifeImpactArticle, kpi: KpiKey): number {
  const p = article.calculationParams;
  switch (kpi) {
    case 'health_lifespan':
      return p.dailyHealthMinutes;
    case 'positive_mood':
      return p.dailyPositiveMoodMinutes;
    case 'cost_saving':
      return p.dailyCostSaving;
    case 'earning':
      return p.dailyIncomeGain;
  }
}

/**
 * プリセットの「1回あたりの効果」を指定 KPI 軸で算出する（diagnosis-v3 の建材）。
 * プリセットが参照する記事群の calculationParams を合算する。文言は付けず構造化データで返す。
 * 未知プリセット・効果0は null。
 */
export function presetPerTimeEffectValue(presetId: string, kpi: KpiKey): PresetEffect | null {
  const preset = getHabitPreset(presetId);
  const def = getKpi(kpi);
  if (!preset || !def) return null;

  let value = 0;
  for (const articleId of preset.articleIds) {
    const article = getArticle(articleId);
    if (!article) continue;
    value += articleKpiPerDay(article, kpi);
  }

  const rounded = Math.round(value);
  if (rounded === 0) return null;

  return { kpi, value: rounded, isReduction: kpi === 'cost_saving' };
}

// ───────── [6]→完了時の書き込み ─────────

/**
 * プリセットから Habit（insert 入力）を組み立てる。
 * 必須フィールドは既存 Discover の習慣採用フロー（habit-form.tsx）と同じ既定値で補う。
 * status は常に省略（='active' 既定）。チェックした習慣は「これから取り組む」もので、
 * 習慣化済み（established）の判定は日々の実行ログの実績が担う。未知プリセットは null。
 */
export function buildHabitFromPreset(presetId: string): HabitInsertInput | null {
  const preset = getHabitPreset(presetId);
  if (!preset) return null;

  return {
    name: preset.name,
    description: undefined,
    lifeSignificance: undefined,
    icon: preset.icon,
    frequency: 'everyday',
    customDays: undefined,
    type: preset.defaultHabitType,
    weeklyTarget: undefined,
    impactArticleId: undefined,
    evidences: [],
  };
}

export interface OnboardingWriteInput {
  userId: string;
  profile: OnboardingProfileInput;
  /** [6] でチェックした「取り組む」プリセットID。全て status='active' で登録する。 */
  chosenPresetIds: readonly string[];
  /**
   * 既に書き込み済みのプリセットID集合（部分失敗→再試行時に重複 insert を避ける・D-C3）。
   * 省略時は空集合（初回書き込み）。
   */
  completedPresetIds?: ReadonlySet<string>;
}

/**
 * 完了時の一括書き込み:
 *   1. upsert user_profiles（tracked_kpis=全 KpiKey・D5。冪等＝再試行安全）
 *   2. チェック済みの習慣を ONBOARDING_V3_PRESET_IDS 順に insert（一律 active）→ evidences
 * いずれかが失敗したら、それまでに成功した presetId 集合を例外に載せて throw する（C-S14・D-C3）。
 * チェック 0 件でも profile だけ書ける（選ばずに始められる）。
 *
 * @returns 今回 + これまでに書き込みが成功したプリセットID集合
 */
export async function runOnboardingWrite(input: OnboardingWriteInput): Promise<Set<string>> {
  const birthYear =
    input.profile.age !== null ? new Date().getFullYear() - input.profile.age : null;

  const completed = new Set<string>(input.completedPresetIds ?? []);
  const chosen = new Set(input.chosenPresetIds);

  try {
    // 1. profile（冪等 upsert・trackedKpis=全4軸）
    await upsertUserProfile(input.userId, {
      birthYear,
      gender: (input.profile.gender ?? 'unspecified') as ProfileGender,
      country: input.profile.country,
      annualIncome: input.profile.annualIncome,
      currency: DEFAULT_CURRENCY,
      trackedKpis: [...KPI_KEYS],
    });

    // 2. チェック済みの習慣（15本の表示順で走査・一律 active）
    for (const presetId of ONBOARDING_V3_PRESET_IDS) {
      if (!chosen.has(presetId)) continue;
      if (completed.has(presetId)) continue;
      await writeHabit(input.userId, presetId, completed);
    }

    return completed;
  } catch (error) {
    throw new OnboardingWriteError(error, completed);
  }
}

/** habit insert + evidences を1件分書き込み、成功したら completed に追加する。 */
async function writeHabit(
  userId: string,
  presetId: string,
  completed: Set<string>
): Promise<void> {
  const habitInput = buildHabitFromPreset(presetId);
  const preset = getHabitPreset(presetId);
  if (!habitInput || !preset) {
    completed.add(presetId); // 無効プリセットは処理済み扱いで再試行ループに残さない
    return;
  }

  const created = await insertHabit(userId, habitInput);
  const evidences = preset.articleIds.map((articleId) => ({ articleId, weight: 100 }));
  if (evidences.length > 0) {
    await replaceHabitEvidences(created.id, evidences);
  }
  completed.add(presetId);
}

/**
 * 書き込み失敗時の例外。succeededPresetIds に「それまでに成功した presetId」を載せる。
 * 呼び出し側はこれを completedPresetIds として再試行に渡し、重複 insert を避ける（D-C3）。
 */
export class OnboardingWriteError extends Error {
  readonly cause: unknown;
  readonly succeededPresetIds: Set<string>;

  constructor(cause: unknown, succeededPresetIds: Set<string>) {
    super(cause instanceof Error ? cause.message : 'onboarding write failed');
    this.name = 'OnboardingWriteError';
    this.cause = cause;
    this.succeededPresetIds = succeededPresetIds;
  }
}

// HabitPreset 再エクスポート（互換用）
export type { HabitPreset };
