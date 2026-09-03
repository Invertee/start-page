const CACHE_NAME = 'start-page-static-v4';
const WEATHER_CACHE = 'start-page-weather-v1';
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/js/index.js?v=2.2.0',
    '/js/podwaffle.js?v=2.2.0',
    '/style/style.css?v=2.2.0',
    '/vendor/fa-all.min.css',
    '/vendor/moment.min.js',
    '/vendor/bulma/css/bulma.min.css',
    '/img/wp.jpg',
    '/favicon.ico',
    '/webfonts/fa-regular-400.woff2',
    '/webfonts/fa-brands-400.woff2',
    '/webfonts/fa-solid-900.woff2',
    '/webfonts/fa-regular-400.ttf',
    '/webfonts/fa-brands-400.ttf',
    '/webfonts/fa-solid-900.ttf',
    '/webfonts/Lekton.ttf'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
    );
    self.skipWaiting();
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys => Promise.all(
            keys.map(key => {
                if (key !== CACHE_NAME && key !== WEATHER_CACHE) return caches.delete(key);
            })
        ))
    );
    self.clients.claim();
});

async function networkFirst(request) {
    try {
        const response = await fetch(request);
        if (response && response.ok) {
            const cache = await caches.open(WEATHER_CACHE);
            cache.put(request, response.clone());
        }
        return response;
    } catch (err) {
        const cached = await caches.match(request);
        if (cached) return cached;
        return new Response(null, { status: 503, statusText: 'Service Unavailable' });
    }
}

self.addEventListener('fetch', event => {
    const req = event.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);

    if (url.hostname.includes('api.met.no')) {
        event.respondWith(networkFirst(req));
        return;
    }

    if (url.origin !== self.location.origin) return;

    event.respondWith(
        caches.match(req).then(cached => {
            if (cached) return cached;
            return fetch(req).then(res => {
                if (!res || res.status !== 200 || res.type === 'opaque') return res;
                caches.open(CACHE_NAME).then(cache => cache.put(req, res.clone()));
                return res;
            }).catch(() => cached);
        })
    );
});

self.addEventListener('message', event => {
    const data = event.data;
    if (!data || !data.type) return;
    if (data.type === 'CACHE_WEATHER' && data.url) {
        fetchAndCacheWeather(data.url);
    }
});

async function fetchAndCacheWeather(url) {
    try {
        const resp = await fetch(url);
        if (resp && resp.ok) {
            const cache = await caches.open(WEATHER_CACHE);
            cache.put(url, resp.clone());
            const clients = await self.clients.matchAll();
            clients.forEach(c => c.postMessage({ type: 'WEATHER_CACHED', url }));
        }
    } catch (e) {
    }
}
