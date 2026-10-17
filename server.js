'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const ROOT = __dirname;
const PORT = Number.parseInt(process.env.PORT || '3000', 10);
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const EVENTS_FILE = path.join(DATA_DIR, 'events.json');
const SESSION_COOKIE = 'eq_panel_session';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 8 * 1024;
const MAX_EVENTS = 50000;
const PASSWORD = process.env.ADMIN_PASSWORD || '';
const PASSWORD_SALT = 'esteban-quevedo-private-panel-v1';

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
    throw new Error('PORT debe ser un puerto válido.');
}
if (Buffer.byteLength(PASSWORD, 'utf8') < 16 || Buffer.byteLength(PASSWORD, 'utf8') > 1024) {
    throw new Error('Configura ADMIN_PASSWORD con entre 16 y 1024 bytes.');
}

const passwordDigest = crypto.scryptSync(PASSWORD, PASSWORD_SALT, 32);
const sessions = new Map();
const loginAttempts = new Map();
let events = [];
let writeQueue = Promise.resolve();

try {
    const saved = JSON.parse(fs.readFileSync(EVENTS_FILE, 'utf8'));
    if (Array.isArray(saved)) events = saved.slice(-MAX_EVENTS);
} catch (error) {
    if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) {
        throw error;
    }
}

const publicFiles = new Set([
    '/index.html',
    '/Proyecto1.html',
    '/Sobre.html',
    '/panel.html',
    '/style.css',
    '/Normalize.css',
    '/panel.css',
    '/panel.js',
    '/analytics.js'
]);
const contentTypes = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml'
};

function sendJson(response, status, body, extraHeaders = {}) {
    response.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        ...extraHeaders
    });
    response.end(JSON.stringify(body));
}

function getRequestPath(request) {
    try {
        return new URL(request.url, 'http://localhost').pathname;
    } catch {
        return null;
    }
}

function isValidOrigin(request) {
    const origin = request.headers.origin;
    const host = request.headers.host;
    if (typeof origin !== 'string' || typeof host !== 'string') return false;

    try {
        const parsedOrigin = new URL(origin);
        const forwardedProto = String(request.headers['x-forwarded-proto'] || '').split(',')[0].trim();
        const expectedProtocol = forwardedProto === 'https' || request.socket.encrypted ? 'https:' : 'http:';
        return parsedOrigin.origin === `${expectedProtocol}//${host}`;
    } catch {
        return false;
    }
}

function readJson(request) {
    return new Promise((resolve, reject) => {
        const contentType = String(request.headers['content-type'] || '').toLowerCase();
        if (!contentType.startsWith('application/json')) {
            const error = new Error('El formato de la solicitud no es válido.');
            error.status = 415;
            reject(error);
            return;
        }

        let size = 0;
        let tooLarge = false;
        const chunks = [];
        request.on('data', (chunk) => {
            size += chunk.length;
            if (size > MAX_BODY_BYTES) {
                tooLarge = true;
                return;
            }
            chunks.push(chunk);
        });
        request.on('error', reject);
        request.on('end', () => {
            if (tooLarge) {
                const error = new Error('La solicitud supera el tamaño permitido.');
                error.status = 413;
                reject(error);
                return;
            }
            try {
                const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
                if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                    throw new Error('El cuerpo debe ser un objeto JSON.');
                }
                resolve(parsed);
            } catch {
                const error = new Error('El cuerpo JSON no es válido.');
                error.status = 400;
                reject(error);
            }
        });
    });
}

function getSession(request) {
    const cookieHeader = request.headers.cookie || '';
    const cookie = cookieHeader.split(';').map((part) => part.trim())
        .find((part) => part.startsWith(`${SESSION_COOKIE}=`));
    if (!cookie) return null;

    const token = cookie.slice(SESSION_COOKIE.length + 1);
    const session = sessions.get(token);
    if (!session) return null;
    if (session.expiresAt <= Date.now()) {
        sessions.delete(token);
        return null;
    }
    return { token, session };
}

