import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { MAX_CLIP_BYTES } from './motif-extraction';
import { recordingError, startVoiceRecording } from './motif-recording';

function microphone(t: TestContext, supported = 'audio/webm;codecs=opus') {
  class Track extends EventTarget { stopped = false; stop() { this.stopped = true; } }
  const track = new Track(), stream = { getTracks: () => [track] };
  const requests: MediaStreamConstraints[] = [];
  const devices = { getUserMedia: async (constraints: MediaStreamConstraints) => { requests.push(constraints); return stream as unknown as MediaStream; } };
  class Recorder {
    static instances: Recorder[] = [];
    static isTypeSupported(type: string) { return type === supported; }
    state = 'inactive'; mimeType: string; chunks = [new Blob(['recorded voice'], { type: supported || 'audio/webm' })];
    ondataavailable: ((event: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(_stream: MediaStream, public options?: MediaRecorderOptions) {
      this.mimeType = options?.mimeType || 'audio/webm'; Recorder.instances.push(this);
    }
    start() { this.state = 'recording'; }
    stop() {
      this.state = 'inactive';
      queueMicrotask(() => { this.chunks.forEach(data => this.ondataavailable?.({ data })); this.onstop?.(); });
    }
  }
  for (const [key, value] of Object.entries({ isSecureContext: true, navigator: { mediaDevices: devices }, MediaRecorder: Recorder })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, configurable: true });
    t.after(() => { if (previous) Object.defineProperty(globalThis, key, previous); else Reflect.deleteProperty(globalThis, key); });
  }
  return { track, stream, requests, devices, Recorder };
}

test('stopping captures the final audio chunk and releases the microphone immediately', async t => {
  const { track, requests, Recorder } = microphone(t);
  const capture = await startVoiceRecording(new AbortController().signal, () => {});
  assert.equal(requests.length, 1); assert.equal(requests[0].video, false);
  assert.equal((requests[0].audio as MediaTrackConstraints).noiseSuppression, false);
  assert.equal(Recorder.instances[0].options?.mimeType, 'audio/webm;codecs=opus');
  assert.equal(track.stopped, false);
  capture.stop(); capture.stop();
  assert.equal(track.stopped, true);
  const file = await capture.result;
  assert.equal(file.name, 'Voice motif.webm'); assert.equal(await file.text(), 'recorded voice');
});

test('recording chooses MP4 when WebM/Opus is unsupported', async t => {
  const { Recorder } = microphone(t, 'audio/mp4');
  const capture = await startVoiceRecording(new AbortController().signal, () => {});
  capture.stop();
  const file = await capture.result;
  assert.equal(file.type, 'audio/mp4'); assert.equal(file.name, 'Voice motif.m4a');
  assert.equal(Recorder.instances[0].options?.mimeType, 'audio/mp4');
});

test('cancel discards audio and releases every microphone resource', async t => {
  const { track, Recorder } = microphone(t);
  const controller = new AbortController();
  const capture = await startVoiceRecording(controller.signal, () => {});
  const rejected = assert.rejects(capture.result, { name: 'AbortError' });
  controller.abort(); await rejected;
  assert.equal(track.stopped, true); assert.equal(Recorder.instances[0].state, 'inactive');
  assert.equal(Recorder.instances[0].ondataavailable, null);
});

test('a microphone granted after cancellation is released without recording', async t => {
  const { devices, stream, track, Recorder } = microphone(t);
  let grant!: (stream: MediaStream) => void;
  devices.getUserMedia = () => new Promise(resolve => { grant = resolve; });
  const controller = new AbortController();
  const pending = startVoiceRecording(controller.signal, () => assert.fail('Cancelled recordings must not start.'));
  controller.abort(); grant(stream as unknown as MediaStream);
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(track.stopped, true); assert.equal(Recorder.instances.length, 0);
});

test('recording automatically stops within the clip duration limit', async t => {
  const { track } = microphone(t);
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const capture = await startVoiceRecording(new AbortController().signal, () => {});
  t.mock.timers.tick(29750);
  assert.equal(track.stopped, true);
  assert.ok((await capture.result).size > 0);
});

test('recorder failure and a disconnected microphone release the stream', async t => {
  const { track, Recorder } = microphone(t);
  const capture = await startVoiceRecording(new AbortController().signal, () => {});
  const rejected = assert.rejects(capture.result, /recording failed/);
  Recorder.instances[0].onerror?.(); await rejected;
  assert.equal(track.stopped, true);
  const second = await startVoiceRecording(new AbortController().signal, () => {});
  const disconnected = assert.rejects(second.result, /disconnected/);
  track.dispatchEvent(new Event('ended')); await disconnected;
});

test('empty and oversized recordings fail without leaving the microphone on', async t => {
  const { Recorder, track } = microphone(t);
  for (const large of [false, true]) {
    const capture = await startVoiceRecording(new AbortController().signal, () => {});
    Recorder.instances.at(-1)!.chunks = large ? [new Blob([new Uint8Array(MAX_CLIP_BYTES + 1)])] : [];
    const rejected = assert.rejects(capture.result, large ? /too large/ : /No audio/);
    capture.stop(); await rejected;
    assert.equal(track.stopped, true);
  }
});

test('permission errors and unsupported environments give actionable messages', async t => {
  const { devices, Recorder } = microphone(t);
  devices.getUserMedia = async () => { throw new DOMException('Denied', 'NotAllowedError'); };
  await assert.rejects(startVoiceRecording(new AbortController().signal, () => {}), { name: 'NotAllowedError' });
  assert.match(recordingError(new DOMException('Denied', 'NotAllowedError')), /site settings/);
  assert.match(recordingError(new DOMException('Missing', 'NotFoundError')), /No microphone/);
  assert.equal(Recorder.instances.length, 0);
  Object.defineProperty(globalThis, 'isSecureContext', { value: false, configurable: true });
  await assert.rejects(startVoiceRecording(new AbortController().signal, () => {}), /localhost or HTTPS/);
});

test('a recorder that fails to initialize still releases its microphone', async t => {
  const { Recorder, track } = microphone(t);
  t.mock.method(Recorder.prototype, 'start', () => { throw new Error('Codec unavailable'); });
  const capture = await startVoiceRecording(new AbortController().signal, () => {});
  await assert.rejects(capture.result, /Codec unavailable/);
  assert.equal(track.stopped, true);
});
