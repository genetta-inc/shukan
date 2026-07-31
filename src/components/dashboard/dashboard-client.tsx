'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { HabitList } from '@/components/habits/habit-list';
import { HabitForm } from '@/components/habits/habit-form';
import { HabitActions } from '@/components/habits/habit-actions';
import { HabitDetailModal } from '@/components/habits/habit-detail-modal';
import { HabitActionSheet } from '@/components/habits/habit-action-sheet';
import { HabitBulkEditSheet } from '@/components/habits/habit-bulk-edit-sheet';
import { EvidenceArticleSheet } from '@/components/habits/evidence-article-sheet';
import { DailyImpactSummary } from '@/components/habits/daily-impact-summary';
import { EstablishedSection } from '@/components/habits/established-section';
import { YesterdayReviewBanner } from '@/components/habits/yesterday-review-banner';
import { YesterdayReviewSheet } from '@/components/habits/yesterday-review-sheet';
import { HelpButton } from '@/components/help/help-button';
import { useHabits, type InitialHabitData } from '@/hooks/useHabits';
import { useProfile } from '@/hooks/useProfile';
import { getHabitsWithStats, getTodayString, getYesterdayUnreviewedHabits, isDailyTrackedHabit, isEstablishedHabit } from '@/lib/habits';
import { getArticle } from '@/data/impact-articles';
import { useAuth } from '@/components/auth-provider';
import { useSubscription } from '@/hooks/useSubscription';
import { shouldBlockCreateHabit } from '@/lib/billing/create-habit-gate';
import { upsertDailyReflection } from '@/lib/supabase/habits';
import { track } from '@/lib/analytics';
import { emitTutorialEvent } from '@/lib/tutorial';
import { InstallBanner } from '@/components/pwa/install-banner';
import { isCompletionTransition, type DayStatus as PwaDayStatus } from '@/lib/pwa/completion';
import type { Habit, HabitInsertInput } from '@/types/habit';

/**
 * ホーム画面の本体（'use client'）。旧 (app)/page.tsx をそのまま移設したもの（issue #59）。
 * initialData は (app)/page.tsx（async Server Component）が RLS 有効の server クライアントで
 * prefetch した habits + completions。null なら従来のクライアントフェッチにフォールバックする。
 */
