/** Finite, resumable Meshy batch. One invocation polls/submits up to three remote jobs.
 * Paid submissions are sequential; server-side jobs may run concurrently.
 * A submission with an uncertain outcome is never silently repeated.
 */
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { parse } from 'dotenv';

const root = resolve(import.meta.dirname, '..');
const privateDir = resolve(root, '.local/roster');
await mkdir(privateDir, { recursive: true, mode: 0o700 });
const catalog = JSON.parse(await readFile(resolve(root, 'assets-source/roster.json'), 'utf8')).filter(c => c.id !== 'yot');
const statePath = resolve(privateDir, 'production.json');
let state;
try { state = JSON.parse(await readFile(statePath, 'utf8')); }
catch (e) {
  if (e.code !== 'ENOENT') throw e;
  state = { started: new Date().toISOString(), expectedCredits: 880, budgetLimit: 1000,
    characters: Object.fromEntries(catalog.map(c => [c.id, { tasks: {} }])) };
}
const save = () => writeFile(statePath, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
function summary() {
  return { expectedCredits: state.expectedCredits,
    consumedCredits: Object.values(state.characters).flatMap(c => Object.values(c.tasks)).reduce((sum, t) => sum + (t.credits || 0), 0),
    characters: Object.fromEntries(Object.entries(state.characters).map(([id,c]) => [id, Object.fromEntries(Object.entries(c.tasks).map(([stage,t]) => [stage, { status: t.status, progress: t.progress, task: t.id }]))])) };
}
if (process.argv.includes('--status')) { console.log(JSON.stringify(summary())); process.exit(0); }
if (process.argv.includes('--review')) {
  const at = process.argv.indexOf('--review'), stage = process.argv[at + 1];
  if (!['reference','model'].includes(stage)) throw new Error('Review stage must be reference or model');
  for (const id of process.argv.slice(at + 2)) {
    if (!state.characters[id]?.tasks[stage]?.downloaded) throw new Error(`Review asset is not downloaded: ${id}/${stage}`);
    await mkdir(resolve(privateDir,'reviewed'),{recursive:true});
    await writeFile(resolve(privateDir,'reviewed',`${id}-${stage}.json`),JSON.stringify({taskId:state.characters[id].tasks[stage].id,reviewedAt:new Date().toISOString()}),{mode:0o600});
  }
  console.log('Recorded local visual review'); process.exit(0);
}
const credential = parse(await readFile(resolve(homedir(), '.config/opencode/meshy.env'), 'utf8')).MESHY_API_KEY;
if (!credential) throw new Error('The existing local Meshy credential is missing.');
const redact = value => String(value).split(credential).join('[REDACTED]').replace(/https?:\/\/[^\s"<>]+/g, '[private asset URL]');
const transport = new StdioClientTransport({ command: process.execPath,
  args: [resolve(homedir(), '.npm/_npx/99acfca233c64631/node_modules/@meshy-ai/meshy-mcp-server/dist/index.js')],
  cwd: homedir(), stderr: 'pipe',
  env: { ...process.env, MESHY_API_KEY: credential, TRANSPORT: 'stdio', DOTENV_CONFIG_QUIET: 'true', MESHY_CLIENT: 'chog-roster/0.2.0' },
});
const client = new Client({ name: 'chog-roster-production', version: '0.2.0' });
const timeout = setTimeout(async () => { await transport.close(); process.exitCode = 124; }, 160000);
async function call(name, args) {
  const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 30000 });
  if (result.isError) throw new Error(result.content?.filter(c => c.type === 'text').map(c => c.text).join('\n') || 'Meshy returned an error');
  if (result.structuredContent) return result.structuredContent;
  const text = result.content?.find(c => c.type === 'text')?.text;
  if (!text) throw new Error('Meshy response has no structured task data');
  return JSON.parse(text);
}
async function download(url, file) {
  if (!url) throw new Error('The completed Meshy task is missing its asset URL');
  const response = await fetch(url, { signal: AbortSignal.timeout(45000) });
  if (!response.ok) throw new Error(`Asset download HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length || buffer.length > 80 * 1024 * 1024) throw new Error('Unexpected asset download size');
  await mkdir(dirname(file), { recursive: true }); await writeFile(file, buffer);
}
const stages = [
  { key: 'reference', type: 'image-to-image', tool: 'meshy_image_to_image', cost: 6, needs: [] },
  { key: 'model', type: 'image-to-3d', tool: 'meshy_image_to_3d', cost: 30, needs: ['reference'] },
  { key: 'rig', type: 'rigging', tool: 'meshy_rig', cost: 5, needs: ['model'] },
  { key: 'motion-a', type: 'animation', tool: 'meshy_animate', cost: 30, needs: ['rig'] },
  { key: 'motion-b', type: 'animation', tool: 'meshy_animate', cost: 9, needs: ['rig'] },
];
function argumentsFor(character, stage, tasks, referenceOverride) {
  const common = { response_format: 'json' };
  if (stage === 'reference') return { ...common, ai_model: 'nano-banana-2',
    reference_file_paths: [resolve(root, `assets-source/${character.id}/reference.png`)],
    prompt: `Create one clean full-body front view 3D game character reference of exactly this ${character.name} CHOG mascot. Preserve the original identity and this design: ${character.design} Neutral symmetrical T-pose, both arms straight out at shoulder height, palms down, empty mitten hands, both feet apart flat on the ground, clearly separated arms, armpits and legs. ONE humanoid biped only. No handheld items, no other characters or animals, no text except the specified clothing text. Clean matte stylized cartoon game toy, spiked mascot hood and a flat ivory cartoon face with simple flat black oval eyes, no realistic eyes or teeth, no human skin or realistic human face. A clearly separated torso, elbows, hips, knees, feet. Entire body and hands visible, centered with margin, plain light gray background.`,
    aspect_ratio: '1:1', generate_multi_view: false, remove_background: false };
  if (stage === 'model') return { ...common, ...(referenceOverride ? { file_path: resolve(root,referenceOverride) } : { input_task_id: tasks.reference.id }), ai_model: 'meshy-7.1', model_type: 'standard',
    pose_mode: 't-pose', enable_pbr: false, topology: 'triangle', target_polycount: 15000,
    should_remesh: true, should_texture: true, texture_resolution: '2k', image_enhancement: false,
    texture_prompt: `${character.name} CHOG mascot. Preserve the reference's exact costume, spiked hood, flat black cartoon eyes and clean matte toy colors. ${character.design}`.slice(0,800),
    target_formats: ['glb'], origin_at: 'bottom', multi_view_thumbnails: true };
  if (stage === 'rig') return { ...common, input_task_id: tasks.model.id, height_meters: character.height };
  return { ...common, rig_task_id: tasks.rig.id,
    action_ids: stage === 'motion-a' ? [89,688,689,694,191,125,127,178,187,8] : [344,156,86] };
}
async function finish(character, stage, task, data) {
  const dir = resolve(root, 'assets-source', character.id);
  if (stage.key === 'reference') await download(data.image_urls?.[0], resolve(dir, 'tpose.png'));
  if (stage.key === 'model') {
    await download(data.model_urls?.glb, resolve(dir, 'raw.glb'));
    if (data.thumbnail_url) await download(data.thumbnail_url, resolve(dir, 'model-preview.png'));
  }
  if (stage.key === 'rig') {
    await download(data.result?.rigged_character_glb_url, resolve(dir, 'rig.glb'));
    await download(data.result?.basic_animations?.running_glb_url, resolve(dir, 'run.glb'));
  }
  if (stage.type === 'animation') await download(data.result?.animation_glb_url, resolve(dir, stage.key + '.glb'));
  task.downloaded = true;
  await save();
  const provenance = { character: character.name, provider: 'Meshy official MCP 0.6.5', created_on: state.started.slice(0,10),
    reference_source: `Metropolis/game/chog-clash/assets/chog/reference/${character.id}.png`,
    tasks: Object.entries(state.characters[character.id].tasks).map(([name,t]) => ({ stage: name, task_id: t.id,
      status: t.status, consumed_credits: t.credits || 0, options: t.options })),
    total_credits: Object.values(state.characters[character.id].tasks).reduce((sum,t) => sum + (t.credits || 0),0),
    runtime_processing: 'tools/build_assets.py', secrets: 'API credential and signed asset URLs excluded.' };
  await writeFile(resolve(dir, 'provenance.json'), JSON.stringify(provenance,null,2)+'\n');
}
try {
  await client.connect(transport);
  for(const character of catalog) for(const stage of ['reference','model']) {
    try {const review=JSON.parse(await readFile(resolve(privateDir,'reviewed',`${character.id}-${stage}.json`),'utf8'));
      if(review.taskId===state.characters[character.id].tasks[stage]?.id)state.characters[character.id][stage+'Reviewed']=true;
    }catch(e){if(e.code!=='ENOENT')throw e;}
  }
  // The IDs are the previously tested Yot set; resolve them again before paid animation use.
  if (!state.actionsVerified) {
    const data = await call('meshy_list_animations', { action_ids: [89,688,689,694,191,125,127,178,187,8,344,156,86], response_format: 'json' });
    await writeFile(resolve(privateDir,'animation-catalog.json'),JSON.stringify(data,null,2)+'\n',{mode:0o600});
    const serialized = JSON.stringify(data);
    for (const id of [89,688,689,694,191,125,127,178,187,8,344,156,86]) {
      if (!new RegExp('"action_id"\\s*:\\s*'+id+'\\b').test(serialized)) throw new Error(`Animation ${id} is no longer available`);
    }
    state.actionsVerified = true; await save();
  }
  for (const character of catalog) {
    const record = state.characters[character.id];
    await mkdir(resolve(root,'assets-source',character.id),{recursive:true});
    await copyFile(resolve(root,'../Hackathon/Metropolis/game/chog-clash/assets/chog/reference',character.id+'.png'),
      resolve(root,'assets-source',character.id,'reference.png'));
    for (const stage of stages) {
      const task = record.tasks[stage.key];
      if (!task?.id || task.downloaded || task.status === 'FAILED' || task.status === 'CANCELED') continue;
      const data = await call('meshy_get_task_status', { task_id: task.id, task_type: stage.type, wait: false, response_format:'json' });
      await writeFile(resolve(privateDir,`${character.id}-${stage.key}-status.json`),JSON.stringify(data,null,2)+'\n',{mode:0o600});
      task.status = data.status; task.progress = data.progress; task.credits = data.consumed_credits || 0; await save();
      if (data.status === 'SUCCEEDED') {
        try{await finish(character,stage,task,data);}catch(error){throw new Error(`${character.id}/${stage.key}: ${error.message}`);}
      }
      console.log(JSON.stringify({character:character.id,stage:stage.key,status:task.status,progress:task.progress}));
    }
  }
  const allTasks = () => Object.values(state.characters).flatMap(c => Object.values(c.tasks));
  let active = allTasks().filter(t => t.id && !['SUCCEEDED','FAILED','CANCELED'].includes(t.status)).length;
  for (const character of catalog) for (const stage of stages) {
    if (active >= 3) break;
    const record = state.characters[character.id];
    if (record.tasks[stage.key] || !stage.needs.every(n => record.tasks[n]?.downloaded)) continue;
    if (stage.key === 'model' && !record.referenceReviewed) continue;
    if (stage.key === 'rig' && !record.modelReviewed) continue;
    const reserved = allTasks().reduce((sum,t) => sum + (t.expectedCredits || 0),0);
    if (reserved + stage.cost > state.budgetLimit) throw new Error('The roster credit budget is reached; no additional paid job was submitted.');
    const args = argumentsFor(character,stage.key,record.tasks,record.referenceOverride);
    record.tasks[stage.key] = { status:'SUBMITTING', expectedCredits:stage.cost, options:args, submitted:new Date().toISOString() }; await save();
    try {
      const data = await call(stage.tool,args);
      if (!data.task_id) throw new Error('Submission outcome uncertain: no task id in response');
      Object.assign(record.tasks[stage.key],{id:data.task_id,status:data.status || 'PENDING'}); active++; await save();
      console.log(JSON.stringify({character:character.id,stage:stage.key,status:data.status,task:data.task_id,expectedCredits:stage.cost}));
    } catch (e) {
      record.tasks[stage.key].error = redact(e.message); await save(); throw e;
    }
  }
  console.log(JSON.stringify({consumedCredits:summary().consumedCredits,expectedCredits:state.expectedCredits,
    complete:catalog.filter(c=>stages.every(s=>state.characters[c.id].tasks[s.key]?.downloaded)).map(c=>c.id),
    awaitingReferenceReview:catalog.filter(c=>state.characters[c.id].tasks.reference?.downloaded&&!state.characters[c.id].referenceReviewed).map(c=>c.id),
    awaitingModelReview:catalog.filter(c=>state.characters[c.id].tasks.model?.downloaded&&!state.characters[c.id].modelReviewed).map(c=>c.id)}));
} catch (e) { console.error(redact(e.message)); process.exitCode = 1; }
finally { await client.close(); await transport.close(); clearTimeout(timeout); }
