'use client';

import { useState, useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { Check, ChevronDown, ChevronUp, Maximize2, GripVertical, SkipForward, Undo2, Images, History } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { getTodayString, nextStatus } from '@/lib/habits';
import { useLongPress } from '@/hooks/useLongPress';
import { ImpactBadge } from '@/components/habits/impact-badge';
import { SavingsCard } from '@/components/habits/savings-card';
import { getEvidenceHeroImage } from '@/data/evidence-hero-images';
import { failedFillStyle } from '@/components/habits/failed-fill';
import type { DayStatus, HabitWithStats } from '@/types/habit';

// F15: デイリー習慣カード背景に敷くエビデンス画像コラージュの最大枚数。
// 5枚以上ある習慣は先頭4枚のみ（等分割が細くなりすぎて見た目が破綻するため打ち切り）。
const MAX_COLLAGE_IMAGES = 4;

interface HabitCardProps {
  habit: HabitWithStats;
  isExpanded: boolean;
  onToggleExpand: (id: string) => void;
  onDayStatusChange: (habitId: string, date: string, status: 'completed' | 'failed' | 'none' | 'skipped') => void;
  onOpenDetail: (id: string) => void;
  /** 長押しで今日のアクションシート（失敗/スキップ/メモ）を開く（issue #104） */
  onOpenActionSheet: (habitId: string, date: string) => void;
  /** 週ドット領域タップ・展開ビューのボタンで過去日の一括編集シートを開く（issue #107） */
  onOpenBulkEdit: (habitId: string) => void;
  onSkipToday: (id: string) => void;
  /** 推定値（ImpactBadge）タップで算出根拠（エビデンス記事）へ 1 タップ到達する導線（issue #39） */
  onOpenArticle?: (articleId: string) => void;
}

// 過去日ドットは表示専用（issue #107）。個別タップは持たず、
// ドット領域全体のタップで一括編集シートを開く（入力はシート内の大きなボタンで行う）。
function DayStatusDot({
  day,
  onImage = false,
}: {
  day: DayStatus;
  /** 写真バナー上に載る場合の扱い。v2: light=インク（明るいベール上）/ dark=白（暗い島上）。 */
  onImage?: boolean;
}) {
  const { status } = day;

  return (
    // 失敗日は inline の failedFillStyle（我慢率に応じた conic-gradient）で塗る。他は v2 トークン。
    <span
      className={cn(
        'flex items-center justify-center rounded-full size-3 transition-all',
        (status === 'completed' || status === 'rocket_used') && 'bg-success',
        status === 'none' && (onImage ? 'border border-skipped bg-transparent dark:border-white/70 dark:bg-white/10' : 'border border-skipped bg-transparent'),
        status === 'skipped' && (onImage ? 'bg-skipped dark:bg-white/45' : 'bg-skipped'),
      )}
      style={status === 'failed' ? failedFillStyle(day.resistRate) : undefined}
    />
  );
}

// 達成時の紙吹雪パーティクル。装飾だが「達成＝緑」の意味に沿わせ、全粒を success トークンで
// 統一する（旧: 虹色 hex 直書き）。恣意的な装飾色は使わない（DESIGN.md「意味だけが色を持つ」）。
const CELEBRATION_COLORS = Array.from({ length: 6 }, () => 'var(--success)');

function CelebrationEffect() {
  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      {CELEBRATION_COLORS.map((color, i) => {
        const angle = (i / CELEBRATION_COLORS.length) * 360;
        const rad = (angle * Math.PI) / 180;
        const tx = Math.cos(rad) * 28;
        const ty = Math.sin(rad) * 28;
        return (
          <span
            key={i}
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 animate-[celebration_600ms_ease-out_forwards]"
            style={{
              '--tx': `${tx}px`,
              '--ty': `${ty}px`,
            } as React.CSSProperties}
          >
            <span
              className="block size-2 rounded-full"
              style={{ backgroundColor: color }}
            />
          </span>
        );
      })}
    </div>
  );
}

