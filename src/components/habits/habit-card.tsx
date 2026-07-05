'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { Check, ChevronDown, ChevronUp, Maximize2, GripVertical, SkipForward, Undo2 } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { getTodayString } from '@/lib/habits';
import { ImpactBadge } from '@/components/habits/impact-badge';
import { SavingsCard } from '@/components/habits/savings-card';
import type { DayStatus, HabitWithStats } from '@/types/habit';

interface HabitCardProps {
  habit: HabitWithStats;
  isExpanded: boolean;
  onToggleExpand: (id: string) => void;
  onDayStatusChange: (habitId: string, date: string, status: 'completed' | 'failed' | 'none' | 'skipped') => void;
  onOpenDetail: (id: string) => void;
  onOpenVsTemptation: (id: string) => void;
  onSkipToday: (id: string) => void;
}

function nextStatus(current: DayStatus['status']): 'completed' | 'failed' | 'none' {
  if (current === 'none') return 'completed';
  if (current === 'completed' || current === 'rocket_used') return 'failed';
  return 'none';
}

function DayStatusDot({
  day,
  onTap,
}: {
  day: DayStatus;
  onTap: () => void;
}) {
  const { status } = day;

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onTap();
      }}
      className={cn(
        'flex items-center justify-center rounded-full size-3 transition-all',
        (status === 'completed' || status === 'rocket_used') && 'bg-success',
        status === 'failed' && 'bg-[#D08068]',
        status === 'none' && 'border border-gray-300 bg-transparent',
        status === 'skipped' && 'bg-gray-300',
      )}
    />
  );
}

const CELEBRATION_COLORS = ['#4CAF76', '#5BAF7A', '#A8D5BA', '#D4AF37', '#E8C97A', '#7AB89B'];

function CelebrationEffect() {
  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      {CELEBRATION_COLORS.map((color, i) => {
        const angle = (i / CELEBRATION_COLORS.length) * 360;
        const rad = (angle * Math.PI) / 180;
        const tx = Math.cos(rad) * 28;
        const ty = Math.sin(rad) * 28;
        return (
          <span
            key={i}
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 animate-[celebration_600ms_ease-out_forwards]"
            style={{
              '--tx': `${tx}px`,
              '--ty': `${ty}px`,
            } as React.CSSProperties}
          >
            <span
              className="block size-2 rounded-full"
              style={{ backgroundColor: color }}
            />
          </span>
        );
      })}
    </div>
  );
}

