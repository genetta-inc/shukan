'use client';

import { useMemo, useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { Rocket, X, Pencil, ChevronRight, ChevronLeft, Settings, Crown, HeartPulse, Wallet, TrendingUp, Smile, FileQuestion, Check } from 'lucide-react';
import { HabitIcon } from '@/components/ui/habit-icon';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import { getArticle } from '@/data/impact-articles';
import { calculateDailyImpact, formatHealthMinutes, formatCurrency } from '@/lib/impact';
import { ImpactKpiGrid, type ImpactKpiMetric } from '@/components/habits/impact-kpi-grid';
import { EstimateDisclaimer } from '@/components/habits/estimate-disclaimer';
import { EvidenceManagerSheet } from '@/components/habits/evidence-manager-sheet';
import { HelpButton } from '@/components/help/help-button';
import { nextStatus, EDITABLE_PAST_DAYS } from '@/lib/habits';
import { failedFillStyle } from '@/components/habits/failed-fill';
import type { HabitWithStats, DayStatus } from '@/types/habit';

interface HabitDetailModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  habit: HabitWithStats | null;
  onUseRocket: (habitId: string, date: string) => void;
  onDayStatusChange?: (habitId: string, date: string, status: 'completed' | 'failed' | 'none') => void;
  onEdit?: (id: string) => void;
  onOpenArticle?: (articleId: string) => void;
  onAddEvidence?: (habitId: string, articleId: string, weight?: number) => void;
  onRemoveEvidence?: (habitId: string, evidenceId: string) => void;
  onSetWeight?: (habitId: string, evidenceId: string, weight: number) => void;
  /** エビデンス未紐付けの習慣に「追加してほしい」リクエストを送る（issue #90） */
  onRequestEvidence?: (habitId: string, habitName: string) => Promise<void>;
}

function getDayOfWeekMondayBased(dateStr: string): number {
  const d = new Date(dateStr);
  const day = d.getDay();
  return day === 0 ? 6 : day - 1;
}

function getDateString(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

interface CalendarCell {
  date: string;
  dayOfMonth: number;
  status: DayStatus['status'] | null;
  /** failed 日の我慢率（0-100）。反転塗り表示に使う（issue #104） */
  resistRate?: number;
}

function buildCalendarGrid(
  year: number,
  month: number,
  allDays: DayStatus[]
): (CalendarCell | null)[][] {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDateStr = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const firstDow = getDayOfWeekMondayBased(firstDateStr);

  const statusMap = new Map<string, DayStatus>();
  for (const day of allDays) {
    statusMap.set(day.date, day);
  }

  const cells: (CalendarCell | null)[] = [];

  // Pad beginning
  for (let i = 0; i < firstDow; i++) cells.push(null);

  // Fill all days of month
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const day = statusMap.get(dateStr);
    cells.push({
      date: dateStr,
      dayOfMonth: d,
      status: day?.status ?? null,
      ...(day?.resistRate !== undefined ? { resistRate: day.resistRate } : {}),
    });
  }

  // Pad end
  while (cells.length % 7 !== 0) cells.push(null);

  const rows: (CalendarCell | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    rows.push(cells.slice(i, i + 7));
  }
  return rows;
}

