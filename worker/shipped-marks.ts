// Retired house-brand endpoint. Empty advertising slots never infer or fetch a business logo.
// Keep the route available so old pages cannot revive cached house marks from R2.
import { INERT_CSP, secure } from './shipped-guard';
import type { SourceEnv } from './shipped-sources';

export async function houseMark(_env: SourceEnv & { SHIPPED?: R2Bucket }, _slot: number): Promise<Response> {
  const headers = secure(new Headers({ 'cache-control': 'no-store', 'x-robots-tag': 'noindex' }));
  headers.set('content-security-policy', INERT_CSP);
  return new Response('Not found', { status: 404, headers });
}
