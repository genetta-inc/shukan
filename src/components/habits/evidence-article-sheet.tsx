'use client';

import { useMemo, useState, useEffect, useCallback, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import {
  ArrowLeft,
  HeartPulse,
  Wallet,
  TrendingUp,
  Smile,
  ChevronDown,
  ThumbsDown,
  Send,
  ArrowUp,
  ArrowDown,
  Check,
  AlertTriangle,
} from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { getArticle } from '@/data/impact-articles';
import { EstimateDisclaimer } from '@/components/habits/estimate-disclaimer';
import { getEvidenceHeroImage, getEvidenceHeroGradient, HERO_SIZE_SHEET } from '@/data/evidence-hero-images';
import { renderArticle, calculateAnnualImpact, formatHealthMinutes, formatCurrency } from '@/lib/impact';
import type { ArticleId, CalcStep } from '@/types/impact';
import type { Habit, HabitCompletion } from '@/types/habit';
import { submitBadMark, removeBadMark, submitComment, getUserFeedback } from '@/lib/supabase/feedbacks';
import { submitVerdict, getUserVerdict } from '@/lib/supabase/verdicts';
import { ARTICLE_VERDICTS, findVoterStreakForArticle, type ArticleVerdict } from '@/lib/verdicts';
import { useAuth } from '@/components/auth-provider';

const VERDICT_ICONS: Record<ArticleVerdict, typeof ArrowUp> = {
  too_high: ArrowUp,
  too_low: ArrowDown,
  fair: Check,
  incorrect: AlertTriangle,
};

/** Convert **bold** markers in text to <strong> elements */
function parseBold(text: string): ReactNode[] {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return parts.map((part, i) =>
    i % 2 === 1 ? <strong key={i}>{part}</strong> : part
  );
}

// ヒーロー画像・フォールバックグラデーションは記事データ（heroImage）から引く。
// 単一ソースは src/data/impact-articles/*.ts、アクセサは evidence-hero-images.ts。
const DEFAULT_GRADIENT = 'from-teal-400 to-cyan-300';

interface EvidenceArticleSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  articleId: string | null;
  showAddButton?: boolean;
  onAddHabit?: (articleId: string) => void;
  /**
   * 構造化投票（issue #89）で「投票者の該当習慣の継続日数」を算出するために使う。
   * 呼び出し元に habits/completions が無い文脈（Discover 初回訪問等）では省略でき、
   * その場合 voter_streak_days は 0 として保存される。
   */
  habits?: Habit[];
  completions?: HabitCompletion[];
}

/** Renders a single CalcStep row */
function CalcStepRow({ step, index }: { step: CalcStep; index: number }) {
  return (
    <div className="rounded-lg border bg-muted/30 px-3 py-2">
      <div className="text-xs font-medium text-foreground/70">
        {index + 1}. {step.label}
      </div>
      {step.value && (
        <div className="mt-0.5 text-xs text-muted-foreground">{step.value}</div>
      )}
      {step.formula && (
        <div className="mt-0.5 font-mono text-xs text-muted-foreground">{step.formula}</div>
      )}
      {step.result && (
        <div className="mt-0.5 text-xs font-semibold text-foreground">= {step.result}</div>
      )}
    </div>
  );
}

