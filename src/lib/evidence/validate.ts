// エビデンス品質の検証ロジック（純粋・同期）。
//
// 記事レジストリ（src/data/impact-articles）と習慣プリセット（src/data/habit-presets）を
// 唯一のデータ源として、記事データの整合性を機械チェックする。CLI（scripts/validate-evidence.ts）
// とユニットテスト（src/__tests__/evidence-validation.test.ts）の両方から呼ばれる。
//
// レベルの意味:
//   - 'error'   … 壊れている。CI を落とす（scripts/validate-evidence.ts が exit 1）。
//   - 'warning' … 人間のレビューを促すだけ。CI は落とさない。
//
// オンライン到達性チェック（URL に実際に HEAD を投げる）は副作用があるため本モジュールには
// 置かず、CLI 側で --online 指定時のみ実行する。

import { VALID_ARTICLE_IDS, getArticle } from '@/data/impact-articles';
import type { ArticleId } from '@/data/impact-articles';
import { HABIT_PRESETS } from '@/data/habit-presets';
import type { CalcStep, LifeImpactArticle } from '@/types/impact';

export interface Finding {
  level: 'error' | 'warning';
  code: string;
  /** 対象記事ID（記事横断のチェックでは undefined）。 */
  article?: string;
  message: string;
}

type ParamKey =
  | 'dailyHealthMinutes'
  | 'dailyCostSaving'
  | 'dailyIncomeGain'
  | 'dailyPositiveMoodMinutes';

const PARAM_KEYS: ParamKey[] = [
  'dailyHealthMinutes',
  'dailyCostSaving',
  'dailyIncomeGain',
  'dailyPositiveMoodMinutes',
];

// ── 外れ値検知のしきい値 ───────────────────────────────────────────────
//
// 効果値の分布は本質的に裾が重い（例: 禁煙の健康寿命 +288分/日 は「10年延命」の実データで、
// 中央値6分の 40倍を超える正当な極値）。z-score 系の統計的外れ値検定はこうした正当な極値を
// 大量に誤検知するため採用しない。
//
// 現実に守りたい失敗モードは「単位間違い」による桁ズレ（例: 円と万円の取り違え、健康分を
// 収入欄に入れる）。そこで2段構えにする:
//
//   ERROR … ドメイン上ありえない値（負・非有限、健康分が1日=1440分超、前向き分が
//           起床16h×50%=480分ベースライン超）。確実な破損なので CI を落とす。
//   WARNING … レビュー済み38記事の最大値を OUTLIER_FACTOR 倍超える値。現行コーパスは
//           構成上ここに掛からない（自分の最大値を自分で超えることはない）ので、新規記事が
//           既知レンジを大きく踏み越えたときだけ光る。裾が重いぶん、小さな値への10倍ズレ
//           （例: 6→60）は最大値288の陰に隠れて検知できない。それは calculationLogic 整合
//           チェックと人間レビューで拾う前提。
const OUTLIER_FACTOR = 1.5;

// ドメイン上の絶対上限（ERROR 判定用）。
const MAX_HEALTH_MINUTES_PER_DAY = 1440; // 1日=1440分を超える健康寿命/日はありえない
const MAX_POSITIVE_MOOD_MINUTES = 480; // 起床16h(960分) × 前向き割合50% のベースライン上限

function push(findings: Finding[], f: Finding): void {
  findings.push(f);
}

