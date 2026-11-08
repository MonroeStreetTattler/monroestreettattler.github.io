// The 33 scenarios of ../../tests/test_santa_map.py, run against the Worker and a real
// local D1 database instead of the Python service. Same names, same expectations.
//
// Run from _services/santa-map/cloudflare:  npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MONROE_2100, MONROE_2500, ORIGIN, TOKEN, key, start } from './helpers.js';

function scenario(name, fn, opts = {}) {
  test(name, async () => {
    const w = await start(opts);
    try {
      await fn(w);
    } finally {
      await w.close();
    }
  });
}

async function counts(w) {
  return [await w.scalar('SELECT COUNT(*) FROM submissions'),
    await w.scalar('SELECT COALESCE(SUM(report_count), 0) FROM displays'),
    await w.scalar('SELECT COUNT(*) FROM corrections')];
}

async function assertAgreesWithSnapshot(w, reply) {
  const snap = (await w.call('GET', '/api/santas')).body;
  assert.deepEqual(reply.totals, snap.totals);
  if (reply.display !== null) assert.ok(snap.displays.some((d) => JSON.stringify(d) === JSON.stringify(reply.display)));
}

// ------------------------------------------------------------- SubmissionTests
scenario('matching and other save with their own counts', async (w) => {
  let r = await w.matching();
  assert.equal(r.status, 201);
  assert.equal(r.body.outcome, 'created');
  assert.equal(r.body.display.address, MONROE_2500.address);
  assert.deepEqual(r.body.totals, { matching: 1, other: 0 });
  r = await w.other('3700 Nakoma Rd');
  assert.equal(r.status, 201);
  assert.equal(r.body.display.description, 'Waving Santa with a sack');
  assert.deepEqual(r.body.totals, { matching: 1, other: 1 });
});

scenario('required fields', async (w) => {
  const cases = [
    [{ category: 'matching', address: '2500 Monroe St', idempotency_key: key() }, 'confirm_required'],
    [{ category: 'matching', address: '', confirm_match: true, idempotency_key: key() }, 'address_required'],
    [{ category: 'other', address: '2500 Monroe St', idempotency_key: key() }, 'description_required'],
    [{ category: 'reindeer', address: '2500 Monroe St', idempotency_key: key() }, 'bad_category'],
    [{ category: 'matching', address: '2500 Monroe St', confirm_match: true, quantity: 0, idempotency_key: key() }, 'bad_quantity'],
    [{ category: 'matching', address: '2500 Monroe St', confirm_match: true, quantity: '2', idempotency_key: key() }, 'bad_quantity'],
    [{ category: 'matching', address: '2500 Monroe St', confirm_match: true }, 'bad_key'],
  ];
  for (const [body, code] of cases) {
    const r = await w.call('POST', '/api/sightings', body);
    assert.deepEqual([r.status, r.body.error], [400, code], code);
  }
  assert.deepEqual(await w.totals(), { matching: 0, other: 0 });
});

scenario('not found, ambiguous and out of area are explained and not saved', async (w) => {
  let r = await w.matching('99999 Nowhere Ln');
  assert.deepEqual([r.status, r.body.error], [422, 'not_found']);
  r = await w.matching('Monroe St');
  assert.deepEqual([r.status, r.body.error], [422, 'ambiguous']);
  assert.equal(r.body.candidates.length, 2);
  for (const far of ['2 E Main St', '702 N Midvale Blvd']) {
    r = await w.matching(far);
    assert.deepEqual([r.status, r.body.error], [422, 'out_of_area']);
    assert.match(r.body.message, /Nakoma/);
  }
  assert.deepEqual(await w.totals(), { matching: 0, other: 0 });
  r = await w.matching(MONROE_2500.address);         // picking one of the offered candidates then works
  assert.equal(r.status, 201);
});

scenario('preview resolves without saving and biases to Madison', async (w) => {
  const r = await w.call('POST', '/api/preview', { address: '  2500   Monroe St ' });
  assert.equal(r.status, 200);
  assert.equal(r.body.place.address, MONROE_2500.address);
  const { queryFor } = await import('../src/geocoder.js');
  assert.equal(queryFor('2500 Monroe St'), '2500 Monroe St, Madison, WI');
  assert.equal(queryFor('2500 Monroe St 53711'), '2500 Monroe St 53711');
  assert.deepEqual(await w.totals(), { matching: 0, other: 0 });
});