export function EvidenceArticleSheet({
  open,
  onOpenChange,
  articleId,
  showAddButton = false,
  onAddHabit,
  habits = [],
  completions = [],
}: EvidenceArticleSheetProps) {
  const t = useTranslations('impact');
  const tEvidence = useTranslations('evidence');
  const { user } = useAuth();

  const article = useMemo(
    () => (articleId ? getArticle(articleId as ArticleId) : undefined),
    [articleId]
  );

  const renderedBody = useMemo(
    () => (article ? renderArticle(article) : ''),
    [article]
  );

  // Calculation logic collapsible state
  const [calcExpanded, setCalcExpanded] = useState(false);

  // Feedback state
  const [hasBadMark, setHasBadMark] = useState(false);
  const [badMarkLoading, setBadMarkLoading] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [commentSending, setCommentSending] = useState(false);
  const [showThanks, setShowThanks] = useState(false);

  // Structured verdict state (issue #89)
  const [verdict, setVerdict] = useState<ArticleVerdict | null>(null);
  const [verdictSubmitting, setVerdictSubmitting] = useState(false);
  const [showVerdictThanks, setShowVerdictThanks] = useState(false);

  // Load feedback state when sheet opens (SCENARIO-AF-09)
  useEffect(() => {
    if (!open || !articleId || !user) return;
    setCalcExpanded(false);
    setCommentText('');
    setShowThanks(false);
    setShowVerdictThanks(false);
    getUserFeedback(user.id, articleId).then(({ hasBadMark: has }) => setHasBadMark(has));
    getUserVerdict(user.id, articleId).then(({ verdict: v }) => setVerdict(v));
  }, [open, articleId, user]);

  // Bad mark toggle (SCENARIO-AF-01, AF-02, AF-08)
  const handleBadMarkToggle = useCallback(async () => {
    if (!articleId || !user || badMarkLoading) return;
    const prev = hasBadMark;
    setHasBadMark(!prev); // optimistic
    setBadMarkLoading(true);
    try {
      if (prev) {
        await removeBadMark(user.id, articleId);
      } else {
        await submitBadMark(user.id, articleId);
      }
    } catch (err) {
      console.error('Bad mark toggle failed:', err);
      setHasBadMark(prev); // rollback
    } finally {
      setBadMarkLoading(false);
    }
  }, [articleId, user, hasBadMark, badMarkLoading]);

  // Comment submit (SCENARIO-AF-04)
  const handleCommentSubmit = useCallback(async () => {
    if (!articleId || !user || !commentText.trim() || commentSending) return;
    setCommentSending(true);
    try {
      await submitComment(user.id, articleId, commentText.trim());
      setCommentText('');
      setShowThanks(true);
      setTimeout(() => setShowThanks(false), 3000);
    } catch (err) {
      console.error('Comment submit failed:', err);
    } finally {
      setCommentSending(false);
    }
  }, [articleId, user, commentText, commentSending]);

  // Structured verdict select (issue #89): 1ユーザー1記事1票、変更可（upsert）。
  // 投票時点の該当習慣の継続日数を voter_streak_days としてスナップショット保存する。
  const handleVerdictSelect = useCallback(
    async (next: ArticleVerdict) => {
      if (!articleId || !user || verdictSubmitting || verdict === next) return;
      const prev = verdict;
      setVerdict(next); // optimistic
      setVerdictSubmitting(true);
      try {
        const voterStreakDays = findVoterStreakForArticle(habits, completions, articleId);
        await submitVerdict(user.id, articleId, next, voterStreakDays);
        setShowVerdictThanks(true);
        setTimeout(() => setShowVerdictThanks(false), 3000);
      } catch (err) {
        console.error('Verdict submit failed:', err);
        setVerdict(prev); // rollback
      } finally {
        setVerdictSubmitting(false);
      }
    },
    [articleId, user, verdict, verdictSubmitting, habits, completions]
  );

  if (!article || !articleId) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" showCloseButton={false} className="h-0 p-0">
          <SheetTitle className="sr-only">Loading</SheetTitle>
        </SheetContent>
      </Sheet>
    );
  }

  const { dailyHealthMinutes, dailyCostSaving, dailyIncomeGain, dailyPositiveMoodMinutes } =
    article.calculationParams;
  const annual = calculateAnnualImpact({
    healthMinutes: dailyHealthMinutes,
    costSaving: dailyCostSaving,
    incomeGain: dailyIncomeGain,
    positiveMoodMinutes: dailyPositiveMoodMinutes,
  });

  const confidenceLabel = t(`confidence.${article.confidenceLevel}`);
  const heroImageUrl = getEvidenceHeroImage(articleId, HERO_SIZE_SHEET);
  const gradient = getEvidenceHeroGradient(articleId) ?? DEFAULT_GRADIENT;

  const confidenceBadgeClass = (() => {
    switch (article.confidenceLevel) {
      case 'high':
        return 'bg-success/10 text-success';
      case 'medium':
        return 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400';
      case 'low':
        return 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400';
    }
  })();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        className="flex h-[95vh] flex-col rounded-t-2xl p-0"
      >
        <SheetTitle className="sr-only">{article.habitName}</SheetTitle>

        {/* Scrollable area */}
        <div className={cn('flex-1 overflow-y-auto', showAddButton && 'pb-20')}>
          {/* Hero image area */}
          <div
            className={cn(
              'relative h-48',
              !heroImageUrl && `bg-gradient-to-br ${gradient}`
            )}
          >
            {heroImageUrl && (
              <img
                src={heroImageUrl}
                alt=""
                className="absolute inset-0 h-full w-full object-cover"
                loading="lazy"
              />
            )}
            {/* Back button */}
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="absolute left-4 top-4 flex size-9 items-center justify-center rounded-full bg-black/20 text-white backdrop-blur-sm transition-colors hover:bg-black/30"
            >
              <ArrowLeft className="size-5" />
            </button>
          </div>

          {/* Article title + meta */}
          <div className="px-4 pt-4">
            <h2 className="text-xl font-bold">{article.habitName}</h2>

            {/* Impact badges row (annual) */}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-full bg-impact-bg px-2.5 py-1 text-xs font-medium text-impact-cost">
                <HeartPulse className="size-3.5" /> +{formatHealthMinutes(annual.healthMinutes)}{t('perYear')}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-impact-bg px-2.5 py-1 text-xs font-medium text-impact-cost">
                <Wallet className="size-3.5" /> {formatCurrency(annual.costSaving, false)}{t('perYear')}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-impact-bg px-2.5 py-1 text-xs font-medium text-impact-cost">
                <TrendingUp className="size-3.5" /> {formatCurrency(annual.incomeGain, false)}{t('perYear')}
              </span>
              {annual.positiveMoodMinutes > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-impact-bg px-2.5 py-1 text-xs font-medium text-impact-cost" aria-label={t('dailyPositiveMood')}>
                  <Smile className="size-3.5" /> +{formatHealthMinutes(annual.positiveMoodMinutes)}{t('perYear')}
                </span>
              )}
            </div>

            {/* Confidence badge */}
            <div className="mt-2">
              <span
                className={cn(
                  'inline-block rounded-full px-2.5 py-0.5 text-[11px] font-medium',
                  confidenceBadgeClass
                )}
              >
                {confidenceLabel}
              </span>
            </div>

            {/* 景表法・打消し表示対応（issue #39）: 年間推定値バッジ直下の近接注記。
                本文の推論段落（V3: LLM 生成）向けに AI 明示も併記する。 */}
            <EstimateDisclaimer withAiNote className="mt-2" />
          </div>

          {/* Article body */}
          <div className="px-4 pb-4 pt-4">
            <div className="whitespace-pre-line text-sm leading-relaxed text-foreground/90">
              {parseBold(renderedBody)}
            </div>

            {/* Sources */}
            <div className="mt-6 border-t pt-4">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t('sources')}
              </h3>
              <ol className="space-y-1.5 text-xs text-muted-foreground">
                {article.article.sources.map((source) => (
                  <li key={source.id} className="leading-relaxed">
                    {source.url ? (
                      <a
                        href={source.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline hover:text-foreground"
                      >
                        {source.text}
                      </a>
                    ) : (
                      source.text
                    )}
                  </li>
                ))}
              </ol>
            </div>

            {/* Calculation Logic (collapsible) — REQ-CL-04 */}
            {article.calculationLogic && (
              <div className="mt-4 border-t pt-4">
                <button
                  type="button"
                  onClick={() => setCalcExpanded(!calcExpanded)}
                  className="flex w-full items-center justify-between text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  {tEvidence('calculationLogic')}
                  <ChevronDown
                    className={cn(
                      'size-4 transition-transform',
                      calcExpanded && 'rotate-180'
                    )}
                  />
                </button>

                {calcExpanded && (
                  <div className="mt-3 space-y-4">
                    {/* Health */}
                    <div>
                      <h4 className="mb-1.5 text-xs font-medium text-foreground/70">
                        <HeartPulse className="mr-1 inline size-3.5" />
                        {tEvidence('feedbackHealth')}
                      </h4>
                      <div className="space-y-1.5">
                        {article.calculationLogic.health.map((step, i) => (
                          <CalcStepRow key={i} step={step} index={i} />
                        ))}
                      </div>
                    </div>

                    {/* Cost */}
                    <div>
                      <h4 className="mb-1.5 text-xs font-medium text-foreground/70">
                        <Wallet className="mr-1 inline size-3.5" />
                        {tEvidence('feedbackCost')}
                      </h4>
                      <div className="space-y-1.5">
                        {article.calculationLogic.cost.map((step, i) => (
                          <CalcStepRow key={i} step={step} index={i} />
                        ))}
                      </div>
                    </div>

                    {/* Income */}
                    <div>
                      <h4 className="mb-1.5 text-xs font-medium text-foreground/70">
                        <TrendingUp className="mr-1 inline size-3.5" />
                        {tEvidence('feedbackIncome')}
                      </h4>
                      <div className="space-y-1.5">
                        {article.calculationLogic.income.map((step, i) => (
                          <CalcStepRow key={i} step={step} index={i} />
                        ))}
                      </div>
                    </div>

                    {/* Positive mood (4軸目) — 値がある記事のみ */}
                    {article.calculationLogic.positiveMood && article.calculationLogic.positiveMood.length > 0 && (
                      <div>
                        <h4 className="mb-1.5 text-xs font-medium text-foreground/70">
                          <Smile className="mr-1 inline size-3.5" />
                          {t('dailyPositiveMood')}
                        </h4>
                        <div className="space-y-1.5">
                          {article.calculationLogic.positiveMood.map((step, i) => (
                            <CalcStepRow key={i} step={step} index={i} />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Structured verdict section (issue #89): 4択投票、1ユーザー1記事1票・変更可 */}
            <div className="mt-4 border-t pt-4">
              <p className="text-xs text-muted-foreground">
                {tEvidence('verdictQuestion')}
              </p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {ARTICLE_VERDICTS.map((v) => {
                  const Icon = VERDICT_ICONS[v];
                  const selected = verdict === v;
                  return (
                    <button
                      key={v}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => handleVerdictSelect(v)}
                      disabled={verdictSubmitting}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors disabled:opacity-50',
                        selected
                          ? 'border-primary bg-primary/5 text-primary ring-2 ring-primary/30'
                          : 'border-border bg-card text-foreground hover:border-primary/40'
                      )}
                    >
                      <Icon className="size-3.5" />
                      {tEvidence(`verdict.${v}`)}
                    </button>
                  );
                })}
              </div>

              {/* Thank you toast */}
              {showVerdictThanks && (
                <p className="mt-2 text-xs font-medium text-success">
                  {tEvidence('verdictThanks')}
                </p>
              )}
            </div>

            {/* Feedback section — REQ-AF-04, AF-06 */}
            <div className="mt-4 border-t pt-4 pb-4">
              <p className="text-xs text-muted-foreground">
                {tEvidence('feedbackQuestion')}
              </p>
              <button
                type="button"
                onClick={handleBadMarkToggle}
                disabled={badMarkLoading}
                className={cn(
                  'mt-2 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
                  hasBadMark
                    ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                    : 'bg-muted text-muted-foreground hover:bg-muted/80'
                )}
              >
                <ThumbsDown className="size-3.5" />
                {tEvidence('feedbackBadMark')}
              </button>

              {/* Comment input (SCENARIO-AF-03: visible when bad mark is active) */}
              {hasBadMark && (
                <div className="mt-3 flex gap-2">
                  <input
                    type="text"
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    placeholder={tEvidence('feedbackCommentPlaceholder')}
                    className="flex-1 rounded-lg border bg-background px-3 py-2 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <button
                    type="button"
                    onClick={handleCommentSubmit}
                    disabled={!commentText.trim() || commentSending}
                    className="inline-flex items-center justify-center rounded-lg bg-primary px-3 py-2 text-xs text-primary-foreground transition-opacity disabled:opacity-50"
                  >
                    <Send className="size-3.5" />
                  </button>
                </div>
              )}

              {/* Thank you toast */}
              {showThanks && (
                <p className="mt-2 text-xs font-medium text-success">
                  {tEvidence('feedbackThanks')}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Fixed CTA bar at bottom */}
        {showAddButton && onAddHabit && (
          <div className="absolute inset-x-0 bottom-0 border-t bg-background p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <Button
              onClick={() => onAddHabit(articleId)}
              className="w-full"
              size="lg"
            >
              {tEvidence('addThisHabit')}
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
