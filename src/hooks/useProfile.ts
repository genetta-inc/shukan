'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/components/auth-provider';
import {
  fetchUserProfile,
  upsertUserProfile,
  type UserProfile,
  type UserProfileInput,
} from '@/lib/supabase/profiles';

/**
 * ログイン中ユーザーのプロフィール（user_profiles）を読み書きするフック（change-5）。
 *   - マウント時に fetchUserProfile で読み出す（行が無ければ null）
 *   - save() で upsertUserProfile して state を更新する（設定画面の保存）
 *
 * プロフィール未設定（null）はエラーにせず、消費側で既定値にフォールバックする。
 */
export function useProfile() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  // onAuthStateChange は同一ユーザーでも毎回新しい user オブジェクト参照を返すため、
  // 参照ではなくプリミティブな user.id を effect の依存にする（#79 / useHabits と同じパターン）。
  const userId = user?.id;

  useEffect(() => {
    if (!userId) {
      setProfile(null);
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function load() {
      try {
        const p = await fetchUserProfile();
        if (!cancelled) setProfile(p);
      } catch {
        // 読み出し失敗時は null 扱い（既定値フォールバック）。
        if (!cancelled) setProfile(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    setLoading(true);
    load();

    return () => {
      cancelled = true;
    };
  }, [userId]);

  const save = useCallback(
    async (input: UserProfileInput): Promise<UserProfile | null> => {
      if (!user) return null;
      const saved = await upsertUserProfile(user.id, input);
      setProfile(saved);
      return saved;
    },
    [user]
  );

  return { profile, loading, save };
}
