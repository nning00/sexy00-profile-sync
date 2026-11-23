import test from 'node:test';import assert from 'node:assert/strict';
import {readableProfileSeo,readableDescription,seoWidth} from '../lib/readable-seo.ts';
test('long trait lists become readable without losing name or changing stored values',()=>{
 const title='台中地區｜測試名字｜'+('很多地區、'.repeat(20));const original=title;const result=readableProfileSeo('測試名字',title,'公開資料與照片介紹。');
 assert(result.title.includes('測試名字'));assert(seoWidth(result.title)<=112);assert.equal(title,original);assert(result.description.includes('公開資料與照片介紹。'));assert(result.description.includes('內容可能隨來源更新'));assert(Array.from(result.description).length<=155);
});
test('well-formed custom titles and substantive descriptions remain untouched',()=>{
 const title='編輯自訂的公開資料標題';const description='有具體內容的完整說明。'.repeat(10);const out=readableProfileSeo('測試',title,description);assert.equal(out.title,title);assert.equal(out.description,description);
});
test('Unicode summaries are bounded at readable boundaries without broken surrogates',()=>{
 const out=readableDescription('😀公開說明。'.repeat(40),'補充');assert(Array.from(out).length<=155);assert(!out.includes('\ufffd'));
});
test('shortening same-name entries retains a distinct existing public URL reference',()=>{
 const long='城市｜同名｜'+('很多地區、'.repeat(20));
 const a=readableProfileSeo('同名',long,'說明。','source-123');
 const b=readableProfileSeo('同名',long,'說明。','source-456');
 assert.notEqual(a.title,b.title);assert(a.title.includes('123'));assert(seoWidth(a.title)<=112);
});
