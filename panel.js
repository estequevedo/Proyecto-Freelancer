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
    const exportStatus = document.querySelector('#export-status');
    const exportButtons = [
        document.querySelector('#export-excel-button'),
        document.querySelector('#export-sheets-button'),
        document.querySelector('#export-pdf-button')
    ];
    let currentAnalytics = null;
    let analyticsRequestId = 0;

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

    function setExportAvailability(available) {
        exportButtons.forEach((button) => {
            button.disabled = !available;
        });
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

    function formatEventDate(value) {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return String(value || '');
        return new Intl.DateTimeFormat('es-AR', {
            dateStyle: 'short',
            timeStyle: 'short'
        }).format(date);
    }

    function csvCell(value) {
        let text = String(value ?? '');
        if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
        return `"${text.replace(/"/g, '""')}"`;
    }

    function csvRows(data) {
        const period = `Últimos ${periodSelect.value} días`;
        const rows = [[
            'Sección', 'Período', 'Fecha', 'Elemento', 'Cantidad', 'Acción', 'Página', 'Dispositivo', 'Fecha y hora'
        ]];
        rows.push(['Resumen', period, '', 'Visitas a páginas', data.pageViews, '', '', '', '']);
        rows.push(['Resumen', period, '', 'Interacciones', data.interactions, '', '', '', '']);
        for (const item of data.daily) {
            rows.push(['Visitas por día', period, item.date, '', item.count, '', '', '', '']);
        }
        for (const item of data.pages) {
            rows.push(['Páginas visitadas', period, '', item.name, item.count, '', '', '', '']);
        }
        for (const item of data.sources) {
            rows.push(['Fuentes de tráfico', period, '', item.name, item.count, '', '', '', '']);
        }
        for (const item of data.devices) {
            rows.push(['Dispositivos', period, '', item.name, item.count, '', '', '', '']);
        }
        for (const item of data.recent) {
            rows.push([
                'Actividad reciente', period, '', '', '',
                item.type === 'page_view' ? 'Visita' : `Interacción: ${item.label || 'elemento'}`,
                item.path, item.device, formatEventDate(item.at)
            ]);
        }
        const recommendations = insightsResult.hidden ? '' : insightsResult.textContent.trim();
        if (recommendations) {
            rows.push(['Recomendaciones con IA', period, '', recommendations, '', '', '', '', '']);
        }
        return rows;
    }

    function downloadCsv(data, target) {
        const csv = `\uFEFF${csvRows(data).map((row) => row.map(csvCell).join(',')).join('\r\n')}`;
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        const date = new Date().toISOString().slice(0, 10);
        link.href = url;
        link.download = `resultados-analitica-${periodSelect.value}-dias-${date}-${target}.csv`;
        link.hidden = true;
        document.body.append(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        exportStatus.textContent = target === 'google-sheets'
            ? 'CSV descargado. En Google Sheets, usa Archivo > Importar > Subir para cargarlo.'
            : 'CSV descargado y listo para abrir en Excel.';
    }

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, (character) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        })[character]);
    }

    function reportTable(title, headers, rows) {
        const tableRows = rows.length
            ? rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')
            : `<tr><td colspan="${headers.length}">Sin datos en este período.</td></tr>`;
        return `<section><h2>${escapeHtml(title)}</h2><table><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead><tbody>${tableRows}</tbody></table></section>`;
    }

    function printReport(data) {
        const popup = window.open('', '_blank');
        if (!popup) {
            exportStatus.textContent = 'No se pudo abrir la ventana de impresión. Permite las ventanas emergentes e inténtalo de nuevo.';
            return;
        }
        popup.opener = null;
        const period = `Últimos ${periodSelect.value} días`;
        const number = (value) => new Intl.NumberFormat('es-AR').format(value);
        const daily = data.daily.map((item) => [item.date, number(item.count)]);
        const pages = data.pages.map((item) => [item.name, number(item.count)]);
        const sources = data.sources.map((item) => [item.name, number(item.count)]);
        const devices = data.devices.map((item) => [item.name, number(item.count)]);
        const recent = data.recent.map((item) => [
            item.type === 'page_view' ? 'Visita' : `Interacción: ${item.label || 'elemento'}`,
            item.path,
            item.device,
            formatEventDate(item.at)
        ]);
        const recommendations = insightsResult.hidden ? '' : insightsResult.textContent.trim();
        const recommendationSection = recommendations
            ? `<section><h2>Recomendaciones con IA</h2><p class="recommendations">${escapeHtml(recommendations)}</p></section>`
            : '';
        const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Resultados de analítica</title><style>
            *{box-sizing:border-box}body{margin:0;padding:32px;color:#19313a;font:14px Arial,sans-serif}h1{margin:0 0 8px;color:#173b46;font-size:25px}h2{margin:24px 0 10px;color:#25444c;font-size:17px}.meta{margin:0 0 18px;color:#63777e}.metrics{display:flex;gap:12px;margin:18px 0}.metric{min-width:180px;border:1px solid #d8e4e6;border-radius:8px;padding:12px}.metric span{display:block;color:#63777e;font-size:12px}.metric strong{display:block;margin-top:6px;color:#087e8b;font-size:22px}section{margin-top:18px;break-inside:avoid}table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #d8e4e6;padding:8px;text-align:left;overflow-wrap:anywhere}th{background:#e7f1f2;color:#25444c}tbody tr:nth-child(even){background:#f7fafa}.recommendations{white-space:pre-wrap;line-height:1.6}@media print{body{padding:0}section{break-inside:auto}tr{break-inside:avoid}h2{break-after:avoid}}
            </style></head><body><h1>Resultados de analítica</h1><p class="meta">Período: ${escapeHtml(period)} · Generado: ${escapeHtml(new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date()))}</p><div class="metrics"><div class="metric"><span>Visitas a páginas</span><strong>${escapeHtml(number(data.pageViews))}</strong></div><div class="metric"><span>Interacciones</span><strong>${escapeHtml(number(data.interactions))}</strong></div></div>${reportTable('Visitas por día', ['Fecha', 'Cantidad'], daily)}${reportTable('Páginas visitadas', ['Página', 'Cantidad'], pages)}${reportTable('Fuentes de tráfico', ['Fuente', 'Cantidad'], sources)}${reportTable('Dispositivos', ['Dispositivo', 'Cantidad'], devices)}${reportTable('Actividad reciente', ['Acción', 'Página', 'Dispositivo', 'Fecha y hora'], recent)}${recommendationSection}<script>window.addEventListener('load',()=>setTimeout(()=>window.print(),250));</script></body></html>`;
        popup.document.open();
        popup.document.write(html);
        popup.document.close();
        exportStatus.textContent = 'Se abrió la vista de impresión. Elige “Guardar como PDF” en las opciones de impresión.';
    }

    async function loadAnalytics() {
        const requestId = ++analyticsRequestId;
        const selectedPeriod = periodSelect.value;
        dashboardError.textContent = '';
        exportStatus.textContent = '';
        currentAnalytics = null;
        setExportAvailability(false);
        try {
            const data = await request(`/api/analytics?days=${encodeURIComponent(selectedPeriod)}`);
            if (requestId !== analyticsRequestId) return;
            currentAnalytics = data;
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
            setExportAvailability(true);
        } catch (error) {
            if (requestId !== analyticsRequestId) return;
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
            analyticsRequestId += 1;
            currentAnalytics = null;
            setExportAvailability(false);
            setAuthenticated(false);
            passwordInput.focus();
        }
    });

    document.querySelector('#refresh-button').addEventListener('click', loadAnalytics);
    document.querySelector('#export-excel-button').addEventListener('click', () => {
        if (currentAnalytics) downloadCsv(currentAnalytics, 'excel');
    });
    document.querySelector('#export-sheets-button').addEventListener('click', () => {
        if (currentAnalytics) downloadCsv(currentAnalytics, 'google-sheets');
    });
    document.querySelector('#export-pdf-button').addEventListener('click', () => {
        if (currentAnalytics) printReport(currentAnalytics);
    });
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
