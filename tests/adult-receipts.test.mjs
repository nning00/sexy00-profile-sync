import test from 'node:test';
import assert from 'node:assert/strict';
import { receiptMatches, reviewDecision, samePhotoHashes, sourceAge } from '../lib/adult-receipt-policy.ts';
const a='a'.repeat(64), b='b'.repeat(64);
const receipt={source_key:'101',content_hash:a,photo_hashes:[a,b],verified_at:'2026-01-01',verified_by:'fixture',last_profile_id:'old-row',evidence_state:'bound',revoked_at:null};
test('exact identity and photo files can reuse manual approval after row recreation',()=>assert.equal(receiptMatches(receipt,'101',a,[b,a]),true));
test('same name with another source ID is never enough',()=>assert.equal(receiptMatches(receipt,'102',a,[a,b]),false));
test('changed source URL, city, details or picture URLs change full-content hash',()=>assert.equal(receiptMatches(receipt,'101',b,[a,b]),false));
test('replaced bytes at the same photo URL require another review',()=>assert.equal(receiptMatches(receipt,'101',a,[a,a]),false));
test('partial/missing photo evidence is not accepted',()=>{
 assert.equal(samePhotoHashes([],[]),false);assert.equal(receiptMatches(receipt,'101',a,[a]),false);
 assert.equal(receiptMatches({...receipt,photo_hashes:['bad']},'101',a,['bad']),false);
});
test('unbound legacy receipts are retained but cannot approve recreated records',()=>assert.equal(receiptMatches({...receipt,evidence_state:'insufficient-evidence'},'101',a,[a,b]),false));
test('revoked evidence cannot be reused',()=>assert.equal(receiptMatches({...receipt,revoked_at:'2026-11-07'},'101',a,[a,b]),false));
test('unknown age stays empty/pending without evidence',()=>assert.equal(reviewDecision('',false,false),'pending'));
test('manual evidence never overrides an explicit minor age',()=>{
 for(const age of ['17','17歲','9','0'])assert.equal(reviewDecision(age,true,false),'rejected');
});
test('ambiguous ages are not parsed as adult evidence',()=>{
 for(const age of ['17-20','2008/01/01','118','約20歲',''])assert.equal(sourceAge(age),null);
 assert.equal(reviewDecision('17-20',false,false),'pending');
});
test('source adult evidence works without fabricating a manual reviewer',()=>assert.equal(reviewDecision('20歲',false,false),'verified'));
test('explicit rejections remain blocked',()=>assert.equal(reviewDecision('25',true,true),'rejected'));
