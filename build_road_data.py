#!/usr/bin/env python3
"""Build the offline road network for EV-loki (range along roads).

Input : an OPL text file of OpenStreetMap roads, made by the workflow with osmium-tool:
          osmium tags-filter finland-latest.osm.pbf w/highway=motorway,...,tertiary_link -o roads.osm.pbf
          osmium cat roads.osm.pbf -f opl,add_metadata=false -o roads.opl
Output (--out, default ./roads):
  meta.json      counts and build info
  roads.bin.gz   little-endian int32 arrays, one after another:
                   nodes  N × (lon·1e5, lat·1e5)          junctions and road ends
                   edges  E × (a, b, metres, km/h, class, geomStart, geomCount)
                   geom   G × (lon·1e5, lat·1e5)          points between the two ends of an edge
Classes: 1 motorway, 2 trunk (valtatie), 3 primary (kantatie), 4 secondary (seututie), 5 tertiary (yhdystie).
Data © OpenStreetMap contributors, ODbL.
"""
import argparse, gzip, json, math, os, struct, sys, time
from collections import defaultdict

CLASS = {'motorway': 1, 'trunk': 2, 'primary': 3, 'secondary': 4, 'tertiary': 5}
DEFAULT_KMH = {1: 120, 2: 100, 3: 80, 4: 80, 5: 60}
LINK_KMH = 50
SIMPLIFY_M = 25.0      # Douglas-Peucker tolerance for the drawn shape
MIN_COMPONENT = 100    # drop small road islands (nodes)


def log(*a):
    print(time.strftime('%H:%M:%S'), *a, flush=True)


def parse_tags(s):
    out = {}
    for kv in s.split(','):
        if '=' in kv:
            k, v = kv.split('=', 1)
            out[k.replace('%20%', ' ')] = v.replace('%20%', ' ').replace('%2c%', ',')
    return out


def maxspeed(v, cls, link):
    if v:
        v = v.split(';')[0].strip()
        if v.isdigit():
            return int(v)
        if v.endswith('mph') and v[:-3].strip().isdigit():
            return round(int(v[:-3]) * 1.609)
        named = {'FI:urban': 50, 'FI:rural': 80, 'FI:motorway': 120, 'FI:living_street': 20}
        if v in named:
            return named[v]
    return LINK_KMH if link else DEFAULT_KMH[cls]


def hav(a, b):
    R = 6371008.8
    la1, lo1, la2, lo2 = map(math.radians, (a[1] / 1e5, a[0] / 1e5, b[1] / 1e5, b[0] / 1e5))
    s = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * R * math.asin(math.sqrt(s))


