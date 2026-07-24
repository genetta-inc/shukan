import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import ja from '@/messages/ja.json';
import en from '@/messages/en.json';

/**
 * issue #90: エビデンスリクエスト機能（カスタム習慣→エビデンス化の依頼）。
 *
 * vitest は environment: 'node'（jsdom 無し）のため、JSX の配線検証は
 * fs.readFileSync のソースアサーションで行う（estimate-disclaimers.test.ts と同じ手本）。
 */

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
function readSource(rel: string): string {
  return readFileSync(resolve(projectRoot, rel), 'utf-8');
}

const evidenceJa = (ja as unknown as { evidence: Record<string, string> }).evidence;
const evidenceEn = (en as unknown as { evidence: Record<string, string> }).evidence;

describe('文言キー（ja/en 両対応）', () => {
  it('ja: リクエスト送信・送信済み・エラーの3文言が揃っている', () => {
    expect(evidenceJa.requestEvidence).toBeTruthy();
    expect(evidenceJa.requestEvidenceSubmitted).toBeTruthy();
    expect(evidenceJa.requestEvidenceError).toBeTruthy();
  });

  it('en: リクエスト送信・送信済み・エラーの3文言が揃っている', () => {
    expect(evidenceEn.requestEvidence).toBeTruthy();
    expect(evidenceEn.requestEvidenceSubmitted).toBeTruthy();
    expect(evidenceEn.requestEvidenceError).toBeTruthy();
  });
});

describe('habit-detail-modal: エビデンス未紐付け習慣へのリクエスト導線', () => {
  const src = readSource('src/components/habits/habit-detail-modal.tsx');

  it('onRequestEvidence prop を受け取る', () => {
    expect(src).toContain('onRequestEvidence');
  });

  it('habit.evidences が空のときだけリクエスト UI を出す', () => {
    expect(src).toContain('habit.evidences.length === 0 && onRequestEvidence');
  });

  it('送信済み（evidenceRequestedAt あり）なら送信済み表示に切り替わる', () => {
    expect(src).toContain('habit.evidenceRequestedAt');
    expect(src).toContain("tEvidence('requestEvidenceSubmitted')");
  });

  it('送信失敗時にエラー文言を表示する', () => {
    expect(src).toContain('requestEvidenceError');
    expect(src).toContain("tEvidence('requestEvidenceError')");
  });
});

describe('dashboard-client: useHabits.requestEvidence を HabitDetailModal に配線', () => {
  const src = readSource('src/components/dashboard/dashboard-client.tsx');

  it('requestEvidence を分割代入で受け取り onRequestEvidence に渡す', () => {
    expect(src).toContain('requestEvidence,');
    expect(src).toContain('onRequestEvidence={requestEvidence}');
  });
});

describe('useHabits: requestEvidence フック', () => {
  const src = readSource('src/hooks/useHabits.ts');

  it('insertEvidenceRequest を呼び、evidenceRequestedAt を楽観更新する', () => {
    expect(src).toContain('insertEvidenceRequest');
    expect(src).toContain('evidenceRequestedAt');
  });

  it('requestEvidence を戻り値に含める', () => {
    expect(src).toMatch(/return \{[\s\S]*requestEvidence,[\s\S]*\}/);
  });
});
