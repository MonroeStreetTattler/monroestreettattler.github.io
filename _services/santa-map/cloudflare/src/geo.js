// The coverage area: every point within radius_m of the configured street lines.
// A port of ../../santa_map/geo.py. The outline is prebuilt by scripts/build_area.py.

import DATA from './area-data.js';

const EARTH_M = 6371008.8;
const K = Math.PI / 180 * EARTH_M;
const COS0 = Math.cos(DATA.lat0 * Math.PI / 180);

// A local flat projection is accurate to well under a metre across a few kilometres.
function xy(lat, lon) {
  return [lon * K * COS0, lat * K];
}

const SEGMENTS = DATA.lines.flatMap((line) =>
  line.slice(1).map((b, i) => [xy(line[i][0], line[i][1]), xy(b[0], b[1])]));

export function distanceM(lat, lon) {
  const [px, py] = xy(lat, lon);
  let best = Infinity;
  for (const [[ax, ay], [bx, by]] of SEGMENTS) {
    const dx = bx - ax, dy = by - ay;
    const t = dx === 0 && dy === 0 ? 0
      : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
    best = Math.min(best, Math.hypot(px - (ax + t * dx), py - (ay + t * dy)));
  }
  return best;
}

export function contains(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  return distanceM(lat, lon) <= DATA.radius_m;
}

export const AREA = DATA.area;