/** calculationParams のサニティ（ERROR）と分布外れ値（WARNING）。 */
function checkCalculationParams(findings: Finding[]): void {
  const articles = VALID_ARTICLE_IDS.map((id) => ({ id, a: getArticle(id)! }));

  // パラメータごとの現行コーパス最大値（WARNING の基準）。
  const corpusMax: Record<ParamKey, number> = {
    dailyHealthMinutes: 0,
    dailyCostSaving: 0,
    dailyIncomeGain: 0,
    dailyPositiveMoodMinutes: 0,
  };
  for (const { a } of articles) {
    for (const k of PARAM_KEYS) {
      corpusMax[k] = Math.max(corpusMax[k], a.calculationParams[k]);
    }
  }

  for (const { id, a } of articles) {
    for (const k of PARAM_KEYS) {
      const v = a.calculationParams[k];
      if (!Number.isFinite(v)) {
        push(findings, { level: 'error', code: 'param-non-finite', article: id, message: `${k} が数値でない (${v})` });
        continue;
      }
      if (v < 0) {
        push(findings, { level: 'error', code: 'param-negative', article: id, message: `${k} が負値 (${v})。効果値は 0 以上` });
      }
      if (!Number.isInteger(v)) {
        push(findings, { level: 'warning', code: 'param-non-integer', article: id, message: `${k} が整数でない (${v})。効果値は整数を推奨` });
      }
      if (k === 'dailyHealthMinutes' && v > MAX_HEALTH_MINUTES_PER_DAY) {
        push(findings, { level: 'error', code: 'param-impossible', article: id, message: `dailyHealthMinutes=${v} が1日(1440分)を超過。単位ズレの疑い` });
      }
      if (k === 'dailyPositiveMoodMinutes' && v > MAX_POSITIVE_MOOD_MINUTES) {
        push(findings, { level: 'error', code: 'param-impossible', article: id, message: `dailyPositiveMoodMinutes=${v} がベースライン(480分)を超過` });
      }
      const ceiling = corpusMax[k] * OUTLIER_FACTOR;
      if (v > ceiling) {
        push(findings, {
          level: 'warning',
          code: 'param-outlier',
          article: id,
          message: `${k}=${v} がレビュー済みコーパス最大値(${corpusMax[k]})の${OUTLIER_FACTOR}倍(${ceiling})を超過。単位ズレでないか要確認`,
        });
      }
    }
  }
}

/** 記事メタの必須性（habitCategory がキーと一致・出典必須・heroImage 形式）。 */
function checkArticleIntegrity(findings: Finding[]): void {
  for (const id of VALID_ARTICLE_IDS) {
    const a = getArticle(id)!;

    // habitCategory はレジストリのキーと一致していなければならない
    // （LifeImpactArticle.habitCategory を string に緩めたぶん、ここで実行時に固定する）。
    if (a.habitCategory !== id) {
      push(findings, { level: 'error', code: 'category-mismatch', article: id, message: `habitCategory='${a.habitCategory}' がレジストリキー '${id}' と不一致` });
    }

    if (!a.habitName || a.habitName.trim() === '') {
      push(findings, { level: 'error', code: 'missing-name', article: id, message: 'habitName が空' });
    }

    // 出典ゼロはエラー（エビデンスの根幹）。
    const sources = a.article?.sources ?? [];
    if (sources.length === 0) {
      push(findings, { level: 'error', code: 'no-sources', article: id, message: '出典 sources が空。エビデンス記事は最低1件の出典が必須' });
    }
    for (const s of sources) {
      if (!s.text || s.text.trim() === '') {
        push(findings, { level: 'error', code: 'source-empty-text', article: id, message: `出典 id=${s.id} の text が空` });
      }
      if (s.url !== undefined && !isWellFormedHttpUrl(s.url)) {
        push(findings, { level: 'error', code: 'source-bad-url', article: id, message: `出典 id=${s.id} の url が不正: ${s.url}` });
      }
    }

    // heroImage の形式（任意フィールドだが、あるなら整合していること）。
    if (a.heroImage) {
      if (!isWellFormedHttpUrl(a.heroImage.url)) {
        push(findings, { level: 'error', code: 'hero-bad-url', article: id, message: `heroImage.url が不正: ${a.heroImage.url}` });
      }
      if (/[?]/.test(a.heroImage.url)) {
        push(findings, { level: 'warning', code: 'hero-url-has-query', article: id, message: 'heroImage.url にクエリ(?w=..)が含まれる。ベースURLのみを推奨（サイズは呼び出し側で付与）' });
      }
      if (!/^from-\S+\s+to-\S+/.test(a.heroImage.gradient)) {
        push(findings, { level: 'warning', code: 'hero-bad-gradient', article: id, message: `heroImage.gradient が Tailwind 形式(from-.. to-..)でない: ${a.heroImage.gradient}` });
      }
    }

    // confidenceLevel low は人間レビュー必須（パイプラインのゲート）。情報として一覧化する。
    if (a.confidenceLevel === 'low') {
      push(findings, { level: 'warning', code: 'confidence-low', article: id, message: 'confidenceLevel=low。効果値変更時は人間レビュー必須' });
    }
  }
}

/**
 * calculationLogic と calculationParams の数値整合。
 * 既存テスト（calculation-logic.test.ts）は quit_smoking のみを厳密チェックしているので、
 * ここでは calculationLogic を持つ全記事に一般化して補完する（重複ではなく拡張）。
 * 各軸の最終ステップの result に対応する param 値の数字が含まれているかを見る。
 */
