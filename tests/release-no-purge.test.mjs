import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const route=readFileSync('app/api/profile-sync/route.ts','utf8');
const runner=readFileSync('scripts/edc-profile-sync.mjs','utf8');
test('release adapter targets only the correct sexy00 repository and baseline',()=>{
 const adapter=readFileSync('scripts/controlled-release.mjs','utf8');
 assert.match(adapter,/repo='nning00\/sexy00-profile-sync'/);
 assert.match(adapter,/85b5ec29-2c24-462d-bc05-3ce3f2371c35/);
 assert.match(adapter,/3f6a3050-b987-4a74-8f12-42fd5bea500f/);
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
