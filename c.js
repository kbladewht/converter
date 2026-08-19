/*! coi-serviceworker v0.1.7 - Guido Zuidhof, licensed under MIT */
(function() {
    if (typeof window === 'undefined') return;
    let needsReload = false;

    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./coi-serviceworker.js').then((reg) => {
            if (reg.active && !navigator.serviceWorker.controller) {
                needsReload = true;
            }
        }).catch(() => {});

        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (needsReload) {
                window.location.reload();
            }
        });
    }
})();