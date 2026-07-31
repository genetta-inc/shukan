import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * issue #90: エビデンス未紐付けの習慣への「エビデンスを追加してほしい」リクエスト。
 *
 * vitest は environment: 'node' のため、supabase ブラウザクライアントをモックして
 * 「DB へ実際に送られたペイロード」を直接検査する（手本: settings.test.ts）。
 */

interface Row {
  id: string;
  habit_id: string;
  user_id: string;
  habit_name: string;
  created_at: string;
}

// --- フェイク DB（evidence_requests。unique(habit_id) を再現） ---
let rows: Row[] = [];
let nextId = 1;
let calls: { op: 'upsert'; payload: Record<string, unknown>; opts?: unknown }[] = [];

function applyUpsert(payload: Record<string, unknown>, opts: { onConflict?: string; ignoreDuplicates?: boolean }) {
  calls.push({ op: 'upsert', payload, opts });
  const habitId = payload.habit_id as string;
  const conflict = rows.find((r) => r.habit_id === habitId);
  if (conflict) {
    // unique(habit_id) 制約 + ignoreDuplicates: true = on conflict do nothing。新規行は無い。
    if (opts.ignoreDuplicates) return { data: null, error: null };
    return { data: null, error: { message: 'duplicate key value violates unique constraint' } };
  }
  const row: Row = {
    id: `req-${nextId++}`,
    habit_id: habitId,
    user_id: payload.user_id as string,
    habit_name: payload.habit_name as string,
    created_at: `t${nextId}`,
  };
  rows.push(row);
  return { data: row, error: null };
}

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: (table: string) => {
      if (table !== 'evidence_requests') throw new Error(`unexpected table: ${table}`);
      return {
        upsert: (payload: Record<string, unknown>, opts: { onConflict?: string; ignoreDuplicates?: boolean }) => ({
          select: () => ({
            maybeSingle: async () => applyUpsert(payload, opts),
          }),
        }),
      };
    },
  }),
}));

import { insertEvidenceRequest, toHabit, type HabitRow } from './habits';

beforeEach(() => {
  rows = [];
  nextId = 1;
  calls = [];
});

const BASE_HABIT_ROW: HabitRow = {
  id: 'habit-1',
  user_id: 'user-1',
  name: 'カスタム習慣',
  description: null,
  life_significance: null,
  icon: 'star',
  frequency: 'everyday',
  custom_days: null,
  type: 'positive',
  weekly_target: null,
  created_at: '2026-01-01T00:00:00Z',
  archived: false,
  impact_article_id: null,
  sort_order: 0,
  status: 'active',
  established_since: null,
};

describe('#90 insertEvidenceRequest: habit_id 単位の冪等送信', () => {
  it('新規リクエストを1件 insert する（upsert onConflict=habit_id, ignoreDuplicates=true）', async () => {
    const result = await insertEvidenceRequest('habit-1', 'user-1', 'カスタム習慣');

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      habit_id: 'habit-1',
      user_id: 'user-1',
      habit_name: 'カスタム習慣',
    });
    expect(result.createdAt).toBe(rows[0].created_at);

    const call = calls[0];
    expect(call.payload).toMatchObject({
      habit_id: 'habit-1',
      user_id: 'user-1',
      habit_name: 'カスタム習慣',
    });
    expect(call.opts).toMatchObject({ onConflict: 'habit_id', ignoreDuplicates: true });
  });

  it('同一 habit_id への二重送信はエラーにならず、行が増えない（冪等）', async () => {
    await insertEvidenceRequest('habit-1', 'user-1', 'カスタム習慣');
    await expect(insertEvidenceRequest('habit-1', 'user-1', 'カスタム習慣')).resolves.toBeDefined();

    expect(rows).toHaveLength(1); // 2回目は on conflict do nothing で行が増えない
  });

  it('2回目の呼び出しでも createdAt を返す（呼び出し側が「送信済み」表示に使える）', async () => {
    await insertEvidenceRequest('habit-1', 'user-1', 'カスタム習慣');
    const second = await insertEvidenceRequest('habit-1', 'user-1', 'カスタム習慣');

    expect(second.createdAt).toBeTruthy();
  });

  it('異なる habit_id なら別行として insert される', async () => {
    await insertEvidenceRequest('habit-1', 'user-1', 'カスタム習慣A');
    await insertEvidenceRequest('habit-2', 'user-1', 'カスタム習慣B');

    expect(rows).toHaveLength(2);
  });
});

describe('#90 toHabit: evidenceRequestedAt のマッピング', () => {
  // evidence_requests.habit_id は UNIQUE のため PostgREST は 1:1 埋め込みとみなし、
  // 配列ではなく単一オブジェクト（無ければ null）を返す（habit_evidences とは形が違う）。
  it('evidence_requests が null なら undefined', () => {
    const habit = toHabit(BASE_HABIT_ROW, [], null);
    expect(habit.evidenceRequestedAt).toBeUndefined();
  });

  it('evidence_requests が undefined でも undefined', () => {
    const habit = toHabit(BASE_HABIT_ROW, []);
    expect(habit.evidenceRequestedAt).toBeUndefined();
  });

  it('evidence_requests オブジェクトがあれば created_at を反映する', () => {
    const habit = toHabit(BASE_HABIT_ROW, [], {
      id: 'req-1',
      habit_id: 'habit-1',
      user_id: 'user-1',
      habit_name: 'カスタム習慣',
      created_at: '2026-07-25T00:00:00Z',
    });
    expect(habit.evidenceRequestedAt).toBe('2026-07-25T00:00:00Z');
  });
});
