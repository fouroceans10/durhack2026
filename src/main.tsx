import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AudioEngine, advanceForm, compose, configureForm, configureHarmony, createOrchestra, evolve, isOpening, isFormEntrance, recordPerformance, seedMusician, type Musician } from './engine';
import { InstrumentAudition } from './InstrumentAudition';
import { TonalityControls } from './TonalityControls';
import { currentKey, homeKey, keyName, degreeName, randomTonality, type Tonality, type Modulation } from './tonality';
import { FormControls } from './FormControls';
import { PhraseNotation } from './PhraseNotation';
import { formNames, formPosition, type FormSettings } from './forms';
import { StartingMotif } from './StartingMotif';
import type { StartingMotif as Phrase } from './melody';
import { generateStartingMotif } from './random-motif';
import { orchestra, isPitched, sections, sectionColors, type Section } from './orchestra';
import { Mesh } from './network';
import { PartitionControls } from './PartitionControls';
import { assignPartition, canExchange, groupLetter, partitionDescription, partitionGroup, reachableMusicians, validPartition, type PartitionPlan } from './partitions';
import { DEFAULT_MODEL, DEFAULT_BRAIN_OPTIONS, LocalBrains, listLocalModels, ollamaDecider, type BrainStatus } from './local-llm';
import './style.css';

function PerformanceDial({ running, tempo, count }: { running: boolean; tempo: number; count: number }) {
  return <div className={`performance-dial ${running ? 'is-playing' : ''}`} style={{ '--revolution': `${240 / tempo}s` } as React.CSSProperties} aria-hidden="true">
    <svg viewBox="0 0 260 260">
      <circle className="dial-outer" cx="130" cy="130" r="116" />
      <circle className="dial-inner" cx="130" cy="130" r="86" />
      {Array.from({ length: 26 }, (_, i) => <g key={i} transform={`rotate(${i * 360 / 26} 130 130)`}>
        <line x1="130" y1="20" x2="130" y2={i % 2 ? '29' : '37'} className="dial-tick" />
        <circle cx="130" cy="57" r={i % 3 === 0 ? 3 : 1.5} className="dial-dot" />
      </g>)}
      <g className="dial-hand"><path d="M130 130 L130 34" /><circle cx="130" cy="34" r="5" /></g>
      <text x="130" y="137" textAnchor="middle" className="dial-count">{String(count).padStart(2, '0')}</text>
      <text x="130" y="159" textAnchor="middle" className="dial-caption">INDEPENDENT VOICES</text>
    </svg>
    <span className="dial-note">a collective, never a conductor</span>
  </div>;
}

