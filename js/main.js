// Point d'entrée : écrans (accueil, salon, partie), rôle hôte ou invité.
import { HostSession } from './host.js';
import { createHostPeer, connectToHost, randomCode, normalizeCode } from './net.js';
import { esc, toast, seatPositions } from './ui/dom.js';
import * as anim from './ui/anim.js';
import * as beloteUI from './ui/belote-ui.js';
import * as coincheUI from './ui/coinche-ui.js';
import * as presidentUI from './ui/president-ui.js';
import * as pouilleuxUI from './ui/pouilleux-ui.js';
import * as batailleUI from './ui/bataille-ui.js';

const GAME_UIS = { belote: beloteUI, coinche: coincheUI, president: presidentUI, pouilleux: pouilleuxUI, bataille: batailleUI };
const GAME_NAMES = { belote: 'Belote', coinche: 'Coinche', president: 'Président', pouilleux: 'Pouilleux', bataille: 'Bataille' };
const SAVES_KEY = 'cg-saves';
const $app = document.getElementById('app');
const $help = document.getElementById('help');

const ui = {
  screen: 'home', // home | connecting | room
  connectingText: '',
  role: null, // 'host' | 'client'
  code: null,
  saveId: null,
  lobby: null,
  view: null,
  connected: true,
  showLast: false,
  selected: [], // cartes sélectionnées (président)
  fields: {}, // valeurs de champs locaux (ex. valeur d'enchère à la coinche)
  help: null, // null | 'goal' | 'rules'
  helpKey: null,
  dialog: null, // null | 'leave'
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
    /* stockage indisponible ou plein : tant pis */
  }
}

// Identifiant propre à l'onglet (sessionStorage) : survit à un rechargement,
// et permet d'ouvrir plusieurs onglets pour tester seul.
function getMyId() {
  let id = safeGet(sessionStorage, 'cg-id');
  if (!id) {
    id = 'p-' + randomHex();
    safeSet(sessionStorage, 'cg-id', id);
  }
  return id;
}
function randomHex() {
  return Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');
}

