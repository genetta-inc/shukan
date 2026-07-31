'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { Habit, HabitInsertInput, HabitCompletion, HabitWithStats } from '@/types/habit';
import { useAuth } from '@/components/auth-provider';
import { track } from '@/lib/analytics';
import { getTodayString, getHabitsWithStats } from '@/lib/habits';
import { getArticle } from '@/data/impact-articles';
import {
  fetchHabits,
  fetchCompletions,
  insertHabit,
  updateHabitById,
  deleteHabitById,
  deleteCompletion,
  upsertCompletion,
  redeemRocketOnDate,
  updateHabitSortOrders,
  insertHabitEvidence,
  deleteHabitEvidence,
  updateHabitEvidenceWeight,
  replaceHabitEvidences,
  updateCompletionNote,
  insertEvidenceRequest,
} from '@/lib/supabase/habits';

/** Server Component（(app)/page.tsx）で prefetch した初期データ（issue #59）。 */
export interface InitialHabitData {
  habits: Habit[];
  completions: HabitCompletion[];
}

/**
 * useState 初期値の計算（テスト可能な純関数）。
 * initialData があれば初回レンダリングからデータ入り・loading=false でスピナーを出さない。
 */
export function computeInitialHabitState(initialData?: InitialHabitData | null): {
  habits: Habit[];
  completions: HabitCompletion[];
  loading: boolean;
} {
  return {
    habits: initialData?.habits ?? [],
    completions: initialData?.completions ?? [],
    loading: !initialData,
  };
}