function OrchestraMap({ musicians, running, partition, peerMode, localId }: {
  musicians: Musician[]; running: boolean; partition: PartitionPlan | null; peerMode: boolean; localId: string;
}) {
  const nodes = sections.flatMap((section, row) => {
    const members = musicians.filter(m => orchestra[m.instrument].section === section);
    return members.map((m, i) => ({ m, x: 105 + (i + .5) * 720 / Math.max(members.length, 1), y: 76 + row * 104 }));
  });
  const edges = peerMode
    ? nodes.filter(n => n.m.id !== localId).map(n => [nodes.find(p => p.m.id === localId)!, n])
    : nodes.map((n, i) => [n, nodes[(i + 1) % nodes.length]]);
  return <div className="stage-scroll" tabIndex={0} role="region" aria-label="Orchestral score; scroll horizontally on small screens">
    <svg className="orchestra-stage" viewBox="0 0 900 570" role="img" aria-label={`${musicians.length} autonomous instrument agents, grouped by orchestral section`}>
      {sections.map((section, row) => <g key={section} className="staff">
        <text x="24" y={35 + row * 104} className="staff-name">{section.toUpperCase()}</text>
        <text x="24" y={88 + row * 104} className="staff-index">{['I', 'II', 'III', 'IV', 'V'][row]}</text>
        {Array.from({ length: 5 }, (_, j) => <line key={j} x1="88" x2="866" y1={56 + row * 104 + j * 8} y2={56 + row * 104 + j * 8} />)}
        <line x1="88" x2="88" y1={56 + row * 104} y2={88 + row * 104} />
        <line x1="866" x2="866" y1={56 + row * 104} y2={88 + row * 104} />
        {!musicians.some(m => orchestra[m.instrument].section === section) && <text x="450" y={110 + row * 104} textAnchor="middle" className="staff-empty">Awaiting a musician</text>}
      </g>)}
      {edges.map(([a, b], i) => {
        const cut = !canExchange(partition, a.m, b.m);
        return <path key={i} className={`intention-link ${cut ? 'is-cut' : ''}`} d={`M${a.x},${a.y} Q${(a.x + b.x) / 2},${Math.min(a.y, b.y) - 50} ${b.x},${b.y}`} />;
      })}
      {running && <line className="score-playhead" x1={105 + ((musicians[0]?.beat ?? 0) % 16) / 16 * 720} x2={105 + ((musicians[0]?.beat ?? 0) % 16) / 16 * 720} y1="46" y2="510" />}
      {nodes.map(({ m, x, y }) => {
        const profile = orchestra[m.instrument];
        return <g key={m.id} className={`score-agent ${running && m.rhythm.includes(m.beat % 16) ? 'is-sounding' : ''}`} style={{ '--accent': sectionColors[profile.section] } as React.CSSProperties}>
          <title>{profile.name}: {profile.role}, {m.tempo.toFixed(1)} BPM{partition ? `, group ${groupLetter(partitionGroup(partition, m.instrument))}` : ', connected'}</title>
          <line className="note-stem" x1={x + 15} y1={y} x2={x + 15} y2={y - 36} />
          <ellipse className="note-head" cx={x} cy={y} rx="19" ry="15" transform={`rotate(-15 ${x} ${y})`} />
          <text x={x} y={y + 4} textAnchor="middle" className="note-number">{String(m.instrument + 1).padStart(2, '0')}</text>
          <text x={x} y={y + 31} textAnchor="middle" className="note-name">{profile.name}</text>
          <text x={x} y={y + 45} textAnchor="middle" className="note-tempo">{m.tempo.toFixed(1)}{partition ? ` / ${groupLetter(partitionGroup(partition, m.instrument))}` : ' bpm'}</text>
        </g>;
      })}
    </svg>
  </div>;
}

