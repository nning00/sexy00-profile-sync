import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

// Use the native workerd already pinned by Wrangler, not a permissive Node fetch mock.
const require = createRequire(import.meta.url);
const wranglerRequire = createRequire(require.resolve('wrangler/package.json'));
const { Miniflare } = await import(pathToFileURL(wranglerRequire.resolve('miniflare')).href);
const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const source = read('lib/profile-sync-cadence.mjs').replaceAll('export ', '') + '\n' +
  read('worker/profile-sync-trigger.mjs').replace(/^import[^\n]+\n/, '').replaceAll('export ', '');

for (const redirectAt of [null, 'metadata', 'dispatch']) {
  test(`native scheduled fetch ${redirectAt ? `rejects ${redirectAt} redirects` : 'dispatches and deduplicates'} without real network`, async () => {
    const script = `${source}\nlet report; export default {
      async scheduled(controller, env, ctx) {
        try { report = await triggerProfileSync(controller, env); }
        catch (error) { report = { failed: true, error: error.message }; }
      }, fetch() { return Response.json(report); }
    }`;
    let committed = false;
    const calls = [];
    const mf = new Miniflare({ modules: true, script, compatibilityDate: '2026-05-15', compatibilityFlags: ['nodejs_compat'],
      bindings: { SEXY00_GITHUB_ACTIONS_TOKEN: 'synthetic-only' },
      outboundService: async request => {
        const u = new URL(request.url);
        assert.equal(u.origin, 'https://api.github.com');
        assert.equal(request.headers.get('Authorization'), 'Bearer synthetic-only');
        calls.push({ url: u.href, method: request.method });
        if (request.method === 'POST') {
          assert.equal(u.pathname, '/repos/nning00/sexy00-profile-sync/actions/workflows/profile-sync.yml/dispatches');
          if (redirectAt === 'dispatch') return new Response(null, { status: 307, headers: { Location: 'https://must-not-follow.invalid/' } });
          const body = await request.json();
          assert.equal(body.ref, 'main'); assert.equal(body.inputs.trigger_origin, 'cloudflare');
          assert.equal(body.inputs.snapshot_check, false);
          committed = body.inputs.slot_start;
          return new Response(null, { status: 204 });
        }
        if (u.pathname.includes('/jobs')) return Response.json({ total_count: 1, jobs: [{ steps: [{ name: 'Commit profile catalogue (six-hour slot)', conclusion: 'success' }] }] });
        if (u.pathname.endsWith('/runs')) return Response.json({ workflow_runs: committed ? [{ id: 2, event: 'workflow_dispatch',
          head_branch: 'main', path: '.github/workflows/profile-sync.yml', status: 'completed',
          // workerd's event clock freezes between I/O; don't fabricate a future completed run.
          run_started_at: new Date(Date.now() - 60000).toISOString(), updated_at: new Date(Date.now() - 30000).toISOString(),
          display_title: 'sexy00 sync | slot=' + committed + ' | cloudflare' }] : [] });
        if (redirectAt === 'metadata') return new Response(null, { status: 302, headers: { Location: 'https://must-not-follow.invalid/' } });
        return Response.json({ state: 'active', path: '.github/workflows/profile-sync.yml' });
      }
    });
    try {
      const worker = await mf.getWorker();
      await worker.scheduled({ cron: '37 * * * *' });
      const first = await (await worker.fetch('https://synthetic.invalid/report')).json();
      if (redirectAt) {
        assert.equal(first.failed, true);
        assert.match(first.error, redirectAt === 'metadata' ? /HTTP 302/ : /HTTP 307/);
        assert.equal(calls.filter(c => c.method === 'POST').length, redirectAt === 'metadata' ? 0 : 1);
      } else {
        assert.equal(first.status, 'dispatched');
        await worker.scheduled({ cron: '37 * * * *' });
        const second = await (await worker.fetch('https://synthetic.invalid/report')).json();
        assert.equal(second.status, 'already-synced'); assert.equal(second.satisfiedByRun, 2);
        assert.equal(calls.filter(c => c.method === 'POST').length, 1);
      }
    } finally { await mf.dispose(); }
  });
}
