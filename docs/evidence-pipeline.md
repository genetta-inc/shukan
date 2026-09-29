# エビデンスパイプライン

Shukan（Smitch）の「効果値エビデンス」がどこにあり、どう追加・更新・検証されるかの全体像。

## 1. データはどこにあるか

エビデンスの**唯一の真実源はコード内の記事データ**であり、DB ではない。

| 種類 | 場所 | 内容 |
|---|---|---|
| 記事データ（真実源） | `src/data/impact-articles/<slug>.ts` | 1記事1ファイル。研究本文・出典・推論段落・効果値（`calculationParams`）・算出根拠（`calculationLogic`）・ヒーロー画像（`heroImage`） |
| レジストリ | `src/data/impact-articles/index.ts` | 全記事を1つの `satisfies Record<string, LifeImpactArticle>` マップに集約。`ArticleId` 型・`VALID_ARTICLE_IDS`・`isValidArticleId` はここから導出される |
| 型 | `src/types/impact.ts` | `LifeImpactArticle` / `HeroImage` / `CalcStep` 等。`ArticleId` はレジストリから re-export |
| 画像アクセサ | `src/data/evidence-hero-images.ts` | 記事の `heroImage` から用途別サイズURL・フォールバックグラデーションを導出する薄い層（画像データ自体は持たない） |
| 習慣プリセット | `src/data/habit-presets.ts` | 「なりたい自分」から降ろす習慣テンプレ。各プリセットが `article_id` を参照する |
| 紐付け（DB） | `habit_evidences` テーブル | `habit_id × article_id(TEXT) × weight`。**紐付けのみ**で、効果値は持たない |

効果式（`src/lib/impact.ts::calculateDailyImpact`）は、ユーザーの習慣に紐づく記事の `calculationParams` を weight で加重合計する。達成率と horizon の乗算は `src/lib/diagnosis-v3.ts` が行う。

## 2. 追加のしかた（新しい習慣のエビデンス）

新記事の追加は **記事TS1ファイル + `index.ts` に1行** で完結する。以前は7〜9箇所（型 union、VALID_ARTICLE_IDS、2つの HERO_IMAGES マップ、2つの gradient マップ、プリセット…）の手編集が必要だったが、単一ソース化により解消した。

### 自律ワークフロー（推奨）

`.claude/skills/evidence-pipeline/` スキルが以下を一気通貫で行う（習慣名を渡すだけ）:

1. **雛形生成**: `npm run scaffold:article -- <article_id> "<習慣名>"`
   → `src/data/impact-articles/<slug>.ts` を TODO 付きで作成し、`index.ts` に import + マップ行を配線
2. **リサーチ〜執筆**: `life-impact-article` スキルの Step 2〜6（グローバルなエビデンス収集 → 効果値算出 → 2層記事執筆 → `calculationLogic` 記述）で TODO を埋める
3. **ヒーロー画像**: Unsplash 画像を選び、記事の `heroImage.url`（サイズクエリなしのベースURL）と `gradient` を設定
4. **検証**: `npm run validate:evidence` と `npm test` が green
5. **PR**: feature branch を切って push、PR 作成

### 手動での最小手順

```bash
npm run scaffold:article -- drink_green_tea "緑茶を飲む"
# 生成された src/data/impact-articles/drink-green-tea.ts の TODO を埋める
npm run validate:evidence
npm test
```

## 2.5 記事間の関係モデル（refines）と同系統の重複排除

記事の詳細化（例: `daily_cardio` に対する `hiit`）は**別 articleId** になるため、#34 の
articleId 単位 de-dup では二重計上を防げない。そこで記事間の親子関係を `refines` で表現する。

- `LifeImpactArticle.refines?: string` — 詳細化元（親）の記事ID。**単一親のみ**（多重親は v1 では持たない）
- 現行39記事は `refines` なし（フラット）。関係付けは新規追加時に判定する

### 効果計算のルール（`src/lib/impact.ts::dedupeByLineage`）

1. まず #34 の articleId 単位 de-dup（同一記事は最大ウェイトで1回だけ）を適用する
2. 次に系統 de-dup: エビデンス集合内に `refines` チェーンで結ばれた**祖先–子孫が両方あれば、
   詳細側（子孫）だけを計上**し、粗い側（祖先）を落とす。詳細記事のほうがユーザーの実態に
   近い効果値を持つため。チェーンは推移的に辿る（孫・子・親が全部あれば孫のみ）
3. **兄弟は両方計上する**（例: `hiit` と `jogging` が共に `daily_cardio` を refines する場合）。
   別の実活動であり、v1 では正当な加算とみなす。過剰計上が観測されたら見直す

習慣横断の集計（`calculateDedupedDailyImpact`）はこの2段 de-dup を通る。

### 検証（`validate:evidence` に組込済み）

