// admin.js — console d'administration JieePlay (V36).
//
// Restructuration demandée par le cahier des charges V36 : Dashboard,
// Joueurs (liste + fiche), Messages (inchangé dans sa logique), Paramètres
// + Outils, reliés par une vraie pile de navigation (History API), sur le
// modèle de js/nav.js côté jeu — même principe (push/replace/popstate),
// adapté à la structure à onglets de l'admin plutôt que réécrit.
//
// Ce qui N'A PAS changé depuis V35 (conservé tel quel, cf. cahier §13-14) :
// l'initialisation Firebase nommée, le cache local persistant, la logique
// d'envoi/réception/accusés/présence de la messagerie, chat-ui.js/css.

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-app.js";
import {
	getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
	collection, doc, addDoc, updateDoc, setDoc, deleteDoc, getDoc, getDocs, onSnapshot, query, orderBy, limit,
	serverTimestamp, increment, Timestamp, writeBatch,
} from "https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js";
import { getAuth, setPersistence, browserLocalPersistence, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-auth.js";
import { getMessaging, getToken, onMessage, isSupported } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-messaging.js";

const firebaseConfig = {
	apiKey: "AIzaSyCB_3NTZw4VKuYVtVNZuQF-7_dsqUol2VU",
	authDomain: "jieeplay-chat.firebaseapp.com",
	projectId: "jieeplay-chat",
	storageBucket: "jieeplay-chat.firebasestorage.app",
	messagingSenderId: "27387223575",
	appId: "1:27387223575:web:9c54f554d10635fbbcc652",
};
const VAPID_KEY = "BIKRIB42k6fIi3KSU896QL1zcNL8aabKwqYmKPrrxcTzICbham3Z2KAN78m_9arZn54APVHNyTVp_dvztN_uMow";
const CHAT_RETENTION_DAYS = 60;
const ADMIN_UID = "UD203dX0fRcwgnDu1mcSHL9KfBE2";

const app = initializeApp(firebaseConfig, "jieeplay-admin");
let db;
try { db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) }); }
catch (e) { db = getFirestore(app); }
const auth = getAuth(app);
setPersistence(auth, browserLocalPersistence).catch(() => {});

if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch((e) => console.warn("SW non enregistré", e));

const $ = (id) => document.getElementById(id);
const tsMs = (ts) => (!ts ? 0 : ts.toMillis ? ts.toMillis() : ts.toDate ? ts.toDate().getTime() : Number(ts) || 0);
const pad = (n) => String(n).padStart(2, "0");
const expireAt = () => Timestamp.fromDate(new Date(Date.now() + CHAT_RETENTION_DAYS * 86400000));
const HIDDEN_KEY = "tj_admin_hidden_v1";
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let ui = null, unsubList = null, unsubMsgs = null, hbTimer = null;
let convs = new Map(), currentId = null, msgs = [], search = "", playerSearch = "", playerFilter = "all";
const ackGuard = new Map(), typingVals = new Map(), presSeen = new Map();
let playerTypingUntil = 0, typingTimer = null, readInFlight = false;
let deepLinkPlayer = new URLSearchParams(location.search).get("c");

// ==================================================================== utilitaires
const loadHidden = () => { try { return new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY) || "[]")); } catch (e) { return new Set(); } };
const hideForMe = (id) => { const s = loadHidden(); s.add(id); localStorage.setItem(HIDDEN_KEY, JSON.stringify([...s])); };
const hash = (str) => { let x = 2166136261; for (let i = 0; i < str.length; i++) { x ^= str.charCodeAt(i); x = Math.imul(x, 16777619); } return x >>> 0; };
const threadVisible = () => AdminNav.section() === "messages" && !!currentId && document.visibilityState === "visible";

