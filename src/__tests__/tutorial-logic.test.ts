import { describe, it, expect } from 'vitest';
import {
  TUTORIAL_STEPS,
  progressOf,
  resolveAutoStart,
  stepIndexById,
} from '@/lib/tutorial';

describe('tutorial steps', () => {
  it('welcome から始まり create で終わる', () => {
    expect(TUTORIAL_STEPS[0].id).toBe('welcome');
    expect(TUTORIAL_STEPS[TUTORIAL_STEPS.length - 1].id).toBe('create');
  });

  it('ホーム上の実操作ステップは habit-status を指し、習慣0件時の逃げ先を持つ', () => {
    for (const id of ['complete', 'undo', 'longpress'] as const) {
      const step = TUTORIAL_STEPS[stepIndexById(id)];
      expect(step.selector).toBe('[data-tutorial="habit-status"]');
      expect(step.interactive).toBe(true);
      expect(step.skipToOnMissing).toBe('discover');
    }
  });

  it('発見タブへの遷移ステップは route 進行', () => {
    const step = TUTORIAL_STEPS[stepIndexById('discover')];
    expect(step.advance).toEqual({ type: 'route', route: '/discover' });
    expect(step.interactive).toBe(true);
  });

  it('説明のみのステップは穴を塞ぐ（誤タップでモーダルが開かない）', () => {
    for (const id of ['articles', 'create'] as const) {
      expect(TUTORIAL_STEPS[stepIndexById(id)].interactive).toBe(false);
    }
  });

  it('progressOf は welcome を除いた 1 始まりの進捗を返す', () => {
    expect(progressOf(0)).toEqual({ current: 0, total: TUTORIAL_STEPS.length - 1 });
    expect(progressOf(1)).toEqual({ current: 1, total: TUTORIAL_STEPS.length - 1 });
    expect(progressOf(TUTORIAL_STEPS.length - 1)).toEqual({
      current: TUTORIAL_STEPS.length - 1,
      total: TUTORIAL_STEPS.length - 1,
    });
  });

  it('skipToOnMissing の飛び先はすべて実在するステップ id', () => {
    for (const step of TUTORIAL_STEPS) {
      if (step.skipToOnMissing) {
        expect(stepIndexById(step.skipToOnMissing)).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

// resolveAutoStart: DB を正、localStorage を高速パスキャッシュとする起動判定（issue #117）。
// DOM/ネットワークに触れない純関数なので node 環境でそのまま検証できる。
describe('resolveAutoStart', () => {
  it('DB 上で未完了（tutorialCompletedAt: null）かつローカルが pending なら起動する', () => {
    const decision = resolveAutoStart({
      localState: 'pending',
      dbLookup: { tutorialCompletedAt: null },
    });
    expect(decision).toEqual({ start: true, shouldSyncDb: false, cacheAsDone: false });
  });

  it('DB 上で未完了かつローカルが null（新規ユーザー・localStorage未設定）でも起動する', () => {
    const decision = resolveAutoStart({
      localState: null,
      dbLookup: { tutorialCompletedAt: null },
    });
    expect(decision.start).toBe(true);
  });

  it('別端末で既に完走済み（DB に tutorialCompletedAt あり）なら、ローカルが未設定でも起動しない', () => {
    const decision = resolveAutoStart({
      localState: null,
      dbLookup: { tutorialCompletedAt: '2026-07-20T00:00:00.000Z' },
    });
    expect(decision.start).toBe(false);
  });

  it('既存プロファイル（バックフィル済み）は自動起動しない', () => {
    const decision = resolveAutoStart({
      localState: 'pending',
      dbLookup: { tutorialCompletedAt: '2026-07-25T10:00:00.000Z' },
    });
    expect(decision.start).toBe(false);
  });

  it('DB 完了済みが判明したらローカルキャッシュを done へ昇格する（高速パス化）', () => {
    const decision = resolveAutoStart({
      localState: 'pending',
      dbLookup: { tutorialCompletedAt: '2026-07-20T00:00:00.000Z' },
    });
    expect(decision.cacheAsDone).toBe(true);
  });

  it('ローカルが既に done のときは cacheAsDone を要求しない（無駄な書き込み回避）', () => {
    const decision = resolveAutoStart({
      localState: 'done',
      dbLookup: { tutorialCompletedAt: '2026-07-20T00:00:00.000Z' },
    });
    expect(decision.cacheAsDone).toBe(false);
  });

  it('done-unsynced（この端末で完了済みだが DB 未確認）かつ DB 側も未完了なら、起動せず再送のみ試みる', () => {
    const decision = resolveAutoStart({
      localState: 'done-unsynced',
      dbLookup: { tutorialCompletedAt: null },
    });
    expect(decision).toEqual({ start: false, shouldSyncDb: true, cacheAsDone: false });
  });

  it('done-unsynced で DB 側は既に完了済み（別経路で同期済み）なら再送不要', () => {
    const decision = resolveAutoStart({
      localState: 'done-unsynced',
      dbLookup: { tutorialCompletedAt: '2026-07-20T00:00:00.000Z' },
    });
    expect(decision.start).toBe(false);
    expect(decision.shouldSyncDb).toBe(false);
  });

  it('DB 参照失敗時はローカル pending のみで起動判定する（フォールバック）', () => {
    expect(resolveAutoStart({ localState: 'pending', dbLookup: 'error' }).start).toBe(true);
    expect(resolveAutoStart({ localState: null, dbLookup: 'error' }).start).toBe(false);
  });

  it('DB 参照失敗時、done-unsynced は再起動しない（この端末では既に完了済みのため）', () => {
    const decision = resolveAutoStart({ localState: 'done-unsynced', dbLookup: 'error' });
    expect(decision.start).toBe(false);
    expect(decision.shouldSyncDb).toBe(false);
  });

  it('DB 参照失敗時は DB 書き込み・ローカルキャッシュ更新のいずれも要求しない', () => {
    const decision = resolveAutoStart({ localState: 'pending', dbLookup: 'error' });
    expect(decision.shouldSyncDb).toBe(false);
    expect(decision.cacheAsDone).toBe(false);
  });
});
