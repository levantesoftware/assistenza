/* Assistenza impianti - service worker
   Serve a far funzionare l'app anche senza connessione: i file dell'app e le librerie per i PDF
   vengono memorizzati sul dispositivo la prima volta che si apre l'app con la connessione.
   - la pagina (index.html) si prende SEMPRE dalla rete quando c'e' campo (cosi' gli aggiornamenti
     arrivano da soli); se la rete manca o e' troppo lenta si usa la copia memorizzata;
   - il resto (icone, librerie) si usa dalla copia memorizzata.
   Se aggiungi file nuovi all'app, cambia VERSIONE qui sotto e aggiungili all'elenco. */
const VERSIONE = 'v56';
const CACHE_APP = 'assistenza-app-' + VERSIONE;
const CACHE_RICEVUTI = 'assistenza-ricevuti';       // file arrivati dal menu Condividi di Android (per esempio da WhatsApp)
const FILE_APP = [
  './', './index.html', './manifest.webmanifest',
  './icona-192.png', './icona-512.png', './icona-maskable-512.png', './apple-touch-icon.png',
  './jspdf.umd.min.js', './pdf.min.js', './pdf.worker.min.js', './pdf-lib.min.js', './zxing.min.js'
];
const ATTESA_RETE_MS = 4000;

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE_APP);
    await c.addAll(FILE_APP);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const nome of await caches.keys()) if (nome.startsWith('assistenza-') && nome !== CACHE_APP && nome !== CACHE_RICEVUTI) await caches.delete(nome);
    await self.clients.claim();
  })());
});

async function paginaDallaRete(req) {
  const cache = await caches.open(CACHE_APP);
  // 'no-cache' = chiede sempre al server se la pagina e' cambiata (senza, il browser potrebbe riusare per alcuni minuti
  // una copia che ha gia' e l'aggiornamento arriverebbe in ritardo)
  const rete = fetch('./index.html', {cache: 'no-cache'}).then(r => { if (r && r.ok) cache.put('./index.html', r.clone()); return r; });
  try {
    return await Promise.race([rete, new Promise((_, ko) => setTimeout(() => ko(new Error('lenta')), ATTESA_RETE_MS))]);
  } catch (err) {
    const copia = await cache.match('./index.html', {ignoreSearch: true});
    if (copia) { rete.catch(() => {}); return copia; }
    return rete;
  }
}

async function dallaCopiaEPoiRete(req) {
  const cache = await caches.open(CACHE_APP);
  const copia = await cache.match(req, {ignoreSearch: true});
  const rete = fetch(req).then(r => { if (r && r.ok) cache.put(req, r.clone()); return r; }).catch(() => null);
  return copia || (await rete) || new Response('', {status: 504, statusText: 'Offline'});
}

/* Android: dal menu Condividi (per esempio da un file ricevuto su WhatsApp) il telefono manda il file all'app con una richiesta POST.
   Qui lo si mette da parte e si riapre l'app, che lo legge e carica i dati. Funziona anche senza connessione. */
async function riceviFile(req) {
  const vai = n => Response.redirect(new URL('./index.html?ricevuti=' + n, self.registration.scope).href, 303);
  try {
    const form = await req.formData();
    const files = form.getAll('file').filter(f => f && typeof f !== 'string');
    const cache = await caches.open(CACHE_RICEVUTI);
    for (const k of await cache.keys()) await cache.delete(k);
    for (let i = 0; i < files.length; i++) {
      await cache.put(new URL('./ricevuto-' + i, self.registration.scope).href,
        new Response(files[i], {headers: {'X-Nome': encodeURIComponent(files[i].name || 'dati.txt'), 'Content-Type': files[i].type || 'text/plain'}}));
    }
    return vai(files.length);
  } catch (err) { return vai(0); }
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method === 'POST' && new URL(req.url).origin === location.origin && /\/ricevi-file\/?$/.test(new URL(req.url).pathname)) { e.respondWith(riceviFile(req)); return; }
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;                     // niente servizi esterni: tutto e' dentro l'app
  if (/\/ultima\.(json|zip)$/.test(url.pathname)) return;           // servizio per l'ufficio: sempre dalla rete, mai dalla copia
  const èPagina = req.mode === 'navigate' || /\/(index\.html)?$/.test(url.pathname);
  // solo i file dell'app (pagina, librerie, icone) passano di qui: le richieste al servizio dell'ufficio (posta-file, posta-elenco,
  // servizio-stato, licenza-stato, backup...) vanno SEMPRE in rete, altrimenti si riceverebbe una copia vecchia (e con ignoreSearch
  // la stessa risposta per file diversi)
  const nomeFile = url.pathname.split('/').pop();
  if (!èPagina && !FILE_APP.some(f => f.replace(/^\.\//, '') === nomeFile)) return;
  e.respondWith(èPagina ? paginaDallaRete(req) : dallaCopiaEPoiRete(req));
});

self.addEventListener('message', e => { if (e.data === 'SKIP_WAITING') self.skipWaiting(); });