function fmtListTime(ms) {
	if (!ms) return "";
	const d = new Date(ms), now = new Date();
	const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
	const diff = Math.round((day(now) - day(d)) / 86400000);
	if (diff === 0) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
	if (diff === 1) return "Hier";
	return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
}
function fmtRelative(ms) {
	if (!ms) return "Non disponible";
	const s = Math.round((Date.now() - ms) / 1000);
	if (s < 60) return "à l'instant";
	if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
	if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`;
	const d = Math.floor(s / 86400);
	if (d < 7) return `il y a ${d} j`;
	return fmtListTime(ms);
}
function seenText(ms) {
	const d = new Date(ms);
	const same = d.toDateString() === new Date().toDateString();
	return same ? `vu à ${pad(d.getHours())}:${pad(d.getMinutes())}` : `vu le ${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
}
function paintAvatar(el, id, c) {
	el.className = "avatar";
	el.style.backgroundImage = ""; el.style.background = ""; el.textContent = "";
	if (c && c.playerAvatar) {
		el.style.backgroundImage = `url(assets/avatars/${c.playerAvatar}.png)`;
		el.style.backgroundColor = "#f6e9e6";
	} else {
		const hue = hash(id) % 360;
		el.style.background = `linear-gradient(135deg, hsl(${hue} 45% 52%), hsl(${(hue + 40) % 360} 50% 62%))`;
		el.textContent = ((c && c.playerName) || "?").trim().charAt(0).toUpperCase() || "?";
	}
}
function isOnline(c, id) {
	const v = tsMs(c.playerLastActiveAt);
	if (!v) return false;
	const prev = presSeen.get(id);
	if (!prev) { presSeen.set(id, { v, at: Date.now() - Math.max(0, Date.now() - v) }); return Date.now() - v < 150000; }
	if (prev.v !== v) { prev.v = v; prev.at = Date.now(); }
	return Date.now() - prev.at < 150000;
}
function unreadCount(c) { return Math.max(0, Number(c.unreadFromPlayer) || 0); }
function totalUnread() { let n = 0; convs.forEach((c) => (n += unreadCount(c))); return n; }

// ==================================================================== navigation (History API)
// Même principe que js/nav.js côté jeu : un pas = une entrée d'historique,
// popstate restaure l'écran correspondant. Adapté à la structure à onglets
// de l'admin plutôt que copié tel quel (l'admin n'a pas les mêmes écrans).
const AdminNav = {
	current: "dashboard",
	init() {
		history.replaceState({ step: "dashboard" }, "");
		window.addEventListener("popstate", (e) => this.applyStep((e.state && e.state.step) || "dashboard"));
	},
	push(step) { if (step === this.current) return; this.current = step; history.pushState({ step }, ""); this.applyStep(step); },
	replace(step) { this.current = step; history.replaceState({ step }, ""); this.applyStep(step); },
	back() { history.back(); },
	section() { return this.current.split(":")[0]; },
	param() { const i = this.current.indexOf(":"); return i === -1 ? null : this.current.slice(i + 1); },
	applyStep(step) {
		this.current = step;
		const section = this.section(), id = this.param();
		document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
		document.querySelectorAll(".rail-btn").forEach((b) => b.classList.toggle("active", b.dataset.section === section));
		$(`view-${section}`).classList.add("active");
		const threadOpen = section === "messages" && !!id;
		document.getElementById("view-messages").querySelector(".messages-split").classList.toggle("show-thread", threadOpen);
		// Sur mobile, un fil de conversation ouvert prend tout l'écran : le
		// rail de sections se cache (il n'a pas de sens sans le contexte de
		// la liste/fil affichée). Sans effet sur PC (le rail y reste visible,
		// voir la media query dans admin.css).
		$("app").classList.toggle("hide-rail", threadOpen);

		if (section === "dashboard") renderDashboard();
		else if (section === "players") renderPlayers();
		else if (section === "player") renderPlayerDetail(id);
		else if (section === "messages") { if (id) openConversation(id); else closeThread(); }
		else if (section === "settings") renderSettings();
	},
};

document.querySelectorAll(".rail-btn").forEach((btn) => {
	btn.addEventListener("click", () => AdminNav.push(btn.dataset.section));
});
document.querySelectorAll("[data-go]").forEach((btn) => btn.addEventListener("click", () => AdminNav.push(btn.dataset.go)));
$("quick-unread").addEventListener("click", () => { playerFilter = "unread"; AdminNav.push("players"); });
$("btn-player-back").addEventListener("click", () => AdminNav.back());
$("btn-thread-back").addEventListener("click", () => AdminNav.back());
$("btn-dash-refresh").addEventListener("click", () => { renderDashboard(); toast("Actualisé"); });

// ==================================================================== popovers / confirm
function closePop() { $("pop").classList.add("hidden"); $("pop").innerHTML = ""; }
function openPop(anchor, items) {
	const pop = $("pop");
	pop.innerHTML = "";
	items.forEach((it) => {
		const b = document.createElement("button");
		b.textContent = it.label;
		if (it.danger) b.className = "danger";
		b.addEventListener("click", () => { closePop(); it.fn(); });
		pop.appendChild(b);
	});
	pop.classList.remove("hidden");
	const r = anchor.getBoundingClientRect();
	pop.style.top = Math.min(window.innerHeight - pop.offsetHeight - 8, r.bottom + 6) + "px";
	pop.style.left = Math.max(8, Math.min(window.innerWidth - pop.offsetWidth - 8, r.right - pop.offsetWidth)) + "px";
}
document.addEventListener("click", (e) => { if (!$("pop").contains(e.target) && !e.target.closest(".bar-btn")) closePop(); });
function askConfirm(title, body, yes = "Supprimer") {
	return new Promise((resolve) => {
		$("confirm-title").textContent = title;
		$("confirm-body").textContent = body;
		$("confirm-yes").textContent = yes;
		$("confirm").classList.remove("hidden");
		const done = (v) => { $("confirm").classList.add("hidden"); $("confirm-yes").onclick = $("confirm-no").onclick = null; resolve(v); };
		$("confirm-yes").onclick = () => done(true);
		$("confirm-no").onclick = () => done(false);
	});
}
function toast(text) { ChatUI.toast(text); }

// ==================================================================== connexion
$("login-form").addEventListener("submit", async (e) => {
	e.preventDefault();
	const btn = $("btn-login");
	btn.disabled = true;
	$("login-error").classList.add("hidden");
	try { await signInWithEmailAndPassword(auth, $("login-email").value.trim(), $("login-password").value); }
	catch (err) { $("login-error").textContent = "Connexion refusée — vérifie l'email et le mot de passe."; $("login-error").classList.remove("hidden"); }
	btn.disabled = false;
});

onAuthStateChanged(auth, (user) => {
	$("boot").classList.add("hidden");
	if (user) showApp(user); else showLogin();
});

function showLogin() {
	$("app").classList.add("hidden");
	$("login").classList.remove("hidden");
	if (unsubList) { unsubList(); unsubList = null; }
	if (unsubMsgs) { unsubMsgs(); unsubMsgs = null; }
	clearInterval(hbTimer); hbTimer = null;
	currentId = null;
}
function showApp(user) {
	$("login").classList.add("hidden");
	$("app").classList.remove("hidden");
	$("set-email").textContent = user.email || "—";
	$("set-uid").textContent = user.uid;
	$("set-url").textContent = location.origin + location.pathname;
	if (!ui) initUI();
	AdminNav.init();
	listenConversations();
	startPresence();
	refreshNotifButton();
	window.addEventListener("online", () => { $("set-network").textContent = "En ligne"; });
	window.addEventListener("offline", () => { $("set-network").textContent = "Hors connexion"; toast("Hors connexion"); });
	$("set-network").textContent = navigator.onLine ? "En ligne" : "Hors connexion";
	navigator.serviceWorker && navigator.serviceWorker.getRegistration().then((r) => { $("set-sw").textContent = r ? "Actif" : "Absent"; });
}

// ==================================================================== interface messagerie (inchangé dans sa logique)
function initUI() {
	ui = ChatUI.mount($("thread-mount"), {
		me: "admin", lang: "fr", peerName: "", placeholder: "Répondre…",
		canDeleteForEveryone: () => true,
		onSendText: (text, reply) => sendMessage("text", text, {}, reply),
		onSendMedia: (type, data, extra, reply) => sendMessage(type, data, extra, reply),
		onDelete: onDeleteMessage,
		onTyping: () => { if (currentId) updateDoc(doc(db, "conversations", currentId), { adminTypingAt: Date.now() }).catch(() => {}); },
	});
	ChatUI.bindViewport($("app"));

	$("search").addEventListener("input", (e) => { search = e.target.value.trim().toLowerCase(); renderConvList(); });
	$("players-search").addEventListener("input", (e) => { playerSearch = e.target.value.trim().toLowerCase(); renderPlayers(); });
	$("btn-thread-menu").addEventListener("click", (e) => openPop(e.currentTarget, [
		{ label: "Voir la fiche joueur", fn: () => { if (currentId) AdminNav.push("player:" + currentId); } },
		{ label: "Supprimer le joueur", danger: true, fn: () => { if (currentId) confirmDeletePlayer(currentId); } },
	]));
	$("btn-notif-enable").addEventListener("click", enablePush);
	$("btn-notif-test").addEventListener("click", testPush);
	$("btn-signout").addEventListener("click", () => signOut(auth));
	$("btn-tool-refresh").addEventListener("click", () => { renderDashboard(); renderPlayers(); toast("Données actualisées"); });
	$("btn-tool-check").addEventListener("click", toolCheckFirebase);
	$("btn-tool-sw").addEventListener("click", toolCheckSW);
	$("btn-tool-purge").addEventListener("click", purgeInactive);
	document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { markRead(); beat(); } });

	const filters = [["all", "Tous"], ["unread", "Non lus"], ["online", "En ligne"], ["notif", "Notif. actives"], ["inactive", "Inactifs 7j"]];
	$("players-filters").innerHTML = filters.map(([k, l]) => `<button class="chip${k === playerFilter ? " active" : ""}" data-f="${k}">${l}</button>`).join("");
	$("players-filters").addEventListener("click", (e) => {
		const b = e.target.closest(".chip"); if (!b) return;
		playerFilter = b.dataset.f;
		$("players-filters").querySelectorAll(".chip").forEach((c) => c.classList.toggle("active", c === b));
		renderPlayers();
	});
}

