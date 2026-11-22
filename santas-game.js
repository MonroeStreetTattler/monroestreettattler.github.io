/* Santas on Monroe Street — local game build (SANTAS-GAME-001).
   All art is drawn from the small pixel maps and shapes in this file.
   The route is fixed: the same 150 delivery spots, in the same places, every run. */
(() => {
  'use strict';

  // ---------- Layout constants (logical pixels) ----------
  const W = 198, H = 150;
  const VX = 56;            // vehicle anchor (where the kid tosses from), screen x
  const local = ['localhost', '127.0.0.1', ''].includes(location.hostname);
  const options = new URLSearchParams(location.search);
  const prototype = !(local && options.has('classic'));
  let completedRun = false;
  try { completedRun = localStorage.getItem('santas-game-finished') === '1'; } catch (_) {}
  const replaysUnlocked = local || completedRun;
  const speedRun = completedRun && options.has('speed');
  const statsKey = speedRun ? 'santas-game-speed-stats' : 'santas-game-stats';
  const scoreApi = ['monroestreettattler.com', 'www.monroestreettattler.com', 'monroestreettattler.github.io'].includes(location.hostname)
    ? 'https://santas-game-beta.monroestreettattler.workers.dev' : '';
  const scoreMode = speedRun ? 'speed' : 'normal';
  const practiceBlock = replaysUnlocked && /^[1-5]$/.test(options.get('practice') || '') ? Number(options.get('practice')) : 0;
  const demoBlock = local && /^[1-5]$/.test(options.get('block') || '') ? Number(options.get('block'))
    : local && options.has('edgewood') ? 4 : 0;
  const trial = local && ['arcade', 'memory'].includes(options.get('trial')) ? 'arcade' : null;
  const fullRun = prototype && !practiceBlock && !demoBlock && !trial;
  let activeBlock = practiceBlock || demoBlock || 1;
  let marketRoute, schoolRoute;
  const BUS_DRAW_OFFSET = 35;
  const D = prototype ? 39 : 72;             // landing marker distance ahead of the anchor
  const HEDGE = 6;          // hedge width at each side of a lawn (near-miss zone)
  const ARM = 18;           // presses earlier than this before a lawn's hedge are ignored
  const LAWN_Y = 85, LAWN_B = 116, FOOT = 113, YARD_FOOT = 103;
  const STOREFRONT_DROP = 30, ICE_CREAM_ROOF = 33, ICE_CREAM_PARKING = 111;
  const SHARE_URL = 'https://monroestreettattler.com/santas-game.html';
  const CAMEO_DELIVERIES = { 57: 'grinch', 88: 'gingerbread' };

  // Per-block tuning. Blocks get a little faster and lawns a little narrower.
  const BLOCKS = [
    { speed: 40, minW: 34, maxW: 46, gapMin: 24, gapMax: 40, perfect: 5 },
    { speed: 44, minW: 30, maxW: 42, gapMin: 24, gapMax: 38, perfect: 4.5 },
    { speed: 48, minW: 28, maxW: 40, gapMin: 22, gapMax: 36, perfect: 4 },
    { speed: 50, minW: 26, maxW: 38, gapMin: 22, gapMax: 36, perfect: 4 },
    { speed: 54, minW: 24, maxW: 36, gapMin: 22, gapMax: 34, perfect: 3.5 },
  ];
  const BUS_LAWNS = [61, 65];        // inclusive delivery numbers on the bus
  const INTERSECTION = 64, BUS_INTERSECTION = 132, BUS_RETURN_GAP = 104;
  const PERFECT_BASE = 200, PERFECT_STEP = 50, STREAK_CAP = 6, HIT_POINTS = 100;

  // ---------- Palette ----------
  const PAL = {
    K: '#15131f', k: '#3b3a52', W: '#f4f6fb', w: '#c3cee6', v: '#8f9dbf',
    R: '#d8343a', r: '#962230', S: '#f2c9a0', s: '#e0876a',
    G: '#2f9a4a', g: '#1d6631', Y: '#ffd447', y: '#d39a2a',
    U: '#3d6fb6', u: '#25477e', N: '#0f1733', n: '#18244d', m: '#22336a', C: '#2f427c',
    A: '#30304a', a: '#5a5a74', O: '#8b8ba3', b: '#5e3b27', T: '#3a2f4e', t: '#55476e',
  };
  const HOUSES = [
    ['#8a5a3c', '#6c4330'], ['#4f6d8f', '#3b546f'], ['#c8973a', '#a1762a'],
    ['#6e8b5a', '#556c45'], ['#a39fb6', '#827e97'], ['#9b4a4a', '#7a3838'],
  ];
  const LIGHTS = ['R', 'G', 'Y', 'U'];

  // ---------- Pixel maps ----------
  const SANTA = [
    '......RRRR........',
    '.....RRRRRRR......',
    '....RRRRRRRRRR....',
    '....WWWWWWWWWRRW..',
    '....WSSSSSSSW.WWW.',
    '.RW.WSKSSSKSW.....',
    'R..RWSSSsSSSW.....',
    'W..WWWSSSSSWWW....',
    'R.WWWWWWWWWWWWW...',
    'WKKRWWWWWWWWWWRR..',
    'RKKRRWWWWWWWWRRRR.',
    'W..RRRRWWWWWRRRRR.',
    'R...RRRRWRRRGGRGG.',
    '....RRRRWRRRRRRRRK',
    '....RRRRWRRRGGRGGK',
    '....KKKKYKKKGGRGG.',
    '....RRRRWRRRRRRR..',
    '...RRRRRWRRRRRRR..',
    '...WWWWWWWWWWWWW..',
    '....RRRRR.RRRRR...',
    '....RRRRR.RRRRR...',
    '...KKKKKK.KKKKKK..',
    '..KKkKKKK.KKkKKKK.',
    '..KKKKKKK.KKKKKKK.',
  ];
  const KID = [
    '...W...',
    '..RRR..',
    '.RRRRR.',
    '.WWWWW.',
    '.SKSKS.',
    '.SSsSS.',
    'GGWGGWG',
    '.UUUUGg',
    '.UUUUUg',
  ];
  const ELF = [
    '.........Y.',
    '.......GGg.',
    '......GGg..',
    '.....GGG...',
    '....GGGG...',
    '...GGGGGG..',
    '..RRRRRRRR.',
    '.S.SSSS.S..',
    '..SSKSKSS..',
    '...SSsSS...',
    '...RWRWR...',
    '..GGGGGGG..',
    '..GGYGGgS..',
    '...gGGGg...',
  ];
  const BUNDLE_A = ['.RRRR.', 'RRWRRR', 'RRRRRR', 'RWRRWR', '.KKKK.'];
  const BUNDLE_B = ['.KKKK.', 'RWRRWR', 'RRRRRR', 'RRRWRR', '.RRRR.'];
  const ICON = ['.RR.', 'RWWR', '.RR.', 'RRRR', 'K..K'];

  function makeSprite(rows, palette = PAL) {
    const c = document.createElement('canvas');
    c.width = rows[0].length; c.height = rows.length;
    const x = c.getContext('2d');
    rows.forEach((row, y) => {
      for (let i = 0; i < row.length; i++) {
        const ch = row[i];
        if (ch === '.' || ch === ' ') continue;
        x.fillStyle = palette[ch] || ch; x.fillRect(i, y, 1, 1);
      }
    });
    return c;
  }
  const GRINCH = [
    '........RRRR.......',
    '.......RRRRRR......',
    '......RRRRRRRR.W...',
    '.....WWWWWWWWWWW...',
    '.....ggGGGGGgg.....',
    '....gGGGGGGGGGg....',
    '...gGGKGGGKGGGGg...',
    '....gGYKGGKYGg.....',
    '....ggGGGGGGgg.....',
    '.....gKGGGKgg......',
    '......gKKKgg.......',
    '....WWWWWWWWWW.....',
    '...RRRRRWRRRRRGG...',
    '..gGRRRRWRRRRRGG...',
    '.GG..RRRWRRRRR.....',
    '.gg..RRRYRRRRR.....',
    '.....KKKYKKKKK.....',
    '.....RRRWRRRRR.....',
    '.....WWWWWWWWW.....',
    '......gg...gg......',
    '......gg...gg......',
    '....gggg...gggg....',
    '...ggggg...ggggg...',
  ];
  const GINGERBREAD = [
    '..........KKKKKKKKK..........',
    '..........KkkkkkkKK..........',
    '..........KkkkkkkKK..........',
    '..........KKKKKKKKK..........',
    '..........RRRRRRRRR..........',
    '.......KKKKKKKKKKKKKKK.......',
    '..........bbbbbbbbb..........',
    '........bbsssssssssbb........',
    '.......bsssssssssssssbb......',
    '......bsssssssssssssssb......',
    '......bsWWWWsssWWWWsssb......',
    '......bsWKKWsssWKKWsssb......',
    '......bsWKKWsssWKKWsssb......',
    '......bsWWWWsssWWWWsssb......',
    '.......bRssWWWWWWssRb........',
    '........bbsssssssssbb........',
    '.........bbsssssssbb.........',
    '....bbbbbssRRsRRsssbbbbb.....',
    '...bssssssssRRRsssssssssb....',
    '...bsWWssssssRssssssWWssb....',
    '....bbsssssssGssssssssbb.....',
    '......bbssssssssssssbb.......',
    '.......bssssGsssssssb........',
    '.....bbbssssssssssssbbb......',
    '...bbssssssssGsssssssssbb....',
    '..bssssssssssssssssssssssb...',
    '.bsssWWssssssssssssWWsssssb..',
    '.bssWsssssssssssssssssWsssb..',
    '..bssssssbbbbbbbbssssssssb...',
    '...bbbbbb........bbbbbbbb....',
  ];
  const SPR = {};

  // ---------- 3x5 pixel font ----------
  const FONT = {
    A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110',
    E: '111100110100111', F: '111100110100100', G: '011100101101011', H: '101101111101101',
    I: '111010010010111', J: '001001001101010', K: '101101110101101', L: '100100100100111',
    M: '101111111101101', N: '110101101101101', O: '010101101101010', P: '110101110100100',
    Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
    U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101',
    Y: '101101010010010', Z: '111001010100111',
    0: '111101101101111', 1: '010110010010111', 2: '110001010100111', 3: '110001010001110',
    4: '101101111001001', 5: '111100110001110', 6: '011100111101111', 7: '111001010010010',
    8: '111101111101111', 9: '111101111001110',
    '+': '000010111010000', '-': '000000111000000', '/': '001001010100100', '!': '010010010000010',
    "'": '010010000000000', '.': '000000000000010', ':': '000010000010000', x: '000101010101000', ',': '000000000010100',
  };
  function textWidth(s, sc = 1) { return (s.length * 4 - 1) * sc; }
  function drawText(ctx, s, x, y, col, sc = 1, align = 'left', shadow = 'K') {
    s = String(s);
    let x0 = Math.round(align === 'center' ? x - textWidth(s, sc) / 2 : align === 'right' ? x - textWidth(s, sc) : x);
    y = Math.round(y);
    const pass = (color, ox, oy) => {
      ctx.fillStyle = PAL[color] || color;
      for (let i = 0; i < s.length; i++) {
        const g = FONT[s[i]] || FONT[s[i].toUpperCase()];
        if (!g) continue;
        for (let p = 0; p < 15; p++) if (g[p] === '1') ctx.fillRect(x0 + (i * 4 + (p % 3)) * sc + ox, y + Math.floor(p / 3) * sc + oy, sc, sc);
      }
    };
    if (shadow) pass(shadow, sc, sc);
    pass(col, 0, 0);
  }

  // ---------- Deterministic route ----------
  function mulberry32(a) {
    return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const ROUTE = (function buildRoute() {
    const rnd = mulberry32(20261221);
    const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
    const lots = [], decor = [], crossings = [], busStops = [];
    let x = -150;
    const addDecor = (w) => { const ls = x + HEDGE; decor.push({ lawnStart: ls, w, center: ls + w / 2, lawnEnd: ls + w, color: HOUSES[ri(0, HOUSES.length - 1)], style: decor.length % 2 }); x = ls + w + HEDGE + ri(24, 34); };
    addDecor(38); addDecor(34); addDecor(40);
    for (let b = 0; b < BLOCKS.length; b++) {
      const cfg = BLOCKS[b];
      if (b > 0) {
        const span = b === 3 ? BUS_INTERSECTION : INTERSECTION;
        crossings.push({ x0: x + 4, x1: x + 44, block: b });
        if (b === 3) busStops.push(x + 78);
        x += span;
      }
      for (let i = 0; i < 20; i++) {
        const n = lots.length + 1;
        const w = n === 1 ? 48 : ri(cfg.minW, cfg.maxW);
        const ls = x + HEDGE;
        lots.push({ n, block: b, lawnStart: ls, w, center: ls + w / 2, lawnEnd: ls + w,
          perfect: n === 1 ? 6 : cfg.perfect, color: HOUSES[ri(0, HOUSES.length - 1)], style: (n + b) % 2,
          bus: n >= BUS_LAWNS[0] && n <= BUS_LAWNS[1], cameo: CAMEO_DELIVERIES[n], seatedRoof: CAMEO_DELIVERIES[n] === 'gingerbread' });
        x = ls + w + HEDGE + ri(cfg.gapMin, cfg.gapMax);
        if (n === BUS_LAWNS[1]) x += BUS_RETURN_GAP;
      }
    }
    const finish = x + 40;
    addDecor(36); addDecor(42); addDecor(34); addDecor(40);
    const busStart = crossings.find(c => c.block === 3);
    const l65 = lots[BUS_LAWNS[1] - 1];
    return { lots, decor, crossings, busStops, finish,
      busFrom: (busStart.x0 + busStart.x1) / 2,       // anchor reaches the cross street
      busTo: l65.lawnEnd + HEDGE + 28,                 // anchor in the long gap after lawn 65
      blockStarts: [lots[0].lawnStart - 140].concat(BLOCKS.slice(1).map((_, i) => { const c = crossings[i]; return (c.x0 + c.x1) / 2; })) };
  })();
  const STOPS = [
    { name: 'Yellow bungalow', color: HOUSES[2], style: 0, frontage: 1.1, height: 1.18, order: true },
    { name: 'Blue bungalow', color: HOUSES[1], style: 1, frontage: 0.81, height: 0.84, feature: 'tree' },
    { name: 'Green bungalow', color: HOUSES[3], style: 0, frontage: 0.95, height: 1.07, feature: 'snowman', order: true },
    { name: 'Brown bungalow', color: HOUSES[0], style: 1, frontage: 1.2, height: 0.87 },
    { name: 'Camp Cantina', color: HOUSES[5], style: 0, shop: 'cantina', order: true },
    { name: 'Ice Cream Shoppe', color: HOUSES[4], style: 1, roof: true, iceCream: true, lobPoints: 150, order: true },
  ];
  const CORRIDOR = [
    { name: 'Let It Snow Chiropractic', sign: ['LET IT SNOW', 'CHIROPRACTIC'], brick: '#557a82', windowPattern: '100101100010', trim: '#234d61',
      order: true, shop: 'clinic', door: true, displayWindow: true, style: 0 },
    { name: 'Sleighcamp Fitness', sign: ['SLEIGHCAMP', 'FITNESS'], brick: '#567565', windowPattern: '010011011001', trim: '#284940',
      order: true, shop: 'fitness', door: true, displayWindow: true, style: 0 },
    { name: 'Garth’s Brew Bar', sign: ["GARTH'S", 'BREW BAR'], brick: '#915e47', windowPattern: '001111000101', trim: '#59372d',
      order: true, shop: 'brewbar', door: true, displayWindow: true, style: 0 },
  ];
  const LAUREL_TAVERN = {
    name: 'Lauren Tavern', sign: ['LAUREN', 'TAVERN'],
    brick: '#854944', trim: '#51313b', shop: 'tavern',
    door: true, displayWindow: true,
  };
  const TRIAL_STREET = [
    { ...STOPS[0], center: 135, w: 72, order: true },
    { ...STOPS[1], center: 251, w: 57, order: false },
    { ...CORRIDOR[2], center: 389, w: 58 },
    { name: 'Snowy park', center: 523, w: 68, park: true, order: true, style: 1 },
    { ...STOPS[5], center: 660, w: 53 },
    { ...STOPS[3], center: 792, w: 52, order: false },
    { name: 'Brick apartments', center: 931, w: 50, residence: 'apartment', balcony: true, order: true, style: 0 },
    { name: 'Apartment balcony, first spot', center: 1057, w: 42, pairedBalcony: 1, order: true, style: 0 },
    { name: 'Apartment balcony, second spot', center: 1103, w: 42, pairedBalcony: 2, order: true, style: 0 },
  ];
  const TRIAL_MOVERS = [
    { stop: 6, kind: 'bus', length: 49, bonus: 300, catchWidth: 15, speed: 2.5 },
    { stop: 4, kind: 'brt', length: 82, bonus: 400, catchWidth: 22, speed: 2.5 },
    { stop: 2, kind: 'plow', length: 44, bonus: 225, catchWidth: 14, speed: 2.1 },
  ];
  const BONUS_CAR = { kind: 'car', length: 25, color: 'R', bonus: 200, catchWidth: 12, speed: 1.45 };
  const [MADISON_BUS, MADISON_BRT] = TRIAL_MOVERS;
  const STADIUM_TRAFFIC = [
    { lot: { center: 340 }, vehicle: { kind: 'taxi', length: 27, color: 'Y', speed: 1.7 } },
  ];
  const BLOCK_MOVERS = [
    [[8, { ...BONUS_CAR, speed: 0.7, catchWidth: 18, direction: -1 }]],
    [[5, BONUS_CAR], [8, { ...MADISON_BUS, speed: 1.48 }], [20, { ...MADISON_BUS, speed: 1.65 }]],
    [
      [5, { ...MADISON_BUS, speed: 1.7, catchWidth: 26 }],
      [11, BONUS_CAR],
      [18, { ...MADISON_BRT, speed: 0.95, catchWidth: 40 }],
    ],
    [[4, BONUS_CAR], [11, { ...MADISON_BUS, speed: 1.25 }], [18, { ...MADISON_BRT, speed: 0.85 }], [30, BONUS_CAR]],
    [[6, { ...MADISON_BUS, speed: 1.5 }], [14, BONUS_CAR], [22, { ...MADISON_BRT, speed: 1.1 }], [33, { ...MADISON_BUS, speed: 0.9 }]],
  ];
  const DOUBLE_BALCONY_POINTS = 200;
  const DOUBLE_YARD_POINTS = 250;
  const LITTER_FINE = 60;
  const EXTRA_ROOF_STOPS = [[3, 7, 10], [14], [3, 7], [9, 13, 24], [2, 10, 23, 28, 34]];
  const BLOCK_DELIVERIES = [18, 24, 30, 36, 42];
  const FULL_ORDERS = BLOCK_DELIVERIES.reduce((total, places) => total + places, 0);
  let LOTS, TOTAL, orders, trafficStops, streetHazards, serviceVehicles, leadInStops, sceneryStops, busStops;
  function configureRoute() {
    marketRoute = activeBlock === 3;
    schoolRoute = activeBlock === 4;
    const marketShops = [
      { name: 'Mystery to Me', sign: ['MYSTERY TO ME', 'BOOKSTORE'], brick: '#825b49', windowPattern: '110001111000', trim: '#554052', door: true, displayWindow: true },
      { name: 'Bakery', sign: ['BAKERY', ''], brick: '#657792', windowPattern: '001110011010', trim: '#434660', door: true, displayWindow: true },
    ];
    const stops = marketRoute ? [
      ...marketShops, CORRIDOR[1], CORRIDOR[2],
      { name: 'Creando', sign: ['CREANDO', ''], shop: 'creando', brick: '#8c6855', trim: '#4b3e55', windowPattern: '101000111110', door: true, displayWindow: true },
      { name: 'Wingrow School west lawn', center: wingrow.center - 26, w: 46, schoolLawn: true },
      { name: 'Wingrow School east lawn', center: wingrow.center + 26, w: 46, schoolLawn: true },
      { ...CORRIDOR[0], center: 674 }, ...STOPS.slice(0, 4).map((stop, i) => ({ ...stop, center: 757 + i * 80 })),
      ...marketApartments[0], { ...STOPS[5], center: 1170, plainBungalow: true },
      ...marketApartments[1], ...marketApartments[2],
      { name: 'Corner condos roof', center: 1418, w: 45, apartmentRoof: true, roofBase: 36, lobPoints: 200 },
    ] : STOPS;
    LOTS = prototype ? stops.map((stop, i) => {
      const center = marketRoute ? (stop.center ?? [70, 150, 310, 391, 470][i])
        : [301, 382, 488, 570, 673, 753][i] + (activeBlock === 1 ? -180 : activeBlock === 2 ? 220 : 0);
      const w = stop.w ?? [62, 48, 64, 53, 58, 56][i % STOPS.length];
      const neighborhood = activeBlock === 2 && i === 3
        ? { name: 'Soul Food', sign: ['SOUL', 'FOOD'], brick: '#825299', trim: '#462957', door: true, displayWindow: true }
        : stop === STOPS[4] ? { ...stop, shop: undefined, name: 'Red bungalow' }
        : stop === STOPS[5] || stop.plainBungalow ? { ...stop, roof: false, iceCream: false, lobPoints: 0, name: 'Lavender bungalow' }
        : stop;
      const cameo = marketRoute && stop.name === STOPS[2].name ? 'grinch' : schoolRoute && i === 5 ? 'gingerbread' : undefined;

      const fratRoof = activeBlock === 2 && i === 0;
      return { ...neighborhood, order: true, cameo,
        blackSanta: marketRoute && stop.name === STOPS[1].name, overgrown: activeBlock === 1 && i === 3, seatedRoof: cameo === 'gingerbread',
        roof: fratRoof || neighborhood.roof, sidewaysRoof: fratRoof,
        lobPoints: fratRoof ? 150 : cameo === 'gingerbread' ? 175 : cameo === 'grinch' ? 150 : neighborhood.lobPoints,
        colonial: !marketRoute && i === 4 && !neighborhood.shop,
        snowmanTarget: activeBlock === 1 && stop.feature === 'snowman',
        fratYard: activeBlock === 2 && i < 2,
        stumbleDirection: activeBlock === 2 && i === 0 ? -1 : undefined,
        stumbleY: activeBlock === 2 && i === 0 ? LAWN_B : undefined,
        wobblyTailgater: activeBlock === 2 && i === 1, pongTable: activeBlock === 2 && i === 0, hedgeScreen: activeBlock === 2 && i === 2, n: i + 1, center, w, lawnStart: center - w / 2, lawnEnd: center + w / 2, perfect: 10 };
    }) : ROUTE.lots;

    if (schoolRoute && prototype && !trial) {
      const openingHouses = [100, 197].map((center, index) => ({
        ...STOPS[index], center, w: 58, lawnStart: center - 29, lawnEnd: center + 29,
        order: true, perfect: 10, n: index + 1,
      }));
      LOTS = [...openingHouses, ...LOTS.map(lot => ({ ...lot, n: lot.n + openingHouses.length }))];
    }

    if (fullRun || practiceBlock) {
      const count = BLOCK_DELIVERIES[activeBlock - 1] - LOTS.length - (schoolRoute ? 2 : 0);
      const random = mulberry32(20261221 + activeBlock);
      let center = LOTS.at(-1).center;
      let nextBusiness = 0;
      const laterBusinesses = activeBlock === 2 ? [STOPS[4], STOPS[5]]
        : activeBlock === 4 ? [LAUREL_TAVERN] : [];
      for (let i = 0; i < count; i++) {
        const style = i % 2;
        const doubleYard = activeBlock === 2 && (i === 2 || i === 3) ? i - 1 : 0;
        const w = doubleYard ? 46 : 45 + Math.floor(random() * 19);
        center += doubleYard === 2 ? 46 : activeBlock >= 3 ? 69 + Math.floor(random() * 16) : 77 + Math.floor(random() * 28);
        const color = HOUSES[(i * 5 + activeBlock) % HOUSES.length];
        const shop = i >= 4 + nextBusiness * 3 ? laterBusinesses[nextBusiness] : null;
        if (shop) nextBusiness++;
        const residence = !shop && activeBlock > 3 && i % 5 === 1
          ? (i % 2 ? 'apartment' : 'condo') : null;
        const snowmanTarget = !shop && !residence && !marketRoute &&
          (i % 7 === 5 || (activeBlock === 5 && [3, 9, 14, 18].includes(i)));
        const number = LOTS.length + 1;
        LOTS.push({
          name: residence ? (residence === 'apartment' ? 'Brick apartments ' : 'Condos ') + number : 'House ' + number,
          ...shop, residence, doubleYard, balcony: Boolean(residence),
          ...(!shop && !residence && EXTRA_ROOF_STOPS[activeBlock - 1].includes(i) ? { roof: true, lobPoints: 125 } : {}),
          colonial: !residence && !shop && i % 7 === 1,
          cottage: !residence && !shop && i % 7 === 4,
          n: LOTS.length + 1, order: true, center, w, style, color,
          frontage: 0.82 + random() * 0.32, height: 0.82 + random() * 0.32,
          feature: snowmanTarget ? 'snowman' : i % 7 === 2 ? 'tree' : undefined,
          yardResident: activeBlock === 1 && i === 4,
          blackSanta: (activeBlock === 1 && i === 2) || (activeBlock === 4 && i === 7) || (activeBlock === 5 && i === 15),
          overgrown: activeBlock === 4 && i === 3,
          showpieceTree: activeBlock === 1 && i === count - 1,
          deciduousLights: activeBlock === 5 && i === count - 2,
          giantSanta: activeBlock === 5 && i === 8,
          snowmanTarget,
          lawnStart: center - w / 2, lawnEnd: center + w / 2,
          perfect: 10 - Math.floor((activeBlock - 1) / 2),
        });
      }
    }
    if (schoolRoute && prototype && !trial) {
      const middle = Math.floor(LOTS.length / 2);
      const front = LOTS.slice(0, middle);
      const spacing = 210;
      school.center = front.at(-1).center + 101;
      const schoolLawns = [-23, 23].map(offset => {
        const center = school.center + offset;
        return { name: 'Hedgewood School lawn', schoolLawn: true, order: true, center,
          w: 42, lawnStart: center - 21, lawnEnd: center + 21, perfect: 10 };
      });
      const tail = LOTS.slice(middle).map(lot => ({
        ...lot, center: lot.center + spacing, lawnStart: lot.lawnStart + spacing, lawnEnd: lot.lawnEnd + spacing,
      }));
      LOTS = [...front, ...schoolLawns, ...tail].map((lot, index) => ({ ...lot, n: index + 1 }));
    }
    if (trial) {
      LOTS = TRIAL_STREET.map((lot, i) => ({
        ...lot, n: i + 1, order: true, perfect: i === 0 ? 16 : 10,
        lawnStart: lot.center - lot.w / 2, lawnEnd: lot.center + lot.w / 2,
      }));
    }
    TOTAL = LOTS.length;
    orders = prototype ? LOTS.filter(lot => lot.order).length : TOTAL;
    const trafficLots = trial ? [6]
      : schoolRoute ? [1, 3, 5, 8, 12, 15, 17, 21, 25, 29, 32]
      : activeBlock === 1 ? [4, 7, 10]
      : activeBlock === 3 ? [10, 15, 24]
      : activeBlock === 5 ? [4, 13, 20, 29, 38] : [];
    trafficStops = prototype ? LOTS.filter(lot => trafficLots.includes(lot.n)) : [];
    const hazardPlan = trial ? [[2, 'walker'], [4, 'turkey'], [7, 'dog']]
      : activeBlock === 1 ? [[3, 'walker'], [5, 'dog'], [7, 'family'], [8, 'walker'], [10, 'dog'], [12, 'family'], [FIRST_TURKEY_STOP, 'turkey'], [17, 'cat']]
      : activeBlock === 2 ? [[3, 'walker'], [6, 'dog'], [7, 'walker'], [10, 'family'], [12, 'dog'], [17, 'turkey'], [20, 'walker']]
      : activeBlock === 3 ? [[3, 'family'], [6, 'walker'], [9, 'dog'], [11, 'kids'], [14, 'dog'], [17, 'family'], [19, 'dog'], [25, 'cat']]
      : activeBlock === 4 ? [[2, 'kids'], [6, 'dog'], [9, 'family'], [11, 'dog'], [14, 'kids'], [17, 'dog'], [20, 'family'], [24, 'walker']]
      : [[5, 'crane'], [8, 'dog'], [11, 'family'], [14, 'walker'], [18, 'crane'], [20, 'dog'], [23, 'dog'], [25, 'family']];
    streetHazards = !prototype ? [] : hazardPlan
      .filter(([n]) => n <= LOTS.length)
      .map(([n, kind], i) => ({
        anchor: LOTS[n - 1].center - D, kind, direction: (activeBlock === 1 && kind === 'turkey') || i % 2 ? -1 : 1, variant: (n + activeBlock) % 3,
        tumbling: (activeBlock === 3 && n === 9 && kind === 'dog') || (activeBlock === 5 && n === 18 && kind === 'crane'),
      }));
    const vehiclePlan = activeBlock === 4 ? [[16, 'van'], [26, 'van'], [31, 'van']]
      : activeBlock === 5 ? [[6, 'van'], [10, 'truck'], [15, 'van'], [19, 'truck'], [24, 'van'], [28, 'truck']]
      : [];
    serviceVehicles = !prototype ? [] : vehiclePlan
      .filter(([n]) => n <= LOTS.length)
      .map(([n, kind], i) => ({ anchor: LOTS[n - 1].center - D, kind, length: kind === 'truck' ? 39 : 33,
        direction: Math.floor(i / 2) % 2 ? -1 : 1 }));
    leadInStops = trial || activeBlock === 1 || schoolRoute ? []
      : activeBlock === 2 ? openingLandmarks : marketRoute ? [traderSnow] : [apartment, laterHouse];
    sceneryStops = leadInStops;
    const movers = trial ? TRIAL_MOVERS.map(vehicle => [vehicle.stop + 1, vehicle])
      : prototype ? BLOCK_MOVERS[activeBlock - 1] : [];
    busStops = movers.filter(([stop]) => stop <= TOTAL).map(([stop, vehicle]) => ({ lot: LOTS[stop - 1], vehicle }));
    if (activeBlock === 2 && !trial) busStops.push(...STADIUM_TRAFFIC);
  }
  const cars = [
    { offset: -66, length: 22, color: 'R' },
    { offset: -31, length: 23, color: 'U' },
    { offset: 18, length: 21, color: 'w' },
    { offset: 52, length: 24, color: 'y' },
  ];
  const trafficGroups = [[cars[1]], [cars[0], cars[2]], cars];
  function vehicleInView(left, length, distance) {
    const x = left - distance + VX;
    return x > -length - 16 && x < W + 16;
  }
  function eachTrafficCar(distance, visit) {
    for (const [index, lot] of trafficStops.entries()) {
      const anchor = lot.center - D;
      const delta = distance - anchor;
      const direction = index % 2 ? -1 : 1;
      const group = trafficGroups[index % trafficGroups.length];
      const streams = schoolRoute && index >= 2
        ? [{ direction, group, extra: 0 }, { direction: -direction, group: cars.slice(index % 2 ? 0 : 2, index % 2 ? 2 : 4), extra: 45 }]
        : [{ direction, group, extra: 0 }];
      for (const stream of streams) {
        const facing = stream.direction;
        for (const car of stream.group) {
          const pace = [1.35, 1.65, 1.9, 1.5][index % 4];
          const offset = delta * pace + car.offset + stream.extra;
          const left = facing === 1 ? offset : 20 - offset - car.length;
          if (vehicleInView(anchor + left, car.length, distance)) visit(anchor + left, car, facing);
        }
      }
    }
  }
  function eachServiceVehicle(distance, visit) {
    for (const vehicle of serviceVehicles) {
      const { anchor, direction, length, kind } = vehicle;
      const delta = distance - anchor;
      const speed = kind === 'truck' ? 1.75 : 2.25;
      const offset = delta * speed;
      const left = anchor + (direction === 1 ? (kind === 'truck' ? 8 : 12) + offset : -6 - offset - length);
      if (vehicleInView(left, length, distance)) visit(left, vehicle);
    }
  }
  const HAZARD_WIDTH = { cat: 12, turkey: 12, crane: 12, kids: 16, dog: 27, walker: 9, family: 27 };
  const HAZARD_PACES = {
    cat: [0.18, 0.25, 0.32],
    turkey: [0.12, 0.23, 0.35], crane: [0.12, 0.20, 0.29],
    kids: [0.17, 0.26, 0.38], dog: [0.12, 0.20, 0.28],
    walker: [0.14, 0.23, 0.32], family: [0.10, 0.17, 0.24],
  };
  const FIRST_TURKEY_STOP = 15, TURKEY_SPRINT_TIME = 0.42;
  const YARD_TURKEY_STOPS = [13, 15];
  const TURKEY_TIP_DELAY = 0.61;
  const YARD_CRANE_STOP = 14, CRANE_POP_DELAY = 0.56;
  const CRANE_CROSSING_X = 2700, CRANE_CROSSING_TIME = 3.8;
  function eachStreetHazard(distance, visit) {
    for (const hazard of streetHazards) {
      const { anchor, kind, direction, variant } = hazard;
      const delta = distance - anchor;
      if (delta < -185 || delta > 185) continue;
      const pace = HAZARD_PACES[kind][variant];
      const left = anchor + direction * (18 + delta * pace);
      if (S.turkeyChase?.hazard !== hazard && !S.bonkedTurkeys.some(bird => bird.hazard === hazard && bird.member === 0)) {
        visit(left, kind, direction, variant, pace, hazard, 0);
      }
      if (kind === 'turkey' && !S.bonkedTurkeys.some(bird => bird.hazard === hazard && bird.member === 1)) {
        visit(left + direction * 16, kind, direction, variant, pace, hazard, 1);
      }
    }
  }
  const laterHouse = { ...STOPS[1], center: 174, w: 56, lawnStart: 146, lawnEnd: 202, n: 0 };
  const apartment = { center: 67, lawnStart: 34, lawnEnd: 100 };
  const traderSnow = { name: 'Trader Snow', center: 230, lawnStart: 198, lawnEnd: 262 };
  const marketApartments = [
    { center: 1079, name: 'Brick apartments', brick: '#895342', levels: [57, 84], windowRows: ['11010', '00111', '11001', '0100'] },
    { center: 1253, name: 'Monroe flats', brick: '#625165', levels: [91, 63], windowRows: ['00110', '11000', '00011', '1011'] },
    { center: 1349, name: 'Corner condos', brick: '#575b72', levels: [70, 97], windowRows: ['10101', '10001', '01110', '0010'] },
  ].map(building => building.levels.map((base, index) => ({
    name: building.name, brick: building.brick, center: building.center + (index ? 23 : -23),
    w: 42, pairedBalcony: index + 1, balconyBase: base, lobPoints: 125, windowRows: building.windowRows,
  })));
  const school = { center: 173, lawnStart: 115, lawnEnd: 231, fenced: true };
  const openingLandmarks = [
    { center: 73, w: 64, lawnStart: 41, lawnEnd: 105, n: 0, style: 0,
      color: HOUSES[4], pongTable: true, parkedCar: 0, stumbleDirection: -1, stumbleY: 92 },
    { center: 158, w: 64, lawnStart: 126, lawnEnd: 190, n: 0, style: 1,
      color: HOUSES[3], fratYard: true, pongTable: true },
    { name: 'Camp Tinsel', center: 431, lawnStart: 382, lawnEnd: 480, closed: true },
    { center: 234, w: 64, lawnStart: 202, lawnEnd: 266, n: 0, style: 1,
      color: HOUSES[2], fratYard: true, wobblyTailgater: true },
    { center: 316, w: 64, lawnStart: 284, lawnEnd: 348, n: 0, style: 0,
      color: HOUSES[0], fratYard: true, pongTable: true, stumbleDirection: 1, stumbleY: YARD_FOOT },
  ];
  const wingrow = { name: 'Wingrow School', center: 584, lawnStart: 528, lawnEnd: 640, closed: true };
  configureRoute();
  const carLaneY = direction => direction === 1 ? 129 : 126;
  function eachRoofVehicle(distance, visit) {
    for (const [index, { lot, vehicle }] of busStops.entries()) {
      const anchor = lot.center - D;
      const delta = distance - anchor;
      const direction = vehicle.direction ?? (index % 2 || vehicle.kind === 'brt' ? -1 : 1);
      const result = S.busBonuses[index];
      const speedsAway = vehicle.kind === 'bus' || vehicle.kind === 'car';
      const afterLanding = speedsAway && result?.landedDist != null ? Math.max(0, distance - result.landedDist) : 0;
      const boost = Math.max(0, afterLanding - 4) * vehicle.speed * 0.22;
      const offset = 5 + delta * vehicle.speed + boost;
      const left = anchor + (direction === 1 ? offset : 10 - offset - vehicle.length);
      if (vehicleInView(left, vehicle.length, distance)) visit(left, direction, { ...vehicle, index });
    }
  }

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const canvas = $('sg-canvas');
  let ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const titleArt = document.createElement('canvas');
  titleArt.width = 360;
  titleArt.height = H;
  const titleContext = titleArt.getContext('2d');
  const els = {
    launch: $('sg-launch'), play: $('sg-play'), paused: $('sg-paused'), resume: $('sg-resume'),
    end: $('sg-end'), again: $('sg-again'), share: $('sg-share'), shareBox: $('sg-share-box'),
    shareText: $('sg-share-text'), shareNote: $('sg-share-note'), copy: $('sg-copy'),
    deliver: $('sg-deliver'), pause: $('sg-pause'), mute: $('sg-mute'),
    fScore: $('sg-final-score'), fPerfect: $('sg-final-perfect'), fStreak: $('sg-final-streak'), fDelivered: $('sg-final-delivered'),
    live: $('sg-live'),
  };

  // ---------- Audio (WebAudio chiptune; starts only after Play) ----------
  const AU = { ctx: null, master: null, music: null, sfx: null, muted: false, next: 0, step: 0, timer: null };
  try { AU.muted = localStorage.getItem('santas-game-muted') === '1'; } catch (e) { /* storage unavailable */ }
  const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
  function audioInit() {
    if (AU.ctx) { if (AU.ctx.state === 'suspended') AU.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    AU.ctx = new AC();
    AU.master = AU.ctx.createGain(); AU.master.gain.value = AU.muted ? 0 : 0.9; AU.master.connect(AU.ctx.destination);
    AU.music = AU.ctx.createGain(); AU.music.gain.value = 0.29; AU.music.connect(AU.master);
    AU.sfx = AU.ctx.createGain(); AU.sfx.gain.value = 0.32; AU.sfx.connect(AU.master);
    const len = AU.ctx.sampleRate * 0.4; AU.noise = AU.ctx.createBuffer(1, len, AU.ctx.sampleRate);
    const d = AU.noise.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  function tone(type, freq, t, dur, vol, dest, slide) {
    if (!AU.ctx) return;
    const o = AU.ctx.createOscillator(), g = AU.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest || AU.sfx); o.start(t); o.stop(t + dur + 0.03);
  }
  function hiss(t, dur, vol, freq, dest) {
    if (!AU.ctx) return;
    const s = AU.ctx.createBufferSource(), f = AU.ctx.createBiquadFilter(), g = AU.ctx.createGain();
    s.buffer = AU.noise; f.type = 'highpass'; f.frequency.value = freq || 6000;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(dest || AU.sfx); s.start(t); s.stop(t + dur + 0.02);
  }
  function bell(m, t, vol) { tone('sine', hz(m), t, 0.7, vol); tone('sine', hz(m) * 2.76, t, 0.25, vol * 0.35); }
  // Hanby's Up on the Housetop, melody in F. One row is a 2/4 bar.
  // Tchaikovsky's March, opening eight-bar excerpt. The game's accompaniment is original.
  const HOUSETOP = {
    notes: [
      72, 72, 72, 72, 69, '-', 69, '-',
      65, '-', 69, '-', 72, '-', '-', '-',
      74, 74, 74, 72, 69, '-', '-', 0,
      67, '-', 72, '-', 72, '-', '-', 0,
      72, 72, 72, 72, 69, '-', 69, '-',
      65, '-', 69, '-', 72, '-', '-', '-',
      74, 74, 74, 72, 69, '-', 69, '-',
      67, '-', 72, '-', 65, '-', '-', 0,
      72, '-', 72, '-', 72, '-', '-', 0,
      70, '-', 70, 74, 67, '-', '-', 0,
      70, '-', 70, '-', 70, '-', '-', 0,
      69, '-', 69, 72, 65, '-', '-', 0,
      72, '-', 72, 72, 72, '-', '-', 0,
      69, '-', 70, '-', 74, '-', 72, '-',
      74, '-', 74, 74, 72, '-', '-', 0,
      69, 69, 67, 72, 65, '-', '-', 0,
    ],
    bass: [41, 41, 46, 48, 41, 41, 46, 41, 46, 48, 48, 41, 41, 46, 46, 41],
    subdivisions: 4,
  };
  const MARCH = {
    notes: [
      74, 0, 74, 74, 76, 0, 76, 0,
      78, 0, 74, 0, 76, '-', '-', 0,
      74, 0, 74, 74, 76, 0, 76, 0,
      78, 0, 74, 0, 76, '-', 64, 0,
      72, 74, 72, 71, 69, 67, 66, 62,
      71, 72, 71, 69, 67, 66, 64, 67,
      66, 64, 63, 69, 67, 66, 64, 71,
      72, 71, 69, 67, 74, '-', 86, 0,
    ],
    bass: [43, 47, 43, 40, 48, 43, 40, 38],
    subdivisions: 2,
  };
  // 8-bit reduction of Mykola Leontovych's Shchedryk, taking the final
  // ending on the first pass so the complete musical arc fits Snow Squall.
  // Score: https://commons.wikimedia.org/wiki/File:Щедрик.pdf
  const bellMotif = [70, '-', 69, 70, 67, '-'];
  const bellScale = [62, 64, 66, 67, 69, 70];
  const bellAnswer = [72, 74, 72, '-', 70, '-'];
  const BELLS = {
    notes: [
      ...Array(20).fill(bellMotif),
      [79, '-', 79, 79, 77, 75],
      [74, '-', 74, 74, 72, 70],
      [72, '-', 72, 72, 74, 72],
      [67, '-', 67, 67, 67, '-'],
      bellScale, bellAnswer, bellScale, bellAnswer,
      ...Array(4).fill(bellMotif),
      bellMotif, bellMotif, bellMotif, [74, '-', 72, 74, 67, '-'],
    ].flat(),
    bass: [
      0, 0, 0, 0, 0, 0, 0, 0,
      55, 53, 51, 48, 53, 55, 58, 55,
      55, 55, 55, 55, 58, 58, 58, 58,
      46, 46, 46, 46, 46, 46, 43, 43,
      43, 43, 43, 43,
    ],
    subdivisions: 2,
    bpm: 194,
  };
  const bellInnerVoice = [
    0, 0, 0, 0, 67, 65, 63, 62, 67, 65, 63, 62,
    67, 67, 67, 67, 67, 67, 67, 67, 67, 67, 67, 67,
    70, 70, 70, 70, 62, 60, 65, 63, 67, 67, 67, 67,
  ];
  const TITLE_ARRANGEMENT = { bpm: 110, key: 0, lead: 'triangle', harmony: false };
  const ARRANGEMENTS = [
    { bpm: 146, key: 0, lead: 'square', harmony: false },
    { bpm: 137, key: 0, lead: 'triangle', harmony: false },
    { bpm: 141, key: 2, lead: 'square', harmony: false },
    { bpm: 146, key: 0, lead: 'square', harmony: false },
    { bpm: 162, key: 2, lead: 'square', harmony: true },
  ];
  function musicBell(note, time, volume, destination = AU.music) {
    tone('sine', hz(note), time, 0.38, volume, destination);
    tone('sine', hz(note) * 2.01, time, 0.17, volume * 0.45, destination);
    tone('sine', hz(note) * 2.76, time, 0.08, volume * 0.22, destination);
  }
  function playSugarPlumCue() {
    audioInit();
    if (!AU.ctx) return;
    AU.cue = AU.ctx.createGain();
    AU.cue.connect(AU.music);
    const start = AU.ctx.currentTime + 0.025;
    const notes = [79, 76, 79, 78, 75, 76, 74, 74, 74, 73, 73, 73, 72, 72, 72, 71, 76, 72, 76, 71, 67, 64, 71, 76];
    const beats = [0, 1, 2, 3, 5, 6, 8, 9, 10, 12, 13, 14, 16, 17, 18, 20, 23, 24, 25, 27, 29, 32, 35, 38];
    notes.forEach((note, i) => musicBell(note + 12, start + beats[i] * 0.14, 0.43, AU.cue));
    for (const beat of [0, 8, 16, 24, 32]) {
      tone('triangle', hz(beat === 16 ? 47 : 40), start + beat * 0.14, 0.6, 0.22, AU.cue);
    }
  }
  function scheduleCarolStep(i, t, eighth) {
    const beat = i % 6;
    const bar = Math.floor(i / 6);
    const note = BELLS.notes[i];
    const root = BELLS.bass[bar];
    const inner = bellInnerVoice[bar];
    const volume = bar >= 20 && bar < 24 ? 1.12 : bar >= 28 ? 0.62 : 0.88;
    if (note > 0) {
      const length = BELLS.notes[i + 1] === '-' ? 2 : 1;
      const lead = note + (bar >= 32 && bar < 35 ? -12 : bar >= 20 && bar < 24 ? 0 : 12);
      tone('square', hz(lead), t, eighth * length * 0.9, 0.32 * volume, AU.music);
      musicBell(lead, t, 0.28 * volume);
    }
    if (inner && (beat === 0 || (bar >= 12 && bar < 28 && (beat === 2 || beat === 4)))) {
      tone('triangle', hz(inner), t, eighth * (bar < 12 || bar >= 28 ? 5.8 : 1.8), 0.38 * volume, AU.music);
    }
    if (root && (beat === 0 || (bar < 28 && beat === 4))) {
      tone('triangle', hz(root - 12 + (beat === 4 ? 7 : 0)), t, eighth * (bar >= 28 ? 5.8 : 1.75), 0.5 * volume, AU.music);
    }
    if (bar >= 4 && bar < 28 && (beat === 0 || beat === 3)) hiss(t, 0.09, 0.17 * volume, 7200, AU.music);
  }
  function scheduleStep(track, i, t, arrangement, interval) {
    const voice = track.notes[i];
    const root = track.bass[Math.floor(i / 8)] + arrangement.key;
    const step = i % 8;
    if (voice > 0) {
      let length = 1;
      while (track.notes[(i + length) % track.notes.length] === '-') length++;
      const note = voice + arrangement.key;
      tone(arrangement.lead, hz(note), t, interval * length * (track === MARCH ? 0.63 : 0.9), 0.43, AU.music);
      if (step === 0 || step === 4) musicBell(note + 12, t, 0.20);
      if (arrangement.harmony && step % 2 === 0) tone('triangle', hz(note - 12), t, interval * length * 0.76, 0.23, AU.music);
      if (track === MARCH && step === 2 && Math.floor(i / 8) < 4 && i % 16 < 8) {
        tone('square', hz(note), t + interval * 0.55, interval * 0.36, 0.28, AU.music);
      }
    }
    if (step % 2 === 0) {
      const bass = [0, 12, 7, 12][Math.floor(step / 2)];
      tone('triangle', hz(root + bass), t, interval * 1.48, 0.55, AU.music);
    }
    if (step === 0 || step === 4) {
      tone('sine', 123, t, 0.08, 0.30, AU.music, 49);
      hiss(t, 0.07, 0.25, track === MARCH ? 4100 : 7600, AU.music);
    } else if (step === 2 || step === 6) {
      hiss(t, 0.07, 0.16, 7300, AU.music);
      tone('sine', step === 2 ? 5200 : 4900, t, 0.085, 0.13, AU.music);
      tone('sine', 3470, t + 0.026, 0.12, 0.09, AU.music);
    }
  }
  function musicStart(delay = 0) {
    if (!AU.ctx || AU.timer) return;
    const title = state === 'title';
    const track = title ? HOUSETOP : activeBlock === 5 ? BELLS : activeBlock === 3 ? HOUSETOP : MARCH;
    AU.music.gain.setTargetAtTime(title ? 0.24 : 0.29, AU.ctx.currentTime, 0.03);
    AU.step = 0;
    AU.next = AU.ctx.currentTime + 0.04 + delay;
    AU.timer = setInterval(() => {
      if (AU.ctx.state !== 'running') return;
      const block = prototype ? activeBlock - 1 : S.blockShown;
      const arrangement = title ? TITLE_ARRANGEMENT : ARRANGEMENTS[block];
      const interval = 60 / (track === BELLS ? BELLS.bpm : arrangement.bpm) / track.subdivisions;
      AU.next = Math.max(AU.next, AU.ctx.currentTime);
      while (AU.next < AU.ctx.currentTime + 0.15) {
        if (track === BELLS) scheduleCarolStep(AU.step, AU.next, interval);
        else scheduleStep(track, AU.step, AU.next, arrangement, interval);
        AU.next += interval;
        AU.step = (AU.step + 1) % track.notes.length;
      }
    }, 30);
  }
  function musicStop() { clearInterval(AU.timer); AU.timer = null; }
  const now = () => (AU.ctx ? AU.ctx.currentTime + 0.01 : 0);
  const SFX = {
    toss() { const t = now(); tone('square', 240, t, 0.12, 0.25, null, 620); },
    collect(streak) {
      const time = now();
      const note = 79 + Math.min(6, Math.max(0, streak - 1));
      tone('square', hz(note), time, 0.067, 0.32);
      tone('sine', hz(note + 7), time + 0.055, 0.22, 0.56);
      tone('sine', hz(note + 19), time + 0.055, 0.15, 0.18);
    },
    delivery(streak, perfect) {
      const t = now();
      const base = 72 + 2 * Math.min(Math.max(0, streak - 1), STREAK_CAP);
      const notes = streak >= STREAK_CAP + 1 ? [0, 4, 7, 12, 16] : perfect ? [0, 4, 7, 12] : [0, 4, 7];
      notes.forEach((interval, i) => bell(base + interval, t + i * 0.055, streak > STREAK_CAP ? 0.52 : 0.36));
    },
    hedge() { const t = now(); hiss(t, 0.25, 0.5, 1800); tone('square', 330, t + 0.05, 0.25, 0.22, null, 180); },
    lob() {
      const t = now();
      tone('triangle', 310, t, 0.18, 0.63, null, 960);
      tone('square', 620, t + 0.1, 0.09, 0.14, null, 990);
    },
    wrong() {
      const t = now();
      [76, 72, 66].forEach((note, i) => tone('square', hz(note), t + i * 0.075, 0.1, 0.25));
      tone('triangle', hz(42), t + 0.15, 0.19, 0.47);
    },
    miss() { const t = now(); tone('square', 150, t, 0.28, 0.22, null, 70); },
    cameo() { const t = now() + 0.25; [72, 76, 79, 84, 88, 91].forEach((m, i) => bell(m, t + i * 0.08, 0.35)); },
    block() { const t = now(); [72, 79, 84].forEach((m, i) => tone('square', hz(m), t + i * 0.09, 0.1, 0.2)); },
    poof() { const t = now(); hiss(t, 0.3, 0.35, 2500); },
    inflatablePop() { hiss(now(), 0.19, 0.42, 2100); },
    turkeyBonk() {
      const t = now();
      tone('square', 410, t, 0.09, 0.28, null, 710);
      tone('square', 660, t + 0.08, 0.12, 0.24, null, 240);
      tone('triangle', 105, t + 0.15, 0.12, 0.36, null, 55);
    },
    turkeyTip() {
      const t = now();
      [315, 275, 295].forEach((pitch, i) => tone('square', pitch, t + i * 0.065, 0.055, 0.24, null, pitch * 0.68));
      tone('triangle', 120, t + 0.21, 0.18, 0.62, null, 48);
    },
    end() {
      const t = now();
      [72, 76, 79, 84, 88, 91, 96].forEach((note, i) => bell(note, t + i * 0.09, 0.48));
      for (const note of [48, 60, 67, 84]) tone('triangle', hz(note), t + 0.58, 0.55, 0.25);
    },
  };
  function setMuted(m) {
    AU.muted = m;
    if (AU.master) AU.master.gain.setTargetAtTime(m ? 0 : 0.9, AU.ctx.currentTime, 0.02);
    els.mute.setAttribute('aria-pressed', String(m));
    els.mute.textContent = m ? 'Sound off' : 'Sound on';
    try { localStorage.setItem('santas-game-muted', m ? '1' : '0'); } catch (e) { /* ignore */ }
  }

  // ---------- Game state ----------
  let state = 'title';      // title | playing | paused | over
  let S = null;
  const blockTallies = [];
  let runTotals = { score: 0, perfects: 0, longest: 0, delivered: 0 };
  let scoreSaved = false;
  let countedRun = false;
  let lastFrameTs = 0;
  let titleSnowTime = 0;
  let timeScale = 1;
  let stepping = false;     // test harness drives time manually
  const flakes = Array.from({ length: 86 }, (_, i) => ({ x: (i * 53.7) % W, y: (i * 37.3) % H, s: 0.5 + (i % 3) * 0.35, d: i % 2 }));
  const stars = Array.from({ length: 34 }, (_, i) => ({ x: (i * 71 + 13) % W, y: 12 + ((i * 29) % 54), b: i % 5 === 0 }));

  function freshState() {
    return { dist: 0, time: 0, target: 0, introSeconds: 0, firstBalconyAt: null, busBonuses: [], leadInResults: [], score: 0, streak: 0, longest: 0, perfects: 0, delivered: 0,
      turkeyChase: null, bonkedTurkeys: [], results: new Array(TOTAL).fill(null), proj: [], pops: [], parts: [], rings: [], litter: [], fallenAnimals: new Map(), fallenFans: new Map(),
      endTimer: 0, craneCrossingAt: null, banner: { text: 'BLOCK 1', t: 2.2 }, blockShown: 0, vehicle: 'sleigh', poof: 0, nudge: 0, kidToss: 0 };
  }
  S = freshState();

  function speedNow() {
    if (S.craneCrossingAt !== null && S.time - S.craneCrossingAt < CRANE_CROSSING_TIME) return 0;
    if (trial) return 54;
    if (prototype && (fullRun || practiceBlock)) return [35, 44, 52, 61, 70][activeBlock - 1] * (speedRun ? 1.3 : 1);
    let b = 0;
    for (let i = 0; i < ROUTE.blockStarts.length; i++) if (S.dist >= ROUTE.blockStarts[i]) b = i;
    return BLOCKS[b].speed;
  }
  function blockOf(dist) { let b = 0; for (let i = 0; i < ROUTE.blockStarts.length; i++) if (dist >= ROUTE.blockStarts[i]) b = i; return b; }
  function throwReach() {
    return activeBlock === 2 && !trial && YARD_TURKEY_STOPS.includes(LOTS[S.target]?.n) ? D + 28 : D;
  }
  const markerX = () => S.dist + throwReach();
  function armed() {
    if (S.target >= TOTAL) return false;
    const lot = LOTS[S.target];
    return markerX() >= lot.lawnStart - HEDGE - ARM;
  }

  const LOB_HOLD_MS = 230;

  function deliverySurface(lot, lob) {
    const high = !prototype || lob;
    if (trial && lot.park) return { type: 'park', base: FOOT };
    if (lot.apartmentRoof) return lob ? { type: 'roof', base: lot.roofBase, center: lot.center } : null;
    if (lot.pairedBalcony) {
      return lob ? { type: 'balcony', base: lot.balconyBase || 77, center: lot.center + (lot.pairedBalcony === 1 ? 5 : -5) } : null;
    }
    if (high && lot.seatedRoof) return { type: 'roof', base: 46, center: lot.center };
    if (high && lot.window) return { type: 'window', base: 52, center: lot.center - 3 };
    if (lot.balcony) return lob ? { type: 'balcony', base: 67, center: lot.center } : null;
    if (lot.iceCream) return lob ? { type: 'roof', base: ICE_CREAM_ROOF, center: lot.center } : { type: 'frontage', base: ICE_CREAM_PARKING };
    if (high && lot.roof) return { type: 'roof', base: lot.roofBase || Math.round(LAWN_Y + (38 - LAWN_Y) * (lot.height || 1)), center: lot.center };
    if (lot.door) return { type: lot.displayWindow ? 'display' : 'door', base: 86 + STOREFRONT_DROP, center: lot.center + 19 };
    if (lot.shop || lot === traderSnow) return { type: 'frontage', base: LAWN_B + 2 };
    return { type: 'yard', base: lot.hedgeScreen ? FOOT : YARD_FOOT };
  }

  const shotDuration = lob => trial ? (lob ? 0.70 : 0.44) : lob ? 0.76 : 0.5;

  function throwBox(r, fromX, lob, surface) {
    const bus = S.vehicle === 'bus';
    const elevated = surface && (surface.type === 'roof' || surface.type === 'balcony' || surface.type === 'window');
    const targetX = surface?.center ?? r.lx;
    const lot = r.lot || LOTS[r.n - 1];
    const sidewalkDud = !surface && (lot?.balcony || lot?.pairedBalcony || lot?.apartmentRoof);
    const targetY = surface?.type === 'fence' ? 103 : surface?.type === 'display' || surface?.type === 'door' ? 77 + STOREFRONT_DROP
      : surface ? surface.base - 3 : sidewalkDud ? LAWN_B + 2 : YARD_FOOT;
    const originY = bus ? 119 : 128 + Math.floor(S.time * 6) % 2;
    const highArc = Math.min(94, (originY + targetY) / 2 - 12);
    S.proj.push({
      r, ox: fromX + (bus ? BUS_DRAW_OFFSET : 0), oy: originY,
      lx: targetX, endY: targetY, t: 0, dur: surface?.type === 'bus' ? 0.38 : bus ? 0.78 : shotDuration(lob),
      arc: lob ? highArc : bus ? 74 : elevated ? 45 : 30,
    });
    S.kidToss = 0.25;
    if (lob) SFX.lob();
    else SFX.toss();
  }

  function tryMovingBonus(origin, landingX) {
    const landingDistance = origin + speedNow() * 0.38;
    const alignedRoofs = new Set();
    eachRoofVehicle(origin, (left, _direction, vehicle) => {
      if (Math.abs(left + vehicle.length / 2 - landingX) <= vehicle.catchWidth) alignedRoofs.add(vehicle.index);
    });
    let caught = false;
    eachRoofVehicle(landingDistance, (left, direction, vehicle) => {
      const center = left + vehicle.length / 2;
      if (!vehicle.bonus || caught || S.busBonuses[vehicle.index]) return;
      if (!alignedRoofs.has(vehicle.index) && Math.abs(center - landingX) > vehicle.catchWidth) return;
      const surface = { type: 'bus', base: vehicle.kind === 'car' ? carLaneY(direction) - 5 : 106, center };
      const r = { kind: 'busbonus', vehicleKind: vehicle.kind, landedAt: null, points: vehicle.bonus, lx: center, surface };
      S.busBonuses[vehicle.index] = r;
      throwBox(r, origin, true, surface);
      caught = true;
    });
    return caught;
  }

  // Judge at release time, independent of the next frame.
  function deliver(ts, lob = false) {
    if (state !== 'playing' || S.target >= TOTAL || (trial && S.proj.length)) return false;
    let extra = 0;
    if (!stepping && typeof ts === 'number' && ts > 0 && Math.abs(ts - performance.now()) < 1000) {
      extra = Math.max(0, Math.min(0.1, (ts - lastFrameTs) / 1000)) * speedNow() * timeScale;
    }
    lob = prototype && lob;
    const origin = S.dist + extra;
    const reach = throwReach();
    const lx = origin + reach;
    if (lob && tryMovingBonus(origin, origin + D)) return true;
    const lot = LOTS[S.target];
    const early = lx < lot.lawnStart - HEDGE - ARM;
    if (early && !prototype) { S.nudge = 0.25; return false; }

    const scenery = prototype && sceneryStops.find(stop => lx >= stop.lawnStart && lx <= stop.lawnEnd);
    if (scenery || early) {
      S.streak = 0;
      const kind = scenery ? 'wrong' : 'miss';
      const landing = scenery && !scenery.fenced && !scenery.closed ? 'hit' : 'miss';
      const surface = scenery?.fenced ? { type: 'fence' } : scenery && !scenery.closed ? deliverySurface(scenery, lob) : null;
      const r = { lot: scenery || lot, kind, landing, surface, inflatable: 'santa', points: 0, lx, landedAt: null };
      if (scenery) S.leadInResults.push(r);
      throwBox(r, origin, lob, surface);
    } else {
      resolve(lot, lx, true, origin, lob);
    }
    return true;
  }

  function classify(lot, lx, lob) {
    const upperLanding = lot.balcony || lot.pairedBalcony || lot.apartmentRoof;
    if (upperLanding && !lob) return 'miss';
    const ad = Math.abs(lx - (upperLanding ? deliverySurface(lot, true).center : lot.center));
    if (upperLanding) return ad <= 7 ? 'perfect' : ad <= 18 ? 'hit' : 'miss';
    const precisionLob = lob && (deliverySurface(lot, true).type !== 'yard' || lot.lobPoints);
    const half = precisionLob ? Math.min(18, lot.w / 2) : lot.w / 2;
    if (ad <= (precisionLob ? Math.min(7, lot.perfect) : lot.perfect)) return 'perfect';
    if (ad <= half) return 'hit';
    if (ad <= half + HEDGE) return 'hedge';
    return 'miss';
  }

  function resolve(lot, lx, thrown, fromX, lob = false) {
    const landing = thrown ? classify(lot, lx, lob) : 'skip';
    const onProperty = landing === 'perfect' || landing === 'hit';
    const advance = !prototype || !thrown || onProperty;
    if (advance) S.target++;
    let kind = landing;
    if (prototype && thrown && !lot.order && (!trial || onProperty)) kind = 'wrong';
    const surface = onProperty ? deliverySurface(lot, lob) : null;
    const clean = kind === 'perfect' || kind === 'hit';
    const cameo = clean && lob ? lot.cameo : undefined;
    const squash = clean && surface?.type === 'yard' && lot.snowmanTarget && Math.abs(lx - lot.center) <= 10;
    const lobBonus = clean && lob ? (lot.lobPoints || 0) : 0;
    const pairedBalcony = clean && lot.pairedBalcony && surface?.type === 'balcony';
    if (pairedBalcony && lot.pairedBalcony === 1) S.firstBalconyAt = S.time;
    const doubleBalcony = pairedBalcony && lot.pairedBalcony === 2 && S.results[lot.n - 2]?.surface?.type === 'balcony' && S.firstBalconyAt !== null && S.time - S.firstBalconyAt <= 1.8;
    const doubleSanta = clean && lot.doubleYard === 2 && S.results[lot.n - 2]?.points > 0;
    let points = 0;
    if (kind === 'perfect' || (prototype && kind === 'hit')) {
      S.streak++;
      S.delivered++;
      if (kind === 'perfect') S.perfects++;
      points = (kind === 'perfect' ? PERFECT_BASE : HIT_POINTS) + lobBonus
        + PERFECT_STEP * Math.min(S.streak - 1, STREAK_CAP)
        + (doubleBalcony ? DOUBLE_BALCONY_POINTS : 0) + (doubleSanta ? DOUBLE_YARD_POINTS : 0);
      S.longest = Math.max(S.longest, S.streak);
    } else if (kind === 'hit') {
      S.streak = 0; S.delivered++; points = HIT_POINTS;
    } else if (!prototype || thrown || lot.order) { S.streak = 0; }
    const r = { n: lot.n, kind, landing, surface, lobBonus, doubleBalcony, doubleSanta, squash, inflatable: cameo || (clean && lot.blackSanta && surface?.type === 'yard' ? 'blackSanta' : 'santa'), points, streak: S.streak, lx, side: Math.sign(lx - lot.center) || 1, landedAt: null,
      cameo };
    if (advance) S.results[lot.n - 1] = r;
    else if (kind === 'hedge') S.leadInResults.push(r);
    if (thrown) throwBox(r, fromX, lob, surface);
    else land(r);
  }

  function land(r, projectile) {
    r.landedAt = S.time;
    if (projectile && (r.kind === 'miss' || (r.kind === 'wrong' && r.landing === 'miss'))) {
      S.litter.push({ x: projectile.lx, y: projectile.endY, time: S.time });
    }
    S.score += r.points;
    if (r.kind === 'busbonus') {
      r.landedDist = S.dist;
      flashTrialBonus(r.lx, r.surface.base - 14, r.points, S.streak);
      els.live.textContent = (r.vehicleKind === 'plow' ? 'Snowplow' : r.vehicleKind === 'car' ? 'Car roof' : 'Bus roof') + ' bonus. ' + r.points + ' points.';
      return;
    }
    const lot = r.lot || LOTS[r.n - 1];
    if (r.points) SFX.delivery(r.streak, r.kind === 'perfect');
    const px = r.kind === 'skip' ? lot.center : r.lx;
    if (activeBlock === 1 && !trial && lot.n === FIRST_TURKEY_STOP && r.points && r.surface?.type === 'yard') {
      eachStreetHazard(S.dist, (left, kind, _direction, _variant, _pace, hazard) => {
        if (kind === 'turkey' && hazard && !S.turkeyChase) {
          S.turkeyChase = { hazard, result: r, start: left, target: r.lx - 12 };
        }
      });
    }
    if (lot.yardResident && r.points && r.surface?.type === 'yard') {
      r.residentBonk = true;
      pop(lot.center, 72, 'BONK!', 'Y', 1, 0.15);
    }
    if (r.cameo) { for (let i = 0; i < 22; i++) S.parts.push({ x: r.lx, y: FOOT - 20, vx: (i - 11) * 5, vy: -40 - (i % 4) * 8, t: 0, c: i % 3 ? 'Y' : 'U' }); SFX.cameo(); }
    if (r.doubleSanta) {
      pop(lot.center - 23, 46, 'DOUBLE SANTA!', 'Y', 1);
      flashTrialBonus(lot.center - 23, 76, DOUBLE_YARD_POINTS, r.streak);
    }
    if (r.squash) {
      pop(lot.center, r.surface.base - 28, 'SQUASH!', 'W', 1, 0.1);
      SFX.poof();
    }
    if ((trial || r.lobBonus || r.doubleBalcony) && (r.kind === 'perfect' || r.kind === 'hit')) {
      if (r.lobBonus || r.doubleBalcony) {
        r.pickup = true;
        flashTrialBonus(r.doubleBalcony ? lot.center - 23 : lot.center, r.doubleBalcony ? 33 : r.surface.base - 11, r.points, r.streak);
        if (r.doubleBalcony) pop(lot.center - 23, 51, 'DOUBLE BALCONY +200', 'Y', 1, 0.07);
      } else {
        const y = (r.surface?.base ?? FOOT) - 27;
        pop(r.surface?.center ?? px, y, '+' + r.points, 'W', 1);
        if (r.streak >= 2) pop(r.surface?.center ?? px, y + 8, 'STREAK x' + r.streak, 'Y', 1, 0.14);
      }
      announce(r);
      return;
    }
    if (r.kind === 'perfect') {
      const feedbackY = r.surface?.type === 'roof' ? 69 : 44;
      pop(px, feedbackY, 'PERFECT', 'Y', 2);
      pop(px, feedbackY + 13, '+' + r.points, 'W', 1);
      if (r.streak >= 2) pop(px, feedbackY + 20, 'STREAK x' + r.streak, 'Y', 1, 0.15);
      S.rings.push({ x: r.lx, t: 0 });
      for (let i = 0; i < 14; i++) S.parts.push({ x: r.lx, y: FOOT - 12, vx: Math.cos(i / 14 * Math.PI * 2) * (30 + (i % 3) * 12), vy: Math.sin(i / 14 * Math.PI * 2) * 34 - 18, t: 0, c: i % 2 ? 'Y' : 'W' });
    } else if (r.kind === 'hit') {
      pop(px, 56, 'NICE +' + r.points, 'W', 1);
      if (r.streak >= 2) pop(px, 64, 'STREAK x' + r.streak, 'Y', 1);
    } else if (r.kind === 'hedge') {
      pop(px, 56, 'HEDGE!', 'w', 1); SFX.hedge();
    } else if (r.kind === 'wrong') {
      pop(px, 56, 'NO POINTS', 'Y', 1);
      SFX.wrong();
    } else if (!prototype || r.kind !== 'skip' || lot.order) {
      if (!prototype || r.kind !== 'skip') pop(px, 56, 'MISS', 'v', 1);
      if (!prototype || r.kind !== 'skip') SFX.miss();
    }
    if (!prototype || r.kind !== 'skip') announce(r);
  }
  function flashTrialBonus(x, y, points, streak) {
    pop(x, y - 13, '+' + points, 'Y', 2);
    for (let i = 0; i < 9; i++) {
      const angle = i * Math.PI * 2 / 9;
      S.parts.push({ x, y, vx: Math.cos(angle) * 40, vy: Math.sin(angle) * 31 - 14, t: 0, c: i % 2 ? 'Y' : 'W' });
    }
    SFX.collect(streak);
  }

  function pop(x, y, text, col, sc, delay) { S.pops.push({ x, y, text, col, sc, t: -(delay || 0) }); }

  let liveTimer = 0;
  function announce(r) {
    // Screen readers get a short summary of each result, throttled.
    const msg = { perfect: 'Perfect', hit: 'Delivered', hedge: 'Hedge', miss: 'Miss', skip: 'Miss', wrong: 'No points' }[r.kind];
    clearTimeout(liveTimer);
    liveTimer = setTimeout(() => { els.live.textContent = msg + '. Score ' + S.score + '.'; }, 60);
  }

  // ---------- Update ----------
  function popInflatable(r, sound = SFX.inflatablePop) {
    r.poppedAt = S.time;
    pop(r.lx, r.surface.base - 28, 'POP!', 'W', 1);
    for (let i = 0; i < 10; i++) {
      S.parts.push({ x: r.lx, y: r.surface.base - 15, vx: (i - 5) * 10, vy: -30 - i % 3 * 10, t: 0, c: i % 2 ? 'R' : 'W' });
    }
    sound();
  }

  function update(dt) {
    S.time += dt;
    if (S.introSeconds && S.time >= S.introSeconds) { $('sg-ready').hidden = true; S.introSeconds = 0; }
    S.dist += speedNow() * dt;
    if (activeBlock === 4 && prototype && !trial && S.craneCrossingAt === null && S.dist >= CRANE_CROSSING_X - 63) {
      S.craneCrossingAt = S.time;
    }

    // Vehicle: the bus covers deliveries 61 to 65.
    const wantBus = !prototype && S.dist >= ROUTE.busFrom && S.dist < ROUTE.busTo;
    const want = wantBus ? 'bus' : 'sleigh';
    if (want !== S.vehicle) { S.vehicle = want; S.poof = 0.5; SFX.poof(); }

    // Block banners when the anchor crosses each cross street.
    const b = blockOf(S.dist);
    if (!prototype && b > S.blockShown) { S.blockShown = b; S.banner = { text: 'BLOCK ' + (b + 1), t: 2 }; SFX.block(); }

    // A lawn whose window has passed without a press is a miss; the route keeps moving.
    while (S.target < TOTAL) {
      const lot = LOTS[S.target];
      const nextStart = LOTS[S.target + 1]?.lawnStart ?? Infinity;
      if (markerX() <= Math.min(lot.lawnEnd + HEDGE + 2, nextStart)) break;
      resolve(lot, 0, false);
    }

    for (const p of S.proj) {
      p.t += dt;
      if (activeBlock === 2 && !trial) {
        hitStadiumFans(p);
        hitRisingTurkey(p);
      }
      if (activeBlock === 3 || activeBlock === 5) hitRisingAnimal(p);
      if (p.t >= p.dur && !p.done) {
        p.done = true;
        land(p.r, p);
      }
    }
    S.proj = S.proj.filter(p => !p.done);
    if (activeBlock === 2 && !trial) {
      for (const stop of YARD_TURKEY_STOPS) {
        const lot = LOTS[stop - 1];
        if (!lot || lot.shop || lot.iceCream || lot.residence) continue;
        const r = S.results[stop - 1];
        if (!r || r.landedAt === null || r.tippedAt !== undefined || r.surface?.type !== 'yard' || !r.points) continue;
        if (S.time - r.landedAt < TURKEY_TIP_DELAY) continue;
        r.tippedAt = S.time;
        pop(r.lx, r.surface.base - 34, 'GOBBLE!', 'Y', 1);
        SFX.turkeyTip();
      }
    }
    const chase = S.turkeyChase;
    if (chase && chase.result.poppedAt === undefined && S.time - chase.result.landedAt >= TURKEY_SPRINT_TIME) {
      popInflatable(chase.result, SFX.turkeyTip);
    }
    if (activeBlock === 5) {
      const r = S.results[YARD_CRANE_STOP - 1];
      if (r?.landedAt != null && r.surface?.type === 'yard' && r.points && r.poppedAt === undefined &&
          S.time - r.landedAt >= CRANE_POP_DELAY) {
        popInflatable(r);
      }
    }
    for (const p of S.pops) p.t += dt;
    S.pops = S.pops.filter(p => p.t < 1.3);
    for (const p of S.parts) { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 70 * dt; }
    S.parts = S.parts.filter(p => p.t < 0.9);
    for (const r of S.rings) r.t += dt;
    S.rings = S.rings.filter(r => r.t < 0.5);
    if (S.banner) { S.banner.t -= dt; if (S.banner.t <= 0) S.banner = null; }
    S.poof = Math.max(0, S.poof - dt); S.nudge = Math.max(0, S.nudge - dt); S.kidToss = Math.max(0, S.kidToss - dt);

    const crossedFinish = !prototype || S.dist >= finishLineX();
    if (S.target >= TOTAL && S.proj.length === 0 && crossedFinish) {
      if (S.endTimer === 0) { SFX.end(); S.banner = { text: 'FINISH!', t: 1.1 }; }
      S.endTimer += dt;
      if (S.endTimer > 1.05) gameOver();
    }
  }
  function updateFlakes(dt) {
    for (const f of flakes) {
      f.y += (8 + f.s * 10) * dt; f.x -= (state === 'playing' ? 10 : 3) * f.s * dt;
      if (f.y > H) { f.y = -2; } if (f.x < 0) f.x += W;
    }
  }

  // ---------- Drawing ----------
  const R = (col, x, y, w, h) => { ctx.fillStyle = PAL[col] || col; ctx.fillRect(Math.round(x), Math.round(y), w, h); };

  function drawSky(cam) {
    R('#101b49', 0, 0, W, 85);
    for (const star of stars) {
      if (star.x % 3 === 0 && star.y < 42) R('w', star.x, star.y, 1, 1);
    }
    R('#233550', 0, 51, W, 34);
    const distant = Math.floor(cam / 10);
    const near = Math.floor(cam / 5);
    for (const [offset, color, baseline] of [[distant, '#25395c', 56], [near, '#193637', 76]]) {
      const first = Math.floor(offset / 13) - 1;
      for (let i = first; i < first + 18; i++) {
        const shape = ((i * 17) % 11 + 11) % 11;
        const x = i * 13 - offset + shape % 5;
        const height = 16 + shape * 2;
        for (let row = 0; row < height; row++) {
          const half = Math.floor((row % Math.ceil(height / 2)) / 2);
          R(color, x - half, baseline - height + row, half * 2 + 1, 1);
        }
        R(color, x - 1, baseline, 3, 85 - baseline);
      }
    }
  }

  function drawChristmasTree(x, y, seed) {
    R('b', x - 2, y - 5, 4, 7);
    for (const [top, width] of [[y - 37, 9], [y - 29, 13], [y - 20, 17]]) {
      for (let row = 0; row < 16; row++) {
        const half = Math.floor(row * width / 16);
        R('#214a38', x - half, top + row, half * 2 + 1, 1);
        if (row > 5 && row < 9) R('w', x - half, top + row, 3, 1);
      }
    }
    R('Y', x - 2, y - 39, 5, 1);
    R('Y', x, y - 41, 1, 5);
    const bulbs = [[0, -32], [-4, -25], [4, -23], [-7, -17], [1, -17], [8, -14], [-10, -8], [-2, -10], [5, -7], [11, -7]];
    bulbs.forEach(([dx, dy], i) => {
      const phase = Math.floor(S.time * 4) + seed + i;
      const color = LIGHTS[(i + seed) % LIGHTS.length];
      R(phase % 5 === 0 ? 'W' : color, x + dx, y + dy, 2, 2);
    });
  }

  function drawOvergrownYard(left, width, seed) {
    const random = mulberry32(seed + 734);
    for (let i = 0; i < 30; i++) {
      const x = left + Math.round(random() * (width - 3));
      const y = 91 + Math.floor(i / 10) * 8 + Math.round(random() * 4);
      const height = 3 + Math.floor(random() * 16);
      const leaf = i % 3 ? '#285642' : '#447454';
      R('#294638', x, y - height, 2, height);
      R(leaf, x - 4, y - height + 3, 5, 3);
      R(leaf, x + 1, y - height + 7, 5, 3);
      if (i % 3 === 0) R(i % 2 ? '#a96d85' : '#c1a963', x - 1, y - height - 2, 4, 3);
      if (i % 5 === 0) R('w', x - 3, y - height, 6, 1);
    }
  }

  function drawDeciduousLights(x, y, ornaments = false) {
    const span = ornaments ? 1.15 : 1;
    const branches = [
      [0, 0, 0, -39, 6], [0, -31, -4, -60, 4], [-4, -60, -12, -72, 2],
      [0, -33, 14, -55, 4], [14, -55, 29, -65, 2], [14, -55, 17, -73, 2],
      [-1, -29, -16, -45, 4], [-16, -45, -31, -52, 2], [-16, -45, -22, -63, 2],
      [0, -20, 18, -32, 4], [18, -32, 34, -37, 2], [18, -32, 27, -49, 2],
      [-1, -18, -16, -28, 3], [-16, -28, -34, -33, 2], [-16, -28, -24, -42, 2],
    ];
    for (const [x0, y0, x1, y1, thickness] of branches) {
      const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
      for (let step = 0; step <= steps; step++) {
        const px = x + (x0 + (x1 - x0) * step / steps) * span;
        const py = y + (y0 + (y1 - y0) * step / steps) * span;
        R('#513440', px - Math.floor(thickness / 2), py, thickness, thickness);
        R('#88625c', px, py, 1, 1);
      }
    }
    for (const [index, [x0, y0, x1, y1]] of branches.entries()) {
      const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
      for (let step = 2; step < steps; step += 5) {
        const px = x + (x0 + (x1 - x0) * step / steps) * span;
        const py = y + (y0 + (y1 - y0) * step / steps) * span;
        const bulb = index + step;
        const twinkle = (Math.floor(S.time * 4) + bulb) % 7 === 0;
        R(twinkle ? 'W' : LIGHTS[bulb % LIGHTS.length], px + step % 2 - 1, py, 2, 2);
      }
    }
    if (ornaments) {
      const baubles = [[-12, -64, 'R'], [17, -64, 'Y'], [-27, -50, 'U'], [30, -52, 'R'],
        [-13, -41, 'Y'], [13, -39, 'U'], [-32, -31, 'R'], [31, -28, 'Y']];
      for (const [dx, dy, color] of baubles) {
        const bx = x + dx * span, by = y + dy * span;
        R('w', bx, by - 7, 1, 5);
        R('Y', bx - 1, by - 3, 3, 2);
        R(color, bx - 3, by - 1, 7, 7);
        R(color, bx - 4, by + 1, 9, 3);
        R('#fff4d8', bx - 2, by, 2, 2);
      }
    }
  }

  function drawPorchLights(x, y, width, seed, paint = R) {
    for (let i = 0; i < width; i += 4) {
      const index = i / 4;
      const twinkle = (Math.floor(S.time * 4) + index + seed) % 7 === 0;
      paint(twinkle ? 'W' : LIGHTS[(index + seed) % LIGHTS.length], x + i, y + index % 2, 2, 2);
    }
  }

  function drawSchoolFence(x, halfSpan) {
    for (let post = -halfSpan; post <= halfSpan; post += 5) {
      if (Math.abs(post) < 11) continue;
      const pillar = (post + halfSpan) % 25 === 0;
      R('#252b42', x + post, pillar ? 89 : 94, pillar ? 3 : 1, pillar ? 26 : 20);
      R('w', x + post, pillar ? 89 : 94, pillar ? 3 : 1, 1);
    }
    for (const rail of [98, 110]) {
      R('#252b42', x - halfSpan, rail, halfSpan - 11, 2);
      R('#252b42', x + 11, rail, halfSpan - 10, 2);
    }
    for (const side of [-1, 1]) {
      const end = x + side * 12;
      R('#31354d', end - 1, 89, 3, 26);
      R('W', end - 1, 89, 3, 1);
    }
  }

  function drawWingrow(cam) {
    const x = wingrow.center - cam;
    if (x < -68 || x > W + 68) return;
    for (let y = 70; y < LAWN_B; y++) {
      const span = 35 + Math.floor((y - 70) * 0.65);
      R(y < 75 ? 'W' : y < 84 ? 'w' : '#8296aa', x - span, y, span * 2, 1);
    }
    R('w', x - 10, 68, 20, 46);
    for (let y = 74; y < 113; y += 5) {
      const width = 18 + Math.floor((y - 74) / 5);
      R('v', x - width / 2, y, width, 2);
    }
    R('#79655d', x - 45, 19, 90, 53);
    R('#564b50', x - 48, 16, 96, 4);
    R('W', x - 49, 15, 98, 2);
    R('#a86753', x - 16, 18, 32, 54);
    for (let row = 0; row < 11; row++) R('W', x - row - 5, 7 + row, row * 2 + 11, 1);
    for (const top of [23, 39, 55]) {
      R('#65504d', x - 44, top + 12, 88, 2);
      for (const offset of [-38, -26, 18, 30]) {
        R('N', x + offset, top, 9, 11);
        R('Y', x + offset + 1, top + 1, 7, 8);
        R('k', x + offset + 4, top, 1, 11);
      }
    }
    R('w', x - 17, 36, 34, 14);
    drawText(ctx, 'WINGROW', x, 37, 'K', 1, 'center', null);
    drawText(ctx, 'SCHOOL', x, 43, 'K', 1, 'center', null);
    R('N', x - 6, 55, 12, 17);
    R('Y', x - 5, 56, 10, 4);
    drawPorchLights(x - 44, 19, 88, 2);
    drawChristmasTree(x + 50, 95, 0);
    drawSchoolFence(x, 60);
  }

  function drawWindowTree(x, y) {
    R('#326647', x + 2, y + 1, 1, 4);
    R('#326647', x + 1, y + 3, 3, 3);
    R('#326647', x, y + 5, 5, 2);
    R('Y', x + 2, y, 1, 1);
    R('R', x + 1, y + 5, 1, 1);
    R('W', x + 3, y + 4, 1, 1);
    R('#684359', x + 2, y + 7, 1, 1);
  }

  function drawWindowPerson(x, y, coat, wave = 0) {
    R(coat, x + 1, y + 1, 2, 3);
    R(coat, x, y + 4, 4, 3);
    if (wave) R(coat, x + 3, y + 3, 2, 1);
  }

  function drawWindowKiss(x, y) {
    const cycle = S.time % 1.9;
    const lean = cycle < 0.38 ? 0 : cycle < 0.66 ? 1 : cycle < 1.45 ? 2 : 1;
    R('#18243e', x - 2, y - 1, 13, 11);
    R('#f8ce81', x - 1, y, 11, 9);
    R('#4a3651', x, y + 6, 4, 3);
    R('#4a3651', x + 6, y + 6, 4, 3);
    R('#4a3651', x + lean, y + 3, 3, 3);
    R('#4a3651', x + 7 - lean, y + 3, 3, 3);
    if (lean === 2) {
      R('#4a3651', x + 4, y + 4, 2, 1);
      R('R', x + 3, y + 1, 1, 1);
      R('R', x + 5, y + 1, 1, 1);
      R('R', x + 4, y + 2, 1, 1);
    }
  }

  function drawCreandoKids(x) {
    const bounce = Math.floor(S.time * 6) % 2;
    const ballX = x - 16 + 14 * (1 - Math.abs((S.time * 2 % 2) - 1));
    R('#d69662', x - 22, 77, 26, 4);
    for (const [index, offset] of [-21, -12, -2].entries()) {
      const y = 78 - (index % 2 === bounce ? 2 : 0);
      const coat = ['U', 'R', 'G'][index];
      R('#583849', x + offset + 1, y - 7, 4, 2);
      R('S', x + offset + 2, y - 5, 3, 2);
      R(coat, x + offset + 1, y - 3, 5, 4);
      R(coat, x + offset, y - 4, 2, 1);
      R('K', x + offset + 1, y + 1, 2, 2);
      R('K', x + offset + 4, y + 1, 2, 2);
    }
    R('Y', ballX, 69 + bounce * 3, 2, 2);
  }

  function drawShopApartments(x, top, brick, trim, bottom = 82, pattern = '') {
    R(brick, x - 32, top, 64, bottom - top);
    R(trim, x - 33, top, 66, 4);
    R('W', x - 34, top - 1, 68, 2);
    let pane = 0;
    for (let row = top + 7; row <= bottom - 12; row += 15) {
      for (const offset of [-24, -8, 8, 24]) {
        R(trim, x + offset - 4, row, 8, 10);
        const lit = pattern ? pattern[pane] === '1' : row + offset > 55;
        R(lit ? 'Y' : 'n', x + offset - 3, row + 1, 6, 7);
        pane++;
        if (pattern && lit && pane % 3 === 1) {
          drawWindowTree(x + offset - 2, row + 1);
        } else if (pattern && lit && pane % 4 === 2) {
          drawWindowPerson(x + offset - 2, row + 1, '#5b4357', Math.floor(S.time * 2 + pane) % 2);
        } else {
          R('K', x + offset, row + 1, 1, 7);
        }
        R('w', x + offset - 5, row + 9, 10, 1);
      }
    }
  }

  function drawTraderSnow(cam) {
    const store = traderSnow.center - cam;
    drawShopApartments(store, 34, '#884943', '#603238', 82, '011010110100');
    ctx.save();
    ctx.translate(0, STOREFRONT_DROP);
    R('#783630', store - 30, 51, 60, 34);
    R('W', store - 32, 48, 64, 3);
    R('#f1d8a4', store - 28, 55, 56, 9);
    drawText(ctx, 'TRADER SNOW', store, 57, 'K', 1, 'center', null);
    R('#283950', store - 24, 70, 31, 12);
    R('Y', store - 22, 72, 13, 7);
    R('Y', store - 7, 72, 12, 7);
    R('b', store + 13, 69, 10, 16);
    drawPorchLights(store - 29, 52, 59, 0);
    ctx.restore();
  }

  function drawSchoolStadium(cam) {
    const x = school.center + 80 - cam;
    R('#224e3c', x - 30, 88, 62, 24);
    R('#68798b', x - 32, 85, 66, 4);
    R('#bccce0', x - 26, 89, 55, 1);
    for (const line of [-19, -10, 0, 10, 20]) R('#a5c3bb', x + line, 93, 1, 13);
    R('#111d39', x - 30, 106, 62, 5);
    for (const offset of [-27, 27]) {
      R('k', x + offset, 60, 2, 47);
      R('Y', x + offset - 4, 59, 10, 4);
      R('W', x + offset - 3, 59, 8, 2);
      R('rgba(255, 224, 154, 0.13)', x + offset - 8, 63, 18, 24);
    }
  }

  function drawHedgewood(cam) {
    const x = school.center - cam;
    if (x < -120 || x > W + 80) return;
    drawSchoolStadium(cam);
    R('#7e4942', x - 58, 51, 116, 34);
    R('W', x - 60, 48, 120, 3);
    R('#eee1b8', x - 41, 53, 82, 10);
    drawText(ctx, 'HEDGEWOOD SCHOOL', x, 55, 'K', 1, 'center', null);
    for (const wx of [-49, -35, -21, 16, 30, 44]) {
      R('K', x + wx, 68, 10, 10);
      R('Y', x + wx + 1, 69, 8, 8);
    }
    R('N', x - 8, 68, 16, 17);
    R('O', x - 10, 85, 20, 31);
    R('w', x - 54, 113, 106, 3);
    drawPorchLights(x - 56, 51, 112, 1);
    drawChristmasTree(x - 65, 107, 1);
    drawChristmasTree(x + 63, 100, 2);
    drawSchoolFence(x, 59);
  }

  function drawLeadIn(cam) {
    if (marketRoute) {
      drawTraderSnow(cam);
      return;
    }
    if (activeBlock === 5) {
      const x = apartment.center - cam;
      R('#28513a', x - 33, 85, 66, 30);
      R('w', x - 32, 113, 64, 2);
      R('#864837', x - 32, 24, 64, 61);
      R('#59312d', x - 27, 27, 5, 58);
      R('W', x - 34, 22, 68, 3);
      for (const row of [31, 44, 57, 70]) {
        R('#a4614f', x - 31, row + 9, 62, 1);
        for (const column of [-19, -5, 9, 23]) {
          R('N', x + column, row, 7, 8);
          R(column === 9 && row === 44 ? 'n' : 'Y', x + column + 1, row + 1, 5, 5);
          R('w', x + column - 1, row + 8, 9, 1);
        }
      }
      R('N', x - 4, 73, 8, 12);
      R('O', x - 6, 86, 12, 28);
      drawPorchLights(x - 29, 25, 60, 2);
      drawChristmasTree(x + 37, 106, 3);
      drawLot(laterHouse, cam, false);
      return;
    }
    for (const stop of openingLandmarks) {
      if (stop.pongTable || stop.fratYard) drawLot(stop, cam, false);
    }
    const stadium = openingLandmarks[2].center - cam;
    R('#234b36', stadium - 49, 82, 98, 33);
    R('w', stadium - 45, 113, 90, 2);
    R('#783630', stadium - 42, 58, 84, 26);
    R('w', stadium - 44, 55, 88, 4);
    R('N', stadium - 33, 53, 66, 4);
    R('r', stadium - 47, 46, 94, 7);
    R('W', stadium - 48, 45, 96, 2);
    R('v', stadium - 41, 41, 82, 4);
    R('w', stadium - 27, 32, 54, 9);
    R('N', stadium - 23, 34, 46, 5);
    for (let x = -20; x < 23; x += 7) R('Y', stadium + x, 35, 4, 2);
    R('W', stadium - 29, 30, 58, 2);
    for (let x = -35; x <= 35; x += 14) {
      R('C', stadium + x - 4, 65, 9, 19);
      R('w', stadium + x - 5, 64, 2, 19);
      R('w', stadium + x + 4, 64, 2, 19);
      R('w', stadium + x - 3, 62, 6, 2);
    }
    R('K', stadium - 27, 47, 54, 7);
    drawText(ctx, 'CAMP TINSEL', stadium, 48, 'Y', 1, 'center', null);
    for (const side of [-1, 1]) {
      R('v', stadium + side * 40, 20, 2, 25);
      R('W', stadium + side * 40 - 5, 19, 12, 3);
      R('Y', stadium + side * 40 - 4, 20, 10, 1);
    }
    drawPorchLights(stadium - 40, 57, 80, 1);
    drawStadiumCrowd(stadium);

  }

  function drawBalcony(x, base) {
    R('k', x - 14, base + 2, 28, 2);
    R('W', x - 14, base - 4, 28, 1);
    for (let offset = -12; offset <= 12; offset += 6) R('w', x + offset, base - 3, 1, 5);
  }

  function drawDoorWreath(x, y, paint = R) {
    paint('G', x - 2, y - 2, 5, 1);
    paint('g', x - 3, y - 1, 2, 3);
    paint('G', x + 2, y - 1, 2, 3);
    paint('g', x - 2, y + 2, 5, 1);
    paint('R', x - 1, y + 2, 3, 2);
  }

  function drawHouse(lot, sx) {
    if (lot.residence) {
      const buildingTop = lot.residence === 'apartment' ? 25 : 38;
      const width = lot.residence === 'apartment' ? 63 : 68;
      const left = Math.round(sx - width / 2);
      const buildingBottom = 114;
      R(lot.residence === 'apartment' ? '#864837' : '#77768d', left, buildingTop, width, buildingBottom - buildingTop);
      R('W', left - 2, buildingTop - 2, width + 4, 2);
      for (let y = buildingTop + 7; y < 106; y += 13) {
        for (const dx of [8, 23, 39, 53]) {
          R('N', left + dx, y, 7, 8);
          R((y + dx) % 3 ? 'Y' : 'v', left + dx + 1, y + 1, 5, 5);
        }
      }
      R('N', sx - 7, 93, 14, 21);
      R('Y', sx - 5, 95, 10, 5);
      R('w', sx - 9, 113, 18, 2);
      if (!lot.closed) drawBalcony(sx, 67);
      drawPorchLights(left + 2, buildingTop, width - 2, lot.n);
      return;
    }
    if (lot.sign || lot.blankFront) {
      drawShopApartments(sx, 30, lot.brick, lot.trim, 82, marketRoute ? lot.windowPattern : undefined);
      ctx.save();
      ctx.translate(0, STOREFRONT_DROP);
      R(lot.brick, sx - 31, 47, 62, 38);
      R(lot.trim, sx - 32, 45, 64, 4);
      R('W', sx - 33, 43, 66, 2);
      if (lot.sign) {
        R('w', sx - 27, 50, 54, 14);
        drawText(ctx, lot.sign[0], sx, lot.sign[1] ? 51 : 54, 'K', 1, 'center', null);
        if (lot.sign[1]) drawText(ctx, lot.sign[1], sx, 58, 'K', 1, 'center', null);
      }
      R(lot.trim, sx - 28, 65, 56, 20);
      R('w', sx - 26, 63, 34, 22);
      R('N', sx - 24, 65, 30, 18);
      R(lot.displayWindow ? '#f3cf7b' : 'y', sx - 23, 66, 28, 15);
      R('w', sx + 13, 66, 12, 19);
      R('N', sx + 15, 68, 8, 17);
      R('Y', sx + 16, 69, 6, 9);
      R('Y', sx + 21, 80, 1, 1);
      if (lot.shop === 'creando') {
        drawCreandoKids(sx);
      } else if (lot.shop === 'fitness') {
        R('U', sx - 21, 68, 24, 10);
        R('W', sx - 17, 72, 15, 1);
        for (const offset of [-18, -3]) R('W', sx + offset, 70, 3, 5);
      } else if (lot.shop === 'brewbar' || lot.shop === 'tavern') {
        R('r', sx - 22, 67, 26, 13);
        R('Y', sx - 20, 73, 10, 5);
        R('Y', sx - 6, 73, 8, 5);
        R('W', sx - 21, 72, 12, 1);
        R('W', sx - 7, 72, 10, 1);
      }
      drawPorchLights(sx - 29, 45, 60, lot.n);
      ctx.restore();
      return;
    }
    if (lot.shop === 'cantina') {
      drawShopApartments(sx, 38, '#873e3a', '#592c37');
      ctx.save();
      ctx.translate(0, STOREFRONT_DROP);
      R('#873e3a', sx - 32, 53, 64, 32);
      R('W', sx - 33, 50, 66, 3);
      R('#f1d8a4', sx - 30, 57, 60, 10);
      drawText(ctx, 'CAMP CANTINA', sx, 59, 'K', 1, 'center', null);
      R('g', sx - 30, 69, 60, 4);
      R('N', sx - 25, 75, 30, 8);
      R('Y', sx - 23, 76, 11, 5);
      R('Y', sx - 10, 76, 12, 5);
      R('b', sx + 13, 74, 9, 11);
      drawPorchLights(sx - 29, 53, 60, lot.n);
      ctx.restore();
      return;
    }
    if (lot.iceCream) {
      drawShopApartments(sx, ICE_CREAM_ROOF, '#963e4e', '#782e39', 65);
      R('#343951', sx - 34, 94, 68, LAWN_B - 94);
      R('w', sx - 34, 94, 68, 2);
      for (const stripe of [-24, -12, 12, 24]) {
        R('#d8d9c6', sx + stripe, 98, 1, 12);
        R('#d8d9c6', sx + stripe - 2, 98, 5, 1);
      }
      ctx.save();
      ctx.translate(0, 10);
      R('#782e39', sx - 31, 54, 62, 31);
      R('W', sx - 32, 52, 64, 3);
      R('W', sx - 29, 55, 58, 17);
      drawText(ctx, 'ICE CREAM', sx, 57, 'K', 1, 'center', null);
      drawText(ctx, 'SHOPPE', sx, 64, 'K', 1, 'center', null);
      for (let x = -28; x < 28; x += 4) R(x % 8 ? 'R' : 'W', sx + x, 72, 4, 4);
      R('N', sx - 25, 77, 32, 7);
      R('Y', sx - 23, 78, 10, 5);
      R('Y', sx - 11, 78, 15, 5);
      R('b', sx + 13, 76, 9, 9);
      drawPorchLights(sx - 29, 54, 58, lot.n || 0);
      ctx.restore();
      return;
    }
    if (lot.colonial) {
      const [color, shade] = lot.color;
      R(shade, sx - 29, 43, 58, 41);
      R(color, sx - 26, 43, 54, 39);
      for (let y = 46; y < 82; y += 4) R(shade, sx - 25, y, 52, 1);
      for (let row = 0; row < 13; row++) R(row < 2 ? 'W' : 'T', sx - 12 - row * 1.6, 30 + row, 25 + row * 3.2, 1);
      R('W', sx - 32, 42, 64, 2);
      for (const x of [-20, 13]) {
        for (const y of [49, 67]) {
          R('w', sx + x - 1, y - 1, 10, 11);
          R('Y', sx + x + 1, y + 1, 6, 7);
          R('K', sx + x + 4, y, 1, 9);
        }
      }
      R('w', sx - 6, 62, 12, 22);
      R('#593644', sx - 4, 64, 8, 20);
      drawDoorWreath(sx, 70);
      drawPorchLights(sx - 26, 44, 53, lot.n || 0);
      return;
    }
    const [siding, shade] = lot.color;
    const cx = Math.round(sx);
    const frontage = lot.cottage ? 0.76 : lot.frontage || 1;
    const height = lot.cottage ? 0.78 : lot.height || 1;
    const paint = (color, x, y, width, depth) => {
      const left = Math.round(cx + (x - cx) * frontage);
      const top = Math.round(LAWN_Y + (y - LAWN_Y) * height);
      R(color, left, top, Math.max(1, Math.round(cx + (x + width - cx) * frontage) - left),
        Math.max(1, Math.round(LAWN_Y + (y + depth - LAWN_Y) * height) - top));
    };
    const x = cx - 30, y = 56, base = LAWN_Y - 3;
    const chimney = lot.style ? x + 48 : x + 7;
    paint('#753831', chimney, 37, 7, 17);
    paint('W', chimney - 1, 36, 9, 2);
    paint(siding, x, y, 60, base - y);
    for (let row = y + 2; row < base; row += 4) paint(shade, x, row, 60, 1);
    // Snow on the front gable follows the same stepped outline as the roof.
    const peak = lot.style ? cx + 3 : cx - 3;
    for (let row = 0; row < 22; row++) {
      const left = peak - Math.floor(row * (peak - x + 5) / 21);
      const right = peak + Math.floor(row * (x + 64 - peak) / 21);
      paint(siding, left, 36 + row, right - left + 1, 1);
      paint('W', left - 2, 36 + row, 4, 1);
      paint('W', right - 1, 36 + row, 4, 1);
      paint('K', left + 2, 36 + row, 1, 1);
      paint('K', right - 2, 36 + row, 1, 1);
    }
    const lightSeed = lot.n || lot.style || 0;
    if (lightSeed % 3 !== 2) {
      for (let row = 4; row <= 20; row += 4) {
        const left = peak - Math.floor(row * (peak - x + 5) / 21);
        const right = peak + Math.floor(row * (x + 64 - peak) / 21);
        const bulb = row / 4 + lightSeed;
        const twinkle = (Math.floor(S.time * 3) + bulb) % 9 === 0;
        paint(twinkle ? 'W' : LIGHTS[bulb % LIGHTS.length], left - 2, 36 + row, 3, 2);
        paint(twinkle ? 'W' : LIGHTS[(bulb + 2) % LIGHTS.length], right, 36 + row, 3, 2);
      }
    }
    paint('W', peak - 2, 35, 5, 2);
    paint('W', peak - 4, 47, 9, 7);
    paint('K', peak - 3, 48, 7, 5);
    const lights = marketRoute && lot.n ? [0b101, 0b010, 0b110, 0b001][(lot.n + Math.floor(lot.n / 3)) % 4] : 0b111;
    paint(lights & 4 ? 'Y' : 'n', peak - 2, 49, 2, 3);
    paint(lights & 4 ? 'y' : 'N', peak + 1, 49, 2, 3);

    const door = lot.style ? x + 14 : x + 41;
    const windowX = lot.style ? x + 32 : x + 9;
    paint('W', windowX, 62, 16, 13);
    for (const [index, wx] of [windowX + 1, windowX + 9].entries()) {
      const lit = lights & (1 << index);
      paint('K', wx, 63, 6, 11);
      paint(lit ? 'Y' : 'n', wx + 1, 64, 4, 7);
      paint(lit ? 'y' : 'N', wx + 1, 69, 4, 2);
    }
    paint('w', door - 1, 61, 9, 18);
    paint('#753831', door, 62, 7, 17);
    paint('Y', door + 1, 64, 4, 5);
    paint('Y', door + 5, 73, 1, 1);
    paint('T', x - 3, 57, 66, 3);
    paint('W', x - 3, 56, 66, 1);
    drawPorchLights(x - 2, 59, 64, lot.n || 0, paint);
    paint('g', door + 1, 67, 5, 4);
    paint('G', door + 2, 66, 3, 5);
    paint('b', door + 2, 68, 3, 2);
    paint('R', door + 2, 71, 3, 1);
    for (const post of [x + 2, x + 56]) {
      paint('W', post, 60, 2, 15);
      paint('#753831', post - 2, 74, 6, 9);
      paint('#9b4a4a', post - 1, 76, 3, 1);
    }
    paint('k', door - 3, 79, 13, 2);
    paint('v', door - 4, 81, 15, 2);
    paint('w', door - 5, 83, 17, 2);
  }

  function drawHedge(sx) {
    R('g', sx, 104, HEDGE, 10); R('G', sx + 1, 105, 2, 2); R('G', sx + 3, 108, 2, 2);
    R('W', sx, 103, HEDGE, 2); R('W', sx + 1, 102, HEDGE - 2, 1);
  }

  function drawHedgeScreen(lot, cam) {
    const left = Math.round(lot.lawnStart - cam);
    if (left + lot.w < 0 || left > W) return;
    R('#142f29', left, 98, lot.w, 18);
    for (let x = 0; x < lot.w; x += 6) {
      const top = 97 + (x % 4);
      R('#2a5a3c', left + x, top, Math.min(6, lot.w - x), LAWN_B - top);
      R('w', left + x, top, Math.min(4, lot.w - x), 2);
      R('g', left + x, top + 9, Math.min(4, lot.w - x), 3);
    }
  }

  function drawBonusBox(x, y, bonus, collected, label = '+' + bonus) {
    const width = Math.max(23, textWidth(label) + 4);
    const left = x - Math.floor(width / 2);
    if (collected?.landedAt != null) {
      const age = S.time - collected.landedAt;
      if (age < 0.18) {
        const rise = Math.floor(age * 42);
        const shrink = Math.floor(age * 28);
        R('Y', left + shrink, y - rise, width - shrink * 2, 9 - shrink);
        R('W', left + 1 + shrink, y - rise, width - 2 - shrink * 2, 1);
      }
      return;
    }
    R('N', left, y, width, 9);
    R('Y', left, y, width, 1);
    drawText(ctx, label, x, y + 2, 'Y', 1, 'center', null);
  }
  function drawLobBonuses(lot, sx) {
    if (lot.lobPoints) {
      const r = S.results[lot.n - 1];
      const surface = deliverySurface(lot, true);
      const roofHint = (activeBlock === 1 || activeBlock === 5) && surface.type === 'roof';
      const bounce = surface.type === 'roof' && !r?.pickup ? Math.round(Math.abs(Math.sin(S.time * 4)) * 3) : 0;
      drawBonusBox(sx + (surface.center ?? lot.center) - lot.center, surface.base - 11 - bounce, lot.lobPoints,
        r?.pickup ? r : null, roofHint ? 'ROOF +' + lot.lobPoints : undefined);
    }
    if (lot.pairedBalcony === 1 && !lot.lobPoints) {
      const r = S.results[lot.n];
      drawBonusBox(sx + 23, 33, DOUBLE_BALCONY_POINTS, r?.pickup ? r : null);
    }
  }

  function drawTrialStop(lot, sx, card) {
    if (lot.park) {
      R('#285342', sx - 34, 85, 68, 29);
      R('W', sx - 34, 110, 68, 5);
      drawChristmasTree(sx - 21, 104, 0);
      R('b', sx + 8, 94, 18, 3);
      R('b', sx + 8, 98, 18, 2);
      R('K', sx + 9, 100, 2, 5);
      R('K', sx + 23, 100, 2, 5);
      R('w', sx + 7, 93, 19, 1);
      return true;
    }
    if (lot.pairedBalcony && !card) {
      if (lot.pairedBalcony === 1) {
        const middle = sx + 23;
        R(lot.brick || '#895342', middle - 45, 46, 90, 68);
        R('w', middle - 45, 114, 90, 2);
        R('W', middle - 47, 44, 94, 3);
        for (const [floor, y] of [55, 70, 86, 101].entries()) {
          const windows = y === 101 ? [-36, -21, 13, 28] : [-36, -19, -2, 15, 32];
          for (const [column, dx] of windows.entries()) {
            const x = middle + dx;
            const kissing = lot.name === 'Monroe flats' && floor === 0 && column === 2;
            const detail = (lot.n + floor * 2 + column * 3) % 7;
            const light = (lot.n * 5 + floor * 7 + column * 11 + floor * column * 3) % 13;
            R('N', x, y, 8, 9);
            const lit = lot.windowRows ? lot.windowRows[floor][column] === '1' : light < 7;
            if (kissing) {
              drawWindowKiss(x, y);
            } else if (lit) {
              R(light < 3 ? '#f7bc67' : '#f7db92', x + 1, y + 1, 6, 7);
              if (detail < 3) {
                drawWindowPerson(x + 2, y + 1, '#523f50', Math.floor(S.time * 2 + column) % 2);
              } else if (detail < 5) {
                drawWindowTree(x + 2, y);
              }
            } else {
              R('#283752', x + 1, y + 1, 6, 7);
              R('#40516c', x + 1, y + 1, 1, 5);
            }
          }
        }
        R('#d4b092', middle - 8, 95, 16, 19);
        R('N', middle - 6, 97, 12, 17);
        R('Y', middle - 4, 99, 8, 5);
        R('w', middle - 9, 114, 18, 2);
        drawPorchLights(middle - 43, 48, 86, 0);
        drawBalcony(sx + 5, lot.balconyBase || 77);
        drawBalcony(sx + 41, LOTS[lot.n]?.balconyBase || 77);
      }
      drawLobBonuses(lot, sx);
      return true;
    }
    return false;
  }

  function drawTailgater(x, y, coat, cap, pose = 0) {
    R('K', x + 1, y - 4, 2, 4);
    R('K', x + 4, y - 4, 2, 4);
    R(coat, x, y - 10, 7, 7);
    R('S', x + 2, y - 14, 4, 4);
    R(cap, x + 1, y - 15, 6, 2);
    if (pose) {
      R(coat, x + 6, y - 9 - pose, 3, 2);
      R('S', x + 8, y - 9 - pose, 1, 2);
    }
  }

  function drawFallingPerson(x, y, fall, coat) {
    ctx.save();
    ctx.translate(Math.round(x), y);
    ctx.rotate(fall * Math.PI / 2);
    drawTailgater(-3, 0, coat, 'W', fall > 0 && fall < 0.7 ? 2 : 0);
    ctx.restore();
  }

  function eachStadiumFan(center, visit) {
    for (let i = 0; i < 11; i++) {
      const stroll = Math.round(Math.sin(S.time * 1.9 + i * 1.7) * (i % 3 ? 5 : 10));
      visit(i, center - 60 + i * 11 + stroll, 96 + i % 3, i % 3 ? 'R' : 'r', i % 4 ? 'R' : 'W', i % 2);
    }
    for (let i = 0; i < 9; i++) {
      const wave = (i + Math.floor(S.time * 2)) % 4 === 0 ? 2 : 0;
      const stroll = Math.round(Math.sin(S.time * 2.1 - i) * (i % 2 ? 8 : 4));
      visit(11 + i, center - 52 + i * 12 + stroll, 112 + i % 2 * 2, i % 4 ? 'R' : 'r', i % 3 ? 'W' : 'R', wave);
    }
  }

  function hitStadiumFans(projectile) {
    if (projectile.fanHit) return;
    const center = openingLandmarks[2].center;
    const u = Math.min(1, projectile.t / projectile.dur);
    const descent = projectile.endY - projectile.oy - 4 * projectile.arc * (1 - 2 * u);
    if (descent <= 0) return;
    const x = projectile.ox + (projectile.lx - projectile.ox) * u;
    if (Math.abs(x - center) > 75) return;
    const y = projectileHeight(projectile, u);
    let closest;
    eachStadiumFan(center, (index, left, foot) => {
      if (S.fallenFans.has(index)) return;
      const dx = Math.abs(x - (left + 4));
      const dy = Math.abs(y - (foot - 13));
      if (dx > 5 || dy > 4 || (closest && dx + dy >= closest.distance)) return;
      closest = { index, x: left, y: foot, distance: dx + dy };
    });
    if (!closest) return;
    projectile.fanHit = true;
    S.fallenFans.set(closest.index, {
      x: closest.x, y: closest.y, time: S.time, side: projectile.lx >= projectile.ox ? 1 : -1,
    });
    pop(x, y - 17, 'BONK!', 'Y', 1);
    SFX.hedge();
  }

  function drawStadiumCrowd(x) {
    eachStadiumFan(x, (index, left, foot, coat, cap, pose) => {
      const fallen = S.fallenFans.get(index);
      if (!fallen) {
        drawTailgater(left, foot, coat, cap, pose);
        return;
      }
      const progress = Math.min(1, (S.time - fallen.time) / 0.34);
      const camera = openingLandmarks[2].center - x;
      drawFallingPerson(fallen.x - camera + fallen.side * progress * 6, fallen.y, fallen.side * progress, coat);
    });
  }

  function drawPongTable(x, y) {
    R('K', x + 2, y + 3, 2, 6);
    R('K', x + 19, y + 3, 2, 6);
    R('#234347', x, y, 23, 5);
    R('w', x + 1, y + 2, 21, 1);
    for (const cup of [2, 5, 16, 19]) {
      R('R', x + cup, y - 2, 2, 3);
      R('W', x + cup, y - 2, 2, 1);
    }
    R('W', x + 11, y - 1, 1, 1);
  }

  function drawFratYard(lot, cam) {
    if (!lot.pongTable && !lot.fratYard) return;
    const sx = lot.center - cam;
    if (sx < -80 || sx > W + 80) return;
    const tableX = Math.round(sx) + (lot.style ? 7 : -30);
    drawTailgater(tableX - 6, 91, 'R', 'W', 2);
    if (lot.pongTable) drawPongTable(tableX, 94);
    drawTailgater(tableX + 19, 107, 'U', 'R');
    if (lot.parkedCar !== undefined) {
      drawCar(Math.round(sx) + (lot.style ? -26 : 5), cars[lot.parkedCar], lot.style ? -1 : 1, 102);
    }
    if (lot.wobblyTailgater) {
      const wobble = Math.sin(S.time * 5);
      ctx.save();
      ctx.translate(Math.round(sx + 21 + wobble * 2), 105);
      ctx.rotate(wobble * 0.18);
      drawTailgater(-3, 0, 'G', 'Y', 1);
      ctx.restore();
    }
    if (lot.stumbleDirection) {
      const direction = lot.stumbleDirection;
      const travel = S.dist - Math.max(12, lot.center - 112);
      const walk = Math.max(0, Math.min(1, travel / 37));
      const duration = direction < 0 ? 59 : 45;
      const fallProgress = Math.max(0, Math.min(1, (travel - 37) / duration));
      const fall = fallProgress * fallProgress;
      const wobble = walk > 0 && walk < 1 ? Math.sin(walk * Math.PI * 5) * 0.22 : 0;
      ctx.save();
      const startOffset = lot.stumbleY === LAWN_B ? 26 : 5;
      ctx.translate(Math.round(sx + direction * (startOffset + walk * 12 + fall * 9)), lot.stumbleY + fall);
      ctx.scale(direction, 1);
      ctx.rotate(wobble + fall * Math.PI / 2);
      drawTailgater(-3, 0, 'r', 'W', fall < 0.5 ? 2 : 0);
      ctx.restore();
    }
  }

  function drawLot(lot, cam, isTarget, card = false, viewWidth = W) {
    const sx = lot.center - cam;
    if (lot.schoolLawn || sx < -100 || sx > viewWidth + 100) return;
    if (lot.doubleYard) {
      if (lot.doubleYard === 1) {
        const middle = sx + 23;
        drawHouse({ ...lot, frontage: 1.3 }, middle);
        R('#2a583b', sx - 23, LAWN_Y, 92, LAWN_B - LAWN_Y);
        R('w', sx - 23, LAWN_B - 2, 92, 2);
        drawHedge(sx - 29);
        drawHedge(sx + 69);
        if (S.results[lot.n]?.landedAt == null) {
          const y = 24 + Math.round(Math.sin(S.time * 9) * 4);
          drawText(ctx, 'DOUBLE SANTA', middle, y, Math.floor(S.time * 5) % 2 ? 'Y' : 'W', 1, 'center');
          drawText(ctx, '+' + DOUBLE_YARD_POINTS, middle, y + 7, 'Y', 1, 'center');
        }
      }
      return;
    }
    if (lot.apartmentRoof) {
      R('#575b72', sx - 28, lot.roofBase, 53, LAWN_B - lot.roofBase);
      R('#41485c', sx - 28, lot.roofBase + 3, 4, LAWN_B - lot.roofBase - 3);
      R('W', sx - 30, lot.roofBase - 1, 57, 3);
      for (const y of [48, 64, 80, 98]) {
        for (const [index, column] of [-17, -3, 11].entries()) {
          R('N', sx + column, y, 8, 9);
          R((y + index * 7) % 5 < 3 ? '#f7db92' : '#283752', sx + column + 1, y + 1, 6, 7);
        }
      }
      R('w', sx - 27, LAWN_B - 2, 53, 2);
      drawPorchLights(sx - 25, lot.roofBase + 3, 48, lot.n);
      if (!card) drawLobBonuses(lot, sx);
      return;
    }
    if ((trial || lot.pairedBalcony) && drawTrialStop(lot, sx, card)) return;
    const building = lot.pairedBalcony ? { ...lot, residence: 'apartment' } : lot;
    if (lot.shop || lot.iceCream || lot.sign || lot.blankFront) {
      drawHouse(building, sx);
      if (!card && lot.n > 0 && lot.order) drawLobBonuses(lot, sx);
      return;
    }
    if (!building.residence) drawHouse(building, sx);
    const lx = Math.round(lot.lawnStart - cam);
    R(lot.hedgeScreen ? '#163b32' : '#2a583b', lx, LAWN_Y, lot.w, LAWN_B - LAWN_Y);
    if (lot.hedgeScreen) R('#122e2c', lx, 91, lot.w, 13);
    R('w', lx - 3, LAWN_B - 2, lot.w + 7, 2);
    const driftEdge = lot.style ? lx - 7 : lx + lot.w - 5;
    R('w', driftEdge, 108, 13, 3);
    R('W', driftEdge + 2, 107, 7, 2);
    R('W', lx + 2, 88, 8, 3);
    R('W', lx + 4, 86, 5, 2);
    R('w', lx + lot.w - 12, 105, 9, 3);
    R('W', lx + lot.w - 9, 103, 5, 2);
    const walk = Math.round(sx) + (lot.door ? 19 : lot.style ? -12 : 14);
    const step = lot.door ? 0 : lot.style ? -1 : 1;
    for (let y = LAWN_Y; y < LAWN_B; y += 3) {
      const width = 9 + Math.floor((y - LAWN_Y) / 8);
      const x = walk + step * Math.floor((y - LAWN_Y) / 5) - Math.floor(width / 2);
      R('O', x, y, width, 3);
      R('w', x, y, width, 1);
    }
    if (building.residence) drawHouse(building, sx);
    if (lot.overgrown) drawOvergrownYard(lx, lot.w, lot.n + activeBlock * 100);
    if (lot.showpieceTree) drawDeciduousLights(sx + 16, 104, true);
    if (lot.deciduousLights) drawDeciduousLights(sx + 12, 109);
    if (lot.yardResident) {
      const r = S.results[lot.n - 1];
      const fall = r?.residentBonk ? Math.min(1, (S.time - r.landedAt) / 0.28) : 0;
      drawFallingPerson(sx + 5 + fall * 8, YARD_FOOT, fall, 'v');
    }
    if (isTarget) {
      const pulse = Math.floor(S.time * (S.target === 0 ? 6 : 4)) % 2;
      const c = pulse ? 'Y' : 'y';
      for (let i = 0; i < lot.w; i += 2) { R(c, lx + i, LAWN_Y, 1, 1); R(c, lx + i + 1, LAWN_B - 1, 1, 1); }
      for (let j = 0; j < LAWN_B - LAWN_Y; j += 2) { R(c, lx, LAWN_Y + j, 1, 1); R(c, lx + lot.w - 1, LAWN_Y + j + 1, 1, 1); }
      // perfect spot
      const cx = Math.round(sx); R('Y', cx - 1, FOOT, 3, 1); R('Y', cx, FOOT - 1, 1, 3);
    }
    if (lot.feature === 'tree') {
      R('b', sx + 27, 63, 3, 36);
      R('b', sx + 18, 72, 10, 2);
      R('b', sx + 29, 68, 8, 2);
      R('b', sx + 18, 65, 2, 8);
      R('b', sx + 36, 60, 2, 10);
    } else if (lot.feature === 'snowman' && !lot.hedgeScreen && activeBlock !== 3) {
      const x = lot.snowmanTarget ? sx - 4 : sx - 16;
      const y = lot.snowmanTarget ? YARD_FOOT : 97;
      const r = S.results[lot.n - 1];
      if (r?.squash && r.landedAt != null) {
        R('w', x - 5, y - 2, 20, 3);
        R('W', x - 2, y - 3, 15, 2);
        R('K', x + 13, y - 3, 4, 2);
        R('r', x - 6, y - 1, 4, 1);
      } else {
        R('W', x, y - 11, 9, 11);
        R('W', x + 1, y - 16, 7, 6);
        R('K', x + 1, y - 17, 7, 2);
        R('R', x + 1, y - 11, 6, 1);
      }
    }
    if (!lot.feature && !lot.roof && !lot.shop && !building.residence) {
      const side = lot.style ? 1 : -1;
      drawChristmasTree(Math.round(sx) + side * 33, LAWN_Y + (lot.style ? 18 : 9), lot.n || 0);
    }
    if (!building.residence) drawHedge(lot.style ? lx + lot.w : lx - HEDGE);
    if (card && lot.hedgeScreen) drawHedgeScreen(lot, cam);
    if (!card && lot.n > 0 && lot.order) drawLobBonuses(lot, sx);
    if (!card && prototype && lot.n === 2 && sx + 49 < W + 20) {
      R('b', sx + 48, 69, 3, 34);
      R('b', sx + 39, 72, 12, 2);
      R('b', sx + 40, 64, 2, 10);
      R('b', sx + 49, 76, 9, 2);
      R('b', sx + 57, 69, 2, 9);
      R('w', sx + 37, 103, 24, 3);
      R('W', sx + 42, 101, 15, 2);
    }
  }

  function drawSantaTethers(center, base, scale = 1) {
    for (const side of [-1, 1]) {
      for (let i = 0; i < 8; i++) R('w', center + side * (6 + i) * scale, base + (i - 9) * scale, 1, 1);
      R('K', center + side * 14 * scale - 1, base - 2 * scale, Math.max(2, Math.round(3 * scale)), 2);
    }
  }

  function drawInflatable(r, cam) {
    const lot = r.lot || LOTS[r.n - 1];
    const age = S.time - r.landedAt;
    const q = Math.min(1, age / 0.45);
    const k = q < 1 ? 0.25 + 0.9 * (1 - Math.pow(1 - q, 3)) : 1;
    const landed = r.landing === 'perfect' || r.landing === 'hit';
    const spr = SPR[r.inflatable] || SPR.santa;
    const surface = r.surface || { type: 'yard', base: FOOT };
    if (landed && surface.type === 'window') {
      const x = Math.round(surface.center - cam);
      const h = Math.max(2, Math.round(16 * Math.min(1, k)));
      R('Y', x - 5, 45, 11, 8);
      ctx.drawImage(spr, 0, 0, spr.width, 17, x - 8, 52 - h, 16, h);
      R('W', x - 6, 52, 13, 2);
      return;
    }
    if (landed && surface.type === 'display') {
      const x = Math.round(lot.center - cam - 9);
      const height = Math.max(2, Math.round(16 * Math.min(1, k)));
      ctx.drawImage(spr, x - 8, 82 + STOREFRONT_DROP - height, 16, height);
      R('w', x - 17, 64 + STOREFRONT_DROP, 34, 2);
      R('w', x - 17, 82 + STOREFRONT_DROP, 34, 3);
      return;
    }
    if (landed && r.poppedAt !== undefined) {
      const x = Math.round(r.lx - cam);
      R('r', x - 8, surface.base - 2, 16, 3);
      R('R', x - 6, surface.base - 3, 8, 2);
      R('W', x + 2, surface.base - 2, 4, 1);
      return;
    }
    if (landed && r.tippedAt !== undefined) {
      const fall = Math.min(1, (S.time - r.tippedAt) / 0.26);
      ctx.save();
      ctx.translate(Math.round(r.lx - cam), surface.base);
      ctx.rotate(-Math.PI / 2 * fall);
      ctx.drawImage(spr, -Math.floor(spr.width / 2), -spr.height);
      ctx.restore();
      return;
    }
    if (landed) {
      const scale = lot.giantSanta && surface.type === 'yard' ? 4 : 1;
      const width = spr.width * scale;
      const h = Math.max(2, Math.round(spr.height * scale * Math.min(1.08, k)));
      const x = Math.round((surface.center ?? r.lx) - cam - width / 2);
      if (surface.type === 'yard' && q === 1 && !lot.hedgeScreen) {
        drawSantaTethers(x + width / 2, surface.base);
      }
      if (lot.sidewaysRoof && surface.type === 'roof') {
        const length = Math.max(2, Math.round(SPR.santaSide.width * Math.min(1, k)));
        ctx.drawImage(SPR.santaSide, Math.round(surface.center - cam - length / 2), surface.base - SPR.santaSide.height + 1, length, SPR.santaSide.height);
      } else {
        ctx.drawImage(spr, x, surface.base - h + 1, width, h);
      }
      if (surface.type === 'balcony') {
        drawBalcony(Math.round(surface.center - cam), surface.base);
      }
    } else if (r.kind === 'hedge') {
      if (trial) {
        const fall = Math.min(1, age / 0.38);
        const x = Math.round(r.lx - cam);
        ctx.save();
        ctx.translate(x, FOOT - 2);
        ctx.rotate(r.side * Math.PI / 2 * Math.pow(fall, 1.5));
        const height = Math.max(2, Math.round(spr.height * Math.min(1, k)));
        ctx.drawImage(spr, -Math.floor(spr.width / 2), -height, spr.width, height);
        ctx.restore();
        return;
      }
      // Inflates sideways, lying in the hedge it hit.
      const sideSprite = SPR.santaSide;
      const len = Math.max(2, Math.round(sideSprite.width * k));
      const hx = r.side > 0 ? lot.lawnEnd + HEDGE / 2 : lot.lawnStart - HEDGE / 2;
      const x = Math.round(hx - cam - (r.side > 0 ? len * 0.3 : len * 0.7));
      ctx.save();
      if (r.side < 0) { ctx.translate(Math.round(x) * 2 + len, 0); ctx.scale(-1, 1); }
      ctx.drawImage(sideSprite, x, 104 - sideSprite.height + 4, len, sideSprite.height);
      ctx.restore();
    }
  }

  function drawLitter(cam) {
    for (const pile of S.litter) {
      const x = pile.x - cam;
      if (x < -12 || x > W + 12) continue;
      const hop = Math.max(0, 1 - (S.time - pile.time) / 0.16);
      const y = pile.y - Math.round(hop * 4);
      R('K', x - 6, y + 1, 13, 2);
      R('r', x - 5, y - 2, 11, 3);
      R('R', x - 4, y - 3, 7, 3);
      R('W', x - 2, y - 2, 3, 1);
      R('k', x + 4, y, 3, 2);
    }
  }

  const finishLineX = () => LOTS.at(-1).lawnEnd + 54;

  function drawFinishLine(cam) {
    if (!prototype) return;
    const x = Math.round(finishLineX() - cam);
    if (x < -30 || x > W + 30) return;
    for (let row = 0; row < 5; row++) {
      for (let column = 0; column < 2; column++) {
        R((row + column) % 2 ? 'K' : 'W', x + column * 5, 123 + row * 5, 5, 5);
      }
    }
    R('r', x - 19, 86, 40, 14);
    R('Y', x - 19, 86, 40, 1);
    R('w', x - 16, 100, 2, 17);
    R('w', x + 15, 100, 2, 17);
    drawText(ctx, 'FINISH', x + 1, 91, 'W', 1, 'center');
  }

  function drawStreet(cam) {
    R('#183c33', 0, LAWN_Y, W, LAWN_B - LAWN_Y);            // snowy ground between lots
    R('O', 0, LAWN_B, W, 4); R('v', 0, LAWN_B + 1, W, 1);
    R('K', 0, 120, W, 1);
    R('A', 0, 121, W, H - 121);
    for (let i = -1; i < 14; i++) { const sx = Math.floor(cam / 20) * 20 + i * 20 - cam; R('a', sx, 135, 10, 1); }
    R('W', 0, 121, W, 1);
    for (const c of prototype ? [] : ROUTE.crossings) {
      const a = c.x0 - cam, b = c.x1 - cam;
      if (b < -10 || a > W + 10) continue;
      R('A', a, 94, b - a, 27); R('w', a - 1, 94, 1, 26); R('w', b, 94, 1, 26);
      for (let y = 123; y < 147; y += 4) R('W', a + 2, y, b - a - 4, 2);
      R('k', b + 3, 80, 1, 36); R('G', b, 78, 8, 3);  // street sign post
    }
    for (const s of prototype ? [] : ROUTE.busStops) {
      const x = s - cam; if (x < -10 || x > W + 10) continue;
      R('k', x, 92, 1, 24); R('U', x - 3, 88, 7, 5); R('W', x - 2, 89, 5, 1);
    }
  }

  function drawTurkey(x, y, step) {
    R('b', x, y - 11, 8, 9);
    R('r', x + 1, y - 10, 2, 5);
    R('y', x + 4, y - 9, 2, 5);
    R('#473134', x + 4, y - 6, 8, 5);
    R('R', x + 10, y - 9, 2, 4);
    R('Y', x + 12, y - 8, 2, 1);
    R('y', x + 5 + step, y - 1, 1, 3);
    R('y', x + 8 - step, y - 1, 1, 3);
  }

  function hitRisingTurkey(p) {
    if (p.turkeyHit) return;
    const u = Math.min(1, p.t / p.dur);
    if (p.endY - p.oy - 4 * p.arc * (1 - 2 * u) >= 0) return;
    const y = projectileHeight(p, u);
    if (y < 99 || y > 116) return;
    const x = p.ox + (p.lx - p.ox) * u;
    eachStreetHazard(S.dist, (left, kind, direction, _variant, _pace, hazard, member) => {
      if (p.turkeyHit || kind !== 'turkey' || x < left - 3 || x > left + 15) return;
      p.turkeyHit = true;
      S.bonkedTurkeys.push({ hazard, member, x: left + 6, direction, time: S.time });
      pop(x, y - 18, 'SQUAWK!', 'Y', 1);
      SFX.turkeyBonk();
    });
  }

  function drawBonkedTurkeys(cam) {
    for (const bird of S.bonkedTurkeys) {
      const elapsed = S.time - bird.time;
      const progress = Math.min(1, elapsed / 0.45);
      const hop = Math.sin(progress * Math.PI) * 9;
      const x = bird.x + bird.direction * (progress * 12 + Math.max(0, elapsed - 0.45) * 27) - cam;
      if (x < -16 || x > W + 16) continue;
      ctx.save();
      ctx.translate(Math.round(x), Math.round(113 - hop));
      ctx.scale(bird.direction, 1);
      ctx.rotate((1 - progress) * progress * 5);
      drawTurkey(-5, 0, Math.floor(elapsed * 12) % 2);
      ctx.restore();
    }
  }

  function hitRisingAnimal(p) {
    if (p.animalHit) return;
    const u = Math.min(1, p.t / p.dur);
    if (p.endY - p.oy - 4 * p.arc * (1 - 2 * u) >= 0) return;
    const y = projectileHeight(p, u);
    if (y < 96 || y > 116) return;
    const x = p.ox + (p.lx - p.ox) * u;
    eachStreetHazard(S.dist, (left, kind, direction, variant, _pace, hazard) => {
      if (p.animalHit || !hazard?.tumbling || S.fallenAnimals.has(hazard)) return;
      const dogX = direction === 1 ? left + 19 : left + 8;
      const bodyX = kind === 'dog' ? dogX : left + 6;
      if (Math.abs(x - bodyX) > 8 || (kind === 'dog' && y < 103)) return;
      p.animalHit = true;
      S.fallenAnimals.set(hazard, { x: bodyX, kind, direction, variant, time: S.time });
      pop(x, y - 16, 'BONK!', 'Y', 1);
      SFX.hedge();
    });
  }

  function drawFallenAnimals(cam) {
    for (const animal of S.fallenAnimals.values()) {
      const fall = Math.min(1, (S.time - animal.time) / 0.35);
      ctx.save();
      ctx.translate(Math.round(animal.x - cam + animal.direction * fall * 5), 113);
      ctx.scale(animal.direction, 1);
      ctx.rotate(fall * Math.PI / 2);
      if (animal.kind === 'dog') drawLeashedDog(-12, 0, 0, animal.variant, false);
      else drawCrane(-5, 0, 0);
      ctx.restore();
    }
  }

  function drawSprintingTurkey(cam) {
    const chase = S.turkeyChase;
    if (!chase) return;
    const elapsed = S.time - chase.result.landedAt;
    const approach = Math.min(1, elapsed / TURKEY_SPRINT_TIME);
    const retreat = Math.max(0, elapsed - TURKEY_SPRINT_TIME - 0.18);
    const x = chase.start + (chase.target - chase.start) * approach - retreat * 62 - cam;
    const y = 113 - 10 * approach + Math.min(9, retreat * 14);
    if (x < -16 || x > W + 16) return;
    ctx.save();
    ctx.translate(Math.round(x), Math.round(y));
    if (retreat > 0) ctx.scale(-1, 1);
    drawTurkey(0, 0, Math.floor(elapsed * 15) % 2);
    ctx.restore();
  }

  function drawYardTurkeys(cam) {
    if (activeBlock !== 2 || trial) return;
    for (const stop of YARD_TURKEY_STOPS) {
      const lot = LOTS[stop - 1];
      if (!lot || lot.shop || lot.iceCream || lot.residence) continue;
      const r = S.results[stop - 1];
      const hasSanta = r?.landedAt != null && r.surface?.type === 'yard' && r.points > 0;
      const age = hasSanta ? S.time - r.landedAt : 0;
      const wait = 0.15;
      const approach = Math.max(0, Math.min(1, (age - wait) / (TURKEY_TIP_DELAY - wait)));
      const retreat = Math.max(0, age - 0.95);
      const perch = lot.center + 22;
      const target = (hasSanta ? r.lx : lot.center) + 5;
      const x = perch + (target - perch) * approach - 48 * retreat - cam;
      const y = YARD_FOOT + 7 * (1 - approach) + Math.min(8, 9 * retreat);
      if (x < -14 || x > W + 14) continue;
      ctx.save();
      ctx.translate(Math.round(x), 0);
      ctx.scale(-1, 1);
      const walking = (age > wait && age < TURKEY_TIP_DELAY) || retreat > 0;
      drawTurkey(0, Math.round(y), walking ? Math.floor(age * (retreat ? 13 : 5)) % 2 : 0);
      ctx.restore();
    }
  }

  function drawLeashedDog(x, y, step, variant, leashed = true) {
    const [coat, length, height] = [['b', 10, 3], ['W', 6, 5], ['k', 9, 7]][variant];
    const body = x + 6;
    const shoulder = y - height - 1;
    const head = body + length - 2;
    if (leashed) {
      R('O', x, y - 7, 4, 1);
      R('O', x + 3, shoulder - 1, 5, 1);
    }
    R(coat, body, shoulder, length, height);
    R(coat, head, shoulder - 3, 5, 5);
    R(variant === 0 ? 'r' : coat, head, shoulder - (variant === 2 ? 5 : 3), 2, 3);
    R('K', head + 4, shoulder - 1, 1, 1);
    R('R', head, shoulder + 1, 2, 1);
    R(coat, body + step, y - 2, 2, 3);
    R(coat, head - step, y - 2, 2, 3);
    R(coat, body - 2, shoulder - step, 3, 2);
  }

  function drawCrane(x, y, step) {
    R('v', x, y - 10, 10, 6);
    R('w', x + 8, y - 18, 2, 11);
    R('v', x + 8, y - 19, 5, 3);
    R('R', x + 8, y - 20, 3, 1);
    R('y', x + 12, y - 18, 4, 1);
    R('k', x + 3 + step, y - 5, 1, 8);
    R('k', x + 6 - step, y - 5, 1, 8);
  }

  function drawYardCrane(cam) {
    if (activeBlock !== 5) return;
    const lot = LOTS[YARD_CRANE_STOP - 1];
    if (!lot) return;
    const r = S.results[lot.n - 1];
    const age = r?.landedAt != null && r.surface?.type === 'yard' ? S.time - r.landedAt : 0;
    const approach = Math.min(1, Math.max(0, (age - 0.12) / (CRANE_POP_DELAY - 0.12)));
    const perch = lot.center + 23;
    const target = (r?.lx ?? lot.center) + 11;
    const x = perch + (target - perch) * approach - cam;
    if (x < -14 || x > W + 14) return;
    ctx.save();
    ctx.translate(Math.round(x), 0);
    ctx.scale(-1, 1);
    drawCrane(0, YARD_FOOT + 4, approach > 0 && approach < 1 ? Math.floor(age * 7) % 2 : 0);
    ctx.restore();
  }

  function drawStreetHazards(cam) {
    eachStreetHazard(S.dist, (left, kind, direction, variant, pace, hazard) => {
      const worldX = Math.round(left - cam);
      const x = 0, y = 113;
      ctx.save();
      ctx.translate(worldX + (direction === -1 ? HAZARD_WIDTH[kind] : 0), 0);
      if (direction === -1) ctx.scale(-1, 1);
      const step = Math.floor(S.time * (1.6 + pace * 4)) % 2;
      if (kind === 'turkey') {
        drawTurkey(x, y, step);
      } else if (kind === 'cat') {
        R('#bf6b3a', x + 2, y - 5, 8, 5);
        R('#e99650', x + 7, y - 7, 5, 5);
        R('#e99650', x + 7, y - 8, 1, 2);
        R('#e99650', x + 10, y - 8, 1, 2);
        R('K', x + 10, y - 6, 1, 1);
        R('#e99650', x, y - 7 - step, 1, 5);
        R('#e99650', x + 1, y - 4, 2, 1);
        R('#a95035', x + 4, y - 5, 1, 4);
        R('#bf6b3a', x + 3 + step, y, 1, 2);
        R('#bf6b3a', x + 8 - step, y, 1, 2);
      } else if (kind === 'crane') {
        if (!S.fallenAnimals.has(hazard)) drawCrane(x, y, step);
      } else {
        ctx.drawImage(SPR.kid, x, y - 13, 8, 13);
        R('S', x + 7, y - 7, 2, 2);
        R('K', x + 2 + step, y - 2, 2, 4);
        R('K', x + 5 - step, y - 2, 2, 4);
        if (kind === 'kids') {
          R('U', x + 10, y - 11, 6, 9);
          R('Y', x + 11, y - 13, 4, 3);
          R('K', x + 11 - step, y - 2, 2, 4);
          R('K', x + 14 + step, y - 2, 2, 4);
        } else if (kind === 'dog') {
          if (!S.fallenAnimals.has(hazard)) drawLeashedDog(x + 7, y, step, variant);
        } else if (kind === 'family') {
          ctx.drawImage(SPR.kid, x + 19, y - 14, 8, 14);
          R('R', x + 19, y - 8, 5, 4);
          R('K', x + 20 + step, y - 2, 2, 4);
          R('K', x + 24 - step, y - 2, 2, 4);
          R('Y', x + 11, y - 10, 4, 3);
          R('S', x + 12, y - 7, 4, 2);
          R('U', x + 11, y - 5, 5, 4);
          R('K', x + 11 + step, y - 1, 2, 3);
          R('K', x + 14 - step, y - 1, 2, 3);
        }
      }
      ctx.restore();
    });
  }

  function drawCar(x, car, direction, y = carLaneY(direction)) {
    R('K', x, y, car.length, 11);
    R(car.color, x + 1, y, car.length - 2, 8);
    const roofHeight = car.tall ? 10 : 5;
    R(car.color, x + 5, y - roofHeight, car.length - 11, roofHeight + 1);
    R('N', x + 7, y - roofHeight + 1, car.length - 15, roofHeight - 1);
    R('W', x + (direction === 1 ? car.length - 3 : 1), y + 2, 2, 2);
    R('R', x + (direction === 1 ? 1 : car.length - 3), y + 3, 2, 2);
    R('K', x + 4, y + 7, 4, 4);
    R('K', x + car.length - 8, y + 7, 4, 4);
  }

  function drawMotorcycleGang(cam) {
    if (activeBlock !== 4 || trial) return;
    const anchor = LOTS[12]?.center;
    if (anchor === undefined) return;
    const distance = S.dist - anchor;
    if (Math.abs(distance) > 130) return;
    const x = anchor + distance * 3.6 - cam;
    for (const [index, offset] of [0, 14, 27, 42].entries()) {
      const wheelX = x + offset;
      const y = index % 2 ? 137 : 129;
      R('K', wheelX, y, 4, 4);
      R('K', wheelX + 8, y, 4, 4);
      R(index % 2 ? 'r' : 'U', wheelX + 1, y - 2, 10, 3);
      R('K', wheelX + 4, y - 7, 4, 6);
      R('w', wheelX + 5, y - 8, 4, 3);
      R('Y', wheelX + 10, y - 3, 2, 2);
    }
  }

  function drawCraneCrossing(cam) {
    if (activeBlock !== 4 || S.craneCrossingAt === null) return;
    const elapsed = S.time - S.craneCrossingAt;
    if (elapsed > CRANE_CROSSING_TIME) return;
    for (const [index, delay] of [0, 0.42].entries()) {
      const progress = Math.max(0, (elapsed - delay) / (CRANE_CROSSING_TIME - delay));
      const x = CRANE_CROSSING_X - 20 + index * 14 + progress * 48 - cam;
      const y = 109 + progress * 60;
      drawCrane(Math.round(x), Math.round(y), Math.floor(elapsed * 4 + index) % 2);
    }
  }

  function drawBusStopSigns(cam) {
    const positions = activeBlock === 3 ? [268] : [];
    for (const position of positions) {
      const x = position - cam;
      if (x < -10 || x > W + 10) continue;
      R('k', x, 92, 2, 25);
      R('U', x - 5, 90, 12, 9);
      R('W', x - 3, 92, 8, 4);
      R('K', x - 1, 96, 1, 1);
      R('K', x + 3, 96, 1, 1);
    }
  }

  function drawStreetTraffic(cam) {
    if (schoolRoute) {
      for (const [index, offset] of [-106, -71, -36, -1, 34, 69, 104].entries()) {
        const car = cars[index % cars.length];
        drawCar(school.center + offset - cam, { ...car, length: car.length + 9, tall: true }, -1);
      }
    }
    eachTrafficCar(S.dist, (left, car, direction) => drawCar(left - cam, car, direction));
  }

  function drawMovingRoofBonus(center, roofY, vehicle) {
    const result = S.busBonuses[vehicle.index];
    const bounce = result?.landedAt == null ? Math.round(Math.abs(Math.sin(S.time * 4)) * 3) : 0;
    drawBonusBox(center, roofY - 14 - bounce, vehicle.bonus, result);
    if (result?.landedAt != null) {
      const height = Math.max(2, Math.round(19 * Math.min(1, (S.time - result.landedAt) / 0.35)));
      ctx.drawImage(SPR.santa, center - 7, roofY - height, 14, height);
      if (height === 19) {
        R('K', center - 2, roofY - height + 4, 1, 1);
        R('K', center + 2, roofY - height + 4, 1, 1);
      }
    }
  }

  function drawServiceVehicles(cam) {
    eachServiceVehicle(S.dist, (left, vehicle) => {
      const { direction, length, kind } = vehicle;
      const x = Math.round(left - cam);
      const y = direction === 1 ? 129 : 126;
      const front = direction === 1 ? x + length - 11 : x + 1;
      R('K', x, y, length, 11);
      if (kind === 'truck') {
        const crane = direction === 1 ? x + 5 : x + 22;
        R('y', x + 1, y - 3, length - 2, 10);
        R('Y', front, y - 9, 10, 15);
        R('N', front + 2, y - 7, 5, 5);
        R('K', crane, y - 24, 6, 22);
        R('Y', crane + 1, y - 25, 4, 22);
        R('Y', crane, y - 25, 13, 3);
        R('k', crane + 11, y - 22, 1, 9);
      } else {
        R('W', x + 1, y - 9, length - 2, 17);
        R('G', x + 1, y + 2, length - 2, 2);
        R('N', front + 2, y - 6, 7, 5);
      }
      R('Y', x + (direction === 1 ? length - 3 : 1), y + 3, 2, 2);
      R('R', x + (direction === 1 ? 1 : length - 3), y + 3, 2, 2);
      R('K', x + 5, y + 7, 5, 5);
      R('K', x + length - 10, y + 7, 5, 5);
    });
  }

  function drawVehicle(anchor = VX) {
    const ax = anchor + (S.vehicle === 'bus' ? BUS_DRAW_OFFSET : 0), toss = S.kidToss > 0 ? 1 : 0;
    const bob = Math.floor(S.time * 6) % 2;
    if (S.vehicle === 'bus') {
      // Articulated city bus: rear section, accordion joint, front section.
      const y = 117;
      const body = (x, w) => { R('K', x - 1, y - 1, w + 2, 27); R('W', x, y, w, 25); R('U', x, y + 15, w, 4); R('u', x, y + 22, w, 3); };
      body(ax - 78, 44); R('k', ax - 34, y + 2, 6, 21); for (let i = 0; i < 6; i += 2) R('a', ax - 33 + i, y + 2, 1, 21);
      body(ax - 28, 50);
      for (let i = 0; i < 4; i++) R('n', ax - 75 + i * 10, y + 4, 8, 8);
      for (let i = 0; i < 4; i++) if (i !== 2) R('n', ax - 25 + i * 10, y + 4, 8, 8);
      R('n', ax + 14, y + 2, 7, 12); R('Y', ax + 17, y + 18, 3, 2);   // windshield and headlight
      R('k', ax - 68, y + 2, 3, 1); R('Y', ax + 12, y + 1, 8, 2);      // destination sign (blank)
      ctx.drawImage(SPR.elf, ax - 8, y - 2 - toss * 3);                 // elf at the open window
      R('n', ax - 5, y + 8, 8, 4);
      for (const wx of [ax - 70, ax - 44, ax - 20, ax + 10]) { R('K', wx, y + 22, 7, 6); R('a', wx + 2, y + 24, 3, 2); }
    } else {
      const y = 137 + bob;
      R('#222841', ax - 26, 148, 36, 2);
      // sack of folded Santas
      for (const [row, half] of [3, 5, 7, 8, 9, 9, 9, 9, 8, 8, 6, 4].entries()) {
        R('r', ax - 17 - half, y - 12 + row, half * 2 + 1, 1);
        if (row > 0 && row < 10) R('R', ax - 16 - half, y - 12 + row, half * 2 - 2, 1);
      }
      R('W', ax - 22, y - 8, 3, 2);
      R('Y', ax - 18, y - 13, 5, 1);
      R('r', ax - 17, y - 15, 3, 2);
      // sleigh body
      R('K', ax - 27, y - 1, 36, 10); R('R', ax - 26, y, 34, 8); R('r', ax - 26, y + 6, 34, 2);
      R('Y', ax - 26, y, 34, 1); R('Y', ax + 6, y - 6, 2, 7); R('R', ax + 8, y - 5, 2, 5); R('Y', ax + 8, y - 6, 3, 1);
      // elf driver
      ctx.drawImage(SPR.elf, ax - 6, y - 14 - toss * 2);
      // runners
      R('y', ax - 25, y + 10, 34, 1); R('y', ax + 9, y + 8, 1, 2); R('y', ax + 10, y + 6, 1, 2);
      R('k', ax - 20, y + 8, 1, 2); R('k', ax + 2, y + 8, 1, 2);
    }
    if (S.poof > 0) {
      const p = S.poof / 0.5;
      for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2; R('W', ax - 14 + Math.cos(a) * (1 - p) * 26 + 10, 128 + Math.sin(a) * (1 - p) * 14, 3, 3); }
    }
  }

  function drawMarker(cam) {
    if (S.target >= TOTAL) return;
    const mx = VX + D;
    const lot = LOTS[S.target];
    const wx = S.dist + D;
    const over = wx >= lot.lawnStart && wx <= lot.lawnEnd;
    const isArmed = armed();
    const col = S.nudge > 0 ? 'v' : over ? 'Y' : isArmed ? 'W' : 'v';
    R('K', mx - 5, FOOT - 4, 11, 3);
    R('K', mx - 1, FOOT - 8, 3, 11);
    R(col, mx - 4, FOOT - 3, 9, 1);
    R(col, mx, FOOT - 7, 1, 9);
  }

  function projectileHeight(p, u) {
    return p.oy + ((p.endY ?? FOOT - 4) - p.oy) * u - p.arc * 4 * u * (1 - u);
  }

  function drawProjectiles(cam) {
    for (const p of S.proj) {
      const u = Math.min(1, p.t / p.dur);
      const x = p.ox + (p.lx - p.ox) * u - cam;
      const y = projectileHeight(p, u);
      const spr = Math.floor(p.t * 12) % 2 ? SPR.bundleA : SPR.bundleB;
      ctx.drawImage(spr, Math.round(x - 3), Math.round(y - 3));
    }
  }

  function drawFx(cam) {
    for (const r of S.rings) { const rad = 3 + r.t * 40; const x = r.lx - cam; ctx.strokeStyle = PAL.Y; ctx.lineWidth = 1; ctx.strokeRect(Math.round(x - rad), Math.round(FOOT - 10 - rad / 2), Math.round(rad * 2), Math.round(rad)); }
    for (const p of S.parts) R(p.c, p.x - cam, p.y, 1, 1);
    for (const p of S.pops) {
      if (p.t < 0) continue;
      const y = p.y - p.t * 10;
      if (p.t > 1.0 && Math.floor(p.t * 12) % 2) continue;
      drawText(ctx, p.text, p.x - cam, y, p.col, p.sc, 'center');
    }
  }

  function drawHud() {
    R('N', 0, 0, W, 10); R('K', 0, 10, W, 1);
    drawText(ctx, 'SCORE ' + S.score, 3, 3, 'W', 1);
    if (S.streak >= 2) drawText(ctx, 'x' + S.streak, 3 + textWidth('SCORE ' + S.score) + 5, 3, 'Y', 1);
    if (prototype) {
      if (fullRun || practiceBlock) drawText(ctx, 'BLOCK ' + activeBlock, W / 2, 3, 'w', 1, 'center');
      drawText(ctx, 'DELIVERED ' + S.delivered + '/' + (fullRun ? FULL_ORDERS : orders), W - 4, 3, 'W', 1, 'right');
      return;
    }
    drawText(ctx, 'BLOCK ' + (Math.min(S.blockShown, 4) + 1), W / 2 + 8, 3, 'w', 1, 'center');
    const c = Math.min(S.target, TOTAL) + '/' + TOTAL;
    drawText(ctx, c, W - 3, 3, 'W', 1, 'right');
    ctx.drawImage(SPR.icon, W - 3 - textWidth(c) - 7, 3);
    if (S.banner) {
      const t = S.banner.t;
      if (t > 0.3 || Math.floor(t * 12) % 2) drawText(ctx, S.banner.text, W / 2, 26, 'W', 2, 'center');
    }
  }

  function drawMoonSleigh() {
    const moonX = 150, moonY = 27;
    for (let row = -16; row <= 16; row++) {
      const half = Math.floor(Math.sqrt(16 * 16 - row * row));
      R('#f7e8bc', moonX - half, moonY + row, half * 2 + 1, 1);
    }
    R('#ebd7a2', moonX - 10, moonY - 6, 5, 2);
    R('#ebd7a2', moonX + 6, moonY + 4, 5, 3);
    const x = moonX - 28 + Math.floor(titleSnowTime * 2) % 15;
    const y = moonY + 2 + Math.floor(titleSnowTime * 4) % 2;
    R('R', x - 4, y - 7, 5, 4);
    R('W', x + 2, y - 10, 3, 2);
    R('R', x + 1, y - 12, 4, 2);
    R('W', x + 4, y - 9, 2, 3);
    R('R', x + 1, y - 7, 5, 4);
    R('r', x - 5, y - 4, 17, 5);
    R('R', x - 5, y - 5, 18, 2);
    R('Y', x - 4, y + 2, 18, 1);
    R('Y', x + 12, y, 2, 2);
    R('K', x + 12, y - 4, 28, 1);
    for (const deer of [x + 18, x + 34]) {
      R('b', deer, y - 5, 9, 4);
      R('b', deer + 6, y - 8, 5, 4);
      R('K', deer + 8, y - 10, 1, 3);
      R('K', deer + 10, y - 10, 1, 2);
      R('b', deer + 1, y - 2, 1, 3);
      R('b', deer + 6, y - 2, 1, 2);
      R('Y', deer + 5, y - 5, 1, 2);
    }
    R('R', x + 45, y - 7, 1, 1);
  }

  function drawTitleStreet() {
    const screen = ctx;
    ctx = titleContext;
    ctx.imageSmoothingEnabled = false;
    drawSky(0);
    drawStreet(0);
    ctx.save();
    ctx.translate(W, 0);
    drawSky(56);
    drawStreet(56);
    ctx.restore();
    const titleHouses = [
      { ...STOPS[1], n: 1, center: 37, w: 56, lawnStart: 9 },
      { ...STOPS[0], n: 2, center: 107, w: 64, lawnStart: 75 },
      { ...STOPS[2], n: 3, center: 181, w: 62, lawnStart: 150 },
      { ...STOPS[3], n: 4, center: 254, w: 57, lawnStart: 225 },
      { ...STOPS[0], n: 5, center: 326, w: 60, lawnStart: 296, style: 1, color: HOUSES[5], frontage: 1, height: 1.12 },
    ];
    for (const lot of titleHouses) drawLot(lot, 0, false, true, titleArt.width);
    drawVehicle(42);
    ctx = screen;
    R('#101b49', 0, 0, W, H);
    drawMoonSleigh();
    const scale = W / titleArt.width;
    const streetTop = 47;
    ctx.drawImage(titleArt, 0, streetTop, W, Math.round(H * scale));
    const santaWidth = 12, santaHeight = 16;
    const ground = streetTop + Math.round((YARD_FOOT + 1) * scale);
    for (const lot of titleHouses) {
      const position = lot.center + (lot.style ? 10 : -11);
      const left = Math.round(position * scale) - santaWidth / 2;
      const top = ground - santaHeight;
      drawSantaTethers(left + santaWidth / 2, ground, 0.72);
      ctx.drawImage(SPR.santa, left, top, santaWidth, santaHeight);
      R('S', left + 4, top + 3, 5, 2);
      R('K', left + 4, top + 4, 1, 1);
      R('K', left + 7, top + 4, 1, 1);
    }
    R('A', 0, 130, W, H - 130);
  }

  function drawSnowSquall() {
    for (const [x, alpha] of [[134, 0.07], [150, 0.06], [167, 0.06], [183, 0.06]]) {
      R('rgba(201, 221, 240, ' + alpha + ')', x, 12, W - x, 129);
    }
    for (let i = 0; i < 155; i++) {
      const speed = 34 + i % 7 * 12;
      const x = ((i * 41.7 - S.time * speed) % W + W) % W;
      const y = (i * 23.9 + S.time * (11 + i % 4 * 5)) % H;
      R(i % 5 ? 'w' : 'W', x, y, 2 + i % 4, 1);
      if (i % 5 === 0) R('v', x + 3, y - 1, 5, 1);
    }
  }

  function render() {
    const titleScene = state === 'title';
    const cam = Math.round(S.dist - VX);
    ctx.imageSmoothingEnabled = false;
    if (titleScene) {
      drawTitleStreet();
      for (const f of flakes) R(f.d ? 'W' : 'w', f.x, f.y, f.s > 1 ? 2 : 1, 1);
      return;
    }
    drawSky(cam);
    drawStreet(cam);
    drawFinishLine(cam);
    if (prototype && leadInStops.length && cam < (activeBlock === 2 ? 482 : marketRoute ? 264 : 235)) drawLeadIn(cam);
    if (marketRoute) drawWingrow(cam);
    if (schoolRoute) drawHedgewood(cam);
    for (const d of prototype ? [] : ROUTE.decor) drawLot(d, cam, false);
    for (const lot of LOTS) drawLot(lot, cam, !prototype && (state === 'playing' || state === 'paused') && lot.n - 1 === S.target);
    if (activeBlock === 2 && !trial) {
      for (const lot of leadInStops) drawFratYard(lot, cam);
      for (const lot of LOTS) drawFratYard(lot, cam);
    }
    drawLitter(cam);
    for (const r of S.results) if (r && r.landedAt !== null && (!trial || r.kind !== 'hedge')) drawInflatable(r, cam);
    for (const r of S.leadInResults) if (r.landedAt !== null) drawInflatable(r, cam);
    for (const lot of LOTS) if (lot.hedgeScreen) drawHedgeScreen(lot, cam);
    if (!prototype && (state === 'playing' || state === 'paused')) drawMarker(cam);
    eachRoofVehicle(S.dist, (left, direction, bus) => {
      const x = Math.round(left - cam);
      const { length, kind } = bus;
      const center = x + Math.floor(length / 2);
      if (kind === 'car' || kind === 'taxi') {
        drawCar(x, bus, direction);
        if (kind === 'taxi') {
          const y = carLaneY(direction);
          R('K', center - 4, y - 7, 8, 2);
          R('W', center - 3, y - 7, 5, 1);
          for (let checker = 3; checker < length - 3; checker += 3) R('K', x + checker, y + 4 + checker % 2, 2, 1);
        } else drawMovingRoofBonus(center, carLaneY(direction) - 5, bus);
        return;
      }
      const articulated = kind === 'brt';
      const front = direction === 1 ? x + length - 8 : x + 2;
      R('K', x, 106, length, 20);
      if (kind === 'plow') {
        R('Y', x + 1, 106, length - 2, 17);
        R('y', x + 1, 118, length - 2, 5);
        R('N', x + length - 13, 108, 10, 7);
        R('r', x + 8, 113, 22, 8);
        drawText(ctx, 'PLOW', x + 19, 114, 'W', 1, 'center', null);
        R('w', x + length, 119, 11, 7);
        R('W', x + length + 1, 119, 9, 2);
        R('Y', x + length - 19, 103, 4, 2);
      } else {
        R('W', x + 1, 106, length - 2, 17);
        R(kind === 'brt' ? 'u' : 'U', x + 1, 117, length - 2, 4);
        for (let offset = 4; offset < length - 7; offset += 9) R('N', x + offset, 109, 6, 6);
      }
      if (articulated) {
        R('k', center - 3, 107, 8, 16);
        for (const rib of [-2, 0, 2, 4]) R('a', center + rib, 107, 1, 16);
      }
      for (const offset of [7, length - 13]) R('K', x + offset, 122, 5, 5);
      if (articulated) R('K', center + 8, 122, 5, 5);
      if (kind !== 'plow') {
        const label = kind === 'brt' ? 'MADISON BRT' : 'MADISON BUS';
        const labelWidth = textWidth(label) + 4;
        R('#111c34', center - Math.ceil(labelWidth / 2), 116, labelWidth, 7);
        drawText(ctx, label, center, 117, '#ffffff', 1, 'center', null);
      }
      R('Y', front, 106, 6, 2);
      R('Y', x + (direction === 1 ? length - 3 : 1), 119, 2, 2);
      R('R', x + (direction === 1 ? 1 : length - 3), 119, 2, 2);
      if (bus.bonus) drawMovingRoofBonus(center, 106, bus);
    });
    drawBusStopSigns(cam);
    drawStreetTraffic(cam);
    drawMotorcycleGang(cam);
    drawServiceVehicles(cam);
    drawCraneCrossing(cam);
    drawStreetHazards(cam);
    drawFallenAnimals(cam);
    drawYardTurkeys(cam);
    drawSprintingTurkey(cam);
    drawBonkedTurkeys(cam);
    drawYardCrane(cam);
    drawVehicle();
    drawProjectiles(cam);
    drawFx(cam);
    for (const f of flakes) {
      const size = 1;
      R(f.d ? 'W' : 'w', f.x, f.y, size, size);
    }
    if (prototype && activeBlock === 5 && state !== 'title') drawSnowSquall();
    if (state !== 'title') drawHud();
  }

  // ---------- Loop ----------
  function frame(ts) {
    let dt = lastFrameTs ? (ts - lastFrameTs) / 1000 : 0;
    lastFrameTs = ts;
    dt = Math.min(dt, 0.05);
    if (!stepping) {
      if (state === 'playing') {
        let left = dt * timeScale;
        while (left > 0 && state === 'playing') { const h = Math.min(left, 1 / 60); update(h); left -= h; }
      }
      if (state === 'title') titleSnowTime += dt;
      if (state !== 'paused') updateFlakes(dt);
    }
    syncDeliverButton();
    render();
    requestAnimationFrame(frame);
  }

  let lastBtnState = '';
  function syncDeliverButton() {
    const st = state !== 'playing' ? 'off' : prototype ? 'neutral' : armed() ? (S.target === 0 ? 'cue' : 'ready') : 'wait';
    if (st === lastBtnState) return;
    lastBtnState = st;
    els.deliver.dataset.state = st;
    els.deliver.disabled = st === 'off';
  }

  // ---------- Flow ----------
  function startGame(openingCue = false) {
    audioInit();
    if (openingCue) playSugarPlumCue();
    if (AU.cue) {
      AU.cue.gain.setTargetAtTime(0, AU.ctx.currentTime + (openingCue ? 2.1 : 0), 0.035);
      AU.cue = null;
    }
    if (fullRun && !countedRun) {
      countedRun = true;
      recordPlay();
    }
    S = freshState();
    if (fullRun) Object.assign(S, runTotals);
    lastBtnState = '';
    state = 'playing';
    $('sg-block-summary').hidden = true;
    els.launch.hidden = true; els.end.hidden = true; els.paused.hidden = true; $('sg-ready').hidden = true;
    els.shareBox.hidden = true;
    els.pause.disabled = false;
    els.pause.textContent = 'Pause';
    els.deliver.disabled = false;
    document.documentElement.classList.add('sg-playing');
    if (AU.ctx && AU.ctx.state === 'suspended') AU.ctx.resume();
    musicStop(); musicStart(openingCue ? 2.2 : 0);
    showLevelIntro();
  }
  function showLevelIntro() {
    if (!prototype || trial) return;
    const name = schoolRoute ? 'School’s Out at Hedgewood' : activeBlock === 5 ? 'Snow Squall'
      : activeBlock === 1 ? 'Get ready!' : '';
    if (!name) return;
    const ready = $('sg-ready');
    ready.classList.toggle('sg-school-ready', schoolRoute || activeBlock === 5);
    ready.classList.toggle('sg-hedgewood-banner', schoolRoute);
    ready.querySelector('.sg-ready-title').textContent = name;
    $('sg-ready-load').textContent = '';
    ready.hidden = false;
    S.introSeconds = schoolRoute ? 2.4 : 1.8;
  }
  function pauseGame() {
    if (state !== 'playing') return;
    cancelThrow();
    state = 'paused';
    els.paused.hidden = false;
    els.pause.textContent = 'Resume';
    if (AU.ctx) AU.ctx.suspend();
    els.resume.focus();
  }
  function resumeGame() {
    if (state !== 'paused') return;
    state = 'playing';
    els.paused.hidden = true;
    els.pause.textContent = 'Pause';
    lastFrameTs = 0;
    if (AU.ctx) AU.ctx.resume();
    els.deliver.focus({ preventScroll: true });
  }
  const blockedInitials = new Set([
    'ASS', 'BCH', 'BJZ', 'CNT', 'COC', 'COX', 'CUM', 'DIK', 'FAG', 'FCK', 'FKN', 'FKU', 'FUC',
    'JIZ', 'KKK', 'KYS', 'NGR', 'NIG', 'PNS', 'PUS', 'SEX', 'SHT', 'SLT', 'TIT', 'WTF',
  ]);
  let localStats = { plays: 0, scores: [] };
  let sharedStats = null;
  let runId = null;
  let recordingPlay = null;
  let savingScore = false;

  async function scoreRequest(path, data) {
    const response = await fetch(scoreApi + path, {
      ...(data ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) } : {}),
      signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(6500) : undefined,
    });
    if (!response.ok) throw new Error('Score service returned ' + response.status);
    return response.json();
  }
  function showSharedStats(stats) {
    sharedStats = stats;
    refreshHomeBoard();
    if (state === 'over') renderScoreboard(els.end.querySelector('.sg-score-list'), 10);
  }
  async function loadSharedStats() {
    try {
      const stats = await scoreRequest('/board?mode=' + scoreMode);
      if (!runId) showSharedStats(stats);
    } catch {
      if (!sharedStats) refreshHomeBoard();
    }
  }
  function readStats() {
    try {
      const saved = JSON.parse(localStorage.getItem(statsKey) || 'null');
      if (saved && Number.isSafeInteger(saved.plays) && saved.plays >= 0 && Array.isArray(saved.scores)) {
        return { plays: saved.plays, scores: saved.scores.filter(entry => entry
          && /^[A-Z]{3}$/.test(entry.initials) && !blockedInitials.has(entry.initials) && Number.isSafeInteger(entry.score) && entry.score >= 0) };
      }
    } catch (_) {}
    return localStats;
  }
  function writeStats(stats) {
    localStats = stats;
    try { localStorage.setItem(statsKey, JSON.stringify(stats)); } catch (_) {}
  }
  function renderScoreboard(list, limit) {
    const scores = scoreApi ? sharedStats?.scores ?? [] : readStats().scores;
    list.replaceChildren();
    list.classList.toggle('sg-no-scores', !scores.length);
    for (const entry of scores.slice(0, limit)) {
      const row = document.createElement('li');
      row.textContent = entry.initials + ' · ' + entry.score.toLocaleString('en-US');
      list.append(row);
    }
    if (!scores.length) {
      const empty = document.createElement('li');
      empty.textContent = scoreApi && !sharedStats ? 'Leaderboard unavailable.' : 'No scores yet.';
      list.append(empty);
    }
  }
  function refreshHomeBoard() {
    const plays = scoreApi ? sharedStats?.plays : readStats().plays;
    $('sg-play-count').textContent = plays === undefined ? '— plays' : plays.toLocaleString('en-US') + (plays === 1 ? ' play' : ' plays');
    renderScoreboard($('sg-home-board').querySelector('.sg-score-list'), 3);
  }
  function recordPlay() {
    if (scoreApi) {
      const id = crypto.randomUUID();
      runId = id;
      recordingPlay = scoreRequest('/runs', { id, mode: scoreMode }).then(stats => {
        if (runId === id) showSharedStats(stats);
        return true;
      }).catch(() => false);
      return;
    }
    const stats = readStats();
    stats.plays++;
    writeStats(stats);
    refreshHomeBoard();
  }
  function unlockReplays() {
    completedRun = true;
    try { localStorage.setItem('santas-game-finished', '1'); } catch (_) {}
    $('sg-replay-blocks').hidden = false;
    $('sg-speed-run').hidden = false;
  }
  $('sg-score-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (!fullRun || state !== 'over' || scoreSaved || savingScore) return;
    const initials = $('sg-initials').value.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(initials)) {
      $('sg-score-feedback').textContent = 'Enter three letters.';
      return;
    }
    if (blockedInitials.has(initials)) {
      $('sg-score-feedback').textContent = 'Choose different initials.';
      $('sg-initials').focus();
      return;
    }
    if (scoreApi) {
      const id = runId;
      const tally = {
        id, mode: scoreMode, initials, score: S.score, delivered: S.delivered,
        perfects: S.perfects, longest: S.longest, litter: blockTallies.reduce((count, block) => count + block.fine / LITTER_FINE, 0),
      };
      savingScore = true;
      $('sg-score-feedback').textContent = 'Saving score…';
      try {
        if (!await recordingPlay) await scoreRequest('/runs', { id, mode: scoreMode });
        const stats = await scoreRequest('/scores', tally);
        if (runId !== id) return;
        showSharedStats(stats);
        $('sg-score-feedback').textContent = 'Score saved to the leaderboard.';
      } catch {
        if (runId === id) $('sg-score-feedback').textContent = 'Could not reach the leaderboard. Try saving again.';
        return;
      } finally {
        savingScore = false;
      }
    } else {
      const stats = readStats();
      stats.scores.push({ initials, score: S.score });
      stats.scores.sort((a, b) => b.score - a.score);
      stats.scores.length = Math.min(stats.scores.length, 10);
      writeStats(stats);
      $('sg-score-feedback').textContent = 'Score saved in this browser.';
    }
    scoreSaved = true;
    $('sg-score-form').hidden = true;
    renderScoreboard(els.end.querySelector('.sg-score-list'), 10);
    refreshHomeBoard();
    unlockReplays();
  });
  $('sg-skip-score').addEventListener('click', () => {
    $('sg-score-form').hidden = true;
    unlockReplays();
  });
  $('sg-next-block').addEventListener('click', () => {
    if (state !== 'between') return;
    runTotals = { score: S.score, perfects: S.perfects, longest: S.longest, delivered: S.delivered };
    activeBlock++;
    configureRoute();
    startGame();
    els.deliver.focus();
  });
  function renderFinalTally() {
    const rows = $('sg-finale-rows');
    rows.replaceChildren();
    for (const [index, tally] of blockTallies.entries()) {
      const row = document.createElement('tr');
      row.style.setProperty('--row', index);
      const heading = document.createElement('th');
      heading.scope = 'row';
      heading.textContent = 'Block ' + (index + 1);
      row.append(heading);
      for (const value of ['+' + tally.earned.toLocaleString('en-US'), tally.fine ? '−' + tally.fine.toLocaleString('en-US') : '0',
        tally.total.toLocaleString('en-US')]) {
        const cell = document.createElement('td');
        cell.textContent = value;
        row.append(cell);
      }
      rows.append(row);
    }
  }

  function gameOver() {
    cancelThrow();
    document.documentElement.classList.remove('sg-playing');
    els.pause.disabled = true;
    els.deliver.disabled = true;
    const earned = S.score - (fullRun ? runTotals.score : 0);
    const count = prototype && !trial ? S.litter.length : 0;
    const fine = count * LITTER_FINE;
    const litterLabel = count ? 'Littering fine (' + count + (count === 1 ? ' dud)' : ' duds)') : 'Littering fine';
    S.score = Math.max(0, S.score - fine);
    if (fullRun) blockTallies.push({ earned, fine, total: S.score });
    if (fullRun && activeBlock < 5) {
      state = 'between';
      $('sg-block-summary-title').textContent = 'Block ' + activeBlock + ' complete';
      $('sg-block-earned').textContent = '+' + earned.toLocaleString('en-US');
      $('sg-block-litter-label').textContent = litterLabel;
      $('sg-block-fine').textContent = fine ? '−' + fine.toLocaleString('en-US') : '0';
      $('sg-block-total').textContent = S.score.toLocaleString('en-US');
      $('sg-block-summary').hidden = false;
      $('sg-next-block').focus();
      return;
    }
    state = 'over';
    const finalLitter = $('sg-final-litter');
    finalLitter.hidden = !count || fullRun;
    finalLitter.textContent = 'Block points +' + earned.toLocaleString('en-US') + ' · ' + litterLabel + ' −' + fine.toLocaleString('en-US');
    if (fullRun) {
      els.end.classList.add('sg-finale');
      $('sg-end-title').textContent = 'Christmas Delivery Complete!';
      $('sg-finale-tally').hidden = false;
      renderFinalTally();
      scoreSaved = false;
      $('sg-score-form').hidden = false;
      $('sg-final-board').hidden = false;
      $('sg-initials').value = '';
      $('sg-score-feedback').textContent = '';
      unlockReplays();
      renderScoreboard(els.end.querySelector('.sg-score-list'), 10);
    }
    if (trial) {
      const key = 'santas-trial-best-' + trial;
      let best = 0;
      try {
        best = Math.max(0, Number(localStorage.getItem(key)) || 0);
        localStorage.setItem(key, String(Math.max(best, S.score)));
      } catch (_) {}
      $('sg-trial-record').textContent = (S.score > best ? 'New personal best · ' : 'Personal best · ')
        + Math.max(best, S.score).toLocaleString('en-US');
    }
    if (practiceBlock) $('sg-replay-blocks').hidden = !completedRun;
    $('sg-exit').hidden = false;
    els.fScore.textContent = S.score.toLocaleString('en-US');
    els.fPerfect.textContent = S.perfects;
    els.fStreak.textContent = S.longest;
    els.fDelivered.textContent = S.delivered + ' of ' + (fullRun ? FULL_ORDERS : orders);
    els.end.hidden = false;
    if (fullRun) {
      els.end.scrollTop = 0;
      $('sg-end-title').focus({ preventScroll: true });
    }
    else els.again.focus();
  }

  function shareText() {
    return 'I scored ' + S.score.toLocaleString('en-US') + ' on Santas on Monroe Street with ' + S.perfects + ' perfect landings. ' + SHARE_URL;
  }
  async function share() {
    const text = shareText();
    const isLive = location.hostname === 'monroestreettattler.com' || location.hostname === 'www.monroestreettattler.com';
    if (isLive && navigator.share) {
      try { await navigator.share({ title: 'Santas on Monroe Street', text: text.replace(' ' + SHARE_URL, ''), url: SHARE_URL }); return; }
      catch (e) { if (e && e.name === 'AbortError') return; }
    }
    els.shareText.value = text;
    els.shareNote.textContent = isLive ? 'Copy and share:' : 'Local test preview of the share message:';
    els.shareBox.hidden = false;
    els.shareText.focus(); els.shareText.select();
  }
  async function copyShare() {
    const text = els.shareText.value;
    try { await navigator.clipboard.writeText(text); els.copy.textContent = 'Copied'; }
    catch (e) { els.shareText.select(); try { document.execCommand('copy'); els.copy.textContent = 'Copied'; } catch (e2) { els.copy.textContent = 'Select and copy'; } }
    setTimeout(() => { els.copy.textContent = 'Copy'; }, 1600);
  }

  // ---------- Input ----------
  let heldThrow = null;
  function beginThrow(source, timestamp) {
    if (state !== 'playing' || heldThrow || S.target >= TOTAL) return false;
    heldThrow = { source, timestamp };
    els.deliver.classList.add('is-down');
    return true;
  }
  function cancelThrow() {
    heldThrow = null;
    els.deliver.classList.remove('is-down');
  }
  function releaseThrow(source, timestamp) {
    if (heldThrow?.source !== source) return;
    const lob = timestamp - heldThrow.timestamp >= LOB_HOLD_MS;
    cancelThrow();
    deliver(timestamp, lob);
  }
  function throwKey(e) {
    if ((e.code === 'Space' || e.key === ' ') && (!(e.target instanceof HTMLButtonElement) || e.target === els.deliver)) return 'Space';
    if (e.key === 'Enter' && e.target === els.deliver) return 'Enter';
    return null;
  }
  document.addEventListener('keydown', e => {
    const key = throwKey(e);
    if (key && state === 'playing') {
      e.preventDefault();
      if (!e.repeat) beginThrow(key, e.timeStamp);
      return;
    }
    if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') {
      if (state === 'playing') { e.preventDefault(); pauseGame(); }
      else if (state === 'paused') { e.preventDefault(); resumeGame(); }
    }
    if ((e.key === 'm' || e.key === 'M') && !e.metaKey && !e.ctrlKey && !(e.target instanceof HTMLInputElement) && document.activeElement !== els.shareText) setMuted(!AU.muted);
  });
  document.addEventListener('keyup', e => {
    const key = e.code === 'Space' || e.key === ' ' ? 'Space' : e.key;
    if (heldThrow?.source !== key) return;
    e.preventDefault();
    releaseThrow(key, e.timeStamp);
  });
  window.addEventListener('blur', pauseGame);
  document.addEventListener('visibilitychange', () => { if (document.hidden) pauseGame(); });
  els.deliver.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    if (beginThrow(e.pointerId, e.timeStamp)) els.deliver.setPointerCapture(e.pointerId);
  });
  els.deliver.addEventListener('pointerup', e => {
    e.preventDefault();
    releaseThrow(e.pointerId, e.timeStamp);
  });
  for (const event of ['pointercancel', 'lostpointercapture']) {
    els.deliver.addEventListener(event, e => { if (heldThrow?.source === e.pointerId) cancelThrow(); });
  }
  els.deliver.addEventListener('click', e => {
    if (e.detail === 0 && !heldThrow) deliver(e.timeStamp);
  });
  els.deliver.addEventListener('contextmenu', (e) => e.preventDefault());
  const stage = document.querySelector('.sg-main');
  stage.addEventListener('touchmove', (e) => { if (state === 'playing') e.preventDefault(); }, { passive: false });
  els.play.addEventListener('click', () => startGame(prototype && activeBlock === 1 && !trial));
  els.again.addEventListener('click', () => {
    if (fullRun) {
      activeBlock = 1;
      blockTallies.length = 0;
      runTotals = { score: 0, perfects: 0, longest: 0, delivered: 0 };
      configureRoute();
      countedRun = false;
    }
    startGame(prototype && activeBlock === 1 && !trial);
  });
  els.resume.addEventListener('click', resumeGame);
  els.pause.addEventListener('click', () => (state === 'paused' ? resumeGame() : pauseGame()));
  els.mute.addEventListener('click', () => { audioInit(); setMuted(!AU.muted); });
  function startTitleMusic() {
    if (state !== 'title' || AU.muted || (AU.ctx?.state === 'running' && AU.timer)) return;
    audioInit();
    musicStart();
  }
  document.addEventListener('pointerup', startTitleMusic);
  document.addEventListener('click', startTitleMusic);
  document.addEventListener('keydown', startTitleMusic);
  els.share.addEventListener('click', share);
  els.copy.addEventListener('click', copyShare);

  // ---------- Boot ----------
  SPR.santa = makeSprite(SANTA);
  SPR.blackSanta = makeSprite(SANTA, { ...PAL, S: '#a46643', s: '#78452f' });
  SPR.kid = makeSprite(KID);
  SPR.elf = makeSprite(ELF);
  SPR.bundleA = makeSprite(BUNDLE_A); SPR.bundleB = makeSprite(BUNDLE_B);
  SPR.icon = makeSprite(ICON);
  SPR.grinch = makeSprite(GRINCH);
  SPR.gingerbread = makeSprite(GINGERBREAD);
  SPR.santaSide = (() => { const c = document.createElement('canvas'); c.width = SPR.santa.height; c.height = SPR.santa.width; const x = c.getContext('2d'); x.translate(c.width, 0); x.rotate(Math.PI / 2); x.drawImage(SPR.santa, 0, 0); return c; })();
  setMuted(AU.muted);
  els.deliver.disabled = true;
  els.pause.disabled = true;
  if (speedRun) $('sg-launch-title').textContent = 'Santas Speed Run';
  if (trial) {
    $('sg-launch-title').textContent = 'Santa Sprint';
    $('sg-instructions').textContent = 'Every address takes a Santa. Rack up quick stops or chase the moving bonuses.';
  } else if (practiceBlock || demoBlock) {
    $('sg-instructions').textContent = 'Practice Block ' + activeBlock + '.';
  }
  if (local && demoBlock) {
    for (const [id, href, label] of [
      ['sg-other-route', marketRoute ? '?block=1' : '?block=3', marketRoute ? 'Try Block 1' : 'Try Block 3'],
      ['sg-school-route', schoolRoute ? '?block=1' : '?block=4', schoolRoute ? 'Try Block 1' : 'Try Block 4'],
    ]) {
      const link = $(id);
      link.href = href;
      link.textContent = label;
      link.hidden = false;
    }
  }
  if (local) {
    $('sg-preview-levels').hidden = false;
    const preview = practiceBlock || demoBlock || (fullRun ? 'full' : null);
    if (preview) $('sg-preview-' + preview).setAttribute('aria-current', 'page');
  }
  if (prototype) els.share.hidden = !fullRun;
  $('sg-home-board').hidden = !fullRun;
  $('sg-title-replays').hidden = !fullRun || !completedRun;
  $('sg-title-speed-run').hidden = !completedRun;
  if (completedRun) $('sg-speed-run').hidden = false;
  if (fullRun) {
    refreshHomeBoard();
    if (scoreApi) loadSharedStats();
  }
  requestAnimationFrame(frame);
  startTitleMusic();

  // ---------- Local test hook (only with ?test in the URL) ----------
  if (local && new URLSearchParams(location.search).has('test')) {
    window.santasGameTest = {
      get S() { return S; }, get state() { return state; }, get LOTS() { return LOTS; }, get activeBlock() { return activeBlock; }, ROUTE, D, HEDGE, ARM,
      setTimeScale(v) { timeScale = v; },
      manual(on) { stepping = !!on; },
      step(sec) { let left = sec; while (left > 0 && state === 'playing') { const h = Math.min(left, 1 / 120); update(h); left -= h; } },
      press(lob = false) { return deliver(undefined, lob); },
      start: startGame,
      renderNow: render,
      art: { SPR, PAL, drawText, makeSprite, drawHouse, HOUSES },
    };
  }
})();
