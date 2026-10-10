/** GitHub repos that are reproductions, benches, demos, forks-in-name, or a profile. */

const REPO_NAME = /^[A-Za-z0-9._-]{1,100}$/;
const SKIP_REPOS =
  /^(my-app|throwaway(-\d+)?|tmp|playground|sandbox|awesome[-_].*|yes|wip|dotfiles)$/i;
const JUNK_REPO_TAIL =
  /(^|[-_.])(repro|reproduction|bench|benchmark|demo|test|tests|example|examples)([-_.]|$)/i;

export function isJunkRepoName(name: string, login?: string | null, who?: string | null): boolean {
  const n = name.replace(/\.git$/, '');
  if (!REPO_NAME.test(n) && !/^[A-Za-z0-9 ._:-]{1,80}$/.test(n)) return true;
  return isJunkProductName(n, login, who);
}

/** Repro/demo/profile names are not ships on any source (`yes`, `t3dotgg`, `shoo-vite-demo`). */
export function isJunkProductName(name: string, login?: string | null, who?: string | null): boolean {
  const n = name.replace(/\.git$/, '');
  const compact = n.replace(/[\s._-]+/g, '').toLowerCase();
  if (login && compact === login.replace(/[\s._-]+/g, '').toLowerCase()) return true;
  if (who && compact === who.replace(/[\s._-]+/g, '').toLowerCase()) return true;
  const first = (who || '').split(/\s+/)[0] || '';
  if (first.length >= 3 && new RegExp(`\\b${first}\\b`, 'i').test(n) && /[-–]/.test(n) && n.split(/\s+/).length <= 4) return true;
  if (SKIP_REPOS.test(n) || JUNK_REPO_TAIL.test(n.replace(/\s+/g, '-'))) return true;
  if (/^dotfiles$|\.files$/i.test(n)) return true;
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
  row: { name: string; description?: string; stars?: number; homepage?: string | null; hasRelease?: boolean; readme?: string },
  login?: string | null,
): boolean {
  if (isJunkRepoName(row.name, login)) return false;
  const readme = row.readme || row.description || '';
  if (!looksLikeProductReadme(readme)) return false;
  if ((row.stars ?? 0) >= 25) return true;
  if (row.homepage) return true;
  if (row.hasRelease) return true;
  return false;
}
