'use client';

import { useTranslations } from 'next-intl';
import { HeartPulse, Wallet, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { calculateDailyImpact, calculateAnnualImpact, formatHealthMinutes, formatCurrency, type DailyImpact } from '@/lib/impact';
import { getArticle } from '@/data/impact-articles';
import type { HabitEvidence, LifeImpactArticle } from '@/types/impact';

interface ImpactBadgeFromArticleProps {
  article: LifeImpactArticle;
  mode?: 'daily' | 'annual';
  useMan?: boolean;
  onTap?: () => void;
  plain?: boolean;
}

interface ImpactBadgeFromEvidencesProps {
  evidences: HabitEvidence[];
  mode?: 'daily' | 'annual';
  useMan?: boolean;
  onTap?: () => void;
  plain?: boolean;
}

interface ImpactBadgeFromValuesProps {
  daily: DailyImpact;
  mode?: 'daily' | 'annual';
  useMan?: boolean;
  onTap?: () => void;
  plain?: boolean;
}

type ImpactBadgeProps =
  | ImpactBadgeFromArticleProps
  | ImpactBadgeFromEvidencesProps
  | ImpactBadgeFromValuesProps;

function getDailyValues(props: ImpactBadgeProps): DailyImpact | null {
  if ('daily' in props) return props.daily;
  if ('evidences' in props) {
    if (props.evidences.length === 0) return null;
    return calculateDailyImpact(props.evidences, getArticle);
  }
  if ('article' in props) {
    const p = props.article.calculationParams;
    return {
      healthMinutes: p.dailyHealthMinutes,
      costSaving: p.dailyCostSaving,
      incomeGain: p.dailyIncomeGain,
      positiveMoodMinutes: p.dailyPositiveMoodMinutes,
    };
  }
  return null;
}

export function ImpactBadge(props: ImpactBadgeProps) {
  const t = useTranslations('impact');
  const daily = getDailyValues(props);
  if (!daily) return null;

  const mode = props.mode ?? 'annual';
  const values = mode === 'annual' ? calculateAnnualImpact(daily) : daily;
  const periodLabel = mode === 'annual' ? t('perYear') : t('perDay');
  const useMan = props.useMan ?? true;

  const Wrapper = props.onTap ? 'button' : 'div';
  const wrapperProps = props.onTap
    ? {
        type: 'button' as const,
        onClick: (e: React.MouseEvent) => {
          e.stopPropagation();
          props.onTap?.();
        },
      }
    : {};

  return (
    <Wrapper
      {...wrapperProps}
      className={cn(
        'flex w-full items-center justify-between text-left',
        // plain: 親側のボックスに埋め込む用（枠・背景を持たない）
        props.plain ? '' : 'rounded-xl border border-success/20 bg-success/5 px-3.5 py-3',
      )}
    >
      <div className="flex flex-col items-center gap-0.5">
        <HeartPulse className="size-4 text-success" />
        <span className="text-sm font-bold text-success">
          +{formatHealthMinutes(values.healthMinutes)}
        </span>
        <span className="text-[9px] font-medium text-[#9C9B99]">
          {t('dailyHealth')}
        </span>
      </div>
      <div className="flex flex-col items-center gap-0.5">
        <Wallet className="size-4 text-success" />
        <span className="text-sm font-bold text-success">
          {formatCurrency(values.costSaving, useMan)}
        </span>
        <span className="text-[9px] font-medium text-[#9C9B99]">
          {t('dailyCost')}
        </span>
      </div>
      <div className="flex flex-col items-center gap-0.5">
        <TrendingUp className="size-4 text-success" />
        <span className="text-sm font-bold text-success">
          {formatCurrency(values.incomeGain, useMan)}
        </span>
        <span className="text-[9px] font-medium text-[#9C9B99]">
          {t('dailyIncome')}
        </span>
      </div>
      <span className="text-xs font-medium text-[#9C9B99]">{periodLabel}</span>
    </Wrapper>
  );
}
