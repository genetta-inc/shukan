'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/components/auth-provider';
import {
  getSubscriptionForUser,
  type SubscriptionRecord,
} from '@/lib/supabase/subscriptions';
import { isEntitled } from '@/lib/billing/entitlement';

interface UseSubscriptionResult {
  subscription: SubscriptionRecord | null;
  entitled: boolean;
  loading: boolean;
}

/**
 * Reads the current user's subscription from Supabase (the source of truth,
 * design D4) and derives entitlement. UI never queries Stripe directly.
 */
export function useSubscription(): UseSubscriptionResult {
  const { user, loading: authLoading } = useAuth();
  const [subscription, setSubscription] = useState<SubscriptionRecord | null>(null);
  const [loading, setLoading] = useState(true);

  // onAuthStateChange は同一ユーザーでも毎回新しい user オブジェクト参照を返すため、
  // 参照ではなくプリミティブな user.id を effect の依存にする（#79 / useHabits と同じパターン）。
  const userId = user?.id;

  useEffect(() => {
    let cancelled = false;
    if (authLoading) return;

    const load = userId
      ? getSubscriptionForUser(userId).catch(() => null)
      : Promise.resolve(null);

    load.then((sub) => {
      if (cancelled) return;
      setSubscription(sub);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [userId, authLoading]);

  return {
    subscription,
    entitled: isEntitled(subscription),
    loading: loading || authLoading,
  };
}
