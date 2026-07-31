"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Check, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { markTutorialPending } from "@/lib/tutorial";
import { useAuth } from "@/components/auth-provider";
import { KPI_CATALOG, KPI_KEYS, type KpiKey } from "@/data/kpi/catalog";
import { KpiIcon } from "@/components/onboarding/kpi-icon";
import { EvidenceArticleSheet } from "@/components/habits/evidence-article-sheet";
import { EstimateDisclaimer } from "@/components/habits/estimate-disclaimer";
import { getHabitPreset } from "@/data/habit-presets";
import {
  createInitialWizardState,
  canAdvanceFromProfile,
  validateProfileInput,
  onboardingV3Presets,
  availableAchievementRates,
  tapHabitRate,
  completeHabitAdvance,
  backInHabits,
  getHabitRate,
  buildDiagnosisSelections,
  buildFullPotentialSelections,
  profileInputToUserProfile,
  runOnboardingWrite,
  chooseFocusKpi,
  toggleChosenPreset,
  OnboardingWriteError,
  type WizardState,
  type OnboardingGender,
} from "@/lib/onboarding";
import {
  computeDiagnosisV3,
  habitPotentialV3,
  rankPresetsByGrowth,
  formatKpiValue,
  type AchievementRate,
  type DiagnosisV3Result,
} from "@/lib/diagnosis-v3";

// [0]イントロ 〜 [5]完了 の6画面。進捗バーは入力ステップ [1][2] のみを数える。
const FORM_STEPS = 2; // [1] プロフィール / [2] 段階タップ診断
const CALCULATING_MS = 2600;
// タップ→次の習慣までの余韻。KPI count-up（600ms）を見せ、後半でカードが leave して入れ替わる
// （プロト: 520ms 後に leave 420ms → 新カード enter。ここでは leave を 300ms 遅延で重ねて 640ms で入替）。
const HABIT_ADVANCE_MS = 640;

// 達成率 → 4択ラベルの i18n キー。
const RATE_LEVEL_KEY: Record<number, "full" | "most" | "sometimes" | "none"> = {
  1: "full",
  0.7: "most",
  0.3: "sometimes",
  0: "none",
};

const V3_PRESETS = onboardingV3Presets();
const TOTAL_HABITS = V3_PRESETS.length;

