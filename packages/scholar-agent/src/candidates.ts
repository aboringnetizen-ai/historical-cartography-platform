import type { EvidenceCitation } from '@historical-cartography/shared-schema';
import { EvidenceStore } from './evidence.ts';

export type Dimension = 'POLITY_BOUNDARY' | 'CONTROL' | 'ADMIN_AND_SEAT' | 'ADMIN_EVOLUTION' | 'TOPONYM';
const dimensions:readonly Dimension[]=['POLITY_BOUNDARY','CONTROL','ADMIN_AND_SEAT','ADMIN_EVOLUTION','TOPONYM'];
export interface ResearchClaim {
  id:string; dimension:Dimension; subject:string; epoch:string;
  proposition:string; // Human-readable assertion. Never derive contradictions from text inequality.
  citations:Array<{evidence:EvidenceCitation; index_revision:string}>;
}
export async function inspectClaim(store:EvidenceStore,input:ResearchClaim){
  const claim=structuredClone(input);
  if(!dimensions.includes(claim.dimension)||![claim.id,claim.subject,claim.epoch,claim.proposition].every(v=>typeof v==='string'&&v.trim())||!Array.isArray(claim.citations)||!claim.citations.length)throw Error('候选必须含考证维度、对象、时间范围、命题和引文');
  const results=await Promise.all(claim.citations.map(c=>store.verifyCitation(c.evidence,c.index_revision)));
  const status=results.some(r=>r.status==='REJECTED')?'REJECTED':results.some(r=>r.status==='CANDIDATE')?'PENDING_T1_VERIFICATION':'QUOTES_VERIFIED';
  return {claim,results,status};
}
export async function inspectDispute(store:EvidenceStore,left:ResearchClaim,right:ResearchClaim,question:string){
  if(!question.trim()||left.id===right.id||left.dimension!==right.dimension||left.subject!==right.subject||left.epoch!==right.epoch||left.proposition.trim()===right.proposition.trim())throw Error('分歧必须指向同维度、同对象、同时段的不同命题，并给出待裁决问题');
  const [a,b]=await Promise.all([inspectClaim(store,left),inspectClaim(store,right)]);
  const sameWitness=a.results.some(l=>l.status!=='REJECTED' && b.results.some(r=>r.status!=='REJECTED' && (r.source_sha256===l.source_sha256 || r.citation.source_doc_id===l.citation.source_doc_id)));
  const status=a.status==='REJECTED'||b.status==='REJECTED'?'REJECTED':sameWitness||a.status!=='QUOTES_VERIFIED'||b.status!=='QUOTES_VERIFIED'?'PENDING_T1_VERIFICATION':'T1_SCHOLARLY_DISPUTE';
  return {status,question,left:a,right:b,requires_human:true,authorizes_spatial_write:false};
}
