import './resolve-ts.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const products = await import('../worker/shipped-products.ts');
const polish = await import('../worker/shipped-polish.ts');
const affiliation = await import('../worker/shipped-affiliation.ts');

test('bio and URL surfaces resolve own products without a person table', () => {
  const fromSteven = products.productsFromBio('Founder of Dub. https://dub.co');
  assert.ok(fromSteven.some((row) => /dub/i.test(row.name)));
  assert.ok(fromSteven.some((row) => row.site && /dub\.co/i.test(row.site)));

  const fromLevels = products.productsFromBio('Maker of Photo AI, Interior AI and Remote OK. https://photoai.com');
  assert.ok(fromLevels.some((row) => /photo ai/i.test(row.name)));
  assert.ok(fromLevels.some((row) => /interior ai/i.test(row.name)));

  const fromDanny = products.productsFromBio('Building HeadshotPro and Photo AI.');
  assert.ok(fromDanny.some((row) => /headshotpro/i.test(row.name.replace(/\s+/g, ''))));

  const fromUrls = products.productsFromUrls(['https://dub.co/', 'https://github.com/steven-tey/dub']);
  assert.ok(fromUrls.some((row) => /dub/i.test(row.name)));
});

test('pinned repo HTML is parsed from the GitHub profile markup', () => {
  const html = `
    <div class="js-pinned-items-reorder-container">
      <ol class="pinned-items-list">
        <li class="pinned-item-list-item">
          <a href="/colinhacks/nub" class="Link mr-1 text-bold wb-break-word">nub</a>
        </li>
        <li class="pinned-item-list-item">
          <a href="/colinhacks/zod" class="Link mr-1 text-bold wb-break-word">zod</a>
        </li>
      </ol>
    </div>`;
  const pins = products.pinnedReposFromHtml(html);
  assert.ok(pins.some((row) => row.owner === 'colinhacks' && row.name === 'nub'));
  assert.ok(pins.some((row) => row.name === 'zod'));
});

test('live GitHub pin markup keeps an org-owned pin after nested divs', () => {
  const pad = '<div class="Box"><div class="inner">'.repeat(80) + '</div></div>'.repeat(80);
  const html = `
    <div class="js-pinned-items-reorder-container">
      <span data-view-component="true"><a data-hydro-click="{&quot;event_type&quot;:&quot;user_profile.click&quot;,&quot;payload&quot;:{&quot;target&quot;:&quot;PINNED_REPO&quot;}}" href="/colinhacks/zod" class="Link mr-1 text-bold">zod</a></span>
      ${pad}
      <span data-view-component="true"><a data-hydro-click="{&quot;event_type&quot;:&quot;user_profile.click&quot;,&quot;payload&quot;:{&quot;target&quot;:&quot;PINNED_REPO&quot;}}" href="/nubjs/nub" class="Link mr-1 tmp-mr-1 text-bold wb-break-word"><span class="owner">nubjs/</span><span class="repo">nub</span></a></span>
    </div>`;
  const pins = products.pinnedReposFromHtml(html);
  assert.ok(pins.some((row) => row.owner === 'colinhacks' && row.name === 'zod'), JSON.stringify(pins));
  assert.ok(pins.some((row) => row.owner === 'nubjs' && row.name === 'nub'), JSON.stringify(pins));
});

test('employer npm rollups never land on an employee who is not the CEO or lead', () => {
  const item = { name: 'VERCEL · 128 RELEASES IN JUL', source: 'npm', link: 'https://www.npmjs.com/package/vercel' };
  const employee = { ...affiliation.emptyAffiliation(), role: 'employee', company: 'Vercel' };
  const unknown = { ...affiliation.emptyAffiliation(), role: 'unknown', company: 'Vercel' };
  const founderOther = { ...affiliation.emptyAffiliation(), role: 'founder', company: 'shadcn' };
  const ceo = { ...affiliation.emptyAffiliation(), role: 'ceo', company: 'Vercel' };
  assert.equal(products.isEmployerSpill(item, employee), true);
  assert.equal(products.isEmployerSpill(item, unknown), true);
  assert.equal(products.isEmployerSpill(item, founderOther), true);
  assert.equal(products.isEmployerSpill(item, ceo), false);
  assert.equal(products.isEmployerSpill({ name: 'AI Gateway', source: 'changelog', link: 'https://vercel.com/changelog/ai-gateway' }, employee), false);
});

test('date-only and recap titles fail the cheap tape', () => {
  assert.equal(polish.looksLikeMonthlyRoundup('MAR 11, 2026'), true);
  assert.equal(polish.looksLikeMonthlyRoundup('Mar 11, 2026'), true);
  assert.equal(polish.looksLikeMonthlyRoundup('2026 recap'), true);
  assert.equal(polish.titleSanityOk('MAR 11, 2026'), false);
  assert.equal(polish.titleSanityOk('AWS DATABASES ARE NOW LIVE ON THE VERCEL MARKETPLACE AND V0'), false);
});

test('printed titles stay noun phrases at 48 characters', () => {
  assert.equal(polish.TITLE_MAX, 48);
  const title = polish.cleanShipTitle('AWS DATABASES ARE NOW LIVE ON THE VERCEL MARKETPLACE AND V0');
  assert.ok(!title || title.length <= 48);
  assert.equal(Boolean(title && /\b(are now|now live)\b/i.test(title)), false);
  const plugin = polish.cleanShipTitle('VERCEL PLUGIN NOW SUPPORTED ON OPENAI CODEX AND CODEX');
  assert.ok(plugin);
  assert.ok(plugin.length <= 48, plugin);
  assert.equal(/\bnow supported\b/i.test(plugin), false);
});