function listenConversations() {
	if (unsubList) return;
	const q = query(collection(db, "conversations"), orderBy("lastMessageAt", "desc"));
	unsubList = onSnapshot(q, (snap) => {
		convs = new Map(snap.docs.map((d) => [d.id, d.data({ serverTimestamps: "estimate" })]));
		convs.forEach((c, id) => { ackDelivered(id, c); trackPlayerTyping(id, c); });
		const total = totalUnread();
		const badge = $("rail-badge-messages");
		badge.textContent = total > 99 ? "99+" : String(total);
		badge.classList.toggle("hidden", total === 0);
		document.title = (total ? `(${total}) ` : "") + "Tonton Jiee — Admin";

		if (AdminNav.section() === "dashboard") renderDashboard();
		if (AdminNav.section() === "players") renderPlayers();
		if (AdminNav.section() === "player") renderPlayerDetail(AdminNav.param());
		if (AdminNav.section() === "messages") { renderConvList(); if (currentId) { updateThreadHeader(); refreshThread(); markRead(); } }

		if (deepLinkPlayer && convs.has(deepLinkPlayer)) { const id = deepLinkPlayer; deepLinkPlayer = null; AdminNav.push("player:" + id); }
	}, (e) => console.error("Admin: conversations", e));
}

// ---------------- Dashboard ----------------
function renderDashboard() {
	const list = [...convs.entries()];
	$("kpi-players").textContent = list.length;
	$("kpi-active").textContent = list.filter(([id, c]) => Date.now() - tsMs(c.playerLastActiveAt) < 86400000).length;
	$("kpi-unread").textContent = totalUnread();

	const unread = list.filter(([, c]) => unreadCount(c) > 0).sort((a, b) => tsMs(b[1].lastMessageAt) - tsMs(a[1].lastMessageAt)).slice(0, 6);
	$("dash-unread-list").innerHTML = unread.length ? "" : `<div class="empty-note">Tout est à jour — aucune conversation en attente.</div>`;
	unread.forEach(([id, c]) => $("dash-unread-list").appendChild(miniRow(id, c, unreadCount(c) + " nouveau" + (unreadCount(c) > 1 ? "x" : ""), () => AdminNav.push("player:" + id))));

	const recent = list.slice().sort((a, b) => Math.max(tsMs(b[1].lastMessageAt), tsMs(b[1].playerLastActiveAt)) - Math.max(tsMs(a[1].lastMessageAt), tsMs(a[1].playerLastActiveAt))).slice(0, 8);
	$("dash-activity-list").innerHTML = recent.length ? "" : `<div class="empty-note">Aucune activité pour l'instant.</div>`;
	recent.forEach(([id, c]) => $("dash-activity-list").appendChild(miniRow(id, c, c.lastMessageFrom === "admin" ? "Vous : " + (c.lastMessagePreview || "") : (c.lastMessagePreview || "Nouvelle activité"), () => AdminNav.push("player:" + id), fmtRelative(Math.max(tsMs(c.lastMessageAt), tsMs(c.playerLastActiveAt))))));

	renderHealth();
}
function miniRow(id, c, sub, onClick, time) {
	const row = document.createElement("button");
	row.className = "mini-row";
	row.style.cssText = "border:0;background:transparent;width:100%;cursor:pointer;";
	const av = document.createElement("div"); paintAvatar(av, id, c);
	const main = document.createElement("div"); main.className = "mini-main";
	main.innerHTML = `<div class="mini-name"></div><div class="mini-sub"></div>`;
	main.querySelector(".mini-name").textContent = c.playerName || "Joueur sans nom";
	main.querySelector(".mini-sub").textContent = sub;
	row.append(av, main);
	if (time) { const t = document.createElement("span"); t.className = "mini-time"; t.textContent = time; row.appendChild(t); }
	row.addEventListener("click", onClick);
	return row;
}
async function renderHealth() {
	const rows = [
		["Firebase Authentication", auth.currentUser ? "ok" : "bad", auth.currentUser ? "Connecté" : "Déconnecté"],
		["Firestore", convs.size >= 0 && unsubList ? "ok" : "warn", unsubList ? "Synchronisé" : "En attente"],
		["Chat", "ok", "Opérationnel"],
		["Mode hors ligne", "ok", "Cache local actif"],
	];
	const swReg = await navigator.serviceWorker.getRegistration().catch(() => null);
	rows.push(["Service Worker", swReg ? "ok" : "bad", swReg ? "Actif" : "Absent"]);
	const pushSupported = await isSupported().catch(() => false);
	const permission = pushSupported && "Notification" in window ? Notification.permission : "unsupported";
	rows.push(["Notifications push", permission === "granted" ? "ok" : permission === "denied" ? "bad" : "warn",
		permission === "granted" ? "Activées" : permission === "denied" ? "Refusées" : "À vérifier"]);
	$("dash-health").innerHTML = rows.map(([label, state, txt]) =>
		`<div class="health-row"><span class="health-dot ${state}"></span><span class="health-label">${esc(label)}</span><span class="health-state">${esc(txt)}</span></div>`
	).join("");
}

