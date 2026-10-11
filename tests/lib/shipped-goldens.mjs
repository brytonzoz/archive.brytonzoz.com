import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const tapes = JSON.parse(readFileSync(join(here, '../fixtures/shipped-golden/tapes.json'), 'utf8'));
export const junk = JSON.parse(readFileSync(join(here, '../fixtures/shipped-junk.json'), 'utf8'));

export const LIVE_RECEIPT_SPECS = {
  6: 'levelsio',
  7: 'rauch',
  13: 'sam',
  16: 'tibo',
  17: 'truell',
  18: 'jack',
  19: 'colin',
  20: 'theo',
};

export const LIVE_RECEIPT_IDS = [6, 7, 13, 16, 17, 18, 19, 20, 21, 22];

/** Floors are the fixture mins. Do not lower them for live reprints. */
export const LIVE_SPEC_OVERRIDE = {};

const THIN_NOTE = /\bpublic tape\b|\blead ship\b/i;

export function loose(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** Company-scoped drop rows (Stripe on Vercel) are not junk on every tape. */
export function junkKeys(ctx = {}) {
  return new Set(
    junk.drop
      .filter((row) => {
        if (row.company) return ctx.company && loose(row.company) === loose(ctx.company);
        return true;
      })
      .map((row) => loose(row.name))
      .filter((key) => key.length >= 6),
  );
}

export function hasRequired(names, needle) {
  const want = loose(needle);
  return names.some((name) => {
    const got = loose(name);
    return got === want || got.includes(want) || want.includes(got);
  });
}

export function realItems(items) {
  return (Array.isArray(items) ? items : []).filter(
    (item) => item && item.name && item.name !== 'YOUR POTENTIAL' && item.source !== 'none',
  );
}

/** Same assertions the cached goldens use, against printed items + note. */
export function evaluateGolden(spec, items, note, opts = {}) {
  const names = items.map((item) => item.name);
  const junkHit =
    opts.junkHit ||
    junkKeys({
      who: spec?.who || opts.who,
      company: spec?.profile?.affiliation?.company || opts.company,
    });
  const endsWithCutOffWord = opts.endsWithCutOffWord;
  const isBareProductNote = opts.isBareProductNote;
  const isEmptyTapeNote = opts.isEmptyTapeNote;
  const failures = [];
  const leaked = names.filter((name) => junkHit.has(loose(name)));
  const missing = [];
  for (const needle of spec.required || []) {
    if (!hasRequired(names, needle)) missing.push(needle);
  }
  const anyMissing = (spec.requiredAny || []).filter((row) => !names.some((name) => new RegExp(row.re, 'i').test(name)));
  const yearOk = !spec.requireYear || items.some((item) => String(item.date || '').startsWith(String(spec.requireYear)));
  if (items.length < (spec.min || 0)) failures.push(`count ${items.length} < ${spec.min}`);
  if (missing.length) failures.push(`missing ${missing.join(', ')}`);
  if (anyMissing.length) failures.push(`missing any ${anyMissing.map((row) => row.key).join(', ')}`);
  if (leaked.length) failures.push(`junk leaked ${JSON.stringify(leaked)}`);
  if (!yearOk) failures.push(`no ${spec.requireYear} product`);
  const chopped = typeof endsWithCutOffWord === 'function' ? names.filter((name) => endsWithCutOffWord(name)) : [];
  if (chopped.length) failures.push(`cut-off titles ${JSON.stringify(chopped)}`);
  for (const needle of spec.forbidden || []) {
    if (names.some((name) => loose(name) === loose(needle))) failures.push(`forbidden ${needle}`);
  }
  for (const row of spec.forbiddenRe || []) {
    if (names.some((name) => new RegExp(row.re, 'i').test(name))) failures.push(`forbidden re ${row.key}`);
  }
  if (items.length) {
    const emptyTape =
      typeof isEmptyTapeNote === 'function'
        ? isEmptyTapeNote(note || '')
        : /nothing public in 20\d{2} turned up|item on back order|empty drawer\.\s*go ship/i.test(note || '');
    if (emptyTape) failures.push(`empty-tape note on non-empty receipt ${JSON.stringify(note)}`);
    if (typeof isBareProductNote === 'function' && isBareProductNote(note || '', items)) {
      failures.push(`bare-name fallback ${JSON.stringify(note)}`);
    }
  }
  if (note && THIN_NOTE.test(note)) failures.push(`thin note ${JSON.stringify(note)}`);
  return { ok: failures.length === 0, failures, count: items.length, names, note: note || '' };
}

export function evaluateLiveReceipt(id, receipt, helpers) {
  const items = realItems(receipt?.items);
  const note = String(receipt?.note || '');
  const specId = LIVE_RECEIPT_SPECS[id];
  const spec = specId ? { ...tapes[specId], ...(LIVE_SPEC_OVERRIDE[specId] || {}) } : { min: 1, required: [], forbidden: [] };
  const result = evaluateGolden(spec || { min: 1 }, items, note, {
    ...helpers,
    junkHit: junkKeys({
      who: spec.who,
      company: spec.profile?.affiliation?.company,
    }),
  });
  const wordy = result.names.filter((name) => {
    const text = String(name || '');
    const words = text.trim().split(/\s+/).filter(Boolean);
    return words.length >= 8 && !/\d+\.\d+/.test(text) && !/·\s*\d+\s+(updates?|releases?)/i.test(text);
  });
  if (wordy.length) result.failures.push(`8+ word titles ${JSON.stringify(wordy)}`);
  return { ...result, ok: result.failures.length === 0 };
}
