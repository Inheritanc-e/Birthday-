window.CardScene = {
    id: "card",
    el: null,

    init(container) {
        this.el = container;
    },

    enter() {
        // TODO: envelope open, message reveal, confetti
        console.log("[card] entered");
    },

    exit() {
        // TODO: stop animations, clear confetti
    },

    shouldAdvance() { return false; }
};