function checkCalculationLogicConsistency(findings: Finding[]): void {
  for (const id of VALID_ARTICLE_IDS) {
    const a = getArticle(id)!;
    const logic = a.calculationLogic;
    if (!logic) continue;

    const axes: { name: string; steps: CalcStep[] | undefined; param: number }[] = [
      { name: 'health', steps: logic.health, param: a.calculationParams.dailyHealthMinutes },
      { name: 'cost', steps: logic.cost, param: a.calculationParams.dailyCostSaving },
      { name: 'income', steps: logic.income, param: a.calculationParams.dailyIncomeGain },
      { name: 'positiveMood', steps: logic.positiveMood, param: a.calculationParams.dailyPositiveMoodMinutes },
    ];

    for (const { name, steps, param } of axes) {
      if (!steps || steps.length === 0) continue;
      const last = steps[steps.length - 1];
      const result = last.result ?? '';
      // 最終ステップの result 文字列に param の数値が現れることを期待する。
      // 桁区切り（1,000）表記も許容するため、result 側のカンマを除去して照合する。
      const normalized = result.replace(/,/g, '');
      if (!normalized.includes(String(param))) {
        push(findings, {
          level: 'error',
          code: 'logic-param-mismatch',
          article: id,
          message: `calculationLogic.${name} の最終ステップ result="${result}" に calculationParams の値 ${param} が現れない`,
        });
      }
    }
  }
}

/**
 * 収入軸の換算規約チェック（ERROR）。
 * 規約: 収入の日次値は「年額換算 ÷ 365（暦日）」で算出する（例: 15000000 × 2% ÷ 365）。
 * 営業日日給（62,500円 = 年収1500万 ÷ 240営業日）× x% をそのまま日次値として使うと、
 * 累積表示（×30 / ×365 / ×3650 の暦日積算）で約1.52倍（365/240）の過大計上になる。
 * 2026-07 に全記事監査で23記事がこのパターンだった実例があるため、機械検出で再発を防ぐ。
 * 営業日補正（× 240 ÷ 365）か暦日換算（÷ 365）を含む formula は正しい表記として通す。
 */
function checkIncomeDayBasis(findings: Finding[]): void {
  for (const id of VALID_ARTICLE_IDS) {
    const a = getArticle(id)!;
    const steps = a.calculationLogic?.income;
    if (!steps) continue;
    for (const s of steps) {
      const formula = s.formula ?? '';
      if (/(62,?500|7,?813)(円)?\s*×\s*[\d.]+\s*%/.test(formula) && !/365/.test(formula) && !/240/.test(formula)) {
        push(findings, {
          level: 'error',
          code: 'income-workday-basis',
          article: id,
          message: `income の formula "${formula}" が営業日賃金×%の直接日次計上（暦日積算で約1.52倍過大）。規約: 年収×% ÷ 365（暦日）で換算する`,
        });
      }
    }
  }
}

/**
 * 習慣プリセット間で同一 article_id を複数プリセットが参照している箇所を検出する（WARNING）。
 * 集計の二重計上そのものは #34（PR #66）で解消済み: ホーム集計・診断集計とも impact.ts の
 * de-dup（同一 article_id は最大ウェイトで1回だけ計上）を通るため、重複参照があっても数値は壊れない。
 * したがってこれは計算バグの検出ではなく、プリセット設計上の意図確認のための警告。
 * 「別々のプリセットが同じ根拠で同じ効果を主張している」状態は UX 上ふつう意図的ではないので、
 * 新しいプリセット追加時に気付けるようにしてある。現行プリセットは重複ゼロ。
 * 併せてプリセットの article_id がレジストリに存在するか（ERROR）も見る。
 */
function checkPresetArticleReferences(findings: Finding[]): void {
  const validIds = new Set<string>(VALID_ARTICLE_IDS);
  const usedBy = new Map<string, string[]>();

  for (const preset of HABIT_PRESETS) {
    for (const aid of preset.articleIds) {
      if (!validIds.has(aid)) {
        push(findings, { level: 'error', code: 'preset-unknown-article', message: `プリセット '${preset.id}' が未登録の article_id '${aid}' を参照` });
      }
      if (!usedBy.has(aid)) usedBy.set(aid, []);
      usedBy.get(aid)!.push(preset.id);
    }
  }

  for (const [aid, presets] of usedBy) {
    if (presets.length > 1) {
      push(findings, {
        level: 'warning',
        code: 'preset-duplicate-article',
        message: `article_id '${aid}' が複数プリセットから参照されている: ${presets.join(', ')}（集計は #66 の de-dup で1回だけ計上されるため数値は正しい。プリセット設計として意図的か確認）`,
      });
    }
  }
}

