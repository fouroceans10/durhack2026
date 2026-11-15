import assert from 'node:assert/strict';
import test from 'node:test';
import { configureGpu } from './llm-gpu.mjs';

test('NVIDIA detection prefers CUDA without pinning a library or device', () => {
  const original = { PATH: '/usr/bin', OLLAMA_NUM_PARALLEL: '2', OLLAMA_MODELS: '/models' };
  const result = configureGpu(original, (command, args, options) => {
    assert.equal(command, 'nvidia-smi');
    assert.deepEqual(args, ['--query-gpu=name', '--format=csv,noheader']);
    assert.equal(options.timeout, 3000);
    assert.equal(options.env, original);
    return 'NVIDIA GeForce RTX 4060 Laptop GPU\nNVIDIA RTX A6000\n';
  }, 'linux');
  assert.deepEqual(result.env, {
    ...original, ROCR_VISIBLE_DEVICES: '-1', HIP_VISIBLE_DEVICES: '-1', OLLAMA_VULKAN: '0',
  });
  assert.match(result.message, /preferring CUDA/);
  assert.match(result.message, /RTX 4060/);
  assert.equal(original.ROCR_VISIBLE_DEVICES, undefined, 'Do not mutate the parent environment.');
});

test('Windows NVIDIA detection also prefers CUDA', () => {
  const result = configureGpu({}, () => 'NVIDIA GeForce RTX 4090\r\n', 'win32');
  assert.equal(result.env.HIP_VISIBLE_DEVICES, '-1');
  assert.match(result.message, /preferring CUDA/);
});

test('missing, broken or timed-out NVIDIA drivers leave ROCm discovery intact', () => {
  const env = { HSA_OVERRIDE_GFX_VERSION: '12.0.0', LD_LIBRARY_PATH: '/opt/rocm/lib' };
  for (const code of ['ENOENT', 'ETIMEDOUT', 'EPERM']) {
    const result = configureGpu(env, () => { throw Object.assign(new Error(code), { code }); }, 'linux');
    assert.deepEqual(result.env, env);
    assert.match(result.message, /auto-detection/);
  }
});

test('no NVIDIA devices leaves GPU detection and CPU fallback to Ollama', () => {
  for (const output of ['', '\n', '   \r\n']) {
    assert.deepEqual(configureGpu({}, () => output, 'linux').env, {});
  }
});

test('explicit device and backend selections survive even with NVIDIA present', () => {
  for (const [key, value] of Object.entries({
    CUDA_VISIBLE_DEVICES: 'GPU-selected', HIP_VISIBLE_DEVICES: '0', ROCR_VISIBLE_DEVICES: 'GPU-amd',
    GPU_DEVICE_ORDINAL: '1', OLLAMA_LLM_LIBRARY: 'rocm_v7_2',
    OLLAMA_VULKAN: '1', GGML_VK_VISIBLE_DEVICES: '0',
  })) {
    for (const selected of [value, '', '-1']) {
      const env = { [key]: selected };
      const result = configureGpu(env, () => assert.fail('Explicit settings must bypass detection.'), 'linux');
      assert.deepEqual(result.env, env);
      assert.match(result.message, /existing GPU settings/);
    }
  }
});

test('Metal is unaffected and does not probe NVIDIA', () => {
  const result = configureGpu({}, () => assert.fail('Do not probe NVIDIA on macOS.'), 'darwin');
  assert.deepEqual(result.env, {});
  assert.match(result.message, /Metal/);
});
