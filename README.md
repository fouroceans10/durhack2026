# Symphony Without a Conductor

A browser orchestra with **26 autonomous instrument agents**, local-LLM composition, deterministic Web Audio scheduling, a network-partition demonstration, and WebRTC intention exchange. React + TypeScript + Vite; a Node.js WebSocket server handles introductions only.

## Run

Use Node.js 22.12+ (or a newer supported release).

```sh
npm install
npm run dev
# In a second terminal, for peer mode:
npm run signal
```

Open the URL printed by Vite (normally http://localhost:5173). Click Start performance to unlock browser audio. The full orchestra demo hosts all 26 agents locally. Filter the roster by section, mute individual voices or entire sections, and adjust master volume.

## Recorded instrument sounds

Playback uses a bundled **389-sample, 53.1 MiB sound bank**. Strings, winds and brass use [VSCO 2 Community Edition](https://versilian-studios.com/vsco-community/) recordings, including separate staccato/spiccato takes. Grand piano, concert harp, glockenspiel and most percussion come from [VCSL](https://github.com/sgossner/VCSL). English horn and celesta use [FluidR3 renders](https://github.com/gleitz/midi-js-soundfonts). In **The players → Listen closely**, select a voice and click **Hear instrument** to audition sustained and short notes while the orchestra is paused. Motif previews use the recorded harp.

The first performance loads and decodes the relevant samples before starting any agent clocks, with visible progress. Demo mode loads the full bank; peer mode loads only the local instrument. Files are served by this app from `public/samples`, with no third-party audio requests at runtime. Successful decodes are reused for subsequent auditions and pause/resume within the page. If some files fail, a voice uses its nearest available recording; if its entire patch is unavailable, the original synthesizer remains a fallback. The player reports affected voices; pause and resume retries failed files.

Pitch follows the agent's exact MIDI note using the nearest recorded anchor. Short articulations and brief ordinary notes use recorded short takes where available, alternating takes on repeated notes. Sustained strings/winds/brass have crossfaded body loops; envelopes follow each agent's duration, velocity and articulation, preserving written rests and short notes. Plucked and struck sounds keep their recorded decay, gated at the requested note end. Stereo seating, mute and master compression apply to both sample and fallback voices.

Three patches are approximations: **bass clarinet uses clarinet recordings, contrabassoon uses bassoon, and bass trombone uses tenor trombone**. Extreme notes outside a recording's range are pitch-shifted further. Legato overlaps sustained recordings; it is not a dedicated transition-sample library. This compact bank uses one selected dynamic layer per pitch/articulation, with velocity controlling gain.

VSCO/VCSL assets are CC0; the FluidR3 renders are distributed as CC BY 3.0 US. See [sound credits](public/samples/CREDITS.txt), the included license texts and [per-file provenance](public/samples/provenance.json). To rebuild the committed assets, run `python3 scripts/build-sample-bank.py` with NumPy and SciPy installed. It downloads pinned source revisions to ignored `.local/sample-sources`, then trims, level-matches, loops and packages the selection. Python is not needed to run the app.

## Choose the opening

Each page load prepares a fresh **random motif** for the orchestra: 4–8 scale degrees in the chosen home key with a new rhythm. Click **Hear random motif** to preview it, or **Generate a new motif** to choose another and reset the performance. The generator varies melodic direction, entrances, written lengths and articulation, keeps intervals small, and prevents an identical reroll. The first two notes are at most half a beat apart, with a connected first note; later notes can still leave breathing spaces. It runs locally without waiting for inference; the individual LLM agents take over after the two-bar opening.

**Pause / Resume performance** retains the current musical state. To begin a new performance with a different opening, pause and use **Generate a new motif**, then **Start performance**. In peer mode, generating a new motif resets only the selected local instrument.

### Start from your own audio

In **A phrase of your own**, choose or drop a short MP3, WAV, or another audio format supported by your browser. Clips must be 0.25–30 seconds and at most 15 MiB. A clear solo instrument, humming, or whistle works best; this is approximate melody extraction, not polyphonic transcription of a full mix.

1. Listen to the original recording and click **Hear the motif** to preview the extracted phrase.
2. Click **Use as opening**, then **Start performance**. The pitched instruments play the phrase in their own registers for two bars; unpitched percussion keeps its own rhythmic pattern.
3. After the opening, the existing local LLM agents start developing it from the actual notes their neighbours play. If inference is unavailable, the rule-based fallback develops it instead.

The first 12 stable notes are reduced to a single 16-step bar at the starting tempo of 112 BPM. Entrances and detected note lengths are quantized, duplicate entrances removed, octaves folded, and chromatic notes fitted to the nearest note in the selected home key and mode. The original key is not inferred automatically; choose a home key before applying the phrase. Changing that selection remaps the preview from the original detected MIDI notes without decoding again. Original duration, key, articulation and octave contour are not reproduced exactly. The preview and displayed notes show the adapted phrase before you apply it.

Pause to replace or reapply a motif; doing so begins a fresh performance and clears the affected agents' previous phrases/history. **Generate a new motif** switches back from an uploaded phrase to a newly generated opening. In peer mode, an upload seeds only the selected local instrument; remote musicians learn about it through normal played-note messages.

Decoding uses the browser's [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/decodeAudioData); [Pitchy](https://github.com/ianprime0509/pitchy) detects stable pitches in a Web Worker. Analysis and previews stay in the browser, with cancellable work and no audio upload to a server. Audio files are not sent to Ollama. Only the resulting musical state enters the existing agent prompts. Clips and motifs are session-only and are cleared by a page reload.

## Movements, forms and gestures

The **A theme. A departure. A way home.** panel controls musical form, section length (4, 8, 16 or 32 bars), and gesture focus. Pause to change them. A change restarts the form from the current phrase; generating or uploading a new opening clears the remembered themes while retaining your form settings.

| Form | Route |
| --- | --- |
| Agent choice (default) | Each local model chooses ABA, ABB, pop or classical when it first composes; that choice stays fixed until the form or opening is reset. |
| ABA | Establish A, contrast with B, return to remembered A. |
| ABB | Establish A, contrast with B, repeat remembered B. |
| Pop | Intro → verse → chorus → verse → chorus → bridge → final chorus → outro. Repeated verses and choruses recall their respective themes. |
| Classical | I: Allegro, A/B exposition → development → A/B reprise; II: Adagio, ABA; III: Scherzo, ABA; IV: rondo finale, ABACA. |
| Free development | Continuous interaction without a fixed section route. |

Forms advance on **each musician's own step counter**, with no global conductor or model call controlling the ensemble. The main timeline follows the violin in demo mode and the local player in peer mode; each instrument's expanded decision row shows its own form, movement, section, gesture and theme action. Agent-selected forms may differ between players, and local clocks can drift. Presets give players the same route, not sample-accurate synchronization. Forms loop rather than ending the performance automatically.

Each agent keeps its own bounded theme library. On a section boundary, its remembered theme is introduced for one bar before new model decisions can replace it. A new contrasting theme is derived from that agent's opening when no theme has yet been remembered. Subsequent returns restore that theme. The model receives the section's intention, movement, current bar, cadence cue, remembered theme, and reachable neighbours' sections and actual played notes. It chooses whether to **develop, contrast or recall**, alongside its listening partner and musical strategy. Replies from an earlier section are discarded. Preset forms and remembered returns continue when inference is unavailable; Agent choice stays in free development until a model chooses a form.

Gestures affect actual synthesis: **arpeggios** break a triad into three timed notes; **mordents** play the main note, lower diatonic neighbour, then main note; **trills** alternate with the upper neighbour; **ostinatos** repeat a short cell; **legato/staccato** lengthen/shorten articulation. The model can choose freely, or you can select a gesture focus. Pitched ornaments are omitted for unpitched percussion. Sub-note offsets are recorded with performed notes so neighbouring agents can observe the ornamentation.

The classical preset changes target tempo, energy and default articulation across its four movements. It is a **classical-inspired arrangement**, not a complete sonata-form composition system: form-led modulation supplies related keys and a home-key recapitulation, but there is no pivot-chord planning or full harmonic analysis. All sections retain the 16-step 4/4 grid, including the scherzo. Pop forms likewise describe instrumental section roles rather than lyrics or vocals. See [Open Music Theory on formal sections](https://viva.pressbooks.pub/openmusictheory/chapter/formal-sections-in-general/) and [rondo form](https://viva.pressbooks.pub/openmusictheory/chapter/rondo/) for the distinctions behind these presets.

## Note lengths and phrasing

Agents choose **written duration and articulation for each entrance**, independently of melody and ornaments. The 4/4 bar supports semiquavers (¼ beat), quavers (½), crotchets (1), minims (2), semibreves (4), and dotted quavers/crotchets/minims. These values scale with each agent's tempo. A phrase can contain up to 16 entrances; shorter notes followed by a gap create actual rests. [Open Music Theory explains the note-value relationships](https://viva.pressbooks.pub/openmusictheory/chapter/notating-rhythm/).

The local model receives neighbours' sounding lengths and articulation, its recent choices, movement context, and rotating rhythmic suggestions. Suggestions exclude its current/recent patterns and vary by instrument and local bar; the model can choose, combine or invent an alternative. This helps the small model explore short runs, held responses, dotted rhythms and breathing spaces instead of copying an unchanging quaver stream. Theme recall preserves the remembered note lengths.

**Legato** holds through the next adjacent entrance with a small overlap; **staccato** sounds 40% of the written value; **tenuto** holds the full value; **accent** adds emphasis; ordinary articulation leaves a small separation. Written rests and bar boundaries are preserved. Each phrase can mix articulations, including within an arpeggio. Gesture focus **Legato/Staccato** overrides the individual articulations after the opening; other gestures allow mixed phrasing. Strings, winds and brass use recorded sustained and short articulations where available. Legato uses overlapping sustained samples. Plucked/percussive voices retain their natural recorded decay within the requested gate.

The **Shape of a bar** display and each instrument's expanded row show note symbols, British note names, counts, articulations and rests. Generated openings vary lengths and phrasing too; uploaded motifs estimate lengths from detected notes, without trying to infer the recording's articulation. Old peer messages without these fields remain playable using durations inferred from their entrances. Explicit tuplet notation, cross-bar ties and changing metre are not implemented.

## Keys, modes and modulation

**Choose a home. Let them wander.** selects any of the 12 tonics and major, natural minor, harmonic minor, Dorian, Phrygian, Lydian, Mixolydian or Locrian. Each page load chooses a shared random home key from major, minor, Dorian and Mixolydian. **Surprise key** changes it; generating a new motif keeps your selected key. Previews, note names, ornaments, synthesis and uploaded-motif adaptation all use that scale. Unpitched percussion keeps its timbre.

| Modulation | Behaviour |
| --- | --- |
| Stay in the home key | Every phrase uses the chosen tonic and scale. |
| Follow the form (default) | A is home; B visits the dominant in major or relative major in minor. Pop keeps verses/choruses home and moves its bridge to the relative key. Classical development visits the relative key, both reprise themes return home, Adagio uses the relative key and Scherzo the subdominant. The rondo alternates home with related-key episodes. Free development holds its key. |
| Let agents modulate | Each local LLM can stay, return home, or choose the home's dominant, subdominant, relative or parallel key. A change enters at a bar boundary, at most once per section (four bars in free development). Openings and returning sections are protected. Recalled themes restore the key saved on their first entrance. |

Degree motifs transpose into the current scale. For modal scales, the relative destination is their parent major; harmonic minor uses the natural minor's relative major. Dominant/subdominant destinations retain the home's mode. These are constrained tonal routes, not a complete functional-harmony or voice-leading system. See [Open Music Theory on modes](https://viva.pressbooks.pub/openmusictheory/chapter/diatonic-modes/) and [closely related keys](https://viva.pressbooks.pub/openmusictheory/chapter/extended-tonicization-and-modulation-to-closely-related-keys/).

Each prompt includes its own home/current key, scale notes, permitted destinations and neighbours' actual MIDI pitches and keys. A neighbour playing outside the listener's scale is mapped to its nearest degree rather than ignored. The tonal-centre display reports mixed keys when appropriate; each instrument's expanded row shows its own key. Manual controls apply to all local demo players, or only the selected local instrument in peer mode. Pause to change them; this transposes the current phrase, clears stale inference and restarts theme memory. Remote peers keep their own settings.

## Local musical intelligence

Every instrument makes **its own local LLM request**, using Ollama. The default is `qwen3:1.7b`; one set of model weights serves 26 independent agent contexts. It does not compose a global score. No cloud API or API key is used.

1. Install [Ollama](https://ollama.com/download), unless the workspace-local runtime is already present at `.local/ollama/bin/ollama`.
2. Start `npm run llm:serve` in a terminal. The launcher binds Ollama to loopback, disables cloud access, and stores downloaded models under ignored `.local/models/`. If Ollama is already running on port 11434, use that service instead.
3. In another terminal, run `npm run llm:pull` once to download `qwen3:1.7b`.
4. Run `npm run dev`, leave **Local LLM composition** enabled in Your session, and start the performance. **Check local model** verifies availability. Open an instrument's decision row to see its listening partners, response, melody and inference state.

To try another installed local model, run `npm run llm:pull -- MODEL_NAME`, click Check local model, then select it. The default [Qwen3 1.7B model](https://ollama.com/library/qwen3:1.7b) needs roughly 1.4 GB of download space; runtime RAM and speed depend on hardware. Internet is needed for the initial model download, not subsequent composition. Smaller models are available but may follow the musical instructions less reliably.

### GPU inference

Ollama automatically offloads inference when the appropriate GPU backend is installed. All 26 agents use that runtime, retaining their independent prompts and musical memory. Start it with the same `npm run llm:serve` command. The launcher now defaults to `OLLAMA_NUM_PARALLEL=4` so the GPU can serve four agents at once; restart an already-running runtime to apply that setting. An explicitly supplied `OLLAMA_NUM_PARALLEL` is respected. Parallel requests allocate additional context memory; see [Ollama’s concurrency settings](https://docs.ollama.com/faq#how-does-ollama-handle-concurrent-requests).

```sh
# Inspect loaded models and their CPU/GPU allocation:
npm run llm:status
# Make a real musical decision, validate the melody and require GPU residency:
npm run test:gpu
```

An empty status table means no model is currently loaded; start the performance or run the check first. `test:gpu` reports GPU memory, resident percentage and generation speed, and fails on CPU-only inference. Partial offloading also passes but is shown as less than 100%; larger models may exceed available VRAM.

This workspace was verified with **AMD Radeon RX 9060 XT (gfx1200), ROCm 7.2 and Ollama 0.40.16**: `qwen3:1.7b` offloads all 29 layers, with about 1.59 GiB resident for one 4096-token context. Four parallel contexts used about 2.96 GiB in the current check. A warm 26-agent pass took 31.41 seconds with serial inference and 17.66 seconds with four parallel requests; both accepted all 26 decisions at 100% GPU residency. These are measured whole-orchestra passes, not per-agent update guarantees; `test:throughput` reports the current allocation and timing. The matching AMD backend is installed under ignored `.local/ollama/lib/ollama/rocm_v7_2/`; these runtime binaries are not part of the repository or installed by npm.

For a fresh Linux AMD setup, follow [Ollama's Linux installation instructions](https://docs.ollama.com/linux) and install the additional `ollama-linux-amd64-rocm.tar.zst` archive alongside the base package. Keep both packages on the same release. For the existing workspace's 0.40.16 base installation, stop the runtime, then install its matching backend with:

```sh
curl -fL https://github.com/ollama/ollama/releases/download/v0.40.16/ollama-linux-amd64-rocm.tar.zst -o /tmp/symphony-ollama-rocm.tar.zst
tar --zstd -xf /tmp/symphony-ollama-rocm.tar.zst -C .local/ollama
npm run llm:serve
```

On this machine, the backend's `hipblaslt` directory is also linked to `/opt/rocm/lib/hipblaslt`, supplying its missing optional kernels from the installed ROCm 7.2 package. This resolves the `TensileLibrary_lazy_gfx1200.dat` startup warning. That machine-specific link is inside ignored `.local/`; reassess it if upgrading ROCm. GPU drivers and device permissions must also work; see [Ollama GPU support](https://docs.ollama.com/gpu).

### What each agent hears and decides

- Each musician records the actual note events sent to its synthesizer: MIDI pitch, onset, sounding duration, velocity, written note value and articulation. Ornament offsets describe their scheduled sub-notes. History is bounded to 24 events from the last two bars. Muted instruments do not contribute notes.
- The agent listens to at most six **reachable** neighbours, prioritising its own orchestral section and nearby stereo seating. “Nearby” means this virtual seating, not microphone or physical-location detection. Peer note metadata travels over WebRTC; audio remains local.
- Its prompt contains those observations, its instrument's role and register, its current phrase, structural context, remembered theme and last few accepted decisions. The model chooses a listening partner, response type (echo, counterpoint, support, contrast or development), interval, entrances, per-note written durations and articulations, energy, form, gesture, theme action and an allowed key change. A deterministic realization grounds new phrases in the selected partner's recent notes; a theme recall restores its saved motif, rhythm and note values, including short uploaded motifs. Unpitched percussion contributes rhythm/dynamics rather than fictitious pitches.
- [Structured output](https://docs.ollama.com/capabilities/structured-outputs) is validated: notes stay in the agent's current scale and instrument register, rhythm stays within the bar, and decisions cannot reference unheard players. Repeated rhythmic entrances are deduplicated together with their attached durations/articulations. Arrays must have one entry per onset. Notes that exceed the next onset or bar line shorten to the largest supported value that fits. If the realized melody exactly repeats the current phrase, its final note receives a small diatonic variation. Responses are data, never executed code.
- Each agent's accepted phrase enters at its **next local bar boundary**. The audio scheduler never waits for inference. A fair queue runs up to four independent requests concurrently and serves the least recently reviewed agent first. Agents become eligible again **2 seconds** after adopting a phrase, checked every 200 ms. The **Re-evaluation interval** control offers 1, 2, 4, 8 or 12 seconds and can change during playback without clearing history. This is a minimum wait: model inference, the shared queue and the next bar add latency, so 26 agents do not each update every two seconds. One-instrument-per-laptop mode distributes that work.
- A request times out after 20 seconds. Replies based on observations more than four local bars old are discarded and immediately become eligible for a fresh attempt. Section changes also invalidate stale context. Malformed musical replies back off only their own agent; network/runtime errors and timeouts also pause the shared queue briefly. Failure backoff remains in place when the re-evaluation interval changes. The last accepted phrase keeps playing; agents without a model phrase use deterministic rules that react to heard notes. The UI distinguishes thinking, ready, playing and inference-unavailable states.

Partitioning cancels pending and in-flight decisions, preserves each agent's musical memory, and restricts subsequent context to the remaining reachable group. Reconnection starts fresh listening; a model does not receive hidden information from an isolated group.

Vite development and preview servers proxy only `/api/local-llm/chat` and `/api/local-llm/tags` to Ollama on this computer. `SYMPHONY_OLLAMA_URL` can change the loopback port. In peer mode, **run Ollama and the app server on each laptop** and open that laptop's localhost URL, then share only the signalling URL/room. Serving one app instance to every laptop would share that server's inference runtime instead.

## One agent for each instrument

| Section | Agents |
| --- | --- |
| Strings (4) | Violin, viola, cello, double bass |
| Woodwinds (8) | Piccolo, flute, oboe, English horn, clarinet, bass clarinet, bassoon, contrabassoon |
| Brass (5) | French horn, trumpet, trombone, bass trombone, tuba |
| Percussion (6) | Timpani, snare drum, bass drum, cymbals, triangle, glockenspiel |
| Harp & keyboards (3) | Harp, piano, celesta |

An agent represents an instrument type, rather than every individual player in a symphony orchestra. Each has its own ID, tempo, energy, motif, step counter and partition membership. Instrument profiles define distinct registers, rhythmic entrances, articulation, voice and stereo position. Each agent's local model chooses its melodic response to what reachable neighbours have played; deterministic rules handle timing and fallback. Voices use the recorded sound bank described above, with oscillator/noise synthesis only as a fallback when samples are unavailable. A master compressor controls ensemble peaks.

Partition splits the agents into two groups of 13, with every section represented in both. Each branch keeps composing while its local clocks run. Reconnection exposes new note histories to each agent, which can answer them with new phrases while tempo gradually converges. The map shows a selection of links for readability; each musical prompt uses the closest six audible neighbours.

## Multiple computers

Serve the app over HTTPS (localhost is suitable for same-machine testing), and expose the signalling server through a WSS reverse proxy. Select WebRTC peer orchestra in each browser, choose a different instrument from the section-grouped selector, enter the same room and signalling URL, then Join room and Start performance on each. This mode runs **one local instrument agent per browser**; recently heard remote agents appear in the map and roster. Remote audio plays on its originating device.

Existing data channels survive signalling-server shutdown. Partition blocks outgoing and incoming intentions locally; remote intentions expire after four seconds. Audio keeps running locally. Rooms are ephemeral and support up to 64 peers, enough for all 26 instruments. The signalling server only introduces peers and relays WebRTC negotiation, with no musical authority. This prototype has no room authentication: use a trusted demo network.

A public STUN server assists discovery; restrictive NATs need a TURN service configured in `src/network.ts`. Keep tabs foregrounded: browser background throttling can interrupt scheduling. No audio is transmitted. Full-mesh networking has quadratic connection growth, so the room limit is not a claim of tested 64-device performance.

## Architecture and limitations

- `src/orchestra.ts`: instrument catalog and section metadata; the roster, selectors, validation and agents derive from this catalog.
- `src/engine.ts`: performed-note history, bar-boundary plan adoption, fallback state evolution, note composition and audio routing.
- `src/sample-bank.ts`, `src/sample-manifest.json`: bounded sample loading, decode cache, pitch/articulation selection and recorded playback; `src/InstrumentAudition.tsx` previews individual voices.
- `public/samples/`, `scripts/build-sample-bank.py`: bundled recordings, credits, provenance and reproducible asset preparation.
- `src/local-llm.ts`: neighbour selection, per-instrument prompts/memory, Ollama adapter, bounded inference queue, cancellation and retry.
- `src/melody.ts`: shared musical-decision schema and validation.
- `src/StartingMotif.tsx`: local audio upload, waveform, adapted phrase preview and opening controls.
- `src/phrasing.ts`, `src/PhraseNotation.tsx`: written note values, articulation, rhythmic suggestions, event normalization and live phrasing notation.
- `src/random-motif.ts`: bounded random melody/rhythm generation, shared as the initial idea before independent agent evolution.
- `src/tonality.ts`, `src/TonalityControls.tsx`: scales, note spelling, related keys, modulation policy and tonal controls.
- `src/forms.ts`, `src/FormControls.tsx`: musical routes, movement/section context, bounded per-agent theme state, controls and local timeline.
- `src/motif-upload.ts`, `src/motif.worker.ts`, `src/motif-extraction.ts`: bounded audio decoding, worker lifecycle, pitch segmentation and starting-phrase extraction.
- `scripts/local-llm.mjs`: local runtime/model launcher; `vite.config.ts` supplies the loopback-only inference proxy.
- `src/main.tsx`: local look-ahead scheduling, section controls, notation-style orchestra map, partition demo and peer session UI.
- `src/style.css`: concert-programme visual design with paper grain, vermilion accents, staggered entrance motion and reduced-motion support.
- `public/fonts/`: locally bundled Bodoni Moda, Barlow Condensed and IBM Plex Mono with their OFL licenses; no runtime font service is required.
- `src/network.ts`: validated intention messages over WebRTC DataChannels, sent four times per second.
- `server/signalling.mjs`: room discovery and connection negotiation, with room capacity for the orchestra.

This is a working prototype, not a production distributed sequencer. Peer tempos converge, but phase/clock-offset synchronization is not implemented; start devices together for the demonstration. Harmony supports 12 tonics and eight scales, with per-agent tonal state and constrained modulation. Independent choices and clocks can temporarily create different keys across the ensemble. The LLM chooses musical relationships and rhythmic intentions; a deterministic engine realizes their pitches from actual peer events. These are musical suggestions constrained by the engine; coherence and response quality depend on the model. Session state is in memory. Live inter-agent listening uses symbolic notes, not microphone audio. Uploaded opening snippets use approximate monophonic pitch extraction. Models are not trained or fine-tuned by this app.

```sh
npm test
npm run build
npm run preview
# Optional real-model integration check (requires Ollama + qwen3:1.7b):
npm run test:llm
# The same check, failing if the model is CPU-only:
npm run test:gpu
# Real local-model decisions for ABA, pop, classical and agent-selected forms:
npm run test:forms
# Real local-model decisions in non-C keys and a requested relative-key modulation:
npm run test:tonality
# Repeated real-model decisions: varied note values, rhythms and articulation:
npm run test:phrasing
# Measure a complete 26-agent pass with up to four concurrent requests:
npm run test:throughput
# Compare client-side serialization (runtime settings still apply):
npm run test:throughput -- 1
```

Automated tests cover every instrument, reaction to performed notes, independent agent prompts/memory, queue fairness, bar-boundary adoption, stale/cancelled decisions, timeout fallback, message validation, and 26 clients joining the signalling room. Starting-motif tests exercise actual PCM pitch extraction, repeated notes, silence/noise rejection, chromatic fitting, bounded phrases, per-instrument playback, and the two-bar handoff to local inference. Form tests cover theme returns, repeated hooks, four movement profiles, ornament scheduling, cadences, form selection, stale-section rejection, resets and bounded state for every instrument. Tonality tests exercise all 96 tonic/mode combinations with every instrument and ornament, key returns, modulation limits, mixed-key listening, upload remapping and stale-key rejection. Phrasing tests cover all supported written values, tempo scaling, articulated sounding lengths, rests, paired event sorting, theme recalls, validation and every instrument/gesture at tempo limits. Optional integration checks call a real local model and verify playable decisions and GPU residency.

Versions resolved from npm are pinned in package-lock.json. For local inference, serve the built app with `npm run preview` or provide an equivalent loopback inference proxy; static assets alone cannot reach `/api/local-llm`. Deploy the signalling process separately behind TLS for remote sessions.