function StatusIndicator({
  habit,
  onTapToday,
  onLongPressToday,
  onImage = false,
}: {
  habit: HabitWithStats;
  onTapToday: () => void;
  onLongPressToday: () => void;
  /** 写真バナー上では未達リング/枠を白系にして視認性を保つ */
  onImage?: boolean;
}) {
  // v2: 未達リング枠は light=インク（border-skipped）で、dark かつ写真上のみ白系に。
  const idleBorder = onImage ? 'border-skipped dark:border-white/70' : 'border-skipped';
  const [showCelebration, setShowCelebration] = useState(false);
  const prevStatusRef = useRef<string | null>(null);
  const pressHandlers = useLongPress(onLongPressToday, onTapToday);

  const today = habit.recentDays?.[0];
  const todayStatus = today?.status ?? 'none';

  // 未完了→完了への遷移を検知して祝福演出を一度だけ表示する意図的パターン。
  useEffect(() => {
    if (
      prevStatusRef.current !== null &&
      prevStatusRef.current !== 'completed' &&
      prevStatusRef.current !== 'rocket_used' &&
      (todayStatus === 'completed' || todayStatus === 'rocket_used')
    ) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- celebration triggered on status transition
      setShowCelebration(true);
      const timer = setTimeout(() => setShowCelebration(false), 700);
      return () => clearTimeout(timer);
    }
    prevStatusRef.current = todayStatus;
  }, [todayStatus]);

  // #105: やらない系(quit)習慣も達成の二値トグルに統一。旧・我慢カウントの urge リング（VS モーダル）は廃止。
  // Weekly positive habits: status based on weekly target achievement
  if (habit.type !== 'quit' && habit.frequency === 'weekly') {
    const weeklyDone = (habit.weeklyCompletedCount ?? 0) >= (habit.weeklyTarget ?? 1);

    return (
      <div className="relative flex size-8 shrink-0 items-center justify-center">
        <button
          type="button"
          data-tutorial="habit-status"
          {...pressHandlers}
          className={cn(
            'flex size-8 shrink-0 touch-none items-center justify-center rounded-full transition-all',
            weeklyDone ? 'bg-success' : cn('border-2', idleBorder),
          )}
        >
          {weeklyDone && (
            <Check className="size-4 text-success-foreground" strokeWidth={3} />
          )}
        </button>
        {showCelebration && <CelebrationEffect />}
      </div>
    );
  }

  // Daily habits (positive & quit): tap = 達成の二値トグル、長押し = アクションシート（issue #104）
  const isFailed = todayStatus === 'failed';
  const showResistRate = isFailed && today?.resistRate !== undefined && today.resistRate > 0;

  return (
    <div className="relative flex size-8 shrink-0 items-center justify-center">
      <button
        type="button"
        data-tutorial="habit-status"
        {...pressHandlers}
        className={cn(
          'flex size-8 shrink-0 touch-none items-center justify-center rounded-full transition-all',
          (todayStatus === 'completed' || todayStatus === 'rocket_used') && 'bg-success',
          // 失敗日は inline の failedFillStyle で塗る（静的 bg-danger は使わない）。none/skipped は v2 トークン。
          todayStatus === 'none' && cn('border-2', idleBorder),
          todayStatus === 'skipped' && 'bg-skipped',
        )}
        style={isFailed ? failedFillStyle(today?.resistRate) : undefined}
      >
        {(todayStatus === 'completed' || todayStatus === 'rocket_used') && (
          <Check className="size-4 text-success-foreground" strokeWidth={3} />
        )}
        {showResistRate && (
          <span className="text-[9px] font-bold text-white drop-shadow-sm">
            {today?.resistRate}%
          </span>
        )}
      </button>
      {showCelebration && <CelebrationEffect />}
    </div>
  );
}

