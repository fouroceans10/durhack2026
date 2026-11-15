#!/usr/bin/env python3
"""Rebuild the bundled sound bank. Requires Python 3, numpy and scipy; never runs downloaded code."""
import base64
import concurrent.futures
import hashlib
import io
import json
import pathlib
import re
import time
import urllib.parse
import urllib.request
import warnings

import numpy as np
from scipy.io import wavfile
from scipy.signal import resample_poly

ROOT = pathlib.Path(__file__).resolve().parents[1]
CACHE = ROOT / '.local/sample-sources'
OUT = ROOT / 'public/samples'
PINS = {
    'VSCO-2-CE': '440300901dfe9275fd84e0b7763af1f8443ae62e',
    'VCSL': 'c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e',
    'FluidR3': '044fab8e1456bfafc5776e86dfd6bb8697149aef',
}

def download(url, dest):
    if dest.exists():
        return dest.read_bytes()
    for attempt in range(4):
        try:
            data = urllib.request.urlopen(url, timeout=45).read()
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(data)
            return data
        except Exception:
            if attempt == 3:
                raise
            time.sleep(attempt + 1)

def source_url(repo, path):
    owner, name = ('gleitz', 'midi-js-soundfonts') if repo == 'FluidR3' else ('sgossner', repo)
    return f'https://raw.githubusercontent.com/{owner}/{name}/{PINS[repo]}/{urllib.parse.quote(path)}'

def midi(name, octave_offset=24):
    match = re.search(r'(?:^|_)([A-G])([#b]?)(-?\d+)(?:_|$)', name)
    if not match:
        raise ValueError(name)
    note, accidental, octave = match.groups()
    return int(octave) * 12 + octave_offset + {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}[note] + {'': 0, '#': 1, 'b': -1}[accidental]

trees = {}
for repo in ['VSCO-2-CE', 'VCSL']:
    data = download(f'https://api.github.com/repos/sgossner/{repo}/git/trees/{PINS[repo]}?recursive=1', CACHE / (repo + '.json'))
    tree = json.loads(data)
    assert tree['sha'] == PINS[repo] and not tree.get('truncated')
    trees[repo] = tree['tree']

samples = {}
patches = []

def add(repo, path, root, style='sustain', loop=False):
    identity = f'{repo}/{path}/{style}/{loop}'
    key = hashlib.sha256(identity.encode()).hexdigest()[:16]
    samples[key] = dict(repo=repo, path=path, root=root, style=style, loop=loop)
    return key

def regions(repo, folder, low, high, style='sustain', octave_offset=24, velocity=2, variants=1, pattern=None, loop=False):
    candidates = [x['path'] for x in trees[repo] if x['path'].rsplit('/', 1)[0] == folder and x['path'].lower().endswith('.wav')]
    if pattern:
        candidates = [p for p in candidates if re.search(pattern, p.split('/')[-1], re.I)]
    roots = sorted(set(midi(p.split('/')[-1], octave_offset) for p in candidates))
    # Include the closest recorded anchor at either edge, not just those inside the range.
    selected = sorted(set(min(roots, key=lambda r: abs(r - n)) for n in range(low, high + 1)))
    result = []
    for root in selected:
        options = [p for p in candidates if midi(p.split('/')[-1], octave_offset) == root]
        def order(p):
            v = re.search(r'_v(\d)', p, re.I)
            return (abs(int(v[1]) - velocity) if v else 0, p)
        options.sort(key=order)
        v = re.search(r'_v(\d)', options[0], re.I)
        if v:
            options = [p for p in options if re.search(r'_v' + v[1] + r'(?:_|\.)', p, re.I)]
        result += [add(repo, p, root, style, loop) for p in options[:variants]]
    return result

