/* =========================================================
   COUNTDOWN
   ========================================================= */
const TARGET_DATE = new Date("2026-10-17T00:00:00+05:45").getTime();

function pad(n) { return String(n).padStart(2, "0"); }

const daysEl = document.getElementById("days");
const hoursEl = document.getElementById("hours");
const minutesEl = document.getElementById("minutes");
const secondsEl = document.getElementById("seconds");

let countdownInterval = null;

function updateCountdown() {
    const distance = TARGET_DATE - Date.now();
    if (distance <= 0) {
        daysEl.textContent = hoursEl.textContent = minutesEl.textContent = secondsEl.textContent = "00";
        clearInterval(countdownInterval);
        return;
    }
    const days = Math.floor(distance / 86400000);
    const hours = Math.floor((distance % 86400000) / 3600000);
    const minutes = Math.floor((distance % 3600000) / 60000);
    const seconds = Math.floor((distance % 60000) / 1000);
    daysEl.textContent = pad(days);
    hoursEl.textContent = pad(hours);
    minutesEl.textContent = pad(minutes);
    secondsEl.textContent = pad(seconds);
}

function startCountdown() {
    updateCountdown();
    countdownInterval = setInterval(updateCountdown, 1000);
}

/* =========================================================
   DIRS
   ========================================================= */
const DIRS = [
    [-1, -1], [0, -1], [1, -1],
    [-1, 0], [1, 0],
    [-1, 1], [0, 1], [1, 1]
];

/* =========================================================
   MARKOV CHAIN
   ========================================================= */
function buildTransitionMatrix(cols, rows) {
    const N = cols * rows;
    const P = new Float32Array(N * N);
    const cell = (x, y) => {
        x = Math.max(0, Math.min(cols - 1, x));
        y = Math.max(0, Math.min(rows - 1, y));
        return y * cols + x;
    };
    for (let i = 0; i < N; i++) {
        const cx = i % cols, cy = (i / cols) | 0;
        const weights = new Float32Array(8);
        let sum = 0;
        for (let d = 0; d < 8; d++) {
            const [dx, dy] = DIRS[d];
            const nx = cx + dx, ny = cy + dy;
            if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) { weights[d] = 0; continue; }
            let w = 1.0;
            const distToCenter = Math.hypot(nx - (cols - 1) / 2, ny - (rows - 1) / 2);
            const maxDist = Math.hypot(cols / 2, rows / 2);
            w *= (0.7 + 0.6 * (1 - distToCenter / maxDist));
            if (cx === 0 || cx === cols - 1 || cy === 0 || cy === rows - 1) {
                const towardCenter = (nx - cx) * ((cols - 1) / 2 - cx) + (ny - cy) * ((rows - 1) / 2 - cy);
                if (towardCenter > 0) w *= 1.8;
            }
            weights[d] = w;
            sum += w;
        }
        if (sum === 0) { weights[4] = 1; sum = 1; }
        for (let d = 0; d < 8; d++) {
            const [dx, dy] = DIRS[d];
            P[i * N + cell(cx + dx, cy + dy)] = weights[d] / sum;
        }
    }
    return { P, cols, rows, N };
}

function stepBug(bug, matrix) {
    const { P, cols, rows, N } = matrix;
    const i = bug.cell;
    const cx = i % cols, cy = (i / cols) | 0;
    const weights = new Float32Array(8);
    let sum = 0;
    for (let d = 0; d < 8; d++) {
        const [dx, dy] = DIRS[d];
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) { weights[d] = 0; continue; }
        const j = ny * cols + nx;
        let w = P[i * N + j];
        const sameDir = (dx === bug.dir[0] && dy === bug.dir[1]);
        const opposite = (dx === -bug.dir[0] && dy === -bug.dir[1]);
        if (sameDir) w *= 3.2;
        else if (opposite) w *= 0.25;
        weights[d] = w;
        sum += w;
    }
    let r = Math.random() * sum, chosen = 4;
    for (let d = 0; d < 8; d++) { r -= weights[d]; if (r <= 0) { chosen = d; break; } }
    const [dx, dy] = DIRS[chosen];
    bug.dir = [dx, dy];
    bug.cell = (cy + dy) * cols + (cx + dx);
    const cellW = window.innerWidth / cols;
    const cellH = window.innerHeight / rows;
    bug.x = (cx + dx + 0.5) * cellW;
    bug.y = (cy + dy + 0.5) * cellH;
    bug.el.style.transform = `translate(${bug.x}px, ${bug.y}px)`;
}