export function HabitCard({
  habit,
  isExpanded,
  onToggleExpand,
  onDayStatusChange,
  onOpenDetail,
  onOpenActionSheet,
  onOpenBulkEdit,
  onSkipToday,
  onOpenArticle,
}: HabitCardProps) {
  const t = useTranslations('habits');
  const tDays = useTranslations('days');
  const tStats = useTranslations('stats');
  const isSkipped = habit.skippedToday;
  const today = getTodayString();
  const dayKeys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
  const dayLabels = dayKeys.map((k) => tDays(k));

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: habit.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const handleDotTap = (day: DayStatus) => {
    onDayStatusChange(habit.id, day.date, nextStatus(day.status));
  };

  const streakPercent = Math.min(Math.round((habit.currentStreak / 30) * 100), 100);

  // F15: 紐づくエビデンス記事の画像を等分割コラージュ背景に使う（画像を持つ記事のみ・最大4枚）。
  // 画像を1枚も持たない習慣（ゼロから作ったカスタム習慣等）は従来の通常カード表示にフォールバック。
  const evidenceImages = (habit.evidences ?? [])
    .map((ev) => getEvidenceHeroImage(ev.articleId))
    .filter((url): url is string => !!url)
    .slice(0, MAX_COLLAGE_IMAGES);
  const hasEvidenceBg = evidenceImages.length > 0;

  // 継続日数（ストリーク）の中身（箱なし）。onBanner=写真バナー内。
  // v2: バナー内の数値・ラベルは中立（light=インク / dark=白）。緑は進捗バーにのみ使う。
  const streakInner = (onBanner: boolean) => (
    <>
      <div className="flex items-baseline gap-2">
        <span className={cn('text-2xl font-bold', onBanner ? 'text-foreground dark:text-white' : 'text-success')}>
          {habit.currentStreak}
        </span>
        <span className={cn('text-sm', onBanner ? 'text-muted-foreground dark:text-white/70' : 'text-success/70')}>
          {tStats('days')}
        </span>
        <span className={cn('ml-auto text-xs', onBanner ? 'text-muted-foreground dark:text-white/60' : 'text-success/60')}>
          {t('streakGoal', { percent: streakPercent })}
        </span>
      </div>
      {/* 進捗バー: 緑＝積み上げ（ポジティブ）の意味で使用 */}
      <div className={cn('mt-2 h-1.5 rounded-full', onBanner ? 'bg-foreground/15 dark:bg-white/25' : 'bg-white')}>
        <div
          className="h-full rounded-full bg-success transition-all duration-300"
          style={{ width: `${streakPercent}%` }}
        />
      </div>
    </>
  );

  // 折りたたみ行を写真バナー版・通常版で共有する部品。v2: バナー上は light=インク / dark=白。
  const dragHandle = (
    <button
      type="button"
      className={cn(
        'touch-none shrink-0 cursor-grab active:cursor-grabbing transition-colors',
        hasEvidenceBg
          ? 'text-muted-foreground/70 hover:text-foreground dark:text-white/55 dark:hover:text-white/90'
          : 'text-skipped hover:text-muted-foreground'
      )}
      {...attributes}
      {...listeners}
      onClick={(e) => e.stopPropagation()}
    >
      <GripVertical className="size-4" />
    </button>
  );

  const statusIndicator = (
    <StatusIndicator
      habit={habit}
      onImage={hasEvidenceBg}
      onTapToday={() => {
        const todayDay = (habit.recentDays ?? [])[0];
        if (todayDay) handleDotTap(todayDay);
      }}
      onLongPressToday={() => onOpenActionSheet(habit.id, today)}
    />
  );

  const chevron = isExpanded ? (
    <ChevronUp className="size-5" />
  ) : (
    <ChevronDown className="size-5" />
  );

  const frequencyLabel = (onBanner: boolean) => {
    const cls = cn('shrink-0 text-[11px]', onBanner ? 'text-muted-foreground dark:text-white/85 dark:banner-label' : 'text-muted-foreground');
    if (habit.frequency === 'weekly') {
      return <span className={cls}>{t('weeklyProgress', { current: habit.weeklyCompletedCount ?? 0, target: habit.weeklyTarget ?? 1 })}</span>;
    }
    if (habit.frequency === 'weekday') {
      return <span className={cls}>{t('weekday')}</span>;
    }
    if (habit.frequency === 'custom' && habit.customDays && habit.customDays.length > 0) {
      return <span className={cls}>{[...habit.customDays].sort((a, b) => a - b).map((d) => dayLabels[d]).join('・')}</span>;
    }
    return null;
  };

  // 週ドット領域全体が一括編集シートの起動ボタン（issue #107 案1）。
  // ドットは表示専用で、どこを押しても同じ。-m/p の不可視パディングでタッチ高さを確保。
  // 表示する日は一括編集シートの行と常に1:1（editablePastDays）。left=昨日, right=6日前
  // （今日の丸と合わせて計7日間＝1週間の窓）
  const dayDotsRow = (onBanner: boolean) =>
    (habit.editablePastDays ?? []).length > 0 ? (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onOpenBulkEdit(habit.id);
        }}
        aria-label={t('bulkEdit.open')}
        className="-mx-2 -my-2 flex items-center gap-1.5 self-start px-2 py-2"
      >
        {(habit.editablePastDays ?? []).map((day) => (
          <DayStatusDot key={day.date} day={day} onImage={onBanner} />
        ))}
      </button>
    ) : null;

  return (
    <div ref={setNodeRef} style={style} className={cn(isDragging && 'z-50 opacity-80')}>
    <Card
      className={cn(
        'gap-0 py-0 overflow-hidden transition-all duration-200',
        hasEvidenceBg && 'relative isolate rounded-2xl border-0 shadow-lg shadow-black/10 ring-1 ring-black/5 dark:ring-white/10'
      )}
    >
      {/* シネマティック・バナー: エビデンス写真を1枚目メインに全面へ敷く（枚数は右上バッジ）。
          v2: テーマで写真の扱いを変える。
          ・dark = 「暗い島」: 色相ティント + 黒スクリムで白文字を可読に（写真に光を残す）。
          ・light = 「明るいベール」: 背景色系の半透明ウォッシュ + ぼかしで frosted にし、
            インク文字がライト UI に馴染む。可読性はベール濃度で担保。 */}
      {hasEvidenceBg && (
        <>
          <img
            src={evidenceImages[0]}
            alt=""
            aria-hidden
            loading="lazy"
            className="absolute inset-0 h-full w-full object-cover"
          />
          {/* dark: 暗い島（色相ティント + 黒スクリム） */}
          <div aria-hidden className="banner-tint absolute inset-0 hidden dark:block" />
          <div
            aria-hidden
            className={cn('absolute inset-0 hidden dark:block', isExpanded ? 'banner-scrim-expanded' : 'banner-scrim')}
          />
          {/* light: 明るいベール（背景色ウォッシュ + ぼかし） */}
          <div
            aria-hidden
            className={cn('absolute inset-0 dark:hidden', isExpanded ? 'banner-veil-expanded' : 'banner-veil')}
          />
        </>
      )}

      {/* Collapsed row - always visible */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => onToggleExpand(habit.id)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onToggleExpand(habit.id); }}
        className="relative z-10 w-full cursor-pointer text-left"
      >
        {hasEvidenceBg ? (
          /* シネマティック・バナー: 高さのある写真バナー。上段にドラッグ/枚数/開閉、
             下段にステータス丸＋大きく太い白タイトル＋曜日ドットを重ねる。 */
          <div className="relative flex min-h-[96px] flex-col justify-end">
            <div className="absolute inset-x-0 top-0 flex items-center justify-between px-3 pt-2.5">
              {dragHandle}
              <div className="flex items-center gap-2">
                {evidenceImages.length > 1 && (
                  <span className="flex items-center gap-1 rounded-full bg-foreground/10 px-2 py-0.5 backdrop-blur-sm dark:bg-black/30">
                    <Images className="size-3 text-foreground/70 dark:text-white/85" />
                    <span className="text-[10px] font-semibold tabular-nums text-foreground/80 dark:text-white/90">{evidenceImages.length}</span>
                  </span>
                )}
                <span className="text-foreground/70 dark:text-white/85">{chevron}</span>
              </div>
            </div>

            <div className="flex items-end gap-3 px-3 pb-2.5 pt-8">
              {statusIndicator}
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2 min-w-0">
                  <span className={cn('banner-title truncate text-[19px] font-bold leading-tight tracking-tight text-foreground dark:text-white', isSkipped && 'text-muted-foreground dark:text-white/50')}>
                    {habit.name}
                  </span>
                  {frequencyLabel(true)}
                </div>
                <div className="mt-2">{dayDotsRow(true)}</div>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3 p-3">
            {dragHandle}
            {statusIndicator}
            <div className="flex-1 min-w-0 flex flex-col gap-1">
              <div className="flex items-baseline gap-2 min-w-0">
                <span className={cn('text-[15px] font-medium truncate', isSkipped && 'text-muted-foreground')}>
                  {habit.name}
                </span>
                {frequencyLabel(false)}
              </div>
              {dayDotsRow(false)}
            </div>
            <div className="shrink-0 text-muted-foreground">{chevron}</div>
          </div>
        )}
      </div>

      {/* Expanded body - smooth height transition via grid trick */}
      <div
        className={cn(
          'relative z-10 grid transition-[grid-template-rows] duration-300 ease-in-out',
          isExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        )}
      >
        <div className="overflow-hidden">
          <div className="px-3 pb-3 pt-0 space-y-3">
            {/* Life Significance */}
            {habit.lifeSignificance && (
              <div>
                <p className={cn('text-[10px] uppercase tracking-wider font-semibold mb-0.5', hasEvidenceBg ? 'text-muted-foreground dark:text-white/60' : 'text-muted-foreground')}>
                  {t('lifeSignificance')}
                </p>
                <p className={cn('text-sm', hasEvidenceBg ? 'text-foreground/80 dark:text-white/90' : 'text-foreground/80')}>
                  {habit.lifeSignificance}
                </p>
              </div>
            )}

            {/* F18: 写真カードでは KPI影響・継続日数・累積を「1つのガラスボックス」に内包する。
                外周ボーダーはなし。区切りはごく薄いディバイダ。隙間から背景が見える状態を解消。
                写真なしカードは従来どおり個別の箱で表示する。 */}
            {hasEvidenceBg ? (
              /* v2: ガラスボックスは light=明るい frosted パネル / dark=白ガラス。 */
              <div className="space-y-3 rounded-xl bg-background/70 p-3 backdrop-blur-md dark:bg-white/10">
                {habit.evidences.length > 0 && (
                  <ImpactBadge
                    evidences={habit.evidences}
                    mode="daily"
                    surface="bare"
                    onTap={
                      onOpenArticle
                        ? () => onOpenArticle(habit.evidences[0].articleId)
                        : undefined
                    }
                  />
                )}
                {habit.evidences.length > 0 && <div className="h-px bg-border/70 dark:bg-white/15" />}
                <div>{streakInner(true)}</div>
                {habit.impactSavings && <div className="h-px bg-border/70 dark:bg-white/15" />}
                {habit.impactSavings && (
                  <SavingsCard savings={habit.impactSavings} surface="bare" />
                )}
              </div>
            ) : (
              <>
                {/* Impact Badge */}
                {habit.evidences.length > 0 && (
                  <ImpactBadge
                    evidences={habit.evidences}
                    mode="daily"
                    surface="default"
                    onTap={
                      onOpenArticle
                        ? () => onOpenArticle(habit.evidences[0].articleId)
                        : undefined
                    }
                  />
                )}
                {/* Streak card */}
                <div className="rounded-lg bg-success/15 p-3">{streakInner(false)}</div>
                {/* Savings Card */}
                {habit.impactSavings && (
                  <SavingsCard savings={habit.impactSavings} surface="default" />
                )}
              </>
            )}

            {/* Detail + Skip/Unskip buttons */}
            <div className="flex gap-2">
              {/* F20: 詳細はポジティブな意味を持たないため緑をやめ、中立色に。
                  写真上は白ガラス、通常時は secondary。押せる affordance は維持。 */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenDetail(habit.id);
                }}
                className={cn(
                  'flex flex-1 items-center justify-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors',
                  hasEvidenceBg
                    ? 'bg-secondary text-secondary-foreground hover:bg-secondary/80 dark:bg-white/90 dark:text-gray-900 dark:hover:bg-white'
                    : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
                )}
              >
                <Maximize2 className="size-4" />
                {t('detail')}
              </button>
              {/* 過去日の一括編集シートへの第2入口（issue #107）。中立操作なので緑は使わない */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenBulkEdit(habit.id);
                }}
                className={cn(
                  'flex flex-1 items-center justify-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors',
                  hasEvidenceBg
                    ? 'bg-secondary text-secondary-foreground hover:bg-secondary/80 dark:bg-white/90 dark:text-gray-900 dark:hover:bg-white'
                    : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
                )}
              >
                <History className="size-4" />
                {t('bulkEdit.openButton')}
              </button>
              {/* スキップは中立操作。緑以外の中立アクセント（primary=インク/白ガラス）＋リングで
                  affordance を明示。v2: skipped 中の状態も琥珀をやめ無彩色（muted）に。休止＝注意は
                  色ではなく濃淡で示す（DESIGN.md「警告的注意は無彩色+濃淡で」）。 */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onSkipToday(habit.id);
                }}
                className={cn(
                  'flex shrink-0 items-center justify-center gap-1 rounded-lg px-3 py-2.5 text-sm font-medium ring-1 transition-colors',
                  isSkipped
                    ? 'bg-muted text-foreground ring-border hover:bg-muted/70'
                    : hasEvidenceBg
                      ? 'bg-primary/10 text-primary ring-primary/20 hover:bg-primary/20 dark:bg-white/15 dark:text-white dark:ring-white/30 dark:hover:bg-white/25'
                      : 'bg-primary/10 text-primary ring-primary/20 hover:bg-primary/20'
                )}
              >
                {isSkipped ? (
                  <>
                    <Undo2 className="size-4" />
                    {t('unskip')}
                  </>
                ) : (
                  <>
                    <SkipForward className="size-4" />
                    {t('skip')}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Card>
    </div>
  );
}
