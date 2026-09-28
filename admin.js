// admin.js — application d'administration de la messagerie JieePlay (V35).
//
// Projet SÉPARÉ du jeu (autre dépôt, autre URL) : c'est ce qui permet de
// l'installer comme une application à part. L'interface de conversation vient
// de chat-ui.js, identique à celle du jeu.
//
// Session : l'app Firebase est NOMMÉE ("jieeplay-admin"). Firebase stocke la
// session de connexion par nom d'app ; sans ça, le jeu (qui se connecte en
// anonyme dans la même origine de navigateur) écrasait la session admin — c'est
// ce qui te déconnectait "trop vite".

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-app.js";
import {
	getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
	collection, doc, addDoc, updateDoc, setDoc, deleteDoc, getDocs, onSnapshot, query, orderBy, limit,
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

let ui = null, unsubList = null, unsubMsgs = null, hbTimer = null;
let convs = new Map(), currentId = null, msgs = [], search = "";
const ackGuard = new Map(), typingVals = new Map(), presSeen = new Map();
let playerTypingUntil = 0, typingTimer = null, readInFlight = false;
let pendingOpen = new URLSearchParams(location.search).get("c");

// ------------------------------------------------------------------ utilitaires
const loadHidden = () => { try { return new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY) || "[]")); } catch (e) { return new Set(); } };
const hideForMe = (id) => { const s = loadHidden(); s.add(id); localStorage.setItem(HIDDEN_KEY, JSON.stringify([...s])); };
const hash = (str) => { let x = 2166136261; for (let i = 0; i < str.length; i++) { x ^= str.charCodeAt(i); x = Math.imul(x, 16777619); } return x >>> 0; };
const threadVisible = () => !!currentId && document.visibilityState === "visible";

function fmtListTime(ms) {
	if (!ms) return "";
	const d = new Date(ms), now = new Date();
	const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
	const diff = Math.round((day(now) - day(d)) / 86400000);
	if (diff === 0) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
	if (diff === 1) return "Hier";
	return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
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

// ------------------------------------------------------------------ menus / confirmation
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

// ------------------------------------------------------------------ connexion
$("login-form").addEventListener("submit", async (e) => {
	e.preventDefault();
	const btn = $("btn-login");
	btn.disabled = true;
	$("login-error").classList.add("hidden");
	try {
		await signInWithEmailAndPassword(auth, $("login-email").value.trim(), $("login-password").value);
	} catch (err) {
		$("login-error").textContent = "Connexion refusée — vérifie l'email et le mot de passe.";
		$("login-error").classList.remove("hidden");
	}
	btn.disabled = false;
});

onAuthStateChanged(auth, (user) => {
	$("boot").classList.add("hidden");
	if (user) showApp(); else showLogin();
});

function showLogin() {
	$("app").classList.add("hidden");
	$("login").classList.remove("hidden");
	if (unsubList) { unsubList(); unsubList = null; }
	if (unsubMsgs) { unsubMsgs(); unsubMsgs = null; }
	clearInterval(hbTimer); hbTimer = null;
	currentId = null;
}

function showApp() {
	$("login").classList.add("hidden");
	$("app").classList.remove("hidden");
	if (!ui) initUI();
	listenConversations();
	startPresence();
	refreshNotifButton();
}

// ------------------------------------------------------------------ interface
function initUI() {
	ui = ChatUI.mount($("thread-mount"), {
		me: "admin", lang: "fr", peerName: "",
		placeholder: "Répondre…",
		canDeleteForEveryone: () => true, // l'admin peut retirer n'importe quel message (modération)
		onSendText: (text, reply) => sendMessage("text", text, {}, reply),
		onSendMedia: (type, data, extra, reply) => sendMessage(type, data, extra, reply),
		onDelete: onDeleteMessage,
		onTyping: () => { if (currentId) updateDoc(doc(db, "conversations", currentId), { adminTypingAt: Date.now() }).catch(() => {}); },
	});
	ChatUI.bindViewport($("app"));

	$("search").addEventListener("input", (e) => { search = e.target.value.trim().toLowerCase(); renderList(); });
	$("btn-thread-back").addEventListener("click", closeThread);
	$("btn-list-menu").addEventListener("click", (e) => openPop(e.currentTarget, [
		{ label: "Nettoyer : conversations inactives…", fn: purgeInactive },
		{ label: "Se déconnecter", fn: () => signOut(auth) },
	]));
	$("btn-thread-menu").addEventListener("click", (e) => openPop(e.currentTarget, [
		{ label: "Supprimer cette conversation", danger: true, fn: () => { if (currentId) confirmDeleteConversation(currentId); } },
	]));
	$("btn-notif").addEventListener("click", enablePush);
	document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { markRead(); beat(); } });
}