function setSessionCookie(request, token, maxAgeSeconds) {
    const secure = process.env.NODE_ENV === 'production'
        || String(request.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
    return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}${secure ? '; Secure' : ''}`;
}

function getLoginAttemptState(request) {
    const key = request.socket.remoteAddress || 'unknown';
    const now = Date.now();
    let state = loginAttempts.get(key);
    if (!state || now - state.startedAt >= 15 * 60 * 1000) {
        state = { startedAt: now, count: 0 };
        loginAttempts.set(key, state);
    }
    return { key, state };
}

function deviceFromUserAgent(userAgent) {
    const ua = String(userAgent || '').slice(0, 500);
    if (/ipad|tablet|kindle|silk/i.test(ua)) return 'Tablet';
    if (/mobile|iphone|ipod|android/i.test(ua)) return 'Móvil';
    return 'Escritorio';
}

function sourceFromReferrer(referrer, request) {
    if (typeof referrer !== 'string' || !referrer) return 'Directo';
    try {
        const referrerHost = new URL(referrer).hostname.toLowerCase();
        const ownHost = String(request.headers.host || '').split(':')[0].toLowerCase();
        if (!referrerHost || referrerHost === ownHost) return 'Directo';
        return referrerHost.slice(0, 120);
    } catch {
        return 'Directo';
    }
}

function persistEvents() {
    writeQueue = writeQueue.then(async () => {
        await fs.promises.mkdir(DATA_DIR, { recursive: true });
        const temporaryFile = `${EVENTS_FILE}.tmp`;
        await fs.promises.writeFile(temporaryFile, JSON.stringify(events), { mode: 0o600 });
        await fs.promises.rename(temporaryFile, EVENTS_FILE);
    });
    return writeQueue;
}

function addCount(map, key) {
    map.set(key, (map.get(key) || 0) + 1);
}

function sortedItems(map, name = 'name') {
    return [...map.entries()]
        .map(([value, count]) => ({ [name]: value, count }))
        .sort((a, b) => b.count - a.count || String(a[name]).localeCompare(String(b[name]), 'es'))
        .slice(0, 20);
}

function analyticsFor(days) {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const inRange = events.filter((event) => Date.parse(event.at) >= cutoff);
    const pageViews = inRange.filter((event) => event.type === 'page_view');
    const interactions = inRange.filter((event) => event.type === 'interaction');
    const daily = new Map();
    const pages = new Map();
    const sources = new Map();
    const devices = new Map();

    for (const event of pageViews) {
        const date = new Date(event.at).toISOString().slice(0, 10);
        addCount(daily, date);
        addCount(pages, event.path);
        addCount(sources, event.source || 'Directo');
        addCount(devices, event.device || 'Desconocido');
    }

    return {
        pageViews: pageViews.length,
        interactions: interactions.length,
        daily: [...daily.entries()].map(([date, count]) => ({ date, count })).sort((a, b) => a.date.localeCompare(b.date)),
        pages: sortedItems(pages),
        sources: sortedItems(sources),
        devices: sortedItems(devices),
        recent: inRange.slice(-100).reverse().map(({ at, type, path, device, label }) => ({ at, type, path, device, label }))
    };
}

async function generateRecommendations(analytics, days) {
    const apiKey = process.env.AI_GATEWAY_API_KEY;
    if (!apiKey) {
        const error = new Error('La función de IA no está configurada. El administrador debe agregar AI_GATEWAY_API_KEY en el entorno del servidor.');
        error.status = 503;
        throw error;
    }

    const model = process.env.AI_GATEWAY_MODEL || 'openai/gpt-4o-mini';
    const summary = {
        periodDays: days,
        pageViews: analytics.pageViews,
        interactions: analytics.interactions,
        dailyVisits: analytics.daily,
        topPages: analytics.pages.slice(0, 10),
        trafficSources: analytics.sources.slice(0, 10),
        devices: analytics.devices.slice(0, 10)
    };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
        const response = await fetch('https://ai-gateway.vercel.sh/v1/chat/completions', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            signal: controller.signal,
            body: JSON.stringify({
                model,
                temperature: 0.4,
                max_tokens: 700,
                messages: [
                    {
                        role: 'system',
                        content: 'Sos un analista de marketing digital para un sitio freelancer. Respondé en español rioplatense, con recomendaciones específicas, concretas y priorizadas para atraer más visitantes. Basate solo en las estadísticas proporcionadas; no inventes causas, datos ni resultados. Si hay pocos datos, aclaralo y sugerí qué medir. Considerá fuentes, páginas, dispositivos y tendencia diaria. Proponé entre 3 y 5 acciones ejecutables y explicá brevemente qué dato respalda cada una. No afirmes que las visitas representan usuarios únicos.'
                    },
                    {
                        role: 'user',
                        content: `Analizá estas estadísticas agregadas de los últimos ${days} días y recomendá acciones concretas para atraer más visitantes:\n${JSON.stringify(summary)}`
                    }
                ]
            })
        });

        if (!response.ok) {
            const error = new Error(response.status === 429
                ? 'AI Gateway alcanzó un límite de solicitudes. Esperá un momento y probá de nuevo.'
                : 'No se pudo obtener el análisis de AI Gateway. Revisá la clave y el modelo configurados.');
            error.status = response.status === 429 ? 429 : 502;
            throw error;
        }

        const result = await response.json();
        const content = result?.choices?.[0]?.message?.content;
        const recommendations = typeof content === 'string'
            ? content.trim()
            : Array.isArray(content)
                ? content.map((part) => typeof part?.text === 'string' ? part.text : '').join('\n').trim()
                : '';

        if (!recommendations) {
            const error = new Error('AI Gateway no devolvió recomendaciones. Probá de nuevo más tarde.');
            error.status = 502;
            throw error;
        }
        return recommendations.slice(0, 8000);
    } catch (error) {
        if (error.name === 'AbortError') {
            const timeoutError = new Error('El análisis tardó demasiado. Probá de nuevo.');
            timeoutError.status = 504;
            throw timeoutError;
        }
        throw error;
    } finally {
        clearTimeout(timeout);
    }
}

async function serveStatic(request, response, pathname) {
    const requestedPath = pathname === '/' ? '/index.html' : pathname;
    const isAsset = requestedPath.startsWith('/ultrax-assets/')
        && !requestedPath.includes('..')
        && !requestedPath.includes('\\');
    if (!publicFiles.has(requestedPath) && !isAsset) {
        sendJson(response, 404, { error: 'No se encontró la página solicitada.' });
        return;
    }

    const resolvedPath = path.resolve(ROOT, `.${requestedPath}`);
    if (!resolvedPath.startsWith(`${ROOT}${path.sep}`)) {
        sendJson(response, 404, { error: 'No se encontró la página solicitada.' });
        return;
    }

    try {
        const stat = await fs.promises.stat(resolvedPath);
        if (!stat.isFile()) throw new Error('Not a file');
        const extension = path.extname(resolvedPath).toLowerCase();
        const contentType = contentTypes[extension];
        if (!contentType) {
            sendJson(response, 404, { error: 'No se encontró la página solicitada.' });
            return;
        }
        response.writeHead(200, {
            'Content-Type': contentType,
            'Content-Length': stat.size,
            'X-Content-Type-Options': 'nosniff',
            'X-Frame-Options': 'DENY',
            'Referrer-Policy': 'strict-origin-when-cross-origin',
            'Cache-Control': requestedPath === '/panel.html' ? 'no-store' : 'no-cache'
        });
        fs.createReadStream(resolvedPath).pipe(response);
    } catch (error) {
        if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
            sendJson(response, 404, { error: 'No se encontró la página solicitada.' });
            return;
        }
        throw error;
    }
}

async function handleRequest(request, response) {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

    const pathname = getRequestPath(request);
    if (!pathname) {
        sendJson(response, 400, { error: 'La dirección solicitada no es válida.' });
        return;
    }

    if (pathname === '/healthz') {
        if (request.method !== 'GET') {
            sendJson(response, 405, { error: 'Método no permitido.' }, { Allow: 'GET' });
            return;
        }
        sendJson(response, 200, { status: 'ok' });
        return;
    }

    if (pathname === '/api/session') {
        if (request.method !== 'GET') {
            sendJson(response, 405, { error: 'Método no permitido.' }, { Allow: 'GET' });
            return;
        }
        sendJson(response, 200, { authenticated: Boolean(getSession(request)) });
        return;
    }

    if (pathname === '/api/login') {
        if (request.method !== 'POST') {
            sendJson(response, 405, { error: 'Método no permitido.' }, { Allow: 'POST' });
            return;
        }
        if (!isValidOrigin(request)) {
            sendJson(response, 403, { error: 'Origen de solicitud no válido.' });
            return;
        }
        const { key, state } = getLoginAttemptState(request);
        if (state.count >= 10) {
            sendJson(response, 429, { error: 'Demasiados intentos. Espera 15 minutos antes de volver a intentarlo.' });
            return;
        }
        const body = await readJson(request);
        const submittedPassword = typeof body.password === 'string' ? body.password : '';
        if (Buffer.byteLength(submittedPassword, 'utf8') > 1024) {
            state.count += 1;
            sendJson(response, 401, { error: 'La contraseña no es válida.' });
            return;
        }
        const submittedDigest = crypto.scryptSync(submittedPassword, PASSWORD_SALT, 32);
        if (!crypto.timingSafeEqual(passwordDigest, submittedDigest)) {
            state.count += 1;
            sendJson(response, 401, { error: 'La contraseña no es válida.' });
            return;
        }
        loginAttempts.delete(key);
        const token = crypto.randomBytes(32).toString('base64url');
        sessions.set(token, { expiresAt: Date.now() + SESSION_TTL_MS });
        sendJson(response, 200, { authenticated: true }, {
            'Set-Cookie': setSessionCookie(request, token, Math.floor(SESSION_TTL_MS / 1000))
        });
        return;
    }

    if (pathname === '/api/logout') {
        if (request.method !== 'POST') {
            sendJson(response, 405, { error: 'Método no permitido.' }, { Allow: 'POST' });
            return;
        }
        if (!isValidOrigin(request)) {
            sendJson(response, 403, { error: 'Origen de solicitud no válido.' });
            return;
        }
        const current = getSession(request);
        if (current) sessions.delete(current.token);
        sendJson(response, 200, { authenticated: false }, { 'Set-Cookie': setSessionCookie(request, '', 0) });
        return;
    }

    if (pathname === '/api/events') {
        if (request.method !== 'POST') {
            sendJson(response, 405, { error: 'Método no permitido.' }, { Allow: 'POST' });
            return;
        }
        if (!isValidOrigin(request)) {
            sendJson(response, 403, { error: 'Origen de solicitud no válido.' });
            return;
        }
        const body = await readJson(request);
        if (body.type !== 'page_view' && body.type !== 'interaction') {
            sendJson(response, 400, { error: 'El tipo de evento no es válido.' });
            return;
        }
        if (typeof body.path !== 'string' || !body.path.startsWith('/') || body.path.length > 300) {
            sendJson(response, 400, { error: 'La página del evento no es válida.' });
            return;
        }
        const event = {
            at: new Date().toISOString(),
            type: body.type,
            path: body.path.split(/[?#]/, 1)[0].slice(0, 200),
            device: deviceFromUserAgent(request.headers['user-agent'])
        };
        if (body.type === 'page_view') {
            event.source = sourceFromReferrer(body.referrer, request);
        } else {
            event.label = typeof body.label === 'string' ? body.label.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 100) : 'elemento';
        }
        events.push(event);
        if (events.length > MAX_EVENTS) events = events.slice(-MAX_EVENTS);
        await persistEvents();
        sendJson(response, 202, { recorded: true });
        return;
    }

    if (pathname === '/api/analytics/insights') {
        if (request.method !== 'POST') {
            sendJson(response, 405, { error: 'Método no permitido.' }, { Allow: 'POST' });
            return;
        }
        if (!isValidOrigin(request)) {
            sendJson(response, 403, { error: 'Origen de solicitud no válido.' });
            return;
        }
        if (!getSession(request)) {
            sendJson(response, 401, { error: 'Inicia sesión para consultar las estadísticas.' });
            return;
        }
        const body = await readJson(request);
        const days = Number(body.days);
        if (![7, 30, 90].includes(days)) {
            sendJson(response, 400, { error: 'El período seleccionado no es válido.' });
            return;
        }
        const recommendations = await generateRecommendations(analyticsFor(days), days);
        sendJson(response, 200, { recommendations });
        return;
    }

    if (pathname === '/api/analytics') {
        if (request.method !== 'GET') {
            sendJson(response, 405, { error: 'Método no permitido.' }, { Allow: 'GET' });
            return;
        }
        if (!getSession(request)) {
            sendJson(response, 401, { error: 'Inicia sesión para consultar las estadísticas.' });
            return;
        }
        const query = new URL(request.url, 'http://localhost').searchParams;
        const days = Number(query.get('days'));
        if (![7, 30, 90].includes(days)) {
            sendJson(response, 400, { error: 'El período seleccionado no es válido.' });
            return;
        }
        sendJson(response, 200, analyticsFor(days));
        return;
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
        sendJson(response, 405, { error: 'Método no permitido.' }, { Allow: 'GET, HEAD' });
        return;
    }
    await serveStatic(request, response, pathname);
}

const server = http.createServer((request, response) => {
    handleRequest(request, response).catch((error) => {
        if (response.headersSent) {
            response.destroy();
            return;
        }
        const status = Number.isInteger(error.status) ? error.status : 500;
        sendJson(response, status, {
            error: status === 500 ? 'No se pudo completar la solicitud.' : error.message
        });
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Sitio y panel disponibles en el puerto ${PORT}.`);
});

for (const timer of [
    setInterval(() => {
        const now = Date.now();
        for (const [token, session] of sessions) {
            if (session.expiresAt <= now) sessions.delete(token);
        }
        for (const [key, state] of loginAttempts) {
            if (now - state.startedAt >= 15 * 60 * 1000) loginAttempts.delete(key);
        }
    }, 60 * 60 * 1000)
]) {
    timer.unref();
}
