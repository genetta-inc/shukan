import { createClient } from './client';
import type { StatGender } from '@/data/life-expectancy';

// DB の gender CHECK 制約と一致させる（D7）
export type ProfileGender = StatGender; // 'male' | 'female' | 'other' | 'unspecified'

/** snake_case の DB 行（user_profiles） */
export interface UserProfileRow {
  user_id: string;
  birth_year: number | null;
  gender: ProfileGender;
  country: string;
  annual_income: number | null;
  currency: string;
  tracked_kpis: string[];
  created_at: string;
  updated_at: string;
  /** 初回チュートリアルの完了時刻。NULL = 未完了（issue #117） */
  tutorial_completed_at: string | null;
}

/** camelCase のドメイン型（D7: 利用が限定的なためライブラリに同居） */
export interface UserProfile {
  userId: string;
  birthYear: number | null;
  gender: ProfileGender;
  country: string;
  annualIncome: number | null;
  currency: string;
  trackedKpis: string[];
  createdAt: string;
  updatedAt: string;
  tutorialCompletedAt: string | null;
}

/** upsert の入力（書き込み対象の入力値のみ。派生値は保存しない） */
export interface UserProfileInput {
  birthYear: number | null;
  gender: ProfileGender;
  country: string;
  annualIncome: number | null;
  currency: string;
  trackedKpis: string[];
}

/** Row（snake_case）→ UserProfile（camelCase）変換。habits.ts の toXxx() 流儀 */
export function toUserProfile(row: UserProfileRow): UserProfile {
  return {
    userId: row.user_id,
    birthYear: row.birth_year,
    gender: row.gender,
    country: row.country,
    annualIncome: row.annual_income,
    currency: row.currency,
    trackedKpis: row.tracked_kpis ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    tutorialCompletedAt: row.tutorial_completed_at,
  };
}

/**
 * ログイン中ユーザーのプロフィールを取得する。
 * 行が存在しない場合は null（maybeSingle）。
 */
export async function fetchUserProfile(): Promise<UserProfile | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('user_profiles')
    .select('*')
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return toUserProfile(data as UserProfileRow);
}

/**
 * プロフィールを upsert する（1 ユーザー 1 行、onConflict: user_id）。
 * updated_at はアプリ側で設定（D3）。annualIncome / birthYear は null 許容。
 */
export async function upsertUserProfile(
  userId: string,
  input: UserProfileInput
): Promise<UserProfile> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('user_profiles')
    .upsert(
      {
        user_id: userId,
        birth_year: input.birthYear,
        gender: input.gender,
        country: input.country,
        annual_income: input.annualIncome,
        currency: input.currency,
        tracked_kpis: input.trackedKpis,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    )
    .select()
    .single();
  if (error) throw error;
  return toUserProfile(data as UserProfileRow);
}

/**
 * 初回チュートリアル（コーチマーク）の完走・スキップ時に呼ぶ（issue #117）。
 * `tutorial_completed_at` を now() で更新する。以後は DB 判定で自動起動しない。
 *
 * カラム単位の update（onboarding-guard.ts の hasUserProfile と同様、現在セッションの
 * ユーザーIDを自前で取得して対象行を絞る）。行が存在しない場合（未オンボーディング）は
 * 呼び出し側の前提が崩れているため、その旨をエラーとして投げる（握り潰さない）。
 */
export async function markTutorialCompleted(): Promise<void> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('markTutorialCompleted: no authenticated user');

  const { error } = await supabase
    .from('user_profiles')
    .update({ tutorial_completed_at: new Date().toISOString() })
    .eq('user_id', user.id);
  if (error) throw error;
}
