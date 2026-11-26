#!/usr/bin/env python3
"""Build a verified, compact GD Krillion catalog from public GD APIs.

Sources (queried live at build time, never invented):
  - GDHistory advanced search: rated, non-deleted, public level records.
  - GDBrowser /api/gauntlets and /api/search?list=...: gauntlet membership and song names.
  - Pointercrate API: current Demon List baseline.
"""
import json, os, re, time, urllib.parse, urllib.request, collections, sys

UA = {'User-Agent': 'GD-Krillion-catalog-builder/1.1'}
OUT = os.path.dirname(os.path.abspath(__file__))

def get(url, tries=3):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=45) as r:
                return json.loads(r.read().decode())
        except Exception as e:
            if i == tries - 1:
                print('  request failed:', url[:100], type(e).__name__, e, file=sys.stderr)
                return None
            time.sleep(1.5 * (i + 1))

def enc(s):
    return urllib.parse.quote(str(s), safe='')

DIFF = {1:'Auto',2:'Easy',3:'Normal',4:'Hard',5:'Harder',6:'Insane',
        7:'Demon',8:'Easy Demon',9:'Medium Demon',10:'Hard Demon',
        11:'Insane Demon',12:'Extreme Demon'}
LEN = {0:'Tiny',1:'Short',2:'Medium',3:'Long',4:'XL',5:'Plat'}

print('Fetching rated levels from GDHistory...')
raw = {}
queries = [
    ('cache_downloads:desc', 0, 800), ('cache_downloads:desc', 800, 800),
    ('cache_likes:desc', 0, 800), ('cache_likes:desc', 800, 800),
    ('cache_submitted_timestamp:desc', 0, 700),
    ('cache_downloads:asc', 0, 500),
]
for sort, offset, limit in queries:
    filt = 'cache_stars > 0 AND is_deleted = false AND cache_downloads >= 2000 AND cache_downloads < 999999999'
    url = ('https://history.geometrydash.eu/api/v1/search/level/advanced/'
           f'?limit={limit}&offset={offset}&filter={enc(filt)}&sort={enc(sort)}')
    data = get(url)
    hits = data.get('hits', []) if isinstance(data, dict) else []
    print(f'  {sort} offset={offset}: {len(hits)} hits')
    for h in hits:
        raw[str(h['online_id'])] = h
    time.sleep(0.4)
print('  unique records:', len(raw))

levels = []
for sid, h in raw.items():
    name = str(h.get('cache_level_name') or '').strip()
    author = str(h.get('cache_username') or '').strip()
    stars = int(h.get('cache_stars') or 0)
    diff = int(h.get('cache_filter_difficulty') or 0)
    downloads = int(h.get('cache_downloads') or 0)
    likes = int(h.get('cache_likes') or 0)
    if not (1 <= len(name) <= 60) or not re.search(r'[A-Za-z0-9]', name):
        continue
    if not author or len(author) > 30:
        continue
    if diff not in DIFF or DIFF[diff] in ('Auto', 'Demon'):
        continue
    if stars < 1 or downloads < 2000 or downloads >= 999999999 or likes < 0 or likes > 50000000:
        continue
    if h.get('is_deleted') or h.get('is_public') is False or h.get('cache_search_available') is False:
        continue
    if h.get('cache_level_string_available') is False:
        continue
    flags = 0
    if int(h.get('cache_featured') or 0) > 0: flags |= 1
    if int(h.get('cache_epic') or 0) > 0: flags |= 2
    if h.get('cache_two_player') is True: flags |= 4
    level_len = int(h.get('cache_length') or 0)
    levels.append({
        'id': str(h['online_id']),
        'name': name,
        'author': author,
        'account': str(h.get('cache_account_id') or 0),
        'stars': stars,
        'diff': diff,
        'len': level_len if level_len in LEN else 0,
        'downloads': downloads,
        'likes': likes,
        'song': str(h.get('cache_song_id') or 0),
        # GDHistory's audiotrack is 0-based; GDBrowser's officialSong is 1-based.
        'official': int(h.get('cache_audiotrack') or 0) + (1 if int(h.get('cache_audiotrack') or 0) > 0 else 0),
        'flags': flags
    })

levels.sort(key=lambda l: (-l['downloads'], -l['likes']))
if len(levels) > 2600:
    # Keep the famous top levels, but preserve variety across difficulty and songs.
    keep = levels[:1400]
    rest = levels[1400:]
    seen = collections.Counter(l['diff'] for l in keep)
    for l in rest:
        if seen[l['diff']] < 220:
            keep.append(l); seen[l['diff']] += 1
    levels = keep[:2600]
print('  usable catalog levels:', len(levels))
by_id = {l['id']: l for l in levels}

print('Fetching gauntlets from GDBrowser...')
gauntlets_raw = get('https://gdbrowser.com/api/gauntlets') or []
gauntlets = []
gauntlet_ids = []
for g in gauntlets_raw:
    if not isinstance(g, dict) or not g.get('name') or not g.get('levels'):
        continue
    levels_ids = [str(x) for x in g['levels']]
    gauntlets.append({'id': int(g['id']), 'name': str(g['name']), 'levels': levels_ids})
    gauntlet_ids.extend(levels_ids)
print('  gauntlets:', len(gauntlets), 'level ids:', len(gauntlet_ids))

# Resolve gauntlet level names in batches via GDBrowser list search.
print('Resolving gauntlet level names...')
gd_by_id = {}
missing = [gid for gid in gauntlet_ids if gid not in by_id]
for i in range(0, len(missing), 10):
    batch = missing[i:i+10]
    data = get(f'https://gdbrowser.com/api/search/{enc(",".join(batch))}?list')
    if isinstance(data, list):
        for l in data:
            if l and l.get('id'):
                gd_by_id[str(l['id'])] = l
    time.sleep(0.8)