def simplify(pts, tol):
    """Douglas-Peucker on lon/lat·1e5 points, tolerance in metres (local flat projection)."""
    if len(pts) < 3:
        return pts
    k = math.cos(math.radians(pts[0][1] / 1e5)) * 1.11195   # metres per 1e-5 degree of longitude
    P = [(p[0] * k, p[1] * 1.11195) for p in pts]
    keep = [False] * len(pts); keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        i, j = stack.pop()
        ax, ay = P[i]; bx, by = P[j]; dx, dy = bx - ax, by - ay; L2 = dx * dx + dy * dy
        best, bi = -1.0, -1
        for m in range(i + 1, j):
            px, py = P[m]
            if L2 == 0:
                d = math.hypot(px - ax, py - ay)
            else:
                t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / L2))
                d = math.hypot(px - ax - t * dx, py - ay - t * dy)
            if d > best:
                best, bi = d, m
        if best > tol:
            keep[bi] = True; stack.append((i, bi)); stack.append((bi, j))
    return [p for p, f in zip(pts, keep) if f]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--opl', required=True)
    ap.add_argument('--out', default='roads')
    a = ap.parse_args()

    log('reading', a.opl)
    nodes = {}
    ways = []          # (refs, cls, kmh)
    with open(a.opl, encoding='utf-8') as f:
        for line in f:
            if line[0] == 'n':
                parts = line.split()
                x = y = None
                for p in parts[1:]:
                    if p[0] == 'x' and len(p) > 1:
                        x = p[1:]
                    elif p[0] == 'y' and len(p) > 1:
                        y = p[1:]
                if x and y:
                    nodes[int(parts[0][1:])] = (round(float(x) * 1e5), round(float(y) * 1e5))
            elif line[0] == 'w':
                parts = line.split()
                tags, refs = {}, []
                for p in parts[1:]:
                    if p[0] == 'T':
                        tags = parse_tags(p[1:])
                    elif p[0] == 'N' and len(p) > 1:
                        refs = [int(r[1:]) for r in p[1:].split(',') if r]
                hw = tags.get('highway', '')
                link = hw.endswith('_link')
                cls = CLASS.get(hw[:-5] if link else hw)
                if cls and len(refs) >= 2:
                    ways.append((refs, cls, maxspeed(tags.get('maxspeed'), cls, link)))
    log(len(nodes), 'nodes,', len(ways), 'ways')

    # graph nodes: road ends and nodes shared by two or more roads (junctions)
    use = defaultdict(int)
    for refs, _, _ in ways:
        for r in refs:
            use[r] += 1
        use[refs[0]] += 1; use[refs[-1]] += 1
    gid = {}
    gnodes = []
    def g(ref):
        if ref not in gid:
            gid[ref] = len(gnodes); gnodes.append(nodes[ref])
        return gid[ref]

    edges, geom = [], []
    for refs, cls, kmh in ways:
        refs = [r for r in refs if r in nodes]
        if len(refs) < 2:
            continue
        start = 0
        for i in range(1, len(refs)):
            if use[refs[i]] >= 2 or i == len(refs) - 1:
                piece = [nodes[r] for r in refs[start:i + 1]]
                m = sum(hav(piece[k], piece[k + 1]) for k in range(len(piece) - 1))
                if m > 0.5:
                    mid = simplify(piece, SIMPLIFY_M)[1:-1]
                    edges.append([g(refs[start]), g(refs[i]), round(m), kmh, cls, len(geom), len(mid)])
                    geom.extend(mid)
                start = i
    log(len(gnodes), 'graph nodes,', len(edges), 'edges,', len(geom), 'shape points')

    # keep connected pieces of at least MIN_COMPONENT nodes
    parent = list(range(len(gnodes)))
    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]; x = parent[x]
        return x
    for e in edges:
        ra, rb = find(e[0]), find(e[1])
        if ra != rb:
            parent[ra] = rb
    size = defaultdict(int)
    for i in range(len(gnodes)):
        size[find(i)] += 1
    keepn = [size[find(i)] >= MIN_COMPONENT for i in range(len(gnodes))]
    newid, nn = {}, []
    for i, k in enumerate(keepn):
        if k:
            newid[i] = len(nn); nn.append(gnodes[i])
    ne, ng = [], []
    for e in edges:
        if keepn[e[0]]:
            pts = geom[e[5]:e[5] + e[6]]
            ne.append([newid[e[0]], newid[e[1]], e[2], e[3], e[4], len(ng), len(pts)]); ng.extend(pts)
    log(len(nn), 'nodes and', len(ne), 'edges kept')

    os.makedirs(a.out, exist_ok=True)
    buf = bytearray()
    for p in nn:
        buf += struct.pack('<ii', *p)
    for e in ne:
        buf += struct.pack('<7i', *e)
    for p in ng:
        buf += struct.pack('<ii', *p)
    with gzip.open(os.path.join(a.out, 'roads.bin.gz'), 'wb', compresslevel=9) as f:
        f.write(bytes(buf))
    km = sum(e[2] for e in ne) / 1000
    meta = {'built': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'source': 'OpenStreetMap contributors (ODbL)',
            'nodes': len(nn), 'edges': len(ne), 'geom': len(ng), 'km': round(km), 'classes': 'motorway, trunk, primary, secondary, tertiary',
            'bytes': os.path.getsize(os.path.join(a.out, 'roads.bin.gz'))}
    with open(os.path.join(a.out, 'meta.json'), 'w') as f:
        json.dump(meta, f)
    log('done:', meta)


if __name__ == '__main__':
    main()