scenario('repeat reports confirm without adding', async (w) => {
  await w.matching();
  const r = await w.matching('2500 MONROE ST, MADISON, WI, 53711');     // same property, typed differently
  assert.deepEqual([r.status, r.body.outcome], [200, 'confirmed']);
  await w.other('3700 Nakoma Rd');
  await w.other('3700 Nakoma Rd', 'Different words for the same Santa');
  assert.deepEqual(await w.totals(), { matching: 1, other: 1 });
  assert.equal((await w.call('GET', '/api/santas')).body.displays.length, 2);
});

scenario('retry with same key returns first answer once', async (w) => {
  const k = key();
  const first = (await w.matching('2500 Monroe St', 1, { k })).body;
  const again = await w.matching('2500 Monroe St', 1, { k });
  assert.equal(again.status, 200);
  assert.equal(again.body.repeat, true);
  assert.deepEqual(again.body.display, first.display);
  assert.equal(again.body.outcome, 'created');
  assert.equal(await w.scalar('SELECT COUNT(*) FROM submissions'), 1);
  assert.equal(await w.scalar('SELECT report_count FROM displays'), 1);
});

scenario('simultaneous duplicates make one display', async (w) => {
  const sameKey = key();
  const keys = [...Array.from({ length: 8 }, key), ...Array(4).fill(sameKey)];
  const results = (await Promise.all(keys.map((k) => w.matching('2500 Monroe St', 1, { k })))).map((r) => r.body);
  assert.equal(results.length, 12);
  assert.equal(results.filter((r) => r.outcome === 'created' && !r.repeat).length, 1);
  assert.deepEqual(await w.totals(), { matching: 1, other: 0 });
  assert.equal(await w.scalar('SELECT COUNT(*) FROM displays'), 1);
  assert.equal(await w.scalar('SELECT COUNT(*) FROM submissions'), 9);
});

scenario('conflicting count goes to editor not the map', async (w) => {
  await w.matching('2500 Monroe St', 1);
  const r = await w.matching('2500 Monroe St', 3);
  assert.equal(r.body.outcome, 'review');
  assert.equal(r.body.display.quantity, 1);
  assert.equal((await w.totals()).matching, 1);
  await w.matching('2500 Monroe St', 3);              // the same disagreement is not queued twice
  const queue = (await w.admin('GET', '/api/admin/corrections')).body.corrections;
  assert.deepEqual(queue.map((c) => [c.kind, c.proposed_quantity]), [['conflicting_report', 3]]);
});

scenario('several Santas and both kinds at one property', async (w) => {
  await w.matching('2500 Monroe St', 3);
  await w.other();
  await w.matching('2100 Monroe St');
  const body = (await w.call('GET', '/api/santas')).body;
  assert.deepEqual(body.totals, { matching: 4, other: 1 });
  const at2500 = body.displays.filter((d) => d.address === MONROE_2500.address);
  assert.deepEqual(at2500.map((d) => d.category).sort(), ['matching', 'other']);
});

scenario('geocoder down saves nothing and says so', async (w) => {
  w.geocoder.down = true;
  const r = await w.matching();
  assert.deepEqual([r.status, r.body.error], [503, 'geocoder_unavailable']);
  assert.ok(!('totals' in r.body));
  w.geocoder.down = false;
  assert.deepEqual(await w.totals(), { matching: 0, other: 0 });
});

// ------------------------------------------------------------ PersistenceTests
scenario('shared across clients and restart without re-geocoding', async (w) => {
  await w.matching('2500 Monroe St', 1, { ip: '198.51.100.1' });
  await w.other('3700 Nakoma Rd');
  const calls = w.geocoder.calls;
  await w.restart();
  let body;
  for (let i = 0; i < 3; i++) body = (await w.call('GET', '/api/santas', undefined, { ip: '198.51.100.2' })).body;
  assert.deepEqual(body.totals, { matching: 1, other: 1 });
  assert.equal(w.geocoder.calls, calls);           // loads never look addresses up
});

scenario('same address is looked up once', async (w) => {
  await w.call('POST', '/api/preview', { address: '2500 Monroe St' });
  await w.matching();
  await w.other();
  assert.equal(w.geocoder.calls, 1);
});