/* =========================================================
   TEXT ZONES — candidate slots
   =========================================================
   Four quadrants + two wide bands. None overlap the timer
   (middle rect ~ [0.22,0.78]x[0.32,0.68]).
   ========================================================= */
const ZONES = [
    { name: "TL", xMin: 0.02, xMax: 0.48, yMin: 0.03, yMax: 0.32 },
    { name: "TR", xMin: 0.52, xMax: 0.98, yMin: 0.03, yMax: 0.32 },
    { name: "BL", xMin: 0.02, xMax: 0.48, yMin: 0.68, yMax: 0.97 },
    { name: "BR", xMin: 0.52, xMax: 0.98, yMin: 0.68, yMax: 0.97 },
    { name: "TOP", xMin: 0.02, xMax: 0.98, yMin: 0.03, yMax: 0.35 },
    { name: "BOT", xMin: 0.02, xMax: 0.98, yMin: 0.65, yMax: 0.97 }
];

const QUADS = [ZONES[0], ZONES[1], ZONES[2], ZONES[3]];

/* =========================================================
   WORD CACHE + FPS SAMPLING
   =========================================================
   Each word is rendered once on an offscreen canvas. Its
   ink pixels are reduced by farthest-point sampling
   (Gonzalez k-center) so that any prefix of the FPS order
   is a good k-point approximation of the word's shape.
   ========================================================= */
const WORD_REF_SIZE = 220;   // reference font size for sampling
const WORD_FPS_MAX = 400;   // precompute this many FPS points per word

const wordCache = new Map();

function farthestPointSampling(points, k) {
    const n = points.length;
    if (k >= n) return points.map((_, i) => i);
    const picked = [];
    const dists = new Float64Array(n).fill(Infinity);

    let idx = Math.floor(Math.random() * n);
    picked.push(idx);
    dists[idx] = 0;

    for (let step = 1; step < k; step++) {
        const px = points[idx].x, py = points[idx].y;
        let maxD = -1, maxI = -1;
        for (let j = 0; j < n; j++) {
            const dx = points[j].x - px;
            const dy = points[j].y - py;
            const d = dx * dx + dy * dy;
            if (d < dists[j]) dists[j] = d;
            if (dists[j] > maxD) { maxD = dists[j]; maxI = j; }
        }
        idx = maxI;
        picked.push(idx);
    }
    return picked;
}

