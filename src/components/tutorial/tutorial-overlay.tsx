'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import {
  TUTORIAL_EVENT_NAME,
  TUTORIAL_STEPS,
  isLocalTutorialDoneFastPath,
  markLocalTutorialSynced,
  markTutorialDone,
  markTutorialPending,
  progressOf,
  readLocalTutorialState,
  resolveAutoStart,
  stepIndexById,
  type TutorialEventType,
} from '@/lib/tutorial';
import { fetchUserProfile, markTutorialCompleted } from '@/lib/supabase/profiles';

/**
 * 初回チュートリアルのコーチマーク描画（プロトタイプ）。
 * 実 UI の上に暗幕＋スポットライト穴を重ね、穴の中だけ実操作を通す。
 * ステップ定義・発火条件は src/lib/tutorial.ts が正。
 *
 * 状態:
 * - idle: 非表示
 * - running: 表示中（anchor 追跡＋イベント待ち）
 * - sheetWait: アクションシート等（z-50）が開いている間はオーバーレイを引っ込めて操作を邪魔しない
 * - finished: 完走カード表示
 */

const SPOT_PADDING = 6;
const ANCHOR_MISSING_TIMEOUT_MS = 4000;
const TOOLTIP_GAP = 12;

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** 同一 selector に複数マッチ（例: デスクトップ header とモバイル bottom-nav）しても可視のものを選ぶ */
function findVisibleAnchor(selector: string): HTMLElement | null {
  const els = document.querySelectorAll<HTMLElement>(selector);
  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}

type Phase = 'idle' | 'running' | 'sheetWait' | 'finished';