// ---------------- Joueurs ----------------
function renderPlayers() {
	let list = [...convs.entries()];
	if (playerSearch) list = list.filter(([id, c]) => (c.playerName || "").toLowerCase().includes(playerSearch) || id.toLowerCase().includes(playerSearch));
	if (playerFilter === "unread") list = list.filter(([, c]) => unreadCount(c) > 0);
	else if (playerFilter === "online") list = list.filter(([id, c]) => isOnline(c, id));
	else if (playerFilter === "notif") list = list.filter(([, c]) => !!c.pushToken);
	else if (playerFilter === "inactive") list = list.filter(([, c]) => Date.now() - Math.max(tsMs(c.lastMessageAt), tsMs(c.playerLastActiveAt)) > 7 * 86400000);
	list.sort((a, b) => Math.max(tsMs(b[1].lastMessageAt), tsMs(b[1].playerLastActiveAt)) - Math.max(tsMs(a[1].lastMessageAt), tsMs(a[1].playerLastActiveAt)));

	$("players-count").textContent = convs.size ? `${list.length} / ${convs.size}` : "";
	const wrap = $("players-list");
	wrap.innerHTML = "";
	if (!list.length) { wrap.innerHTML = `<div class="empty-note">${convs.size ? "Aucun joueur ne correspond." : "Aucun joueur enregistré pour l'instant."}</div>`; return; }
	list.forEach(([id, c]) => {
		const row = document.createElement("button");
		row.className = "player-row";
		const av = document.createElement("div"); paintAvatar(av, id, c);
		const main = document.createElement("div"); main.className = "player-row-main";
		main.innerHTML = `<div class="player-row-name"></div><div class="player-row-sub"></div>`;
		main.querySelector(".player-row-name").textContent = c.playerName || "Joueur sans nom";
		main.querySelector(".player-row-sub").textContent = `${c.language === "en" ? "EN" : "FR"} · ${fmtRelative(Math.max(tsMs(c.lastMessageAt), tsMs(c.playerLastActiveAt)))}`;
		const badges = document.createElement("div"); badges.className = "player-row-badges";
		if (unreadCount(c) > 0) badges.innerHTML += `<span class="pill unread">${unreadCount(c)}</span>`;
		if (isOnline(c, id)) badges.innerHTML += `<span class="pill online">en ligne</span>`;
		else if (!c.pushToken) badges.innerHTML += `<span class="pill notif-off">sans notif.</span>`;
		row.append(av, main, badges);
		row.addEventListener("click", () => AdminNav.push("player:" + id));
		wrap.appendChild(row);
	});
}

