// 버전 문자열을 바꾸면 이전 캐시가 정리됨
const CACHE_NAME = "my-sns-v1";

const APP_FILES = [
  "./",
  "./index.html",
  "./style.css",
  "./config.js",
  "./drive.js",
  "./app.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_FILES))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// 내 사이트 파일만 처리. Google 로그인/Drive API 요청은 건드리지 않음.
// 네트워크 우선: 온라인이면 항상 최신 파일, 오프라인일 때만 캐시 사용.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  if (new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        return res;
      })
      .catch(() => caches.match(req))
  );
});