const shareLink = (code) => `${location.origin}${location.pathname}#${code}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ----------------------------------------------------------------- parties sauvegardées (localStorage)

function readSaves() {
  try {
    const all = JSON.parse(safeGet(localStorage, SAVES_KEY));
    return all && typeof all === 'object' ? all : {};
  } catch {
    return {};
  }
}

function writeSave(id, entry) {
  if (!id) return;
  const all = readSaves();
  if (entry) all[id] = entry;
  else delete all[id];
  safeSet(localStorage, SAVES_KEY, JSON.stringify(all));
}

function onHostSave(data) {
  if (data.started && data.game?.phase === 'gameOver') return writeSave(data.saveId, null);
  const seatedNames = data.seats.map((id) => data.players.find((p) => p.id === id)?.name).filter(Boolean);
  writeSave(data.saveId, {
    savedAt: data.savedAt,
    code: data.code,
    game: data.options.game,
    started: data.started,
    round: data.game?.round ?? null,
    names: data.game?.names ?? seatedNames,
    session: data,
  });
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
        ui.help = null;
      }
      break;
    case 'state':
      if (ui.showLast && JSON.stringify(ui.view?.lastTrick) !== JSON.stringify(msg.view.lastTrick)) ui.showLast = false;
      ui.view = msg.view;
      ui.selected = ui.selected.filter((c) => msg.view.hand?.includes(c));
      break;
    case 'seated':
      toast(
        `Tu as repris ta place (${msg.name}). Pas la bonne ? Clique sur « Changer de place » pendant la pause.`,
        7000
      );
      return;
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
        // Code déjà pris. Après un rechargement, l'ancien identifiant met quelques secondes à se libérer ;
        // s'il reste pris, on reprend la partie avec un nouveau code.
        if (saved && tries < 3) await wait(2500);
        else code = randomCode();
        continue;
      }
      return backHome(`Impossible de créer la salle : ${e?.message || e}`);
    }
  }
  if (attempt !== ui.attempt) return peer?.destroy(); // annulé entre-temps
  if (!peer) return backHome('Impossible de créer la salle, réessaie dans un instant.');

  const saveId = saved?.saveId || 's-' + randomHex();
  const host = new HostSession({ code, hostId: ui.myId, saveId, saved, onSave: onHostSave });
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

  Object.assign(ui, { role: 'host', code, saveId, screen: 'room', connected: true });
  ui.send = (msg) => host.receive(ui.myId, msg, localConn);
  ui.send({ t: 'hello', id: ui.myId, name: ui.myName || 'Hôte' });
  history.replaceState(null, '', location.pathname);
  if (saved && code !== saved.code) toast(`Nouveau code de partie : ${code}. Envoie le nouveau lien à tes amis.`, 7000);
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

// keepSave : l'hôte garde la sauvegarde locale pour reprendre la partie plus tard.
function leave(keepSave = false) {
  for (const fn of ui.cleanup) {
    try {
      fn();
    } catch {
      /* ignore */
    }
  }
  if (ui.role === 'host' && !keepSave) writeSave(ui.saveId, null);
  ui.attempt++;
  Object.assign(ui, {
    cleanup: [],
    role: null,
    code: null,
    saveId: null,
    lobby: null,
    view: null,
    send: () => {},
    connected: true,
    selected: [],
    fields: {},
    help: null,
    dialog: null,
  });
  history.replaceState(null, '', location.pathname);
}

function backHome(message, keepSave = false) {
  leave(keepSave);
  ui.screen = 'home';
  render();
  if (message) toast(message, 6000);
}

// ----------------------------------------------------------------- rendu

function gameCtx() {
  return {
    lobby: ui.lobby,
    myId: ui.myId,
    isHost: ui.role === 'host',
    showLast: ui.showLast,
    selected: ui.selected,
    fields: ui.fields,
  };
}

function render() {
  let html;
  if (ui.screen === 'home') html = renderHome();
  else if (ui.screen === 'connecting' || !ui.lobby) html = renderConnecting();
  else if (ui.lobby.started && ui.view && GAME_UIS[ui.view.game]) {
    anim.beginFrame();
    html = GAME_UIS[ui.view.game].render(ui.view, gameCtx());
    anim.endFrame();
    if (ui.lobby.paused) html += renderPause();
  } else html = renderLobby();

  if (ui.dialog === 'leave') html += renderLeaveDialog();
  const banner = !ui.connected
    ? '<div class="banner">Connexion à l\'hôte perdue, reconnexion en cours…</div>'
    : '';
  anim.snapshot($app); // positions des cartes avant redessin (pour les faire glisser)
  $app.innerHTML = banner + html;
  // Trajet des cartes animées, une fois la page en place.
  anim.afterRender($app);
  renderHelp();
}

function renderHome() {
  const code = normalizeCode(location.hash.slice(1));
  const saves = Object.entries(readSaves())
    .sort((a, b) => b[1].savedAt - a[1].savedAt)
    .slice(0, 10);
  const when = (t) => new Date(t).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
  return `<main class="home">
    <h1>🃏 Cartes entre amis</h1>
    <p class="subtitle">Belote, coinche, président, pouilleux et bataille, en connexion directe entre navigateurs.</p>
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
      saves.length
        ? `<div class="box saves">
            <h2>Parties sauvegardées</h2>
            ${saves
              .map(
                ([id, s]) => `<div class="save-row">
                  <div class="save-info">
                    <b>${esc(GAME_NAMES[s.game] || s.game)}</b> · ${esc((s.names || []).join(', '))}
                    <div class="muted">${!s.started ? 'Salon' : s.round ? `Manche ${s.round}` : 'En cours'} · ${esc(when(s.savedAt))}</div>
                  </div>
                  <button class="tiny" data-action="resume" data-id="${esc(id)}">Reprendre</button>
                  <button class="tiny secondary" data-action="delete-save" data-id="${esc(id)}" title="Supprimer">🗑</button>
                </div>`
              )
              .join('')}
           </div>`
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
  const watchers = L.players.filter((p) => !p.bot && !p.ghost && !seated.has(p.id));
  const full = L.seats.every(Boolean);
  const n = L.seats.length;
  const P = seatPositions(n);

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
    const team = L.teams ? `<div class="team-label">Équipe ${i % 2 === 0 ? 'A' : 'B'}</div>` : '';
    return `<div class="seat pos-${P[i]} ${L.teams ? `team-${i % 2}` : 'solo'} ${L.seats[i] === ui.myId ? 'me' : ''}">${inner}${team}</div>`;
  };

  const sel = (action, items, current) =>
    `<select data-action="${action}">${items
      .map(([value, label]) => `<option value="${esc(value)}" ${value === current ? 'selected' : ''}>${esc(label)}</option>`)
      .join('')}</select>`;

  const options = [];
  options.push(`<div>Jeu : ${isHost ? sel('opt-game', L.games.map((g) => [g.id, g.name]), L.game) : `<b>${esc(L.gameName)}</b>`}</div>`);
  if (L.minSeats !== L.maxSeats) {
    const counts = [];
    for (let k = L.minSeats; k <= L.maxSeats; k++) counts.push([k, `${k} joueurs`]);
    options.push(`<div>Places : ${isHost ? sel('opt-seats', counts, n) : `<b>${n} joueurs</b>`}</div>`);
  }
  if (L.targets) {
    const cur = L.targets.find((t) => t.value === L.target);
    options.push(
      `<div>Partie en : ${isHost ? sel('opt-target', L.targets.map((t) => [t.value, t.label]), L.target) : `<b>${esc(cur?.label ?? '')}</b>`}</div>`
    );
  }
  const variants = L.variants.length
    ? `<div class="variants">${L.variants
        .map((v) =>
          isHost
            ? `<label class="check"><input type="checkbox" data-action="opt-variant" data-key="${esc(v.key)}" ${v.on ? 'checked' : ''}> ${esc(v.label)}</label>`
            : `<div class="check">${v.on ? '✅' : '⬜'} ${esc(v.label)}</div>`
        )
        .join('')}</div>`
    : '';

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
    <p class="muted">Envoie ce lien à tes amis. Chacun clique sur une place pour s'asseoir.${
      L.teams ? ' Les partenaires sont face à face (Équipe A contre Équipe B).' : ''
    }</p>
    <div class="options">${options.join('')}</div>
    ${variants}
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
          : `<p class="waiting">L'hôte lancera la partie quand les ${n} places seront prises.</p>`
      }
      <button class="secondary" data-action="leave">Quitter</button>
    </div>
  </main>`;
}

// Écran de pause : qui est là, reprise des places, reprise de la partie.
function renderPause() {
  const L = ui.lobby;
  const isHost = ui.role === 'host';
  const mySeat = L.seats.indexOf(ui.myId);
  const rows = L.seats
    .map((pid, i) => {
      const p = L.players.find((x) => x.id === pid);
      const absent = p && !p.bot && !p.connected;
      const auto = L.autoplay[i];
      const status = p?.bot
        ? '🤖 robot'
        : pid === ui.myId
          ? '⭐ toi'
          : absent
            ? auto
              ? '🤖 remplacé par un robot'
              : '❌ absent'
            : '✅ présent';
      const btns = [];
      if (absent && pid !== L.hostId) {
        btns.push(`<button class="tiny" data-action="claim" data-seat="${i}">${mySeat >= 0 ? 'Prendre cette place' : "C'est ma place"}</button>`);
      }
      if (pid === ui.myId && !isHost) btns.push('<button class="tiny secondary" data-action="unclaim">Changer de place</button>');
      if (isHost && absent) {
        btns.push(`<button class="tiny secondary" data-action="autoplay" data-seat="${i}" data-on="${!auto}">${
          auto ? 'Sans robot' : 'Faire jouer un robot'
        }</button>`);
      }
      return `<tr><th>${esc(L.names?.[i] ?? p?.name ?? '?')}</th><td>${status}</td><td class="row-actions">${btns.join(' ')}</td></tr>`;
    })
    .join('');

  const actions = isHost
    ? `<button data-action="resume-game">▶ Reprendre la partie</button>
       <button class="secondary" data-action="copy">Copier le lien</button>
       <button class="secondary" data-action="leave-save">💾 Sauvegarder et quitter</button>`
    : '<p class="waiting">L\'hôte reprendra la partie quand tout le monde sera prêt.</p>';

  return `<div class="overlay"><div class="dialog">
    <h2>⏸ Partie en pause</h2>
    <p class="muted">${
      isHost
        ? `Code <b>${esc(L.code)}</b>. Envoie le lien aux absents : ceux qui reviennent avec le même prénom retrouvent leur place automatiquement.`
        : mySeat < 0
          ? 'Choisis ta place parmi les places libres.'
          : 'Si ce n\'est pas ta place, clique sur « Changer de place ».'
    }</p>
    <table class="result">${rows}</table>
    <div class="actions">${actions}</div>
  </div></div>`;
}

function renderLeaveDialog() {
  return `<div class="overlay"><div class="dialog">
    <h2>Quitter la partie ?</h2>
    <p>Tu es l'hôte : si tu quittes, la partie s'arrête pour tout le monde.
      Elle reste <b>sauvegardée sur cet appareil</b> et tu pourras la reprendre depuis l'accueil.</p>
    <div class="actions">
      <button data-action="leave-save">💾 Sauvegarder et quitter</button>
      <button class="secondary danger-text" data-action="leave-drop">Abandonner la partie</button>
      <button class="secondary" data-action="dialog-close">Annuler</button>
    </div>
  </div></div>`;
}

// Aide : rendue à part (#help) pour ne pas perdre le défilement des règles à chaque coup joué.
function renderHelp() {
  const mod = ui.view && GAME_UIS[ui.view.game];
  if (!ui.help || !mod || !ui.lobby?.started || ui.screen !== 'room') {
    if ($help.innerHTML) $help.innerHTML = '';
    ui.helpKey = null;
    return;
  }
  const key = ui.help === 'rules' ? `rules:${ui.view.game}:${JSON.stringify(ui.view.variants || {})}:${ui.view.target}` : null;
  if (key && key === ui.helpKey) return;
  ui.helpKey = key;
  const body = ui.help === 'rules' ? mod.rules(ui.view) : mod.objective(ui.view, gameCtx());
  const tab = (id, label) =>
    `<button class="tab ${ui.help === id ? 'active' : ''}" data-action="help-tab" data-tab="${id}">${label}</button>`;
  $help.innerHTML = `<div class="overlay help-overlay" data-action="help-close">
    <div class="dialog help" role="dialog" aria-label="Aide">
      <div class="help-tabs">
        ${tab('goal', '🎯 Objectif actuel')}${tab('rules', `📖 Règles : ${esc(GAME_NAMES[ui.view.game])}`)}
        <button class="tiny secondary close" data-action="help-close" aria-label="Fermer">✕</button>
      </div>
      <div class="help-body">${body}</div>
    </div>
  </div>`;
}

// ----------------------------------------------------------------- interactions

function onClick(e) {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled || el.tagName === 'SELECT' || el.tagName === 'INPUT') return;
  // Clic dans la fenêtre d'aide : on ne la ferme que si on clique sur le fond.
  if (el.classList.contains('help-overlay') && e.target !== el) return;
  const seat = el.dataset.seat !== undefined ? Number(el.dataset.seat) : undefined;

  switch (el.dataset.action) {
    case 'create':
      return createRoom();
    case 'resume': {
      const s = readSaves()[el.dataset.id];
      if (!s) return render();
      if (!requireName()) return;
      return createRoom(s.session);
    }
    case 'delete-save':
      if (!confirm('Supprimer cette partie sauvegardée ?')) return;
      writeSave(el.dataset.id, null);
      return render();
    case 'join':
      return joinRoom(el.dataset.code);
    case 'join-code':
      return joinRoom(document.getElementById('code').value);
    case 'copy': {
      const link = shareLink(ui.lobby.code);
      navigator.clipboard?.writeText(link).then(
        () => toast('Lien copié !'),
        () => {
          document.getElementById('share')?.select();
          toast(`Lien : ${link}`, 8000);
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
    case 'claim':
      return ui.send({ t: 'claim', seat });
    case 'unclaim':
      return ui.send({ t: 'unclaim' });
    case 'pause':
      return ui.send({ t: 'pause', on: true });
    case 'resume-game':
      return ui.send({ t: 'pause', on: false });
    case 'game':
      ui.selected = [];
      return ui.send({ t: 'action', action: JSON.parse(el.dataset.payload) });
    case 'select': {
      const c = el.dataset.card;
      ui.selected = ui.selected.includes(c) ? ui.selected.filter((x) => x !== c) : [...ui.selected, c];
      return render();
    }
    case 'last-trick':
      ui.showLast = !ui.showLast;
      return render();
    case 'help':
      ui.help = 'goal';
      return renderHelp();
    case 'help-tab':
      ui.help = el.dataset.tab;
      return renderHelp();
    case 'help-close':
      ui.help = null;
      return renderHelp();
    case 'leave':
      if (ui.role === 'host' && ui.lobby?.started) {
        ui.dialog = 'leave';
        return render();
      }
      if (!confirm(ui.role === 'host' ? "Tu es l'hôte : si tu quittes, le salon ferme pour tout le monde. Quitter ?" : 'Quitter la partie ?')) return;
      return backHome();
    case 'leave-save':
      return backHome('Partie sauvegardée : tu pourras la reprendre depuis cet écran.', true);
    case 'leave-drop':
      if (!confirm('Abandonner définitivement cette partie ?')) return;
      return backHome();
    case 'dialog-close':
      ui.dialog = null;
      return render();
    case 'leave-now':
      return backHome();
  }
}

document.addEventListener('click', onClick);

$app.addEventListener('change', (e) => {
  const t = e.target;
  switch (t.dataset.action) {
    case 'opt-game':
      return ui.send({ t: 'option', game: t.value });
    case 'opt-seats':
      return ui.send({ t: 'option', seats: Number(t.value) });
    case 'opt-target':
      return ui.send({ t: 'option', target: Number(t.value) });
    case 'opt-variant':
      return ui.send({ t: 'option', variants: { [t.dataset.key]: t.checked } });
    case 'field':
      ui.fields[t.dataset.key] = t.value;
      return render();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (ui.help) {
      ui.help = null;
      renderHelp();
    } else if (ui.dialog) {
      ui.dialog = null;
      render();
    }
    return;
  }
  if (e.key !== 'Enter') return;
  if (e.target.id === 'code') joinRoom(e.target.value);
  if (e.target.id === 'name') {
    const code = normalizeCode(location.hash.slice(1));
    code ? joinRoom(code) : createRoom();
  }
});

// L'hôte qui ferme l'onglet arrête la partie pour les autres : on le prévient
// (la partie reste sauvegardée et pourra être reprise).
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
