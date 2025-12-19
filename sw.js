/**
 * Service Worker for Label Scanner PWA
 * Enables offline functionality
 */

const CACHE_NAME = 'label-scanner-v6';  // Added freestyle crop resize
const OFFLINE_URL = '/offline.html';

// Files to cache for offline use
const CACHE_URLS = [
    './',
    './index.html',
    './css/styles.css',
    './js/app.js',
    './js/storage.js',
    './js/parser.js',
    './js/ocr.js',
    './manifest.json'
];

// Tesseract.js files for offline OCR
const TESSERACT_URLS = [
    'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js',
    'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/worker.min.js'
];

// Install event - cache core files
self.addEventListener('install', event => {
    console.log('[SW] Installing...');
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('[SW] Caching core files');
                return cache.addAll(CACHE_URLS);
            })
            .then(() => {
                // Cache Tesseract files separately (may fail on first load)
                return caches.open(CACHE_NAME)
                    .then(cache => {
                        return Promise.allSettled(
                            TESSERACT_URLS.map(url => cache.add(url))
                        );
                    });
            })
            .then(() => self.skipWaiting())
    );
});

// Activate event - clean old caches
self.addEventListener('activate', event => {
    console.log('[SW] Activating...');
    event.waitUntil(
        caches.keys().then(keys => {
            return Promise.all(
                keys.filter(key => key !== CACHE_NAME)
                    .map(key => caches.delete(key))
            );
        }).then(() => self.clients.claim())
    );
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);

    // Skip non-GET requests
    if (event.request.method !== 'GET') {
        return;
    }

    // For same-origin requests, try cache first
    if (url.origin === location.origin) {
        event.respondWith(
            caches.match(event.request)
                .then(response => {
                    if (response) {
                        console.log('[SW] Serving from cache:', url.pathname);
                        return response;
                    }
                    return fetch(event.request)
                        .then(networkResponse => {
                            // Cache new resources
                            if (networkResponse.ok) {
                                const clone = networkResponse.clone();
                                caches.open(CACHE_NAME)
                                    .then(cache => cache.put(event.request, clone));
                            }
                            return networkResponse;
                        });
                })
                .catch(() => {
                    console.log('[SW] Offline, no cache for:', url.pathname);
                    return new Response('Offline', { status: 503 });
                })
        );
    } else {
        // For CDN resources (like Tesseract), try cache first
        event.respondWith(
            caches.match(event.request)
                .then(response => {
                    if (response) {
                        return response;
                    }
                    return fetch(event.request)
                        .then(networkResponse => {
                            if (networkResponse.ok) {
                                const clone = networkResponse.clone();
                                caches.open(CACHE_NAME)
                                    .then(cache => cache.put(event.request, clone));
                            }
                            return networkResponse;
                        });
                })
                .catch(() => {
                    return new Response('Offline', { status: 503 });
                })
        );
    }
});

// Handle messages from main thread
self.addEventListener('message', event => {
    if (event.data === 'skipWaiting') {
        self.skipWaiting();
    }
});
