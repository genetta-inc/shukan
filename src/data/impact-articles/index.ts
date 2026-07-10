import { quitSmoking } from './quit-smoking';
import { quitPorn } from './quit-porn';
import { quitAlcohol } from './quit-alcohol';
import { quitSugar } from './quit-sugar';
import { quitJunkFood } from './quit-junk-food';
import { quitSocialMedia } from './quit-social-media';
import { noYoutube } from './no-youtube';
import { noScreensBeforeBed } from './no-screens-before-bed';
import { noImpulseBuying } from './no-impulse-buying';
import { morningPlanning } from './morning-planning';
import { dailyCardio } from './daily-cardio';
import { dailyStrength } from './daily-strength';
import { dailyWalking } from './daily-walking';
import { dailyStretching } from './daily-stretching';
import { dailyYoga } from './daily-yoga';
import { dailyMeditation } from './daily-meditation';
import { dailyJournaling } from './daily-journaling';
import { dailyReading } from './daily-reading';
import { dailySaving } from './daily-saving';
import { coldShower } from './cold-shower';
import { sleep7hours } from './sleep-7hours';
import { wakeEarly } from './wake-early';
import { gratitudePractice } from './gratitude-practice';
import { drinkWater } from './drink-water';
import { eatVegetables } from './eat-vegetables';
import { intermittentFasting } from './intermittent-fasting';
import { homeCooking } from './home-cooking';
import { deepWork } from './deep-work';
import { learnLanguage } from './learn-language';
import { timeInNature } from './time-in-nature';
import { morningTidying } from './morning-tidying';
import { dailyHabitReview } from './daily-habit-review';
import { scheduleAdherence } from './schedule-adherence';
import { pomodoroTechnique } from './pomodoro-technique';
import { movementBreaks } from './movement-breaks';
import { socialConnection } from './social-connection';
import { morningLight } from './morning-light';
import { fermentedFood } from './fermented-food';
import type { LifeImpactArticle } from '@/types/impact';

/**
 * 記事レジストリ（エビデンスの単一ソース）。
 *
 * 新しい記事を追加する手順はこの2ステップだけ:
 *   ① `src/data/impact-articles/<slug>.ts` を作成（heroImage 含む記事データ）
 *   ② 下記マップに `<article_id>: <import 名>,` を1行追加（＋上の import を1行）
 *
 * `ArticleId` 型・`VALID_ARTICLE_IDS`・`isValidArticleId`、および Discover / エビデンスシートの
 * ヒーロー画像・フォールバックグラデーションは、すべてこのマップから導出される。
 * types/impact.ts の union や各コンポーネントのローカルな画像マップを手で編集する必要はない。
 */
const impactArticles = {
  // Quit habits
  quit_smoking: quitSmoking,
  quit_porn: quitPorn,
  quit_alcohol: quitAlcohol,
  quit_sugar: quitSugar,
  quit_junk_food: quitJunkFood,
  quit_social_media: quitSocialMedia,
  no_youtube: noYoutube,
  no_screens_before_bed: noScreensBeforeBed,
  no_impulse_buying: noImpulseBuying,
  // Positive habits - Exercise
  daily_cardio: dailyCardio,
  daily_strength: dailyStrength,
  daily_walking: dailyWalking,
  daily_stretching: dailyStretching,
  daily_yoga: dailyYoga,
  cold_shower: coldShower,
  // Positive habits - Mental wellness
  daily_meditation: dailyMeditation,
  daily_journaling: dailyJournaling,
  gratitude_practice: gratitudePractice,
  // Positive habits - Sleep
  sleep_7hours: sleep7hours,
  wake_early: wakeEarly,
  // Positive habits - Nutrition
  drink_water: drinkWater,
  eat_vegetables: eatVegetables,
  intermittent_fasting: intermittentFasting,
  home_cooking: homeCooking,
  // Positive habits - Productivity
  morning_planning: morningPlanning,
  daily_reading: dailyReading,
  deep_work: deepWork,
  learn_language: learnLanguage,
  // Positive habits - Financial & Other
  daily_saving: dailySaving,
  time_in_nature: timeInNature,
  // Positive habits - Home & Environment
  morning_tidying: morningTidying,
  daily_habit_review: dailyHabitReview,
  // Positive habits - Self-discipline & Productivity
  schedule_adherence: scheduleAdherence,
  pomodoro_technique: pomodoroTechnique,
  movement_breaks: movementBreaks,
  // Positive habits - Social & Environment
  social_connection: socialConnection,
  morning_light: morningLight,
  fermented_food: fermentedFood,
} satisfies Record<string, LifeImpactArticle>;

/** 有効な記事ID。マップのキーから導出（手動メンテ不要）。 */
export type ArticleId = keyof typeof impactArticles;

/** 全記事ID（登録順）。 */
export const VALID_ARTICLE_IDS = Object.keys(impactArticles) as ArticleId[];

/** 文字列が登録済み記事IDかを判定する型ガード。 */
export function isValidArticleId(id: string | null | undefined): id is ArticleId {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(impactArticles, id);
}

export function getArticle(id: ArticleId): LifeImpactArticle | undefined {
  return impactArticles[id];
}

export function getArticleList(): {
  id: ArticleId;
  name: string;
  defaultHabitType: 'positive' | 'quit';
  defaultIcon: string;
  confidenceLevel: 'high' | 'medium' | 'low';
  calculationParams: LifeImpactArticle['calculationParams'];
  heroImage: LifeImpactArticle['heroImage'];
}[] {
  return VALID_ARTICLE_IDS.map((id) => {
    const article = impactArticles[id];
    return {
      id,
      name: article.habitName,
      defaultHabitType: article.defaultHabitType,
      defaultIcon: article.defaultIcon,
      confidenceLevel: article.confidenceLevel,
      calculationParams: article.calculationParams,
      heroImage: article.heroImage,
    };
  });
}
