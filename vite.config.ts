import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Only the two inference endpoints are exposed, never model pulls or deletion.
// Each laptop runs its own Vite/preview server and its own Ollama runtime.
const ollama = new URL(process.env.SYMPHONY_OLLAMA_URL || 'http://127.0.0.1:11434');
if (!['localhost', '127.0.0.1', '[::1]'].includes(ollama.hostname)) throw new Error('Ollama must run on this computer.');
const proxy = {
  '^/api/local-llm/(chat|tags)$': {
    target: ollama.origin,
    changeOrigin: true,
    rewrite: (path: string) => path.replace('/api/local-llm', '/api'),
  },
};
export default defineConfig({ plugins: [react()], server: { proxy }, preview: { proxy } });
