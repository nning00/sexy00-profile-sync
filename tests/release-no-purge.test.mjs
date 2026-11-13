import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const route=readFileSync('app/api/profile-sync/route.ts','utf8');
const runner=readFileSync('scripts/edc-profile-sync.mjs','utf8');
test('release adapter targets only the correct sexy00 repository and baseline',()=>{
 const adapter=readFileSync('scripts/controlled-release.mjs','utf8');
 assert.match(adapter,/repo='nning00\/sexy00-profile-sync'/);
 assert.match(adapter,/f3c5d01c-8d01-4dc5-9c79-e12f5c313e68/);
 assert.match(adapter,/497a639b-c263-49b4-a240-5313284bb58f/);
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