function App() {
  const [initialTonality] = useState(randomTonality);
  const [randomPhrase, setRandomPhrase] = useState(generateStartingMotif);
  const [agents, setAgents] = useState(() => createOrchestra().map(m => configureForm(seedMusician(configureHarmony(m, initialTonality, 'form'), randomPhrase), { choice: 'auto', bars: 8, expression: 'auto' })));
  const state = useRef(agents);
  const [running, setRunning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [partition, setPartition] = useState<PartitionPlan | null>(null);
  const [mode, setMode] = useState('demo');
  const [instrument, setInstrument] = useState(0);
  const [room, setRoom] = useState('durhack');
  const [url, setUrl] = useState(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.hostname}:8787`);
  const [status, setStatus] = useState('Full orchestra ready');
  const [joined, setJoined] = useState(false);
  const [volume, setVolume] = useState(35);
  const [soundStatus, setSoundStatus] = useState('Recorded orchestral instruments');
  const [sampleProgress, setSampleProgress] = useState(0);
  const [logs, setLogs] = useState([`${orchestra.length} independent instrument agents. One shared starting point.`]);
  const [section, setSection] = useState<Section | 'All'>('All');
  const [peerStates, setPeerStates] = useState<Musician[]>([]);
  const [llmEnabled, setLlmEnabled] = useState(true);
  const [reviewInterval, setReviewInterval] = useState(DEFAULT_BRAIN_OPTIONS.intervalMs);
  const reviewIntervalRef = useRef(reviewInterval);
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [models, setModels] = useState<string[]>([]);
  const [modelStatus, setModelStatus] = useState('Checking the local model…');
  const [checkingModel, setCheckingModel] = useState(false);
  const [brainStates, setBrainStates] = useState<Record<string, BrainStatus>>({});
  const [openingNames, setOpeningNames] = useState<Record<number, string>>(() => Object.fromEntries(orchestra.map((_, i) => [i, 'Generated motif'])));
  const brains = useRef<LocalBrains | null>(null);
  const audio = useRef<AudioEngine | null>(null);
  const mesh = useRef<Mesh | null>(null);
  const remote = useRef(new Map<string, { state: Musician; time: number }>());
  const split = useRef<PartitionPlan | null>(null);
  const muted = useRef(new Set<number>());
  const [mutes, setMutes] = useState<number[]>([]);
  const log = (message: string) => setLogs(l => [message, ...l].slice(0, 7));
  const peerMode = mode === 'peer';
  const namedOpenings = Object.values(openingNames);
  const openingName = peerMode ? openingNames[instrument] ?? null : namedOpenings.length
    ? namedOpenings.length === orchestra.length && new Set(namedOpenings).size === 1 ? namedOpenings[0] : 'Individual instrument openings'
    : null;
  const local = agents[instrument];
  const hasPerformed = (peerMode ? [local] : agents).some(a => a.beat > 0);
  const active = peerMode ? [local, ...peerStates] : agents;
  const reference = peerMode ? local : agents[0];
  const activeKeys = new Set(active.filter(a => isPitched(a.instrument)).map(a => keyName(currentKey(a))));
  const visible = active.filter(a => section === 'All' || orchestra[a.instrument].section === section);
  const avg = active.reduce((sum, a) => sum + a.tempo, 0) / active.length;

  useEffect(() => {
    const timer = setInterval(() => {
      for (const [id, p] of remote.current) if (performance.now() - p.time >= 4000) remote.current.delete(id);
      setPeerStates([...remote.current.values()].map(p => p.state));
    }, 250);
    return () => clearInterval(timer);
  }, []);

  async function checkModel() {
    setCheckingModel(true);
    try {
      const installed = await listLocalModels();
      setModels(installed);
      setModelStatus(installed.includes(model)
        ? `${model} is ready on this computer.`
        : `Install ${model} with npm run llm:pull, or choose an installed model.`);
    } catch {
      setModels([]);
      setModelStatus('Local model offline. Run npm run llm:serve; the orchestra can keep playing.');
    } finally { setCheckingModel(false); }
  }

  useEffect(() => {
    const controller = new AbortController();
    setModelStatus('Checking the local model…');
    void listLocalModels(controller.signal).then(installed => {
      if (controller.signal.aborted) return;
      setModels(installed);
      setModelStatus(installed.includes(model) ? `${model} is ready on this computer.` : `Install ${model} with npm run llm:pull, or choose an installed model.`);
    }).catch(() => {
      if (!controller.signal.aborted) setModelStatus('Local model offline. Run npm run llm:serve; the orchestra can keep playing.');
    });
    return () => controller.abort();
  }, [model]);

  useEffect(() => {
    if (!running || !llmEnabled) return;
    setBrainStates({});
    const localBrains = new LocalBrains(ollamaDecider(model), id => {
      const self = state.current.find(a => a.id === id);
      if (!self) return;
      const candidates = peerMode
        ? [...remote.current.values()].filter(p => performance.now() - p.time < 4000).map(p => p.state)
        : state.current;
      const reachable = reachableMusicians(self, candidates, split.current);
      return { self, reachable };
    }, (id, status) => setBrainStates(previous => ({ ...previous, [id]: status })), { ...DEFAULT_BRAIN_OPTIONS, intervalMs: reviewIntervalRef.current });
    brains.current = localBrains;
    const timer = setInterval(() => {
      const localAgents = peerMode ? [state.current[instrument]] : state.current;
      localBrains.tick(localAgents.filter(a => a.audible && a.beat > 0 && !isOpening(a) && !isFormEntrance(a)).map(a => a.id));
    }, 200);
    return () => { clearInterval(timer); localBrains.dispose(); if (brains.current === localBrains) brains.current = null; };
  }, [running, llmEnabled, model, peerMode, instrument]);

  useEffect(() => {
    if (!running) return;
    const engine = audio.current!;
    const next = state.current.map(() => engine.context.currentTime + .08);
    let lastRender = 0, lastBroadcast = 0;
    const timer = setInterval(() => {
      const now = engine.context.currentTime;
      const snapshot = state.current;
      state.current = snapshot.map((m, i) => {
        if (peerMode && i !== instrument) return m;
        if (next[i] < now) next[i] = now + .025;
        let updated = m;
        const candidates = peerMode
          ? [...remote.current.values()].filter(p => performance.now() - p.time < 4000).map(p => p.state)
          : snapshot;
        const peers = reachableMusicians(m, candidates, split.current);
        while (next[i] < now + .12) {
          updated = advanceForm(updated);
          // LLM work runs asynchronously. Only validated, ready phrases enter here.
          updated = brains.current?.atBar(updated) ?? updated;
          const notes = compose(updated);
          const audible = !muted.current.has(i);
          if (audible) engine.note(updated, next[i], notes);
          updated = recordPerformance(updated, notes, audible);
          updated = evolve(updated, peers);
          next[i] += 60 / updated.tempo / 4;
        }
        return updated;
      });
      if (peerMode && now - lastBroadcast >= .25) {
        mesh.current?.broadcast(state.current[instrument]);
        lastBroadcast = now;
      }
      if (now - lastRender >= .1) { setAgents([...state.current]); lastRender = now; }
    }, 25);
    return () => clearInterval(timer);
  }, [running, peerMode, instrument]);

  useEffect(() => () => { audio.current?.close(); audio.current = null; mesh.current?.close(); }, []);

  async function togglePerformance() {
    if (running) {
      brains.current?.invalidate();
      state.current = state.current.map(a => ({ ...a, audible: false }));
      if (peerMode) mesh.current?.broadcast(state.current[instrument]);
      setRunning(false); audio.current?.close(); audio.current = null;
      setAgents([...state.current]); log('Performance paused. Every agent retains its musical memory.');
      return;
    }
    setStarting(true);
    setSampleProgress(0);
    try {
      const engine = new AudioEngine(); audio.current = engine;
      engine.master.gain.value = volume / 100;
      for (const i of muted.current) engine.setMuted(i, true);
      await engine.resume();
      const sounds = await engine.prepare(peerMode ? [instrument] : undefined, ({ loaded, total }) => setSampleProgress(Math.round(loaded / total * 100)));
      if (audio.current !== engine) return;
      setSoundStatus(sounds.failed.length ? `Some samples unavailable · ${sounds.failed.length} affected voices` : 'Recorded orchestral instruments');
      if (sounds.failed.length) log(`Sample loading incomplete: ${sounds.failed.join(', ')}. Available recordings play; missing patches use synthesis. Pause and resume to retry.`);
      state.current = state.current.map(a => ({ ...a, audible: !muted.current.has(a.instrument) }));
      setRunning(true);
      log(`${peerMode ? orchestra[instrument].name : `${orchestra.length} instruments`} performing · independent local clocks running`);
    } catch {
      audio.current?.close(); audio.current = null; setStatus('Audio could not start in this browser');
    } finally { setStarting(false); }
  }

  function changePartition(plan: PartitionPlan | null) {
    if (plan && !validPartition(plan)) return;
    brains.current?.invalidate();
    const applied = plan ? structuredClone(plan) : null;
    split.current = applied; setPartition(applied);
    mesh.current?.setPartition(applied);
    // Drop cached observations as well as in-flight decisions. Healing waits for
    // fresh packets rather than replaying a blocked neighbour's old intentions.
    remote.current.clear(); setPeerStates([]);
    state.current = assignPartition(state.current, applied);
    setAgents([...state.current]);
    log(applied ? `${peerMode ? 'Local connections: ' : ''}${peerMode && applied.kind === 'solo' ? 'This browser isolated' : partitionDescription(applied)} · musical memories retained`
      : 'Communication restored · agents listen again and compose new responses');
  }

  function setOpening(phrase: Phrase | null, name: string | null) {
    if (running || starting) return;
    brains.current?.dispose(); brains.current = null; setBrainStates({});
    state.current = state.current.map((m, i) => peerMode && i !== instrument ? m : seedMusician(m, phrase));
    setAgents([...state.current]);
    setOpeningNames(previous => {
      const names = { ...previous };
      for (const m of state.current) if (!peerMode || m.instrument === instrument) {
        if (name) names[m.instrument] = name; else delete names[m.instrument];
      }
      return names;
    });
    if (peerMode) mesh.current?.broadcast(state.current[instrument]);
    log(name ? `${name} · opening phrase ready for ${peerMode ? orchestra[instrument].name : 'the orchestra'}. Start the performance to hear it.` : 'Default opening restored. A fresh performance is ready.');
  }

  function generateOpening() {
    if (running || starting) return;
    const phrase = generateStartingMotif(randomPhrase);
    setRandomPhrase(phrase);
    setOpening(phrase, 'Generated motif');
  }

  function changeForm(settings: FormSettings) {
    if (running || starting) return;
    brains.current?.dispose(); brains.current = null; setBrainStates({});
    state.current = state.current.map((m, i) => peerMode && i !== instrument ? m : configureForm(m, settings));
    setAgents([...state.current]);
    if (peerMode) mesh.current?.broadcast(state.current[instrument]);
    log(`${formNames[settings.choice]} · ${settings.bars} bars per section · ${settings.expression === 'auto' ? 'each agent chooses its gestures' : settings.expression}`);
  }

  function changeTonality(home: Tonality, policy: Modulation) {
    if (running || starting) return;
    brains.current?.dispose(); brains.current = null; setBrainStates({});
    state.current = state.current.map((m, i) => peerMode && i !== instrument ? m : configureHarmony(m, home, policy));
    setAgents([...state.current]);
    if (peerMode) mesh.current?.broadcast(state.current[instrument]);
    log(`${keyName(home)} · ${policy === 'fixed' ? 'fixed key' : policy === 'form' ? 'keys follow the form' : 'agents choose modulations'}`);
  }

  function setMute(indices: number[], mute: boolean) {
    for (const i of indices) {
      if (mute) muted.current.add(i); else muted.current.delete(i);
      audio.current?.setMuted(i, mute);
    }
    state.current = state.current.map(a => indices.includes(a.instrument) ? { ...a, audible: !mute && running, recentNotes: mute ? [] : a.recentNotes } : a);
    brains.current?.invalidate();
    if (peerMode) mesh.current?.broadcast(state.current[instrument]);
    setMutes([...muted.current]);
  }

  function toggleRoom() {
    brains.current?.invalidate();
    if (joined) {
      mesh.current?.close(); mesh.current = null; remote.current.clear(); setPeerStates([]);
      setJoined(false); setStatus('Left room'); return;
    }
    try {
      if (!/^[a-zA-Z0-9-]{1,48}$/.test(room)) throw Error('Invalid room');
      mesh.current = new Mesh(url, room, m => remote.current.set(m.id, { state: m, time: performance.now() }), setStatus, instrument);
      mesh.current.setPartition(split.current);
      state.current = state.current.map((m, i) => i === instrument ? { ...m, id: mesh.current!.id } : m);
      setAgents([...state.current]); setJoined(true);
    } catch { setStatus('Enter a valid WebSocket URL and room (letters, numbers, hyphens).'); }
  }

  return <main className={running ? 'is-performing' : ''}>
    <a className="skip-link" href="#orchestra">Skip to the orchestra</a>
    <header>
      <a className="brand" href="/" aria-label="Symphony Without a Conductor home"><span className="brand-mark" aria-hidden="true">s<span>/</span>wc</span><span className="brand-name">SYMPHONY<br />WITHOUT A CONDUCTOR</span></a>
      <span className="edition">AN EXPERIMENT IN COLLECTIVE SOUND<br /><b>DURHACK, 2026 — OPUS 026</b></span>
      <nav aria-label="Main navigation"><a href="#orchestra">The score <span>01</span></a><a href="#instruments">The players <span>02</span></a><a href="#session">Your session ↗</a></nav>
    </header>
    <section className="intro" aria-labelledby="hero-title">
      <div className="hero-copy">
        <p className="eyebrow"><span className="registration-mark" aria-hidden="true">✳</span> AUTONOMOUS BY NATURE. MUSICAL BY CHANCE.</p>
        <h1 id="hero-title"><span>Twenty-six voices.</span><em>Zero conductors.</em></h1>
        <div className="hero-caption"><span className="opus-number" aria-hidden="true">№ 26</span><p className="description">A self-composing orchestra with a mind of its own.<br />Break the connection. The music keeps finding a way.</p></div>
      </div>
      <div className="intro-right">
        <PerformanceDial running={running} tempo={avg} count={active.length} />
        <span className="live"><i className={running ? 'pulse' : ''} />{running ? 'THE ORCHESTRA IS PLAYING' : 'THE ORCHESTRA IS WAITING'}</span>
        <button className="primary play-button" disabled={starting} onClick={togglePerformance}><span className="play-symbol" aria-hidden="true">{running ? 'Ⅱ' : '▶'}</span><span>{starting ? `Loading sounds · ${sampleProgress}%` : running ? 'Pause performance' : hasPerformed ? 'Resume performance' : 'Start performance'}</span><span aria-hidden="true">↗</span></button>
        <span className="player-footnote" role="status">{peerMode ? 'One browser · one instrument' : '26 agents'} · {soundStatus}</span>
      </div>
    </section>
    <div className="metrics">
      <div><small>ENSEMBLE TEMPO</small><strong>{avg.toFixed(1)} <span>BPM</span></strong></div>
      <div><small>TONAL CENTRE</small><strong>{activeKeys.size > 1 ? 'Mixed keys' : [...activeKeys][0] ?? 'Unpitched'}{activeKeys.size > 1 && <span> / {keyName(currentKey(reference))}</span>}</strong></div>
      <div><small>{peerMode ? 'VISIBLE MUSICIANS' : 'INSTRUMENT AGENTS'}</small><strong>{String(active.length).padStart(2, '0')} <span>{peerMode ? 'local + recently heard peers' : `${sections.length} orchestral sections`}</span></strong></div>
      <div><small>{peerMode ? 'LOCAL COMMUNICATION' : 'SIMULATED NETWORK'}</small><strong className={partition ? 'amber' : 'green'}>{partition ? 'Partitioned' : peerMode ? joined ? 'Room joined' : 'Local only' : 'Connected'} <span>●</span></strong></div>
    </div>
    <TonalityControls musician={reference} disabled={running || starting} peerMode={peerMode} onChange={changeTonality} />
    <StartingMotif disabled={running || starting} peerMode={peerMode} activeName={openingName} onApply={setOpening} randomPhrase={randomPhrase} onGenerate={generateOpening} tonality={homeKey(reference)} />
    <FormControls musician={peerMode ? local : agents[0]} disabled={running || starting} peerMode={peerMode} onChange={changeForm} />
    <section className="workspace" id="orchestra">
      <article className="network"><div className="panel-title"><div><span className="eyebrow">01 — THE LIVING SCORE</span><h2>All together. <em>On their own.</em></h2></div><span className="pill"><i />{peerMode ? 'PEER ORCHESTRA' : 'LOCAL ENSEMBLE'}</span></div>
        <OrchestraMap musicians={active} running={running} partition={partition} peerMode={peerMode} localId={local.id} />
        <div className="legend"><span><i className="legend-line" /> Intention exchange · selected links</span><span>26 parts. No master score.</span></div>
      </article>
      <aside><PartitionControls key={mode} active={partition} peerMode={peerMode} localInstrument={instrument} onApply={changePartition} onReconnect={() => changePartition(null)} />
      <article className="journal"><span className="eyebrow">IN THE MARGINS / LIVE NOTES</span><h2>As it happens.</h2>{logs.map((l, i) => <p key={`${l}-${i}`}><span className="dot" />{l}</p>)}</article></aside>
    </section>
    <section className="instrument-panel" id="instruments" aria-label="Instrument agents">
      <div className="roster-heading"><div><span className="eyebrow">02 — THE PLAYERS</span><h2>Distinct personalities.<br /><em>Shared possibilities.</em></h2></div><p className="roster-note">Every part has its own rhythm, register and memory.<br />Listen to the whole. Or single out a voice.</p></div>
      <InstrumentAudition disabled={running || starting} />
      <div className="section-filters" role="group" aria-label="Filter orchestral sections">
        {(['All', ...sections] as const).map(s => <button key={s} aria-pressed={section === s} className={section === s ? 'selected' : ''} onClick={() => setSection(s)}>{s} <span>{active.filter(a => s === 'All' || orchestra[a.instrument].section === s).length}</span></button>)}
      </div>
      <div className="section-actions"><span>{visible.length} instrument agent{visible.length === 1 ? '' : 's'}</span><div><button onClick={() => setMute(visible.filter(a => !peerMode || a.id === local.id).map(a => a.instrument), true)}>Mute {section === 'All' ? 'all local' : 'section'}</button><button onClick={() => setMute(visible.filter(a => !peerMode || a.id === local.id).map(a => a.instrument), false)}>Unmute {section === 'All' ? 'all local' : 'section'}</button></div></div>
      <div className="musicians">{visible.map(a => {
        const profile = orchestra[a.instrument], isLocal = !peerMode || a.id === local.id;
        const mutedHere = isLocal && mutes.includes(a.instrument);
        const mind = brainStates[a.id];
        const brainLabel = isOpening(a) ? 'Opening motif / two bars' : isFormEntrance(a) ? (formPosition(a.form, a.beat).returning ? 'Remembered theme / return' : 'New section / theme') : !isLocal ? (a.decision ? 'Peer / local LLM' : 'Peer / musical rules') : !llmEnabled ? 'Musical rules' : !running ? 'Local LLM / paused' : mind ? ({ listening: 'Listening', queued: 'Queued locally', thinking: 'Thinking locally', ready: 'Phrase ready', playing: 'Playing / local LLM', fallback: 'Inference unavailable' }[mind.phase]) : 'Listening';
        return <article key={a.id} className={`instrument-part ${mutedHere ? 'is-muted' : ''}`} style={{ '--accent': sectionColors[profile.section] } as React.CSSProperties}>
          <span className="part-number">{String(a.instrument + 1).padStart(2, '0')}</span>
          <div className="part-identity"><h3>{profile.name}</h3><p>{profile.role}</p><small className="section-name">{profile.section} / {partition ? `Group ${groupLetter(partitionGroup(partition, a.instrument))}` : 'Connected'}</small></div>
          <div className="part-notation" aria-hidden="true">{Array.from({ length: 16 }, (_, j) => <i key={j} className={`${a.rhythm.includes(j) ? 'has-note' : ''} ${(isLocal ? running && !mutedHere : true) && a.beat % 16 === j ? 'current-note' : ''}`} style={{ '--note-position': `${(a.motif[j % a.motif.length] - 3) * 3}px` } as React.CSSProperties} />)}</div>
          <div className="part-state"><strong>{a.tempo.toFixed(0)}<small>BPM</small></strong><span>{Math.round(a.energy * 100)}% energy</span><span>Step {a.beat}</span></div>
          {isLocal ? <button className="part-mute" aria-label={`${mutedHere ? 'Unmute' : 'Mute'} ${profile.name}`} aria-pressed={mutedHere} onClick={() => setMute([a.instrument], !muted.current.has(a.instrument))}><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 9H8L13 5V19L8 15H4Z" />{mutedHere ? <path d="M17 9L22 15M22 9L17 15" /> : <><path d="M16 8Q21 12 16 16" /><path d="M19 5Q26 12 19 19" /></>}</svg><span>{mutedHere ? 'Muted' : 'Sound on'}</span></button> : <span className="remote-label">Remote ↗</span>}
          <details className="agent-mind" data-phase={mind?.phase ?? 'listening'}>
            <summary><span>{brainLabel}</span><span>{a.decision?.approach ?? 'develop'} ↗</span></summary>
            <p>{isFormEntrance(a) ? `Establishing the ${formPosition(a.form, a.beat).label} theme for one bar before developing it.` : isLocal ? mind?.detail ?? 'This instrument listens to nearby players before choosing its next phrase.' : a.decision?.reason ?? 'This musician makes decisions on its own device.'}</p>
            {isLocal && <p>Hearing: {mind?.heard.length ? mind.heard.join(', ') : 'its own musical memory'}. Accepted phrases: {mind?.decisions ?? 0}.</p>}
            {a.form && <p className="agent-form">Form: {a.form.selected ?? 'agent choosing'} · {formPosition(a.form, a.beat).movementName} · {formPosition(a.form, a.beat).label} · bar {formPosition(a.form, a.beat).bar}/{a.form.bars}<br />Gesture: {a.decision?.gesture ?? a.form.gesture} · Theme: {a.decision?.themeAction ?? (formPosition(a.form, a.beat).returning ? 'recall' : 'establish')}</p>}
            <p>{isPitched(a.instrument) ? <>Key: {keyName(currentKey(a))} · Home: {keyName(homeKey(a))}<br />Melody: {a.motif.map(n => degreeName(n, currentKey(a))).join(' · ')}<br /></> : <>Unpitched percussion<br /></>}Entrances: {a.rhythm.join(', ')} / 16 steps</p>
            <PhraseNotation musician={a} />
          </details>
        </article>;
      })}</div>
      {!visible.length && <p className="empty-section">No connected instruments in this section. Choose another section or invite a musician.</p>}
    </section>
    <section id="session" className="settings"><div><span className="eyebrow">03 — MAKE YOURSELF HEARD</span><h2>Take your place<br /><em>in the orchestra.</em></h2><p>Demo runs all {orchestra.length} instrument agents locally. Peer mode plays one instrument per browser, with room for the full orchestra.</p></div>
      <div className="controls"><label>Mode<select aria-label="Mode" disabled={running || starting || joined} value={mode} onChange={e => { changePartition(null); setMode(e.target.value); setSection('All'); }}><option value="demo">Full orchestra demo</option><option value="peer">WebRTC peer orchestra</option></select></label><label>Master volume<input type="range" min="0" max="80" value={volume} onChange={e => { setVolume(+e.target.value); if (audio.current) audio.current.master.gain.setTargetAtTime(+e.target.value / 100, audio.current.context.currentTime, .02); }} /></label>
        {peerMode && <><label>Instrument<select aria-label="Instrument" disabled={running || starting || joined} value={instrument} onChange={e => { setInstrument(+e.target.value); setSection('All'); }}>{sections.map(s => <optgroup label={s} key={s}>{orchestra.map((p, i) => p.section === s ? <option key={p.name} value={i}>{p.name}</option> : null)}</optgroup>)}</select></label><label>Room<input value={room} disabled={joined} onChange={e => setRoom(e.target.value)} /></label><label>Signalling URL<input value={url} disabled={joined} onChange={e => setUrl(e.target.value)} /></label><button className="outline" onClick={toggleRoom}>{joined ? 'Leave room' : 'Join room'}</button></>}
        <small role="status">{status}</small>
        <div className="local-intelligence">
          <span className="eyebrow">EACH VOICE THINKS FOR ITSELF</span>
          <label className="llm-switch"><input type="checkbox" checked={llmEnabled} onChange={e => {
            brains.current?.invalidate(); setLlmEnabled(e.target.checked);
            if (!e.target.checked) state.current = state.current.map(a => ({ ...a, decision: undefined }));
          }} /> Local LLM composition</label>
          <p>Each instrument considers its movement, remembered themes and up to six nearby musicians. It experiments with note lengths, rests and per-note articulation, alongside gestures and melody. New phrases enter on the next bar.</p>
          <label>Re-evaluation interval<select aria-label="Re-evaluation interval" value={reviewInterval} onChange={e => {
            const interval = Number(e.target.value); reviewIntervalRef.current = interval; setReviewInterval(interval); brains.current?.setIntervalMs(interval);
          }}>{[1000, 2000, 4000, 8000, 12000].map(ms => <option key={ms} value={ms}>{ms / 1000} second{ms === 1000 ? '' : 's'}</option>)}</select></label>
          <p className="review-help">Minimum wait after adopting a phrase. Queue and inference time are additional. Change this while playing; each voice keeps its memory.</p>
          <label>Local model<select aria-label="Local model" value={model} onChange={e => { brains.current?.invalidate(); setModel(e.target.value); }}>
            {[...new Set([DEFAULT_MODEL, model, ...models])].map(name => <option key={name} value={name}>{name}</option>)}
          </select></label>
          <button className="outline" disabled={checkingModel} onClick={checkModel}>{checkingModel ? 'Checking…' : 'Check local model'}</button>
          <p className="model-status" role="status">{modelStatus}</p>
          <details className="model-setup"><summary>First performance with a local model</summary><p>Install Ollama, then run these in separate terminals:</p><code>npm run llm:serve<br />npm run llm:pull</code><p>One model is shared for efficiency. All 26 agents have independent prompts and musical memory. In peer mode, run Ollama and this app on each laptop.</p></details>
        </div>
      </div>
    </section>
    <footer><a href="#hero-title" className="footer-wordmark">Symphony<span>↗</span></a><div className="footer-colophon"><span>WITHOUT A CONDUCTOR.<br />WITHOUT A FINAL NOTE.</span><span>A DISTRIBUTED MUSIC EXPERIMENT<br />DURHACK / 2026</span><a href="#hero-title">BACK TO THE OVERTURE ↑</a></div></footer>
  </main>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