// ---------------- Fiche joueur ----------------
function renderPlayerDetail(id) {
	const c = convs.get(id);
	const body = $("player-detail");
	if (!c) { body.innerHTML = `<div class="empty-note">Ce joueur n'existe plus.</div>`; $("player-view-title").textContent = "Joueur"; return; }
	$("player-view-title").textContent = c.playerName || "Joueur";
	const na = (v) => (v === undefined || v === null || v === "" ? "Non disponible" : v);
	body.innerHTML = "";
	const hero = document.createElement("div"); hero.className = "player-hero";
	const av = document.createElement("div"); paintAvatar(av, id, c);
	hero.appendChild(av);
	const h2 = document.createElement("h2"); h2.textContent = c.playerName || "Joueur sans nom";
	hero.appendChild(h2);
	body.appendChild(hero);

	const card = document.createElement("div"); card.className = "card";
	const rows = [
		["Langue", c.language === "en" ? "Anglais" : c.language === "fr" ? "Français" : na()],
		["UID", id],
		["Statut", isOnline(c, id) ? "En ligne" : "Hors ligne"],
		["Dernière activité", fmtRelative(tsMs(c.playerLastActiveAt))],
		["Dernier message", na(c.lastMessagePreview)],
		["Messages non lus", unreadCount(c) || "0"],
		["Notifications", c.pushToken ? "Activées" : "Non configurées"],
		["Accusé de réception", c.adminDeliveredAt ? fmtRelative(tsMs(c.adminDeliveredAt)) : "Non disponible"],
		["Accusé de lecture", c.adminReadAt ? fmtRelative(tsMs(c.adminReadAt)) : "Non disponible"],
		["Progression de jeu", "Non disponible (stockée localement chez le joueur)"],
	];
	card.innerHTML = `<div class="card-title">Informations</div>` + rows.map(([k, v]) => `<div class="kv"><span>${esc(k)}</span><span>${esc(v)}</span></div>`).join("");
	body.appendChild(card);

	const actions = document.createElement("div"); actions.className = "card";
	actions.innerHTML = `<div class="card-title">Actions</div>`;
	const btnConv = document.createElement("button"); btnConv.className = "ghost-btn"; btnConv.textContent = "Ouvrir la conversation";
	btnConv.addEventListener("click", () => AdminNav.push("messages:" + id));
	const btnDel = document.createElement("button"); btnDel.className = "danger-btn"; btnDel.textContent = "Supprimer le joueur";
	btnDel.addEventListener("click", () => confirmDeletePlayer(id));
	actions.append(btnConv, btnDel);
	body.appendChild(actions);
}

// ---------------- Messages : liste ----------------
function renderConvList() {
	const list = $("conv-list");
	list.innerHTML = "";
	let shown = 0;
	const names = new Map();
	convs.forEach((c) => names.set((c.playerName || "").toLowerCase(), (names.get((c.playerName || "").toLowerCase()) || 0) + 1));
	convs.forEach((c, id) => {
		const unread = unreadCount(c);
		const name = c.playerName || "Joueur sans nom";
		if (search && !name.toLowerCase().includes(search)) return;
		shown++;
		const b = document.createElement("button");
		b.className = "conv" + (id === currentId ? " active" : "") + (unread ? " unread" : "");
		const av = document.createElement("div"); paintAvatar(av, id, c); if (isOnline(c, id)) av.classList.add("dot-online");
		const main = document.createElement("div"); main.className = "conv-main";
		const dup = names.get((c.playerName || "").toLowerCase()) > 1 ? ` <small>#${id.slice(0, 4)}</small>` : "";
		main.innerHTML = `<div class="conv-top"><span class="conv-name"></span><span class="conv-time"></span></div><div class="conv-bottom"><span class="conv-preview"></span></div>`;
		main.querySelector(".conv-name").textContent = name;
		if (dup) main.querySelector(".conv-name").insertAdjacentHTML("beforeend", dup);
		main.querySelector(".conv-time").textContent = fmtListTime(tsMs(c.lastMessageAt));
		main.querySelector(".conv-preview").textContent = (c.lastMessageFrom === "admin" ? "Vous : " : "") + (c.lastMessagePreview || "");
		if (unread) { const bd = document.createElement("span"); bd.className = "badge"; bd.textContent = unread > 99 ? "99+" : String(unread); main.querySelector(".conv-bottom").appendChild(bd); }
		b.append(av, main);
		b.addEventListener("click", () => AdminNav.push("messages:" + id));
		list.appendChild(b);
	});
	if (!shown) list.innerHTML = `<div class="list-empty">${convs.size ? "Aucun résultat" : "Aucune conversation pour l'instant"}</div>`;
}

