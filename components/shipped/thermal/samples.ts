// Made-up receipts for the lab pages (/lab/pile/, /lab/print/) and for the pile before real ones load.
// Every name and item here is fictional and every kicker says SAMPLE, so a screenshot can't pass for a
// real person's receipt. Real receipts come from /api/shipped/receipts/<id> via adapters.ts.
import { prng } from '../physics';
import type { ThermalItem, ThermalReceipt } from './types';

const PEOPLE: [string, string][] = [
  ['ada_ships', 'X / TWITTER'],
  ['Mira Okafor', 'NAME'],
  ['tinyharbor.dev', 'WEBSITE'],
  ['quietcompiler', 'GITHUB'],
  ['Juno Park', 'NAME'],
  ['latenight_ops', 'X / TWITTER'],
  ['paperplane.studio', 'WEBSITE'],
  ['rustbucket-labs', 'GITHUB'],
  ['Theo Lindqvist', 'NAME'],
  ['shipitsunday', 'X / TWITTER'],
  ['fernwood.app', 'WEBSITE'],
  ['oddbyte', 'GITHUB'],
  ['Priya Raman', 'NAME'],
  ['deploy_on_friday', 'X / TWITTER'],
  ['moonlit-cli', 'GITHUB'],
  ['Sam Achebe', 'NAME'],
  ['coldbrew.tools', 'WEBSITE'],
  ['nullpointer_nina', 'X / TWITTER'],
  ['Kai Moreno', 'NAME'],
  ['grainfield', 'GITHUB'],
  ['lowtide.fm', 'WEBSITE'],
  ['weekendrepo', 'X / TWITTER'],
  ['Elif Demir', 'NAME'],
  ['tabsnotspaces', 'GITHUB'],
];

const ITEMS: ThermalItem[] = [
  { name: 'INVOICE GREMLIN', status: 'LIVE', date: 'FEB 2026', description: 'Chases unpaid invoices so you never have to.' },
  { name: 'TIDE TABLES', status: 'SHIPPED', date: 'MAR 3', description: 'iOS widget for surf and tide times.' },
  { name: 'SQLITE-SYNC', status: 'RELEASED', date: 'JAN 19', description: 'Two-way sync for local-first apps. 1.2k stars.' },
  { name: 'DESK RADIO', status: 'LIVE', date: 'APR 2026', description: 'Lo-fi stream for focus, 24/7.' },
  { name: 'PIXEL GARDEN', status: 'BETA', date: 'MAY 2', description: 'A tiny farming game in the browser.' },
  { name: 'RECEIPT OCR', status: 'LAUNCHED', date: 'JUN 11', description: 'Turns paper receipts into expense lines.' },
  { name: 'GREENLIGHT', status: 'ACTIVE', date: 'JUL 2026', description: 'Feature flags with no SDK.' },
  { name: 'SHOW HN: HALFTONE', status: 'SHIPPED', date: 'AUG 8', description: 'Halftone any photo in one tap. 412 points.' },
  { name: 'CRON BUDDY', status: 'LIVE', date: 'SEP 2026', description: 'Tells you when a cron job silently stops.' },
  { name: 'TYPEFACE NO. 2', status: 'RELEASED', date: 'FEB 14', description: 'An open-source monospace with ligatures.' },
  { name: 'MEAL PREP API', status: 'PROTOTYPE', date: null, description: 'Grocery lists from a week of recipes.' },
  { name: 'NIGHT BUS', status: 'IN PROGRESS', date: 'OCT 2026', description: 'Live transit map for the late routes.' },
  { name: 'ZINE PRINTER', status: 'SHIPPED', date: 'MAR 30', description: 'Imposes PDFs for folded 8-page zines.' },
  { name: 'CLI: SNAP', status: 'RELEASED', date: 'APR 22', description: 'Screenshots of any URL from the terminal.' },
  { name: 'PLANT WATERING BOT', status: 'HIATUS', date: null, description: 'Texts you when the soil is dry.' },
  { name: 'NEWSLETTER: SMALL WINS', status: 'ACTIVE', date: 'JAN 2026', description: 'Weekly notes on shipping side projects.' },
  { name: 'FOCUS TIMER', status: 'DECEASED', date: 'MAY 2026', description: 'Pomodoro for the menu bar. RIP.' },
  { name: 'MAPLE UI', status: 'LIVE', date: 'JUN 2026', description: 'Copy-paste components, zero dependencies.' },
  { name: 'PODCAST: COMMIT LOG', status: 'LIVE', date: 'JUL 2026', description: 'Founders read their worst commit messages.' },
  { name: 'GPU PRICE WATCH', status: 'SHIPPED', date: 'AUG 2026', description: 'Alerts when cloud GPUs get cheap.' },
];

const NOTES = [
  'Shipped more than most. Proof over hype.',
  'Small things, actually finished. Respect.',
  'A quiet year on paper, a loud one in the repo.',
  'Every one of these has a real user. Keep going.',
  'The register likes this one.',
  'Ship count verified by the night shift.',
];

const SPONSOR_LINES = ['POCKET FACTORY', 'MOPKIN', 'HABITUIZE', 'ENTRELABZ'];

/** A deterministic fictional receipt; `n` picks the person and the items. */
export function sampleReceipt(n: number, year = 2026): ThermalReceipt {
  const random = prng(`sample:${n}`);
  const [who, kind] = PEOPLE[n % PEOPLE.length];
  const count = 1 + Math.floor(random() * 5);
  const picked: ThermalItem[] = [];
  const pool = [...ITEMS];
  for (let i = 0; i < count; i++) picked.push(pool.splice(Math.floor(random() * pool.length), 1)[0]);
  const number = String(4100 + n * 37).padStart(6, '0');
  const handle = kind === 'X / TWITTER' || kind === 'GITHUB';
  return {
    id: `sample-${n}`,
    year,
    who: handle ? `@${who}` : who,
    kicker: `SAMPLE · ${kind}`,
    date: `${String(1 + Math.floor(random() * 28)).padStart(2, '0')} OCT ${year}`,
    number,
    items: picked,
    count: picked.length,
    note: NOTES[Math.floor(random() * NOTES.length)],
    presented: null,
    paidBy: [SPONSOR_LINES[0], SPONSOR_LINES[1 + Math.floor(random() * 3)]],
    barcode: `BZ${number}`,
  };
}

export function sampleReceipts(count: number, year = 2026): ThermalReceipt[] {
  return Array.from({ length: count }, (_, i) => sampleReceipt(i, year));
}