# Source octave labels use C3 = MIDI 60, except the concert harp (C4 = 60).
voices = [
    ('Violin', 'Strings/Violin Section', 'susVib', 'Spic', 70, 100),
    ('Viola', 'Strings/Viola Section', 'susvib', 'spic', 58, 90),
    ('Cello', 'Strings/Cello Section', 'susvib', 'spic', 46, 78),
    ('Double bass', 'Strings/Solo Contrabass', 'SusVib', 'Spic', 34, 66),
    ('Piccolo', 'Woodwinds/Piccolo', 'Sus', 'Stac', 82, 112),
    ('Flute', 'Woodwinds/Flute', 'susvib', 'stac', 70, 102),
    ('Oboe', 'Woodwinds/Oboe', 'Sus', 'Stacc', 70, 102),
    None,
    ('Clarinet', 'Woodwinds/Clarinet', 'susLong', 'stac', 58, 90),
    ('Bass clarinet', 'Woodwinds/Clarinet', 'susLong', 'stac', 46, 78),
    ('Bassoon', 'Woodwinds/Bassoon', 'sus', 'stac', 46, 78),
    ('Contrabassoon', 'Woodwinds/Bassoon', 'sus', 'stac', 24, 54),
    ('French horn', 'Brass/F Horn', 'sus', 'stac', 46, 78),
    ('Trumpet', 'Brass/Trumpet', 'sus', 'stac', 70, 102),
    ('Trombone', 'Brass/Tenor Trombone', 'sus', 'stac', 46, 78),
    ('Bass trombone', 'Brass/Tenor Trombone', 'sus', 'stac', 34, 66),
    ('Tuba', 'Brass/Tuba', 'sus', 'stac', 34, 66),
]
for voice in voices:
    if voice is None:
        patches.append(None)
        continue
    name, folder, sus, short, low, high = voice
    ids = regions('VSCO-2-CE', folder + '/' + sus, low, high, loop=True)
    ids += regions('VSCO-2-CE', folder + '/' + short, low, high, 'short', variants=2)
    derived = {'Bass clarinet': 'Clarinet recordings adapted to the lower register', 'Contrabassoon': 'Bassoon recordings adapted to the lower register', 'Bass trombone': 'Tenor trombone recordings adapted to the lower register'}.get(name)
    patches.append(dict(name=name, samples=ids, source='VSCO 2 CE', **({'derived': derived} if derived else {})))

patches.append(dict(name='Timpani', source='VSCO 2 CE', samples=[
    add('VSCO-2-CE', f'Percussion/Timpani/Timpani{i}_Hit_v3_rr{rr}_Sum.wav', root)
    for i, root in enumerate([42, 46, 49, 52, 54], 1) for rr in [1, 2]
]))  # Sounding roots from the publisher's Timpani.sfz, not a harmonic of the drum.
for name, folder, files in [
    ('Snare drum', 'Membranophones/Struck Membranophones/Snare Drum, Modern 2', ['Snare3M_HitSN_v3_rr1_Mid.wav', 'Snare3M_HitSN_v3_rr2_Mid.wav']),
    ('Bass drum', 'Membranophones/Struck Membranophones/Bass Drum 1', ['BDrumNew_hit_v3_rr1_Sum.wav', 'BDrumNew_hit_v3_rr2_Sum.wav']),
    ('Cymbals', 'Idiophones/Struck Idiophones/Clash Cymbals 1', ['cymbal_crash1_mf1.wav', 'cymbal_crash1_mf2.wav']),
    ('Triangle', 'Idiophones/Struck Idiophones/Triangles', ['Triangle1_Hit_v1_rr1_Mid.wav', 'Triangle1_Hit_v1_rr2_Mid.wav']),
]:
    patches.append(dict(name=name, source='VCSL', unpitched=True, samples=[add('VCSL', folder + '/' + f, 60) for f in files]))
patches.append(dict(name='Glockenspiel', source='VCSL', samples=regions('VCSL', 'Idiophones/Struck Idiophones/Glockenspiel', 82, 114, pattern=r'^glock_medium')))
patches.append(dict(name='Harp', source='VCSL', samples=regions('VCSL', 'Chordophones/Composite Chordophones/Concert Harp', 58, 92, octave_offset=12, pattern=r'_mf')))
patches.append(dict(name='Piano', source='VCSL', samples=regions('VCSL', 'Chordophones/Zithers/Grand Piano, Kawai/Sustains', 46, 84)))

for index, name, slug, low, high in [(7, 'English horn', 'english_horn', 60, 92), (25, 'Celesta', 'celesta', 72, 104)]:
    path = f'FluidR3_GM/{slug}-mp3.js'
    text = download(source_url('FluidR3', path), CACHE / 'FluidR3' / path).decode()
    start = text.index('{', text.index('MIDI.Soundfont.' + slug + ' ='))
    notes = json.loads(re.sub(r',\s*}', '}', text[start:].strip().removesuffix(';')))
    ids = []
    for key, encoded in notes.items():
        root = midi(key, 12)
        if root < low or root > high or root % 4:
            continue
        identity = f'fluid-{slug}-{root}'
        output = OUT / (identity + '.mp3')
        output.parent.mkdir(parents=True, exist_ok=True)
        data = base64.b64decode(encoded.split(',', 1)[1], validate=True)
        output.write_bytes(data)
        samples[identity] = dict(file=output.name, root=root, style='sustain', repo='FluidR3', path=path, sha256=hashlib.sha256(data).hexdigest(), **({'loop': [.35, .8]} if slug == 'english_horn' else {}))
        ids.append(identity)
    patch = dict(name=name, source='FluidR3', samples=ids)
    if index == len(patches):
        patches.append(patch)
    else:
        patches[index] = patch

