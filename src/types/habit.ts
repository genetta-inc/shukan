import type { ArticleId, HabitEvidence, LifeImpactSavings } from './impact';

export interface Habit {
  id: string;
  name: string;
  description?: string;
  lifeSignificance?: string;
  icon: string;
  frequency: 'everyday' | 'weekday' | 'custom' | 'weekly';
  customDays?: number[];
  type: 'positive' | 'quit';
  weeklyTarget?: number;
  createdAt: string;
  archived: boolean;
  impactArticleId?: ArticleId; // legacy single-evidence — kept for backward compat
  evidences: HabitEvidence[];
  sortOrder: number;
  /**
   * 習慣のライフサイクル状態。
   *   'active'      … これから積み上げる習慣（既定）
   *   'established' … 既に身についた（習慣化済み）習慣
   * 読み出し（toHabit）は常に値を埋める（DB 既定 'active' / フォールバックあり）ため
   * コンシューマに undefined を漏らさない必須フィールドとする。
   */
  status: 'active' | 'established';
  /** established の習慣が身についた開始日（YYYY-MM-DD）。active では undefined。 */
  establishedSince?: string;
  /**
   * エビデンス未紐付けの習慣について「エビデンスを追加してほしい」リクエストを送信した日時
   * （ISO 文字列）。未送信なら undefined（issue #90）。habit_id 単位で冪等なので高々1件。
   */
  evidenceRequestedAt?: string;
}

/**
 * habit 書き込み（insert）時の入力型。
 * id/createdAt/archived/sortOrder は DB / サーバ側で割り当てるため除外。
 * status/establishedSince は省略可能（省略時は active 既定）にして、
 * 既存の書き込み経路（habit-form / discover 採用）を後方互換に保つ。
 * established 習慣を保存する経路（onboarding v2）はこのフィールドに値を渡す（change-C）。
 */
export type HabitInsertInput = Omit<
  Habit,
  'id' | 'createdAt' | 'archived' | 'sortOrder' | 'status' | 'establishedSince'
> & {
  status?: 'active' | 'established';
  establishedSince?: string;
};

export interface HabitCompletion {
  habitId: string;
  date: string;
  completedAt: string;
  status: 'completed' | 'failed' | 'rocket_used' | 'skipped';
  note?: string;
  /**
   * quit 習慣の失敗日に「どれくらい我慢できたか」を 0-100 で記録する（issue #104）。
   * failed 以外・未入力では undefined。表示上は undefined = 全面赤（無抵抗と同等）。
   */
  resistRate?: number;
}

export interface DailyReflection {
  id: string;
  userId: string;
  date: string;
  mood?: number;
  comment?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DayStatus {
  date: string;
  status: 'completed' | 'failed' | 'none' | 'rocket_used' | 'skipped';
  /** failed 日の我慢率（0-100）。表示のグラデーション（赤面積 = 100 − resistRate）に使う。 */
  resistRate?: number;
}

export interface HabitWithStats extends Habit {
  currentStreak: number;
  longestStreak: number;
  completedToday: boolean;
  skippedToday: boolean;
  completionRate: number;
  recentDays: DayStatus[];
  /**
   * 編集可能枠（今日を除く過去 EDITABLE_PAST_DAYS 日）の対象日。新しい順。
   * 週ドット表示と一括編集シートの行はどちらもこれを描画し、常に1:1で一致する（issue #107）。
   */
  editablePastDays: DayStatus[];
  allDays: DayStatus[];
  rockets: number;
  rocketNextIn: number;
  weeklyCompletedCount?: number;
  impactSavings?: LifeImpactSavings;
}

export interface AppSettings {
  theme: 'light' | 'dark' | 'system';
  locale: 'en' | 'ja';
}
