(() => {
    const sendEvent = (event) => {
        const payload = JSON.stringify(event);
        if (navigator.sendBeacon) {
            const sent = navigator.sendBeacon('/api/events', new Blob([payload], { type: 'application/json' }));
            if (sent) return;
        }
        fetch('/api/events', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: payload,
            keepalive: true,
            credentials: 'same-origin'
        }).catch(() => {});
    };

    sendEvent({
        type: 'page_view',
        path: window.location.pathname,
        referrer: document.referrer
    });

    document.addEventListener('click', (event) => {
        const target = event.target instanceof Element ? event.target.closest('a, button') : null;
        if (!target || target.closest('form')) return;

        const label = target.getAttribute('aria-label')
            || target.getAttribute('data-analytics-label')
            || target.getAttribute('title')
            || target.tagName.toLowerCase();

        sendEvent({
            type: 'interaction',
            path: window.location.pathname,
            label
        });
    }, { capture: true });
})();
