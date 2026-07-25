/**
 * 初回チュートリアル（コーチマーク）の純ロジック。
 *
 * オンボーディング完了直後に一度だけ、実 UI の上にスポットライトを重ねて
 * 「タップで達成 → 再タップで取り消し → 長押し → 発見タブ → 追加/自作」の
 * 操作を実際に触りながら案内する。
 *
 * 表示制御は DB（user_profiles.tutorial_completed_at）を正とする（issue #117）。
 * localStorage はネットワーク往復を省くための高速パスキャッシュにすぎない:
 *   - 'done'          : DB 同期済みで完了確定。以後 DB 参照すら不要（高速パス）。
 *   - 'done-unsynced' : この端末では完了したが DB への書き込みが未確認/失敗。
 *                       次回の DB 参照時に再送を試みる。
 *   - 'pending'       : オンボ完了直後、まだ完走もスキップもしていない。
 *   - null            : 上記いずれでもない（このアプリで一度もオンボ完了していない等）。
 *
 * 起動可否そのものの決定は resolveAutoStart()（純関数・DOM 非依存）が担い、
 * localStorage の読み書き・DB 呼び出しは components/tutorial/tutorial-overlay.tsx が行う。
 */

export const TUTORIAL_STORAGE_KEY = 'smitch-tutorial';

export type TutorialEventType =
  | 'habit-completed'
  | 'habit-uncompleted'
  | 'action-sheet-open'
  | 'action-sheet-closed';

/** アプリ側からチュートリアルへ操作の発生を通知する。非アクティブ時は誰も聞いていないだけ（no-op）。 */
export function emitTutorialEvent(type: TutorialEventType) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('smitch-tutorial-event', { detail: { type } }));
}

export const TUTORIAL_EVENT_NAME = 'smitch-tutorial-event';

export type TutorialAdvance =
  | { type: 'next' } // ツールチップの「次へ」ボタンで進む
  | { type: 'event'; event: TutorialEventType } // 実操作の発生で進む
  | { type: 'route'; route: string }; // 画面遷移で進む

export interface TutorialStep {
  id: 'welcome' | 'complete' | 'undo' | 'longpress' | 'discover' | 'articles' | 'create';
  /** スポットライト対象。省略時は中央カード（welcome） */
  selector?: string;
  /** スポットライトを円形にする（達成ボタン用） */
  circle?: boolean;
  /** 穴の内側のタップを実 UI に通す（実操作で進むステップ） */
  interactive: boolean;
  advance: TutorialAdvance;
  /** anchor が見つからないとき、このステップ id まで飛ばす（習慣 0 件など） */
  skipToOnMissing?: TutorialStep['id'];
}

export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: 'welcome',
    interactive: false,
    advance: { type: 'next' },
  },
  {
    id: 'complete',
    selector: '[data-tutorial="habit-status"]',
    circle: true,
    interactive: true,
    advance: { type: 'event', event: 'habit-completed' },
    skipToOnMissing: 'discover',
  },
  {
    id: 'undo',
    selector: '[data-tutorial="habit-status"]',
    circle: true,
    interactive: true,
    advance: { type: 'event', event: 'habit-uncompleted' },
    skipToOnMissing: 'discover',
  },
  {
    id: 'longpress',
    selector: '[data-tutorial="habit-status"]',
    circle: true,
    interactive: true,
    // シートが開いたらオーバーレイを隠し、閉じたら次のステップへ（overlay 側で二段処理）
    advance: { type: 'event', event: 'action-sheet-open' },
    skipToOnMissing: 'discover',
  },
  {
    id: 'discover',
    selector: '[data-tutorial="nav-discover"]',
    interactive: true,
    advance: { type: 'route', route: '/discover' },
  },
  {
    id: 'articles',
    selector: '[data-tutorial="discover-articles"] > button:first-of-type',
    interactive: false,
    advance: { type: 'next' },
  },
  {
    id: 'create',
    selector: '[data-tutorial="discover-create"]',
    interactive: false,
    advance: { type: 'next' },
  },
];

export function stepIndexById(id: TutorialStep['id']): number {
  return TUTORIAL_STEPS.findIndex((s) => s.id === id);
}

/** welcome を除いた進捗表示用の位置（1 始まり）。welcome では 0 を返す。 */
export function progressOf(stepIndex: number): { current: number; total: number } {
  return { current: stepIndex, total: TUTORIAL_STEPS.length - 1 };
}