export function useHabits(initialData?: InitialHabitData | null) {
  const { user, loading: authLoading } = useAuth();
  const initial = computeInitialHabitState(initialData);
  const [habits, setHabits] = useState<Habit[]>(initial.habits);
  const [completions, setCompletions] = useState<HabitCompletion[]>(initial.completions);
  const [loading, setLoading] = useState(initial.loading);
  // prefetch は「初回1回だけ」消費する。ログアウト→再ログイン等の再ロードでは使わない。
  const pendingInitialRef = useRef<InitialHabitData | null>(initialData ?? null);
  // onAuthStateChange は同一ユーザーでも毎回新しい user オブジェクトを返すため、
  // 参照ではなく user.id を effect の依存にする（同一ユーザーでの再フェッチを防ぐ）。
  const userId = user?.id ?? null;

  useEffect(() => {
    // auth 解決前に !user 分岐へ入ると、SSR prefetch 済みの state を空で上書きしてしまう。
    // auth の解決を待ってから load / reset を判断する。
    if (authLoading) return;

    if (!userId) {
      pendingInitialRef.current = null;
      setHabits([]);
      setCompletions([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    const prefetched = pendingInitialRef.current;
    pendingInitialRef.current = null;

    async function load() {
      try {
        if (prefetched) {
          // habits/completions は SSR 済み。ここでは再フェッチしない（初回読み込みのみの最適化）。
          return;
        }
        const [h, c] = await Promise.all([fetchHabits(), fetchCompletions()]);
        if (cancelled) return;
        setHabits(h);
        setCompletions(c);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [userId, authLoading]);

  const addHabit = useCallback(
    async (
      habit: HabitInsertInput,
      initialEvidences?: { articleId: string; weight: number }[]
    ) => {
      if (!user) return;
      const newHabit = await insertHabit(user.id, habit);
      if (initialEvidences && initialEvidences.length > 0) {
        const evs = await replaceHabitEvidences(newHabit.id, initialEvidences);
        newHabit.evidences = evs;
      }
      setHabits((prev) => [...prev, newHabit]);
      track('habit_created', {
        habit_type: newHabit.type,
        evidence_count: initialEvidences?.length ?? 0,
      });
      return newHabit;
    },
    [user]
  );

  const updateHabit = useCallback(
    async (
      id: string,
      updates: Partial<Omit<Habit, 'id' | 'createdAt'>>,
      newEvidences?: { articleId: string; weight: number }[]
    ) => {
      await updateHabitById(id, updates);
      if (updates.archived === true) {
        track('habit_archived', { habit_id: id });
      } else {
        track('habit_updated', { habit_id: id });
      }
      // Exclude evidences from optimistic update — evidences are managed via dedicated CRUD
      const safeUpdates = { ...updates };
      delete safeUpdates.evidences;
      setHabits((prev) =>
        prev.map((h) => (h.id === id ? { ...h, ...safeUpdates } : h))
      );
      if (newEvidences) {
        const evs = await replaceHabitEvidences(id, newEvidences);
        setHabits((prev) =>
          prev.map((h) => (h.id === id ? { ...h, evidences: evs } : h))
        );
      }
    },
    []
  );

  const deleteHabit = useCallback(
    async (id: string) => {
      await deleteHabitById(id);
      track('habit_deleted', { habit_id: id });
      setHabits((prev) => prev.filter((h) => h.id !== id));
      setCompletions((prev) => prev.filter((c) => c.habitId !== id));
    },
    []
  );

  const setDayStatus = useCallback(
    async (
      habitId: string,
      date: string,
      status: 'completed' | 'failed' | 'none' | 'skipped',
      opts?: { resistRate?: number }
    ) => {
      if (!user) return;
      try {
        if (status === 'none') {
          await deleteCompletion(habitId, date);
          setCompletions((prev) =>
            prev.filter((c) => !(c.habitId === habitId && c.date === date))
          );
        } else {
          const updated = await upsertCompletion(user.id, habitId, date, status, opts);
          setCompletions((prev) => {
            const filtered = prev.filter((c) => !(c.habitId === habitId && c.date === date));
            return [...filtered, updated];
          });
        }
        track('habit_status_set', {
          habit_id: habitId,
          status,
          is_today: date === getTodayString(),
          ...(opts?.resistRate !== undefined ? { resist_rate: opts.resistRate } : {}),
        });
      } catch (err) {
        console.error('setDayStatus failed:', err);
      }
    },
    [user]
  );

  const useRocket = useCallback(
    async (habitId: string, date: string) => {
      if (!user) return;
      const updated = await redeemRocketOnDate(user.id, habitId, date);
      setCompletions((prev) => {
        const filtered = prev.filter((c) => !(c.habitId === habitId && c.date === date));
        return [...filtered, updated];
      });
      track('rocket_used', { habit_id: habitId });
    },
    [user]
  );

  const addEvidence = useCallback(
    async (habitId: string, articleId: string, weight: number = 100) => {
      const ev = await insertHabitEvidence(habitId, articleId, weight);
      setHabits((prev) =>
        prev.map((h) =>
          h.id === habitId ? { ...h, evidences: [...h.evidences, ev] } : h
        )
      );
      return ev;
    },
    []
  );

  const removeEvidence = useCallback(
    async (habitId: string, evidenceId: string) => {
      await deleteHabitEvidence(evidenceId);
      setHabits((prev) =>
        prev.map((h) =>
          h.id === habitId
            ? { ...h, evidences: h.evidences.filter((e) => e.id !== evidenceId) }
            : h
        )
      );
    },
    []
  );

  const setEvidenceWeight = useCallback(
    async (habitId: string, evidenceId: string, weight: number) => {
      await updateHabitEvidenceWeight(evidenceId, weight);
      setHabits((prev) =>
        prev.map((h) =>
          h.id === habitId
            ? {
                ...h,
                evidences: h.evidences.map((e) =>
                  e.id === evidenceId ? { ...e, weight } : e
                ),
              }
            : h
        )
      );
    },
    []
  );

  /**
   * エビデンス未紐付けの習慣に「エビデンスを追加してほしい」リクエストを送信する（issue #90）。
   * habit_id 単位で冪等なので、既に送信済みでも安全に呼べる（サーバ側で何もしない）。
   */
  const requestEvidence = useCallback(
    async (habitId: string, habitName: string) => {
      if (!user) return;
      const { createdAt } = await insertEvidenceRequest(habitId, user.id, habitName);
      setHabits((prev) =>
        prev.map((h) =>
          h.id === habitId ? { ...h, evidenceRequestedAt: h.evidenceRequestedAt ?? createdAt } : h
        )
      );
    },
    [user]
  );

  const updateNote = useCallback(
    async (habitId: string, date: string, note: string) => {
      try {
        await updateCompletionNote(habitId, date, note);
        setCompletions((prev) =>
          prev.map((c) =>
            c.habitId === habitId && c.date === date ? { ...c, note } : c
          )
        );
      } catch (err) {
        console.error('updateNote failed:', err);
      }
    },
    []
  );

  const reorderHabits = useCallback(
    async (orderedIds: string[]) => {
      const updates = orderedIds.map((id, index) => ({ id, sortOrder: index }));
      // Optimistic update
      setHabits((prev) => {
        const map = new Map(prev.map((h) => [h.id, h]));
        return orderedIds
          .map((id, index) => {
            const habit = map.get(id);
            return habit ? { ...habit, sortOrder: index } : undefined;
          })
          .filter((h): h is Habit => h !== undefined);
      });
      try {
        await updateHabitSortOrders(updates);
      } catch (err) {
        console.error('reorderHabits failed:', err);
        // Reload on error
        const h = await fetchHabits();
        setHabits(h);
      }
    },
    []
  );

  const getStats = useCallback((): HabitWithStats[] => {
    return getHabitsWithStats(habits, completions, getArticle);
  }, [habits, completions]);

  return {
    habits,
    completions,
    loading,
    addHabit,
    updateHabit,
    deleteHabit,
    setDayStatus,
    getStats,
    useRocket,
    reorderHabits,
    addEvidence,
    removeEvidence,
    setEvidenceWeight,
    requestEvidence,
    updateNote,
  };
}