function openConversation(id) {
	if (!convs.has(id)) { closeThread(); return; }
	currentId = id;
	msgs = [];
	if (unsubMsgs) unsubMsgs();
	ui.resetView();
	ui.setMessages([]);
	$("thread-empty").classList.add("hidden");
	$("thread").classList.remove("hidden");
	updateThreadHeader();
	const q = query(collection(db, "conversations", id, "messages"), orderBy("timestamp", "desc"), limit(150));
	unsubMsgs = onSnapshot(q, (snap) => {
		msgs = snap.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }), pending: d.metadata.hasPendingWrites })).reverse();
		refreshThread(); markRead();
	}, (e) => console.error("Admin: messages", e));
	renderConvList(); markRead();
	setTimeout(() => window.matchMedia("(pointer: fine)").matches && ui.focusInput(), 50);
}
function closeThread() {
	currentId = null;
	if (unsubMsgs) { unsubMsgs(); unsubMsgs = null; }
	$("thread").classList.add("hidden");
	$("thread-empty").classList.remove("hidden");
	renderConvList();
}
function statusOf(m) {
	if (m.from !== "admin") return undefined;
	if (m.pending) return "pending";
	const c = convs.get(currentId) || {};
	const ms = tsMs(m.timestamp);
	if (m.read === true || (ms && ms <= tsMs(c.playerReadAt))) return "read";
	if (ms && ms <= tsMs(c.playerDeliveredAt)) return "delivered";
	return "sent";
}
function refreshThread() {
	if (!currentId) return;
	const hidden = loadHidden();
	ui.setMessages(msgs.filter((m) => !hidden.has(m.id)).map((m) => ({ ...m, status: statusOf(m) })));
	ui.setPeerTyping(Date.now() < playerTypingUntil);
	clearTimeout(typingTimer);
	if (Date.now() < playerTypingUntil) typingTimer = setTimeout(() => { updateThreadHeader(); refreshThread(); }, Math.max(200, playerTypingUntil - Date.now() + 50));
}
function updateThreadHeader() {
	const c = convs.get(currentId);
	if (!c) return;
	$("thread-name").textContent = c.playerName || "Joueur sans nom";
	paintAvatar($("thread-avatar"), currentId, c);
	ui.setPeerName(c.playerName || "Joueur");
	const st = $("thread-status");
	if (Date.now() < playerTypingUntil) { st.textContent = "écrit…"; st.className = "bar-status typing"; }
	else if (isOnline(c, currentId)) { st.textContent = "en ligne"; st.className = "bar-status online"; }
	else { const v = tsMs(c.playerLastActiveAt); st.textContent = v ? seenText(v) : ""; st.className = "bar-status"; }
}

// ---------------- accusés / présence ----------------
function ackDelivered(id, c) {
	if (c.lastMessageFrom !== "player") return;
	const last = tsMs(c.lastMessageAt);
	if (!last || ackGuard.get(id) === last || last <= tsMs(c.adminDeliveredAt)) return;
	ackGuard.set(id, last);
	updateDoc(doc(db, "conversations", id), { adminDeliveredAt: serverTimestamp() }).catch(() => {});
}
async function markRead() {
	if (!threadVisible() || readInFlight) return;
	const c = convs.get(currentId);
	if (!c) return;
	const unread = unreadCount(c) > 0;
	const last = tsMs(c.lastMessageAt);
	if (c.lastMessageFrom !== "player" && !unread) return;
	if (!unread && last && last <= tsMs(c.adminReadAt)) return;
	readInFlight = true;
	try { await updateDoc(doc(db, "conversations", currentId), { adminReadAt: serverTimestamp(), adminDeliveredAt: serverTimestamp(), unreadFromPlayer: 0 }); } catch (e) {}
	readInFlight = false;
}
function trackPlayerTyping(id, c) {
	const v = c.playerTypingAt || 0;
	const prev = typingVals.get(id);
	if (id === currentId) {
		if (prev === undefined) { if (v && Date.now() - v < 6000) playerTypingUntil = Date.now() + 5000; }
		else if (!v) playerTypingUntil = 0;
		else if (v !== prev) playerTypingUntil = Date.now() + 5000;
	}
	typingVals.set(id, v);
}
function beat() {
	if (!auth.currentUser || document.visibilityState !== "visible") return;
	setDoc(doc(db, "admin", "presence"), { lastActiveAt: serverTimestamp() }, { merge: true }).catch(() => {});
}
function startPresence() { beat(); clearInterval(hbTimer); hbTimer = setInterval(beat, 90000); }

// ---------------- envoi / suppression message ----------------
function sendMessage(type, content, extra, replyTo) {
	if (!currentId) return false;
	const id = currentId;
	const preview = type === "text" ? content.slice(0, 80) : type === "image" ? "📷" : "🎤";
	const msg = { from: "admin", type, content, timestamp: serverTimestamp(), expireAt: expireAt() };
	if (extra && extra.duration) msg.duration = extra.duration;
	if (replyTo) msg.replyTo = replyTo;
	Promise.all([
		addDoc(collection(db, "conversations", id, "messages"), msg),
		updateDoc(doc(db, "conversations", id), { lastMessageAt: serverTimestamp(), lastMessagePreview: preview, lastMessageFrom: "admin", unreadForPlayer: increment(1), adminTypingAt: 0, expireAt: expireAt() }),
	]).then(() => notifyPlayer(id, preview)).catch((e) => { console.error("Admin: envoi échoué", e); toast("Échec de l'envoi — réessaie."); });
	return true;
}
async function notifyPlayer(conversationId, body) {
	const url = window.JIEE_PUSH_RELAY_URL;
	if (!url || !auth.currentUser) return;
	try {
		const idToken = await auth.currentUser.getIdToken();
		fetch(url, { method: "POST", mode: "no-cors", keepalive: true, headers: { "Content-Type": "text/plain;charset=utf-8" },
			body: JSON.stringify({ idToken, kind: "toPlayer", conversationId, title: "Tonton Jiee", body }) }).catch(() => {});
	} catch (e) {}
}
async function onDeleteMessage(m, scope) {
	if (scope === "me") { hideForMe(m.id); refreshThread(); return; }
	try { await updateDoc(doc(db, "conversations", currentId, "messages", m.id), { deleted: true, content: "" }); }
	catch (e) { console.error("Admin: suppression échouée", e); toast("Suppression du message impossible — vérifie que les règles Firestore sont bien à jour."); }
}

