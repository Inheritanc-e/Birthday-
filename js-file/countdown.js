window.CountdownScene = {
    id: "countdown",
    el: null,
    swarm: null,
    _interval: null,
    _swellStarted: false,
    _climaxStarted: false,

    init(container) {
        this.el = container;
        this.daysEl = container.querySelector("#days");
        this.hoursEl = container.querySelector("#hours");
        this.minutesEl = container.querySelector("#minutes");
        this.secondsEl = container.querySelector("#seconds");

        const params = new URLSearchParams(location.search);
        const targetOverride = params.get("target");

        if (targetOverride === null) {
            this.TARGET_DATE = new Date("2026-10-17T00:00:00+05:45").getTime();
            console.log("[countdown] PRODUCTION. Target:",
                new Date(this.TARGET_DATE).toString());
        } else if (targetOverride === "now") {
            this.TARGET_DATE = Date.now();
            console.log("[countdown] TEST MODE. Target = now.");
        } else {
            const seconds = parseFloat(targetOverride);
            if (isNaN(seconds)) {
                console.warn("[countdown] Invalid ?target value:", targetOverride);
                this.TARGET_DATE = new Date("2026-10-17T00:00:00+05:45").getTime();
            } else {
                this.TARGET_DATE = Date.now() + seconds * 1000;
                console.log(`[countdown] TEST MODE. Target = now + ${seconds}s →`,
                    new Date(this.TARGET_DATE).toString());
            }
        }
    },

    _update() {
        const distance = this.TARGET_DATE - Date.now();

        if (distance <= 4000 && distance > 0 && !this._swellStarted && this.swarm) {
            this._swellStarted = true;
            const timerRect = this.el.querySelector(".timer").getBoundingClientRect();
            const padX = timerRect.width * 0.35;
            const padY = timerRect.height * 0.60;
            const rect = {
                x: timerRect.left - padX,
                y: timerRect.top - padY,
                w: timerRect.width + padX * 2,
                h: timerRect.height + padY * 2
            };
            const isMob = window.matchMedia("(max-width: 600px)").matches;
            const target = isMob ? 220 : 450;
            console.log(`[countdown] Swell triggered. Target count: ${target}`);
            this.swarm.swell({ rect, targetCount: target, durationMs: 3500 });
        }

        if (distance <= 0) {
            this.daysEl.textContent = "00";
            this.hoursEl.textContent = "00";
            this.minutesEl.textContent = "00";
            this.secondsEl.textContent = "00";
            clearInterval(this._interval);
            this._interval = null;
            console.log("[countdown] Reached zero.");
            if (!this._climaxStarted) {
                this._climaxStarted = true;
                this._runClimax();
            }
            return true;
        }

        const d = Math.floor(distance / 86400000);
        const h = Math.floor((distance % 86400000) / 3600000);
        const m = Math.floor((distance % 3600000) / 60000);
        const s = Math.floor((distance % 60000) / 1000);
        this.daysEl.textContent = Utils.pad(d);
        this.hoursEl.textContent = Utils.pad(h);
        this.minutesEl.textContent = Utils.pad(m);
        this.secondsEl.textContent = Utils.pad(s);
        return false;
    },

    _runClimax() {
        const timerEl = this.el.querySelector(".timer");
        const swarm = this.swarm;

        const PTS = 400;

        const iLoveYouPts = swarm.getILoveYouPoints(PTS);

        const happyPts = swarm.getWordsInRects(
            ["Happy"],
            [{ x: 0.15, w: 0.70, y: 0.05, h: 0.27 }],
            PTS
        );

        const twentyPts = swarm.getWordsInRects(
            ["20th Birthday"],
            [{ x: 0.08, w: 0.84, y: 0.37, h: 0.24 }],
            PTS
        );

        const shubhangiPts = swarm.getWordsInRects(
            ["Shubhangi"],
            [{ x: 0.05, w: 0.90, y: 0.62, h: 0.34 }],
            PTS,
            { letterSpacing: 0.18 }
        );

        // t+0.6s: timer fades
        setTimeout(() => {
            timerEl.style.transition = "opacity 0.8s ease";
            timerEl.style.opacity = "0";
            console.log("[climax] Timer fading.");
        }, 600);

        // t+1.5s: timer hidden, bg2 fades in
        setTimeout(() => {
            timerEl.style.display = "none";
            const bg2 = document.getElementById("bg-2");
            if (bg2) bg2.classList.add("active");
            console.log("[climax] bg2 fading in.");
        }, 1500);

        // t+3.5s → I ♥ You
        setTimeout(() => {
            console.log(`[climax] I ♥ You — ${iLoveYouPts.length} pts.`);
            swarm.morphToPoints(iLoveYouPts, { duration: 2000 });
        }, 3500);

        // t+8s → Happy
        setTimeout(() => {
            console.log(`[climax] Happy — ${happyPts.length} pts.`);
            swarm.morphToPoints(happyPts, { duration: 2500 });
        }, 8000);

        // t+13.5s → append 20th Birthday
        setTimeout(() => {
            console.log(`[climax] Append 20th Birthday — ${twentyPts.length} pts.`);
            swarm.appendPoints(twentyPts, { duration: 2500 });
        }, 13500);

        // t+19s → append Shubhangi
        setTimeout(() => {
            console.log(`[climax] Append Shubhangi — ${shubhangiPts.length} pts.`);
            swarm.appendPoints(shubhangiPts, { duration: 2500 });
        }, 19000);

        // t+25s → open photo gallery, stop swarm
        setTimeout(() => {
            console.log("[climax] Opening photo gallery.");
            const gallery = document.getElementById("photo-gallery");
            if (gallery) gallery.classList.add("active");
            swarm.stop();
            this._runPhotoSequence();
        }, 25000);
    },

    _runPhotoSequence() {
        const PHOTOS = [
            "resources/transition-pics/DSC00044.jpg",
            "resources/transition-pics/IMG_1500.JPG",
            "resources/transition-pics/IMG_1779.JPG",
            "resources/transition-pics/IMG_2388.jpg",
            "resources/transition-pics/IMG_2662.jpg",
            "resources/transition-pics/IMG_2758.jpg",
            "resources/transition-pics/IMG_3600.jpg",
            "resources/transition-pics/IMG_3603.jpg",
            "resources/transition-pics/IMG_6211.jpg",
            "resources/transition-pics/IMG_6217.jpg",
            "dclassic.jpg",
            "resources/transition-pics/sh1.png",
            "resources/transition-pics/sh2.png",
            "resources/transition-pics/sh3.png",
            "resources/transition-pics/sh4.png"
        ];

        const HOLD_MS = 2200;
        const FADE_MS = 800;

        const imgEl = document.getElementById("photo-img");
        const finalEl = document.getElementById("photo-final");

        Promise.all(PHOTOS.map(src => new Promise(resolve => {
            const im = new Image();
            im.onload = resolve;
            im.onerror = resolve;
            im.src = src;
        }))).then(() => {
            console.log(`[gallery] Preloaded ${PHOTOS.length} photos.`);

            let idx = 0;

            const showNext = () => {
                if (idx >= PHOTOS.length) {
                    imgEl.classList.remove("visible");
                    setTimeout(() => {
                        finalEl.classList.add("active");
                        console.log("[gallery] Final text shown.");
                    }, FADE_MS);
                    return;
                }

                const src = PHOTOS[idx];
                imgEl.src = src;
                void imgEl.offsetWidth;
                imgEl.classList.add("visible");
                console.log(`[gallery] ${idx + 1}/${PHOTOS.length}: ${src}`);
                idx++;

                setTimeout(() => {
                    imgEl.classList.remove("visible");
                    setTimeout(showNext, FADE_MS);
                }, HOLD_MS);
            };

            setTimeout(showNext, 1000);
        });
    },

    async enter() {
        this._swellStarted = false;
        this._climaxStarted = false;

        const timerEl = this.el.querySelector(".timer");
        timerEl.style.display = "";
        timerEl.style.opacity = "";
        timerEl.style.transition = "";

        ["bg-2", "bg-3"].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.remove("active");
        });

        const gallery = document.getElementById("photo-gallery");
        const imgEl = document.getElementById("photo-img");
        const finalEl = document.getElementById("photo-final");
        if (gallery) gallery.classList.remove("active");
        if (imgEl) { imgEl.classList.remove("visible"); imgEl.removeAttribute("src"); }
        if (finalEl) finalEl.classList.remove("active");

        try {
            await document.fonts.load("700 220px 'Fuzzy Bubbles'");
            await document.fonts.ready;
            console.log("[countdown] Fuzzy Bubbles ready.");
        } catch (e) {
            console.warn("[countdown] Font load failed, using fallback.");
        }

        this._update();
        this._interval = setInterval(() => this._update(), 1000);

        this.swarm = Swarm.createSwarm({
            container: this.el.querySelector(".bug-layer"),
            sprites: [
                { src: "resources/bugs/butterfly2.png", type: "butterfly", size: [28, 40] },
                { src: "resources/bugs/butterfly4.png", type: "butterfly", size: [30, 42] },
                { src: "resources/bugs/butterfly6.png", type: "butterfly", size: [26, 36] },
                { src: "resources/bugs/shebug.png", type: "butterfly", size: [34, 46] }
            ],
            wanderCount: { desktop: 18, mobile: 10 },
            textCount: { desktop: 130, mobile: 65 },
            morphsPerCycle: 3,
            cycleTimings: { wander: 5000, morph: 2500, hold: 15000 },
            texts: [
                "HAPPY BIRTHDAY", "I LOVE YOU", "MY LOVE", "MY DEAR",
                "SHUBHANGI", "I LOVE YOU", "MY DEAREST PRINCESS",
                "20 YEAR OLD GRANNY", "THE BIG 20", "20", "I LOVE YOU SHUBHANGI"
            ]
        });
        this.swarm.start();
    },

    async exit() {
        if (this._interval) clearInterval(this._interval);
        this._interval = null;
        this.swarm?.stop();
        this.swarm = null;
    },

    shouldAdvance() {
        return Date.now() >= this.TARGET_DATE;
    }
};