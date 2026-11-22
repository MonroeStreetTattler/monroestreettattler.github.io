const origins = new Set([
  'https://monroestreettattler.com',
  'https://www.monroestreettattler.com',
  'https://monroestreettattler.github.io',
]);
const blocked = new Set([
  'ASS', 'BCH', 'BJZ', 'CNT', 'COC', 'COX', 'CUM', 'DIK', 'FAG', 'FCK', 'FKN', 'FKU', 'FUC',
  'JIZ', 'KKK', 'KYS', 'NGR', 'NIG', 'PNS', 'PUS', 'SEX', 'SHT', 'SLT', 'TIT', 'WTF',
]);
const validMode = mode => mode === 'normal' || mode === 'speed';
const validId = id => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
const integerInRange = (value, max) => Number.isSafeInteger(value) && value >= 0 && value <= max;

async function board(db, mode) {
  const [count, scores] = await db.batch([
    db.prepare('SELECT plays FROM play_counts WHERE mode = ?').bind(mode),
    db.prepare('SELECT initials, score, delivered FROM runs WHERE mode = ? AND score IS NOT NULL ORDER BY score DESC, finished_at, id LIMIT 25').bind(mode),
  ]);
  return { plays: count.results[0]?.plays ?? 0, scores: scores.results };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const headers = {
      'Cache-Control': 'no-store',
      Vary: 'Origin',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };
    if (origins.has(origin)) headers['Access-Control-Allow-Origin'] = origin;
    const json = (body, status = 200) => Response.json(body, { status, headers });

    if (origin && !origins.has(origin)) return json({ error: 'Origin not allowed' }, 403);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/board') {
      const mode = url.searchParams.get('mode') ?? 'normal';
      if (!validMode(mode)) return json({ error: 'Invalid mode' }, 400);
      return json(await board(env.DB, mode));
    }
    if (request.method !== 'POST' || !['/runs', '/scores'].includes(url.pathname)) {
      return json({ error: 'Not found' }, 404);
    }
    if (!origins.has(origin)) return json({ error: 'Origin required' }, 403);

    const raw = await request.text();
    if (raw.length > 1024) return json({ error: 'Request too large' }, 413);
    let run;
    try { run = JSON.parse(raw); } catch { return json({ error: 'Invalid JSON' }, 400); }
    if (!run || !validId(run.id) || !validMode(run.mode)) return json({ error: 'Invalid run' }, 400);

    if (url.pathname === '/runs') {
      await env.DB.prepare('INSERT OR IGNORE INTO runs (id, mode) VALUES (?, ?)').bind(run.id, run.mode).run();
      return json(await board(env.DB, run.mode));
    }

    const { id, mode, initials, score, delivered, perfects, longest, litter } = run;
    if (typeof initials !== 'string' || !/^[A-Z]{3}$/.test(initials) || blocked.has(initials)
      || !integerInRange(score, 100000) || !integerInRange(delivered, 150)
      || !integerInRange(perfects, delivered) || !integerInRange(longest, delivered)
      || !integerInRange(litter, 100000)) {
      return json({ error: 'Invalid score or initials' }, 400);
    }
    const saved = await env.DB.prepare(`
      UPDATE runs SET initials = ?, score = ?, delivered = ?, perfects = ?, longest = ?, litter = ?, finished_at = unixepoch()
      WHERE id = ? AND mode = ? AND finished_at IS NULL
      RETURNING id
    `).bind(initials, score, delivered, perfects, longest, litter, id, mode).first();
    if (!saved) {
      const prior = await env.DB.prepare('SELECT initials, score FROM runs WHERE id = ? AND mode = ?').bind(id, mode).first();
      if (prior?.initials !== initials || prior?.score !== score) return json({ error: 'Run unavailable' }, 409);
    }
    return json(await board(env.DB, mode));
  },
};
