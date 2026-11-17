import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const route=readFileSync('app/api/profile-sync/route.ts','utf8');
const runner=readFileSync('scripts/edc-profile-sync.mjs','utf8');
test('release adapter targets only the correct sexy00 repository and baseline',()=>{
 const adapter=readFileSync('scripts/controlled-release.mjs','utf8');
 assert.match(adapter,/repo='nning00\/sexy00-profile-sync'/);
 assert.match(adapter,/1156a0b5-e73d-4ef3-9488-a9584e73f624/);
 assert.match(adapter,/0003c7c6-8e3a-4aa0-a3db-649cdfcc4880/);
 assert.doesNotMatch(adapter,/sexytw|sexyning|nning00\/sexy00-site/);
});
test('automatic synchronization cannot drain permanent media queue',()=>{
 assert.doesNotMatch(runner,/await drainMediaQueue\(\)/);
 assert.match(runner,/if\(!preview\)throw new Error/);
 assert.match(route,/if\(mode === "commit"\) return NextResponse.json\(\{error:"Permanent media cleanup/);
 assert.match(route,/collectUnusedProfileMedia\(createAdminClient\(\),false,false\)/);
 assert.doesNotMatch(route,/rpc\("sexy00_remove_photoless_profile"/);
});
test('release probe is authenticated, read-only and target-isolated',()=>{
 const probe=route.slice(route.indexOf('export async function GET'),route.indexOf('const PROVIDER'));
 assert.match(probe,/isAuthorized\(request\)/);assert.match(probe,/assertCleanupTarget\(\)/);
 assert.match(probe,/lifecycle72hVersion: 1/);assert.match(probe,/kkxsclcqdxoiqucunpur/);
 assert.doesNotMatch(probe,/\.rpc\(|\.insert\(|\.update\(|\.delete\(/);
});
