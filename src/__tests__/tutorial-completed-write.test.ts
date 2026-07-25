import { describe, it, expect, vi, beforeEach } from 'vitest';

// issue #117: markTutorialCompleted() が現在ログイン中ユーザーの user_profiles 行に対して
// tutorial_completed_at をカラム単位で update すること（settings.ts / subscriptions-mapping.test.ts
// と同様に supabase ブラウザクライアントをモックして検証する）。

const eqMock = vi.fn(() => ({ error: null }));
const updateMock = vi.fn(() => ({ eq: eqMock }));
const fromMock = vi.fn(() => ({ update: updateMock }));
const getUserMock = vi.fn();

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: fromMock,
    auth: { getUser: getUserMock },
  }),
}));

import { markTutorialCompleted } from '@/lib/supabase/profiles';

beforeEach(() => {
  eqMock.mockClear();
  eqMock.mockReturnValue({ error: null });
  updateMock.mockClear();
  fromMock.mockClear();
  getUserMock.mockReset();
});

describe('markTutorialCompleted', () => {
  it('認証済みユーザーの行を tutorial_completed_at で update する', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'user-123' } } });

    await markTutorialCompleted();

    expect(fromMock).toHaveBeenCalledWith('user_profiles');
    expect(updateMock).toHaveBeenCalledTimes(1);
    const [patch] = updateMock.mock.calls[0];
    expect(typeof patch.tutorial_completed_at).toBe('string');
    // ISO 文字列として解釈できる（now() 相当）
    expect(Number.isNaN(Date.parse(patch.tutorial_completed_at))).toBe(false);
    expect(eqMock).toHaveBeenCalledWith('user_id', 'user-123');
  });

  it('未ログインならエラーを投げ、update を呼ばない', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });

    await expect(markTutorialCompleted()).rejects.toThrow();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('update がエラーを返したら投げる（握り潰さない）', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'user-123' } } });
    eqMock.mockReturnValue({ error: { message: 'boom' } });

    await expect(markTutorialCompleted()).rejects.toBeTruthy();
  });
});