// ── refines（記事間の詳細化関係）の整合チェック（issue #92）──────────────────
//
// checkRefinesIntegrity はレジストリに依存しない純粋関数として公開し、テストから
// フィクスチャで直接検証できるようにしている（現行コーパスは refines なしのため、
// レジストリ経由では error/warning ケースを再現できない）。

/** refines チェックに必要な最小の記事形。LifeImpactArticle を包含する。 */
export type RefinesCheckArticle = Pick<LifeImpactArticle, 'refines' | 'calculationParams'>;

/** health/cost/income のうち非ゼロの軸集合（詳細化の妥当性判定に使う）。 */
function nonZeroAxes(a: RefinesCheckArticle): string[] {
  const axes: { name: string; v: number }[] = [
    { name: 'health', v: a.calculationParams.dailyHealthMinutes },
    { name: 'cost', v: a.calculationParams.dailyCostSaving },
    { name: 'income', v: a.calculationParams.dailyIncomeGain },
  ];
  return axes.filter((x) => x.v !== 0).map((x) => x.name);
}

/**
 * refines の整合チェック:
 *   - 参照先がレジストリ（articles のキー）に存在すること（error: refines-unknown）
 *   - refines チェーンに循環がないこと（error: refines-cycle。自己参照も循環）
 *   - 親子で health/cost/income の非ゼロ軸集合が一致しない場合は warning
 *     （refines-axis-mismatch。詳細化なのに別物を指している疑い）
 */
export function checkRefinesIntegrity(
  articles: Readonly<Record<string, RefinesCheckArticle>>
): Finding[] {
  const findings: Finding[] = [];

  for (const [id, a] of Object.entries(articles)) {
    const parentId = a.refines;
    if (parentId === undefined) continue;

    const parent = articles[parentId];
    if (!parent) {
      push(findings, {
        level: 'error',
        code: 'refines-unknown',
        article: id,
        message: `refines='${parentId}' がレジストリに存在しない`,
      });
      continue;
    }

    // 循環検出: id から refines チェーンを辿り、id 自身に戻ったら循環。
    const visited = new Set<string>([id]);
    let cur: string | undefined = parentId;
    while (cur !== undefined) {
      if (visited.has(cur)) {
        push(findings, {
          level: 'error',
          code: 'refines-cycle',
          article: id,
          message: `refines チェーンに循環がある（${[...visited, cur].join(' → ')}）`,
        });
        break;
      }
      visited.add(cur);
      cur = articles[cur]?.refines;
    }

    // 軸乖離（直接の親子で比較）。
    const childAxes = nonZeroAxes(a);
    const parentAxes = nonZeroAxes(parent);
    const same =
      childAxes.length === parentAxes.length && childAxes.every((x) => parentAxes.includes(x));
    if (!same) {
      push(findings, {
        level: 'warning',
        code: 'refines-axis-mismatch',
        article: id,
        message: `refines 先 '${parentId}' と非ゼロ軸が乖離（子: [${childAxes.join(',')}] / 親: [${parentAxes.join(',')}]）。詳細化なのに別物を指していないか要確認`,
      });
    }
  }

  return findings;
}

/** レジストリ全記事に対して refines 整合チェックを実行する（validateEvidence 用）。 */
function checkRefines(findings: Finding[]): void {
  const articles: Record<string, RefinesCheckArticle> = {};
  for (const id of VALID_ARTICLE_IDS) articles[id] = getArticle(id)!;
  for (const f of checkRefinesIntegrity(articles)) push(findings, f);
}

/** http/https の整った URL かを判定する。 */
export function isWellFormedHttpUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** 全同期チェックを実行し、findings を返す。副作用なし。 */
export function validateEvidence(): Finding[] {
  const findings: Finding[] = [];
  checkCalculationParams(findings);
  checkArticleIntegrity(findings);
  checkCalculationLogicConsistency(findings);
  checkIncomeDayBasis(findings);
  checkPresetArticleReferences(findings);
  checkRefines(findings);
  return findings;
}

/** 記事とその全出典URL（http形式のもの）のペアを列挙する。--online 到達性チェック用。 */
export function collectSourceUrls(): { article: ArticleId; sourceId: number; url: string }[] {
  const out: { article: ArticleId; sourceId: number; url: string }[] = [];
  for (const id of VALID_ARTICLE_IDS) {
    const a: LifeImpactArticle = getArticle(id)!;
    for (const s of a.article?.sources ?? []) {
      if (s.url && isWellFormedHttpUrl(s.url)) out.push({ article: id, sourceId: s.id, url: s.url });
    }
  }
  return out;
}
