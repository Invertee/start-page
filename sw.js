const CACHE_NAME = 'start-page-static-v1';
const WEATHER_CACHE = 'start-page-weather-v1';
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/js/index.js',
    '/style/style.css',
    '/vendor/fa-all.min.css',
    '/vendor/moment.min.js',
    '/vendor/bulma/css/bulma.min.css',
    '/img/wp.jpg'
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
    if (req.method !== 'GET') return; // don't handle non-GET
    const url = new URL(req.url);

    // Network-first for the weather API so we update when online, but fallback to cache
    if (url.hostname.includes('api.met.no')) {
        event.respondWith(networkFirst(req));
        return;
    }

    // Cache-first for static assets
    event.respondWith(
        caches.match(req).then(cached => {
            if (cached) return cached;
            return fetch(req).then(res => {
                // only cache successful responses
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
            // Optionally notify clients that weather was cached
            const clients = await self.clients.matchAll();
            clients.forEach(c => c.postMessage({ type: 'WEATHER_CACHED', url }));
        }
    } catch (e) {
        // ignore failures
    }
}