// --- localStorage（SSR 安全・Safari プライベートモード安全） ---------------

function readStorage(): string | null {
  try {
    return window.localStorage.getItem(TUTORIAL_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStorage(value: string) {
  try {
    window.localStorage.setItem(TUTORIAL_STORAGE_KEY, value);
  } catch {
    // 保存できない環境ではチュートリアルが再表示されうるだけで実害はない
  }
}

export type LocalTutorialState = 'pending' | 'done' | 'done-unsynced' | null;

/** オンボーディング完了時に呼ぶ。次にホームを開いたとき DB 判定でチュートリアルが始まりうる状態にする。 */
export function markTutorialPending() {
  if (typeof window === 'undefined') return;
  writeStorage('pending');
}

/** localStorage キャッシュの現在状態を読む（SSR/読み出し失敗時は null）。 */
export function readLocalTutorialState(): LocalTutorialState {
  if (typeof window === 'undefined') return null;
  const raw = readStorage();
  if (raw === 'pending' || raw === 'done' || raw === 'done-unsynced') return raw;
  return null;
}

/**
 * DB 参照すら不要な高速パスか（= この端末で完了が確定済み）。
 * true の間は resolveAutoStart / DB フェッチを呼ぶ必要がない。
 */
export function isLocalTutorialDoneFastPath(): boolean {
  return readLocalTutorialState() === 'done';
}

/**
 * 完走・スキップ時に呼ぶ。以後は自動表示しない。
 * @param dbSynced DB への tutorial_completed_at 書き込みが成功したか。
 *   失敗時は 'done-unsynced' にして次回 DB 参照時の再送対象にする（次回リトライ）。
 */
export function markTutorialDone(dbSynced: boolean) {
  if (typeof window === 'undefined') return;
  writeStorage(dbSynced ? 'done' : 'done-unsynced');
}

/** DB 同期の再送に成功したときに呼ぶ。ローカルキャッシュを確定 done へ昇格する。 */
export function markLocalTutorialSynced() {
  if (typeof window === 'undefined') return;
  writeStorage('done');
}

// --- 起動判定（DB を正、localStorage を高速パスキャッシュとして使う。issue #117） ---

export interface TutorialAutoStartDecision {
  /** チュートリアルを起動するか */
  start: boolean;
  /** DB へ tutorial_completed_at の書き込み（前回失敗分の再送）を試みるべきか */
  shouldSyncDb: boolean;
  /** ローカルキャッシュを 'done' に更新すべきか（DB 完了済みが判明し高速パス化できる場合） */
  cacheAsDone: boolean;
}

/**
 * `?tutorial=1` 以外のケースで、ローカルキャッシュと DB 取得結果から起動可否を決める純関数。
 * DOM/ネットワークに触れないため vitest（node環境）でそのまま検証できる。
 *
 * 呼び出し側の前提: `localState === 'done'` のときはこの関数を呼ぶ前に
 * isLocalTutorialDoneFastPath() で判定を終え、DB フェッチ自体を省略していること。
 */
export function resolveAutoStart(params: {
  localState: LocalTutorialState;
  /** DB 参照に失敗した場合は 'error'。成功時は tutorial_completed_at の値（NULL=未完了）。 */
  dbLookup: { tutorialCompletedAt: string | null } | 'error';
}): TutorialAutoStartDecision {
  const { localState, dbLookup } = params;

  if (dbLookup === 'error') {
    // DB 未参照時は従来どおりローカルの pending 判定にのみフォールバックする。
    // done-unsynced はこの端末では完了済みなので、DB 到達不能でも再起動しない。
    return { start: localState === 'pending', shouldSyncDb: false, cacheAsDone: false };
  }

  if (dbLookup.tutorialCompletedAt !== null) {
    // DB 上は完了済み（他端末で完走 or 既存ユーザーのバックフィル）。
    return { start: false, shouldSyncDb: false, cacheAsDone: localState !== 'done' };
  }

  // DB 上は未完了。
  if (localState === 'done-unsynced') {
    // この端末では既に完了しているが前回の DB 書き込みが未確認 → 再送を試み、
    // 起動はしない（この端末のユーザーは既にチュートリアルを見ている）。
    return { start: false, shouldSyncDb: true, cacheAsDone: false };
  }
  return { start: true, shouldSyncDb: false, cacheAsDone: false };
}