function StatusIndicator({
  habit,
  onTapToday,
  onTapVs,
}: {
  habit: HabitWithStats;
  onTapToday?: () => void;
  onTapVs?: () => void;
}) {
  const isQuit = habit.type === 'quit';
  const [showCelebration, setShowCelebration] = useState(false);
  const prevStatusRef = useRef<string | null>(null);

  const todayStatus = habit.recentDays?.[0]?.status ?? 'none';

  // 未完了→完了への遷移を検知して祝福演出を一度だけ表示する意図的パターン。
  useEffect(() => {
    if (
      prevStatusRef.current !== null &&
      prevStatusRef.current !== 'completed' &&
      prevStatusRef.current !== 'rocket_used' &&
      (todayStatus === 'completed' || todayStatus === 'rocket_used')
    ) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- celebration triggered on status transition
      setShowCelebration(true);
      const timer = setTimeout(() => setShowCelebration(false), 700);
      return () => clearTimeout(timer);
    }
    prevStatusRef.current = todayStatus;
  }, [todayStatus]);

  // Quit habits: show urge progress ring (tappable to open VS modal)
  if (isQuit) {
    const current = habit.todayUrgeCount ?? 0;
    const target = habit.dailyTarget;
    const progress = target > 0 ? current / target : 0;
    const radius = 13;
    const circumference = 2 * Math.PI * radius;
    const strokeDashoffset = circumference * (1 - Math.min(progress, 1));
    const isFailed = todayStatus === 'failed';
    const isCompleted = todayStatus === 'completed' || todayStatus === 'rocket_used';
    const isDone = progress >= 1;

    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onTapVs?.();
        }}
        className="relative flex size-8 shrink-0 items-center justify-center cursor-pointer active:scale-90 transition-transform"
      >
        {isFailed ? (
          /* Failed: solid red circle, no progress arc */
          <div className="flex size-8 items-center justify-center rounded-full bg-[#D08068]" />
        ) : (isCompleted || isDone) ? (
          /* Completed: solid green circle */
          <div className="flex size-8 items-center justify-center rounded-full bg-success">
            <span className="text-[9px] font-bold text-white">
              {current}/{target}
            </span>
          </div>
        ) : (
          /* In progress: gray bg ring + green progress arc */
          <>
            <svg width="32" height="32" viewBox="0 0 32 32" className="-rotate-90">
              <circle
                cx="16" cy="16" r={radius}
                fill="none" stroke="#E5E7EB" strokeWidth="2.5"
              />
              <circle
                cx="16" cy="16" r={radius}
                fill="none" stroke="var(--success)" strokeWidth="2.5"
                strokeDasharray={circumference}
                strokeDashoffset={strokeDashoffset}
                strokeLinecap="round"
                className="transition-all duration-300"
              />
            </svg>
            <span className="absolute text-[9px] font-bold text-success">
              {current}/{target}
            </span>
          </>
        )}
      </button>
    );
  }

  // Weekly positive habits: status based on weekly target achievement
  if (!isQuit && habit.frequency === 'weekly') {
    const weeklyDone = (habit.weeklyCompletedCount ?? 0) >= (habit.weeklyTarget ?? 1);

    return (
      <div className="relative flex size-8 shrink-0 items-center justify-center">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onTapToday?.();
          }}
          className={cn(
            'flex size-8 shrink-0 items-center justify-center rounded-full transition-all',
            weeklyDone ? 'bg-success' : 'border-2 border-gray-300',
          )}
        >
          {weeklyDone && (
            <Check className="size-4 text-white" strokeWidth={3} />
          )}
        </button>
        {showCelebration && <CelebrationEffect />}
      </div>
    );
  }

  // Positive habits: tappable circle that toggles today's status
  return (
    <div className="relative flex size-8 shrink-0 items-center justify-center">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onTapToday?.();
        }}
        className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-full transition-all',
          (todayStatus === 'completed' || todayStatus === 'rocket_used') && 'bg-success',
          todayStatus === 'failed' && 'bg-[#D08068]',
          todayStatus === 'none' && 'border-2 border-gray-300',
        )}
      >
        {(todayStatus === 'completed' || todayStatus === 'rocket_used') && (
          <Check className="size-4 text-white" strokeWidth={3} />
        )}
      </button>
      {showCelebration && <CelebrationEffect />}
    </div>
  );
}