// ---------------- suppression joueur (données de sa conversation) ----------------
async function deletePlayerData(id) {
	const col = collection(db, "conversations", id, "messages");
	try {
		for (;;) {
			const snap = await getDocs(query(col, limit(300)));
			if (snap.empty) break;
			const batch = writeBatch(db);
			snap.docs.forEach((d) => batch.delete(d.ref));
			await batch.commit();
		}
	} catch (e) {
		e.message = `[suppression des messages] ${e.message || e}`;
		throw e;
	}
	try {
		await deleteDoc(doc(db, "conversations", id));
	} catch (e) {
		e.message = `[suppression de la conversation] ${e.message || e}`;
		throw e;
	}
}
async function confirmDeletePlayer(id) {
	const c = convs.get(id) || {};
	const name = c.playerName || "ce joueur";
	const ok = await askConfirm(
		`Supprimer ${name} ?`,
		`Cette action supprime définitivement, côté serveur :\n· sa conversation et tous ses messages (texte, photos, audios)\n· ses accusés de lecture/réception\n\nAucun autre joueur n'est affecté. Il n'existe pas de compte à supprimer par ailleurs : ce joueur n'a pas de compte centralisé (une installation = un joueur, données de progression stockées uniquement sur son appareil).\n\nCette action est irréversible.`,
		"Supprimer le joueur"
	);
	if (!ok) return;
	try {
		await deletePlayerData(id);
		if (currentId === id) closeThread();
		toast(`${name} supprimé`);
		if (AdminNav.current === "player:" + id || AdminNav.current === "messages:" + id) AdminNav.back();
	} catch (e) {
		// Diagnostic (V37) : affiche le code Firestore réel au lieu d'un
		// message générique — ex. "permission-denied" signifie que les
		// règles n'ont pas été republiées ou qu'une des deux suppressions
		// (messages / document parent) n'est pas couverte ; un autre code
		// (ex. "unavailable") pointerait vers autre chose (réseau…).
		console.error("Admin: suppression joueur échouée", e);
		toast(`Suppression refusée : ${e.code || e.message || e}`);
	}
}
async function purgeInactive() {
	const raw = window.prompt("Supprimer les conversations sans aucune activité depuis combien de jours ?", "30");
	const days = parseInt(raw, 10);
	if (!raw || !(days >= 1)) return;
	const cutoff = Date.now() - days * 86400000;
	const victims = [...convs.entries()].filter(([, c]) => Math.max(tsMs(c.lastMessageAt), tsMs(c.playerLastActiveAt)) < cutoff);
	if (!victims.length) { $("tool-result").textContent = `Aucune conversation inactive depuis ${days} jours.`; return; }
	const ok = await askConfirm("Nettoyer la base ?", `${victims.length} conversation(s) sans activité depuis plus de ${days} jours seront supprimées :\n` + victims.slice(0, 8).map(([, c]) => "• " + (c.playerName || "sans nom")).join("\n") + (victims.length > 8 ? `\n… et ${victims.length - 8} autre(s)` : ""), "Tout supprimer");
	if (!ok) return;
	let n = 0;
	for (const [id] of victims) { try { await deletePlayerData(id); n++; if (currentId === id) closeThread(); } catch (e) { console.error(e); } }
	$("tool-result").textContent = `${n} conversation(s) supprimée(s).`;
	toast(`${n} conversation(s) supprimée(s)`);
}

// ==================================================================== Paramètres / diagnostic push
function renderSettings() {
	$("set-url").textContent = location.origin + location.pathname;
	$("set-network").textContent = navigator.onLine ? "En ligne" : "Hors connexion";
	refreshNotifButton();
	renderPushDiagnostic();
}

