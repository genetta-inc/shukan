'use client';

import { useTranslations } from 'next-intl';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from '@/components/ui/sheet';
import { HabitIcon } from '@/components/ui/habit-icon';
import type { Habit } from '@/types/habit';

interface GraduationProposalSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  habit: Habit | null;
  /** 提案時点での連続日数（呼び出し側が calculateStreak / HabitWithStats.currentStreak から渡す）。 */
  currentStreak: number;
  /** 「卒業する」選択時。呼び出し側が status を 'established' に更新する。 */
  onAccept: () => void;
  /** 「まだ続ける」選択時。呼び出し側が graduationDeclinedAt を設定し、以後再提案しない。 */
  onDecline: () => void;
}

/**
 * 連続30日到達時の「卒業」提案シート（issue #91）。
 * yesterday-review-sheet.tsx と同じ Sheet(side="bottom") 構造を踏襲する。
 */
export function GraduationProposalSheet({
  open,
  onOpenChange,
  habit,
  currentStreak,
  onAccept,
  onDecline,
}: GraduationProposalSheetProps) {
  const t = useTranslations('habits');

  if (!habit) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-2xl pb-safe">
        <SheetHeader className="pb-2">
          <SheetTitle className="text-base">{t('graduationProposalTitle')}</SheetTitle>
        </SheetHeader>

        <div className="flex flex-col gap-4 px-4 pb-2">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-full flex items-center justify-center shrink-0 bg-muted">
              <HabitIcon name={habit.icon} size={20} />
            </div>
            <span className="flex-1 text-sm font-medium leading-snug">{habit.name}</span>
          </div>

          <p className="text-sm text-muted-foreground leading-relaxed">
            {t('graduationProposalBody', { name: habit.name, days: currentStreak })}
          </p>
        </div>

        <SheetFooter className="px-4 pt-2 flex flex-col gap-2">
          <button
            type="button"
            onClick={onAccept}
            className="w-full rounded-xl bg-primary text-primary-foreground py-3 text-sm font-semibold transition-opacity hover:opacity-90 active:opacity-70"
          >
            {t('graduationAccept')}
          </button>
          <button
            type="button"
            onClick={onDecline}
            className="w-full rounded-xl border border-muted-foreground/20 py-3 text-sm font-medium text-muted-foreground transition-opacity hover:opacity-90 active:opacity-70"
          >
            {t('graduationDecline')}
          </button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