function listenConversations() {
	if (unsubList) return;
	const q = query(collection(db, "conversations"), orderBy("lastMessageAt", "desc"));
	unsubList = onSnapshot(q, (snap) => {
		convs = new Map(snap.docs.map((d) => [d.id, d.data({ serverTimestamps: "estimate" })]));
		convs.forEach((c, id) => { ackDelivered(id, c); trackPlayerTyping(id, c); });
		renderList();
		if (currentId) { updateThreadHeader(); refreshThread(); markRead(); }
		if (pendingOpen && convs.has(pendingOpen)) { openConversation(pendingOpen); pendingOpen = null; }
	}, (e) => console.error("Admin: conversations", e));
}

function renderList() {
	const list = $("conv-list");
	list.innerHTML = "";
	let total = 0, shown = 0;
	const names = new Map();
	convs.forEach((c) => names.set((c.playerName || "").toLowerCase(), (names.get((c.playerName || "").toLowerCase()) || 0) + 1));
	convs.forEach((c, id) => {
		const unread = Number(c.unreadFromPlayer) || 0;
		total += unread;
		const name = c.playerName || "Joueur sans nom";
		if (search && !name.toLowerCase().includes(search)) return;
		shown++;
		const b = document.createElement("button");
		b.className = "conv" + (id === currentId ? " active" : "") + (unread ? " unread" : "");
		b.dataset.id = id;
		const av = document.createElement("div");
		paintAvatar(av, id, c);
		if (isOnline(c, id)) av.classList.add("dot-online");
		const main = document.createElement("div");
		main.className = "conv-main";
		const dup = names.get((c.playerName || "").toLowerCase()) > 1 ? ` <small>#${id.slice(0, 4)}</small>` : "";
		main.innerHTML = `<div class="conv-top"><span class="conv-name"></span><span class="conv-time"></span></div><div class="conv-bottom"><span class="conv-preview"></span></div>`;
		main.querySelector(".conv-name").innerHTML = "";
		main.querySelector(".conv-name").textContent = name;
		if (dup) main.querySelector(".conv-name").insertAdjacentHTML("beforeend", dup);
		main.querySelector(".conv-time").textContent = fmtListTime(tsMs(c.lastMessageAt));
		main.querySelector(".conv-preview").textContent = (c.lastMessageFrom === "admin" ? "Vous : " : "") + (c.lastMessagePreview || "");
		if (unread) {
			const bd = document.createElement("span");
			bd.className = "badge"; bd.textContent = unread > 99 ? "99+" : String(unread);
			main.querySelector(".conv-bottom").appendChild(bd);
		}
		b.append(av, main);
		b.addEventListener("click", () => openConversation(id));
		list.appendChild(b);
	});
	if (!shown) list.innerHTML = `<div class="list-empty">${convs.size ? "Aucun résultat" : "Aucune conversation pour l'instant"}</div>`;
	document.title = (total ? `(${total}) ` : "") + "Tonton Jiee — Messagerie";
}

function openConversation(id) {
	if (!convs.has(id)) return;
	currentId = id;
	msgs = [];
	if (unsubMsgs) unsubMsgs();
	ui.resetView();
	ui.setMessages([]);
	$("thread-empty").classList.add("hidden");
	$("thread").classList.remove("hidden");
	$("app").classList.add("show-thread");
	updateThreadHeader();
	const q = query(collection(db, "conversations", id, "messages"), orderBy("timestamp", "desc"), limit(150));
	unsubMsgs = onSnapshot(q, (snap) => {
		msgs = snap.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }), pending: d.metadata.hasPendingWrites })).reverse();
		refreshThread();
		markRead();
	}, (e) => console.error("Admin: messages", e));
	renderList();
	markRead();
	setTimeout(() => ui.focusInput && window.matchMedia("(pointer: fine)").matches && ui.focusInput(), 50);
}

