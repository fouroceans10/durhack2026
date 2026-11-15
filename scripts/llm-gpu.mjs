import { execFileSync } from 'node:child_process';

// Explicit selections take precedence, including empty values that hide devices.
const selectionVariables = [
  'CUDA_VISIBLE_DEVICES', 'HIP_VISIBLE_DEVICES', 'ROCR_VISIBLE_DEVICES',
  'GPU_DEVICE_ORDINAL', 'OLLAMA_LLM_LIBRARY', 'OLLAMA_VULKAN', 'GGML_VK_VISIBLE_DEVICES',
];

export function configureGpu(env = process.env, probe = execFileSync, platform = process.platform) {
  const inherited = selectionVariables.filter(key => env[key] !== undefined);
  if (inherited.length) {
    return { env: { ...env }, message: `Using existing GPU settings (${inherited.join(', ')}); Ollama will select the backend.` };
  }

  // Apple GPUs use Metal. On other systems, a failed/missing NVIDIA utility must
  // not prevent Ollama from discovering ROCm (or falling back to CPU) itself.
  if (platform === 'linux' || platform === 'win32') {
    try {
      const output = probe('nvidia-smi', ['--query-gpu=name', '--format=csv,noheader'], {
        env, encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'],
      });
      const names = output.trim().split(/\r?\n/).filter(Boolean);
      if (names.length) {
        return {
          // Prefer CUDA on mixed NVIDIA/AMD machines. Let Ollama choose its
          // compatible CUDA library and layer allocation; never pin a version.
          env: { ...env, ROCR_VISIBLE_DEVICES: '-1', HIP_VISIBLE_DEVICES: '-1', OLLAMA_VULKAN: '0' },
          message: `NVIDIA GPU detected (${names.join(', ')}); preferring CUDA. Run npm run test:gpu to verify offloading.`,
        };
      }
    } catch {
      // nvidia-smi may be absent, time out, or fail when a driver is unavailable.
    }
  }

  return { env: { ...env }, message: 'Using Ollama GPU auto-detection (CUDA, ROCm or Metal where available; CPU fallback).' };
}
