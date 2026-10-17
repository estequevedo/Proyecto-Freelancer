(() => {
    const loginView = document.querySelector('#login-view');
    const dashboardView = document.querySelector('#dashboard-view');
    const loginForm = document.querySelector('#login-form');
    const passwordInput = document.querySelector('#password');
    const loginError = document.querySelector('#login-error');
    const dashboardError = document.querySelector('#dashboard-error');
    const periodSelect = document.querySelector('#period');
    const analyzeButton = document.querySelector('#analyze-button');
    const insightsStatus = document.querySelector('#insights-status');
    const insightsError = document.querySelector('#insights-error');
    const insightsResult = document.querySelector('#insights-result');

    async function request(url, options = {}) {
        const response = await fetch(url, {
            credentials: 'same-origin',
            ...options,
            headers: {
                ...(options.body ? { 'Content-Type': 'application/json' } : {}),
                ...options.headers
            }
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            const error = new Error(result.error || 'No se pudo completar la solicitud.');
            error.status = response.status;
            throw error;
        }
        return result;
    }

    function setAuthenticated(authenticated) {
        loginView.hidden = authenticated;
        dashboardView.hidden = !authenticated;
        if (authenticated) loadAnalytics();
    }

    function renderList(elementId, items, emptyText, formatter = (item) => item.name) {
        const container = document.querySelector(`#${elementId}`);
        container.replaceChildren();
        if (!items.length) {
            const empty = document.createElement('p');
            empty.className = 'empty-state';
            empty.textContent = emptyText;
            container.append(empty);
            return;
        }
        for (const item of items) {
            const row = document.createElement('div');
            row.className = 'list-row';
            const name = document.createElement('span');
            name.textContent = formatter(item);
            const count = document.createElement('strong');
            count.textContent = new Intl.NumberFormat('es-AR').format(item.count);
            row.append(name, count);
            container.append(row);
        }
    }

    function renderRecent(items) {
        const body = document.querySelector('#recent-events');
        const empty = document.querySelector('#empty-recent');
        body.replaceChildren();
        empty.hidden = items.length > 0;
        for (const item of items) {
            const row = document.createElement('tr');
            const action = document.createElement('td');
            const page = document.createElement('td');
            const device = document.createElement('td');
            const time = document.createElement('td');
            action.textContent = item.type === 'page_view' ? 'Visita' : `Interacción: ${item.label || 'elemento'}`;
            page.textContent = item.path;
            device.textContent = item.device;
            time.textContent = new Intl.DateTimeFormat('es-AR', {
                dateStyle: 'short',
                timeStyle: 'short'
            }).format(new Date(item.at));
            row.append(action, page, device, time);
            body.append(row);
        }
    }

    async function loadAnalytics() {
        dashboardError.textContent = '';
        try {
            const data = await request(`/api/analytics?days=${encodeURIComponent(periodSelect.value)}`);
            document.querySelector('#page-views').textContent = new Intl.NumberFormat('es-AR').format(data.pageViews);
            document.querySelector('#interactions').textContent = new Intl.NumberFormat('es-AR').format(data.interactions);
            renderList('daily-list', data.daily, 'Sin visitas en este período.', (item) => {
                const date = new Date(`${item.date}T12:00:00`);
                return new Intl.DateTimeFormat('es-AR', { weekday: 'short', day: 'numeric', month: 'short' }).format(date);
            });
            renderList('pages-list', data.pages, 'Todavía no hay páginas visitadas.');
            renderList('sources-list', data.sources, 'Todavía no hay fuentes de tráfico.');
            renderList('devices-list', data.devices, 'Todavía no hay datos de dispositivos.');
            renderRecent(data.recent);
            document.querySelector('#updated-at').textContent = `Actualizado ${new Intl.DateTimeFormat('es-AR', { timeStyle: 'short' }).format(new Date())}`;
        } catch (error) {
            if (error.status === 401) {
                setAuthenticated(false);
                return;
            }
            dashboardError.textContent = error.message;
        }
    }

    async function analyzePeriod() {
        const selectedPeriod = periodSelect.value;
        analyzeButton.disabled = true;
        insightsError.textContent = '';
        insightsResult.textContent = '';
        insightsResult.hidden = true;
        insightsStatus.textContent = 'Analizando las estadísticas del período…';

        try {
            const data = await request('/api/analytics/insights', {
                method: 'POST',
                body: JSON.stringify({ days: Number(selectedPeriod) })
            });
            if (periodSelect.value === selectedPeriod) {
                insightsResult.textContent = data.recommendations;
                insightsResult.hidden = false;
                insightsStatus.textContent = `Análisis de los últimos ${selectedPeriod} días.`;
            }
        } catch (error) {
            if (error.status === 401) {
                setAuthenticated(false);
                return;
            }
            insightsStatus.textContent = '';
            insightsError.textContent = error.message;
        } finally {
            analyzeButton.disabled = false;
        }
    }

    loginForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        loginError.textContent = '';
        const submitButton = loginForm.querySelector('button[type="submit"]');
        submitButton.disabled = true;
        try {
            await request('/api/login', {
                method: 'POST',
                body: JSON.stringify({ password: passwordInput.value })
            });
            passwordInput.value = '';
            setAuthenticated(true);
        } catch (error) {
            loginError.textContent = error.message;
        } finally {
            submitButton.disabled = false;
        }
    });

    document.querySelector('#logout-button').addEventListener('click', async () => {
        try {
            await request('/api/logout', { method: 'POST', body: '{}' });
        } finally {
            setAuthenticated(false);
            passwordInput.focus();
        }
    });

    document.querySelector('#refresh-button').addEventListener('click', loadAnalytics);
    analyzeButton.addEventListener('click', analyzePeriod);
    periodSelect.addEventListener('change', () => {
        insightsResult.hidden = true;
        insightsResult.textContent = '';
        insightsError.textContent = '';
        insightsStatus.textContent = '';
        loadAnalytics();
    });

    request('/api/session')
        .then((session) => setAuthenticated(session.authenticated))
        .catch(() => {
            loginView.hidden = false;
            dashboardView.hidden = true;
            loginError.textContent = 'No se pudo conectar con el servidor. Inténtalo de nuevo.';
        });
})();