function closeThread() {
	currentId = null;
	if (unsubMsgs) { unsubMsgs(); unsubMsgs = null; }
	$("thread").classList.add("hidden");
	$("thread-empty").classList.remove("hidden");
	$("app").classList.remove("show-thread");
	renderList();
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

// ------------------------------------------------------------------ accusés / présence
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
	const unread = Number(c.unreadFromPlayer) > 0 || c.unreadFromPlayer === true;
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

// ------------------------------------------------------------------ envoi / suppression
function sendMessage(type, content, extra, replyTo) {
	if (!currentId) return false;
	const id = currentId;
	const preview = type === "text" ? content.slice(0, 80) : type === "image" ? "📷" : "🎤";
	const msg = { from: "admin", type, content, timestamp: serverTimestamp(), expireAt: expireAt() };
	if (extra && extra.duration) msg.duration = extra.duration;
	if (replyTo) msg.replyTo = replyTo;
	Promise.all([
		addDoc(collection(db, "conversations", id, "messages"), msg),
		updateDoc(doc(db, "conversations", id), {
			lastMessageAt: serverTimestamp(), lastMessagePreview: preview, lastMessageFrom: "admin",
			unreadForPlayer: increment(1), adminTypingAt: 0, expireAt: expireAt(),
		}),
	]).then(() => notifyPlayer(id, preview)).catch((e) => { console.error("Admin: envoi échoué", e); ChatUI.toast("Échec de l'envoi — réessaie."); });
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
	catch (e) { console.error("Admin: suppression échouée", e); ChatUI.toast("Suppression impossible."); }
}

async function deleteConversation(id) {
	const col = collection(db, "conversations", id, "messages");
	for (;;) {
		const snap = await getDocs(query(col, limit(300)));
		if (snap.empty) break;
		const batch = writeBatch(db);
		snap.docs.forEach((d) => batch.delete(d.ref));
		await batch.commit();
	}
	await deleteDoc(doc(db, "conversations", id));
}
async function confirmDeleteConversation(id) {
	const c = convs.get(id) || {};
	const ok = await askConfirm("Supprimer la conversation ?", `Tous les messages avec « ${c.playerName || "ce joueur"} » seront définitivement effacés de la base de données, chez lui comme chez toi.`);
	if (!ok) return;
	try {
		await deleteConversation(id);
		if (currentId === id) closeThread();
		ChatUI.toast("Conversation supprimée");
	} catch (e) { console.error(e); ChatUI.toast("Suppression impossible."); }
}

async function purgeInactive() {
	const raw = window.prompt("Supprimer les conversations sans aucune activité depuis combien de jours ?", "30");
	const days = parseInt(raw, 10);
	if (!raw || !(days >= 1)) return;
	const cutoff = Date.now() - days * 86400000;
	const victims = [...convs.entries()].filter(([, c]) => Math.max(tsMs(c.lastMessageAt), tsMs(c.playerLastActiveAt)) < cutoff);
	if (!victims.length) { ChatUI.toast(`Aucune conversation inactive depuis ${days} jours`); return; }
	const ok = await askConfirm("Nettoyer la base ?", `${victims.length} conversation(s) sans activité depuis plus de ${days} jours seront supprimées :\n` + victims.slice(0, 8).map(([, c]) => "• " + (c.playerName || "sans nom")).join("\n") + (victims.length > 8 ? `\n… et ${victims.length - 8} autre(s)` : ""), "Tout supprimer");
	if (!ok) return;
	let n = 0;
	for (const [id] of victims) { try { await deleteConversation(id); n++; if (currentId === id) closeThread(); } catch (e) { console.error(e); } }
	ChatUI.toast(`${n} conversation(s) supprimée(s)`);
}

// ------------------------------------------------------------------ notifications push
async function refreshNotifButton() {
	const btn = $("btn-notif");
	const ok = "Notification" in window && (await isSupported().catch(() => false));
	btn.classList.toggle("hidden", !ok);
	if (ok) btn.classList.toggle("active", Notification.permission === "granted");
}
async function enablePush() {
	try {
		if (!(await isSupported().catch(() => false))) { ChatUI.toast("Notifications non supportées ici."); return; }
		if ((await Notification.requestPermission()) !== "granted") { refreshNotifButton(); return; }
		const registration = await navigator.serviceWorker.ready;
		const messaging = getMessaging(app);
		const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: registration });
		if (!token) return;
		await setDoc(doc(db, "admin", "config"), { pushToken: token, updatedAt: serverTimestamp() }, { merge: true });
		onMessage(messaging, (payload) => { const d = payload.data || {}; if (d.body) ChatUI.toast(`${d.title || ""} : ${d.body}`); });
		refreshNotifButton();
		ChatUI.toast("Notifications activées");
	} catch (e) { console.error("Admin: notifications", e); ChatUI.toast("Activation impossible."); }
}