function getWordData(word) {
    if (wordCache.has(word)) return wordCache.get(word);

    const REF = WORD_REF_SIZE;
    const fontSpec = `bold ${REF}px Arial, Helvetica, sans-serif`;

    // Measure
    const mctx = document.createElement("canvas").getContext("2d");
    mctx.font = fontSpec;
    const m = mctx.measureText(word);
    const approxW = Math.ceil(m.width) + 40;
    const approxH = Math.ceil((m.actualBoundingBoxAscent || REF * 0.75) + (m.actualBoundingBoxDescent || REF * 0.25)) + 40;

    // Draw
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(2, approxW);
    canvas.height = Math.max(2, approxH);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#fff";
    ctx.font = fontSpec;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(word, canvas.width / 2, canvas.height / 2);

    // Scan ink pixels, track bbox
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const pixels = [];
    let minX = canvas.width, maxX = 0, minY = canvas.height, maxY = 0;
    for (let y = 0; y < canvas.height; y += 2) {
        for (let x = 0; x < canvas.width; x += 2) {
            if (img[(y * canvas.width + x) * 4] > 128) {
                pixels.push({ x, y });
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
        }
    }

    const bboxW = Math.max(1, maxX - minX);
    const bboxH = Math.max(1, maxY - minY);
    const aspect = bboxW / bboxH;

    // FPS
    const k = Math.min(WORD_FPS_MAX, pixels.length);
    const fpsIdx = farthestPointSampling(pixels, k);
    const fps = fpsIdx.map(i => ({
        nx: (pixels[i].x - minX) / bboxW,
        ny: (pixels[i].y - minY) / bboxH
    }));

    const result = { aspect, fps };
    wordCache.set(word, result);
    return result;
}

/* =========================================================
   LAYOUT — cap-height fitting
   =========================================================
   Given a word-to-zone assignment, compute the largest
   cap-height h such that every word fits in its zone.
   All words render at this same cap-height, so the phrase
   is visually harmonious. This is the max-min solution
   with equal weights.
   ========================================================= */
const ZONE_PADDING = 0.92;

function fitCapHeight(words, zones) {
    const vpW = window.innerWidth;
    const vpH = window.innerHeight;
    let h = Infinity;

    for (let i = 0; i < words.length; i++) {
        const data = getWordData(words[i]);
        const z = zones[i];
        const ZW = (z.xMax - z.xMin) * vpW * ZONE_PADDING;
        const ZH = (z.yMax - z.yMin) * vpH * ZONE_PADDING;
        // word rendered at cap-height h has width = a*h, height = h
        const fit = Math.min(ZW / data.aspect, ZH);
        if (fit < h) h = fit;
    }
    return h;
}

/* =========================================================
   CANDIDATE GENERATION
   =========================================================
   Enumerate word-to-zone assignments. For a single word,
   every zone is a candidate. For multi-word phrases, every
   permutation of quadrant zones.
   ========================================================= */
function permutations(arr, k) {
    const result = [];
    const used = new Array(arr.length).fill(false);
    const current = [];
    function recurse() {
        if (current.length === k) { result.push(current.slice()); return; }
        for (let i = 0; i < arr.length; i++) {
            if (used[i]) continue;
            used[i] = true;
            current.push(arr[i]);
            recurse();
            current.pop();
            used[i] = false;
        }
    }
    recurse();
    return result;
}

function generateCandidates(words, pool) {
    const n = words.length;
    const candidates = [];
    if (n === 0) return candidates;

    if (n === 1) {
        for (const z of pool) candidates.push({ words, zones: [z] });
        return candidates;
    }

    const picks = Math.min(n, pool.length);
    const idxPerms = permutations(pool.map((_, i) => i), picks);
    for (const perm of idxPerms) {
        candidates.push({ words: words.slice(0, picks), zones: perm.map(i => pool[i]) });
    }
    return candidates;
}

function scoreAndPick(candidates) {
    if (candidates.length === 0) return null;
    const scored = [];
    for (const c of candidates) {
        const h = fitCapHeight(c.words, c.zones);
        if (h > 0 && isFinite(h)) scored.push({ ...c, h });
    }
    if (scored.length === 0) return null;
    scored.sort((a, b) => b.h - a.h);
    const bestH = scored[0].h;
    const pool = scored.filter(s => s.h >= bestH * 0.85);
    return pool[Math.floor(Math.random() * pool.length)];
}

/* =========================================================
   LAYOUT PLANNER
   Returns: { chains: [ { words, zones, h }, ... ] }
   Single-chain for most texts; two chains in dual mode.
   ========================================================= */
const TEXTS = [
    "HAPPY BIRTHDAY",
    "I LOVE YOU",
    "MY LOVE",
    "MY DEAR",
    "SHUBHANGI",
    "I LOVE YOU",
    "MY DEAREST PRINCESS",
    "20 YEAR OLD GRANNY",
    "THE BIG 20",
    "20",
    "I LOVE YOU SHUBHANGI"
];

let textBag = [];

function getRandomText() {
    if (textBag.length === 0) {
        textBag = TEXTS.slice();
        for (let i = textBag.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [textBag[i], textBag[j]] = [textBag[j], textBag[i]];
        }
    }
    return textBag.pop();
}

const DUAL_MODE_PROBABILITY = 0.25;

function planLayout() {
    if (Math.random() < DUAL_MODE_PROBABILITY) return planDual();
    return planSingle();
}

function planSingle() {
    const text = getRandomText();
    const words = text.split(/\s+/).filter(Boolean);
    const pool = words.length === 1 ? ZONES : QUADS;
    const candidates = generateCandidates(words, pool);
    const chosen = scoreAndPick(candidates);
    if (!chosen) return null;   // caller falls back
    return { chains: [chosen] };
}

function planDual() {
    const t1 = getRandomText();
    let t2 = getRandomText();
    let tries = 0;
    while (t2 === t1 && tries < 5) { t2 = getRandomText(); tries++; }

    const words1 = t1.split(/\s+/).filter(Boolean);
    const words2 = t2.split(/\s+/).filter(Boolean);

    const leftRight = Math.random() < 0.5;
    const pool1 = leftRight ? [QUADS[0], QUADS[2]] : [QUADS[0], QUADS[1]];
    const pool2 = leftRight ? [QUADS[1], QUADS[3]] : [QUADS[2], QUADS[3]];

    const c1 = scoreAndPick(generateCandidates(words1, pool1));
    const c2 = scoreAndPick(generateCandidates(words2, pool2));
    if (!c1 || !c2) return planSingle();   // fallback

    return { chains: [c1, c2] };
}

/* =========================================================
   TARGET POINT GENERATION
   =========================================================
   Allocate bugs to words proportional to aspect ratio.
   Take the first k FPS points of each word. Convert
   normalized coords to viewport pixels.
   ========================================================= */
function buildTargets(layout, totalBugs) {
    const vpW = window.innerWidth;
    const vpH = window.innerHeight;

    // Compute per-word weight = aspect (h is shared within a chain)
    const wordInfos = [];
    let totalWeight = 0;
    for (const chain of layout.chains) {
        for (let i = 0; i < chain.words.length; i++) {
            const data = getWordData(chain.words[i]);
            const weight = data.aspect;
            totalWeight += weight;
            wordInfos.push({ chain, wordIndex: i, data, weight });
        }
    }
    if (totalWeight === 0) return [];

    // Largest remainder allocation
    const allocs = wordInfos.map(info => {
        const exact = (info.weight / totalWeight) * totalBugs;
        const count = Math.floor(exact);
        return { info, count, exact };
    });
    const totalAssigned = allocs.reduce((s, a) => s + a.count, 0);
    const remainders = allocs
        .map((a, i) => ({ i, rem: a.exact - a.count }))
        .sort((a, b) => b.rem - a.rem);
    let extra = totalBugs - totalAssigned;
    for (const r of remainders) {
        if (extra <= 0) break;
        allocs[r.i].count++;
        extra--;
    }

    // Build target pixels
    const targets = [];
    for (const a of allocs) {
        const { chain, wordIndex, data } = a.info;
        const zone = chain.zones[wordIndex];
        const h = chain.h;

        const ZW = (zone.xMax - zone.xMin) * vpW;
        const ZH = (zone.yMax - zone.yMin) * vpH;
        const ZX = zone.xMin * vpW;
        const ZY = zone.yMin * vpH;

        const w = data.aspect * h;
        const offsetX = ZX + (ZW - w) / 2;
        const offsetY = ZY + (ZH - h) / 2;

        const count = Math.min(a.count, data.fps.length);
        for (let i = 0; i < count; i++) {
            const p = data.fps[i];
            targets.push({
                x: offsetX + p.nx * w,
                y: offsetY + p.ny * h
            });
        }
    }

    return targets;
}

/* =========================================================
   HUNGARIAN ASSIGNMENT
   =========================================================
   Optimal assignment of bugs (rows) to targets (columns)
   with squared Euclidean cost. Rectangular n x m with n<=m.
   O(n^2 m). For n=260, m~=400, ~27M ops once per morph.
   ========================================================= */
function hungarian(cost) {
    const n = cost.length;
    if (n === 0) return [];
    const m = cost[0].length;
    if (m === 0) return new Array(n).fill(-1);

    const u = new Array(n + 1).fill(0);
    const v = new Array(m + 1).fill(0);
    const p = new Array(m + 1).fill(0);
    const way = new Array(m + 1).fill(0);

    for (let i = 1; i <= n; i++) {
        p[0] = i;
        let j0 = 0;
        const minv = new Array(m + 1).fill(Infinity);
        const used = new Array(m + 1).fill(false);

        do {
            used[j0] = true;
            const i0 = p[j0];
            let delta = Infinity;
            let j1 = 0;

            for (let j = 1; j <= m; j++) {
                if (used[j]) continue;
                const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
                if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
                if (minv[j] < delta) { delta = minv[j]; j1 = j; }
            }

            for (let j = 0; j <= m; j++) {
                if (used[j]) { u[p[j]] += delta; v[j] -= delta; }
                else { minv[j] -= delta; }
            }
            j0 = j1;
        } while (p[j0] !== 0);

        do {
            const j1 = way[j0];
            p[j0] = p[j1];
            j0 = j1;
        } while (j0);
    }

    const assignment = new Array(n).fill(-1);
    for (let j = 1; j <= m; j++) {
        if (p[j] > 0) assignment[p[j] - 1] = j - 1;
    }
    return assignment;
}

/* =========================================================
   CONFIG
   ========================================================= */
const SWARM_COUNT = { desktop: 40, mobile: 20 };
const TEXT_BUG_TARGET = { desktop: 260, mobile: 130 };

const SPRITES = [
    { src: "resources/bugs/butterfly2.png", type: "butterfly", size: [28, 40] },
    { src: "resources/bugs/butterfly4.png", type: "butterfly", size: [30, 42] },
    { src: "resources/bugs/butterfly6.png", type: "butterfly", size: [26, 36] },
    { src: "resources/bugs/shebug.png", type: "butterfly", size: [34, 46] }
];

/* =========================================================
   TIMING
   ========================================================= */
const WANDER_MS = 5000;
const MORPH_MS = 2500;
const HOLD_MS = 15000;
const MORPHS_PER_CYCLE = 3;

let phase = "wander";
let phaseStart = performance.now();
let morphCount = 0;
let targets = [];
let assignments = [];

const swarmLayer = document.getElementById("bug-layer");
const bugs = [];
let matrix = null;

const rand = (min, max) => Math.random() * (max - min) + min;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const isMobile = () => window.matchMedia("(max-width: 600px)").matches;

function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/* =========================================================
   BUG CREATION
   ========================================================= */
function makeBugElement(sprite) {
    const size = rand(sprite.size[0], sprite.size[1]);
    const el = document.createElement("div");
    el.className = "bug";
    el.dataset.type = sprite.type;
    el.style.width = size + "px";
    el.style.height = size + "px";
    const img = document.createElement("img");
    img.className = "bug-inner";
    img.src = sprite.src;
    img.alt = "";
    img.draggable = false;
    el.appendChild(img);
    return el;
}

function spawnBug() {
    const el = makeBugElement(pick(SPRITES));
    swarmLayer.appendChild(el);
    const cx = (Math.random() * matrix.cols) | 0;
    const cy = (Math.random() * matrix.rows) | 0;
    const cellW = window.innerWidth / matrix.cols;
    const cellH = window.innerHeight / matrix.rows;
    const bug = {
        el,
        x: (cx + 0.5) * cellW, y: (cy + 0.5) * cellH,
        cell: cy * matrix.cols + cx,
        dir: DIRS[(Math.random() * 8) | 0],
        nextTick: performance.now() + Math.random() * 300,
        _morphFrom: null, _dying: false
    };
    el.style.transform = `translate(${bug.x}px, ${bug.y}px)`;
    el.style.transition = "transform 0.25s ease-out";
    bugs.push(bug);
}

function spawnBugAtEdge() {
    const el = makeBugElement(pick(SPRITES));
    swarmLayer.appendChild(el);
    const w = window.innerWidth, h = window.innerHeight, margin = 60;
    const side = (Math.random() * 4) | 0;
    let x, y;
    if (side === 0) { x = Math.random() * w; y = -margin; }
    else if (side === 1) { x = w + margin; y = Math.random() * h; }
    else if (side === 2) { x = Math.random() * w; y = h + margin; }
    else { x = -margin; y = Math.random() * h; }
    const cellW = window.innerWidth / matrix.cols;
    const cellH = window.innerHeight / matrix.rows;
    const cx = Math.max(0, Math.min(matrix.cols - 1, (x / cellW) | 0));
    const cy = Math.max(0, Math.min(matrix.rows - 1, (y / cellH) | 0));
    const bug = {
        el, x, y,
        cell: cy * matrix.cols + cx,
        dir: DIRS[(Math.random() * 8) | 0],
        nextTick: performance.now() + Math.random() * 300,
        _morphFrom: null, _dying: false
    };
    el.style.transform = `translate(${x}px, ${y}px)`;
    el.style.transition = "none";
    bugs.push(bug);
}

function despawnBug(bug) {
    if (bug._dying) return;
    bug._dying = true;
    bug.el.style.transition = "transform 0.6s ease, opacity 0.6s ease";
    bug.el.style.opacity = "0";
    bug.el.style.transform = `translate(${bug.x}px, ${bug.y}px) scale(0.3)`;
    setTimeout(() => {
        if (bug.el.parentNode) bug.el.parentNode.removeChild(bug.el);
    }, 650);
}

/* =========================================================
   PHASE TRANSITIONS
   ========================================================= */
function startMorph() {
    const layout = planLayout();
    if (!layout) { phase = "wander"; phaseStart = performance.now(); return; }

    const maxBugs = isMobile() ? TEXT_BUG_TARGET.mobile : TEXT_BUG_TARGET.desktop;
    const allTargets = buildTargets(layout, maxBugs);
    const targetCount = Math.min(allTargets.length, maxBugs);

    const living = bugs.filter(b => !b._dying);
    const diff = targetCount - living.length;
    if (diff > 0) {
        for (let i = 0; i < diff; i++) spawnBugAtEdge();
    } else if (diff < 0) {
        let killed = 0;
        for (let i = bugs.length - 1; i >= 0 && killed < -diff; i--) {
            if (!bugs[i]._dying) { despawnBug(bugs[i]); killed++; }
        }
    }

    targets = allTargets.slice(0, targetCount);

    // Hungarian on squared distances
    const livingNow = bugs.filter(b => !b._dying);
    const n = livingNow.length;
    const m = targets.length;
    const cost = new Array(n);
    for (let i = 0; i < n; i++) {
        const row = new Float64Array(m);
        const bx = livingNow[i].x, by = livingNow[i].y;
        for (let j = 0; j < m; j++) {
            const dx = bx - targets[j].x;
            const dy = by - targets[j].y;
            row[j] = dx * dx + dy * dy;
        }
        cost[i] = row;
    }

    // Budget: if n*m is huge, fall back to greedy to avoid a hitch
    let assignment;
    if (n * m > 80000) {
        // Greedy fallback
        assignment = new Array(n).fill(-1);
        const used = new Set();
        for (let i = 0; i < n; i++) {
            let best = -1, bestD = Infinity;
            for (let j = 0; j < m; j++) {
                if (used.has(j)) continue;
                if (cost[i][j] < bestD) { bestD = cost[i][j]; best = j; }
            }
            if (best !== -1) { assignment[i] = best; used.add(best); }
        }
    } else {
        assignment = hungarian(cost);
    }

    // Map to full bugs array
    assignments = new Array(bugs.length).fill(-1);
    let idx = 0;
    for (let i = 0; i < bugs.length; i++) {
        if (bugs[i]._dying) continue;
        assignments[i] = assignment[idx];
        idx++;
    }

    bugs.forEach(b => {
        if (!b._dying) { b._morphFrom = null; b.targetX = undefined; b.targetY = undefined; }
    });

    phase = "morph";
    phaseStart = performance.now();
}

function updateMorph(now) {
    const t = Math.min(1, (now - phaseStart) / MORPH_MS);
    const e = easeInOutCubic(t);
    bugs.forEach((bug, i) => {
        if (bug._dying) return;
        const ti = assignments[i];
        if (ti === -1 || ti >= targets.length) return;
        if (!bug._morphFrom) bug._morphFrom = { x: bug.x, y: bug.y };
        const tx = targets[ti].x, ty = targets[ti].y;
        bug.x = bug._morphFrom.x + (tx - bug._morphFrom.x) * e;
        bug.y = bug._morphFrom.y + (ty - bug._morphFrom.y) * e;
        bug.el.style.transition = "none";
        bug.el.style.transform = `translate(${bug.x}px, ${bug.y}px)`;
    });
    if (t >= 1) {
        bugs.forEach((bug, i) => {
            if (bug._dying) return;
            const ti = assignments[i];
            if (ti !== -1 && ti < targets.length) {
                bug.targetX = targets[ti].x;
                bug.targetY = targets[ti].y;
                bug._vibPhaseX = Math.random() * Math.PI * 2;
                bug._vibPhaseY = Math.random() * Math.PI * 2;
                bug._vibFreqX = 0.04 + Math.random() * 0.025;
                bug._vibFreqY = 0.045 + Math.random() * 0.025;
                bug._vibAmp = 2.0 + Math.random() * 1.5;
            }
            bug._morphFrom = null;
        });
        phase = "hold";
        phaseStart = now;
    }
}

function vibrateStep(bug, now) {
    if (bug.targetX === undefined) return;
    bug.x = bug.targetX + Math.sin(now * bug._vibFreqX + bug._vibPhaseX) * bug._vibAmp;
    bug.y = bug.targetY + Math.cos(now * bug._vibFreqY + bug._vibPhaseY) * bug._vibAmp;
    bug.el.style.transform = `translate(${bug.x}px, ${bug.y}px)`;
}

function resumeWander() {
    const targetCount = isMobile() ? SWARM_COUNT.mobile : SWARM_COUNT.desktop;
    const living = bugs.filter(b => !b._dying);
    const surplus = living.length - targetCount;
    if (surplus > 0) {
        let killed = 0;
        for (let i = bugs.length - 1; i >= 0 && killed < surplus; i--) {
            if (!bugs[i]._dying) { despawnBug(bugs[i]); killed++; }
        }
    }
    const cellW = window.innerWidth / matrix.cols;
    const cellH = window.innerHeight / matrix.rows;
    bugs.forEach(bug => {
        if (bug._dying) return;
        delete bug.targetX; delete bug.targetY;
        const cx = Math.max(0, Math.min(matrix.cols - 1, (bug.x / cellW) | 0));
        const cy = Math.max(0, Math.min(matrix.rows - 1, (bug.y / cellH) | 0));
        bug.cell = cy * matrix.cols + cx;
        bug.dir = DIRS[(Math.random() * 8) | 0];
        bug.nextTick = performance.now() + Math.random() * 300;
        bug.el.style.transition = "transform 0.25s ease-out";
        bug.el.style.opacity = "1";
    });
    phase = "wander";
    phaseStart = performance.now();
    morphCount = 0;
}

/* =========================================================
   MAIN LOOP
   ========================================================= */
function tick(now) {
    if (phase === "wander") {
        for (const bug of bugs) {
            if (bug._dying) continue;
            if (now >= bug.nextTick) {
                stepBug(bug, matrix);
                bug.nextTick = now + 220 + Math.random() * 180;
            }
        }
        if (now - phaseStart > WANDER_MS) { morphCount = 0; startMorph(); }
    } else if (phase === "morph") {
        updateMorph(now);
    } else if (phase === "hold") {
        for (const bug of bugs) {
            if (bug._dying) continue;
            vibrateStep(bug, now);
        }
        if (now - phaseStart > HOLD_MS) {
            morphCount++;
            if (morphCount < MORPHS_PER_CYCLE) startMorph();
            else resumeWander();
        }
    }
    requestAnimationFrame(tick);
}

/* =========================================================
   GRID + RESIZE
   ========================================================= */
function buildGrid() {
    const mobile = isMobile();
    const cols = mobile ? 14 : 26;
    const rows = mobile ? 12 : 16;
    matrix = buildTransitionMatrix(cols, rows);
}

function resnapToGrid() {
    const cellW = window.innerWidth / matrix.cols;
    const cellH = window.innerHeight / matrix.rows;
    bugs.forEach(bug => {
        if (bug._dying) return;
        const cx = Math.max(0, Math.min(matrix.cols - 1, (bug.x / cellW) | 0));
        const cy = Math.max(0, Math.min(matrix.rows - 1, (bug.y / cellH) | 0));
        bug.cell = cy * matrix.cols + cx;
    });
}

let resizeTimer = null;
window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { buildGrid(); resnapToGrid(); }, 200);
});

/* =========================================================
   BOOT
   ========================================================= */
function init() {
    startCountdown();
    buildGrid();
    const count = isMobile() ? SWARM_COUNT.mobile : SWARM_COUNT.desktop;
    for (let i = 0; i < count; i++) spawnBug();
    phaseStart = performance.now();
    requestAnimationFrame(tick);
}

init();