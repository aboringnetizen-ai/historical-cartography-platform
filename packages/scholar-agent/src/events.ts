import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { createHistoricalTimestamp } from "@historical-cartography/shared-schema";
import type { HistoricalEvent, EventEvidenceReader, EventEvidenceRequest, EventEvidenceResult, GateIssue, VerifiedCitation } from "@historical-cartography/shared-schema";
import { EvidenceStore } from "./evidence.ts";

type Bound = {event: HistoricalEvent; pins: Record<string,string>};
const tiers = ["T1_PRIMARY_AND_LOCAL_ACADEMIC", "T2_SECONDARY_SCHOLARLY_OR_CURATED", "T3_GENERAL_ENCYCLOPEDIA"] as const;
const categories = new Set(["WAR_BATTLE","FOUNDING","TERRITORY_TRANSFER","ADMIN_REFORM","TREATY","OTHER"]);
function validate(e: HistoricalEvent) {
  if (![e.hist_event_id,e.title,e.summary,e.spatial_impact_description].every(s => typeof s === "string" && s.trim()) || !categories.has(e.event_category) || !["CONSENSUS","PENDING_T1_VERIFICATION","T1_SCHOLARLY_DISPUTE"].includes(e.conflict_status)) throw Error("无效事件字段");
  for (const a of [e.involved_polity_ids,e.involved_figure_ids,e.involved_toponym_ids]) if (!Array.isArray(a) || !a.every(s => typeof s === "string" && s.trim())) throw Error("无效实体引用");
  for (const t of [e.time_start,...(e.time_end ? [e.time_end] : [])]) {
    const calculated = createHistoricalTimestamp(t);
    if (calculated.julian_day_number !== t.julian_day_number || calculated.historical_year_display !== t.historical_year_display) throw Error("纪年与 JDN 不符");
  }
  if (e.time_end && e.time_start.julian_day_number > e.time_end.julian_day_number) throw Error("结束时间早于起点");
  if (!Array.isArray(e.citations) || !e.citations.length || new Set(e.citations.map(c=>c.citation_id)).size !== e.citations.length || e.citations.some(c=>!tiers.includes(c.credibility_tier))) throw Error("必须绑定有效且唯一的引文");
}
function issue(id:string, code:GateIssue["code"], message:string): GateIssue {return {gate:code === "T1_SCHOLARLY_DISPUTE" ? "G4" : "G3",entity_id:id,code,message};}
/** Local trusted repository. It records research events, never grants spatial commit permission. */
export class ScholarEvents implements EventEvidenceReader {
  #db:DatabaseSync; #store:EvidenceStore;
  constructor(path:string, store:EvidenceStore) {
    this.#store=store; this.#db=new DatabaseSync(path);
    this.#db.exec(`PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS scholar_events(id TEXT NOT NULL, rev TEXT PRIMARY KEY, parent TEXT, body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS scholar_heads(id TEXT PRIMARY KEY, rev TEXT NOT NULL REFERENCES scholar_events(rev));`);
  }
  close(){this.#db.close();}
  #head(id:string) {return this.#db.prepare("SELECT rev FROM scholar_heads WHERE id=?").get(id)?.rev as string|undefined;}
  async #check(bound:Bound, revision:string):Promise<EventEvidenceResult> {
    const {event:e,pins}=bound, pending:GateIssue[]=[], rejected:GateIssue[]=[], verified:VerifiedCitation[]=[];
    for(const c of e.citations){
      const r=await this.#store.verifyCitation(c,pins[c.source_doc_id] ?? "");
      if(r.status === "REJECTED") rejected.push(...r.issues);
      else {verified.push(r.citation); if(r.status === "CANDIDATE") pending.push(...r.issues);}
    }
    if(e.conflict_status === "T1_SCHOLARLY_DISPUTE") pending.push(issue(e.hist_event_id,"T1_SCHOLARLY_DISPUTE","同级分歧需人工裁决"));
    if(e.conflict_status === "PENDING_T1_VERIFICATION") pending.push(issue(e.hist_event_id,"PENDING_T1_VERIFICATION","一级证据尚待复核"));
    if(rejected.length || pending.length) return {status:rejected.length?"REJECTED":"PENDING_REVIEW",hist_event_id:e.hist_event_id,issues:[...rejected,...pending]};
    return {status:"VERIFIED",event_revision:revision,event:{...e,citations:verified.map(c=>c.evidence)},verified_citations:verified};
  }
  async register(input:HistoricalEvent, revisions:Readonly<Record<string,string>>, expectedParent:string|null=null) {
    const event=structuredClone(input); validate(event);
    event.highest_credibility_tier=tiers.find(t=>event.citations.some(c=>c.credibility_tier===t))!;
    const pins:Record<string,string>=Object.create(null);
    for(const c of event.citations){ if(!Object.hasOwn(revisions,c.source_doc_id) || !/^[a-f0-9]{64}$/.test(revisions[c.source_doc_id]!)) throw Error("缺少有效索引版本"); pins[c.source_doc_id]=revisions[c.source_doc_id]!; delete c.quote_match_score; c.verified_by_human=false; }
    const body=JSON.stringify({event,pins}), rev=createHash("sha256").update(JSON.stringify([expectedParent,body])).digest("hex");
    const result=await this.#check({event,pins},rev);
    if(result.status === "REJECTED") return {stored:false, result};
    this.#db.exec("BEGIN IMMEDIATE");
    try {const head=this.#head(event.hist_event_id);
      if(head!==rev){
        if((head??null)!==expectedParent) throw Error("父版本已过期");
        if(head){const prev=this.#db.prepare("SELECT body FROM scholar_events WHERE rev=?").get(head)!; const prior:Bound=JSON.parse(String(prev.body)); if(prior.event.conflict_status === "T1_SCHOLARLY_DISPUTE" && event.conflict_status!==prior.event.conflict_status) throw Error("不能自动解除已登记的 T1 分歧");}
        this.#db.prepare("INSERT INTO scholar_events(id,rev,parent,body) VALUES(?,?,?,?)").run(event.hist_event_id,rev,expectedParent,body);
        this.#db.prepare("INSERT INTO scholar_heads(id,rev) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET rev=excluded.rev").run(event.hist_event_id,rev);
      } this.#db.exec("COMMIT");
    } catch(e){this.#db.exec("ROLLBACK");throw e;}
    return {stored:true, event_revision:rev, result};
  }
  async verifyEvent(request:EventEvidenceRequest):Promise<EventEvidenceResult>{
    const id=request.hist_event_id,rev=this.#head(id);
    const stale=():EventEvidenceResult=>({status:"REJECTED",hist_event_id:id,issues:[issue(id,"UNVERIFIED_SOURCE","事件不存在或指定版本不再是当前版本")]});
    if(!rev || (request.event_revision!==undefined && rev!==request.event_revision)) return stale();
    const record=this.#db.prepare("SELECT body FROM scholar_events WHERE rev=? AND id=?").get(rev,id)!;
    const result=await this.#check(JSON.parse(String(record.body)),rev);
    return this.#head(id)===rev?result:stale();
  }
}
