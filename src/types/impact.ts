// 記事IDの型は記事レジストリ（src/data/impact-articles/index.ts のマップ）から導出する。
// 記事を追加/削除しても、このファイルや VALID_ARTICLE_IDS を手で編集する必要はない。
// 実行時ヘルパー（VALID_ARTICLE_IDS / isValidArticleId）は循環参照を避けるため
// レジストリ側にあり、`@/data/impact-articles` から import する。
import type { ArticleId } from '@/data/impact-articles';
export type { ArticleId };

// 計算ロジックのステップ（1つの計算過程を表す）
export interface CalcStep {
  label: string;      // ステップの説明（例: "研究結果"）
  value?: string;     // 値（例: "10年延命"）
  formula?: string;   // 計算式（例: "8年 × 525,600分 ÷ 40年 ÷ 365日"）
  result?: string;    // 結果（例: "288分/日"）
}

// 記事のヒーロー画像（Discover カード・エビデンスシート・ホームのコラージュ背景で共有）。
// url は Unsplash のサイズ指定クエリ（?w=..&h=..）を含まない「ベースURL」。
// 呼び出し側（evidence-hero-images.ts のヘルパー）が用途ごとにサイズを付与する。
// gradient は画像が読めない/未設定のときのフォールバック用 Tailwind グラデーション。
export interface HeroImage {
  /** Unsplash ベースURL（サイズクエリなし。例: https://images.unsplash.com/photo-xxxx） */
  url: string;
  /** フォールバック用グラデーション（例: 'from-gray-400 to-gray-600'） */
  gradient: string;
}

// 記事データ（静的、ビルド時バンドル）
export interface LifeImpactArticle {
  // レジストリのキーと一致させる（実行時整合は validate-evidence がチェック）。
  // ArticleId をここで参照するとレジストリ定義と循環するため string にしている。
  habitCategory: string;
  habitName: string;

  // ヒーロー画像（任意）。未設定の記事は各コンポーネント側の既定グラデーションにフォールバックする。
  heroImage?: HeroImage;

  // 固定レイヤー: 普遍的な研究結果（全ユーザー共通）
  article: {
    // 研究紹介テキスト。{{health_inference}}, {{cost_inference}},
    // {{income_inference}}, {{cumulative}} をブロックプレースホルダーとして含む。
    researchBody: string;
    sources: {
      id: number;
      text: string;
      url?: string;
    }[];
  };

  // 推論レイヤー: ユーザープロフィールに基づく推論段落
  // V2: ハードコードプロフィール用に事前作成
  // V3: LLMがユーザープロフィールから動的生成
  inferences: {
    health: string;
    cost: string;
    income: string;
    // 「前向きな気持ちの時間」KPIの推論段落。renderArticle では使用しない
    // 計算・将来表示用のデータとして持つのみ（代表記事のみ設定）
    positiveMood?: string;
    cumulative: string;
  };

  // 計算用パラメータ（貯金計算に使用、記事表示とは独立）
  calculationParams: {
    dailyHealthMinutes: number;
    dailyCostSaving: number;
    dailyIncomeGain: number;
    // 「前向きな気持ちの時間」KPI（分/日）。0 = 未設定（UI 非表示判定に使える）
    dailyPositiveMoodMinutes: number;
  };

  confidenceLevel: 'high' | 'medium' | 'low';

  // 計算ロジック（算出根拠の構造化データ、optional）
  calculationLogic?: {
    health: CalcStep[];
    cost: CalcStep[];
    income: CalcStep[];
    // dailyPositiveMoodMinutes > 0 の記事のみ設定（固定前提 16h/50% の根拠を明記）
    positiveMood?: CalcStep[];
  };

  // Discover（マーケットプレイス）用メタデータ
  defaultHabitType: 'positive' | 'quit';
  defaultIcon: string;
}

// V2ハードコードプロフィール
export const V2_DEFAULT_PROFILE = {
  nationality: 'Japanese' as const,
  gender: 'male' as const,
  birthYear: 1984,
  age: 42,
  annualIncome: 15_000_000,
  currency: 'JPY' as const,
  remainingWorkingYears: 23,
  dailyWage: 62_500,
  remainingLifeExpectancy: 40,
  userContext: '42歳の日本人男性（年収1,500万円）',
};

// 習慣とエビデンスの紐付け（多対多 + 重み）
export interface HabitEvidence {
  id: string;
  habitId: string;
  articleId: ArticleId;
  weight: number; // 1-100 (パーセンテージ)
}

// 累積インパクト（算出値、保存なし）
export interface LifeImpactSavings {
  completedDays: number;
  healthMinutes: number;
  costSaving: number;
  incomeGain: number;
  positiveMoodMinutes: number;
}