print('  resolved from GDBrowser:', len(gd_by_id))

# Add gauntlet levels that GDHistory did not supply, using verified GDBrowser fields.
for gid, l in gd_by_id.items():
    if gid in by_id or not l.get('name') or not str(l.get('id')).isdigit():
        continue
    stars = int(l.get('stars') or 0)
    diff_name = str(l.get('difficulty') or '')
    diff_code = next((k for k, v in DIFF.items() if v == diff_name), 0)
    if stars < 1 or not diff_code:
        continue
    sd = str(l.get('downloads') or 0)
    sl = str(l.get('likes') or 0)
    if not sd.isdigit() or not sl.isdigit():
        continue
    flags = 0
    if l.get('featured') is True: flags |= 1
    if l.get('epic') is True: flags |= 2
    if l.get('twoPlayer') is True: flags |= 4
    entry = {
        'id': gid, 'name': str(l['name']), 'author': str(l.get('author') or ''),
        'account': str(l.get('accountID') or 0), 'stars': stars, 'diff': diff_code,
        'len': {'Tiny':0,'Short':1,'Medium':2,'Long':3,'XL':4,'Plat':5}.get(str(l.get('length')), 0),
        'downloads': int(sd), 'likes': int(sl), 'song': str(l.get('songID') or 0),
        'official': int(l.get('officialSong') or 0), 'flags': flags
    }
    levels.append(entry)
    by_id[gid] = entry

print('Fetching song names from GDBrowser...')
song_counts = collections.Counter(l['song'] for l in levels if l['song'] not in ('0','') and l['official'] == 0)
official_counts = collections.Counter(l['official'] for l in levels if l['official'] > 0)
song_examples = {}
for sid, _ in song_counts.most_common(18):
    ex = next((l for l in levels if l['song'] == sid), None)
    if ex: song_examples[sid] = ex['id']
for oid, _ in official_counts.most_common(8):
    ex = next((l for l in levels if l['official'] == oid), None)
    if ex: song_examples[f'o{oid}'] = ex['id']

song_names = {}
pending = [(key, lid) for key, lid in song_examples.items() if lid not in gd_by_id]
for i in range(0, len(pending), 10):
    batch = pending[i:i+10]
    data = get(f'https://gdbrowser.com/api/search/{enc(",".join(x[1] for x in batch))}?list')
    if isinstance(data, list):
        for l in data:
            if l and l.get('id'):
                gd_by_id[str(l['id'])] = l
    time.sleep(0.8)
for key, lid in song_examples.items():
    l = gd_by_id.get(lid)
    if l and l.get('songName'):
        song_names[key] = str(l['songName'])

songs = []
for sid, _ in song_counts.most_common(14):
    name = song_names.get(sid)
    if not name or len(name) > 50: continue
    ex = song_examples[sid]
    el = by_id.get(ex)
    songs.append({'id': sid, 'name': name, 'example': el['name'] if el else '', 'count': song_counts[sid]})
for oid, _ in official_counts.most_common(6):
    name = song_names.get(f'o{oid}')
    if not name or len(name) > 50: continue
    ex = song_examples[f'o{oid}']
    el = by_id.get(ex)
    songs.append({'official': oid, 'name': name, 'example': el['name'] if el else '', 'count': official_counts[oid]})
# Deduplicate by display name.
seen_songs = set()
songs = [s for s in songs if not (s['name'].lower() in seen_songs or seen_songs.add(s['name'].lower()))]
print('  songs:', len(songs))

print('Fetching Pointercrate Demon List...')
# Pointercrate caps limit at 100. Three pages cover both list position and
# rated rank 1-150 (they differ for some demons).
pc = []
for url in [
    'https://pointercrate.com/api/v2/demons/listed/?limit=100',
    'https://pointercrate.com/api/v2/demons/listed/?limit=50&after=100',
    'https://pointercrate.com/api/v2/demons/listed/?limit=50&after=150',
]:
    page = get(url)
    if isinstance(page, list):
        pc.extend(page)
demons = []
for d in pc:
    position = int(d.get('position') or 0)
    rated = int(d.get('rated_position') or 0)
    if position > 150 and rated > 150:
        continue
    demons.append({
        'name': d.get('name'), 'id': str(d.get('level_id') or ''),
        'pos': position, 'rated': rated
    })
print('  demons:', len(demons))

print('Selecting creators...')
creator_counts = collections.Counter(l['account'] for l in levels if l['account'] not in ('0','', 'None'))
creators = []
for acct, count in creator_counts.most_common(30):
    ex = next(l for l in levels if l['account'] == acct)
    if count < 6 or len(ex['author']) > 20: continue
    creators.append({'account': acct, 'name': ex['author'], 'count': count, 'example': ex['name']})
creators = creators[:12]
print('  creators:', [c['name'] for c in creators])

os.makedirs(OUT, exist_ok=True)
compact = [
    [l['id'], l['name'], l['author'], l['account'], l['stars'], l['diff'], l['len'],
     l['downloads'], l['likes'], l['song'], l['official'], l['flags']]
    for l in levels
]
data = {
    'levels': compact,
    'gauntlets': gauntlets,
    'songs': songs,
    'demons': demons,
    'creators': creators
}
path = f'{OUT}/catalog.js'
with open(path, 'w', encoding='utf8') as f:
    f.write('/* Verified GD Krillion data snapshot. Generated from GDHistory, GDBrowser and Pointercrate.\n')
    f.write(' * Do not edit by hand — regenerate with build-catalog.py.\n */\n')
    f.write('window.GDK_DATA = ')
    json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
    f.write(';\n')
print('Wrote', path, os.path.getsize(path), 'bytes')