export function OnboardingWizard() {
  const t = useTranslations("onboarding");
  const router = useRouter();
  const { user } = useAuth();
  const [state, setState] = useState<WizardState>(createInitialWizardState);
  const [writing, setWriting] = useState(false);
  const [writeError, setWriteError] = useState(false);
  // [4] 習慣リストのタップで開くエビデンス記事シート（アプリ本体と同じ EvidenceArticleSheet）。
  const [articleSheetId, setArticleSheetId] = useState<string | null>(null);
  // 部分失敗→再試行で habit が重複 insert されないよう、成功済みのプリセットID集合を保持。
  const completedPresetIdsRef = useRef<Set<string>>(new Set());

  const setStep = (step: WizardState["step"]) => setState((s) => ({ ...s, step }));

  const profileErrors = validateProfileInput(state.profile);

  const updateProfile = (patch: Partial<WizardState["profile"]>) =>
    setState((s) => ({ ...s, profile: { ...s.profile, ...patch } }));

  // 計算用プロフィール（[1] の実プロフィール由来。診断の horizon 算出に使う）。
  const calcProfile = useMemo(() => profileInputToUserProfile(state.profile), [state.profile]);

  // 上部4KPIライブ累計（回答済み習慣 × 達成率・未来のみ）。
  const liveResult: DiagnosisV3Result = useMemo(
    () => computeDiagnosisV3({ selections: buildDiagnosisSelections(state), profile: calcProfile }),
    [state, calcProfile]
  );

  // 表示はプロト準拠の count-up（600ms・ease-out cubic）でターゲット値へ追従する。
  const liveShown = useCountUpKpis(liveResult);

  // タップ（達成率の記録）ごとに KPI を bump させる（count-up と同時に浮く演出）。
  // インクリメントは chooseRate（イベントハンドラ）側で行う（effect 内 setState を避ける）。
  const [bumpTick, setBumpTick] = useState(0);

  // [4] 結果（未来のみ・現在の達成率）。step が 4 のときだけ計算する。
  const result: DiagnosisV3Result | null = useMemo(() => {
    if (state.step < 4) return null;
    return computeDiagnosisV3({ selections: buildDiagnosisSelections(state), profile: calcProfile });
  }, [state, calcProfile]);

  // [4] 対比: 回答済み習慣が「全部100%身についたら」の未来値（達成率=1 を渡すだけ）。
  const fullResult: DiagnosisV3Result | null = useMemo(() => {
    if (state.step < 4) return null;
    return computeDiagnosisV3({ selections: buildFullPotentialSelections(state), profile: calcProfile });
  }, [state, calcProfile]);

  // [3] 計算中アニメーション → 数秒で [4] へ自動遷移
  useEffect(() => {
    if (state.step !== 3) return;
    const id = setTimeout(() => setStep(4), CALCULATING_MS);
    return () => clearTimeout(id);
  }, [state.step]);

  // 4択タップ: 達成率記録 → 余韻 → 次の習慣へ（最後なら [3] 計算中へ）。
  // 連打ガード（advancing）は純粋関数側（tapHabitRate / completeHabitAdvance）が持つため、
  // 余分にスケジュールされたタイマーは no-op になる。
  const chooseRate = (presetId: string, rate: AchievementRate) => {
    // 余韻中（advancing）のタップは純粋関数側で無視されるため bump もさせない。
    if (!state.advancing) setBumpTick((n) => n + 1);
    setState((s) => tapHabitRate(s, presetId, rate));
    window.setTimeout(() => setState(completeHabitAdvance), HABIT_ADVANCE_MS);
  };

  const goBackInHabits = () => setState(backInHabits);

  // [6] スタート: チェックした習慣（一律 active）＋ profile を書き込んでホームへ。
  const handleStart = async () => {
    if (!user) return;
    setWriting(true);
    setWriteError(false);
    try {
      const completed = await runOnboardingWrite({
        userId: user.id,
        profile: state.profile,
        chosenPresetIds: state.chosenPresetIds,
        completedPresetIds: completedPresetIdsRef.current,
      });
      completedPresetIdsRef.current = completed;
      setWriting(false);
      // ホーム到着後に初回チュートリアル（コーチマーク）を起動する
      markTutorialPending();
      router.push("/");
    } catch (error) {
      if (error instanceof OnboardingWriteError) {
        completedPresetIdsRef.current = error.succeededPresetIds;
      }
      setWriteError(true);
      setWriting(false);
    }
  };

  const currentPreset = V3_PRESETS[state.habitIndex];

  // [6] 選んだ KPI への伸びしろ順トップ5（100% と効果なしは除外）。
  const growthCandidates = useMemo(
    () =>
      state.focusKpi ? rankPresetsByGrowth(state.focusKpi, state.rates, calcProfile) : [],
    [state.focusKpi, state.rates, calcProfile]
  );

  // [4] 結果に含まれている習慣（達成率>0 で回答したもの・表示順）。
  // 各行にアイコン・効果を持つ全KPIの値（達成率100%基準の生涯ポテンシャル・0は除外）・
  // エビデンス記事ID を付す（F5/F6/F7）。
  const answeredHabits = useMemo(() => {
    return buildDiagnosisSelections(state)
      .filter((s) => s.rate > 0)
      .map(({ presetId, rate }) => {
        const preset = getHabitPreset(presetId);
        const potential = habitPotentialV3(presetId, calcProfile);
        // KPIカタログ順で、効果値 > 0 の KPI だけを「アイコン＋数字」用に抽出する。
        const effects = KPI_CATALOG.map((def) => {
          const v = potential.byKpi[def.key];
          return { key: def.key, icon: def.icon, display: v.display, unit: v.unit, raw: v.raw };
        }).filter((e) => e.raw > 0);
        return {
          presetId,
          rate,
          icon: preset?.icon ?? "sparkles",
          articleId: preset?.articleIds[0] ?? null,
          effects,
        };
      });
  }, [state, calcProfile]);

  return (
    <div className="space-y-8">
      {(state.step === 1 || state.step === 2) && (
        <StepProgress current={state.step} total={FORM_STEPS} />
      )}

      {/* ───────── [0] イントロ ───────── */}
      {state.step === 0 && (
        <section className="flex min-h-[60dvh] flex-col justify-center space-y-8 text-center">
          <div className="space-y-3">
            <h1 className="text-3xl font-bold leading-tight tracking-tight">
              {t("intro.title")}
            </h1>
            <p className="text-base text-muted-foreground">{t("intro.subtitle")}</p>
          </div>
          <div className="space-y-3">
            <PrimaryButton onClick={() => setStep(1)}>{t("intro.cta")}</PrimaryButton>
            <p className="text-xs text-muted-foreground">{t("intro.note")}</p>
          </div>
        </section>
      )}

      {/* ───────── [1] プロフィール ───────── */}
      {state.step === 1 && (
        <section className="space-y-6">
          <BackLink label={t("back")} onClick={() => setStep(0)} />
          <Heading title={t("profile.title")} subtitle={t("profile.subtitle")} />
          <div className="space-y-5">
            <Field label={t("profile.age")}>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={120}
                value={state.profile.age ?? ""}
                onChange={(e) =>
                  updateProfile({
                    age: e.target.value === "" ? null : Number(e.target.value),
                  })
                }
                className={inputClass(!!profileErrors.age && state.profile.age !== null)}
              />
            </Field>

            <Field label={t("profile.gender")}>
              <div className="grid grid-cols-3 gap-2">
                {(["male", "female", "other"] as const).map((g) => {
                  const selected = state.profile.gender === g;
                  const label =
                    g === "male"
                      ? t("profile.genderMale")
                      : g === "female"
                      ? t("profile.genderFemale")
                      : t("profile.genderOther");
                  return (
                    <button
                      key={g}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => updateProfile({ gender: g as OnboardingGender })}
                      className={cn(
                        "rounded-lg border px-3 py-3 text-sm font-medium transition-colors",
                        selected
                          ? "border-primary bg-primary/5 text-primary ring-2 ring-primary/30"
                          : "border-border bg-card text-foreground hover:border-primary/40"
                      )}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </Field>

            <Field label={t("profile.country")}>
              <select
                value={state.profile.country}
                onChange={(e) => updateProfile({ country: e.target.value })}
                className={inputClass(false)}
              >
                <option value="JP">{t("profile.countryJapan")}</option>
              </select>
            </Field>

            <Field label={t("profile.annualIncome")} hint={t("profile.optional")}>
              <div className="relative">
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  placeholder={t("profile.incomePlaceholder")}
                  value={
                    state.profile.annualIncome === null
                      ? ""
                      : state.profile.annualIncome / 10000
                  }
                  onChange={(e) =>
                    updateProfile({
                      annualIncome:
                        e.target.value === "" ? null : Number(e.target.value) * 10000,
                    })
                  }
                  className={cn(inputClass(!!profileErrors.annualIncome), "pr-14")}
                />
                <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-sm text-muted-foreground">
                  {t("profile.incomeUnit")}
                </span>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {t("profile.incomeNote")}
              </p>
            </Field>
          </div>
          <PrimaryButton
            disabled={!canAdvanceFromProfile(state.profile)}
            onClick={() => setState((s) => ({ ...s, step: 2, habitIndex: 0 }))}
          >
            {t("profile.next")}
          </PrimaryButton>
        </section>
      )}

      {/* ───────── [2] 段階タップ診断（1画面1習慣・4択） ───────── */}
      {state.step === 2 && currentPreset && (
        <section className="space-y-5">
          <div className="flex items-center gap-3">
            <BackLink label={t("back")} onClick={goBackInHabits} />
            <span className="ml-auto font-mono text-xs font-medium text-muted-foreground tabular-nums">
              {t("habits.countLabel", {
                current: state.habitIndex + 1,
                total: TOTAL_HABITS,
              })}
            </span>
          </div>

          {/* 上部: 4KPIライブ累計（固定表示） */}
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="mb-3 text-xs text-muted-foreground">{t("habits.liveLead")}</p>
            <ul className="grid grid-cols-2 gap-x-4 gap-y-3">
              {KPI_CATALOG.map((def) => {
                const v = liveShown[def.key];
                // 累計インパクトは「積み上げ（ポジティブ）」の意味 → 値が立ったら success 緑で光らせる。
                const accrued = liveResult.byKpi[def.key].raw > 0;
                return (
                  <li
                    key={`${def.key}-${bumpTick}`}
                    className={cn(
                      "flex items-center justify-between gap-2",
                      bumpTick > 0 && "onb-kpi-bump"
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-1.5">
                      <KpiIcon
                        name={def.icon}
                        className={cn("size-3.5 shrink-0", accrued ? "text-success" : "text-muted-foreground")}
                      />
                      <span className="truncate text-[11px] text-muted-foreground">
                        {t(`kpi.${def.key}.name`)}
                      </span>
                    </span>
                    <span
                      className={cn(
                        "shrink-0 font-mono text-sm font-semibold tabular-nums",
                        accrued ? "text-success" : "text-muted-foreground"
                      )}
                    >
                      {v.display}
                      <span className="ml-0.5 text-[10px] font-medium text-muted-foreground">
                        {v.unit}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* カード部（習慣タイトル〜4択）はスライドとして enter/leave 遷移する。
              habitIndex を key に再マウントして enter を発火し、余韻中（advancing）は leave する。 */}
          <div
            key={state.habitIndex}
            className={cn("space-y-5", state.advancing ? "onb-slide-leave" : "onb-slide-enter")}
          >
          {/* 中央: 習慣カード（タイトル・個別インパクト・補足） */}
          <div className="space-y-4">
            <h1 className="text-xl font-bold leading-snug tracking-tight">
              {t(`preset.${currentPreset.id}`)}
            </h1>

            <HabitImpactBox
              profileResult={habitPotentialV3(currentPreset.id, calcProfile)}
              t={t}
              onTap={
                currentPreset.articleIds.length > 0
                  ? () => setArticleSheetId(currentPreset.articleIds[0])
                  : undefined
              }
            />

            {/* 景表法・打消し表示対応（issue #39）: 推定値直下の近接注記 */}
            <EstimateDisclaimer />

            <p className="text-xs leading-relaxed text-muted-foreground">
              {t(`habitSub.${currentPreset.id}`)}
            </p>
          </div>

          {/* 質問 */}
          <p className="text-sm font-bold">{t("habits.ask")}</p>

          {/* 最下部: 4択 2×2 グリッド */}
          <div className="grid grid-cols-2 gap-2.5">
            {availableAchievementRates(currentPreset.id).map((rate) => {
              const levelKey = RATE_LEVEL_KEY[rate];
              const selected = getHabitRate(state, currentPreset.id) === rate;
              return (
                <button
                  key={rate}
                  type="button"
                  aria-pressed={selected}
                  disabled={state.advancing}
                  onClick={() => chooseRate(currentPreset.id, rate)}
                  className={cn(
                    "flex flex-col items-start gap-1 rounded-xl border p-3.5 text-left transition active:scale-[0.98]",
                    selected
                      ? "border-primary bg-primary/5 ring-2 ring-primary/30"
                      : "border-border bg-card hover:border-primary/40"
                  )}
                >
                  <span className="flex w-full items-center justify-between gap-2">
                    <span className="text-sm font-bold leading-tight">
                      {t(`habits.levels.${levelKey}.label`)}
                    </span>
                    <span className="font-mono text-xs font-semibold text-muted-foreground tabular-nums">
                      {Math.round(rate * 100)}%
                    </span>
                  </span>
                  <span className="text-[11px] leading-tight text-muted-foreground">
                    {t(`habits.levels.${levelKey}.desc`)}
                  </span>
                </button>
              );
            })}
          </div>
          </div>
        </section>
      )}

      {/* ───────── [3] 計算中 ───────── */}
      {state.step === 3 && (
        <section className="flex min-h-[60dvh] flex-col items-center justify-center space-y-6 text-center">
          <Loader2 className="size-10 animate-spin text-primary" aria-hidden />
          <h1 className="text-xl font-bold tracking-tight">{t("calculating.title")}</h1>
          <ul className="space-y-1.5 text-sm text-muted-foreground" aria-live="polite">
            <li>{t("calculating.phase1")}</li>
            <li>{t("calculating.phase2")}</li>
            <li>{t("calculating.phase3")}</li>
          </ul>
        </section>
      )}

      {/* ───────── [4] 結果（KPIごとの説明セクション＋まとめ＋身についている習慣） ───────── */}
      {state.step === 4 && result && fullResult && (
        <section className="space-y-6">
          <Heading title={t("result.title")} subtitle={t("result.lead")} />
          <p className="text-sm leading-relaxed text-muted-foreground">
            {t("result.sectionsLead")}
          </p>

          {/* 景表法・打消し表示対応（issue #39）: 診断結果の推定値に対する近接注記 */}
          <EstimateDisclaimer />

          {/* F4: KPIごとに独立したセクション（アイコン＋名前＋説明文＋数字対比） */}
          <div className="space-y-4">
            {KPI_CATALOG.map((def) => {
              const cur = result.byKpi[def.key];
              const full = fullResult.byKpi[def.key];
              return (
                <section
                  key={def.key}
                  className="onb-slide-enter space-y-3 rounded-xl border border-border bg-card p-5"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <KpiIcon name={def.icon} className="size-5" />
                    </span>
                    <h2 className="text-base font-bold tracking-tight">
                      {t(`kpi.${def.key}.name`)}
                    </h2>
                  </div>
                  <p className="text-[13px] leading-relaxed text-muted-foreground">
                    {t(`result.kpiSections.${def.key}.body`)}
                  </p>
                  {/* 数字対比: 身についてない人と比べて / 全部100%身についたら（折り返さない） */}
                  <div className="grid grid-cols-2 gap-2.5">
                    <div className="rounded-xl bg-muted/40 p-3">
                      <p className="whitespace-nowrap text-[11px] text-muted-foreground">
                        {t("result.currentLabel")}
                      </p>
                      <p className="mt-0.5 whitespace-nowrap font-mono text-base font-semibold tabular-nums text-foreground">
                        {cur.raw > 0
                          ? t("result.value", { value: cur.display, unit: cur.unit })
                          : "—"}
                      </p>
                    </div>
                    <div className="rounded-xl bg-success/5 p-3 ring-1 ring-success/20">
                      <p className="whitespace-nowrap text-[11px] font-medium text-success">
                        {t("result.fullLabel")}
                      </p>
                      <p className="mt-0.5 whitespace-nowrap font-mono text-lg font-semibold tabular-nums text-success">
                        {full.raw > 0
                          ? t("result.value", { value: full.display, unit: full.unit })
                          : "—"}
                      </p>
                    </div>
                  </div>
                </section>
              );
            })}
          </div>

          {/* F1: 4KPIまとめ（縮約版・列見出しの折り返しを起こさない対比） */}
          <div className="rounded-xl border border-border bg-card p-5">
            <p className="mb-1 text-sm font-bold">{t("result.summaryLabel")}</p>
            <p className="mb-3 text-[11px] text-muted-foreground">
              {t("result.currentLabel")} ／ {t("result.fullLabel")}
            </p>
            <ul className="space-y-3">
              {KPI_CATALOG.map((def) => {
                const cur = result.byKpi[def.key];
                const full = fullResult.byKpi[def.key];
                return (
                  <li key={def.key} className="flex items-center gap-2.5">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                      <KpiIcon name={def.icon} className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                      {t(`kpi.${def.key}.name`)}
                    </span>
                    <span className="shrink-0 whitespace-nowrap font-mono text-xs tabular-nums text-muted-foreground">
                      {cur.raw > 0
                        ? t("result.value", { value: cur.display, unit: cur.unit })
                        : "—"}
                    </span>
                    <span className="shrink-0 whitespace-nowrap font-mono text-sm font-semibold tabular-nums text-success">
                      {full.raw > 0
                        ? t("result.value", { value: full.display, unit: full.unit })
                        : "—"}
                    </span>
                  </li>
                );
              })}
            </ul>

            {/* 景表法・打消し表示対応（issue #39）: まとめ数値直下の近接注記 */}
            <EstimateDisclaimer className="mt-3" />
          </div>

          {/* F5/F6: 身についている習慣（アイコン＋主要KPIの効果値＋タップでエビデンス記事） */}
          {answeredHabits.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">
                {t("result.habitsLabel")}
              </p>
              <ul className="space-y-2">
                {answeredHabits.map(({ presetId, rate, icon, articleId, effects }) => (
                  <li key={presetId}>
                    <button
                      type="button"
                      disabled={!articleId}
                      onClick={() => articleId && setArticleSheetId(articleId)}
                      className="flex w-full items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-left transition hover:border-primary/40 active:scale-[0.99] disabled:pointer-events-none"
                    >
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <KpiIcon name={icon} className="size-5" />
                      </span>
                      <span className="min-w-0 flex-1 space-y-1">
                        <span className="flex items-center gap-2">
                          <span className="min-w-0 flex-1 truncate text-sm font-medium">
                            {t(`preset.${presetId}`)}
                          </span>
                          <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                            {Math.round(rate * 100)}%
                          </span>
                        </span>
                        {/* F7: 効果を持つ各KPIの「アイコン＋数字」をコンパクトに横並び（0は除外） */}
                        {effects.length > 0 && (
                          <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                            {effects.map((e) => (
                              // 密なリスト行は home の「◯日間のインパクト」に倣い、値は foreground・
                              // アクセントはアイコンの success 緑に載せる（緑の意味を薄めない）。
                              <span
                                key={e.key}
                                className="flex items-center gap-0.5 whitespace-nowrap font-mono text-xs font-semibold tabular-nums text-foreground"
                              >
                                <KpiIcon name={e.icon} className="size-3.5 shrink-0 text-success" />
                                +{e.display}
                                <span className="text-[10px] font-medium text-muted-foreground">
                                  {e.unit}
                                </span>
                              </span>
                            ))}
                          </span>
                        )}
                      </span>
                      <ChevronRight className="size-4 shrink-0 self-center text-muted-foreground" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <PrimaryButton onClick={() => setStep(5)}>{t("result.cta")}</PrimaryButton>
          <p className="text-center text-xs text-muted-foreground">
            {t("result.footnote")}
          </p>
        </section>
      )}

      {/* ───────── [5] KPI選択（人生で何を充実させたいか・1つ選ぶ） ───────── */}
      {state.step === 5 && (
        <section className="space-y-5">
          <BackLink label={t("back")} onClick={() => setStep(4)} />
          <Heading title={t("kpiSelect.title")} subtitle={t("kpiSelect.lead")} />

          <ul className="space-y-3">
            {KPI_CATALOG.map((def) => (
              <li key={def.key}>
                <button
                  type="button"
                  onClick={() => setState((s) => chooseFocusKpi(s, def.key))}
                  className="flex w-full items-start gap-3 rounded-xl border border-border bg-card p-4 text-left transition hover:border-primary/40 active:scale-[0.99]"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <KpiIcon name={def.icon} className="size-5" />
                  </span>
                  <span className="min-w-0 space-y-1">
                    <span className="block font-bold">{t(`kpi.${def.key}.name`)}</span>
                    <span className="block text-xs leading-relaxed text-muted-foreground">
                      {t(`kpiSelect.${def.key}.desc`)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ───────── [6] 習慣選択（伸びしろ順トップ5・現状%・チェックで登録） ───────── */}
      {state.step === 6 && state.focusKpi && (
        <section className="space-y-5">
          <BackLink label={t("back")} onClick={() => setStep(5)} />
          <Heading
            title={t("habitSelect.title")}
            subtitle={t("habitSelect.lead", { kpi: t(`kpi.${state.focusKpi}.name`) })}
          />

          {growthCandidates.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("habitSelect.empty")}</p>
          ) : (
            <ul className="space-y-2">
              {growthCandidates.map(({ presetId, rate, growth }) => {
                const chosen = state.chosenPresetIds.includes(presetId);
                return (
                  <li key={presetId}>
                    <button
                      type="button"
                      aria-pressed={chosen}
                      onClick={() => setState((s) => toggleChosenPreset(s, presetId))}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-xl border p-4 text-left transition active:scale-[0.99]",
                        chosen
                          ? "border-primary bg-primary/5 ring-2 ring-primary/30"
                          : "border-border bg-card hover:border-primary/40"
                      )}
                    >
                      <span
                        className={cn(
                          "flex size-5 shrink-0 items-center justify-center rounded-md border",
                          chosen
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-muted-foreground/40"
                        )}
                        aria-hidden
                      >
                        {chosen && <Check className="size-3.5" />}
                      </span>
                      <span className="min-w-0 flex-1 space-y-0.5">
                        <span className="block text-sm font-bold leading-snug">
                          {t(`preset.${presetId}`)}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {t("habitSelect.current", { percent: Math.round(rate * 100) })}
                        </span>
                      </span>
                      <span className="shrink-0 font-mono text-sm font-semibold tabular-nums text-success">
                        +{growth.display}
                        <span className="ml-0.5 text-[10px] font-medium text-muted-foreground">
                          {growth.unit}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {/* 景表法・打消し表示対応（issue #39）: 伸びしろ数値直下の近接注記 */}
          {growthCandidates.length > 0 && <EstimateDisclaimer />}

          {writeError && (
            <div
              role="alert"
              className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive"
            >
              {t("writeError")}
            </div>
          )}

          <PrimaryButton disabled={writing} onClick={handleStart}>
            {writing ? t("starting") : t("habitSelect.cta")}
          </PrimaryButton>
          <p className="text-center text-xs text-muted-foreground">{t("habitSelect.note")}</p>
        </section>
      )}

      {/* [4] 習慣タップで開くエビデンス記事（アプリ本体と同じ記事シート・F6） */}
      <EvidenceArticleSheet
        open={articleSheetId !== null}
        onOpenChange={(open) => !open && setArticleSheetId(null)}
        articleId={articleSheetId}
      />
    </div>
  );
}

// ───────── 上部4KPIライブの count-up（プロト animateKpis 準拠） ─────────

const KPI_COUNT_UP_MS = 600;

type ShownKpis = Record<KpiKey, { display: string; unit: string }>;

function kpiRaws(result: DiagnosisV3Result): Record<KpiKey, number> {
  const raws = {} as Record<KpiKey, number>;
  for (const key of KPI_KEYS) raws[key] = result.byKpi[key].raw;
  return raws;
}

function formatKpis(raws: Record<KpiKey, number>): ShownKpis {
  const shown = {} as ShownKpis;
  for (const key of KPI_KEYS) shown[key] = formatKpiValue(key, raws[key]);
  return shown;
}

/**
 * ターゲット値（liveResult）の変化を 600ms・ease-out cubic の count-up で表示に追従させる。
 * 表示単位の切替（日→年など）は formatKpiValue が毎フレームの raw に対して行う。
 */
function useCountUpKpis(target: DiagnosisV3Result): ShownKpis {
  const shownRawsRef = useRef<Record<KpiKey, number>>(kpiRaws(target));
  const [shown, setShown] = useState<ShownKpis>(() => formatKpis(kpiRaws(target)));

  useEffect(() => {
    const from = { ...shownRawsRef.current };
    const to = kpiRaws(target);
    if (KPI_KEYS.every((key) => from[key] === to[key])) return;

    const t0 = performance.now();
    let raf = 0;
    const frame = (now: number) => {
      const p = Math.min(1, (now - t0) / KPI_COUNT_UP_MS);
      const eased = 1 - Math.pow(1 - p, 3);
      const current = {} as Record<KpiKey, number>;
      for (const key of KPI_KEYS) current[key] = from[key] + (to[key] - from[key]) * eased;
      shownRawsRef.current = current;
      setShown(formatKpis(current));
      if (p < 1) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [target]);

  return shown;
}

// ───────── 個別インパクトボックス（達成率100%・未来分の4KPI） ─────────

function HabitImpactBox({
  profileResult,
  t,
  onTap,
}: {
  profileResult: DiagnosisV3Result;
  t: ReturnType<typeof useTranslations>;
  /** 推定値から算出根拠（エビデンス記事）へ 1 タップで到達する導線（issue #39） */
  onTap?: () => void;
}) {
  const Wrapper = onTap ? 'button' : 'div';
  return (
    <Wrapper
      {...(onTap ? { type: 'button' as const, onClick: onTap } : {})}
      className="block w-full rounded-xl border border-border bg-muted/30 p-3 text-left"
    >
      <p className="mb-2.5 text-[11px] font-semibold text-muted-foreground">
        {t("habits.impactLead")}
      </p>
      <div className="grid grid-cols-4 gap-2">
        {KPI_CATALOG.map((def) => {
          const v = profileResult.byKpi[def.key];
          const dim = v.raw <= 0;
          return (
            <div key={def.key} className="flex flex-col items-center gap-1 text-center">
              <KpiIcon
                name={def.icon}
                className={cn("size-4", dim ? "text-muted-foreground/50" : "text-success")}
              />
              <span
                className={cn(
                  "font-mono text-[13px] font-semibold leading-none tabular-nums",
                  dim ? "text-muted-foreground" : "text-success"
                )}
              >
                {dim ? "—" : `+${v.display}`}
                {!dim && (
                  <span className="ml-0.5 text-[9px] font-medium text-muted-foreground">
                    {v.unit}
                  </span>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </Wrapper>
  );
}

// ───────── プレゼンテーション小物 ─────────

function StepProgress({ current, total }: { current: number; total: number }) {
  const t = useTranslations("onboarding");
  return (
    <div className="space-y-2">
      <div className="flex gap-1.5" aria-hidden>
        {Array.from({ length: total }).map((_, i) => (
          <span
            key={i}
            className={cn(
              "h-1.5 flex-1 rounded-full transition-colors",
              i < current ? "bg-primary" : "bg-muted"
            )}
          />
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {t("stepLabel", { current, total })}
      </p>
    </div>
  );
}

function Heading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="space-y-1.5">
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      <p className="text-sm text-muted-foreground">{subtitle}</p>
    </div>
  );
}

function BackLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      <ChevronLeft className="size-4" aria-hidden />
      {label}
    </button>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="flex items-center gap-2 text-sm font-medium">
        {label}
        {hint && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">
            {hint}
          </span>
        )}
      </span>
      {children}
    </label>
  );
}

function PrimaryButton({
  disabled,
  onClick,
  children,
}: {
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="w-full rounded-lg bg-primary px-4 py-3.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function inputClass(error: boolean): string {
  return cn(
    "w-full rounded-lg border bg-card px-4 py-3 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20",
    error ? "border-destructive" : "border-border"
  );
}