export function TutorialOverlay() {
  const t = useTranslations('tutorial');
  const pathname = usePathname();
  const router = useRouter();

  const [mounted, setMounted] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);

  const step = TUTORIAL_STEPS[stepIndex];

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- portal は client マウント後のみ描画
    setMounted(true);
  }, []);

  // --- 起動判定: DB（user_profiles.tutorial_completed_at）を正、localStorage を高速パス
  // キャッシュとする（issue #117）。?tutorial=1 は現状維持（DB を書き換えない強制再実行）。
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const startAfterSettle = () => {
      // 画面が落ち着いてから開始（オンボ直後の遷移アニメと被せない）
      timer = setTimeout(() => {
        if (cancelled) return;
        setStepIndex(0);
        setPhase('running');
      }, 600);
    };

    async function decide() {
      const force = new URLSearchParams(window.location.search).get('tutorial') === '1';
      if (force) {
        markTutorialPending();
        startAfterSettle();
        return;
      }

      // 高速パス: この端末で完了確定済みなら DB を参照するまでもない
      if (isLocalTutorialDoneFastPath()) return;

      const localState = readLocalTutorialState();
      let dbLookup: Parameters<typeof resolveAutoStart>[0]['dbLookup'];
      try {
        const profile = await fetchUserProfile();
        // (app)/layout.tsx の resolveAppRedirect が profile 存在を保証しているため、
        // null は取得タイミングのレースのみ。安全側に倒し DB 未参照（'error'）扱いにする。
        dbLookup = profile ? { tutorialCompletedAt: profile.tutorialCompletedAt } : 'error';
      } catch {
        dbLookup = 'error';
      }
      if (cancelled) return;

      const decision = resolveAutoStart({ localState, dbLookup });
      if (decision.cacheAsDone) markLocalTutorialSynced();
      if (decision.shouldSyncDb) {
        markTutorialCompleted()
          .then(() => {
            if (!cancelled) markLocalTutorialSynced();
          })
          .catch(() => {
            // 次回 DB 参照時に再送される（'done-unsynced' のまま維持）
          });
      }
      if (decision.start) startAfterSettle();
    }

    decide();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  // 完走・スキップ共通の完了処理: 即座にローカル確定（'done-unsynced'）し、DB 書き込みが
  // 確認できたら 'done' へ昇格する。書き込み失敗時は 'done-unsynced' のまま残り、次回
  // DB 参照時（resolveAutoStart の shouldSyncDb）に再送される。
  const completeTutorial = useCallback(() => {
    markTutorialDone(false);
    markTutorialCompleted()
      .then(markLocalTutorialSynced)
      .catch(() => {
        // 次回リトライに任せる
      });
  }, []);

  const finish = useCallback(() => {
    completeTutorial();
    setPhase('finished');
  }, [completeTutorial]);

  const advanceFrom = useCallback(
    (index: number) => {
      if (index + 1 >= TUTORIAL_STEPS.length) {
        finish();
      } else {
        setStepIndex(index + 1);
      }
    },
    [finish]
  );

  const skip = useCallback(() => {
    completeTutorial();
    setPhase('idle');
  }, [completeTutorial]);

  // --- 実操作イベントで進める ---
  useEffect(() => {
    if (phase !== 'running' && phase !== 'sheetWait') return;
    const handler = (e: Event) => {
      const type = (e as CustomEvent<{ type: TutorialEventType }>).detail?.type;
      if (!type) return;
      if (phase === 'sheetWait') {
        if (type === 'action-sheet-closed') {
          if (step.id === 'longpress') {
            setPhase('running');
            advanceFrom(stepIndex);
          } else {
            setPhase('running');
          }
        }
        return;
      }
      // シート（z-50）が開いたらどのステップ中でも一旦引っ込める
      if (type === 'action-sheet-open') {
        setPhase('sheetWait');
        return;
      }
      if (step.advance.type === 'event' && type === step.advance.event) {
        advanceFrom(stepIndex);
      }
    };
    window.addEventListener(TUTORIAL_EVENT_NAME, handler);
    return () => window.removeEventListener(TUTORIAL_EVENT_NAME, handler);
  }, [phase, step, stepIndex, advanceFrom]);

  // --- 画面遷移で進める（発見タブ） ---
  useEffect(() => {
    if (phase !== 'running') return;
    if (step.advance.type === 'route' && pathname === step.advance.route) {
      // 外部イベント（ルート遷移）への応答としてステップを進める意図的パターン
      // eslint-disable-next-line react-hooks/set-state-in-effect
      advanceFrom(stepIndex);
    }
  }, [pathname, phase, step, stepIndex, advanceFrom]);

  // --- Escape でスキップ ---
  // 注意: シートを閉じた Escape が「sheetWait → running」への復帰後に window まで
  // 伝播してくるレース（同一 keydown が復帰直後のこのリスナーに届く）があるため、
  // running へ入って間もない Escape は無視する。
  const runningSinceRef = useRef(0);
  useEffect(() => {
    if (phase === 'running') runningSinceRef.current = Date.now();
  }, [phase]);
  useEffect(() => {
    if (phase !== 'running') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && Date.now() - runningSinceRef.current > 500) skip();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, skip]);

  // --- anchor 追跡: rAF ループで rect を追従（スクロール・レイアウト変化に強い） ---
  const scrolledStepRef = useRef(-1);
  useEffect(() => {
    // anchor 無しステップでは rect を触らない（描画側が参照しないため、前ステップの
    // 値が残っていても次の anchored ステップの初回計測がなめらかに上書きする）
    if (phase !== 'running' || !step.selector) return;
    let raf = 0;
    let cancelled = false;
    const missingSince = Date.now();
    let everFound = false;

    const measure = () => {
      if (cancelled) return;
      const el = findVisibleAnchor(step.selector!);
      if (el) {
        everFound = true;
        const r = el.getBoundingClientRect();
        // 対象が画面端に隠れているときだけ一度センターへスクロール
        if (scrolledStepRef.current !== stepIndex) {
          scrolledStepRef.current = stepIndex;
          if (r.top < 80 || r.bottom > window.innerHeight - 120) {
            el.scrollIntoView({ block: 'center', behavior: 'smooth' });
          }
        }
        setRect((prev) =>
          prev &&
          Math.abs(prev.top - r.top) < 0.5 &&
          Math.abs(prev.left - r.left) < 0.5 &&
          Math.abs(prev.width - r.width) < 0.5 &&
          Math.abs(prev.height - r.height) < 0.5
            ? prev
            : { top: r.top, left: r.left, width: r.width, height: r.height }
        );
      } else {
        setRect(null);
        // 習慣 0 件などで anchor が現れないステップは自動で先へ
        if (!everFound && step.skipToOnMissing && Date.now() - missingSince > ANCHOR_MISSING_TIMEOUT_MS) {
          setStepIndex(stepIndexById(step.skipToOnMissing));
          return;
        }
      }
      raf = requestAnimationFrame(measure);
    };
    raf = requestAnimationFrame(measure);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [phase, step, stepIndex]);

  // --- ツールチップの実測高さ（配置計算用） ---
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [tipHeight, setTipHeight] = useState(170);
  useLayoutEffect(() => {
    if (tooltipRef.current) {
      const h = tooltipRef.current.offsetHeight;
      if (h > 0) setTipHeight((prev) => (prev === h ? prev : h));
    }
  }, [stepIndex, phase, rect]);

  if (!mounted || phase === 'idle' || phase === 'sheetWait') return null;

  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // ----- 完走カード / ようこそカード（中央モーダル型） -----
  if (phase === 'finished' || step.id === 'welcome') {
    const isWelcome = phase !== 'finished';
    return createPortal(
      <div className="fixed inset-0 z-[60]">
        <div className="absolute inset-0 bg-black/55" />
        <div className="absolute inset-0 flex items-center justify-center p-6">
          <div
            role="dialog"
            aria-modal="true"
            className="w-[min(92vw,340px)] rounded-xl border border-border bg-card p-6 shadow-xl animate-[fadeSlideIn_300ms_ease-out]"
          >
            <p className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              {isWelcome ? t('caption') : t('captionDone')}
            </p>
            <h2 className="mt-1.5 text-lg font-bold tracking-tight">
              {isWelcome ? t('steps.welcome.title') : t('steps.finished.title')}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {isWelcome ? t('steps.welcome.body') : t('steps.finished.body')}
            </p>
            <div className="mt-5 flex items-center justify-between gap-3">
              {isWelcome ? (
                <>
                  <button
                    type="button"
                    onClick={skip}
                    className="text-xs text-muted-foreground underline underline-offset-2"
                  >
                    {t('skip')}
                  </button>
                  <button
                    type="button"
                    onClick={() => advanceFrom(0)}
                    className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.98]"
                  >
                    {t('start')}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setPhase('idle');
                    router.push('/');
                  }}
                  className="w-full rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.98]"
                >
                  {t('goHome')}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>,
      document.body
    );
  }

  // ----- スポットライトステップ -----
  const hole: Rect | null = rect
    ? {
        top: rect.top - SPOT_PADDING,
        left: rect.left - SPOT_PADDING,
        width: rect.width + SPOT_PADDING * 2,
        height: rect.height + SPOT_PADDING * 2,
      }
    : null;
  const holeRadius = step.circle ? 9999 : 14;

  // ツールチップ配置: 穴の下 → 入らなければ上 → それも無理なら下端寄せ
  const tipWidth = Math.min(360, vw - 24);
  let tipTop: number;
  let tipLeft: number;
  if (hole) {
    const below = hole.top + hole.height + TOOLTIP_GAP;
    if (below + tipHeight < vh - 8) {
      tipTop = below;
    } else if (hole.top - TOOLTIP_GAP - tipHeight > 8) {
      tipTop = hole.top - TOOLTIP_GAP - tipHeight;
    } else {
      tipTop = vh - tipHeight - 88;
    }
    tipLeft = Math.min(Math.max(hole.left + hole.width / 2 - tipWidth / 2, 12), vw - 12 - tipWidth);
  } else {
    tipTop = vh / 2 - tipHeight / 2;
    tipLeft = (vw - tipWidth) / 2;
  }

  const { current, total } = progressOf(stepIndex);
  const isLast = stepIndex === TUTORIAL_STEPS.length - 1;

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[60]">
      <style>{`
        @keyframes smitchTutorialPulse {
          0% { transform: scale(1); opacity: 0.85; }
          70% { transform: scale(1.45); opacity: 0; }
          100% { transform: scale(1.45); opacity: 0; }
        }
      `}</style>

      {hole ? (
        <>
          {/* 暗幕: 穴の周囲だけ巨大 box-shadow で塗る（穴の中は素通し） */}
          <div
            aria-hidden
            className="fixed transition-all duration-300 ease-out"
            style={{
              top: hole.top,
              left: hole.left,
              width: hole.width,
              height: hole.height,
              borderRadius: holeRadius,
              boxShadow: '0 0 0 2px rgba(255,255,255,0.9), 0 0 0 200vmax rgba(10,10,12,0.55)',
              pointerEvents: 'none',
            }}
          />
          {/* 実操作ステップは穴の位置にパルスリングを出してタップを誘う */}
          {step.interactive && (
            <div
              aria-hidden
              className="fixed"
              style={{
                top: hole.top,
                left: hole.left,
                width: hole.width,
                height: hole.height,
                borderRadius: holeRadius,
                border: '2px solid rgba(255,255,255,0.9)',
                animation: 'smitchTutorialPulse 1.6s ease-out infinite',
                pointerEvents: 'none',
              }}
            />
          )}
          {/* クリックブロッカー: 穴の外側 4 面（interactive でなければ穴の上も塞ぐ） */}
          <div className="pointer-events-auto fixed left-0 right-0 top-0" style={{ height: Math.max(hole.top, 0) }} />
          <div
            className="pointer-events-auto fixed left-0"
            style={{ top: hole.top, width: Math.max(hole.left, 0), height: hole.height }}
          />
          <div
            className="pointer-events-auto fixed right-0"
            style={{
              top: hole.top,
              left: hole.left + hole.width,
              height: hole.height,
            }}
          />
          <div
            className="pointer-events-auto fixed bottom-0 left-0 right-0"
            style={{ top: hole.top + hole.height }}
          />
          {!step.interactive && (
            <div
              className="pointer-events-auto fixed"
              style={{ top: hole.top, left: hole.left, width: hole.width, height: hole.height }}
            />
          )}
        </>
      ) : (
        // anchor 探索中は全面ブロック（暗幕のみ）
        <div className="pointer-events-auto fixed inset-0 bg-black/55" />
      )}

      {/* ツールチップ */}
      <div
        key={stepIndex}
        ref={tooltipRef}
        role="dialog"
        aria-modal="true"
        className="pointer-events-auto fixed rounded-xl border border-border bg-card p-4 shadow-xl animate-[fadeSlideIn_300ms_ease-out]"
        style={{ top: tipTop, left: tipLeft, width: tipWidth }}
      >
        <p className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
          {t('progress', { current, total })}
        </p>
        <h3 className="mt-1 text-[15px] font-bold tracking-tight">{t(`steps.${step.id}.title`)}</h3>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          {t(`steps.${step.id}.body`)}
        </p>
        <div className="mt-3 flex items-center justify-between">
          <button
            type="button"
            onClick={skip}
            className="text-xs text-muted-foreground underline underline-offset-2"
          >
            {t('skip')}
          </button>
          {step.advance.type === 'next' ? (
            <button
              type="button"
              onClick={() => advanceFrom(stepIndex)}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.98]"
            >
              {isLast ? t('done') : t('next')}
            </button>
          ) : (
            <div className="flex items-center gap-1.5" aria-hidden>
              {Array.from({ length: total }, (_, i) => (
                <span
                  key={i}
                  className={cn(
                    'size-1.5 rounded-full',
                    i < current ? 'bg-primary' : 'bg-border'
                  )}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
