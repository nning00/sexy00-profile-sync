import assert from 'node:assert/strict';
import {test} from 'node:test';
import {sourcePhotoState,hasProfilePhotos,photoImportStagingStatus} from '../lib/profile-photo-policy.ts';
import {requireSourceImages} from '../scripts/profile-source-images.mjs';

test('only an explicit empty source array permits the no-photo branch',()=>{
 assert.equal(sourcePhotoState([],0),'empty');
 for(const input of [undefined,null,{},'',{length:0}])assert.equal(sourcePhotoState(input,0),'invalid');
});
test('existing source photo URLs remain present, including before download completes',()=>{
 assert.equal(sourcePhotoState([{url:'https://edc.com.tw/photo.jpg'}],1),'present');
 assert.equal(sourcePhotoState([{url:'https://edc.com.tw/photo.jpg'},{url:'https://edc.com.tw/photo.jpg'}],2),'present');
});
test('rejected URLs are invalid data, never proof that there are no photos',()=>{
 assert.equal(sourcePhotoState([{url:'https://example.invalid/a.jpg'}],0),'invalid');
 assert.equal(sourcePhotoState([null],0),'invalid');
});
test('crawler preserves empty arrays instead of dropping their source keys from the snapshot',()=>{
 assert.deepEqual(requireSourceImages([]),[]);
});
test('crawler fails closed on missing, malformed or unusable photo metadata',()=>{
 for(const input of [undefined,null,{},[null],[{}],[{src:''}],[{thumbnail:123}],[{src:'  '}]])assert.throws(()=>requireSourceImages(input),/incomplete/);
});
test('crawler accepts both documented source image URL fields without downloading',()=>{
 const images=[{thumbnail:'https://edc.com.tw/a.jpg'},{src:'https://edc.com.tw/b.jpg'}];
 assert.equal(requireSourceImages(images),images);
});
test('a failed photo download cannot expose a new or previously empty profile',()=>{
 assert.equal(photoImportStagingStatus(undefined),'draft');
 assert.equal(photoImportStagingStatus({status:'published',card_image_path:null,profile_images:[]}),'draft');
 assert.equal(hasProfilePhotos({card_image_path:' ',profile_images:[]}),false);
});
test('existing covers or manually added album photos keep their current visibility while importing',()=>{
 assert.equal(photoImportStagingStatus({status:'published',card_image_path:'gpt-copy/profiles/a.webp'}),'published');
 assert.equal(photoImportStagingStatus({status:'published',profile_images:[{id:'manual-photo'}]}),'published');
 assert.equal(photoImportStagingStatus({status:'archived',profile_images:[{id:'manual-photo'}]}),'archived');
});