export function DashboardClient({
  initialData,
}: {
  initialData?: InitialHabitData | null;
}) {
  const t = useTranslations();
  const { user } = useAuth();
  const { subscription } = useSubscription();
  const { profile } = useProfile();
  const {
    habits,
    completions,
    loading,
    addHabit,
    updateHabit,
    deleteHabit,
    setDayStatus,
    useRocket,
    reorderHabits,
    addEvidence,
    removeEvidence,
    setEvidenceWeight,
    updateNote,
  } = useHabits(initialData);
  const [formOpen, setFormOpen] = useState(false);
  const [reviewSheetOpen, setReviewSheetOpen] = useState(false);
  const [reviewHabits, setReviewHabits] = useState<Habit[]>([]);
  const [editingHabit, setEditingHabit] = useState<Habit | null>(null);
  const [actionsHabitId, setActionsHabitId] = useState<string | null>(null);
  const [detailHabitId, setDetailHabitId] = useState<string | null>(null);
  // 長押しアクションシートの対象（issue #104）。habitId + 対象日（過去日も来る）
  const [actionSheetTarget, setActionSheetTarget] = useState<{ habitId: string; date: string } | null>(null);
  // 過去日の一括編集シートの対象習慣（issue #107）。週ドット領域タップ・展開ビューのボタンで開く
  const [bulkEditTarget, setBulkEditTarget] = useState<string | null>(null);
  const [openArticleId, setOpenArticleId] = useState<string | null>(null);

  // 3場面構造: デイリーチェックリスト・積み上げ表示は active（デイリー追跡）習慣のみ。
  // established（身についた）習慣はチェックリスト・PWA day-status・DailyImpactSummary から外し、
  // 下部の「身についた習慣」セクションに生涯効果として表示する。
  const todayHabits = useMemo(() => {
    const filtered = habits.filter(isDailyTrackedHabit);
    return getHabitsWithStats(filtered, completions, getArticle);
  }, [habits, completions]);

  const establishedHabits = useMemo(
    () => habits.filter(isEstablishedHabit),
    [habits]
  );

  // --- PWA install banner trigger ---------------------------------------
  // Detect the moment a habit transitions into a completed state (this session
  // only). We snapshot each habit's today-status across renders; on the first
  // render (no snapshot yet) nothing fires, so reload/revisit with
  // completedCount > 0 never shows the banner. justCompleted lives in React
  // state only (never persisted) → reload always resets to false.
  const prevStatusMapRef = useRef<Map<string, PwaDayStatus> | null>(null);
  const [justCompleted, setJustCompleted] = useState(false);

  useEffect(() => {
    const nextMap = new Map<string, PwaDayStatus>();
    for (const h of todayHabits) {
      nextMap.set(h.id, (h.recentDays?.[0]?.status ?? 'none') as PwaDayStatus);
    }
    const prevMap = prevStatusMapRef.current;
    // Skip the very first render: no transition can be observed yet.
    if (prevMap) {
      for (const [id, next] of nextMap) {
        if (isCompletionTransition(prevMap.get(id), next)) {
          // Intentional: this effect's sole purpose is to detect a status
          // transition across renders (impossible to derive synchronously) and
          // flip the trigger flag. Behaviour is core to the PWA banner spec.
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setJustCompleted(true);
          break;
        }
      }
    }
    prevStatusMapRef.current = nextMap;
  }, [todayHabits]);

  // Compute yesterday's date client-side only to avoid SSR timezone mismatch
  // (Vercel SSR runs in UTC, but user is in JST — causes 1-day offset between 00:00-08:59 JST)
  const [yesterdayDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  });

  const yesterdayUnreviewed = useMemo(
    () => yesterdayDate ? getYesterdayUnreviewedHabits(habits.filter(isDailyTrackedHabit), completions, yesterdayDate) : [],
    [habits, completions, yesterdayDate]
  );

  const handleSaveReflection = useCallback(
    async (mood: number | undefined, comment: string) => {
      if (!user) return;
      if (mood !== undefined || comment.trim()) {
        await upsertDailyReflection(user.id, yesterdayDate, { mood, comment });
        track('reflection_saved', {
          mood: mood ?? null,
          has_comment: !!comment.trim(),
        });
      }
    },
    [user, yesterdayDate]
  );

  const activeHabits = todayHabits.filter((h) => !h.skippedToday);
  const completedCount = activeHabits.filter((h) => h.completedToday).length;
  const totalCount = activeHabits.length;
  const progressPercent = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;
  // エッセンス②: ステータスヘッダーの連続日数要素。継続中の習慣のうち最長の currentStreak を
  // 導出して「◯日連続（継続中の最長）」として一等地の脇に添える（造語・ストリーク不使用）。
  const maxStreak = activeHabits.reduce((m, h) => Math.max(m, h.currentStreak ?? 0), 0);

  const actionsHabit = useMemo(
    () => todayHabits.find((h) => h.id === actionsHabitId),
    [todayHabits, actionsHabitId]
  );

  const detailHabit = useMemo(
    () => todayHabits.find((h) => h.id === detailHabitId) ?? null,
    [todayHabits, detailHabitId]
  );

  const actionSheetHabit = useMemo(
    () => todayHabits.find((h) => h.id === actionSheetTarget?.habitId) ?? null,
    [todayHabits, actionSheetTarget]
  );

  const bulkEditHabit = useMemo(
    () => todayHabits.find((h) => h.id === bulkEditTarget) ?? null,
    [todayHabits, bulkEditTarget]
  );

  const actionSheetCompletion = useMemo(
    () =>
      actionSheetTarget
        ? completions.find(
            (c) => c.habitId === actionSheetTarget.habitId && c.date === actionSheetTarget.date
          ) ?? null
        : null,
    [completions, actionSheetTarget]
  );

  const handleAdd = useCallback(() => {
    // Gate the `create_habit` action behind entitlement (change-A S24). Entitled
    // users and active-trial users keep the original UX (the form opens); when the
    // gate applies, route to the billing/confirmation flow instead of opening it.
    if (shouldBlockCreateHabit(subscription)) {
      window.location.href = '/account?upgrade=1';
      return;
    }
    setEditingHabit(null);
    setFormOpen(true);
  }, [subscription]);

  const handleEdit = useCallback(
    (id: string) => {
      const habit = habits.find((h) => h.id === id);
      if (habit) {
        setEditingHabit(habit);
        setFormOpen(true);
      }
    },
    [habits]
  );

  const handleSubmit = useCallback(
    (
      data: HabitInsertInput,
      initialEvidences?: { articleId: string; weight: number }[]
    ) => {
      if (editingHabit) {
        updateHabit(editingHabit.id, data, initialEvidences);
      } else {
        addHabit(data, initialEvidences);
      }
      setEditingHabit(null);
    },
    [editingHabit, addHabit, updateHabit]
  );

  const handleOpenDetail = useCallback((id: string) => {
    setDetailHabitId(id);
  }, []);

  const handleOpenActionSheet = useCallback((habitId: string, date: string) => {
    setActionSheetTarget({ habitId, date });
    emitTutorialEvent('action-sheet-open');
  }, []);

  // チュートリアル用: メインリストの達成トグルを横取りせず通知だけ添える
  const handleDayStatusChange = useCallback<typeof setDayStatus>(
    async (habitId, date, status, opts) => {
      await setDayStatus(habitId, date, status, opts);
      if (status === 'completed') emitTutorialEvent('habit-completed');
      else if (status === 'none') emitTutorialEvent('habit-uncompleted');
    },
    [setDayStatus]
  );

  const handleOpenBulkEdit = useCallback((habitId: string) => {
    setBulkEditTarget(habitId);
  }, []);

  // 一括編集シートの行末「…」→ 一括を閉じてその日1日分のアクションシートへ（一方向遷移）
  const handleOpenDayActions = useCallback((habitId: string, date: string) => {
    setBulkEditTarget(null);
    setActionSheetTarget({ habitId, date });
  }, []);

  const handleDelete = useCallback(() => {
    if (actionsHabitId) {
      deleteHabit(actionsHabitId);
      setActionsHabitId(null);
    }
  }, [actionsHabitId, deleteHabit]);

  const handleArchive = useCallback(() => {
    if (actionsHabitId) {
      updateHabit(actionsHabitId, { archived: true });
      setActionsHabitId(null);
    }
  }, [actionsHabitId, updateHabit]);

  const handleSkipToday = useCallback(
    (id: string) => {
      const today = getTodayString();
      const habit = todayHabits.find((h) => h.id === id);
      setDayStatus(id, today, habit?.skippedToday ? 'none' : 'skipped');
    },
    [todayHabits, setDayStatus]
  );

  const handleFormDelete = useCallback(() => {
    if (editingHabit) {
      deleteHabit(editingHabit.id);
      setEditingHabit(null);
      setFormOpen(false);
    }
  }, [editingHabit, deleteHabit]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="size-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* エッセンス②: 静的タイトル「今日の習慣」を廃し、動的ステータスヘッダーへ。
          一等地に画面最大タイポの達成数（Geist Mono / tabular-nums）を置き、視線の勝者を
          「今日の状態（数値）」にする。緑は達成＝意味にだけ載せ、分母・ラベルは無彩色。 */}
      {totalCount > 0 ? (
        <header>
          <div className="flex items-end justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-1">
                <p className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  {t('habits.todayProgress')}
                </p>
                <HelpButton topic="todayProgress" className="size-4" iconClassName="size-3.5" />
              </div>
              <div className="mt-0.5 flex items-baseline leading-none">
                <span className="font-mono text-[72px] font-semibold leading-[0.85] tracking-tighter tabular-nums text-success">
                  {completedCount}
                </span>
                <span className="font-mono text-[40px] font-medium leading-none tracking-tight tabular-nums text-muted-foreground">
                  /{totalCount}
                </span>
              </div>
            </div>
            {maxStreak > 0 && (
              <div className="shrink-0 pb-1.5 text-right">
                <div className="flex items-baseline justify-end gap-0.5">
                  <span className="font-mono text-[26px] font-semibold leading-none tabular-nums text-success">
                    {maxStreak}
                  </span>
                  <span className="text-sm text-muted-foreground">{t('habits.daysStreakUnit')}</span>
                </div>
                <div className="mt-1 flex items-center justify-end gap-1">
                  <p className="text-[11px] leading-none text-muted-foreground">
                    {t('habits.longestStreakCaption')}
                  </p>
                  <HelpButton topic="streak" className="size-4" iconClassName="size-3.5" />
                </div>
              </div>
            )}
          </div>

          {/* 進捗バー: 緑＝積み上げ（ポジティブ）の意味で使用 */}
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-success transition-all duration-500 ease-out"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </header>
      ) : (
        <h2 className="text-[28px] font-bold leading-tight tracking-tight">
          {t('habits.title')}
        </h2>
      )}

      <DailyImpactSummary habits={todayHabits} />

      {yesterdayUnreviewed.length > 0 && (
        <YesterdayReviewBanner
          unreviewedCount={yesterdayUnreviewed.length}
          onOpen={() => {
            setReviewHabits(habits.filter(isDailyTrackedHabit));
            setReviewSheetOpen(true);
          }}
        />
      )}

      <HabitList
        habits={todayHabits}
        onDayStatusChange={handleDayStatusChange}
        onAdd={handleAdd}
        onOpenDetail={handleOpenDetail}
        onOpenActionSheet={handleOpenActionSheet}
        onOpenBulkEdit={handleOpenBulkEdit}
        onReorder={reorderHabits}
        onSkipToday={handleSkipToday}
        onOpenArticle={(articleId) => setOpenArticleId(articleId)}
      />

      <EstablishedSection habits={establishedHabits} profile={profile} />

      <HabitForm
        open={formOpen}
        onOpenChange={setFormOpen}
        onSubmit={handleSubmit}
        onDelete={editingHabit ? handleFormDelete : undefined}
        initialData={editingHabit ?? undefined}
      />

      <HabitActions
        open={!!actionsHabitId}
        onOpenChange={(open) => !open && setActionsHabitId(null)}
        habitName={actionsHabit?.name ?? ''}
        onEdit={() => {
          if (actionsHabitId) {
            handleEdit(actionsHabitId);
            setActionsHabitId(null);
          }
        }}
        onArchive={handleArchive}
        onDelete={handleDelete}
      />

      <HabitDetailModal
        open={!!detailHabitId}
        onOpenChange={(open) => !open && setDetailHabitId(null)}
        habit={detailHabit}
        onUseRocket={useRocket}
        onDayStatusChange={setDayStatus}
        onEdit={(id) => {
          setDetailHabitId(null);
          handleEdit(id);
        }}
        onOpenArticle={(articleId) => setOpenArticleId(articleId)}
        onAddEvidence={addEvidence}
        onRemoveEvidence={removeEvidence}
        onSetWeight={setEvidenceWeight}
      />

      <HabitActionSheet
        open={!!actionSheetTarget}
        onOpenChange={(open) => {
          if (!open) {
            setActionSheetTarget(null);
            emitTutorialEvent('action-sheet-closed');
          }
        }}
        habit={actionSheetHabit}
        date={actionSheetTarget?.date ?? null}
        currentStatus={(actionSheetCompletion?.status ?? 'none') as 'completed' | 'failed' | 'none' | 'rocket_used' | 'skipped'}
        currentNote={actionSheetCompletion?.note ?? ''}
        onSetStatus={(status, opts) => {
          if (actionSheetTarget) {
            setDayStatus(actionSheetTarget.habitId, actionSheetTarget.date, status, opts);
          }
        }}
        onSaveNote={(note) => {
          if (actionSheetTarget) {
            updateNote(actionSheetTarget.habitId, actionSheetTarget.date, note);
          }
        }}
      />

      <HabitBulkEditSheet
        open={!!bulkEditTarget}
        onOpenChange={(open) => !open && setBulkEditTarget(null)}
        habit={bulkEditHabit}
        onSetDayStatus={setDayStatus}
        onOpenDayActions={handleOpenDayActions}
      />

      <EvidenceArticleSheet
        open={!!openArticleId}
        onOpenChange={(open) => !open && setOpenArticleId(null)}
        articleId={openArticleId}
        habits={habits}
        completions={completions}
      />

      <YesterdayReviewSheet
        open={reviewSheetOpen}
        onOpenChange={setReviewSheetOpen}
        habits={reviewHabits}
        completions={completions}
        yesterdayDate={yesterdayDate}
        onDayStatusChange={setDayStatus}
        onNoteChange={updateNote}
        onSaveReflection={handleSaveReflection}
      />

      {/* PWA install banner: non-modal, pinned above the BottomNav (h-16).
          Shown only on the render right after a habit completes. */}
      <div className="fixed inset-x-0 bottom-16 z-30 mx-auto w-full max-w-2xl px-4 pb-2 md:bottom-2">
        <InstallBanner
          justCompleted={justCompleted}
          onDismiss={() => setJustCompleted(false)}
        />
      </div>
    </div>
  );
}
