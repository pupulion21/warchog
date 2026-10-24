import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import validator from 'gltf-validator';

const root=resolve(import.meta.dirname,'..');
const catalog=JSON.parse(await readFile(resolve(root,'public/assets/roster.json'),'utf8'));
const reports=[];
let failed=false;
const unique=new Set(catalog.entries.map(c=>c.characterId));
if(catalog.entries.length!==13||unique.size!==12||catalog.entries.some(c=>!c.ready))throw new Error('The complete 12-fighter / 13-form roster is not ready.');
for(const entry of catalog.entries){
  const manifest=JSON.parse(await readFile(resolve(root,'public',entry.manifest.slice(1)),'utf8'));
  const raw=await readFile(resolve(root,'public',manifest.model.slice(1)));
  const hash=createHash('sha256').update(raw).digest('hex');
  const jsonLength=raw.readUInt32LE(12),doc=JSON.parse(raw.subarray(20,20+jsonLength).toString());
  const result=await validator.validateBytes(new Uint8Array(raw),{uri:entry.id+'.glb',maxIssues:50});
  const names=new Set(doc.animations.map(a=>a.name));
  const missing=Object.entries(manifest.clips).filter(([,name])=>!names.has(name)).map(([alias])=>alias);
  const joints=doc.skins[0].joints.length;
  const triangles=doc.meshes.flatMap(m=>m.primitives).reduce((sum,p)=>sum+doc.accessors[p.indices].count/3,0);
  const pass=result.issues.numErrors===0&&hash===manifest.sha256&&joints>=18&&names.size>=14&&missing.length===0&&triangles<=20000;
  failed||=!pass;
  reports.push({id:entry.id,pass,model:manifest.model,bytes:raw.length,triangles,joints,clips:[...names],missingAliases:missing,
    sha256:hash,errors:result.issues.numErrors,warnings:result.issues.messages.filter(m=>m.severity===1).map(m=>m.code)});
  console.log(`${pass?'PASS':'FAIL'} ${entry.id}: ${joints} joints / ${names.size} clips / ${triangles} triangles / ${result.issues.numErrors} glTF errors`);
}
const report={status:failed?'FAIL':'PASS',fighters:unique.size,forms:reports.length,
  uniqueModels:new Set(reports.map(r=>r.model)).size,totalUniqueModelBytes:reports.filter((r,i,a)=>a.findIndex(other=>other.model===r.model)===i).reduce((sum,r)=>sum+r.bytes,0),models:reports};
await mkdir(resolve(root,'validation'),{recursive:true});
await writeFile(resolve(root,'validation/roster-assets.json'),JSON.stringify(report,null,2)+'\n');
if(failed)process.exitCode=1;
