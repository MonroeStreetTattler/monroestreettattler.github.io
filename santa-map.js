/* Santas on Monroe Street: map, counts and sighting form for santa-map.html.

   All data comes from the Santa map API (see _services/santa-map/README.md); its address
   is the santa-map-api meta tag. Counts and pins are only shown after the API answers,
   so an unreachable API never looks like an empty map. Everything visitors submit is
   inserted as text, never as HTML. */
(function () {
  'use strict';

  var API = (document.querySelector('meta[name="santa-map-api"]') || {}).content || '';
  var TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  var ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
  // The whole coverage area (from _services/santa-map/boundary.json), replaced by the API's own once loaded.
  var AREA_BOUNDS = [[43.04131, -89.45362], [43.07493, -89.40307]];
  var REFRESH_MS = 60000;
  var SAVE_TIMEOUT_MS = 15000;
  var ICONS = {
    matching: { src: 'assets/santa-map/santa-matching.png', w: 32, h: 48, box: [44, 52] },
    other: { src: 'assets/santa-map/santa-other.png', w: 24, h: 36, box: [44, 44] }
  };
  var LABEL = { matching: 'Matching 12-foot Santa', other: 'Other Santa' };

  var $ = function (id) { return document.getElementById(id); };
  var els = {
    count: $('match-count'), countLabel: $('match-label'), countNote: $('count-note'), otherCount: $('other-count'),
    toggle: $('other-toggle'), mapStatus: $('map-status'), list: $('santa-list'), listStatus: $('list-status'),
    form: $('santa-form'), title: $('form-title'), otherNote: $('other-note'),
    quantity: $('quantity'), description: $('description'), address: $('address'), find: $('find-address'),
    choices: $('choices'), preview: $('preview'), previewAddress: $('preview-address'), save: $('save'),
    status: $('form-status'), cancel: $('cancel'), done: $('done'), doneMessage: $('done-message'),
    doneAddress: $('done-address'), addAnother: $('add-another'),
    correction: $('correction'), correctionHeading: $('correction-heading'), correctionAddress: $('correction-address'),
    correctionForm: $('correction-form'), correctionKind: $('correction-kind'),
    correctionQuantityWrap: $('correction-quantity-wrap'), correctionQuantity: $('correction-quantity'),
    correctionMessage: $('correction-message'), correctionSend: $('correction-send'),
    correctionCancel: $('correction-cancel'), correctionStatus: $('correction-status')
  };

  // lookup counts address lookups and session counts form openings: an answer is used only while both still match.
  var state = { kind: 'matching', key: null, place: null, saving: false, loadedAt: null, displays: {}, correctionFor: null,
    lookup: 0, session: 0 };
  var map = null, layers = {}, markers = {}, previewMarker = null;

  // ------------------------------------------------------------------ helpers
  function newKey() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    var b = new Uint8Array(16);
    (window.crypto || window.msCrypto).getRandomValues(b);
    return Array.prototype.map.call(b, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
  }

  function api(method, path, body, timeout) {
    if (!API) return Promise.reject({ offline: true });
    var ctrl = window.AbortController ? new AbortController() : null;
    var timer = ctrl && setTimeout(function () { ctrl.abort(); }, timeout || 12000);
    return fetch(API.replace(/\/$/, '') + path, {
      method: method, signal: ctrl && ctrl.signal, cache: 'no-store',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) { data.status = res.status; throw data; }
        return data;
      });
    }, function () { throw { offline: true }; }).finally(function () { if (timer) clearTimeout(timer); });
  }

  function niceDate(iso) {
    if (!iso) return '';
    var p = iso.split('-');
    var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  }

  function clockTime(d) {
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function say(node, text, isError) {
    node.textContent = text || '';
    node.classList.toggle('error', !!isError);
  }

  function describe(d) {
    if (d.category === 'matching') {
      return d.quantity > 1 ? d.quantity + ' matching 12-foot Santas' : 'Matching 12-foot Santa';
    }
    return 'Other Santa';
  }

  // ---------------------------------------------------------------------- map
  function setUpMap() {
    if (!window.L) {
      els.mapStatus.textContent = 'The map couldn’t load. The list of Santas below still works.';
      els.mapStatus.classList.add('warn');
      return;
    }
    map = L.map('map', { scrollWheelZoom: false, zoomSnap: 0.25 });
    L.tileLayer(TILE_URL, { maxZoom: 19, attribution: ATTRIBUTION }).addTo(map);
    map.fitBounds(AREA_BOUNDS);
    layers.matching = L.layerGroup().addTo(map);
    layers.other = L.layerGroup();
  }

  // The coverage area is not drawn; its bounds only frame the map.
  function frameArea(area) {
    if (!map || !area || !area.rings) return;
    if (area.bounds) { AREA_BOUNDS = area.bounds; if (!state.loadedAt) map.fitBounds(AREA_BOUNDS); }
  }

  function icon(kind, shift, preview) {
    var i = ICONS[kind];
    return L.divIcon({
      className: 'santa-marker ' + kind + (preview ? ' preview' : ''),
      html: '<span class="pin"><img src="' + i.src + '" width="' + i.w + '" height="' + i.h + '" alt=""></span>',
      iconSize: i.box,
      iconAnchor: [i.box[0] / 2 - shift, i.box[1] - 2],
      popupAnchor: [shift, -i.h]
    });
  }

  function popupFor(d) {
    var box = el('div');
    box.appendChild(el('p', 'popup-kind', LABEL[d.category]));
    box.appendChild(el('p', 'popup-address', d.address));
    if (d.category === 'other' && d.description) box.appendChild(el('p', null, d.description));
    if (d.category === 'matching') box.appendChild(el('p', null, d.quantity === 1 ? '1 Santa' : d.quantity + ' Santas'));
    box.appendChild(el('p', null, 'Reported ' + niceDate(d.first_reported_on) +
      (d.last_reported_on && d.last_reported_on !== d.first_reported_on ? ' · last reported ' + niceDate(d.last_reported_on) : '')));
    var fix = el('button', 'popup-fix', 'Report a correction or removal');
    fix.type = 'button';
    fix.addEventListener('click', function () { openCorrection(d.id); });
    box.appendChild(fix);
    return box;
  }

  // Two displays at one property (one of each kind) sit side by side instead of on top of each other.
  function shiftFor(d, all) {
    var twin = all.some(function (o) {
      return o.id !== d.id && o.category !== d.category && o.lat === d.lat && o.lon === d.lon;
    });
    return twin ? (d.category === 'matching' ? -13 : 13) : 0;
  }

  function placeMarkers(list) {
    if (!map) return;
    var seen = {};
    list.forEach(function (d) {
      seen[d.id] = true;
      var m = markers[d.id];
      var shift = shiftFor(d, list);
      if (m && m.santaCategory !== d.category) { layers[m.santaCategory].removeLayer(m); m = null; }
      if (!m) {
        m = L.marker([d.lat, d.lon], { icon: icon(d.category, shift), keyboard: true, title: LABEL[d.category] + ': ' + d.address, riseOnHover: true });
        m.santaCategory = d.category;
        m.bindPopup(popupFor(d), { maxWidth: 260, autoPanPaddingTopLeft: [52, 12], autoPanPaddingBottomRight: [12, 24] });
        m.addTo(layers[d.category]);
        markers[d.id] = m;
      } else {
        m.setLatLng([d.lat, d.lon]);
        m.setIcon(icon(d.category, shift));
        m.setPopupContent(popupFor(d));
      }
      var node = m.getElement();
      if (node) { node.setAttribute('aria-label', LABEL[d.category] + ': ' + d.address); node.setAttribute('role', 'button'); }
    });
    Object.keys(markers).forEach(function (id) {
      if (!seen[id]) { layers[markers[id].santaCategory].removeLayer(markers[id]); delete markers[id]; }
    });
  }

  function showOthers(on) {
    els.toggle.checked = on;
    if (map) {
      if (on) layers.other.addTo(map); else map.removeLayer(layers.other);
      // markers added while hidden get their labels once they are in the page
      Object.keys(state.displays).forEach(function (id) {
        var m = markers[id], d = state.displays[id];
        var node = m && m.getElement();
        if (node) { node.setAttribute('aria-label', LABEL[d.category] + ': ' + d.address); node.setAttribute('role', 'button'); }
      });
    }
    renderList();
  }

  // ------------------------------------------------------------ counts & list
  function renderTotals(totals, lastReport) {
    var n = totals.matching;
    els.count.textContent = String(n);
    els.countLabel.textContent = n === 1 ? 'matching 12-foot Santa spotted' : 'matching 12-foot Santas spotted';
    els.countNote.textContent = '2026 season · ' + (lastReport ? 'Last report ' + niceDate(lastReport) : 'No sightings reported yet');
    els.otherCount.textContent = '(' + totals.other + ' more spotted)';
  }

  function renderList() {
    var all = Object.keys(state.displays).map(function (id) { return state.displays[id]; });
    var shown = all.filter(function (d) { return d.category === 'matching' || els.toggle.checked; });
    shown.sort(function (a, b) { return a.address.localeCompare(b.address) || a.category.localeCompare(b.category); });
    els.list.textContent = '';
    shown.forEach(function (d) {
      var li = el('li');
      li.appendChild(el('span', 'item-address', d.address));
      var line = describe(d) + (d.category === 'other' && d.description ? ': ' + d.description : '') +
        ' · Reported ' + niceDate(d.first_reported_on);
      li.appendChild(document.createTextNode(line));
      var actions = el('span', 'item-actions');
      if (map) {
        var show = el('button', null, 'Show on map');
        show.type = 'button';
        show.addEventListener('click', function () {
          var m = markers[d.id];
          if (!m) return;
          map.setView(m.getLatLng(), Math.max(map.getZoom(), 17));
          m.openPopup();
          document.getElementById('map').scrollIntoView({ block: 'center' });
        });
        actions.appendChild(show);
      }
      var fix = el('button', null, 'Report a correction');
      fix.type = 'button';
      fix.addEventListener('click', function () { openCorrection(d.id); });
      actions.appendChild(fix);
      li.appendChild(actions);
      els.list.appendChild(li);
    });
    if (!state.loadedAt) return;
    var hiddenOthers = all.length - shown.length;
    els.listStatus.textContent = shown.length
      ? (hiddenOthers ? 'Turn on “Show all Santas” to include ' + hiddenOthers + ' more.' : '')
      : (hiddenOthers ? 'No matching Santas reported yet. Turn on “Show all Santas” to see the others.' : 'No Santas reported yet this season.');
  }

  function apply(snapshot) {
    state.displays = {};
    snapshot.displays.forEach(function (d) { state.displays[d.id] = d; });
    placeMarkers(snapshot.displays);
    renderTotals(snapshot.totals, snapshot.last_report_on);
    state.loadedAt = new Date();
    renderList();
  }

  function load() {
    return api('GET', '/santas').then(function (snapshot) {
      apply(snapshot);
      els.mapStatus.classList.remove('warn');
      els.mapStatus.textContent = 'Updated ' + clockTime(state.loadedAt) + '.';
    }, function () {
      els.mapStatus.classList.add('warn');
      if (state.loadedAt) {
        els.mapStatus.textContent = 'Couldn’t refresh just now. Showing the map as of ' + clockTime(state.loadedAt) + '.';
      } else {
        els.count.textContent = '–';
        els.countNote.textContent = '2026 season · Count unavailable right now';
        els.otherCount.textContent = '';
        els.mapStatus.textContent = 'The Santa sightings couldn’t be loaded right now. Please try again later.';
        els.listStatus.textContent = 'Sightings are unavailable right now.';
      }
    });
  }

  // --------------------------------------------------------------- sighting form
  function openForm(kind) {
    state.session++;
    state.kind = kind;
    els.done.hidden = true;
    els.form.hidden = false;
    els.form.classList.toggle('is-other', kind === 'other');
    els.title.textContent = kind === 'matching' ? 'Add a matching Santa' : 'Another Santa? Let’s see it!';
    els.otherNote.hidden = kind === 'matching';
    els.form.querySelector('.matching-only').hidden = kind !== 'matching';
    els.form.querySelector('.other-only').hidden = kind === 'matching';
    resetPreview();
    say(els.status, '');
    els.title.focus();
  }

  function resetPreview() {
    state.lookup++;                 // any lookup still on its way is now out of date
    if (els.find.disabled) say(els.status, '');   // and its "Looking up…" message with it
    state.place = null;
    state.key = null;
    els.find.disabled = false;
    els.preview.hidden = true;
    els.choices.hidden = true;
    els.choices.textContent = '';
    if (previewMarker && map) { map.removeLayer(previewMarker); previewMarker = null; }
  }

  function invalid(field, message) {
    field.setAttribute('aria-invalid', 'true');
    say(els.status, message, true);
    field.focus();
    return false;
  }

  function clearInvalid() {
    [els.address, els.description].forEach(function (f) { f.removeAttribute('aria-invalid'); });
  }

  function errorText(err, during) {
    if (err && err.offline) {
      return during === 'save'
        ? 'We couldn’t confirm the save. Your entry is still here. Press “Add this Santa to the map” again; it won’t be added twice.'
        : 'We couldn’t reach the Santa map right now. Your entry is still here; please try again in a minute.';
    }
    return (err && err.message) || 'Something went wrong. Your entry is still here; please try again.';
  }

  function findAddress(value) {
    clearInvalid();
    resetPreview();
    if (value != null) els.address.value = value;
    if (!els.address.value.trim()) return invalid(els.address, 'Please enter the street address of the display.');
    var req = { lookup: state.lookup, session: state.session, kind: state.kind, entered: els.address.value };
    var current = function () {
      return req.lookup === state.lookup && req.session === state.session && req.kind === state.kind &&
        els.address.value === req.entered && !els.form.hidden;
    };
    els.find.disabled = true;
    say(els.status, 'Looking up the address…');
    api('POST', '/preview', { address: req.entered }).then(function (res) {
      if (!current()) return;
      state.place = { entered: req.entered, kind: req.kind, session: req.session,
        address: res.place.address, lat: res.place.lat, lon: res.place.lon };
      state.key = newKey();
      els.previewAddress.textContent = res.place.address;
      els.preview.hidden = false;
      say(els.status, 'Check the pin, then add the Santa.');
      if (map) {
        previewMarker = L.marker([res.place.lat, res.place.lon], { icon: icon(state.kind, 0, true), keyboard: false, interactive: false }).addTo(map);
        map.setView([res.place.lat, res.place.lon], Math.max(map.getZoom(), 16));
      }
    }, function (err) {
      if (!current()) return;
      if (err && err.error === 'ambiguous' && err.candidates) {
        say(els.status, 'That address matches more than one place. Choose the right one:');
        err.candidates.forEach(function (c) {
          var li = el('li'), b = el('button', null, c);
          b.type = 'button';
          b.addEventListener('click', function () { findAddress(c); });
          li.appendChild(b);
          els.choices.appendChild(li);
        });
        els.choices.hidden = false;
      } else {
        els.address.setAttribute('aria-invalid', 'true');
        say(els.status, errorText(err, 'find'), true);
      }
    }).finally(function () {
      if (req.lookup === state.lookup) els.find.disabled = false;
    });
  }

  function save(e) {
    e.preventDefault();
    if (state.saving) return;
    clearInvalid();
    var place = state.place;
    if (!place) return findAddress();
    // Save exactly what was previewed, and only while the form still shows it.
    if (place.entered !== els.address.value || place.kind !== state.kind || place.session !== state.session) {
      resetPreview();
      return invalid(els.address, 'The address changed. Press “Find this address” to check the new one before adding it.');
    }
    var body = { category: place.kind, address: place.entered, idempotency_key: state.key };
    if (place.kind === 'matching') {
      body.confirm_match = true;
      body.quantity = parseInt(els.quantity.value, 10);
    } else {
      if (els.description.value.trim().length < 3) return invalid(els.description, 'Please describe the Santa in a few words.');
      body.description = els.description.value;
    }
    var session = state.session;
    state.saving = true;
    els.save.disabled = true;
    els.save.textContent = 'Saving…';
    say(els.status, 'Saving…');
    api('POST', '/sightings', body, SAVE_TIMEOUT_MS).then(function (res) {
      if (res.display) {
        state.displays[res.display.id] = res.display;
        placeMarkers(Object.keys(state.displays).map(function (id) { return state.displays[id]; }));
      }
      renderTotals(res.totals, Object.keys(state.displays).reduce(function (m, id) {
        var d = state.displays[id].last_reported_on; return d > m ? d : m;
      }, ''));
      if (body.category === 'other' && res.display) showOthers(true);
      else renderList();
      load();                     // reconcile with the full current map (a retry may refer to a since-hidden display)
      if (session === state.session) finish(res);
    }, function (err) {
      if (session !== state.session) return;
      say(els.status, errorText(err, 'save'), true);
      if (err && err.status === 400 && /address/.test(err.error || '')) els.address.setAttribute('aria-invalid', 'true');
    }).finally(function () {
      state.saving = false;
      els.save.disabled = false;
      els.save.textContent = 'Add this Santa to the map';
    });
  }

  function finish(res) {
    var d = res.display;
    state.session++;
    if (previewMarker && map) { map.removeLayer(previewMarker); previewMarker = null; }
    els.form.hidden = true;
    els.form.reset();
    resetPreview();
    say(els.status, '');
    els.doneMessage.textContent = res.message;
    els.doneAddress.textContent = d ? LABEL[d.category] + ' · ' + d.address : '';
    els.done.hidden = false;
    els.done.focus();
    if (d && map && markers[d.id]) { map.setView(markers[d.id].getLatLng(), Math.max(map.getZoom(), 16)); }
  }

  // ------------------------------------------------------------- corrections
  function openCorrection(id) {
    var d = state.displays[id];
    if (!d) return;
    state.correctionFor = id;
    els.correctionAddress.textContent = d.address + ' (' + LABEL[d.category] + ')';
    els.correctionForm.reset();
    els.correctionQuantityWrap.hidden = true;
    say(els.correctionStatus, '');
    els.correction.hidden = false;
    if (map) map.closePopup();
    els.correctionHeading.focus();
  }

  function sendCorrection(e) {
    e.preventDefault();
    var kind = els.correctionKind.value;
    var body = { display_id: state.correctionFor, kind: kind, message: els.correctionMessage.value };
    if (kind === 'quantity') body.proposed_quantity = parseInt(els.correctionQuantity.value, 10);
    if (['location', 'category', 'other'].indexOf(kind) >= 0 && !els.correctionMessage.value.trim()) {
      els.correctionMessage.setAttribute('aria-invalid', 'true');
      els.correctionMessage.focus();
      return say(els.correctionStatus, 'Please say briefly what should change.', true);
    }
    els.correctionMessage.removeAttribute('aria-invalid');
    els.correctionSend.disabled = true;
    api('POST', '/corrections', body).then(function (res) {
      say(els.correctionStatus, res.message);
      els.correctionForm.reset();
    }, function (err) {
      say(els.correctionStatus, errorText(err, 'find'), true);
    }).finally(function () { els.correctionSend.disabled = false; });
  }

  // ------------------------------------------------------------------ wiring
  $('start-matching').addEventListener('click', function () { openForm('matching'); });
  $('start-other').addEventListener('click', function () { openForm('other'); });
  els.find.addEventListener('click', function () { findAddress(); });
  els.address.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); findAddress(); }
  });
  els.address.addEventListener('input', resetPreview);                          // a changed address must be found again
  [els.quantity, els.description].forEach(function (f) {
    f.addEventListener('change', function () { if (state.place) state.key = newKey(); });  // a changed report is a new attempt
  });
  els.form.addEventListener('submit', save);
  els.cancel.addEventListener('click', function () {
    state.session++;
    els.form.hidden = true; els.form.reset(); resetPreview(); say(els.status, ''); $('start-matching').focus();
  });
  els.addAnother.addEventListener('click', function () { openForm(state.kind); });
  els.toggle.addEventListener('change', function () { showOthers(els.toggle.checked); });
  els.correctionKind.addEventListener('change', function () {
    els.correctionQuantityWrap.hidden = els.correctionKind.value !== 'quantity';
  });
  els.correctionForm.addEventListener('submit', sendCorrection);
  els.correctionCancel.addEventListener('click', function () { els.correction.hidden = true; });

  // The pre-season note is future tense, so it shows only through November 26, 2026,
  // Madison time. Without time-zone support it stays hidden rather than risk being stale.
  try {
    var madisonToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    if (/^\d{4}-\d{2}-\d{2}$/.test(madisonToday) && madisonToday < '2026-11-27') $('preseason-note').hidden = false;
  } catch (e) { /* leave it hidden */ }

  setUpMap();
  api('GET', '/area').then(frameArea, function () {});
  load();
  setInterval(function () { if (!document.hidden) load(); }, REFRESH_MS);
})();
