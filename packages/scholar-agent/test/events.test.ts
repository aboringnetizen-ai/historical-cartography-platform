import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHistoricalTimestamp, type SourceDocument, type HistoricalEvent } from "@historical-cartography/shared-schema";
import { ScholarEvents } from "../src/events.ts";
import { EvidenceStore } from "../src/evidence.ts";

async function setup(t:import("node:test").TestContext, tier:HistoricalEvent["highest_credibility_tier"]="T1_PRIMARY_AND_LOCAL_ACADEMIC") {
  const dir=await mkdtemp(join(tmpdir(),"scholar-event-"));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const file=join(dir,"engineering.txt"),db=join(dir,"events.sqlite"),text="工程测试夹具，不是历史结论。\n测试句：甲。\n";
  await writeFile(file,text);
  const store=new EvidenceStore(),doc:SourceDocument={source_doc_id:"doc",title:"工程测试",authors:[],medium:"LOCAL_FILE",is_local_academic_journal:false,credibility_tier:tier,language:"zh",local_path:file,ocr_indexed:false};
  const idx=await store.indexNativeFile(doc,["i"],{file_sha256:createHash("sha256").update(text).digest("hex"),basis:"仅用于软件测试的受控审阅输入"});
  const event:HistoricalEvent={hist_event_id:"evt",title:"工程",summary:"测试",event_category:"OTHER",time_start:createHistoricalTimestamp({astronomical_year:0}),involved_polity_ids:[],involved_figure_ids:[],involved_toponym_ids:[],spatial_impact_description:"不操作地图",citations:[{citation_id:"c",source_doc_id:"doc",credibility_tier:tier,page_number:"print:i",ocr_line_range:[2,2],verbatim_quote:"测试句：甲。",verified_by_human:false}],highest_credibility_tier:tier,conflict_status:"CONSENSUS"};
  return {file,db,store,event,pins:{doc:idx.index_revision}};
}
test("达尔文航行日记第1章：实际地名、日期、原文及错引反例",async()=>{
  const store=new EvidenceStore(), tier="T1_PRIMARY_AND_LOCAL_ACADEMIC", id="pg944:ch1:159-161";
  const idx=await store.indexNativeFile({source_doc_id:id,title:"The Voyage of the Beagle",authors:["Charles Darwin"],language:"en",medium:"LOCAL_FILE",is_local_academic_journal:false,credibility_tier:tier,ocr_indexed:false,local_path:fileURLToPath(new URL("../fixtures/voyage-excerpt.txt",import.meta.url))},undefined,{file_sha256:"2b22332de5962857216b522f16821c827e9c132252a00b144864368aa1d81b3b",basis:"Published eyewitness narrative; digital transcription only. Source and blob verified in voyage-source.json."});
  const r=new ScholarEvents(":memory:",store);
  const e:HistoricalEvent={hist_event_id:"beagle-1832-01-16",event_category:"OTHER",title:"航行日记记载的停泊",summary:"作者记录于 Porto Praya 抛锚",time_start:createHistoricalTimestamp({astronomical_year:1832,month:1,day:16}),involved_polity_ids:[],involved_figure_ids:[],involved_toponym_ids:["porto-praya-as-written"],spatial_impact_description:"当时地名用例，不支持任何疆域判断",citations:[{citation_id:"excerpt",source_doc_id:id,credibility_tier:tier,volume_or_chapter:"Chapter I",page_number:"file:1",ocr_line_range:[1,3],verbatim_quote:"On the 16th of January, 1832, we anchored at Porto Praya, in St. Jago, the chief island of the Cape de Verd archipelago.",verified_by_human:false}],highest_credibility_tier:tier,conflict_status:"CONSENSUS"};
  try{const pins={[id]:idx.index_revision};assert.equal((await r.register(e,pins)).result.status,"VERIFIED"); e.citations[0]!.verbatim_quote="On the 17th of January, 1832";assert.equal((await r.register(e,pins)).result.status,"REJECTED");}finally{r.close();}
});

test("真实文件逐次复核；重启、幂等和失效父版本",async t=>{
  const {file,db,store,event,pins}=await setup(t);
  const first=new ScholarEvents(db,store);const one=await first.register(event,pins);first.close();
  const r=new ScholarEvents(db,store);try{
    assert.equal(one.result.status,"VERIFIED");assert.ok(one.event_revision);
    assert.equal((await r.register(event,pins)).event_revision,one.event_revision);
    assert.equal((await r.verifyEvent({hist_event_id:"evt",event_revision:one.event_revision})).status,"VERIFIED");
    const updated={...event,title:"第二次测试"};await assert.rejects(r.register(updated,pins),/父版本/);
    const two=await r.register(updated,pins,one.event_revision);assert.ok(two.event_revision);
    assert.equal((await r.verifyEvent({hist_event_id:"evt",event_revision:one.event_revision})).status,"REJECTED");
    await writeFile(file,"原文已换版");assert.equal((await r.verifyEvent({hist_event_id:"evt"})).status,"REJECTED");
  }finally{r.close();}
});
test("错页不落库；T1 分歧不能自动解除",async t=>{
  const {db,store,event,pins}=await setup(t);const r=new ScholarEvents(db,store);
  try {const bad=structuredClone(event);bad.citations[0]!.page_number="file:2";
    assert.equal((await r.register(bad,pins)).stored,false);
    assert.equal((await r.verifyEvent({hist_event_id:"evt"})).status,"REJECTED");
    const disputed=await r.register({...event, conflict_status:"T1_SCHOLARLY_DISPUTE"},pins);
    assert.equal(disputed.result.status,"PENDING_REVIEW");assert.ok(disputed.event_revision);
    await assert.rejects(r.register(event,pins,disputed.event_revision),/不能自动解除/);
  } finally {r.close();}
});
test("仅 T3 即使命中引文也不能升级为正式证据",async t=>{
  const {db,store,event,pins}=await setup(t,"T3_GENERAL_ENCYCLOPEDIA");const r=new ScholarEvents(db,store);
  try {const x=await r.register({...event,highest_credibility_tier:"T1_PRIMARY_AND_LOCAL_ACADEMIC"},pins);assert.equal(x.result.status,"PENDING_REVIEW");assert.equal((await r.verifyEvent({hist_event_id:"evt"})).status,"PENDING_REVIEW");}finally{r.close();}
});