async function renderPushDiagnostic() {
	const grid = $("push-diagnostic");
	const rowHtml = (label, state, detail) =>
		`<div class="health-row"><span class="health-dot ${state}"></span><span class="health-label">${esc(label)}</span><span class="health-state">${esc(detail)}</span></div>`;
	const supported = await isSupported().catch(() => false);
	const permission = supported && "Notification" in window ? Notification.permission : "unsupported";
	let html = rowHtml("Permission navigateur", permission === "granted" ? "ok" : permission === "denied" ? "bad" : "warn",
		permission === "granted" ? "Autorisée" : permission === "denied" ? "Refusée" : permission === "unsupported" ? "Non supportée" : "Pas encore demandée");

	let localToken = null;
	try {
		if (permission === "granted" && supported) {
			const reg = await navigator.serviceWorker.ready;
			const messaging = getMessaging(app);
			localToken = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg }).catch(() => null);
		}
	} catch (e) {}
	html += rowHtml("Token FCM (cet appareil)", localToken ? "ok" : "unknown", localToken ? "Généré" : "Non généré");

	let fsToken = null;
	try { const snap = await getDoc(doc(db, "admin", "config")); fsToken = snap.exists() ? snap.data().pushToken : null; } catch (e) {}
	html += rowHtml("Token dans Firestore", fsToken ? "ok" : "warn", fsToken ? (fsToken === localToken ? "Enregistré (à jour)" : "Enregistré (ancien appareil ?)") : "Aucun");

	const relayUrl = window.JIEE_PUSH_RELAY_URL;
	let relayState = "unknown", relayDetail = "Non configuré";
	if (relayUrl) {
		try { const res = await fetch(relayUrl, { method: "GET", mode: "cors" }); relayState = res.ok ? "ok" : "bad"; relayDetail = res.ok ? "Accessible" : `HTTP ${res.status}`; }
		catch (e) { relayState = "warn"; relayDetail = "Accessible mais réponse non lisible (normal en no-cors) ou hors ligne"; }
	}
	html += rowHtml("Relais Apps Script", relayState, relayDetail);
	html += rowHtml("FCM", "unknown", "Vérifié uniquement par un test réel (bouton ci-dessous)");
	const swReg = await navigator.serviceWorker.getRegistration().catch(() => null);
	html += rowHtml("Service Worker", swReg ? "ok" : "bad", swReg ? "Prêt" : "Absent");

	grid.innerHTML = html;
}

async function refreshNotifButton() {
	const supported = await isSupported().catch(() => false);
	$("btn-notif-enable").textContent = supported && Notification.permission === "granted" ? "Notifications activées ✓" : "Activer les notifications";
}
async function enablePush() {
	try {
		if (!(await isSupported().catch(() => false))) { toast("Notifications non supportées sur ce navigateur."); return; }
		if ((await Notification.requestPermission()) !== "granted") { renderPushDiagnostic(); refreshNotifButton(); return; }
		const registration = await navigator.serviceWorker.ready;
		const messaging = getMessaging(app);
		const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: registration });
		if (!token) { toast("Impossible d'obtenir un token."); return; }
		await setDoc(doc(db, "admin", "config"), { pushToken: token, updatedAt: serverTimestamp() }, { merge: true });
		onMessage(messaging, (payload) => { const d = payload.data || {}; if (d.body) toast(`${d.title || ""} : ${d.body}`); });
		refreshNotifButton();
		renderPushDiagnostic();
		toast("Notifications activées");
	} catch (e) { console.error("Admin: notifications", e); toast("Activation impossible : " + e.message); }
}

/** Test de bout en bout réel (§32/80 du cahier) : passe par le VRAI relais et
 * la VRAIE chaîne FCM → Service Worker, pas seulement un ping HTTP. Le
 * résultat n'est marqué "reçue" que si la notification arrive réellement. */
async function testPush() {
const resultEl = $("push-test-result");

if (!window.JIEE_PUSH_RELAY_URL) {
	resultEl.textContent = "❌ Aucun relais configuré.";
	return;
}

if (Notification.permission !== "granted") {
	resultEl.textContent = "❌ Active d'abord les notifications.";
	return;
}

if (!auth.currentUser) {
	resultEl.textContent = "❌ Admin non authentifié.";
	return;
}

resultEl.textContent = "⏳ Envoi du test au relais…";

try {
	const messaging = getMessaging(app);

	const onMsg = (payload) => {
		console.log("FCM TEST reçu :", payload);

		if (payload.data && payload.data.tag === "tj-self-test") {
			resultEl.textContent = "✓ Notification FCM reçue de bout en bout.";
		}
	};

	onMessage(messaging, onMsg);

	const idToken = await auth.currentUser.getIdToken();

	const response = await fetch(window.JIEE_PUSH_RELAY_URL, {
		method: "POST",
		headers: {
			"Content-Type": "text/plain;charset=utf-8"
		},
		body: JSON.stringify({
			idToken,
			kind: "selfTest"
		})
	});

	const responseText = await response.text();

	resultEl.textContent =
		`Réponse du relais : HTTP ${response.status} — ${responseText.slice(0, 500)}`;

	console.log("RELAIS STATUS :", response.status);
	console.log("RELAIS RESPONSE :", responseText);

	setTimeout(() => {
		if (resultEl.textContent.startsWith("Réponse du relais")) {
			resultEl.textContent +=
				" | Aucun événement FCM reçu après 6 s.";
		}
	}, 6000);

} catch (e) {
	console.error("TEST PUSH ERROR :", e);

	resultEl.textContent =
		"⚠️ Le relais a peut-être reçu la requête, mais sa réponse est illisible depuis le navigateur : " +
		e.message;
}

}
async function toolCheckFirebase() {
	const el = $("tool-result");
	el.textContent = "Vérification…";
	try {
		await getDoc(doc(db, "admin", "config"));
		el.textContent = `✓ Firestore accessible. ${convs.size} conversation(s) chargée(s). Authentifié en tant que ${auth.currentUser.email}.`;
	} catch (e) { el.textContent = "✗ Erreur Firestore : " + e.message; }
}
async function toolCheckSW() {
	const el = $("tool-result");
	const reg = await navigator.serviceWorker.getRegistration().catch(() => null);
	el.textContent = reg ? `✓ Service Worker actif (portée : ${reg.scope}).` : "✗ Aucun Service Worker enregistré.";
}
