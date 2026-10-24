/** Finite local MCP client. Credentials are read locally and never printed. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { parse } from 'dotenv';

const [tool, ...flags] = process.argv.slice(2);
const option = (name) => { const i = flags.indexOf(name); return i < 0 ? null : flags[i + 1]; };
if (!tool) throw new Error('Usage: node tools/meshy.mjs TOOL [--args-file FILE] [--output FILE]');
const credentials = parse(await readFile(resolve(homedir(), '.config/opencode/meshy.env')));
if (!credentials.MESHY_API_KEY) throw new Error('Local Meshy credential is missing.');
const cached = resolve(homedir(), '.npm/_npx/99acfca233c64631/node_modules/@meshy-ai/meshy-mcp-server/dist/index.js');
const transport = new StdioClientTransport({
  command: process.execPath, args: [cached], cwd: homedir(), stderr: 'pipe',
  env: { ...process.env, MESHY_API_KEY: credentials.MESHY_API_KEY,
    MESHY_CLIENT: 'chog-clash-arena-lab/0.1.0', TRANSPORT: 'stdio', DOTENV_CONFIG_QUIET: 'true' }
});
const client = new Client({ name: 'chog-clash-arena-lab', version: '0.1.0' });
const timer = setTimeout(async () => { await transport.close(); process.exit(124); }, 59000);
const safe = (s) => String(s).split(credentials.MESHY_API_KEY).join('[REDACTED]');
try {
  await client.connect(transport);
  let result;
  if (tool === '--schema') {
    const list = await client.listTools();
    result = list.tools.filter(t => flags.includes(t.name));
  } else {
    const file = option('--args-file');
    const args = file ? JSON.parse(await readFile(file, 'utf8')) : {};
    result = await client.callTool({ name: tool, arguments: args }, undefined, { timeout: 55000 });
  }
  const output = option('--output');
  if (output) { await mkdir(dirname(resolve(output)), { recursive: true }); await writeFile(output, safe(JSON.stringify(result, null, 2)) + '\n', { mode: 0o600 }); }
  if (tool === '--schema') console.log(safe(JSON.stringify(result)));
  else {
    let data = result.structuredContent;
    if (!data) { try { data = JSON.parse(result.content?.find(c => c.type === 'text')?.text || '{}'); } catch { data = {}; } }
    const summary = { tool, isError: !!result.isError, output,
      ...Object.fromEntries(Object.entries(data || {}).filter(([k, v]) => /task_id|status|progress|balance|credits|path|message|estimated_time/.test(k) && (typeof v !== 'object'))) };
    if (result.isError || !Object.keys(data || {}).length) summary.text = safe(result.content?.filter(c => c.type === 'text').map(c => c.text).join('\n')).slice(0, 6000);
    console.log(safe(JSON.stringify(summary)));
    if (result.isError) process.exitCode = 1;
  }
} catch (error) { console.error(safe(error.message)); process.exitCode = 1; }
finally { await client.close(); await transport.close(); clearTimeout(timer); }
