import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { adultIdentityBinding, continueExistingApproval, manualReceiptCanContinue, matchingManualEvidence, needsManualEvidenceRecheck, receiptMatches, reviewDecision, samePhotoHashes, sourceAge } from '../lib/adult-receipt-policy.ts';
const a='a'.repeat(64), b='b'.repeat(64);
const receipt={source_key:'101',content_hash:a,photo_hashes:[a,b],verified_at:'2026-01-01',verified_by:'fixture',last_profile_id:'old-row',evidence_state:'bound',revoked_at:null,evidence_version:2};
test('a retained profile with exact identity and photos can reuse its manual approval',()=>assert.equal(receiptMatches(receipt,'101',a,[b,a]),true));
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
const legacy={source_content_hash:a,status:'published',adult_review_status:'verified',adult_verified_at:'2026-01-01',adult_verified_by:null};
test('unchanged existing legacy approval is not unnecessarily taken offline',()=>assert.equal(continueExistingApproval(legacy,a,'',true),true));
test('legacy state is not transferable to a recreated, changed, archived or photo-less row',()=>{
 assert.equal(continueExistingApproval(undefined,a,'',true),false);
 assert.equal(continueExistingApproval(legacy,b,'',true),false);
 assert.equal(continueExistingApproval({...legacy,status:'archived'},a,'',true),false);
 assert.equal(continueExistingApproval(legacy,a,'',false),false);
 assert.equal(continueExistingApproval(legacy,a,'17',true),false);
});
test('the reviewed actual metadata remains bound even if a cached source hash was stale',()=>{
 const base={sourceKey:'101',sourceUrl:'https://edc.com.tw/a',displayName:'Person A',cityNames:['City A'],details:{height:'160',age:''}};
 assert.notEqual(adultIdentityBinding(base),adultIdentityBinding({...base,displayName:'Person B'}));
 assert.notEqual(adultIdentityBinding(base),adultIdentityBinding({...base,cityNames:['City B']}));
 assert.notEqual(adultIdentityBinding(base),adultIdentityBinding({...base,details:{height:'170',age:''}}));
 assert.equal(adultIdentityBinding(base),adultIdentityBinding({...base,details:{age:'',height:'160'}}));
});
test('old file-only fingerprints cannot approve a recreated identity',()=>assert.equal(receiptMatches({...receipt,evidence_version:1},'101',a,[a,b]),false));
test('archived and recreated manual records require fresh photo comparison, not a shortcut',()=>{
 const current={id:'old-row',source_content_hash:a,status:'published',adult_review_status:'verified',adult_verified_by:'fixture'};
 assert.equal(manualReceiptCanContinue(receipt,current,a,true),true);
 assert.equal(manualReceiptCanContinue(receipt,{...current,status:'archived'},a,true),false);
 assert.equal(manualReceiptCanContinue(receipt,{...current,id:'new-row'},a,true),false);
 assert.equal(manualReceiptCanContinue(receipt,current,a,false),false);
});
test('permanent profile removal leaves no receipt to approve a new import',()=>{
 assert.equal(receiptMatches(undefined,'101',a,[a,b]),false);
 assert.equal(reviewDecision('',false,false),'pending');
});

const publishedManual={id:'old-row',status:'published',source_content_hash:b,
 adult_review_status:'verified',adult_verified_at:'2026-01-01',adult_verified_by:'fixture'};
const reviewed={sourceKey:'101',sourceUrl:'https://edc.com.tw/item',displayName:'Fixture',cityNames:['City'],details:{age:'',height:'160'}};
const bindingHashes=(metadata,photos)=>photos.map(bytes=>createHash('sha256').update(adultIdentityBinding(metadata)).update('\0').update(bytes).digest('hex'));
const original={...receipt,photo_hashes:bindingHashes(reviewed,['first-image','second-image'])};
test('still-published manual evidence survives a full catalogue hash change with identical reviewed data and reordered exact photos',()=>{
 assert.equal(needsManualEvidenceRecheck(publishedManual,'',true),true);
 assert.equal(receiptMatches(original,'101',b,original.photo_hashes),false);
 assert.equal(matchingManualEvidence([original],publishedManual,'101',bindingHashes(reviewed,['second-image','first-image'])),original);
});
test('historical receipt cannot keep a row public if reviewed identity or any photo changes',()=>{
 for(const replacement of [
   bindingHashes({...reviewed,displayName:'Different name'},['first-image','second-image']),
   bindingHashes({...reviewed,cityNames:['Other city']},['first-image','second-image']),
   bindingHashes({...reviewed,details:{...reviewed.details,age:'17'}},['first-image','second-image']),
   bindingHashes(reviewed,['first-image','different-image']),
   bindingHashes(reviewed,['first-image']),
 ]) assert.equal(matchingManualEvidence([original],publishedManual,'101',replacement),undefined);
});
test('the new fallback cannot revive a draft, a rejected or recreated row, or use revoked or unbound evidence',()=>{
 for(const current of [undefined,{...publishedManual,id:'new-row'},{...publishedManual,status:'draft'},{...publishedManual,status:'archived'},
   {...publishedManual,adult_review_status:'rejected'},{...publishedManual,adult_verified_by:null}])
   assert.equal(matchingManualEvidence([original],current,'101',original.photo_hashes),undefined);
 for(const evidence of [{...original,revoked_at:'2026-01-02'},{...original,evidence_state:'legacy-unbound'},
   {...original,evidence_version:1},{...original,verified_by:'different-reviewer'},{...original,source_key:'102'}])
   assert.equal(matchingManualEvidence([evidence],publishedManual,'101',original.photo_hashes),undefined);
 assert.equal(needsManualEvidenceRecheck(publishedManual,'17歲',true),false);
 assert.equal(needsManualEvidenceRecheck(publishedManual,'',false),false);
 assert.equal(reviewDecision('17歲',true,false),'rejected');
});
