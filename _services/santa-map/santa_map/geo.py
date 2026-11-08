"""The coverage area: every point within radius_m of the configured street lines."""

import json
import math

EARTH_M = 6371008.8


def load_boundary(path):
    with open(path, encoding='utf-8') as f:
        data = json.load(f)
    radius = float(data['radius_m'])
    lines = [[(p['lat'], p['lon']) for p in line['points']] for line in data['lines']]
    if radius <= 0 or not lines or any(len(line) < 2 for line in lines):
        raise ValueError('boundary needs a positive radius_m and lines of two or more points')
    return Boundary(lines, radius, data.get('name', 'Coverage area'))


class Boundary:
    def __init__(self, lines, radius_m, name):
        self.lines, self.radius_m, self.name = lines, radius_m, name
        lats = [p[0] for line in lines for p in line]
        self.lat0 = sum(lats) / len(lats)

    # A local flat projection is accurate to well under a metre across a few kilometres.
    def _xy(self, lat, lon):
        k = math.pi / 180 * EARTH_M
        return lon * k * math.cos(math.radians(self.lat0)), lat * k

    def _latlon(self, x, y):
        k = math.pi / 180 * EARTH_M
        return y / k, x / (k * math.cos(math.radians(self.lat0)))

    def distance_m(self, lat, lon):
        px, py = self._xy(lat, lon)
        best = float('inf')
        for line in self.lines:
            for (a, b) in zip(line, line[1:]):
                ax, ay = self._xy(*a)
                bx, by = self._xy(*b)
                dx, dy = bx - ax, by - ay
                t = 0.0 if dx == dy == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
                best = min(best, math.hypot(px - (ax + t * dx), py - (ay + t * dy)))
        return best

    def contains(self, lat, lon):
        if not (math.isfinite(lat) and math.isfinite(lon)):
            return False
        return self.distance_m(lat, lon) <= self.radius_m

    def bounds(self):
        """South-west and north-east corners of the whole area."""
        xs, ys = [], []
        for line in self.lines:
            for p in line:
                x, y = self._xy(*p)
                xs.append(x)
                ys.append(y)
        r = self.radius_m
        return [list(self._latlon(min(xs) - r, min(ys) - r)), list(self._latlon(max(xs) + r, max(ys) + r))]

    def outline_rings(self, step_m=25):
        """The edge of the area as closed rings, traced from the same distance rule the
        server enforces (marching squares on a step_m grid), so the drawn line and the
        saving rule cannot disagree by more than a few metres."""
        if getattr(self, '_rings', None) is not None:
            return self._rings
        xs, ys = zip(*[self._xy(*p) for line in self.lines for p in line])
        pad = self.radius_m + 2 * step_m
        x0, y0 = min(xs) - pad, min(ys) - pad
        nx = int((max(xs) + pad - x0) / step_m) + 1
        ny = int((max(ys) + pad - y0) / step_m) + 1
        segments = [[(self._xy(*a), self._xy(*b)) for a, b in zip(line, line[1:])] for line in self.lines]
        segments = [s for line in segments for s in line]

        def field(i, j):
            px, py = x0 + i * step_m, y0 + j * step_m
            best = float('inf')
            for (ax, ay), (bx, by) in segments:
                dx, dy = bx - ax, by - ay
                t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
                best = min(best, math.hypot(px - ax - t * dx, py - ay - t * dy))
            return best - self.radius_m           # negative inside

        v = [[field(i, j) for j in range(ny)] for i in range(nx)]

        def cross(edge):
            kind, i, j = edge
            i2, j2 = (i + 1, j) if kind == 'h' else (i, j + 1)
            a, b = v[i][j], v[i2][j2]
            t = a / (a - b)
            return (x0 + (i + t * (i2 - i)) * step_m, y0 + (j + t * (j2 - j)) * step_m)

        links = {}
        for i in range(nx - 1):
            for j in range(ny - 1):
                corners = [v[i][j] < 0, v[i + 1][j] < 0, v[i + 1][j + 1] < 0, v[i][j + 1] < 0]
                edges = [('h', i, j), ('v', i + 1, j), ('h', i, j + 1), ('v', i, j)]   # bottom, right, top, left
                cut = [edges[k] for k in range(4) if corners[k] != corners[(k + 1) % 4]]
                if len(cut) == 4:                   # saddle: pair edges by the centre's side
                    centre = (v[i][j] + v[i + 1][j] + v[i + 1][j + 1] + v[i][j + 1]) / 4 < 0
                    pairs = [(cut[0], cut[3]), (cut[1], cut[2])] if centre == corners[0] else [(cut[0], cut[1]), (cut[2], cut[3])]
                elif len(cut) == 2:
                    pairs = [(cut[0], cut[1])]
                else:
                    pairs = []
                for a, b in pairs:
                    links.setdefault(a, []).append(b)
                    links.setdefault(b, []).append(a)

        rings, used = [], set()
        for start in links:
            if start in used:
                continue
            ring, prev, cur = [], None, start
            while cur not in used:
                used.add(cur)
                ring.append(cross(cur))
                nxt = [e for e in links[cur] if e != prev and e not in used]
                prev, cur = cur, (nxt[0] if nxt else start)
            if len(ring) > 2:
                rings.append([[round(lat, 6), round(lon, 6)] for lat, lon in (self._latlon(x, y) for x, y in ring)])
        self._rings = rings
        return rings
