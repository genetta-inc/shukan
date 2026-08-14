'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/components/auth-provider';
import { getMonthlyReflections, getMonthlyCompletions } from '@/lib/supabase/habits';
import type { DailyReflection } from '@/types/habit';
import type { MonthlyHabitCompletion } from '@/lib/supabase/habits';

export function useReviewHistory() {
  const { user } = useAuth();
  const now = new Date();

  const [displayYear, setDisplayYear] = useState(now.getFullYear());
  const [displayMonth, setDisplayMonth] = useState(now.getMonth() + 1);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [reflections, setReflections] = useState<DailyReflection[]>([]);
  const [completions, setCompletions] = useState<MonthlyHabitCompletion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // onAuthStateChange は同一ユーザーでも毎回新しい user オブジェクト参照を返すため、
  // 参照ではなくプリミティブな user.id を effect の依存にする（#79 / useHabits と同じパターン）。
  const userId = user?.id;

  useEffect(() => {
    if (!userId) return;
    // ガードで narrowing 済みの string をローカルに束縛する
    // （hoisting される function 宣言内には narrowing が伝播しないため）。
    const uid = userId;

    let cancelled = false;

    async function fetchMonthData() {
      setLoading(true);
      setError(null);
      try {
        const [refs, comps] = await Promise.all([
          getMonthlyReflections(uid, displayYear, displayMonth),
          getMonthlyCompletions(uid, displayYear, displayMonth),
        ]);
        if (!cancelled) {
          setReflections(refs);
          setCompletions(comps);
        }
      } catch (err) {
        console.error('[useReviewHistory] fetch failed:', err);
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load data');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchMonthData();
    return () => {
      cancelled = true;
    };
  }, [userId, displayYear, displayMonth]);

  const navigateMonth = useCallback((delta: number) => {
    setSelectedDate(null);
    setDisplayYear((year) => {
      // We need the current month to compute the new year/month.
      // Use a functional update on displayMonth, but we can't read it directly in this callback.
      // Instead we compute directly using the React state setter functional form for displayMonth.
      let newYear = year;
      setDisplayMonth((month) => {
        const d = new Date(year, month - 1 + delta, 1);
        newYear = d.getFullYear();
        return d.getMonth() + 1;
      });
      return newYear;
    });
  }, []);

  const goToPrevMonth = useCallback(() => navigateMonth(-1), [navigateMonth]);
  const goToNextMonth = useCallback(() => navigateMonth(1), [navigateMonth]);

  const selectDate = useCallback((date: string) => {
    setSelectedDate((prev) => (prev === date ? null : date));
  }, []);

  const today = new Date();
  const isCurrentMonth =
    displayYear === today.getFullYear() && displayMonth === today.getMonth() + 1;

  return {
    displayYear,
    displayMonth,
    selectedDate,
    reflections,
    completions,
    loading,
    error,
    isCurrentMonth,
    goToPrevMonth,
    goToNextMonth,
    selectDate,
  };
}
