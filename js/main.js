// Point d'entrée : écrans (accueil, salon, partie), rôle hôte ou invité.
import { HostSession } from './host.js';
import { createHostPeer, connectToHost, randomCode, normalizeCode } from './net.js';
import { esc, toast } from './ui/dom.js';
import * as beloteUI from './ui/belote-ui.js';

const GAME_UIS = { belote: beloteUI };
const HOST_SAVE_KEY = 'cg-host-session';
const $app = document.getElementById('app');

const ui = {
  screen: 'home', // home | connecting | room
  connectingText: '',
  role: null, // 'host' | 'client'
  code: null,
  lobby: null,
  view: null,
  connected: true,
  showLast: false,
  myId: getMyId(),
  myName: safeGet(localStorage, 'cg-name') || '',
  send: () => {},
  cleanup: [],
  attempt: 0, // incrémenté à chaque départ : annule les connexions en cours
};

// ----------------------------------------------------------------- utilitaires

function safeGet(storage, key) {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}
function safeSet(storage, key, value) {
  try {
    if (value === null) storage.removeItem(key);
    else storage.setItem(key, value);
  } catch {
    /* stockage indisponible : tant pis */
  }
}

// Identifiant propre à l'onglet (sessionStorage) : survit à un rechargement,
// et permet d'ouvrir plusieurs onglets pour tester seul.
function getMyId() {
  let id = safeGet(sessionStorage, 'cg-id');
  if (!id) {
    id = 'p-' + Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');
    safeSet(sessionStorage, 'cg-id', id);
  }
  return id;
}

const shareLink = (code) => `${location.origin}${location.pathname}#${code}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function savedHostSession() {
  try {
    return JSON.parse(safeGet(sessionStorage, HOST_SAVE_KEY));
  } catch {
    return null;
  }
}

// ----------------------------------------------------------------- messages venant de l'hôte

function onMessage(msg) {
  if (!msg || typeof msg !== 'object') return;
  switch (msg.t) {
    case 'lobby':
      ui.lobby = msg.lobby;
      if (!msg.lobby.started) {
        ui.view = null;
        ui.showLast = false;
      }
      break;
    case 'state':
      if (ui.showLast && JSON.stringify(ui.view?.lastTrick) !== JSON.stringify(msg.view.lastTrick)) ui.showLast = false;
      ui.view = msg.view;
      break;
    case 'error':
      toast(msg.msg);
      return;
    default:
      return;
  }
  render();
}

// ----------------------------------------------------------------- hôte

async function createRoom(saved = null) {
  if (!saved && !requireName()) return;
  showConnecting(saved ? 'Reprise de la partie…' : 'Création de la salle…');
  const attempt = ui.attempt;

  let code = saved?.code || randomCode();
  let peer = null;
  for (let tries = 0; tries < 8 && !peer; tries++) {
    try {
      peer = await createHostPeer(code);
    } catch (e) {
      if (attempt !== ui.attempt) return;
      if (e?.type === 'unavailable-id') {
        // Code déjà pris. En reprise, l'ancien identifiant met quelques secondes à se libérer.
        if (saved) await wait(2500);
        else code = randomCode();
        continue;
      }
      return backHome(`Impossible de créer la salle : ${e?.message || e}`);
    }
  }
  if (attempt !== ui.attempt) return peer?.destroy(); // annulé entre-temps
  if (!peer) return backHome('Impossible de créer la salle, réessaie dans un instant.');

  const host = new HostSession({
    code,
    hostId: ui.myId,
    saved,
    onSave: (data) => safeSet(sessionStorage, HOST_SAVE_KEY, JSON.stringify(data)),
  });
  const localConn = { send: (msg) => queueMicrotask(() => onMessage(msg)) };

  peer.on('connection', (conn) => {
    let pid = null;
    conn.on('data', (msg) => {
      if (msg?.t === 'hello' && typeof msg.id === 'string') pid = msg.id;
      if (pid) host.receive(pid, msg, conn);
    });
    conn.on('close', () => pid && host.disconnected(pid, conn));
    conn.on('error', (e) => console.warn('[connexion]', e));
  });

  const tick = setInterval(() => host.tick(), 4000);
  ui.cleanup.push(() => clearInterval(tick), () => host.stopTimer(), () => peer.destroy());

  Object.assign(ui, { role: 'host', code, screen: 'room', connected: true });
  ui.send = (msg) => host.receive(ui.myId, msg, localConn);
  ui.send({ t: 'hello', id: ui.myId, name: ui.myName || 'Hôte' });
  history.replaceState(null, '', location.pathname);
}

// ----------------------------------------------------------------- invité

async function joinRoom(code) {
  code = normalizeCode(code);
  if (!code) return toast('Entre le code de la partie.');
  if (!requireName()) return;
  showConnecting(`Connexion à la partie ${code}…`);
  try {
    await connectClient(code, ui.attempt);
  } catch (e) {
    if (e?.cancelled) return;
    backHome(e?.message || 'Connexion impossible.');
  }
}

async function connectClient(code, attempt) {
  const { peer, conn } = await connectToHost(code);
  if (attempt !== ui.attempt) {
    peer.destroy();
    throw Object.assign(new Error('annulé'), { cancelled: true });
  }
  let lastSeen = Date.now();
  let lost = false;

  const onLost = () => {
    if (lost || attempt !== ui.attempt) return;
    lost = true;
    clearInterval(beat);
    peer.destroy();
    ui.connected = false;
    render();
    reconnect(code);
  };

  conn.on('data', (msg) => {
    lastSeen = Date.now();
    onMessage(msg);
  });
  conn.on('close', onLost);
  conn.on('error', onLost);
  const beat = setInterval(() => {
    if (Date.now() - lastSeen > 15000) return onLost();
    try {
      conn.send({ t: 'ping' });
    } catch {
      onLost();
    }
  }, 4000);

  ui.cleanup = [() => clearInterval(beat), () => peer.destroy()];
  Object.assign(ui, { role: 'client', code, screen: 'room', connected: true });
  ui.send = (msg) => {
    try {
      conn.send(msg);
    } catch {
      toast('Message non envoyé : connexion perdue.');
    }
  };
  ui.send({ t: 'hello', id: ui.myId, name: ui.myName });
  history.replaceState(null, '', `${location.pathname}#${code}`);
}

