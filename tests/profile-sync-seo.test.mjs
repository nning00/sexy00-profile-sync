import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { buildProfileSyncSeo } from '../lib/profile-sync-seo.ts';

const city='\u53f0\u4e2d', name='\u6e2c\u8a66\u5f62\u8c61';
const details={serviceMethod:'\u5b9a\u9ede\u8336',serviceArea:'\u5317\u5340',height:'174',cup:'G',price:'NT$7,100\u20137,900'};
test('generated title and description preserve readable identity, separators and units',()=>{
 const value=buildProfileSyncSeo(city,name,details);
 assert.equal(value.seoTitle,'\u53f0\u4e2d\u5b9a\u9ede\u8336\uff5c\u6e2c\u8a66\u5f62\u8c61\uff5c\u5317\u5340\u30fb174\u516c\u5206\u30fbG\u7f69\u676f\u30fbNT$7,100\u20137,900');
 assert.equal(value.seoDescription,'\u53f0\u4e2d\u5b9a\u9ede\u8336\u8cc7\u8a0a\uff5c\u6e2c\u8a66\u5f62\u8c61\uff0c174\u516c\u5206\u3001G\u7f69\u676f\u3001NT$7,100\u20137,900\u3002\u67e5\u770b\u516c\u958b\u7167\u7247\u3001\u670d\u52d9\u5730\u5340\u8207\u806f\u7d61\u524d\u9808\u77e5\u3002');
 assert(!/\ufffd/.test(JSON.stringify(value)));
});
test('missing values never fabricate personal details',()=>{
 const value=buildProfileSyncSeo(city,name,{serviceArea:'\u672a\u77e5',height:'--',cup:'n/a',price:'{price}'});
 assert.equal(value.seoTitle,`${city}\u6210\u4eba\u5f62\u8c61\uff5c${name}`);
 assert(!value.seoDescription.includes('\u516c\u5206'));
});
test('already formatted units and punctuation in names are retained',()=>{
 const value=buildProfileSyncSeo(city,'Test?A',{...details,height:'174\u516c\u5206',cup:'G\u7f69\u676f'});
 assert(value.seoTitle.includes('Test?A'));
 assert(!value.seoTitle.includes('\u516c\u5206\u516c\u5206'));
 assert(!value.seoTitle.includes('\u7f69\u676f\u7f69\u676f'));
});
test('ages are not consumed, output fields cannot alter publication or evidence',()=>{
 const value=buildProfileSyncSeo(city,name,{...details,age:'28'});
 assert.deepEqual(Object.keys(value).sort(),['seoDescription','seoTitle']);
 assert(!JSON.stringify(value).includes('28'));
});
test('corrupt optional traits are omitted but corrupt identity requires investigation',()=>{
 assert(!buildProfileSyncSeo(city,name,{height:'174\ufffd'}).seoTitle.includes('\ufffd'));
 assert.throws(()=>buildProfileSyncSeo(city,'Bad\ufffd',details),/identity encoding/);
});
test('production receiver uses the tested builder and has no replacement characters',()=>{
 const route=readFileSync(new URL('../app/api/profile-sync/route.ts',import.meta.url),'utf8');
 assert(route.includes('buildProfileSyncSeo(profile.cityName, profile.displayName, profile.details)'));
 assert(!route.includes('\ufffd'));
 const builder=readFileSync(new URL('../lib/profile-sync-seo.ts',import.meta.url),'utf8');
 assert(/^[\x00-\x7f]*$/.test(builder));
});
