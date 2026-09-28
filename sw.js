// Service worker de l'application admin (V35) — indépendant de celui du jeu :
// autre dépôt, autre portée, autre cache. Stratégie réseau d'abord (l'admin a
// besoin de données fraîches), avec repli sur le cache pour ouvrir l'app hors ligne.

importScripts("https://www.gstatic.com/firebasejs/12.13.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/12.13.0/firebase-messaging-compat.js");

firebase.initializeApp({
	apiKey: "AIzaSyCB_3NTZw4VKuYVtVNZuQF-7_dsqUol2VU",
	authDomain: "jieeplay-chat.firebaseapp.com",
	projectId: "jieeplay-chat",
	storageBucket: "jieeplay-chat.firebasestorage.app",
	messagingSenderId: "27387223575",
	appId: "1:27387223575:web:9c54f554d10635fbbcc652",
});

// Messages "data-only" envoyés par le relais push : on affiche nous-mêmes.
try {
	const messaging = firebase.messaging();
	messaging.onBackgroundMessage((payload) => {
		const d = payload.data || {};
		self.registration.showNotification(d.title || "Nouveau message", {
			body: d.body || "", icon: "./icons/icon-192.png", badge: "./icons/icon-192.png",
			tag: d.tag || "tj-admin", renotify: true, data: { url: d.url || "./" },
		});
	});
} catch (e) { console.warn("SW admin: messagerie indisponible", e); }

self.addEventListener("notificationclick", (event) => {
	event.notification.close();
	const target = new URL((event.notification.data && event.notification.data.url) || "./", self.registration.scope).href;
	event.waitUntil(
		self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
			for (const c of list) if (c.url.startsWith(self.registration.scope) && "focus" in c) return c.navigate(target).then((w) => (w || c).focus()).catch(() => c.focus());
			return self.clients.openWindow(target);
		})
	);
});

const CACHE = "tj-admin-v1";
const SHELL = ["./", "./index.html", "./admin.js", "./admin.css", "./chat-ui.js", "./chat-ui.css", "./push-config.js", "./manifest.json", "./icons/icon-192.png", "./icons/icon-512.png"];

self.addEventListener("install", (e) => {
	self.skipWaiting();
	e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
});
self.addEventListener("activate", (e) => {
	e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
	const req = e.request;
	if (req.method !== "GET" || !req.url.startsWith(self.registration.scope)) return;
	e.respondWith(
		fetch(req).then((res) => {
			if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
			return res;
		}).catch(() => caches.match(req).then((r) => r || (req.mode === "navigate" ? caches.match("./index.html") : undefined)))
	);
});
