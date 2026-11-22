import type {CredibilityTier} from '@historical-cartography/shared-schema';
// Entries come only from the operator's version-controlled catalogue, never from tool arguments.
export interface CatalogEntry {kind:'primary'|'scholarship'|'review'|'encyclopedia'|'unverified'; source:string; bibliographic_id:string; review_basis?:string; reviewed_sha256?:string; references?:Array<{to:string; locator:string; excerpt:string}>;}
export function classification(e:CatalogEntry):{tier:CredibilityTier; reason:string}{
  if(!e.source?.trim() || !e.bibliographic_id?.trim() || e.kind==='unverified')return {tier:'REJECTED_UNVERIFIED',reason:'无可定位来源或已拒绝'};
  if(['primary','scholarship'].includes(e.kind) && e.review_basis?.trim() && /^[a-f0-9]{64}$/.test(e.reviewed_sha256??''))return {tier:'T1_PRIMARY_AND_LOCAL_ACADEMIC',reason:'仅适用于已审阅的固定版本；具体引文仍须核验'};
  if(e.kind==='review' && e.review_basis?.trim() && e.references?.some(r=>r.to && r.locator && r.excerpt))return {tier:'T2_SECONDARY_SCHOLARLY_OR_CURATED',reason:'有审阅依据与可核对的脚注，仅作辅助'};
  return {tier:'T3_GENERAL_ENCYCLOPEDIA',reason:'仅供检索线索，需追溯一级来源'};
}
export function chase(entries:ReadonlyMap<string,CatalogEntry>, start:string){
  const queue=[start], seen=new Set<string>(), edges:Array<{from:string;to:string;locator:string;excerpt:string}>=[],primary:string[]=[],unresolved:string[]=[];
  while(queue.length){const id=queue.shift()!;if(seen.has(id))continue;seen.add(id);const e=entries.get(id);if(!e){unresolved.push(id);continue;}
    const {tier}=classification(e);if(tier==='REJECTED_UNVERIFIED'){unresolved.push(id);continue;}if(tier==='T1_PRIMARY_AND_LOCAL_ACADEMIC'){primary.push(id);continue;}
    const refs=(e.references??[]).filter(r=>r.to.trim()&&r.locator.trim()&&r.excerpt.trim());if(!refs.length)unresolved.push(id);
    for(const r of refs){edges.push({from:id,...r});if(!seen.has(r.to))queue.push(r.to);}
  }
  return {start,edges,primary_candidates:primary,unresolved,visited:[...seen],status:primary.length?'PRIMARY_LOCATED_NOT_QUOTE_VERIFIED':'PENDING_T1_VERIFICATION'};
}
