import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {cityPageNumber,cityPageHref,cityPageLinks,isCityPageOutOfRange} from '../lib/city-pagination.ts';
import {profileReturnPath,savedProfileReturn,profileCityReturnPath} from '../lib/navigation.ts';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('direct entry and disabled session storage retain a stable public city default',()=>{
 const regions=[{slug:'north',cities:[{id:'hidden',slug:'secret',published:false},{id:'public',slug:'taipei',published:true}]}];
 assert.equal(profileCityReturnPath(regions,['public']),'/regions/north/taipei');
 assert.equal(profileCityReturnPath(regions,['hidden']),'/#gallery');
 assert.equal(profileCityReturnPath(regions,[]),'/#gallery');
 assert.equal(profileCityReturnPath([{slug:'../admin',cities:regions[0].cities}],['public']),'/#gallery');
 assert.match(read('components/ProfileReturnLink.tsx'),/\(\) => defaultPath/);
 assert.match(read('app/profiles/[id]/page.tsx'),/cityPath=\{cityPath\}/);
});
test('PostgREST 416 out-of-bounds becomes an empty page, not a database outage',()=>{
 const response={status:416,error:{code:'PGRST103',message:'Requested range not satisfiable'}};
 assert.equal(isCityPageOutOfRange(response.error,239976),true);
 assert.equal(isCityPageOutOfRange(response.error,0),false);
 assert.equal(isCityPageOutOfRange({code:'57014'},24),false);
 assert.equal(isCityPageOutOfRange(null,24),false);
 assert.match(read('lib/cms.ts'),/isCityPageOutOfRange\(error, safeOffset\)/);
});
test('strict bounded page parser rejects ambiguous or resource-heavy variants',()=>{
 assert.equal(cityPageNumber(undefined),1);assert.equal(cityPageNumber('1'),1);assert.equal(cityPageNumber('10000'),10000);
 for(const value of ['',[],['2'],['1','2'],'0','01','-1','1.5','2foo','Infinity','10001','999999999999'])assert.equal(cityPageNumber(value),null,String(value));
});
test('every valid page has its own canonical URL, first page stays clean',()=>{
 assert.equal(cityPageHref('/regions/north/taipei',1),'/regions/north/taipei');
 assert.equal(cityPageHref('/regions/north/taipei',2),'/regions/north/taipei?page=2');
 for(let page=1;page<=100;page++){const links=cityPageLinks(page,100);assert(links.includes(page));assert(links.includes(1));assert(links.includes(100));assert(links.length<=7);if(page>1)assert(links.includes(page-1));if(page<100)assert(links.includes(page+1));}
});
test('clean canonical card links retain optional tab-local return context',()=>{
 const src=read('components/CityProfileGrid.tsx');assert.match(src,/href=\{`\/profiles\/\$\{profile.slug\}`\}/);assert.doesNotMatch(src,/\?from=|loadMore|\/api\/city-profiles/);
 assert.match(src,/sessionStorage.setItem/);assert.match(src,/catch/);
 const record=JSON.stringify({profilePath:'/profiles/source-100',returnPath:'/regions/north/taipei?page=3',at:100});
 assert.equal(savedProfileReturn(record,'/profiles/source-100',200),'/regions/north/taipei?page=3');
 assert.equal(savedProfileReturn(record,'/profiles/source-101',200),'/#gallery');assert.equal(savedProfileReturn(record,'/profiles/source-100',2000000),'/#gallery');assert.equal(savedProfileReturn(record,'/profiles/source-100',0),'/#gallery');
 assert.equal(savedProfileReturn('{bad','/profiles/source-100'),'/#gallery');
 for(const attack of ['//evil.test','https://evil.test','/regions/north/taipei?page=2&x=1','/regions/north/taipei?page=0','/regions/north/taipei?page=10001','/regions/north/taipei#x','/regions/../admin'])assert.equal(profileReturnPath(attack),'/#gallery');
 assert.equal(profileReturnPath('/regions/north/taipei?page=1'),'/regions/north/taipei');
});
test('SSR pagination exposes ordinary anchor links and does not invent empty-city people',()=>{
 const pager=read('components/CityPagination.tsx');assert.match(pager,/rel="next"/);assert.match(pager,/rel="prev"/);assert.match(pager,/aria-current/);assert.doesNotMatch(pager,/use client/);
 const city=read('app/regions/[slug]/[city]/page.tsx');assert.match(city,/await searchParams/);assert.match(city,/alternates: \{ canonical: url \}/);assert.match(city,/page > 1.*notFound\(\)/);assert.match(city,/permanentRedirect\(cityUrl\)/);assert.doesNotMatch(city,/profileExamples/);
});
test('parent rows are stably ordered before range, profile lookup reuses city IDs',()=>{
 const cms=read('lib/cms.ts'),part=cms.slice(cms.indexOf('async function getPublishedProfilePageForCityUncached'),cms.indexOf('async function getPublishedProfileUncached'));
 assert.match(part,/order\("profiles\(sort_order\)"\)/);assert.match(part,/order\("profiles\(created_at\)"/);assert.match(part,/order\("profile_id"\)/);assert.doesNotMatch(part,/referencedTable|introduction|seo_description/);assert.match(part,/if \(error\) throw error/);
 assert.match(cms,/profile_cities\(city_id\)/);assert.match(cms,/if \(!cityIds\)/);assert.match(read('app/profiles/[id]/page.tsx'),/profile.profile_cities\?\.map/);
});
