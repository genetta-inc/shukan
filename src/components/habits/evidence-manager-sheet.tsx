'use client';

import { useState, useMemo, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { X, Trash2, Plus, HeartPulse, Wallet, TrendingUp, Smile } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { getArticle } from '@/data/impact-articles';
import { calculateAnnualImpact, formatHealthMinutes, formatCurrency } from '@/lib/impact';
import { HabitIcon } from '@/components/ui/habit-icon';
import { EstimateDisclaimer } from '@/components/habits/estimate-disclaimer';
import { EvidencePicker } from '@/components/habits/evidence-picker';
import { HelpButton } from '@/components/help/help-button';
import type { HabitEvidence, ArticleId } from '@/types/impact';

interface EvidenceManagerSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  habitId: string;
  evidences: HabitEvidence[];
  onAddEvidence: (habitId: string, articleId: string, weight?: number) => void;
  onRemoveEvidence: (habitId: string, evidenceId: string) => void;
  onSetWeight: (habitId: string, evidenceId: string, weight: number) => void;
}

export function EvidenceManagerSheet({
  open,
  onOpenChange,
  habitId,
  evidences,
  onAddEvidence,
  onRemoveEvidence,
  onSetWeight,
}: EvidenceManagerSheetProps) {
  const t = useTranslations('evidence');
  const tImpact = useTranslations('impact');
  const [pickerOpen, setPickerOpen] = useState(false);

  const resolvedEvidences = useMemo(() => {
    return evidences
      .map((ev) => {
        const article = getArticle(ev.articleId);
        return article ? { evidence: ev, article } : null;
      })
      .filter(Boolean) as { evidence: HabitEvidence; article: NonNullable<ReturnType<typeof getArticle>> }[];
  }, [evidences]);

  const totalAnnualImpact = useMemo(() => {
    let healthMinutes = 0;
    let costSaving = 0;
    let incomeGain = 0;
    let positiveMoodMinutes = 0;
    for (const { evidence, article } of resolvedEvidences) {
      const w = evidence.weight / 100;
      const annual = calculateAnnualImpact({
        healthMinutes: article.calculationParams.dailyHealthMinutes * w,
        costSaving: article.calculationParams.dailyCostSaving * w,
        incomeGain: article.calculationParams.dailyIncomeGain * w,
        positiveMoodMinutes: article.calculationParams.dailyPositiveMoodMinutes * w,
      });
      healthMinutes += annual.healthMinutes;
      costSaving += annual.costSaving;
      incomeGain += annual.incomeGain;
      positiveMoodMinutes += annual.positiveMoodMinutes;
    }
    return { healthMinutes, costSaving, incomeGain, positiveMoodMinutes };
  }, [resolvedEvidences]);

  const handlePickerSelect = useCallback(
    (articleIds: string[]) => {
      const existing = new Set(evidences.map((e) => e.articleId));
      for (const id of articleIds) {
        if (!existing.has(id as ArticleId)) {
          onAddEvidence(habitId, id);
        }
      }
    },
    [habitId, evidences, onAddEvidence]
  );

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          className="flex h-[70vh] flex-col rounded-t-2xl p-0"
        >
          <SheetTitle className="sr-only">{t('manage')}</SheetTitle>

          {/* Header */}
          <div className="flex shrink-0 items-center justify-between border-b px-5 py-4">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold">{t('manage')}</h2>
              <HelpButton topic="evidenceWeight" />
            </div>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-full p-1.5 hover:bg-muted"
            >
              <X className="size-5" />
            </button>
          </div>

          {/* Total annual impact summary */}
          {resolvedEvidences.length > 0 && (
            <div className="shrink-0 border-b bg-success/5 px-5 py-3">
              <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                {tImpact('title')}{tImpact('perYear')}
              </p>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1 text-sm font-bold text-success">
                  <HeartPulse className="size-3.5" /> +{formatHealthMinutes(totalAnnualImpact.healthMinutes)}
                </span>
                <span className="flex items-center gap-1 text-sm font-bold text-success">
                  <Wallet className="size-3.5" /> {formatCurrency(totalAnnualImpact.costSaving)}
                </span>
                <span className="flex items-center gap-1 text-sm font-bold text-success">
                  <TrendingUp className="size-3.5" /> {formatCurrency(totalAnnualImpact.incomeGain)}
                </span>
                {totalAnnualImpact.positiveMoodMinutes > 0 && (
                  <span className="flex items-center gap-1 text-sm font-bold text-success" aria-label={tImpact('dailyPositiveMood')}>
                    <Smile className="size-3.5" /> +{formatHealthMinutes(totalAnnualImpact.positiveMoodMinutes)}
                  </span>
                )}
              </div>
              {/* 近接注記（景表法・打消し表示 / issue #39）: 合算年間推定値と同一ビューポート内に表示 */}
              <EstimateDisclaimer className="mt-2" />
            </div>
          )}

          {/* Evidence list */}
          <div className="flex-1 overflow-y-auto px-5 py-4">
            {resolvedEvidences.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {t('noEvidence')}
              </p>
            ) : (
              <div className="space-y-4">
                {resolvedEvidences.map(({ evidence, article }) => {
                  const w = evidence.weight / 100;
                  const annual = calculateAnnualImpact({
                    healthMinutes: article.calculationParams.dailyHealthMinutes * w,
                    costSaving: article.calculationParams.dailyCostSaving * w,
                    incomeGain: article.calculationParams.dailyIncomeGain * w,
                    positiveMoodMinutes: article.calculationParams.dailyPositiveMoodMinutes * w,
                  });

                  return (
                    <div
                      key={evidence.id}
                      className="rounded-xl border border-[#E5E4E1] bg-card p-4"
                    >
                      <div className="flex items-center gap-3 mb-2">
                        <HabitIcon name={article.defaultIcon} size={20} />
                        <span className="flex-1 truncate text-sm font-semibold">
                          {article.habitName}
                        </span>
                        <button
                          type="button"
                          onClick={() => onRemoveEvidence(habitId, evidence.id)}
                          className="shrink-0 rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>

                      {/* Annual impact for this evidence */}
                      <div className="mb-3 flex gap-3 text-[11px] text-muted-foreground">
                        <span className="flex items-center gap-0.5"><HeartPulse className="size-3" /> +{formatHealthMinutes(annual.healthMinutes)}{tImpact('perYear')}</span>
                        <span className="flex items-center gap-0.5"><Wallet className="size-3" /> {formatCurrency(annual.costSaving)}{tImpact('perYear')}</span>
                        <span className="flex items-center gap-0.5"><TrendingUp className="size-3" /> {formatCurrency(annual.incomeGain)}{tImpact('perYear')}</span>
                        {annual.positiveMoodMinutes > 0 && (
                          <span className="flex items-center gap-0.5" aria-label={tImpact('dailyPositiveMood')}><Smile className="size-3" /> +{formatHealthMinutes(annual.positiveMoodMinutes)}{tImpact('perYear')}</span>
                        )}
                      </div>

                      {/* Weight slider */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">{t('weight')}</span>
                          <span className="font-semibold text-success">
                            {evidence.weight}%
                          </span>
                        </div>
                        <Slider
                          value={[evidence.weight]}
                          onValueChange={([val]) => onSetWeight(habitId, evidence.id, val)}
                          min={1}
                          max={100}
                          step={5}
                          className="w-full"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Add button */}
          <div className="shrink-0 border-t px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <Button
              onClick={() => setPickerOpen(true)}
              variant="outline"
              className="w-full"
            >
              <Plus className="size-4" />
              {t('addEvidence')}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <EvidencePicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onSelect={handlePickerSelect}
        initialSelected={evidences.map((e) => e.articleId)}
      />
    </>
  );
}
