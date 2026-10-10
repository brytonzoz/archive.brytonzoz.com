// Forward-compatible print response: today's POST is `{ id, pile }`. Streaming (research agent) may
// send a provisional receipt first, then more items — as one JSON object, NDJSON, or SSE.
import { RECEIPT_PATH, type SponsorBlock, type YearReceipt } from '../../lib/shipped-year';

export type StreamedLoad = { receipt: YearReceipt; sponsors: SponsorBlock };

export type PrintChunk = {
  id?: number;
  pile?: string;
  error?: string;
  cached?: boolean;
  /** Pipeline: first lines are on the tape, more items still appending. */
  growing?: boolean;
  provisional?: boolean;
  pending?: boolean;
  done?: boolean;
  complete?: boolean;
  receipt?: YearReceipt;
  sponsors?: SponsorBlock;
  items?: YearReceipt['items'];
};

export function isReceiptOpen(value: PrintChunk | StreamedLoad | YearReceipt | null | undefined): boolean {
  if (!value) return false;
  const receipt = 'receipt' in value ? value.receipt : 'items' in value && 'subject' in value ? (value as YearReceipt) : undefined;
  const flags = value as PrintChunk;
  if (flags.done === true || flags.complete === true) return false;
  if (flags.growing === true || flags.provisional === true || flags.pending === true) return true;
  return Boolean(receipt?.growing || receipt?.provisional || receipt?.pending || receipt?.upgrading);
}

export function applyPrintChunk(prev: StreamedLoad | null, chunk: PrintChunk): StreamedLoad | null {
  const receipt = chunk.receipt ?? prev?.receipt;
  if (!receipt) return prev;
  const closed = chunk.done === true || chunk.complete === true;
  return {
    receipt: {
      ...receipt,
      items: chunk.items ?? receipt.items,
      growing: closed ? false : Boolean(chunk.growing ?? receipt.growing),
      provisional: closed ? false : Boolean(chunk.provisional ?? receipt.provisional),
      pending: closed ? false : Boolean(chunk.pending ?? receipt.pending),
      upgrading: closed ? false : Boolean(receipt.upgrading),
    },
    sponsors: chunk.sponsors ?? prev?.sponsors ?? { slots: [], frozen: false },
  };
}

export function parsePrintLine(line: string): PrintChunk | null {
  const text = line.replace(/^data:\s*/, '').trim();
  if (!text || text === '[DONE]') return null;
  try {
    const value = JSON.parse(text) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as PrintChunk) : null;
  } catch {
    return null;
  }
}

async function readLines(response: Response, onChunk: (chunk: PrintChunk) => void): Promise<PrintChunk> {
  const reader = response.body?.getReader();
  if (!reader) return {};
  const decoder = new TextDecoder();
  let buf = '';
  let last: PrintChunk = {};
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split(/\r?\n/);
    buf = parts.pop() ?? '';
    for (const part of parts) {
      const parsed = parsePrintLine(part);
      if (parsed) {
        last = parsed;
        onChunk(parsed);
      }
    }
  }
  const tail = parsePrintLine(buf);
  if (tail) {
    last = tail;
    onChunk(tail);
  }
  return last;
}

/** Consume POST /api/shipped/print: one JSON object, or a stream of them. */
export async function readPrintResponse(response: Response, onChunk: (chunk: PrintChunk) => void): Promise<PrintChunk> {
  const type = (response.headers.get('content-type') ?? '').toLowerCase();
  if (type.includes('ndjson') || type.includes('jsonl') || type.includes('event-stream')) {
    return readLines(response, onChunk);
  }
  const text = await response.text();
  const trimmed = text.trim();
  if (!trimmed) return {};
  const streaming = /\n\s*(\{|\s*data:)/.test(trimmed);
  if (streaming) {
    let last: PrintChunk = {};
    for (const line of trimmed.split(/\r?\n/)) {
      const parsed = parsePrintLine(line);
      if (parsed) {
        last = parsed;
        onChunk(parsed);
      }
    }
    return last;
  }
  const chunk = parsePrintLine(trimmed) ?? (JSON.parse(trimmed) as PrintChunk);
  onChunk(chunk);
  return chunk;
}

export async function fetchReceipt(id: number): Promise<StreamedLoad | null> {
  const response = await fetch(`/api/shipped/receipts/${id}`, { cache: 'no-store' }).catch(() => null);
  if (!response?.ok) return null;
  const data = (await response.json().catch(() => null)) as StreamedLoad | null;
  return data && data.receipt ? data : null;
}

/** Keep pulling a receipt while the pipeline marks it provisional / pending / upgrading. */
/** Desktop: new tab so the torn tape stays. Phone: stand on /r/<id>/ first so Back lands there. */
export function openCheckout(url: string, receiptId: number) {
  const desktop = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  if (desktop) {
    const tab = window.open(url, '_blank', 'noopener,noreferrer');
    if (tab) return;
  }
  const path = RECEIPT_PATH(receiptId);
  if (window.location.pathname !== path && window.location.pathname !== `/shipped${path}`) {
    history.pushState({ shipped: 'receipt' }, '', path);
  }
  window.location.assign(url);
}

const TORN_KEY = 'shipped:torn';

export function rememberTorn(id: number) {
  try {
    sessionStorage.setItem(TORN_KEY, JSON.stringify({ id, at: Date.now() }));
  } catch {
    // Private mode: Back from checkout just reloads the house slip.
  }
}

export function forgetTorn() {
  try {
    sessionStorage.removeItem(TORN_KEY);
  } catch {
    // ignore
  }
}

export function readTorn(): number | null {
  try {
    const data = JSON.parse(sessionStorage.getItem(TORN_KEY) ?? 'null') as { id?: number; at?: number } | null;
    if (!data?.id || !data.at || Date.now() - data.at > 2 * 60 * 60 * 1000) return null;
    return data.id;
  } catch {
    return null;
  }
}

export async function followReceipt(id: number, onUpdate: (loaded: StreamedLoad) => void, signal: { cancelled: boolean }, ms = 45_000): Promise<void> {
  const started = Date.now();
  let lastCount = -1;
  while (!signal.cancelled && Date.now() - started < ms) {
    const loaded = await fetchReceipt(id);
    if (signal.cancelled) return;
    if (loaded) {
      onUpdate(loaded);
      const count = loaded.receipt.items.length;
      if (!isReceiptOpen(loaded) && count === lastCount) return;
      lastCount = count;
      if (!isReceiptOpen(loaded)) return;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 900));
  }
}