scenario('client coordinates are ignored', async (w) => {
  const r = await w.matching('2500 Monroe St', 1, { lat: 43.0, lon: -89.0, season: 1999 });
  assert.equal(r.status, 201);
  assert.deepEqual([r.body.display.lat, r.body.display.lon], [MONROE_2500.lat, MONROE_2500.lon]);
  assert.equal(r.body.season, 2026);
});

scenario('seasons are kept apart', async (w) => {
  await w.matching();
  await w.restart({ season: '2027' });
  assert.deepEqual(await w.totals(), { matching: 0, other: 0 });
  await w.restart({ season: '2026' });
  assert.deepEqual(await w.totals(), { matching: 1, other: 0 });
});

// ----------------------------------------------------------------- EditorTests
scenario('editor API needs the token', async (w) => {
  for (const token of [null, 'wrong', TOKEN.slice(0, -1)]) {
    assert.equal((await w.admin('GET', '/api/admin/corrections', undefined, token)).status, 401, String(token));
  }
  await w.restart({ token: null });
  assert.equal((await w.admin('GET', '/api/admin/export')).status, 403);
  await w.restart({ token: 'short' });              // too short to count as configured
  assert.equal((await w.admin('GET', '/api/admin/export', undefined, 'short')).status, 403);
});

scenario('failed editor logins are limited', async (w) => {
  const statuses = [];
  for (let i = 0; i < 12; i++) statuses.push((await w.admin('GET', '/api/admin/export', undefined, 'guess')).status);
  assert.deepEqual(statuses.slice(0, 10), Array(10).fill(401));
  assert.deepEqual(statuses.slice(10), [429, 429]);
});

scenario('editor API has no CORS', async (w) => {
  const r = await w.call('GET', '/api/admin/export', undefined, { headers: { Origin: ORIGIN, Authorization: 'Bearer ' + TOKEN } });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), null);
});

scenario('correction requests change nothing until an editor acts', async (w) => {
  const display = (await w.matching('2500 Monroe St', 2)).body.display;
  let r = await w.call('POST', '/api/corrections', { display_id: display.id, kind: 'removed' });
  assert.equal(r.status, 202);
  assert.equal((await w.totals()).matching, 2);
  const queue = (await w.admin('GET', '/api/admin/corrections')).body.corrections;
  assert.equal(queue[0].kind, 'removed');
  r = await w.admin('POST', `/api/admin/displays/${display.id}`, { status: 'hidden', correction_id: queue[0].id });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.totals, { matching: 0, other: 0 });
  assert.deepEqual((await w.call('GET', '/api/santas')).body.displays, []);
  assert.deepEqual((await w.admin('GET', '/api/admin/corrections')).body.corrections, []);
  const exported = (await w.admin('GET', '/api/admin/export')).body;
  assert.equal(exported.displays.length, 1);                 // kept, only hidden
  assert.equal(exported.audit_log[0].action, 'edit_display');
  const body = (await w.matching('2500 Monroe St', 2)).body;   // a later report of a hidden display waits for the editor
  assert.deepEqual([body.outcome, body.display], ['review', null]);
  assert.equal((await w.totals()).matching, 0);
});

scenario('editor corrections update totals', async (w) => {
  const display = (await w.matching('2500 Monroe St', 1)).body.display;
  await w.admin('POST', `/api/admin/displays/${display.id}`, { quantity: 3 });
  assert.deepEqual(await w.totals(), { matching: 3, other: 0 });
  await w.admin('POST', `/api/admin/displays/${display.id}`, { category: 'other', description: 'Smaller Santa', quantity: 1 });
  assert.deepEqual(await w.totals(), { matching: 0, other: 1 });
  let r = await w.admin('POST', `/api/admin/displays/${display.id}`, { address: '2100 Monroe St' });
  assert.equal(r.body.display.address, MONROE_2100.address);
  r = await w.admin('POST', `/api/admin/displays/${display.id}`, { address: '2 E Main St' });
  assert.deepEqual([r.status, r.body.error], [422, 'out_of_area']);
});

scenario('editor cannot make a duplicate', async (w) => {
  const a = (await w.matching()).body.display;
  await w.matching('2100 Monroe St');
  const r = await w.admin('POST', `/api/admin/displays/${a.id}`, { address: '2100 Monroe St' });
  assert.equal(r.status, 409);
  assert.equal((await w.totals()).matching, 2);
});

