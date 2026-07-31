import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import ja from '@/messages/ja.json';
import en from '@/messages/en.json';

// issue #91: 30日継続到達時の「卒業」提案導線。
// jsdom 非対応のため component render テストは書けない。既存 marketing-page.test.tsx /
// estimate-disclaimers.test.ts と同じ「ソース文字列アサーション」方式で検証する。

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
function readSource(rel: string): string {
  return readFileSync(resolve(projectRoot, rel), 'utf-8');
}

const habitsJa = (ja as unknown as { habits: Record<string, string> }).habits;
const habitsEn = (en as unknown as { habits: Record<string, string> }).habits;

describe('i18n: 卒業提案の文言キー（ja/en 両対応, AC#4）', () => {
  it('ja/en の両方に4つの文言キーが揃っている', () => {
    for (const key of [
      'graduationProposalTitle',
      'graduationProposalBody',
      'graduationAccept',
      'graduationDecline',
    ]) {
      expect(habitsJa[key], `ja.habits.${key}`).toBeTruthy();
      expect(habitsEn[key], `en.habits.${key}`).toBeTruthy();
    }
  });

  it('ja の文言に禁止語「ストリーク」を含まない（issue #85 / CLAUDE.md 用語ルール）', () => {
    expect(habitsJa.graduationProposalTitle).not.toContain('ストリーク');
    expect(habitsJa.graduationProposalBody).not.toContain('ストリーク');
    expect(habitsJa.graduationAccept).not.toContain('ストリーク');
    expect(habitsJa.graduationDecline).not.toContain('ストリーク');
  });

  it('ja の本文は「連続日数」系の言い回し（◯日連続 等）で日数に言及する', () => {
    expect(habitsJa.graduationProposalBody).toMatch(/連続/);
  });

  it('本文は習慣名({name})と日数({days})を差し込むプレースホルダを持つ', () => {
    expect(habitsJa.graduationProposalBody).toContain('{name}');
    expect(habitsJa.graduationProposalBody).toContain('{days}');
    expect(habitsEn.graduationProposalBody).toContain('{name}');
    expect(habitsEn.graduationProposalBody).toContain('{days}');
  });
});

describe('GraduationProposalSheet コンポーネント', () => {
  const src = readSource('src/components/habits/graduation-proposal-sheet.tsx');

  it('Sheet プリミティブ（既存 yesterday-review-sheet.tsx と同じ構造）を使う', () => {
    expect(src).toContain("from '@/components/ui/sheet'");
    expect(src).toContain('side="bottom"');
  });

  it('文言は messages キー経由で参照する（ハードコードしない）', () => {
    expect(src).toContain("t('graduationProposalTitle'");
    expect(src).toContain("t('graduationProposalBody'");
    expect(src).toContain("t('graduationAccept')");
    expect(src).toContain("t('graduationDecline')");
  });

  it('accept/decline の2つのコールバック props を持つ（卒業する/まだ続ける）', () => {
    expect(src).toMatch(/onAccept/);
    expect(src).toMatch(/onDecline/);
  });
});

describe('dashboard-client.tsx: 卒業提案シートの配線', () => {
  const src = readSource('src/components/dashboard/dashboard-client.tsx');

  it('GraduationProposalSheet を import して描画する', () => {
    expect(src).toContain('GraduationProposalSheet');
  });

  it('連続日数30到達の遷移検知に hasJustReachedGraduationThreshold を使う', () => {
    expect(src).toContain('hasJustReachedGraduationThreshold');
  });

  it('対象習慣の絞り込みに isGraduationCandidate を使う（establishedや辞退済みを除外, AC#3）', () => {
    expect(src).toContain('isGraduationCandidate');
  });

  it('卒業選択で status を established に更新する（AC#2: 身についた習慣セクションへの移動は既存の isEstablishedHabit フィルタに委譲）', () => {
    expect(src).toMatch(/status:\s*['"]established['"]/);
  });

  it('辞退選択で graduationDeclinedAt を更新する（AC#3: 再提案しない）', () => {
    expect(src).toContain('graduationDeclinedAt');
  });

  it('セッション内での重複提案を防ぐガード（同一habitへの再提案抑止）を持つ', () => {
    // 連打・再表示で重複しない（AC#1）ことを保証する ref ベースのガード
    expect(src).toMatch(/proposedGraduation/i);
  });
});
