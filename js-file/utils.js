window.Utils = (function () {
    const DIRS = [
        [-1, -1], [0, -1], [1, -1],
        [-1, 0], [1, 0],
        [-1, 1], [0, 1], [1, 1]
    ];

    const pad = (n) => String(n).padStart(2, "0");
    const rand = (min, max) => Math.random() * (max - min) + min;
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
    const isMobile = () => window.matchMedia("(max-width: 600px)").matches;

    const easeInOutCubic = (t) =>
        t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

    function shuffle(arr) {
        const a = arr.slice();
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    }

    function permutations(arr, k) {
        const result = [];
        const used = new Array(arr.length).fill(false);
        const current = [];
        (function recurse() {
            if (current.length === k) { result.push(current.slice()); return; }
            for (let i = 0; i < arr.length; i++) {
                if (used[i]) continue;
                used[i] = true;
                current.push(arr[i]);
                recurse();
                current.pop();
                used[i] = false;
            }
        })();
        return result;
    }

    // Horizontal zones proportional to each word's natural width.
    // Returns an array of { x, w, y, h } in normalized (0..1) coords.
    function proportionalRects(words, {
        x0 = 0.03, x1 = 0.97, gap = 0.04,
        y = 0.38, h = 0.24
    } = {}) {
        const mctx = document.createElement("canvas").getContext("2d");
        mctx.font = `700 200px 'Fuzzy Bubbles', cursive`;
        const ws = words.map(w => mctx.measureText(w).width);
        const total = ws.reduce((a, b) => a + b, 0);
        const usable = (x1 - x0) - gap * (words.length - 1);
        let x = x0;
        return ws.map(w => {
            const rw = usable * w / total;
            const r = { x, w: rw, y, h };
            x += rw + gap;
            return r;
        });
    }

    return {
        DIRS, pad, rand, pick, isMobile, easeInOutCubic, shuffle, permutations,
        proportionalRects
    };
})();