export function HabitCard({
  habit,
  isExpanded,
  onToggleExpand,
  onDayStatusChange,
  onOpenDetail,
  onOpenVsTemptation,
  onSkipToday,
}: HabitCardProps) {
  const t = useTranslations('habits');
  const tDays = useTranslations('days');
  const tStats = useTranslations('stats');
  const locale = useLocale();
  const isQuit = habit.type === 'quit';
  const isSkipped = habit.skippedToday;
  const today = getTodayString();
  const dayKeys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
  const dayLabels = dayKeys.map((k) => tDays(k));

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: habit.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const handleDotTap = (day: DayStatus) => {
    onDayStatusChange(habit.id, day.date, nextStatus(day.status));
  };

  const streakPercent = Math.min(Math.round((habit.currentStreak / 30) * 100), 100);

  return (
    <div ref={setNodeRef} style={style} className={cn(isDragging && 'z-50 opacity-80')}>
    <Card className="gap-0 py-0 overflow-hidden transition-all duration-200">
      {/* Collapsed row - always visible */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => onToggleExpand(habit.id)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onToggleExpand(habit.id); }}
        className="flex cursor-pointer items-center gap-3 p-3 w-full text-left"
      >
        {/* Drag handle */}
        <button
          type="button"
          className="touch-none shrink-0 text-gray-300 hover:text-gray-500 dark:text-gray-600 dark:hover:text-gray-400 cursor-grab active:cursor-grabbing"
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical className="size-4" />
        </button>

        {/* Left: Status indicator (tappable for today's toggle) */}
        <StatusIndicator
          habit={habit}
          onTapToday={() => {
            const todayDay = (habit.recentDays ?? [])[0];
            if (todayDay) handleDotTap(todayDay);
          }}
          onTapVs={() => onOpenVsTemptation(habit.id)}
        />

        {/* Center: Name + frequency label + past day dots */}
        <div className="flex-1 min-w-0 flex flex-col gap-1">
          <div className="flex items-baseline gap-2 min-w-0">
            <span className={cn('text-[15px] font-medium truncate', isSkipped && 'text-muted-foreground')}>
              {habit.name}
            </span>
            {habit.frequency === 'weekly' && (
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {t('weeklyProgress', { current: habit.weeklyCompletedCount ?? 0, target: habit.weeklyTarget ?? 1 })}
              </span>
            )}
            {habit.frequency === 'weekday' && (
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {t('weekday')}
              </span>
            )}
            {habit.frequency === 'custom' && habit.customDays && habit.customDays.length > 0 && (
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {[...habit.customDays].sort((a, b) => a - b).map((d) => dayLabels[d]).join('・')}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {/* Past days only (skip index 0 = today), left=yesterday, right=oldest */}
            {(habit.recentDays ?? []).slice(1).map((day) => {
              const dayLabel = new Date(day.date + 'T00:00:00').toLocaleDateString(locale, { weekday: 'narrow' });
              return (
                <div key={day.date} className="flex flex-col items-center gap-0.5">
                  <span className="text-[9px] text-muted-foreground leading-none">{dayLabel}</span>
                  <DayStatusDot day={day} onTap={() => handleDotTap(day)} />
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: Chevron */}
        <div className="shrink-0 text-gray-400">
          {isExpanded ? (
            <ChevronUp className="size-5" />
          ) : (
            <ChevronDown className="size-5" />
          )}
        </div>
      </div>

      {/* Expanded body - smooth height transition via grid trick */}
      <div
        className={cn(
          'grid transition-[grid-template-rows] duration-300 ease-in-out',
          isExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        )}
      >
        <div className="overflow-hidden">
          <div className="px-3 pb-3 pt-0 space-y-3">
            {/* Life Significance */}
            {habit.lifeSignificance && (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold mb-0.5">
                  {t('lifeSignificance')}
                </p>
                <p className="text-sm text-foreground/80">
                  {habit.lifeSignificance}
                </p>
              </div>
            )}

            {/* Impact + Streak (one borderless box) */}
            <div className="rounded-xl bg-success/10 p-3 space-y-3">
              {habit.evidences.length > 0 && (
                <ImpactBadge evidences={habit.evidences} mode="daily" plain />
              )}
              <div>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-success">
                    {habit.currentStreak}
                  </span>
                  <span className="text-sm text-success/70">
                    {tStats('days')}
                  </span>
                  <span className="ml-auto text-xs text-success/60">
                    {t('streakGoal', { percent: streakPercent })}
                  </span>
                </div>
                {/* Progress bar */}
                <div className="mt-2 h-1.5 rounded-full bg-white">
                  <div
                    className="h-full rounded-full bg-success transition-all duration-300"
                    style={{ width: `${streakPercent}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Savings Card */}
            {habit.impactSavings && (
              <SavingsCard savings={habit.impactSavings} />
            )}

            {/* Detail + Skip/Unskip buttons */}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenDetail(habit.id);
                }}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                <Maximize2 className="size-4" />
                {t('detail')}
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onSkipToday(habit.id);
                }}
                className={cn(
                  'flex shrink-0 items-center justify-center gap-1 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                  isSkipped
                    ? 'bg-amber-200 text-amber-800 hover:bg-amber-300 dark:bg-amber-900/50 dark:text-amber-300 dark:hover:bg-amber-900/70'
                    : 'bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:hover:bg-amber-900/50'
                )}
              >
                {isSkipped ? (
                  <>
                    <Undo2 className="size-4" />
                    {t('unskip')}
                  </>
                ) : (
                  <>
                    <SkipForward className="size-4" />
                    {t('skip')}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Card>
    </div>
  );
}
