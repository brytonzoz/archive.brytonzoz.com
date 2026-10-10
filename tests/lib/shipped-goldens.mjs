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

const THIN_NOTE =
  /\bshowed up\b|\bis the one that stuck\b|\bkeeps coming back\b|\breceipts?, and\b/i;

export function loose(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

export function junkKeys() {
  return new Set(junk.drop.map((row) => loose(row.name)).filter((key) => key.length >= 6));
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
  const junkHit = opts.junkHit || junkKeys();
  const endsWithCutOffWord = opts.endsWithCutOffWord;
  const isBareProductNote = opts.isBareProductNote;
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
  if (items.length && typeof isBareProductNote === 'function' && isBareProductNote(note || '', items)) {
    failures.push(`bare-name fallback ${JSON.stringify(note)}`);
  }
  if (note && THIN_NOTE.test(note)) failures.push(`thin note ${JSON.stringify(note)}`);
  return { ok: failures.length === 0, failures, count: items.length, names, note: note || '' };
}

export function evaluateLiveReceipt(id, receipt, helpers) {
  const items = realItems(receipt?.items);
  const note = String(receipt?.note || '');
  const specId = LIVE_RECEIPT_SPECS[id];
  const spec = specId ? tapes[specId] : { min: 1, required: [], forbidden: [] };
  return evaluateGolden(spec || { min: 1 }, items, note, helpers);
}
