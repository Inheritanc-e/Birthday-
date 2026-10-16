window.addEventListener("DOMContentLoaded", () => {
    const params = new URLSearchParams(location.search);

    SceneManager.register(CountdownScene);
    SceneManager.register(CardScene);

    CountdownScene.init(document.getElementById("scene-countdown"));
    CardScene.init(document.getElementById("scene-card"));

    // ===== AUDIO =====
    // Browsers block autoplay. Start the song on the user's first click
    // anywhere on the page.
    let songStarted = false;
    const startSong = () => {
        if (songStarted) return;
        songStarted = true;
        const song = document.getElementById("song");
        if (!song) { console.warn("[audio] #song element not found."); return; }
        song.volume = 0.4;
        song.play()
            .then(() => console.log("[audio] Song playing."))
            .catch(err => console.warn("[audio] Playback failed:", err));
    };
    document.addEventListener("click", startSong, { once: true });
    document.addEventListener("keydown", startSong, { once: true });
    document.addEventListener("touchstart", startSong, { once: true });

    const skip = params.get("skip");

    if (skip === "card") {
        console.log("[boot] TEST MODE. Skipping to card.");
        SceneManager.goTo("card", { fadeMs: 0 });
    } else {
        SceneManager.goTo("countdown", { fadeMs: 0 });
    }
});