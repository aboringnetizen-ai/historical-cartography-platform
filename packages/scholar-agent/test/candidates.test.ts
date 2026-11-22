import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { EvidenceStore } from '../src/evidence.ts';
import { inspectClaim, inspectDispute, type Dimension, type ResearchClaim } from '../src/candidates.ts';
import { chase, classification, type CatalogEntry } from '../src/catalog.ts';

test('五维候选复用页行门禁；冲突保留双方版本，同原文别名不能充当独立证人',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'claim-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));const store=new EvidenceStore();
 async function build(id:string,word:string):Promise<ResearchClaim>{const text=`工程夹具：${word}`;const path=join(dir,id+'.txt');await writeFile(path,text);const tier='T1_PRIMARY_AND_LOCAL_ACADEMIC';const idx=await store.indexNativeFile({source_doc_id:id,local_path:path,title:id,medium:'LOCAL_FILE',language:'zh',authors:[],is_local_academic_journal:false,credibility_tier:tier,ocr_indexed:false},undefined,{file_sha256:createHash('sha256').update(text).digest('hex'),basis:'非史料；工程注入的审阅输入'});return {id,proposition:word,dimension:'TOPONYM',subject:'fixture-site',epoch:'fixture-era',citations:[{index_revision:idx.index_revision,evidence:{citation_id:id,source_doc_id:id,page_number:'file:1',verbatim_quote:text,ocr_line_range:[1,1],credibility_tier:tier,verified_by_human:false}}]};}
 const a=await build('a','甲地'),b=await build('b','乙地'),alias=await build('copy','甲地');alias.proposition='异读';
 for(const d of ['POLITY_BOUNDARY','CONTROL','ADMIN_AND_SEAT','ADMIN_EVOLUTION','TOPONYM'] satisfies Dimension[])assert.equal((await inspectClaim(store,{...a,dimension:d})).status,'QUOTES_VERIFIED');
 const r=await inspectDispute(store,a,b,'两种命名是否指同地？');assert.equal(r.status,'T1_SCHOLARLY_DISPUTE');assert.equal(r.authorizes_spatial_write,false);assert.deepEqual(r.left.claim.citations,a.citations);assert.deepEqual(r.right.claim.citations,b.citations);
 assert.equal((await inspectDispute(store,a,alias,'是否同源？')).status,'PENDING_T1_VERIFICATION');await writeFile(join(dir,'b.txt'),'文件被替换');assert.equal((await inspectDispute(store,a,b,'复核出处？')).status,'REJECTED');
});
test('脚注循环、缺源、无审阅的自称一级来源均不提升',()=>{const entry=(to:string):CatalogEntry=>({kind:'review',source:'fixture',bibliographic_id:'fixture',review_basis:'测试',references:[{to,locator:'1',excerpt:'engineering only'}]});const catalog=new Map([['a',entry('b')],['b',entry('a')],['c',entry('missing')]]);assert.equal(chase(catalog,'a').status,'PENDING_T1_VERIFICATION');assert.deepEqual(chase(catalog,'c').unresolved,['missing']);assert.equal(classification({...entry('a'),kind:'primary'}).tier,'T3_GENERAL_ENCYCLOPEDIA');assert.equal(classification(entry('a')).tier,'T2_SECONDARY_SCHOLARLY_OR_CURATED');});