scenario('corrections need a real visible display', async (w) => {
  let r = await w.call('POST', '/api/corrections', { display_id: 'nope', kind: 'removed' });
  assert.equal(r.status, 404);
  const display = (await w.matching()).body.display;
  r = await w.call('POST', '/api/corrections', { display_id: display.id, kind: 'location' });
  assert.deepEqual([r.status, r.body.error], [400, 'message_required']);
});

// ------------------------------------------------------- RetryAfterChangeTests
scenario('retry after hide is not reported on the map', async (w) => {
  const k = key();
  const display = (await w.matching('2500 Monroe St', 1, { k })).body.display;
  await w.admin('POST', `/api/admin/displays/${display.id}`, { status: 'hidden' });
  const before = await counts(w);
  const r = await w.matching('2500 Monroe St', 1, { k });
  assert.equal(r.status, 200);
  assert.equal(r.body.repeat, true);
  assert.equal(r.body.display, null);
  assert.ok(!r.body.message.replace('isn’t on the map', '').includes('on the map.'));
  assert.deepEqual(r.body.totals, { matching: 0, other: 0 });
  await assertAgreesWithSnapshot(w, r.body);
  assert.deepEqual(await counts(w), before);
});

scenario('retry after edits returns the edited display', async (w) => {
  const k = key();
  const display = (await w.matching('2500 Monroe St', 1, { k })).body.display;
  await w.admin('POST', `/api/admin/displays/${display.id}`, { quantity: 3, address: '2100 Monroe St' });
  const before = await counts(w), calls = w.geocoder.calls;
  let reply = (await w.matching('2500 Monroe St', 1, { k })).body;
  assert.equal(reply.display.quantity, 3);
  assert.equal(reply.display.address, MONROE_2100.address);
  assert.deepEqual(reply.totals, { matching: 3, other: 0 });
  await assertAgreesWithSnapshot(w, reply);
  assert.deepEqual(await counts(w), before);
  assert.equal(w.geocoder.calls, calls);              // a retry needs no new lookup
  await w.admin('POST', `/api/admin/displays/${display.id}`, { category: 'other', description: 'Not the model', quantity: 1 });
  reply = (await w.matching('2500 Monroe St', 1, { k })).body;
  assert.equal(reply.display.category, 'other');
  await assertAgreesWithSnapshot(w, reply);
});

scenario('retry after season change is not on this season’s map', async (w) => {
  const k = key();
  await w.matching('2500 Monroe St', 1, { k });
  await w.restart({ season: '2027' });
  const before = await counts(w);
  const reply = (await w.matching('2500 Monroe St', 1, { k })).body;
  assert.equal(reply.display, null);
  assert.deepEqual([reply.season, reply.totals], [2027, { matching: 0, other: 0 }]);
  await assertAgreesWithSnapshot(w, reply);
  assert.deepEqual(await counts(w), before);
});

// The Python test forces the pre-check to miss. Here two attempts with one key really
// both pass the pre-check (each waits for the geocoder); the first then saves, an editor
// hides the display, and only then does the second reach its write batch.
scenario('raced retry uses the same current answer', async (w) => {
  const k = key();
  w.geocoder.hold(2);
  const a = w.matching('2500 Monroe St', 1, { k });
  const b = w.matching('2500 Monroe St', 1, { k });
  await w.geocoder.arrived(2);
  assert.equal(w.geocoder.calls, 2);                  // both passed the pre-check
  w.geocoder.release();
  while (await w.scalar('SELECT COUNT(*) FROM submissions') < 1) await new Promise((r) => setTimeout(r, 10));
  const id = await w.scalar('SELECT public_id FROM displays');
  await w.admin('POST', `/api/admin/displays/${id}`, { status: 'hidden' });
  const before = await counts(w);
  w.geocoder.release();
  const replies = (await Promise.all([a, b])).map((r) => r.body);
  const first = replies.find((r) => !r.repeat), raced = replies.find((r) => r.repeat);
  assert.equal(first.outcome, 'created');
  assert.ok(raced, 'the second attempt took the raced path');
  assert.equal(raced.display, null);
  assert.equal(raced.message, 'We already received this report. That Santa isn’t on the map right now.');
  assert.deepEqual(raced.totals, { matching: 0, other: 0 });
  assert.deepEqual(await counts(w), before);
});

