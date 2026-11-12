import { ValidationError } from './errors';

export type EventRecord = Record<string, unknown>;

export interface PollState {
  initialized?: boolean;
  /** The filter this state belongs to. A different filter starts again from now. */
  filterKey?: string;
  /** Newest created_at seen, as the API wrote it. Polls look back from here, see LOOKBACK_MS. */
  lastCreatedAt?: string;
  /** Ids of the events already handed on that are still inside the look-back window. */
  seenIds?: string[];
}

export interface ListParams {
  limit: number;
  createdGte?: string;
  startingAfter?: string;
}

export type ListFn = (params: ListParams) => Promise<{ data?: EventRecord[] }>;

export const PAGE = 100;
export const MAX_PAGES = 50;
export const MAX_SEEN = 5000;
export const MIN_INTERVAL_SECONDS = 10;
export const DEFAULT_INTERVAL_SECONDS = 30;
export const MAX_EVENT_TYPES = 20;

/**
 * An event takes its `created_at` (whole seconds) when it is built, not when it becomes visible, and several
 * events can share a second. A cursor on the newest event alone could pass one that appears a moment later.
 * Every poll reads the last two minutes again and hands on only the ids it has not handed on before.
 */
export const LOOKBACK_MS = 120_000;

export const sinceOf = (createdAt: string): string =>
  new Date(Date.parse(createdAt) - LOOKBACK_MS).toISOString().replace(/\.\d{3}Z$/, 'Z');

const timeOf = (event: EventRecord): number => Date.parse(String(event.created_at ?? ''));

export function checkInterval(value: unknown): number {
  const seconds = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < MIN_INTERVAL_SECONDS) {
    throw new ValidationError(
      'Interval',
      `must be a number of seconds, ${MIN_INTERVAL_SECONDS} or more. Polling faster than that gains nothing and uses the request allowance.`,
    );
  }
  return Math.floor(seconds);
}

/** Event types typed as text separated by commas, spaces or lines. Empty means every event. */
export function parseTypes(value: unknown): string[] {
  const text = typeof value === 'string' ? value : '';
  const types = [...new Set(text.split(/[\s,;]+/).filter((t) => t !== ''))];
  if (types.length > MAX_EVENT_TYPES) {
    throw new ValidationError('Event types', `accepts up to ${MAX_EVENT_TYPES} event types`);
  }
  for (const type of types) {
    if (!/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/.test(type)) {
      throw new ValidationError('Event types', `'${type}' is not an event type. Use names such as message.received.`);
    }
  }
  return types;
}

export interface PollResult {
  /** Events to hand on, oldest first. */
  events: EventRecord[];
  /** The state to store once the events were handed on. The input state is never changed. */
  state: PollState;
  /** True when the page cap was hit and older events of the window were left out. */
  truncated: boolean;
}

/** Every event created since `since`, newest first. */
async function readWindow(
  list: ListFn,
  since: string,
): Promise<{ rows: EventRecord[]; truncated: boolean }> {
  const rows: EventRecord[] = [];
  let page = await list({ limit: PAGE, createdGte: since });
  for (let n = 1; ; n++) {
    const batch = page.data ?? [];
    rows.push(...batch);
    const last = batch[batch.length - 1];
    // A full page means there is more (documented rule of the events API).
    if (batch.length < PAGE || !last || typeof last.id !== 'string') return { rows, truncated: false };
    if (n >= MAX_PAGES) return { rows, truncated: true };
    page = await list({ limit: PAGE, createdGte: since, startingAfter: last.id });
  }
}

/**
 * One poll. The first one (or the first after the filter changed) stores the newest event and hands on
 * nothing, so a flow never runs on history. Later polls hand on what was not handed on before.
 * Any failure of `list` rejects and leaves the caller's stored state untouched.
 */
export async function pollOnce(
  list: ListFn,
  previous: PollState | undefined,
  filterKey: string,
  now: Date,
): Promise<PollResult> {
  if (!previous?.initialized || previous.filterKey !== filterKey) {
    const newest = (await list({ limit: 1 })).data?.[0];
    if (typeof newest?.created_at !== 'string') {
      return {
        events: [],
        truncated: false,
        state: { initialized: true, filterKey, lastCreatedAt: now.toISOString(), seenIds: [] },
      };
    }
    const { rows } = await readWindow(list, sinceOf(newest.created_at));
    return {
      events: [],
      truncated: false,
      state: {
        initialized: true,
        filterKey,
        lastCreatedAt: newest.created_at,
        seenIds: rows.map((event) => String(event.id)).slice(0, MAX_SEEN),
      },
    };
  }

  const lastCreatedAt = previous.lastCreatedAt ?? now.toISOString();
  const { rows, truncated } = await readWindow(list, sinceOf(lastCreatedAt));
  const seen = new Set(previous.seenIds);
  const fresh = rows.filter((event) => !seen.has(String(event.id)));

  let newest = { time: Date.parse(lastCreatedAt), text: lastCreatedAt };
  for (const event of rows) {
    const time = timeOf(event);
    if (time > newest.time) newest = { time, text: String(event.created_at) };
  }
  const horizon = newest.time - LOOKBACK_MS;
  return {
    events: fresh.reverse(),
    truncated,
    state: {
      initialized: true,
      filterKey,
      lastCreatedAt: newest.text,
      seenIds: rows
        .filter((event) => timeOf(event) >= horizon)
        .map((event) => String(event.id))
        .slice(0, MAX_SEEN),
    },
  };
}
