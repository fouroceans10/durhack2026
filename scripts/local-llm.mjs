import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const local = resolve(root, '.local/ollama/bin/ollama');
const executable = existsSync(local) ? local : 'ollama';
const action = process.argv[2] || 'serve';
if (!['serve', 'pull', 'ps'].includes(action)) throw new Error('Use serve, pull or ps.');
const model = process.argv[3] || 'qwen3:1.7b';
if (action === 'pull' && /cloud/i.test(model)) throw new Error('Choose a local model, not a cloud alias.');
const child = spawn(executable, action === 'pull' ? ['pull', model] : [action], {
  cwd: root, stdio: 'inherit',
  env: { ...process.env, OLLAMA_HOST: '127.0.0.1:11434', OLLAMA_NO_CLOUD: '1',
    OLLAMA_NUM_PARALLEL: process.env.OLLAMA_NUM_PARALLEL || '4', OLLAMA_MODELS: process.env.OLLAMA_MODELS || resolve(root, '.local/models') },
});
child.on('error', error => { console.error(`Cannot launch Ollama: ${error.message}. Install from https://ollama.com/download first.`); process.exitCode = 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
