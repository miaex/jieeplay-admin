// chat-ui.js — interface de conversation partagée (V35).
//
// Utilisée À L'IDENTIQUE par l'app joueur (js/chat.js) et par le panneau
// admin (projet jieeplay_admin) : bulles, messages vocaux, images, réponses,
// suppression, saisie multi-lignes, enregistrement vocal, barre qui suit le
// clavier. Ce fichier ne connaît PAS Firebase : les deux applications lui
// passent des messages et des callbacks (onSendText, onSendMedia, onDelete…).
// Ainsi un même comportement est garanti des deux côtés, et il n'y a qu'un
// seul endroit à corriger quand il y a un bug.

const ChatUI = (() => {
	"use strict";

	const STR = {
		fr: {
			today: "Aujourd'hui", yesterday: "Hier", deleted: "Message supprimé", you: "Toi",
			reply: "Répondre", copy: "Copier", copied: "Copié", replying: "Réponse à",
			delForMe: "Supprimer pour moi", delForAll: "Supprimer pour tout le monde",
			confirmTitle: "Supprimer pour tout le monde ?", confirmBody: "Ce message disparaîtra chez tout le monde.",
			cancel: "Annuler", confirm: "Supprimer", photo: "Photo", voice: "Message vocal",
			placeholder: "Écris ton message…", camera: "Prendre une photo", gallery: "Choisir depuis la galerie",
			recording: "Enregistrement", attach: "Joindre", send: "Envoyer", record: "Message vocal", options: "Options",
			audioUnsupported: "Les messages vocaux ne sont pas pris en charge sur cet appareil.",
			audioDenied: "L'accès au micro a été refusé. Autorise-le dans les réglages du navigateur.",
			audioTooLong: "Ce message vocal est trop long pour être envoyé.",
			imageFail: "Impossible de lire cette image.", scrollDown: "Aller au dernier message",
		},
		en: {
			today: "Today", yesterday: "Yesterday", deleted: "Message deleted", you: "You",
			reply: "Reply", copy: "Copy", copied: "Copied", replying: "Replying to",
			delForMe: "Delete for me", delForAll: "Delete for everyone",
			confirmTitle: "Delete for everyone?", confirmBody: "This message will disappear for everyone.",
			cancel: "Cancel", confirm: "Delete", photo: "Photo", voice: "Voice message",
			placeholder: "Type your message…", camera: "Take a photo", gallery: "Choose from gallery",
			recording: "Recording", attach: "Attach", send: "Send", record: "Voice message", options: "Options",
			audioUnsupported: "Voice messages aren't supported on this device.",
			audioDenied: "Microphone access was denied. Enable it in your browser settings.",
			audioTooLong: "This voice message is too long to send.",
			imageFail: "Couldn't read this image.", scrollDown: "Go to latest message",
		},
	};

	const ICON = {
		play: '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none"/></svg>',
		pause: '<svg viewBox="0 0 24 24"><path d="M7 5h3.6v14H7zM13.4 5H17v14h-3.6z" fill="currentColor" stroke="none"/></svg>',
		plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
		mic: '<svg viewBox="0 0 24 24"><rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3"/></svg>',
		send: '<svg viewBox="0 0 24 24"><path d="M4 12 20 4l-4.5 16-3.5-6.5z" fill="currentColor" stroke="none"/></svg>',
		trash: '<svg viewBox="0 0 24 24"><path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v6M14 11v6"/></svg>',
		down: '<svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>',
		reply: '<svg viewBox="0 0 24 24"><path d="M10 6 4 12l6 6M4 12h10a6 6 0 0 1 6 6v1"/></svg>',
		copy: '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="11" height="12" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/></svg>',
		camera: '<svg viewBox="0 0 24 24"><path d="M4 8h3l1.5-2h7L17 8h3v11H4Z"/><circle cx="12" cy="13.5" r="3.2"/></svg>',
		gallery: '<svg viewBox="0 0 24 24"><rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 15.5 8 11l3 3 4-4.5 5.5 6"/><circle cx="8" cy="8.5" r="1.3" fill="currentColor" stroke="none"/></svg>',
		close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
		ban: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="m6 6 12 12"/></svg>',
		check: '<svg viewBox="0 0 16 11"><path d="M1.5 5.8 5 9.3 11.8 1.6"/></svg>',
		check2: '<svg viewBox="0 0 20 11"><path d="M1.5 5.8 5 9.3 11.8 1.6"/><path d="M7.6 8.8l.7.7L15.4 1.6"/></svg>',
		clock: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/><path d="M8 4.5V8l2.4 1.4"/></svg>',
		chev: '<svg viewBox="0 0 24 24"><path d="m7 10 5 5 5-5"/></svg>',
	};

	let currentAudio = null;
	let sharedToastEl = null;

	const h = (tag, cls, html) => {
		const e = document.createElement(tag);
		if (cls) e.className = cls;
		if (html !== undefined) e.innerHTML = html;
		return e;
	};
	const S = (inst, key) => (STR[inst.lang] || STR.fr)[key];
	const isCoarse = () => window.matchMedia && window.matchMedia("(pointer: coarse)").matches;

	function toDate(ts) {
		if (!ts) return new Date();
		if (typeof ts.toDate === "function") return ts.toDate();
		if (ts instanceof Date) return ts;
		return new Date(ts);
	}
	const pad = (n) => String(n).padStart(2, "0");
	const fmtTime = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
	function fmtDur(ms) {
		const s = Math.max(0, Math.round((ms || 0) / 1000));
		return `${Math.floor(s / 60)}:${pad(s % 60)}`;
	}
	function dayLabel(inst, d) {
		const now = new Date();
		const start = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
		const diff = Math.round((start(now) - start(d)) / 86400000);
		if (diff === 0) return S(inst, "today");
		if (diff === 1) return S(inst, "yesterday");
		return d.toLocaleDateString(inst.lang === "en" ? "en-US" : "fr-FR", { day: "numeric", month: "long", year: diff > 300 ? "numeric" : undefined });
	}
	function hash(str) {
		let x = 2166136261;
		for (let i = 0; i < str.length; i++) { x ^= str.charCodeAt(i); x = Math.imul(x, 16777619); }
		return x >>> 0;
	}
	function preview(inst, m) {
		if (m.type === "image") return "📷 " + S(inst, "photo");
		if (m.type === "audio") return "🎤 " + S(inst, "voice");
		return (m.content || "").slice(0, 90);
	}

	function toast(text) {
		if (!sharedToastEl) {
			sharedToastEl = h("div", "cu-toast");
			document.body.appendChild(sharedToastEl);
		}
		sharedToastEl.textContent = text;
		sharedToastEl.classList.add("show");
		clearTimeout(sharedToastEl._t);
		sharedToastEl._t = setTimeout(() => sharedToastEl.classList.remove("show"), 2600);
	}

	function syncChildren(parent, desired) {
		const keep = new Set(desired);
		Array.from(parent.children).forEach((c) => { if (!keep.has(c)) parent.removeChild(c); });
		let ref = parent.firstChild;
		desired.forEach((node) => {
			if (node === ref) ref = ref.nextSibling;
			else parent.insertBefore(node, ref);
		});
	}

	/** Suit le clavier virtuel : l'élément garde exactement la taille de la
	 * zone réellement visible. L'en-tête reste en haut, la zone de messages
	 * se rétrécit, et la barre de saisie se pose juste au-dessus du clavier. */
	function bindViewport(el) {
		const vv = window.visualViewport;
		if (!vv) return () => {};
		const apply = () => {
			const full = Math.abs(vv.height - window.innerHeight) < 2 && vv.offsetTop < 1;
			if (full) { el.style.top = ""; el.style.height = ""; el.style.bottom = ""; }
			else { el.style.top = vv.offsetTop + "px"; el.style.height = vv.height + "px"; el.style.bottom = "auto"; }
		};
		vv.addEventListener("resize", apply);
		vv.addEventListener("scroll", apply);
		apply();
		return () => {
			vv.removeEventListener("resize", apply);
			vv.removeEventListener("scroll", apply);
			el.style.top = ""; el.style.height = ""; el.style.bottom = "";
		};
	}

	function pickMime() {
		if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported) return "";
		return ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find((m) => MediaRecorder.isTypeSupported(m)) || "";
	}

	function compressImage(file, cb, onFail) {
		const reader = new FileReader();
		reader.onerror = onFail;
		reader.onload = () => {
			const img = new Image();
			img.onerror = onFail;
			img.onload = () => {
				const attempts = [[1000, 0.72], [800, 0.6], [640, 0.5], [480, 0.4]];
				let out = "";
				for (const [max, q] of attempts) {
					let w = img.width, hgt = img.height;
					if (w > hgt && w > max) { hgt = Math.round(hgt * max / w); w = max; }
					else if (hgt >= w && hgt > max) { w = Math.round(w * max / hgt); hgt = max; }
					const c = document.createElement("canvas");
					c.width = w; c.height = hgt;
					c.getContext("2d").drawImage(img, 0, 0, w, hgt);
					out = c.toDataURL("image/jpeg", q);
					if (out.length < 850000) break;
				}
				cb(out);
			};
			img.src = reader.result;
		};
		reader.readAsDataURL(file);
	}

	// ------------------------------------------------------------------
	function mount(root, opts) {
		const inst = {
			root, opts, lang: opts.lang === "en" ? "en" : "fr",
			messages: [], nodes: new Map(), fps: new Map(), seps: new Map(),
			byId: new Map(), typing: false, rendered: false, stick: true,
			newCount: 0, replyTo: null, rec: null, introText: "", noticeText: "", peerName: opts.peerName || "",
			lastTypingPing: 0,
		};
		const t = (k) => S(inst, k);

		root.classList.add("cu-root");
		root.innerHTML = "";
		const list = h("div", "cu-messages");
		const notice = h("div", "cu-notice hidden");
		const fab = h("button", "cu-fab hidden", ICON.down + '<span class="cu-fab-count hidden"></span>');
		fab.setAttribute("aria-label", t("scrollDown"));
		const bottom = h("div", "cu-bottom");
		const replyBar = h("div", "cu-replybar hidden");
		const composer = h("div", "cu-composer");
		const attachBtn = h("button", "cu-circle cu-attach", ICON.plus);
		attachBtn.setAttribute("aria-label", t("attach"));
		const wrap = h("div", "cu-inputwrap");
		const ta = h("textarea", "cu-input");
		ta.rows = 1;
		ta.placeholder = opts.placeholder || t("placeholder");
		ta.setAttribute("enterkeyhint", "enter");
		ta.setAttribute("autocomplete", "off");
		ta.setAttribute("autocapitalize", "sentences");
		wrap.appendChild(ta);
		const actionBtn = h("button", "cu-circle cu-action", ICON.mic);
		composer.append(attachBtn, wrap, actionBtn);
		const recBar = h("div", "cu-recbar hidden");
		recBar.innerHTML = `<button class="cu-circle cu-rec-cancel" aria-label="${t("cancel")}">${ICON.trash}</button>
			<div class="cu-rec-info"><i class="cu-rec-dot"></i><span class="cu-rec-time">0:00</span><span class="cu-rec-wave"><b></b><b></b><b></b><b></b><b></b><b></b><b></b><b></b><b></b></span></div>
			<button class="cu-circle cu-rec-send" aria-label="${t("send")}">${ICON.send}</button>`;
		const attachMenu = h("div", "cu-attachmenu hidden");
		attachMenu.innerHTML = `<button data-k="camera">${ICON.camera}<span>${t("camera")}</span></button><button data-k="gallery">${ICON.gallery}<span>${t("gallery")}</span></button>`;
		const camInput = h("input"); camInput.type = "file"; camInput.accept = "image/*"; camInput.setAttribute("capture", "environment"); camInput.className = "hidden";
		const galInput = h("input"); galInput.type = "file"; galInput.accept = "image/*"; galInput.className = "hidden";
		bottom.append(replyBar, composer, recBar, attachMenu, camInput, galInput);

		const overlay = h("div", "cu-overlay hidden");
		const sheet = h("div", "cu-sheet");
		overlay.appendChild(sheet);
		const lightbox = h("div", "cu-lightbox hidden", '<button class="cu-lb-close" aria-label="Fermer">' + ICON.close + "</button><img alt=''>");

		root.append(list, notice, fab, bottom, overlay, lightbox);

		// ---------------------------------------------------------- scroll
		const nearBottom = () => list.scrollHeight - list.scrollTop - list.clientHeight < 90;
		list.addEventListener("scroll", () => {
			inst.stick = nearBottom();
			if (inst.stick) { inst.newCount = 0; updateFab(); }
			else updateFab();
		});
		function updateFab() {
			const show = !inst.stick && list.scrollHeight > list.clientHeight + 200;
			fab.classList.toggle("hidden", !show);
			const c = fab.querySelector(".cu-fab-count");
			c.textContent = inst.newCount > 9 ? "9+" : String(inst.newCount);
			c.classList.toggle("hidden", inst.newCount === 0);
		}
		function scrollBottom(smooth) {
			list.scrollTo({ top: list.scrollHeight, behavior: smooth ? "smooth" : "auto" });
			inst.stick = true; inst.newCount = 0; updateFab();
		}
		fab.addEventListener("click", () => scrollBottom(true));
		if (typeof ResizeObserver !== "undefined") {
			new ResizeObserver(() => { if (inst.stick) list.scrollTop = list.scrollHeight; updateFab(); }).observe(list);
		}

		// ---------------------------------------------------------- bubbles
		function buildQuote(rt) {
			const q = h("div", "cu-quote");
			const who = h("div", "cu-quote-who");
			who.textContent = rt.from === opts.me ? t("you") : (inst.peerName || "…");
			const txt = h("div", "cu-quote-text");
			txt.textContent = rt.preview || "";
			q.append(who, txt);
			q.addEventListener("click", (e) => {
				e.stopPropagation();
				const n = inst.nodes.get(rt.id);
				if (!n) return;
				n.scrollIntoView({ block: "center", behavior: "smooth" });
				n.classList.add("flash");
				setTimeout(() => n.classList.remove("flash"), 1300);
			});
			return q;
		}

		function buildVoice(msg) {
			const wrapV = h("div", "cu-voice");
			const btn = h("button", "cu-voice-btn", ICON.play);
			btn.setAttribute("aria-label", t("voice"));
			const wave = h("div", "cu-voice-wave");
			const seed = hash(msg.id || "x");
			const bars = [];
			for (let i = 0; i < 30; i++) {
				const b = h("i");
				const r = ((seed >> (i % 24)) ^ (i * 2654435761)) >>> 0;
				b.style.height = 22 + (r % 78) + "%";
				bars.push(b); wave.appendChild(b);
			}
			const timeEl = h("span", "cu-voice-time");
			const total = msg.duration || 0;
			timeEl.textContent = fmtDur(total);
			wrapV.append(btn, wave, timeEl);
			let audio = null;
			const durOf = () => (audio && isFinite(audio.duration) && audio.duration > 0 ? audio.duration * 1000 : total);
			const paint = (frac) => bars.forEach((b, i) => b.classList.toggle("on", i / bars.length < frac));
			const ensure = () => {
				if (audio) return audio;
				audio = new Audio(msg.content);
				audio.preload = "metadata";
				audio.addEventListener("timeupdate", () => {
					const d = durOf();
					paint(d ? (audio.currentTime * 1000) / d : 0);
					timeEl.textContent = fmtDur(audio.currentTime * 1000);
				});
				audio.addEventListener("play", () => { btn.innerHTML = ICON.pause; });
				audio.addEventListener("pause", () => { btn.innerHTML = ICON.play; });
				audio.addEventListener("ended", () => { btn.innerHTML = ICON.play; paint(0); timeEl.textContent = fmtDur(durOf()); });
				return audio;
			};
			btn.addEventListener("click", (e) => {
				e.stopPropagation();
				const a = ensure();
				if (a.paused) {
					if (currentAudio && currentAudio !== a) currentAudio.pause();
					currentAudio = a;
					a.play().catch(() => {});
				} else a.pause();
			});
			wave.addEventListener("click", (e) => {
				e.stopPropagation();
				const a = ensure();
				const d = durOf();
				if (!d) return;
				const r = wave.getBoundingClientRect();
				a.currentTime = (Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * d) / 1000;
			});
			return wrapV;
		}

		function tickHtml(status) {
			if (status === "pending") return ICON.clock;
			if (status === "sent") return ICON.check;
			return ICON.check2;
		}
		function applyStatus(row, msg) {
			const tk = row.querySelector(".cu-ticks");
			if (!tk) return;
			const st = msg.status || "sent";
			tk.className = "cu-ticks " + st;
			tk.innerHTML = tickHtml(st);
		}

		function buildMessage(msg) {
			const mine = msg.from === opts.me;
			const row = h("div", "cu-msg " + (mine ? "mine" : "theirs"));
			row.dataset.id = msg.id;
			const bubble = h("div", "cu-bubble");
			row.appendChild(bubble);

			const meta = h("span", "cu-meta");
			const tm = h("span", "cu-time");
			tm.textContent = fmtTime(toDate(msg.timestamp));
			meta.appendChild(tm);
			if (mine && !msg.deleted) meta.appendChild(h("span", "cu-ticks"));

			if (msg.deleted) {
				const tx = h("div", "cu-text cu-deleted", ICON.ban + "<span></span>");
				tx.querySelector("span").textContent = t("deleted");
				tx.appendChild(meta);
				bubble.appendChild(tx);
			} else {
				if (msg.replyTo) bubble.appendChild(buildQuote(msg.replyTo));
				if (msg.type === "image") {
					const img = h("img", "cu-image");
					img.src = msg.content; img.alt = ""; img.loading = "lazy";
					img.addEventListener("click", (e) => {
						e.stopPropagation();
						lightbox.querySelector("img").src = msg.content;
						lightbox.classList.remove("hidden");
					});
					img.addEventListener("load", () => { if (inst.stick) list.scrollTop = list.scrollHeight; });
					bubble.appendChild(img);
					meta.classList.add("on-media");
					bubble.classList.add("has-media");
					bubble.appendChild(meta);
				} else if (msg.type === "audio") {
					bubble.appendChild(buildVoice(msg));
					meta.classList.add("block");
					bubble.appendChild(meta);
				} else {
					const tx = h("div", "cu-text");
					tx.appendChild(document.createTextNode(msg.content || ""));
					tx.appendChild(meta);
					bubble.appendChild(tx);
				}
			}
			if (!opts.noMenu) {
				const chev = h("button", "cu-chev", ICON.chev);
				chev.setAttribute("aria-label", t("options"));
				chev.addEventListener("click", (e) => { e.stopPropagation(); openMenu(inst.byId.get(msg.id) || msg); });
				bubble.appendChild(chev);

				let timer = null, sx = 0, sy = 0;
				const clear = () => { clearTimeout(timer); timer = null; };
				row.addEventListener("touchstart", (e) => {
					const p = e.touches[0]; sx = p.clientX; sy = p.clientY;
					clear();
					timer = setTimeout(() => { timer = null; openMenu(inst.byId.get(msg.id) || msg); }, 430);
				}, { passive: true });
				row.addEventListener("touchmove", (e) => {
					const p = e.touches[0];
					if (Math.abs(p.clientX - sx) > 8 || Math.abs(p.clientY - sy) > 8) clear();
				}, { passive: true });
				row.addEventListener("touchend", clear);
				row.addEventListener("touchcancel", clear);
				row.addEventListener("contextmenu", (e) => { e.preventDefault(); openMenu(inst.byId.get(msg.id) || msg); });
			}
			applyStatus(row, msg);
			return row;
		}

		const fp = (m) => `${m.deleted ? 1 : 0}|${m.type}|${(m.content || "").length}|${m.replyTo ? m.replyTo.id : ""}|${m.duration || 0}`;

		// ---------------------------------------------------------- sync
		function sync() {
			const desired = [];
			if (inst.introText) {
				if (!inst.introNode) inst.introNode = h("div", "cu-intro");
				inst.introNode.textContent = inst.introText;
				desired.push(inst.introNode);
			}
			let lastDay = "", prev = null;
			inst.messages.forEach((m) => {
				const d = toDate(m.timestamp);
				const dk = d.toDateString();
				if (dk !== lastDay) {
					let s = inst.seps.get(dk);
					if (!s) { s = h("div", "cu-sep"); inst.seps.set(dk, s); }
					s.textContent = dayLabel(inst, d);
					desired.push(s); lastDay = dk; prev = null;
				}
				let node = inst.nodes.get(m.id);
				const f = fp(m);
				if (!node || inst.fps.get(m.id) !== f) {
					const fresh = buildMessage(m);
					if (node && node.parentNode) node.parentNode.replaceChild(fresh, node);
					node = fresh;
					inst.nodes.set(m.id, node); inst.fps.set(m.id, f);
				} else {
					applyStatus(node, m);
					const tm = node.querySelector(".cu-time");
					if (tm) tm.textContent = fmtTime(d);
				}
				node.classList.toggle("grouped", !!(prev && prev.from === m.from && d - toDate(prev.timestamp) < 5 * 60000));
				desired.push(node);
				prev = m;
			});
			if (inst.typing) {
				if (!inst.typingNode) inst.typingNode = h("div", "cu-msg theirs cu-typing", '<div class="cu-bubble"><i></i><i></i><i></i></div>');
				desired.push(inst.typingNode);
			}
			const alive = new Set(inst.messages.map((m) => m.id));
			Array.from(inst.nodes.keys()).forEach((id) => { if (!alive.has(id)) { inst.nodes.delete(id); inst.fps.delete(id); } });
			syncChildren(list, desired);
		}

		function setMessages(msgs) {
			const prevIds = new Set(inst.messages.map((m) => m.id));
			const wasStick = inst.stick;
			inst.messages = msgs;
			inst.byId = new Map(msgs.map((m) => [m.id, m]));
			sync();
			const fresh = msgs.filter((m) => !prevIds.has(m.id));
			const last = msgs[msgs.length - 1];
			if (!inst.rendered) {
				inst.rendered = true;
				list.scrollTop = list.scrollHeight;
				inst.stick = true;
			} else if (wasStick || (fresh.length && last && last.from === opts.me)) {
				scrollBottom(true);
			} else {
				inst.newCount += fresh.filter((m) => m.from !== opts.me).length;
			}
			updateFab();
		}

		// ---------------------------------------------------------- menu
		function closeOverlay() { overlay.classList.add("hidden"); sheet.innerHTML = ""; }
		overlay.addEventListener("click", (e) => { if (e.target === overlay) closeOverlay(); });

		function openMenu(msg) {
			if (!msg) return;
			const canAll = !msg.deleted && opts.canDeleteForEveryone && opts.canDeleteForEveryone(msg);
			sheet.innerHTML = "";
			const item = (icon, label, cls, fn) => {
				const b = h("button", "cu-sheet-item " + (cls || ""), icon + "<span></span>");
				b.querySelector("span").textContent = label;
				b.addEventListener("click", fn);
				sheet.appendChild(b);
			};
			if (!msg.deleted) item(ICON.reply, t("reply"), "", () => { closeOverlay(); startReply(msg); });
			if (!msg.deleted && msg.type === "text") item(ICON.copy, t("copy"), "", () => { closeOverlay(); copyText(msg.content); });
			item(ICON.trash, t("delForMe"), "", () => { closeOverlay(); opts.onDelete(msg, "me"); });
			if (canAll) item(ICON.ban, t("delForAll"), "danger", () => confirmAll(msg));
			item(ICON.close, t("cancel"), "muted", closeOverlay);
			overlay.classList.remove("hidden");
		}
		function confirmAll(msg) {
			sheet.innerHTML = `<div class="cu-confirm-title"></div><div class="cu-confirm-body"></div><div class="cu-confirm-row"><button class="cu-btn ghost"></button><button class="cu-btn danger"></button></div>`;
			sheet.querySelector(".cu-confirm-title").textContent = t("confirmTitle");
			sheet.querySelector(".cu-confirm-body").textContent = t("confirmBody");
			const [c, d] = sheet.querySelectorAll(".cu-btn");
			c.textContent = t("cancel"); d.textContent = t("confirm");
			c.addEventListener("click", closeOverlay);
			d.addEventListener("click", () => { closeOverlay(); opts.onDelete(msg, "everyone"); });
		}
		function copyText(text) {
			const done = () => toast(t("copied"));
			if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, done);
			else {
				const x = document.createElement("textarea"); x.value = text; document.body.appendChild(x); x.select();
				try { document.execCommand("copy"); } catch (e) {}
				x.remove(); done();
			}
		}
		lightbox.addEventListener("click", () => lightbox.classList.add("hidden"));

		// ---------------------------------------------------------- reply
		function startReply(msg) {
			inst.replyTo = { id: msg.id, from: msg.from, type: msg.type, preview: preview(inst, msg) };
			replyBar.innerHTML = `<div class="cu-replybar-body"><div class="cu-quote-who"></div><div class="cu-quote-text"></div></div><button class="cu-replybar-x" aria-label="${t("cancel")}">${ICON.close}</button>`;
			replyBar.querySelector(".cu-quote-who").textContent = (msg.from === opts.me ? t("you") : inst.peerName || "…");
			replyBar.querySelector(".cu-quote-text").textContent = inst.replyTo.preview;
			replyBar.querySelector(".cu-replybar-x").addEventListener("click", clearReply);
			replyBar.classList.remove("hidden");
			ta.focus();
		}
		function clearReply() { inst.replyTo = null; replyBar.classList.add("hidden"); }

		// ---------------------------------------------------------- composer
		function autosize() {
			ta.style.height = "auto";
			ta.style.height = Math.min(ta.scrollHeight, 132) + "px";
		}
		function refreshAction() {
			const has = ta.value.trim().length > 0;
			actionBtn.innerHTML = has ? ICON.send : ICON.mic;
			actionBtn.classList.toggle("is-send", has);
			actionBtn.setAttribute("aria-label", has ? t("send") : t("record"));
		}
		ta.addEventListener("input", () => {
			autosize(); refreshAction();
			if (ta.value.trim() && opts.onTyping && Date.now() - inst.lastTypingPing > 3000) {
				inst.lastTypingPing = Date.now();
				opts.onTyping();
			}
		});
		ta.addEventListener("keydown", (e) => {
			if (e.key === "Enter" && !e.shiftKey && !e.isComposing && !isCoarse()) { e.preventDefault(); sendText(); }
		});
		function sendText() {
			const text = ta.value.replace(/\s+$/, "");
			if (!text.trim()) return;
			const ok = opts.onSendText(text, inst.replyTo);
			if (ok === false) return;
			ta.value = ""; autosize(); refreshAction(); clearReply();
			ta.focus();
		}
		const keepFocus = (e) => e.preventDefault();
		[actionBtn, attachBtn].forEach((b) => { b.addEventListener("pointerdown", keepFocus); b.addEventListener("mousedown", keepFocus); });
		actionBtn.addEventListener("click", () => {
			if (ta.value.trim()) sendText(); else startRecording();
		});
		attachBtn.addEventListener("click", () => attachMenu.classList.toggle("hidden"));
		attachMenu.addEventListener("click", (e) => {
			const b = e.target.closest("button"); if (!b) return;
			attachMenu.classList.add("hidden");
			(b.dataset.k === "camera" ? camInput : galInput).click();
		});
		const onFile = (e) => {
			const f = e.target.files && e.target.files[0];
			e.target.value = "";
			if (!f) return;
			compressImage(f, (dataUrl) => {
				const ok = opts.onSendMedia("image", dataUrl, {}, inst.replyTo);
				if (ok !== false) clearReply();
			}, () => toast(t("imageFail")));
		};
		camInput.addEventListener("change", onFile);
		galInput.addEventListener("change", onFile);
		document.addEventListener("click", (e) => { if (!attachMenu.contains(e.target) && !attachBtn.contains(e.target)) attachMenu.classList.add("hidden"); });

		// ---------------------------------------------------------- voice
		async function startRecording() {
			if (inst.rec) return;
			if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === "undefined") { toast(t("audioUnsupported")); return; }
			let stream;
			try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (e) { toast(t("audioDenied")); return; }
			const mime = pickMime();
			let rec;
			try { rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 24000 } : { audioBitsPerSecond: 24000 }); }
			catch (e) { try { rec = new MediaRecorder(stream); } catch (e2) { stream.getTracks().forEach((x) => x.stop()); toast(t("audioUnsupported")); return; } }
			const r = { rec, stream, chunks: [], start: Date.now(), cancelled: false, timer: null };
			inst.rec = r;
			rec.ondataavailable = (e) => { if (e.data && e.data.size) r.chunks.push(e.data); };
			rec.onstop = () => {
				clearInterval(r.timer);
				stream.getTracks().forEach((x) => x.stop());
				recBar.classList.add("hidden"); composer.classList.remove("hidden");
				inst.rec = null;
				const dur = Date.now() - r.start;
				if (r.cancelled || dur < 700) return;
				const blob = new Blob(r.chunks, { type: rec.mimeType || mime || "audio/webm" });
				if (blob.size > 700 * 1024) { toast(t("audioTooLong")); return; }
				const fr = new FileReader();
				fr.onload = () => {
					const ok = opts.onSendMedia("audio", fr.result, { duration: dur }, inst.replyTo);
					if (ok !== false) clearReply();
				};
				fr.readAsDataURL(blob);
			};
			rec.start();
			composer.classList.add("hidden"); recBar.classList.remove("hidden");
			const tEl = recBar.querySelector(".cu-rec-time");
			tEl.textContent = "0:00";
			r.timer = setInterval(() => {
				const ms = Date.now() - r.start;
				tEl.textContent = fmtDur(ms);
				if (ms >= 120000 && rec.state === "recording") rec.stop();
			}, 250);
		}
		recBar.querySelector(".cu-rec-cancel").addEventListener("click", () => { if (inst.rec) { inst.rec.cancelled = true; inst.rec.rec.stop(); } });
		recBar.querySelector(".cu-rec-send").addEventListener("click", () => { if (inst.rec && inst.rec.rec.state === "recording") inst.rec.rec.stop(); });

		refreshAction();

		return {
			setMessages,
			setIntro(text) { inst.introText = text || ""; sync(); },
			setPeerName(n) { inst.peerName = n || ""; },
			setNotice(text) { notice.textContent = text || ""; notice.classList.toggle("hidden", !text); },
			setPeerTyping(v) {
				v = !!v;
				if (v === inst.typing) return;
				inst.typing = v; sync();
				if (v && inst.stick) list.scrollTop = list.scrollHeight;
			},
			setLang(l) { inst.lang = l === "en" ? "en" : "fr"; ta.placeholder = opts.placeholder || t("placeholder"); },
			focusInput() { ta.focus(); },
			scrollToBottom: () => scrollBottom(false),
			hasDraft: () => ta.value.trim().length > 0,
			resetView() { inst.rendered = false; inst.stick = true; },
		};
	}

	return { mount, bindViewport, toast, strings: STR };
})();