// -------------------------------------------------------- PrivacyAndLimitTests
scenario('public read has only display fields', async (w) => {
  await w.matching('2500 Monroe St', 1, { ip: '192.0.2.55' });
  await w.other();
  const body = (await w.call('GET', '/api/santas')).body;
  assert.deepEqual(Object.keys(body).sort(), ['displays', 'last_report_on', 'season', 'totals']);
  for (const d of body.displays) {
    assert.deepEqual(Object.keys(d).sort(), ['address', 'category', 'description', 'first_reported_on', 'id', 'last_reported_on', 'lat', 'lon', 'quantity']);
  }
  const text = JSON.stringify(body);
  for (const secret of ['192.0.2.55', 'report_count', 'property_key', 'idempotency', 'entered']) assert.ok(!text.includes(secret), secret);
  const stored = JSON.stringify([...await w.rows('SELECT * FROM rate_counts'), ...await w.rows('SELECT * FROM submissions'), ...await w.rows('SELECT * FROM displays')]);
  assert.ok(!stored.includes('192.0.2.55'));          // IPs are only kept as keyed hashes
});

scenario('markup is stored and returned as plain text', async (w) => {
  const evil = '<img src=x onerror=alert(1)><script>x()</script>';
  const r = await w.other('2500 Monroe St', evil);
  assert.equal(r.status, 201);
  assert.equal(r.body.display.description, evil);
  assert.match(r.headers.get('Content-Type'), /^application\/json/);
  assert.equal(r.headers.get('X-Content-Type-Options'), 'nosniff');
});

scenario('input limits', async (w) => {
  let r = await w.other('2500 Monroe St', 'x'.repeat(151));
  assert.deepEqual([r.status, r.body.error], [400, 'description_too_long']);
  r = await w.matching('9'.repeat(121));
  assert.deepEqual([r.status, r.body.error], [400, 'address_too_long']);
  r = await w.call('POST', '/api/sightings', undefined, { raw: '{"a":"' + 'x'.repeat(5000) + '"}' });
  assert.equal(r.status, 413);
  r = await w.call('POST', '/api/sightings', undefined, { raw: 'not json' });
  assert.equal(r.status, 400);
  r = await w.call('POST', '/api/preview');
  assert.equal(r.status, 415);
});

scenario('submissions are rate limited per connection', async (w) => {
  const statuses = [];
  for (let i = 0; i < 14; i++) statuses.push((await w.matching()).status);
  assert.deepEqual(statuses.slice(12), [429, 429]);
  const r = await w.matching();
  assert.ok(r.headers.get('Retry-After'));
  assert.equal((await w.matching('2500 Monroe St', 1, { ip: '198.51.100.9' })).status, 200);   // someone else is unaffected
});

scenario('geocoder daily cap', async (w) => {
  await w.call('POST', '/api/preview', { address: '2500 Monroe St' });
  await w.call('POST', '/api/preview', { address: '2100 Monroe St' });
  let r = await w.call('POST', '/api/preview', { address: '3700 Nakoma Rd' });
  assert.equal(r.status, 429);
  r = await w.call('POST', '/api/preview', { address: '2500 Monroe St' });   // cached still works
  assert.equal(r.status, 200);
}, { vars: { SANTA_GEOCODER_DAILY: '2' } });

scenario('CORS only for the site', async (w) => {
  let r = await w.call('GET', '/api/santas', undefined, { headers: { Origin: ORIGIN } });
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  r = await w.call('GET', '/api/santas', undefined, { headers: { Origin: 'https://example.com' } });
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), null);
});

// The Python service could also serve the site for local review. The Worker serves no
// files at all, so private folders and the page itself are simply not found.
scenario('the Worker serves no site files or private folders', async (w) => {
  for (const path of ['/_services/santa-map/boundary.json', '/_workflow/CURRENT-TASK.md', '/.git/HEAD', '/santa-map.html', '/']) {
    assert.equal((await w.call('GET', path)).status, 404, path);
  }
});

scenario('problem messages never include internals', async (w) => {
  for (const raw of ['"not a dict"', '[1, 2]', 'null']) {
    const r = await w.call('POST', '/api/sightings', undefined, { raw });
    assert.deepEqual([r.status, r.body.error, r.body.message], [400, 'bad_request', 'Send a JSON object.']);
  }
});
