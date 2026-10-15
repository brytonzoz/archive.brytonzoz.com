// Host → company from data/shipped-companies.json (first-party changelog harvest list).
import seeds from '../data/shipped-companies.json';

type SeedRow = { company: string; sites?: string[] };

const HOST_TO_COMPANY = new Map<string, string>();
for (const row of (seeds as { companies: SeedRow[] }).companies) {
  for (const site of row.sites ?? []) {
    try {
      const host = new URL(site).hostname.replace(/^www\./i, '').toLowerCase();
      if (host) HOST_TO_COMPANY.set(host, row.company);
    } catch {
      /* skip bad seed URL */
    }
  }
}

export function companyForHost(host: string | null | undefined): string | null {
  if (!host) return null;
  const h = host.replace(/^www\./i, '').toLowerCase();
  return HOST_TO_COMPANY.get(h) ?? null;
}

/** Match a profile URL to a seeded company (cursor.com → Cursor). */
export function companyFromSeedSites(urls: (string | null | undefined)[]): { company: string; site: string } | null {
  for (const raw of urls) {
    if (!raw) continue;
    let host = '';
    try {
      host = new URL(raw.startsWith('http') ? raw : `https://${raw}`).hostname.replace(/^www\./i, '').toLowerCase();
    } catch {
      continue;
    }
    const company = companyForHost(host);
    if (company) return { company, site: raw.startsWith('http') ? raw : `https://${host}/` };
  }
  return null;
}
