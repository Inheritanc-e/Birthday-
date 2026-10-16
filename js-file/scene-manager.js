window.SceneManager = (function () {
    const scenes = new Map();
    let currentId = null;
    let busy = false;

    const wait = (ms) => new Promise(r => setTimeout(r, ms));

    function register(scene) {
        scenes.set(scene.id, scene);
    }

    async function goTo(id, { fadeMs = 900 } = {}) {
        if (busy || id === currentId) return;
        const next = scenes.get(id);
        if (!next) { console.warn("[scene] unknown scene:", id); return; }
        busy = true;

        const veil = document.getElementById("scene-transition-veil");

        if (fadeMs > 0) {
            veil.style.transitionDuration = `${fadeMs / 2}ms`;
            veil.classList.add("active");
            await wait(fadeMs / 2);
        }

        const prev = currentId ? scenes.get(currentId) : null;
        if (prev) {
            prev.el.classList.remove("active");
            await prev.exit?.();
        }

        next.el.classList.add("active");
        await next.enter?.();
        currentId = id;

        if (fadeMs > 0) {
            veil.classList.remove("active");
            await wait(fadeMs / 2);
        }

        busy = false;
    }

    function current() { return currentId; }

    return { register, goTo, current };
})();