def process(item):
    key, entry = item
    if 'file' in entry:
        return key, entry
    data = download(source_url(entry['repo'], entry['path']), CACHE / entry['repo'] / entry['path'])
    with warnings.catch_warnings():
        warnings.simplefilter('ignore', wavfile.WavFileWarning)
        rate, wave = wavfile.read(io.BytesIO(data))
    if wave.dtype.kind == 'i':
        wave = wave.astype(np.float64) / (2 ** (wave.dtype.itemsize * 8 - 1))
    elif wave.dtype.kind == 'u':
        wave = (wave.astype(np.float64) - 128) / 128
    if wave.ndim == 2:
        wave = wave.mean(axis=1)
    if rate != 44100:
        from math import gcd
        factor = gcd(int(rate), 44100)
        wave = resample_poly(wave, 44100 // factor, int(rate) // factor)
        rate = 44100
    wave -= wave.mean()
    # Remove pre-roll, retaining 3 ms before the first meaningful transient.
    threshold = max(.0003, float(abs(wave).max()) * .008)
    active = np.flatnonzero(abs(wave) > threshold)
    assert len(active), entry['path']
    trim = max(0, int(active[0]) - int(rate * .003))
    wave = wave[trim:]
    loop = None
    if entry['loop']:
        # Crossfade a stable body back into itself; never loop the attack or a release.
        end = min(int(rate * 2.8), int(len(wave) * .7))
        start = min(int(rate * .9), int(end * .4))
        fade = min(int(rate * .15), start // 2)
        alpha = np.linspace(0, 1, fade)
        wave[end-fade:end] = wave[end-fade:end] * (1-alpha) + wave[start-fade:start] * alpha
        loop = [round(start/rate, 7), round(end/rate, 7)]
        wave = wave[:end + 64]
    else:
        wave = wave[:int(rate * (1.5 if entry['style'] == 'short' else 5))]
        # Quiet recorded tails can end earlier; retain enough natural room after the hit.
        end = min(len(wave), int(active[-1]) - trim + int(rate * .08))
        wave = wave[:end]
    body = wave[:min(len(wave), int(rate * .8))]
    rms = np.sqrt(np.mean(body ** 2))
    scale = min(.22 / max(rms, .001), .9 / max(abs(wave).max(), .001))
    wave *= scale
    wave[:int(rate*.002)] *= np.linspace(0, 1, int(rate*.002))
    if not loop:
        wave[-int(rate*.015):] *= np.linspace(1, 0, int(rate*.015))
    output = OUT / (key + '.wav')
    wavfile.write(output, rate, np.round(wave * 32767).astype('<i2'))
    return key, dict(file=output.name, root=entry['root'], style=entry['style'], **({'loop': loop} if loop else {}), repo=entry['repo'], path=entry['path'], sha256=hashlib.sha256(output.read_bytes()).hexdigest(), sourceSha256=hashlib.sha256(data).hexdigest(), trimSeconds=round(trim/rate, 4))

OUT.mkdir(parents=True, exist_ok=True)
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as executor:
    processed = {}
    for index, (key, entry) in enumerate(executor.map(process, samples.items()), 1):
        processed[key] = entry
        if index % 25 == 0:
            print(f'{index}/{len(samples)} samples prepared', flush=True)

manifest = dict(version=1, pins=PINS, patches=patches, samples=processed)
runtime = dict(patches=patches, samples={key: {k: v for k, v in sample.items() if k in ['file', 'root', 'style', 'loop', 'repo']} for key, sample in processed.items()})
(ROOT / 'src/sample-manifest.json').write_text(json.dumps(runtime, indent=2) + '\n')
# Per-file provenance lives next to the redistributable assets, too.
(OUT / 'provenance.json').write_text(json.dumps(manifest, indent=2) + '\n')
total = sum((OUT / s['file']).stat().st_size for s in processed.values())
print(f'{len(patches)} patches, {len(processed)} unique samples, {total / 1024**2:.1f} MiB')