async function reconnect(code) {
  const attempt = ui.attempt;
  for (let i = 0; i < 40; i++) {
    await wait(3000);
    if (attempt !== ui.attempt) return; // a quitté entre-temps
    try {
      await connectClient(code, attempt);
      toast('Reconnecté !');
      return;
    } catch (e) {
      if (e?.cancelled) return;
    }
  }
  if (attempt === ui.attempt) backHome("L'hôte semble avoir quitté la partie.");
}

// ----------------------------------------------------------------- navigation

function requireName() {
  const input = document.getElementById('name');
  const name = (input?.value ?? ui.myName).trim().slice(0, 20);
  if (!name) {
    toast("Choisis d'abord un prénom.");
    input?.focus();
    return false;
  }
  ui.myName = name;
  safeSet(localStorage, 'cg-name', name);
  return true;
}

function showConnecting(text) {
  ui.screen = 'connecting';
  ui.connectingText = text;
  render();
}

function leave() {
  for (const fn of ui.cleanup) {
    try {
      fn();
    } catch {
      /* ignore */
    }
  }
  if (ui.role === 'host') safeSet(sessionStorage, HOST_SAVE_KEY, null);
  ui.attempt++;
  Object.assign(ui, { cleanup: [], role: null, code: null, lobby: null, view: null, send: () => {}, connected: true });
  history.replaceState(null, '', location.pathname);
}

function backHome(message) {
  leave();
  ui.screen = 'home';
  render();
  if (message) toast(message, 6000);
}

// ----------------------------------------------------------------- rendu

