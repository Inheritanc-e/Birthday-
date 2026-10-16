window.Swarm = (function () {
    const { DIRS, rand, pick, isMobile, easeInOutCubic, shuffle, permutations } = Utils;

    const ZONES = [
        { name: "TL", xMin: 0.02, xMax: 0.48, yMin: 0.03, yMax: 0.32 },
        { name: "TR", xMin: 0.52, xMax: 0.98, yMin: 0.03, yMax: 0.32 },
        { name: "BL", xMin: 0.02, xMax: 0.48, yMin: 0.68, yMax: 0.97 },
        { name: "BR", xMin: 0.52, xMax: 0.98, yMin: 0.68, yMax: 0.97 },
        { name: "TOP", xMin: 0.02, xMax: 0.98, yMin: 0.03, yMax: 0.35 },
        { name: "BOT", xMin: 0.02, xMax: 0.98, yMin: 0.65, yMax: 0.97 }
    ];
    const QUADS = [ZONES[0], ZONES[1], ZONES[2], ZONES[3]];
    const ZONE_PADDING = 0.92;
    const WORD_REF_SIZE = 220;
    const WORD_FPS_MAX = 400;
    const DUAL_MODE_PROBABILITY = 0.25;

    function createSwarm(opts) {
        const bugs = [];
        let matrix = null;
        let targets = [];
        let assignments = [];
        let phase = "wander";
        let phaseStart = performance.now();
        let morphCount = 0;
        let rafId = null;
        let textBag = [];
        const wordCache = new Map();

        let manualMode = false;
        let currentMorphDuration = null;
        let morphCompleteCallback = null;

        // append (accumulating words without reshuffling existing bugs)
        let incomingStart = 0;
        let incomingDur = 2500;

        // ---------- markov ----------
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

        function stepBug(bug) {
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
                const same = (dx === bug.dir[0] && dy === bug.dir[1]);
                const opp = (dx === -bug.dir[0] && dy === -bug.dir[1]);
                if (same) w *= 3.2; else if (opp) w *= 0.25;
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
            bug.el.style.transform = `translate(${bug.x}px, ${bug.y}px) scale(1)`;
        }

        // ---------- fps ----------
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

        function sampleCanvas(drawFn, targetCount) {
            const W = window.innerWidth;
            const H = window.innerHeight;
            const canvas = document.createElement("canvas");
            canvas.width = W;
            canvas.height = H;
            const ctx = canvas.getContext("2d");
            ctx.fillStyle = "#000";
            ctx.fillRect(0, 0, W, H);
            ctx.fillStyle = "#fff";
            drawFn(ctx, W, H);

            const img = ctx.getImageData(0, 0, W, H).data;
            const pixels = [];
            for (let y = 0; y < H; y += 3) {
                for (let x = 0; x < W; x += 3) {
                    if (img[(y * W + x) * 4] > 128) {
                        pixels.push({ x, y });
                    }
                }
            }
            if (!pixels.length) return [];
            const k = Math.min(targetCount, pixels.length);
            const idx = farthestPointSampling(pixels, k);
            return idx.map(i => pixels[i]);
        }

        function drawHeart(ctx, cx, cy, s) {
            ctx.beginPath();
            ctx.moveTo(cx, cy + s * 0.9);
            ctx.bezierCurveTo(cx - s * 1.5, cy - s * 0.3, cx - s * 1.2, cy - s * 1.5, cx, cy - s * 0.6);
            ctx.bezierCurveTo(cx + s * 1.2, cy - s * 1.5, cx + s * 1.5, cy - s * 0.3, cx, cy + s * 0.9);
            ctx.fill();
        }

        function getHeartPoints(targetCount) {
            return sampleCanvas((ctx, W, H) => {
                const cx = W / 2, cy = H / 2;
                const s = Math.min(W, H) * 0.42;
                drawHeart(ctx, cx, cy, s);
            }, targetCount);
        }

        function getILoveYouPoints(targetCount) {
            return sampleCanvas((ctx, W, H) => {
                const baseFont = Math.min(W, H) * 0.22;
                const mctx = document.createElement("canvas").getContext("2d");
                mctx.font = `700 ${baseFont}px 'Fuzzy Bubbles', cursive`;
                const iW0 = mctx.measureText("I").width;
                const youW0 = mctx.measureText("You").width;
                const heartW0 = baseFont * 1.3;
                const gap0 = baseFont * 0.35;
                const total0 = iW0 + gap0 + heartW0 + gap0 + youW0;
                const maxAllowed = W * 0.85;
                const shrink = total0 > maxAllowed ? maxAllowed / total0 : 1;
                const fontSize = baseFont * shrink;

                mctx.font = `700 ${fontSize}px 'Fuzzy Bubbles', cursive`;
                const iW = mctx.measureText("I").width;
                const youW = mctx.measureText("You").width;
                const heartW = fontSize * 1.3;
                const gap = fontSize * 0.35;
                const totalW = iW + gap + heartW + gap + youW;
                const startX = (W - totalW) / 2;
                const centerY = H / 2;
                const iCx = startX + iW / 2;
                const hCx = startX + iW + gap + heartW / 2;
                const yCx = startX + iW + gap + heartW + gap + youW / 2;
                const heartSize = fontSize * 0.55;

                ctx.font = `700 ${fontSize}px 'Fuzzy Bubbles', cursive`;
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText("I", iCx, centerY);
                drawHeart(ctx, hCx, centerY, heartSize);
                ctx.fillText("You", yCx, centerY);
            }, targetCount);
        }

        function getWordsInRects(words, rects, targetCount, opts = {}) {
            const SX_MIN = opts.squeezeMin ?? 0.88;
            const SX_MAX = opts.stretchMax ?? 1.30;
            const LETTER_SPACING_EM = opts.letterSpacing ?? 0;

            return sampleCanvas((ctx, W, H) => {
                const REF = 200;
                const FONT = (px) => `700 ${px}px 'Fuzzy Bubbles', cursive`;
                const mctx = document.createElement("canvas").getContext("2d");
                mctx.font = FONT(REF);

                const capH = mctx.measureText("H").actualBoundingBoxAscent || REF * 0.72;

                const meas = words.map((w) => {
                    const m = mctx.measureText(w);
                    const asc = m.actualBoundingBoxAscent || REF * 0.75;
                    const desc = m.actualBoundingBoxDescent || REF * 0.25;
                    // account for letter spacing in width estimate
                    const extraW = LETTER_SPACING_EM * REF * Math.max(0, w.length - 1);
                    return { w: Math.max(1, m.width + extraW), h: Math.max(1, asc + desc) };
                });

                let fs = Infinity;
                for (let i = 0; i < words.length; i++) {
                    const rw = rects[i].w * W, rh = rects[i].h * H;
                    const byH = REF * rh / meas[i].h;
                    const byW = REF * rw / (meas[i].w * SX_MIN);
                    fs = Math.min(fs, byH, byW);
                }
                if (!isFinite(fs) || fs <= 0) fs = REF;

                const bandCy = rects.reduce((s, r) => s + (r.y + r.h / 2), 0) / rects.length * H;
                const baseline = bandCy + (capH * fs / REF) / 2;

                ctx.font = FONT(fs);
                ctx.textAlign = "center";
                ctx.textBaseline = "alphabetic";
                if (LETTER_SPACING_EM > 0) {
                    ctx.letterSpacing = `${fs * LETTER_SPACING_EM}px`;
                }

                for (let i = 0; i < words.length; i++) {
                    const rw = rects[i].w * W;
                    const cx = (rects[i].x + rects[i].w / 2) * W;
                    const natural = meas[i].w * fs / REF;
                    const sx = Math.min(SX_MAX, Math.max(SX_MIN, rw / natural));
                    ctx.save();
                    ctx.translate(cx, baseline);
                    ctx.scale(sx, 1);
                    ctx.fillText(words[i], 0, 0);
                    ctx.restore();
                }

                ctx.letterSpacing = "0px";
            }, targetCount);
        }

        // ---------- word cache ----------
        function getWordData(word) {
            if (wordCache.has(word)) return wordCache.get(word);
            const REF = WORD_REF_SIZE;
            const fontSpec = `700 ${REF}px 'Fuzzy Bubbles', cursive`;
            const mctx = document.createElement("canvas").getContext("2d");
            mctx.font = fontSpec;
            const m = mctx.measureText(word);
            const canvas = document.createElement("canvas");
            canvas.width = Math.max(2, Math.ceil(m.width) + 40);
            canvas.height = Math.max(2, Math.ceil((m.actualBoundingBoxAscent || REF * 0.75) + (m.actualBoundingBoxDescent || REF * 0.25)) + 40);
            const ctx = canvas.getContext("2d");
            ctx.fillStyle = "#000"; ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = "#fff";
            ctx.font = fontSpec;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(word, canvas.width / 2, canvas.height / 2);
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
            const pixels = [];
            let minX = canvas.width, maxX = 0, minY = canvas.height, maxY = 0;
            for (let y = 0; y < canvas.height; y += 2) {
                for (let x = 0; x < canvas.width; x += 2) {
                    if (img[(y * canvas.width + x) * 4] > 128) {
                        pixels.push({ x, y });
                        if (x < minX) minX = x; if (x > maxX) maxX = x;
                        if (y < minY) minY = y; if (y > maxY) maxY = y;
                    }
                }
            }
            const bboxW = Math.max(1, maxX - minX);
            const bboxH = Math.max(1, maxY - minY);
            const aspect = bboxW / bboxH;
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

        function fitCapHeight(words, zones) {
            const vpW = window.innerWidth, vpH = window.innerHeight;
            let h = Infinity;
            for (let i = 0; i < words.length; i++) {
                const data = getWordData(words[i]);
                const z = zones[i];
                const ZW = (z.xMax - z.xMin) * vpW * ZONE_PADDING;
                const ZH = (z.yMax - z.yMin) * vpH * ZONE_PADDING;
                const fit = Math.min(ZW / data.aspect, ZH);
                if (fit < h) h = fit;
            }
            return h;
        }

        function generateCandidates(words, pool) {
            const n = words.length;
            const candidates = [];
            if (n === 0) return candidates;
            if (n === 1) { for (const z of pool) candidates.push({ words, zones: [z] }); return candidates; }
            const picks = Math.min(n, pool.length);
            const idxPerms = permutations(pool.map((_, i) => i), picks);
            for (const perm of idxPerms) {
                candidates.push({ words: words.slice(0, picks), zones: perm.map(i => pool[i]) });
            }
            return candidates;
        }

        function scoreAndPick(candidates) {
            if (!candidates.length) return null;
            const scored = [];
            for (const c of candidates) {
                const h = fitCapHeight(c.words, c.zones);
                if (h > 0 && isFinite(h)) scored.push({ ...c, h });
            }
            if (!scored.length) return null;
            scored.sort((a, b) => b.h - a.h);
            const bestH = scored[0].h;
            const pool = scored.filter(s => s.h >= bestH * 0.85);
            return pool[Math.floor(Math.random() * pool.length)];
        }

        function getRandomText() {
            if (textBag.length === 0) textBag = shuffle(opts.texts);
            return textBag.pop();
        }

        function planSingle() {
            const text = getRandomText();
            const words = text.split(/\s+/).filter(Boolean);
            const pool = words.length === 1 ? [ZONES[4], ZONES[5]] : QUADS;
            const chosen = scoreAndPick(generateCandidates(words, pool));
            return chosen ? { chains: [chosen] } : null;
        }

        function planDual() {
            const t1 = getRandomText();
            let t2 = getRandomText();
            let tries = 0;
            while (t2 === t1 && tries < 5) { t2 = getRandomText(); tries++; }
            const words1 = t1.split(/\s+/).filter(Boolean);
            const words2 = t2.split(/\s+/).filter(Boolean);
            const lr = Math.random() < 0.5;
            const pool1 = lr ? [QUADS[0], QUADS[2]] : [QUADS[0], QUADS[1]];
            const pool2 = lr ? [QUADS[1], QUADS[3]] : [QUADS[2], QUADS[3]];
            const c1 = scoreAndPick(generateCandidates(words1, pool1));
            const c2 = scoreAndPick(generateCandidates(words2, pool2));
            if (!c1 || !c2) return planSingle();
            return { chains: [c1, c2] };
        }

        function planLayout() {
            return Math.random() < DUAL_MODE_PROBABILITY ? planDual() : planSingle();
        }

        function buildTargets(layout, totalBugs) {
            const vpW = window.innerWidth, vpH = window.innerHeight;
            const wordInfos = [];
            let totalWeight = 0;
            for (const chain of layout.chains) {
                for (let i = 0; i < chain.words.length; i++) {
                    const data = getWordData(chain.words[i]);
                    totalWeight += data.aspect;
                    wordInfos.push({ chain, wordIndex: i, data, weight: data.aspect });
                }
            }
            if (totalWeight === 0) return [];
            const allocs = wordInfos.map(info => {
                const exact = (info.weight / totalWeight) * totalBugs;
                return { info, count: Math.floor(exact), exact };
            });
            const totalAssigned = allocs.reduce((s, a) => s + a.count, 0);
            const remainders = allocs.map((a, i) => ({ i, rem: a.exact - a.count }))
                .sort((a, b) => b.rem - a.rem);
            let extra = totalBugs - totalAssigned;
            for (const r of remainders) { if (extra <= 0) break; allocs[r.i].count++; extra--; }
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
                    targets.push({ x: offsetX + p.nx * w, y: offsetY + p.ny * h });
                }
            }
            return targets;
        }

        function hungarian(cost) {
            const n = cost.length;
            if (!n) return [];
            const m = cost[0].length;
            if (!m) return new Array(n).fill(-1);
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
                    let delta = Infinity, j1 = 0;
                    for (let j = 1; j <= m; j++) {
                        if (used[j]) continue;
                        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
                        if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
                        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
                    }
                    for (let j = 0; j <= m; j++) {
                        if (used[j]) { u[p[j]] += delta; v[j] -= delta; }
                        else minv[j] -= delta;
                    }
                    j0 = j1;
                } while (p[j0] !== 0);
                do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
            }
            const assignment = new Array(n).fill(-1);
            for (let j = 1; j <= m; j++) if (p[j] > 0) assignment[p[j] - 1] = j - 1;
            return assignment;
        }

        // ---------- bug lifecycle ----------
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
            img.alt = ""; img.draggable = false;
            el.appendChild(img);
            return el;
        }

        function spawnBug() {
            const el = makeBugElement(pick(opts.sprites));
            opts.container.appendChild(el);
            const cx = (Math.random() * matrix.cols) | 0;
            const cy = (Math.random() * matrix.rows) | 0;
            const cw = window.innerWidth / matrix.cols;
            const ch = window.innerHeight / matrix.rows;
            const bug = {
                el, x: (cx + 0.5) * cw, y: (cy + 0.5) * ch,
                cell: cy * matrix.cols + cx,
                dir: DIRS[(Math.random() * 8) | 0],
                nextTick: performance.now() + Math.random() * 300,
                _morphFrom: null, _dying: false
            };
            el.style.transform = `translate(${bug.x}px, ${bug.y}px) scale(1)`;
            el.style.transition = "transform 0.25s ease-out";
            bugs.push(bug);
        }

        function spawnBugAtEdge() {
            const el = makeBugElement(pick(opts.sprites));
            opts.container.appendChild(el);
            const w = window.innerWidth, h = window.innerHeight, m = 60;
            const side = (Math.random() * 4) | 0;
            let x, y;
            if (side === 0) { x = Math.random() * w; y = -m; }
            else if (side === 1) { x = w + m; y = Math.random() * h; }
            else if (side === 2) { x = Math.random() * w; y = h + m; }
            else { x = -m; y = Math.random() * h; }
            const cw = window.innerWidth / matrix.cols;
            const ch = window.innerHeight / matrix.rows;
            const cx = Math.max(0, Math.min(matrix.cols - 1, (x / cw) | 0));
            const cy = Math.max(0, Math.min(matrix.rows - 1, (y / ch) | 0));
            const bug = {
                el, x, y,
                cell: cy * matrix.cols + cx,
                dir: DIRS[(Math.random() * 8) | 0],
                nextTick: performance.now() + Math.random() * 300,
                _morphFrom: null, _dying: false
            };
            el.style.transform = `translate(${x}px, ${y}px) scale(1)`;
            el.style.transition = "none";
            bugs.push(bug);
        }

        function despawnBug(bug) {
            if (bug._dying) return;
            bug._dying = true;
            bug.el.style.transition = "transform 0.6s ease, opacity 0.6s ease";
            bug.el.style.opacity = "0";
            bug.el.style.transform = `translate(${bug.x}px, ${bug.y}px) scale(0.3)`;
            setTimeout(() => { if (bug.el.parentNode) bug.el.parentNode.removeChild(bug.el); }, 650);
        }

        // ---------- swell ----------
        function swell({ rect, targetCount, durationMs = 3500 }) {
            manualMode = true;
            phase = "swell";
            phaseStart = performance.now();
            const living = bugs.filter(b => !b._dying).length;
            const toSpawn = Math.max(0, targetCount - living);
            for (let i = 0; i < toSpawn; i++) spawnBugAtEdge();
            const now = performance.now();
            for (const bug of bugs) {
                if (bug._dying) continue;
                bug._swellTarget = {
                    x: rect.x + Math.random() * rect.w,
                    y: rect.y + Math.random() * rect.h
                };
                bug._swellFrom = { x: bug.x, y: bug.y };
                bug._swellStartTime = now + Math.random() * 800;
                bug._swellDuration = durationMs * (0.85 + Math.random() * 0.3);
                bug._swellHoverPhase = Math.random() * Math.PI * 2;
                bug.el.style.transition = "none";
            }
        }

        function swellStep(bug, now) {
            if (!bug._swellTarget) return;
            if (now < bug._swellStartTime) return;
            const elapsed = now - bug._swellStartTime;
            const t = Math.min(1, elapsed / bug._swellDuration);
            const e = easeInOutCubic(t);
            let x = bug._swellFrom.x + (bug._swellTarget.x - bug._swellFrom.x) * e;
            let y = bug._swellFrom.y + (bug._swellTarget.y - bug._swellFrom.y) * e;
            if (t > 0.85) {
                const jitter = (t - 0.85) / 0.15;
                x += Math.sin(now * 0.004 + bug._swellHoverPhase) * 4 * jitter;
                y += Math.cos(now * 0.005 + bug._swellHoverPhase) * 3 * jitter;
            }
            bug.x = x;
            bug.y = y;
            bug.el.style.transform = `translate(${bug.x}px, ${bug.y}px) scale(${1 + e * 0.15})`;
        }

        // ---------- morph ----------
        function morphToPoints(pixelTargets, { duration = 2500, onComplete = null } = {}) {
            if (!pixelTargets.length) return;
            const living = bugs.filter(b => !b._dying);
            const targetCount = pixelTargets.length;
            const diff = targetCount - living.length;

            if (diff > 0) {
                for (let i = 0; i < diff; i++) spawnBugAtEdge();
            } else if (diff < 0) {
                let killed = 0;
                for (let i = bugs.length - 1; i >= 0 && killed < -diff; i--) {
                    if (!bugs[i]._dying) { despawnBug(bugs[i]); killed++; }
                }
            }

            targets = pixelTargets.slice();

            const livingNow = bugs.filter(b => !b._dying);
            const n = livingNow.length, m = targets.length;
            const cost = new Array(n);
            for (let i = 0; i < n; i++) {
                const row = new Float64Array(m);
                const bx = livingNow[i].x, by = livingNow[i].y;
                for (let j = 0; j < m; j++) {
                    const dx = bx - targets[j].x, dy = by - targets[j].y;
                    row[j] = dx * dx + dy * dy;
                }
                cost[i] = row;
            }

            let assignment;
            if (n * m > 80000) {
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

            assignments = new Array(bugs.length).fill(-1);
            let idx = 0;
            for (let i = 0; i < bugs.length; i++) {
                if (bugs[i]._dying) continue;
                assignments[i] = assignment[idx]; idx++;
            }

            bugs.forEach(b => {
                if (!b._dying) {
                    b._morphFrom = null;
                    b.targetX = undefined;
                    b.targetY = undefined;
                    b._swellTarget = null;
                    b.el.style.transition = "none";
                }
            });

            currentMorphDuration = duration;
            morphCompleteCallback = onComplete;
            phase = "morph";
            phaseStart = performance.now();
        }

        // Append new targets without touching existing bugs.
        // New bugs spawn from edges and fly to the new points.
        function appendPoints(newTargets, { duration = 2500 } = {}) {
            if (!newTargets.length) return;

            const startTime = performance.now();
            const newBugs = [];

            for (let i = 0; i < newTargets.length; i++) {
                const el = makeBugElement(pick(opts.sprites));
                opts.container.appendChild(el);
                const w = window.innerWidth, h = window.innerHeight, margin = 60;
                const side = (Math.random() * 4) | 0;
                let sx, sy;
                if (side === 0) { sx = Math.random() * w; sy = -margin; }
                else if (side === 1) { sx = w + margin; sy = Math.random() * h; }
                else if (side === 2) { sx = Math.random() * w; sy = h + margin; }
                else { sx = -margin; sy = Math.random() * h; }

                const cw = window.innerWidth / matrix.cols;
                const ch = window.innerHeight / matrix.rows;
                const cx = Math.max(0, Math.min(matrix.cols - 1, (sx / cw) | 0));
                const cy = Math.max(0, Math.min(matrix.rows - 1, (sy / ch) | 0));

                const bug = {
                    el, x: sx, y: sy,
                    cell: cy * matrix.cols + cx,
                    dir: DIRS[(Math.random() * 8) | 0],
                    nextTick: performance.now(),
                    _morphFrom: null,
                    _dying: false,
                    _incomingTarget: newTargets[i],
                    _incomingStart: { x: sx, y: sy },
                    _incomingStartTime: startTime + Math.random() * 300
                };
                el.style.transform = `translate(${sx}px, ${sy}px) scale(1)`;
                el.style.transition = "none";
                bugs.push(bug);
                newBugs.push(bug);
            }

            incomingBugs = newBugs;
            incomingStart = startTime;
            incomingDur = duration;
            phase = "append";
            phaseStart = performance.now();
        }

        // ---------- phase transitions ----------
        function startMorph() {
            const layout = planLayout();
            if (!layout) { phase = "wander"; phaseStart = performance.now(); return; }
            const maxBugs = isMobile() ? opts.textCount.mobile : opts.textCount.desktop;
            const allTargets = buildTargets(layout, maxBugs);
            morphToPoints(allTargets, { duration: opts.cycleTimings.morph });
        }

        function updateMorph(now) {
            const dur = currentMorphDuration || opts.cycleTimings.morph;
            const t = Math.min(1, (now - phaseStart) / dur);
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
                bug.el.style.transform = `translate(${bug.x}px, ${bug.y}px) scale(1)`;
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
                if (morphCompleteCallback) {
                    const cb = morphCompleteCallback;
                    morphCompleteCallback = null;
                    cb();
                }
            }
        }

        let incomingBugs = null;

        function updateAppend(now) {
            for (const bug of bugs) {
                if (bug._dying) continue;
                if (bug._incomingTarget) {
                    if (now < bug._incomingStartTime) continue;
                    const elapsed = now - bug._incomingStartTime;
                    const t = Math.min(1, elapsed / incomingDur);
                    const e = easeInOutCubic(t);
                    bug.x = bug._incomingStart.x + (bug._incomingTarget.x - bug._incomingStart.x) * e;
                    bug.y = bug._incomingStart.y + (bug._incomingTarget.y - bug._incomingStart.y) * e;
                    bug.el.style.transform = `translate(${bug.x}px, ${bug.y}px) scale(1)`;
                    if (t >= 1) {
                        bug.targetX = bug._incomingTarget.x;
                        bug.targetY = bug._incomingTarget.y;
                        bug._vibPhaseX = Math.random() * Math.PI * 2;
                        bug._vibPhaseY = Math.random() * Math.PI * 2;
                        bug._vibFreqX = 0.04 + Math.random() * 0.025;
                        bug._vibFreqY = 0.045 + Math.random() * 0.025;
                        bug._vibAmp = 2.0 + Math.random() * 1.5;
                        bug._incomingTarget = null;
                    }
                } else if (bug.targetX !== undefined) {
                    vibrateStep(bug, now);
                }
            }
            const allDone = bugs.every(b => !b._incomingTarget);
            if (allDone) {
                phase = "hold";
                phaseStart = now;
            }
        }

        function vibrateStep(bug, now) {
            if (bug.targetX === undefined) return;
            bug.x = bug.targetX + Math.sin(now * bug._vibFreqX + bug._vibPhaseX) * bug._vibAmp;
            bug.y = bug.targetY + Math.cos(now * bug._vibFreqY + bug._vibPhaseY) * bug._vibAmp;
            bug.el.style.transform = `translate(${bug.x}px, ${bug.y}px) scale(1)`;
        }

        function resumeWander() {
            const targetCount = isMobile() ? opts.wanderCount.mobile : opts.wanderCount.desktop;
            const living = bugs.filter(b => !b._dying);
            const surplus = living.length - targetCount;
            if (surplus > 0) {
                let killed = 0;
                for (let i = bugs.length - 1; i >= 0 && killed < surplus; i--) {
                    if (!bugs[i]._dying) { despawnBug(bugs[i]); killed++; }
                }
            }
            const cw = window.innerWidth / matrix.cols;
            const ch = window.innerHeight / matrix.rows;
            bugs.forEach(bug => {
                if (bug._dying) return;
                delete bug.targetX; delete bug.targetY;
                bug._swellTarget = null;
                const cx = Math.max(0, Math.min(matrix.cols - 1, (bug.x / cw) | 0));
                const cy = Math.max(0, Math.min(matrix.rows - 1, (bug.y / ch) | 0));
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

        // ---------- main loop ----------
        function tick(now) {
            if (phase === "wander") {
                for (const bug of bugs) {
                    if (bug._dying) continue;
                    if (now >= bug.nextTick) {
                        stepBug(bug);
                        bug.nextTick = now + 220 + Math.random() * 180;
                    }
                }
                if (!manualMode && now - phaseStart > opts.cycleTimings.wander) {
                    morphCount = 0;
                    startMorph();
                }
            } else if (phase === "swell") {
                for (const bug of bugs) {
                    if (bug._dying) continue;
                    swellStep(bug, now);
                }
            } else if (phase === "morph") {
                updateMorph(now);
            } else if (phase === "append") {
                updateAppend(now);
            } else if (phase === "hold") {
                for (const bug of bugs) {
                    if (bug._dying) continue;
                    vibrateStep(bug, now);
                }
                if (!manualMode && now - phaseStart > opts.cycleTimings.hold) {
                    morphCount++;
                    if (morphCount < opts.morphsPerCycle) startMorph();
                    else resumeWander();
                }
            }
            rafId = requestAnimationFrame(tick);
        }

        function buildGrid() {
            const mobile = isMobile();
            const cols = mobile ? 14 : 26;
            const rows = mobile ? 12 : 16;
            matrix = buildTransitionMatrix(cols, rows);
        }

        function resnapToGrid() {
            const cw = window.innerWidth / matrix.cols;
            const ch = window.innerHeight / matrix.rows;
            bugs.forEach(bug => {
                if (bug._dying) return;
                const cx = Math.max(0, Math.min(matrix.cols - 1, (bug.x / cw) | 0));
                const cy = Math.max(0, Math.min(matrix.rows - 1, (bug.y / ch) | 0));
                bug.cell = cy * matrix.cols + cx;
            });
        }

        let resizeTimer = null;
        const onResize = () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => { buildGrid(); resnapToGrid(); }, 200);
        };

        return {
            start() {
                if (rafId) return;
                buildGrid();
                const count = isMobile() ? opts.wanderCount.mobile : opts.wanderCount.desktop;
                for (let i = 0; i < count; i++) spawnBug();
                phaseStart = performance.now();
                window.addEventListener("resize", onResize);
                rafId = requestAnimationFrame(tick);
            },
            stop() {
                if (rafId) cancelAnimationFrame(rafId);
                rafId = null;
                window.removeEventListener("resize", onResize);
                bugs.forEach(b => { if (b.el.parentNode) b.el.parentNode.removeChild(b.el); });
                bugs.length = 0;
            },
            setTexts(newTexts) {
                opts.texts = newTexts;
                textBag = [];
            },
            swell,
            morphToPoints,
            appendPoints,
            getHeartPoints,
            getILoveYouPoints,
            getWordsInRects,
            getBugCount() { return bugs.filter(b => !b._dying).length; }
        };
    }

    return { createSwarm };
})();