export function HabitDetailModal({
  open,
  onOpenChange,
  habit,
  onUseRocket,
  onDayStatusChange,
  onEdit,
  onOpenArticle,
  onAddEvidence,
  onRemoveEvidence,
  onSetWeight,
  onRequestEvidence,
}: HabitDetailModalProps) {
  const t = useTranslations('stats');
  const tHabits = useTranslations('habits');
  const tDays = useTranslations('days');
  const tEvidence = useTranslations('evidence');
  const tImpact = useTranslations('impact');
  const [rocketConfirmDate, setRocketConfirmDate] = useState<string | null>(null);
  const [evidenceManagerOpen, setEvidenceManagerOpen] = useState(false);
  const [requestingEvidence, setRequestingEvidence] = useState(false);
  const [requestEvidenceError, setRequestEvidenceError] = useState(false);

  const handleRequestEvidence = useCallback(async () => {
    if (!habit || !onRequestEvidence || requestingEvidence) return;
    setRequestingEvidence(true);
    setRequestEvidenceError(false);
    try {
      await onRequestEvidence(habit.id, habit.name);
    } catch {
      setRequestEvidenceError(true);
    } finally {
      setRequestingEvidence(false);
    }
  }, [habit, onRequestEvidence, requestingEvidence]);

  // History month navigation (single state to avoid stale closures)
  const now = new Date();
  const [historyPeriod, setHistoryPeriod] = useState({ year: now.getFullYear(), month: now.getMonth() });

  // Reset to current month when modal opens with a new habit
  const [lastHabitId, setLastHabitId] = useState<string | null>(null);
  if (habit && habit.id !== lastHabitId) {
    setLastHabitId(habit.id);
    setHistoryPeriod({ year: now.getFullYear(), month: now.getMonth() });
  }

  const navigateMonth = useCallback((delta: number) => {
    setHistoryPeriod((prev) => {
      let newMonth = prev.month + delta;
      let newYear = prev.year;
      if (newMonth < 0) {
        newMonth = 11;
        newYear--;
      } else if (newMonth > 11) {
        newMonth = 0;
        newYear++;
      }
      return { year: newYear, month: newMonth };
    });
  }, []);

  const dayLabelsLocalized = [
    tDays('mon'), tDays('tue'), tDays('wed'), tDays('thu'),
    tDays('fri'), tDays('sat'), tDays('sun'),
  ];

  const calendarGrid = useMemo(() => {
    if (!habit) return [];
    return buildCalendarGrid(historyPeriod.year, historyPeriod.month, habit.allDays);
  }, [habit, historyPeriod.year, historyPeriod.month]);

  // Tappable dates: today + EDITABLE_PAST_DAYS previous
  const tappableDates = useMemo(() => {
    const set = new Set<string>();
    const today = new Date();
    for (let i = 0; i <= EDITABLE_PAST_DAYS; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      set.add(getDateString(d));
    }
    return set;
  }, []);

  // Rocket-eligible: failed days older than the editable window
  const rocketEligibleDates = useMemo(() => {
    if (!habit || habit.rockets <= 0) return new Set<string>();
    const set = new Set<string>();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (const day of habit.allDays) {
      if (day.status === 'failed') {
        const d = new Date(day.date);
        d.setHours(0, 0, 0, 0);
        const diff = Math.round((today.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
        if (diff > EDITABLE_PAST_DAYS) set.add(day.date);
      }
    }
    return set;
  }, [habit]);

  // 詳細ビューの主役は「累計インパクト」（積み上げ）。大きい数値＝累計、その下に「1日あたり +X」を
  // 小さい muted 文字で従属表示する（ホーム「今日のライフインパクト」と同じ ImpactKpiGrid の言語）。
  // 累計は habit.impactSavings（旧・累積貯金ピルの値）、1日あたりは evidences から算出。
  const cumulativeMetrics = useMemo<ImpactKpiMetric[] | null>(() => {
    if (!habit || !habit.impactSavings) return null;
    const daily = calculateDailyImpact(habit.evidences, getArticle);
    const cum = habit.impactSavings;
    const perDay = (s: string) => `${tImpact('perDayPrefix')} ${s}`;
    return [
      {
        icon: HeartPulse,
        label: tImpact('dailyHealth'),
        value: `+${formatHealthMinutes(cum.healthMinutes)}`,
        sub: perDay(`+${formatHealthMinutes(daily.healthMinutes)}`),
      },
      {
        icon: Wallet,
        label: tImpact('dailyCost'),
        value: formatCurrency(cum.costSaving),
        sub: perDay(formatCurrency(daily.costSaving, false)),
      },
      {
        icon: TrendingUp,
        label: tImpact('dailyIncome'),
        value: formatCurrency(cum.incomeGain),
        sub: perDay(formatCurrency(daily.incomeGain, false)),
      },
      {
        icon: Smile,
        label: tImpact('dailyPositiveMood'),
        value: `+${formatHealthMinutes(cum.positiveMoodMinutes)}`,
        sub: perDay(`+${formatHealthMinutes(daily.positiveMoodMinutes)}`),
      },
    ];
  }, [habit, tImpact]);

  // Resolve evidence articles for display
  const evidenceArticles = useMemo(() => {
    if (!habit) return [];
    return habit.evidences
      .map((ev) => {
        const article = getArticle(ev.articleId);
        return article ? { evidence: ev, article } : null;
      })
      .filter(Boolean) as { evidence: typeof habit.evidences[number]; article: NonNullable<ReturnType<typeof getArticle>> }[];
  }, [habit]);

  if (!habit) return null;

  const streakPercent = Math.round((habit.currentStreak / 30) * 100);
  const bestPercent = Math.round((habit.longestStreak / 30) * 100);

  const canGoBack = habit.allDays.length > 0 && (() => {
    const [y, m] = habit.allDays[0].date.split('-').map(Number);
    return new Date(y, m - 1, 1) < new Date(historyPeriod.year, historyPeriod.month, 1);
  })();
  const canGoForward = historyPeriod.year < now.getFullYear() ||
    (historyPeriod.year === now.getFullYear() && historyPeriod.month < now.getMonth());

  const monthLabel = `${historyPeriod.year}年${historyPeriod.month + 1}月`;
  const todayStr = getDateString(now);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="max-h-[92vh] overflow-y-auto p-0 sm:max-w-md"
      >
        <DialogTitle className="sr-only">{habit.name}</DialogTitle>
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5">
          <h2 className="text-xl font-bold">{habit.name}</h2>
          <div className="flex items-center gap-2">
            {onEdit && (
              <button
                type="button"
                onClick={() => onEdit(habit.id)}
                className="flex size-8 items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors hover:bg-muted/80"
              >
                <Pencil className="size-4" />
              </button>
            )}
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="flex size-8 items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors hover:bg-muted/80"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        {/* Life Significance */}
        {habit.lifeSignificance && (
          <div className="px-5">
            <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
              {tHabits('lifeSignificance')}
            </p>
            <p className="mt-1 text-sm text-foreground/80">
              {habit.lifeSignificance}
            </p>
          </div>
        )}

        {/* 累計インパクト（詳細ビューの主役）: ホーム「今日のライフインパクト」と同じ 2×2 ヘアライン
            グリッド（ImpactKpiGrid）。大きい数値＝累計の積み上げ（success=積み上げの意味）、その下に
            「1日あたり +X」を muted で従属表示。キャプションに実行日数を添える（旧・累積貯金ピルの役割を吸収）。 */}
        {cumulativeMetrics && habit.impactSavings && (
          <div className="px-5">
            <p className="mb-2 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              {tImpact('cumulativeImpact')}・{tImpact('executedDays', { days: habit.impactSavings.completedDays })}
            </p>
            {/* 累計は桁が長くなる（+14時間24分 等）ため値は一段小さめの text-[22px] にして溢れを防ぐ。 */}
            <ImpactKpiGrid
              metrics={cumulativeMetrics}
              accent
              valueClassName="text-[22px]"
              className="overflow-hidden rounded-xl border"
            />
            <EstimateDisclaimer className="mt-2" />
          </div>
        )}

        {/* 連続日数: stats ページと同じ「塗りなし・ヘアライン罫線グリッド＋巨大 mono 数値」。
            塗りカードをやめ、緑は面でなく数値・アイコン（達成の記号）に載せる（原則①/⑤）。
            30日到達の Crown も達成の記号＝success。％は 30日ゴールに対する進捗の従属値。 */}
        <div className="mx-5 grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border">
          <div className="flex flex-col gap-1.5 bg-card px-5 py-4">
            <span className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              {t('currentStreak')}
            </span>
            <div className="flex items-baseline gap-1.5">
              {habit.currentStreak >= 30 && <Crown className="size-5 self-center text-success" />}
              <span className="font-mono text-[32px] font-semibold leading-none tabular-nums text-success">
                {habit.currentStreak}
              </span>
              <span className="text-sm text-muted-foreground">{t('days')}</span>
            </div>
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
              {streakPercent}%
            </span>
          </div>
          <div className="flex flex-col gap-1.5 bg-card px-5 py-4">
            <span className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              {t('longestStreak')}
            </span>
            <div className="flex items-baseline gap-1.5">
              {habit.longestStreak >= 30 && <Crown className="size-5 self-center text-success" />}
              <span className="font-mono text-[32px] font-semibold leading-none tabular-nums text-success">
                {habit.longestStreak}
              </span>
              <span className="text-sm text-muted-foreground">{t('days')}</span>
            </div>
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
              {bestPercent}%
            </span>
          </div>
        </div>

        {/* Evidence Section */}
        {evidenceArticles.length > 0 && (
          <div className="px-5">
            <div className="mb-2 flex items-center gap-2">
              <p className="text-sm font-semibold text-foreground">
                {tEvidence('title')}
              </p>
            </div>
            <div className="space-y-1.5">
              {evidenceArticles.map(({ evidence, article }) => (
                <button
                  key={evidence.id}
                  type="button"
                  onClick={() => onOpenArticle?.(evidence.articleId)}
                  className="flex w-full items-center gap-3 rounded-xl border border-border bg-card px-3.5 py-3 text-left transition-colors hover:bg-accent/50"
                >
                  <HabitIcon name={article.defaultIcon} size={18} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{article.habitName}</p>
                    {evidence.weight < 100 && (
                      <p className="text-[10px] text-muted-foreground">
                        {tEvidence('weight')}: {evidence.weight}%
                      </p>
                    )}
                  </div>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                </button>
              ))}
            </div>
            {/* Manage Evidence bar */}
            {onAddEvidence && onRemoveEvidence && onSetWeight && (
              <button
                type="button"
                onClick={() => setEvidenceManagerOpen(true)}
                /* エビデンス管理は中立の UI 操作なので彩色せずインク（原則①: 緑は達成専用）。
                   discover の「ゼロからつくる」ダッシュ枠と同じ neutral affordance に揃える。 */
                className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-secondary/50 px-3.5 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:bg-secondary hover:text-foreground"
              >
                <Settings className="size-4" />
                {tEvidence('manage')}
              </button>
            )}
          </div>
        )}

        {/* Evidence Request（エビデンス未紐付けの習慣向け・issue #90） */}
        {habit.evidences.length === 0 && onRequestEvidence && (
          <div className="px-5">
            {habit.evidenceRequestedAt ? (
              <div
                role="status"
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-secondary/50 px-3.5 py-2.5 text-sm font-medium text-muted-foreground"
              >
                <Check className="size-4" />
                {tEvidence('requestEvidenceSubmitted')}
              </div>
            ) : (
              <div className="space-y-1.5">
                <button
                  type="button"
                  onClick={handleRequestEvidence}
                  disabled={requestingEvidence}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-secondary/50 px-3.5 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:bg-secondary hover:text-foreground disabled:opacity-60"
                >
                  <FileQuestion className="size-4" />
                  {requestingEvidence ? tEvidence('requestEvidenceSubmitting') : tEvidence('requestEvidence')}
                </button>
                {requestEvidenceError && (
                  <p role="alert" className="text-center text-xs text-destructive">
                    {tEvidence('requestEvidenceError')}
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Rocket Section。ロケットは失敗日を救済する中立の道具（達成でも破壊でもない）なので
            アイコンは無彩色インク（原則①/⑥: 独自色を付けない）。個数は mono + tabular-nums。 */}
        <div className="mx-5 flex items-center gap-3 rounded-xl border border-border p-4">
          <Rocket className="size-6 text-foreground" />
          <div className="flex-1">
            <p className="text-sm font-semibold">
              {tHabits('rockets')}: <span className="font-mono tabular-nums">{habit.rockets}</span>
            </p>
            <p className="text-xs text-muted-foreground">
              {tHabits('rocketNextIn', { days: habit.rocketNextIn })}
            </p>
          </div>
        </div>

        {/* History Calendar */}
        <div className="px-5 pb-5">
          {/* Section header */}
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-foreground">
                {tHabits('history')}
              </p>
              <HelpButton topic="historyCalendar" />
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => navigateMonth(-1)}
                disabled={!canGoBack}
                className="flex size-7 items-center justify-center rounded-full transition-colors hover:bg-muted disabled:opacity-30"
              >
                <ChevronLeft className="size-4" />
              </button>
              <span className="min-w-[5.5rem] text-center font-mono text-xs font-medium tabular-nums text-muted-foreground">
                {monthLabel}
              </span>
              <button
                type="button"
                onClick={() => navigateMonth(1)}
                disabled={!canGoForward}
                className="flex size-7 items-center justify-center rounded-full transition-colors hover:bg-muted disabled:opacity-30"
              >
                <ChevronRight className="size-4" />
              </button>
            </div>
          </div>

          {/* Day labels */}
          <div className="mb-1 grid grid-cols-7 gap-1">
            {dayLabelsLocalized.map((label, i) => (
              <div
                key={i}
                className="text-center text-[10px] font-medium text-muted-foreground"
              >
                {label}
              </div>
            ))}
          </div>

          {/* Calendar grid */}
          <div className="flex flex-col gap-1">
            {calendarGrid.map((row, rowIndex) => (
              <div key={rowIndex} className="grid grid-cols-7 gap-1">
                {row.map((cell, colIndex) => {
                  if (!cell) {
                    return <div key={`empty-${colIndex}`} className="aspect-square" />;
                  }

                  const { date, dayOfMonth, status, resistRate } = cell;
                  const isToday = date === todayStr;
                  const isTappable = tappableDates.has(date) && !!onDayStatusChange;
                  const isRocketEligible = rocketEligibleDates.has(date);
                  const isCompleted = status === 'completed' || status === 'rocket_used';
                  const isFailed = status === 'failed';
                  const [fy, fm, fd] = date.split('-').map(Number);
                  const isFuture = new Date(fy, fm - 1, fd) > new Date(now.getFullYear(), now.getMonth(), now.getDate());

                  return (
                    <button
                      key={date}
                      type="button"
                      disabled={!isTappable && !isRocketEligible}
                      onClick={() => {
                        if (isRocketEligible) {
                          setRocketConfirmDate(date);
                        } else if (isTappable) {
                          onDayStatusChange!(habit.id, date, nextStatus(status ?? 'none'));
                        }
                      }}
                      className={cn(
                        'relative flex aspect-square items-center justify-center rounded-lg font-mono text-[10px] font-medium tabular-nums transition-all',
                        // Status colors（達成=success / 失敗=danger。いずれもトークン。原則①）
                        isCompleted && 'bg-success text-success-foreground',
                        // 失敗日は inline の failedFillStyle（conic-gradient）で塗る（#105）。静的 bg-danger は使わない。
                        isFailed && !isRocketEligible && 'text-white',
                        !isCompleted && !isFailed && !isFuture && 'text-foreground',
                        isFuture && 'text-muted-foreground/40',
                        // Tappable border (last 5 days)
                        isTappable && !isCompleted && !isFailed && 'ring-1.5 ring-primary/40 ring-inset',
                        isTappable && 'cursor-pointer',
                        // Rocket eligible: 失敗日で救済可能。danger 色域に留めつつロケットで「救える」を示す
                        isRocketEligible && 'cursor-pointer text-danger ring-2 ring-danger ring-offset-1',
                        // Today highlight
                        isToday && !isCompleted && !isFailed && 'font-bold',
                        // Non-interactive
                        !isTappable && !isRocketEligible && 'cursor-default',
                      )}
                      style={
                        isFailed && !isRocketEligible
                          ? failedFillStyle(resistRate)
                          : undefined
                      }
                    >
                      {status === 'rocket_used' ? (
                        <Rocket className="size-3 text-success-foreground" />
                      ) : isRocketEligible ? (
                        <Rocket className="size-3 animate-pulse text-danger" />
                      ) : (
                        dayOfMonth
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </DialogContent>

      {/* Rocket confirmation dialog */}
      <AlertDialog
        open={rocketConfirmDate !== null}
        onOpenChange={(o) => { if (!o) setRocketConfirmDate(null); }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>{tHabits('rocketConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {tHabits('rocketConfirmDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tHabits('rocketConfirmCancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (rocketConfirmDate && habit) {
                  onUseRocket(habit.id, rocketConfirmDate);
                  setRocketConfirmDate(null);
                }
              }}
            >
              {tHabits('rocketConfirmOk')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Evidence Manager Sheet */}
      {onAddEvidence && onRemoveEvidence && onSetWeight && (
        <EvidenceManagerSheet
          open={evidenceManagerOpen}
          onOpenChange={setEvidenceManagerOpen}
          habitId={habit.id}
          evidences={habit.evidences}
          onAddEvidence={onAddEvidence}
          onRemoveEvidence={onRemoveEvidence}
          onSetWeight={onSetWeight}
        />
      )}
    </Dialog>
  );
}
