/** GitHub repos that are reproductions, benches, demos, forks-in-name, or a profile. */

const REPO_NAME = /^[A-Za-z0-9._-]{1,100}$/;
const SKIP_REPOS =
  /^(my-app|throwaway(-\d+)?|tmp|playground|sandbox|awesome[-_].*|yes|wip|dotfiles)$/i;
const JUNK_REPO_TAIL =
  /(^|[-_.])(repro|reproduction|bench|benchmark|demo|test|tests|example|examples)([-_.]|$)/i;
const NOT_A_PERSON_WORD = new Set([
  'agents',
  'agent',
  'window',
  'cursor',
  'composer',
  'origin',
  'bridge',
  'ship',
  'die',
  'token',
  'chrome',
  'app',
  'cli',
  'sdk',
  'api',
  'bot',
  'kit',
  'mini',
  'max',
  'pro',
  'plus',
  'studio',
  'lab',
  'labs',
  'cloud',
  'desktop',
  'web',
  'ios',
  'android',
  'server',
  'client',
  'core',
  'native',
  'types',
  'query',
  'listen',
  'blocker',
  'simulator',
  'slots',
  'plan',
  'bed',
  'lake',
  'frog',
  'shell',
  'the',
  'and',
  'or',
  'of',
  'for',
  'in',
  'on',
  'to',
  'our',
  'new',
  'improved',
  'teams',
  'pricing',
  'efficiency',
  'updates',
  'notes',
  'launch',
  'released',
  'available',
  'images',
  'models',
  'model',
]);

/** `greeting.query`, `createHttpServer`, `bun-types`, bare `listen`. */
export function looksLikeCodeIdentifier(name: string): boolean {
  const t = name.replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (/^[A-Za-z_]\w*\s*\.\s*[A-Za-z_]\w*$/.test(t) && !/\.(com|io|ai|dev|app|org|net|co|xyz|me|so|gg)$/i.test(t)) return true;
  if (/^(create|get|set|has|is|on|use|make)[A-Z][A-Za-z0-9]{2,}$/.test(t)) return true;
  const compact = t.replace(/[\s._-]+/g, '');
  if (/^(create|get|set|has|listen)[a-z]{8,}$/i.test(compact) && !/\s/.test(t)) return true;
  if (/(^|[-_/@])types$/i.test(t) || /^@types\//i.test(t)) return true;
  if (/^(listen|connect|query|request|response|handler|callback|emit|pipe|server)$/i.test(t)) return true;
  return false;
}

/** A person's name is never a ship (`Mattia Astorino`). Products like Agents Window stay. */
export function looksLikePersonName(name: string, who?: string | null): boolean {
  const text = name.replace(/\s+/g, ' ').trim();
  if (!text) return false;
  if (who) {
    const a = text.toLowerCase().replace(/[^a-z]/g, '');
    const b = who.toLowerCase().replace(/[^a-z]/g, '');
    if (a.length >= 6 && b.length >= 6 && (a === b || a === `${b}s`)) return true;
  }
  const words = text.split(/\s+/);
  if (words.length < 2 || words.length > 3) return false;
  if (/[\d@/]/.test(text)) return false;
  const norm = words.map((word) => word.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, ''));
  if (norm.some((word) => word.length < 2 || word.length > 14)) return false;
  if (norm.some((word) => NOT_A_PERSON_WORD.has(word.toLowerCase()))) return false;
  return norm.every((word) => /^[A-Z][a-z]+(?:[-'][A-Z][a-z]+)?$/.test(word) || /^[A-Z]{2,14}$/.test(word));
}

export function isJunkRepoName(name: string, login?: string | null, who?: string | null): boolean {
  const n = name.replace(/\.git$/, '');
  if (!REPO_NAME.test(n) && !/^[A-Za-z0-9 ._:-]{1,80}$/.test(n)) return true;
  return isJunkProductName(n, login, who);
}

/** Repro/demo/profile names are not ships on any source (`yes`, `t3dotgg`, `shoo-vite-demo`). */
/** Known package families that must stay even without weekly downloads or a homepage. */
export function isKnownPackageFamily(name: string): boolean {
  const n = name.replace(/\.git$/, '').trim().toLowerCase();
  return n === 'shoo' || n === '@shoojs' || n.startsWith('@shoojs/');
}

export function isJunkProductName(name: string, login?: string | null, who?: string | null): boolean {
  if (isKnownPackageFamily(name)) return false;
  const n = name.replace(/\.git$/, '');
  const compact = n.replace(/[\s._-]+/g, '').toLowerCase();
  if (login && compact === login.replace(/[\s._-]+/g, '').toLowerCase()) return true;
  if (who && compact === who.replace(/[\s._-]+/g, '').toLowerCase()) return true;
  const first = (who || '').split(/\s+/)[0] || '';
  if (first.length >= 3 && new RegExp(`\\b${first}\\b`, 'i').test(n) && /[-–]/.test(n) && n.split(/\s+/).length <= 4) return true;
  if (SKIP_REPOS.test(n) || JUNK_REPO_TAIL.test(n.replace(/\s+/g, '-'))) return true;
  if (/^dotfiles$|\.files$/i.test(n)) return true;
  if (looksLikeCodeIdentifier(n) || looksLikePersonName(n, who)) return true;
  return false;
}

export function looksLikeProductReadme(text: string): boolean {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (t.length < 12) return false;
  if (/\b(repro(duction)?|benchmark|demo of|test case|minimal (repro|example)|dotfiles)\b/i.test(t)) return false;
  if (/^(wip|todo|scratch|tmp)\b/i.test(t)) return false;
  return true;
}

export function isShipRepo(
  row: {
    name: string;
    description?: string;
    stars?: number;
    homepage?: string | null;
    hasRelease?: boolean;
    readme?: string;
    downloads?: number;
  },
  login?: string | null,
): boolean {
  if (isKnownPackageFamily(row.name)) return true;
  if (isJunkRepoName(row.name, login)) return false;
  const desc = (row.description || row.readme || '').replace(/\s+/g, ' ').trim();
  if (desc.length < 12 || !looksLikeProductReadme(desc)) return false;
  if ((row.stars ?? 0) >= 25) return true;
  if (row.homepage) return true;
  if ((row.downloads ?? 0) > 0) return true;
  return false;
}