function render() {
  let html;
  if (ui.screen === 'home') html = renderHome();
  else if (ui.screen === 'connecting' || !ui.lobby) html = renderConnecting();
  else if (ui.lobby.started && ui.view) {
    html = GAME_UIS[ui.view.game].render(ui.view, {
      lobby: ui.lobby,
      myId: ui.myId,
      isHost: ui.role === 'host',
      showLast: ui.showLast,
    });
  } else html = renderLobby();

  const banner = !ui.connected
    ? '<div class="banner">Connexion à l\'hôte perdue, reconnexion en cours…</div>'
    : '';
  $app.innerHTML = banner + html;
}

function renderHome() {
  const code = normalizeCode(location.hash.slice(1));
  const saved = savedHostSession();
  return `<main class="home">
    <h1>🃏 Cartes entre amis</h1>
    <p class="subtitle">Belote en ligne, en connexion directe entre navigateurs.</p>
    <label>Ton prénom
      <input id="name" maxlength="20" autocomplete="nickname" value="${esc(ui.myName)}" placeholder="ex. Camille">
    </label>
    ${
      code
        ? `<div class="box">
            <p>Tu es invité à la partie <b>${esc(code)}</b>.</p>
            <button data-action="join" data-code="${esc(code)}">Rejoindre la partie</button>
           </div>`
        : ''
    }
    <div class="box">
      <button data-action="create" class="${code ? 'secondary' : ''}">Créer une partie</button>
      <p class="muted">Tu seras l'hôte : garde cet onglet ouvert pendant la partie.</p>
    </div>
    <div class="box">
      <div class="join-row">
        <input id="code" maxlength="8" placeholder="Code" value="" autocapitalize="characters">
        <button data-action="join-code" class="secondary">Rejoindre</button>
      </div>
    </div>
    ${
      saved
        ? `<div class="box"><button data-action="resume" class="secondary">
            Reprendre ma partie ${esc(saved.code)}</button></div>`
        : ''
    }
  </main>`;
}

function renderConnecting() {
  return `<main class="home"><div class="spinner"></div>
    <p>${esc(ui.connectingText || 'Connexion…')}</p>
    <button class="secondary" data-action="leave-now">Annuler</button></main>`;
}

