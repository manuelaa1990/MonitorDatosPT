/*
 * Monitor HVAC — Service Worker
 * ---------------------------------------------------------------------------
 * Estrategia pensada para que la app instalada arranque siempre bien:
 *
 *  · Navegación (index.html, grafica.html, mollier.html): RED PRIMERO. Si hay
 *    internet se trae la versión nueva; si no, se sirve la copia guardada. Así
 *    nunca queda una versión vieja atrapada en caché.
 *  · Archivos propios (íconos, manifiesto): caché primero.
 *  · Bibliotecas externas (Plotly, Chart.js, CoolProp…): red primero y se
 *    guarda copia, de modo que al segundo arranque funcionan sin internet.
 *  · Supabase y el Worker: NO se tocan. Los datos en vivo jamás salen de caché.
 *
 * Al cambiar archivos de la app, subí el número de VERSION para forzar la
 * limpieza de la caché anterior.
 */
const VERSION = 'v16';
const CACHE = 'monitor-hvac-' + VERSION;

const SHELL = [
  './',
  './index.html',
  './grafica.html',
  './mollier.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png',
  './favicon-32.png'
];

self.addEventListener('install', evento => {
  evento.waitUntil(
    caches.open(CACHE)
      /* add() individual: si algún archivo no está publicado, el resto igual
         queda en caché y la instalación no falla. */
      .then(cache => Promise.all(SHELL.map(url => cache.add(url).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', evento => {
  evento.waitUntil(
    caches.keys()
      .then(claves => Promise.all(claves.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function guardar(request, respuesta) {
  if (!respuesta || !respuesta.ok) return;
  caches.open(CACHE).then(cache => cache.put(request, respuesta)).catch(() => {});
}

self.addEventListener('fetch', evento => {
  const request = evento.request;
  if (request.method !== 'GET') return;

  let url;
  try { url = new URL(request.url); } catch (e) { return; }

  /* Datos en vivo: siempre a la red, nunca desde caché */
  if (url.hostname.endsWith('supabase.co') || url.hostname.endsWith('workers.dev')) return;

  /* Navegación: red primero, caché como respaldo */
  if (request.mode === 'navigate') {
    evento.respondWith(
      fetch(request)
        .then(respuesta => { guardar(request, respuesta.clone()); return respuesta; })
        .catch(() => caches.match(request).then(copia => copia || caches.match('./index.html')))
    );
    return;
  }

  /* Archivos del propio sitio: caché primero */
  if (url.origin === self.location.origin) {
    evento.respondWith(
      caches.match(request).then(copia => copia || fetch(request).then(respuesta => {
        guardar(request, respuesta.clone());
        return respuesta;
      }))
    );
    return;
  }

  /* Bibliotecas externas: red primero y copia para la próxima vez */
  evento.respondWith(
    fetch(request)
      .then(respuesta => { guardar(request, respuesta.clone()); return respuesta; })
      .catch(() => caches.match(request))
  );
});
