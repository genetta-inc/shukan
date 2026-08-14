import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// issue #133: 認証ユーザーオブジェクト参照への useEffect 依存の再発防止。
//
// Supabase の onAuthStateChange は同一ユーザーでも毎回新しい user オブジェクト参照を
// 返すため、useEffect の依存配列にオブジェクト参照 `user` をそのまま入れると、
// トークンリフレッシュのたびに同一ユーザーで effect が再実行され、無駄な再フェッチと
// ローディングのちらつきが起きる（useHabits で実際に発生し #79 で修正済み）。
//
// vitest は environment: "node" のため実レンダーでの再実行回数計測はできない。
// GUARDRAILS 2026-07-12 記載の通り、profile-app-connection.test.ts 等と同じ
// readFileSync によるソースアサーション方式で、依存配列に生の `user` 参照が
// 残っていないことを機械的に検証する。

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
function readSource(rel: string): string {
  return readFileSync(resolve(projectRoot, rel), 'utf-8');
}

// 対象: issue #133 の4ファイル + 修正の手本である useHabits（#79）。
const TARGET_FILES = [
  'src/hooks/useProfile.ts',
  'src/hooks/useReviewHistory.ts',
  'src/hooks/useSubscription.ts',
  'src/components/habits/evidence-article-sheet.tsx',
  'src/hooks/useHabits.ts',
];

/**
 * ソースから useEffect の依存配列（`useEffect(... => { ... }, [deps]);`）を抜き出し、
 * 依存トークンの配列のリストとして返す。
 * useCallback / useMemo の依存配列は対象外（issue #133 のスコープは useEffect のみ）。
 */
function extractUseEffectDeps(src: string): string[][] {
  const matches = [...src.matchAll(/useEffect\(\s*\(\)\s*=>\s*\{[\s\S]*?\}\s*,\s*\[([^\]]*)\]\s*\)/g)];
  return matches.map((m) =>
    m[1]
      .split(',')
      .map((token) => token.trim())
      .filter((token) => token.length > 0)
  );
}

describe('useEffect の依存配列に生の user オブジェクト参照を入れない (issue #133 / #79)', () => {
  for (const rel of TARGET_FILES) {
    describe(rel, () => {
      const src = readSource(rel);
      const depsList = extractUseEffectDeps(src);

      it('useEffect の依存配列が1つ以上抽出できる（正規表現の空振り検知）', () => {
        expect(depsList.length).toBeGreaterThan(0);
      });

      it('依存配列に生の `user` 参照が残っていない', () => {
        for (const deps of depsList) {
          expect(deps, `deps: [${deps.join(', ')}]`).not.toContain('user');
        }
      });

      it('プリミティブな userId（= user?.id）依存の useEffect が存在する', () => {
        const hasUserIdDep = depsList.some((deps) =>
          deps.some((token) => token === 'userId' || token === 'user?.id')
        );
        expect(hasUserIdDep).toBe(true);
      });
    });
  }
});