function renderLobby() {
  const L = ui.lobby;
  const isHost = ui.role === 'host';
  const player = (id) => L.players.find((p) => p.id === id);
  const seated = new Set(L.seats.filter(Boolean));
  const watchers = L.players.filter((p) => !p.bot && !seated.has(p.id));
  const full = L.seats.every(Boolean);

  const seat = (i) => {
    const p = player(L.seats[i]);
    let inner;
    if (p) {
      inner = `<div class="pname">${p.bot ? '🤖 ' : ''}${esc(p.name)}${p.id === L.hostId ? ' 👑' : ''}${
        p.connected ? '' : ' 🔌'
      }</div>
        ${p.id === ui.myId ? '<button class="tiny secondary" data-action="stand">Se lever</button>' : ''}
        ${isHost && p.id !== ui.myId ? `<button class="tiny secondary" data-action="unseat" data-seat="${i}">Retirer</button>` : ''}`;
    } else {
      inner = `<button class="tiny" data-action="sit" data-seat="${i}">S'asseoir</button>
        ${isHost ? `<button class="tiny secondary" data-action="add-bot" data-seat="${i}">+ Robot</button>` : ''}`;
    }
    return `<div class="seat pos-${['bottom', 'right', 'top', 'left'][i]} team-${i % 2} ${
      L.seats[i] === ui.myId ? 'me' : ''
    }">${inner}<div class="team-label">Équipe ${i % 2 === 0 ? 'A' : 'B'}</div></div>`;
  };

  const targetCtl = isHost
    ? `<select data-action="target">${L.targets
        .map((t) => `<option value="${t}" ${t === L.target ? 'selected' : ''}>${t} points</option>`)
        .join('')}</select>`
    : `<b>${L.target} points</b>`;

  return `<main class="lobby">
    <header class="lobby-head">
      <div>
        <div class="muted">Code de la partie</div>
        <div class="code">${esc(L.code)}</div>
      </div>
      <div class="share">
        <input readonly value="${esc(shareLink(L.code))}" id="share">
        <button data-action="copy">Copier le lien</button>
      </div>
    </header>
    <p class="muted">Envoie ce lien à tes amis. Chacun clique sur une place pour s'asseoir.
      Les partenaires sont face à face (Équipe A contre Équipe B).</p>
    <div class="options">Jeu : <b>${esc(L.gameName)}</b> · Partie en ${targetCtl}</div>
    <div class="lobby-table">
      ${L.seats.map((_, i) => seat(i)).join('')}
      <div class="center felt">🃏</div>
    </div>
    ${
      watchers.length
        ? `<p class="muted">Pas encore assis : ${watchers.map((p) => esc(p.name) + (p.connected ? '' : ' 🔌')).join(', ')}</p>`
        : ''
    }
    <div class="actions">
      ${
        isHost
          ? `<button data-action="start" ${full ? '' : 'disabled'}>Lancer la partie</button>`
          : `<p class="waiting">L'hôte lancera la partie quand les 4 places seront prises.</p>`
      }
      <button class="secondary" data-action="leave">Quitter</button>
    </div>
  </main>`;
}

// ----------------------------------------------------------------- interactions

$app.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled || el.tagName === 'SELECT') return;
  const seat = el.dataset.seat !== undefined ? Number(el.dataset.seat) : undefined;

  switch (el.dataset.action) {
    case 'create':
      return createRoom();
    case 'resume':
      return createRoom(savedHostSession());
    case 'join':
      return joinRoom(el.dataset.code);
    case 'join-code':
      return joinRoom(document.getElementById('code').value);
    case 'copy': {
      const link = shareLink(ui.lobby.code);
      navigator.clipboard?.writeText(link).then(
        () => toast('Lien copié !'),
        () => {
          document.getElementById('share').select();
          toast('Copie le lien sélectionné.');
        }
      );
      return;
    }
    case 'sit':
      return ui.send({ t: 'sit', seat });
    case 'stand':
      return ui.send({ t: 'stand' });
    case 'add-bot':
      return ui.send({ t: 'addBot', seat });
    case 'unseat':
      return ui.send({ t: 'unseat', seat });
    case 'start':
      return ui.send({ t: 'start' });
    case 'restart':
      return ui.send({ t: 'restart' });
    case 'back-lobby':
      return ui.send({ t: 'lobby' });
    case 'autoplay':
      return ui.send({ t: 'autoplay', seat, on: el.dataset.on === 'true' });
    case 'game':
      return ui.send({ t: 'action', action: JSON.parse(el.dataset.payload) });
    case 'last-trick':
      ui.showLast = !ui.showLast;
      return render();
    case 'leave': {
      const warn =
        ui.role === 'host'
          ? "Tu es l'hôte : si tu quittes, la partie s'arrête pour tout le monde. Quitter ?"
          : 'Quitter la partie ?';
      if (!confirm(warn)) return;
      return backHome();
    }
    case 'leave-now':
      return backHome();
  }
});

$app.addEventListener('change', (e) => {
  if (e.target.dataset.action === 'target') ui.send({ t: 'option', target: Number(e.target.value) });
});

$app.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  if (e.target.id === 'code') joinRoom(e.target.value);
  if (e.target.id === 'name') {
    const code = normalizeCode(location.hash.slice(1));
    code ? joinRoom(code) : createRoom();
  }
});

// L'hôte qui ferme l'onglet arrête la partie : on le prévient.
window.addEventListener('beforeunload', (e) => {
  if (ui.role === 'host' && ui.lobby?.started) {
    e.preventDefault();
    e.returnValue = '';
  }
});

window.addEventListener('hashchange', () => ui.screen === 'home' && render());

if (typeof Peer === 'undefined') {
  $app.innerHTML =
    '<main class="home"><p>Impossible de charger la bibliothèque réseau (PeerJS). Vérifie ta connexion internet.</p></main>';
} else {
  render();
}