| チェック | レベル | 内容 |
|---|---|---|
| `refines` 参照先の存在 | error | 参照先がレジストリに無い記事を弾く |
| `refines` の循環 | error | チェーンの循環（自己参照含む）を弾く |
| 親子の軸乖離 | warning | 親子で health/cost/income の非ゼロ軸集合が一致しない場合（詳細化なのに別物を指している疑い） |

## 3. 更新のしかた（新しいメタ分析が出たとき）

既存記事の効果値を更新する場合:

1. 対象記事の `calculationParams` と、根拠となる `calculationLogic`・`inferences`・`sources` を新しい研究に合わせて更新する
2. `cumulative` 段落の 1ヶ月/1年/10年の数値が `calculationParams × 日数` と整合するよう直す
3. `calculationLogic` の最終ステップ `result` に新しい `calculationParams` の数値（カンマ無し）を反映する
4. `confidenceLevel` を見直す（根拠が弱まった/強まった場合）
5. `npm run validate:evidence` と `npm test`
6. **人間レビューゲート（後述）に該当する変更は自動マージ不可**

## 4. 検証のしかた

`npm run validate:evidence`（CI にも組込済み）が記事データの整合性を機械チェックする。

| チェック | レベル | 内容 |
|---|---|---|
| 出典必須 | error | `sources` が空の記事を弾く。URL は形式チェック |
| 効果値サニティ | error | 負値・非有限・健康>1440分/日・前向き>480分を弾く |
| 効果値の外れ値 | warning | レビュー済みコーパス最大値の1.5倍超を「単位ズレの疑い」として警告 |
| `calculationLogic` 整合 | error | 各軸の最終ステップ `result` に `calculationParams` の数値が現れるか |
| `habitCategory` 一致 | error | `habitCategory` がレジストリのキーと一致するか |
| プリセット参照 | error/warning | 未登録 `article_id` 参照は error、複数プリセットからの重複参照は warning（#34 の布石） |
| `confidenceLevel: low` | warning | 人間レビュー必須の記事として一覧化 |

- `npm run validate:evidence -- --online` で出典URLの到達性（HEAD）も確認できる（ネットワーク依存のため CI では回さない）。
- 同じロジックは `src/__tests__/evidence-validation.test.ts` からも呼ばれ、通常の `npm test` / CI でもゲートされる。
- 検証ロジック本体は `src/lib/evidence/validate.ts`（CLI とテストで共有）。

## 5. 人間レビューゲート

以下の変更は**自動マージ不可**。必ず人間がレビューする:

- **医療・健康に関する主張**（`dailyHealthMinutes` や健康効果の記述）の変更 — 誤った健康主張はユーザーへの実害になり得る
- **金銭に関する主張**（`dailyCostSaving` / `dailyIncomeGain`）の変更 — 過大な金銭効果は誇大広告リスク
- `confidenceLevel: low` の記事の追加・変更 — 根拠が弱い記事は必ずレビュー
- `validate:evidence` が warning を出した効果値（外れ値・単位ズレの疑い）

これらは PR 説明に明記し、レビュアーが根拠（出典）まで確認できるようにする。

## 6. なぜ DB 化を見送ったか

エビデンスを DB（例: `impact_articles` テーブル）に載せる案は**現時点では見送る**。理由:

- **真実源がコードにある利点が大きい**: 型安全（`ArticleId`）、ビルド時バンドル（実行時フェッチ不要・オフライン可）、PR レビューで効果値の変更履歴と根拠が git に残る、`validate:evidence` で CI ゲートできる
- **記事は静的で更新頻度が低い**: 効果値はメタ分析が出たときにたまに更新する程度で、ユーザー生成データではない。DB のメリット（動的更新・多書き込み）が効きにくい
- **DB 化はマイグレーション・RLS・同期の複雑性を持ち込む**: 現状の紐付け専用 `habit_evidences`（`article_id` は TEXT 参照）で十分機能している

### 再検討する条件（post-launch）

以下のいずれかが現実になったら DB 化を再検討する:

- **非エンジニアが記事を編集する運用**が必要になったとき（CMS 的な編集UIが要る）
- **記事数が数百規模**に増え、ビルド時バンドルがバンドルサイズ/ビルド時間に効いてくるとき
- **A/B テストやユーザーセグメント別の効果値**など、実行時に効果値を出し分ける要件が出たとき
- **効果値の更新をデプロイなしで**反映したい運用要件が出たとき

その際も「コードが真実源、DB はキャッシュ/配信層」という向きを保ち、`validate:evidence` 相当の品質ゲートを DB 投入前に通す設計にする。

## 関連

- スキル: `.claude/skills/evidence-pipeline/SKILL.md`（追加・更新の自律ワークフロー）
- スキル: `.claude/skills/life-impact-article/SKILL.md`（リサーチ→効果値→記事執筆の詳細手順）
- 検証: `src/lib/evidence/validate.ts` / `scripts/validate-evidence.ts`
- 雛形: `scripts/scaffold-evidence-article.ts`
