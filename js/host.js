// Logique de l'hôte : salon (joueurs, places, robots) + état de la partie qui fait autorité.
// Indépendant du réseau et de l'affichage : on lui passe des objets `conn` ayant une méthode send(msg).
//
// Messages reçus des joueurs (champ `t`) :
//   hello {id, name} · ping · sit {seat} · stand · addBot {seat} · unseat {seat}
//   option {target} · start · action {action} · autoplay {seat, on} · restart · lobby
// Messages envoyés :
//   lobby {lobby} · state {view} · error {msg} · ping

import { GAMES } from './games/index.js';

const BOT_NAMES = ['Robot Ada', 'Robot Alan', 'Robot Grace', 'Robot Linus', 'Robot Margaret', 'Robot Dennis'];
const TIMEOUT_MS = 15000;

export class HostSession {
  constructor({ code, hostId, saved = null, onSave = null, delays = { bot: 900, trick: 1500 } }) {
    this.code = code;
    this.hostId = hostId;
    this.onSave = onSave;
    this.delays = delays;
    this.players = new Map(); // id -> { id, name, bot, connected, conn, lastSeen }
    this.options = { game: 'belote', target: 1000 };
    this.seats = [];
    this.autoplay = [];
    this.started = false;
    this.game = null;
    this.botCount = 0;
    this.timer = null;
    this.resetSeats();
    if (saved) this.restore(saved);
  }

  get mod() {
    return GAMES[this.options.game];
  }

  resetSeats() {
    const n = this.mod.seatCount;
    this.seats = Array(n).fill(null);
    this.autoplay = Array(n).fill(false);
  }

  // ------------------------------------------------------------------ messages

  receive(id, msg, conn) {
    try {
      this.handle(id, msg, conn);
    } catch (e) {
      console.error('[hôte] message ignoré', msg, e);
    }
  }

  handle(id, msg, conn) {
    if (!msg || typeof msg !== 'object' || typeof id !== 'string') return;
    if (msg.t === 'hello') return this.onHello(id, msg, conn);

    const p = this.players.get(id);
    if (!p) return;
    p.lastSeen = Date.now();
    if (!p.connected && p.conn === conn) {
      p.connected = true;
      this.update();
    }

    const isHost = id === this.hostId;
    const err = (text) => this.sendTo(p, { t: 'error', msg: text });
    const seatArg = Number.isInteger(msg.seat) && msg.seat >= 0 && msg.seat < this.seats.length ? msg.seat : null;

    switch (msg.t) {
      case 'ping':
        return;

      case 'sit':
        if (this.started) return err('La partie a déjà commencé.');
        if (seatArg === null) return;
        if (this.seats[seatArg] && this.seats[seatArg] !== id) return err('Cette place est déjà prise.');
        this.seats = this.seats.map((s) => (s === id ? null : s));
        this.seats[seatArg] = id;
        break;

      case 'stand':
        if (this.started) return;
        this.seats = this.seats.map((s) => (s === id ? null : s));
        break;

      case 'addBot': {
        if (!isHost || this.started || seatArg === null || this.seats[seatArg]) return;
        const botId = `bot-${++this.botCount}`;
        const name = BOT_NAMES[(this.botCount - 1) % BOT_NAMES.length];
        this.players.set(botId, { id: botId, name, bot: true, connected: true, conn: null });
        this.seats[seatArg] = botId;
        break;
      }

      case 'unseat': {
        if (!isHost || this.started || seatArg === null) return;
        const target = this.players.get(this.seats[seatArg]);
        if (target?.bot) this.players.delete(target.id);
        this.seats[seatArg] = null;
        break;
      }

      case 'option':
        if (!isHost || this.started) return;
        if (Number.isInteger(msg.target) && msg.target >= 100 && msg.target <= 10000) this.options.target = msg.target;
        break;

      case 'start':
      case 'restart':
        if (!isHost) return;
        if (this.seats.some((s) => !s)) return err('Il faut que toutes les places soient occupées.');
        this.startGame();
        break;

      case 'lobby':
        if (!isHost) return;
        this.stopTimer();
        this.started = false;
        this.game = null;
        this.autoplay.fill(false);
        break;

      case 'autoplay':
        if (!isHost || !this.started || seatArg === null) return;
        this.autoplay[seatArg] = !!msg.on;
        break;

      case 'action': {
        if (!this.started || !this.game) return;
        const seat = this.seats.indexOf(id);
        if (seat < 0) return err('Tu es spectateur.');
        if (this.autoplay[seat]) this.autoplay[seat] = false; // le joueur reprend la main
        const error = this.mod.applyAction(this.game, seat, msg.action);
        if (error) return err(error);
        break;
      }

      default:
        return;
    }
    this.update();
  }

  onHello(id, msg, conn) {
    const name = String(msg.name || '').trim().slice(0, 20) || 'Joueur';
    let p = this.players.get(id);
    if (p && !p.bot) {
      p.name = name;
      p.conn = conn;
      p.connected = true;
    } else if (!p) {
      p = { id, name, bot: false, connected: true, conn };
      this.players.set(id, p);
    } else {
      return;
    }
    p.lastSeen = Date.now();
    // Un joueur qui revient reprend sa place (le robot de remplacement s'arrête).
    const seat = this.seats.indexOf(id);
    if (seat >= 0) this.autoplay[seat] = false;
    this.update();
  }

  disconnected(id, conn) {
    const p = this.players.get(id);
    if (!p || p.conn !== conn) return; // une connexion plus récente existe
    p.connected = false;
    p.conn = null;
    if (!this.started && !p.bot) {
      // Avant la partie, on libère sa place et on l'oublie.
      this.seats = this.seats.map((s) => (s === id ? null : s));
      this.players.delete(id);
    }
    this.update();
  }

  // À appeler régulièrement : ping + détection des joueurs silencieux.
  tick() {
    const now = Date.now();
    let changed = false;
    for (const p of this.players.values()) {
      if (p.bot || p.id === this.hostId || !p.connected) continue;
      if (now - (p.lastSeen || 0) > TIMEOUT_MS) {
        p.connected = false;
        changed = true;
      } else {
        this.sendTo(p, { t: 'ping' });
      }
    }
    if (changed) this.update();
  }

  // ------------------------------------------------------------------ partie

  startGame() {
    this.stopTimer();
    const names = this.seats.map((id) => this.players.get(id)?.name || '?');
    this.game = this.mod.createGame({ names, target: this.options.target });
    this.started = true;
    this.autoplay.fill(false);
  }

  isAuto(seat) {
    const p = this.players.get(this.seats[seat]);
    return !!p && (p.bot || this.autoplay[seat]);
  }

  stopTimer() {
    clearTimeout(this.timer);
    this.timer = null;
  }

  // Programme la prochaine action automatique (ramasser le pli, coup d'un robot).
  schedule() {
    if (this.timer || !this.game) return;
    const g = this.game;
    const mod = this.mod;
    let delay;
    if (mod.systemAction(g)) delay = this.delays.trick;
    else if (g.turn !== null && g.turn !== undefined && this.isAuto(g.turn)) delay = this.delays.bot;
    else return;

    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.game !== g) return;
      const sys = mod.systemAction(g);
      if (sys) {
        mod.applyAction(g, 'system', sys);
      } else if (g.turn !== null && this.isAuto(g.turn)) {
        const a = mod.botAction(g, g.turn);
        const error = a && mod.applyAction(g, g.turn, a);
        if (error) console.error('[robot] action refusée', a, error);
      }
      this.update();
    }, delay);
  }

  // ------------------------------------------------------------------ diffusion

  lobbyData() {
    return {
      code: this.code,
      hostId: this.hostId,
      game: this.options.game,
      gameName: this.mod.name,
      target: this.options.target,
      targets: this.mod.targets,
      started: this.started,
      seats: this.seats,
      autoplay: this.autoplay,
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        name: p.name,
        bot: p.bot,
        connected: p.connected,
      })),
    };
  }

  sendTo(p, msg) {
    if (!p.conn || !p.connected) return;
    try {
      p.conn.send(msg);
    } catch (e) {
      console.warn('[hôte] envoi impossible à', p.name, e);
    }
  }

  update() {
    const lobby = this.lobbyData();
    for (const p of this.players.values()) {
      if (p.bot) continue;
      this.sendTo(p, { t: 'lobby', lobby });
      if (this.started && this.game) {
        this.sendTo(p, { t: 'state', view: this.mod.view(this.game, this.seats.indexOf(p.id)) });
      }
    }
    this.save();
    this.schedule();
  }

  // ------------------------------------------------------------------ sauvegarde (rechargement de page de l'hôte)

  save() {
    if (!this.onSave) return;
    this.onSave({
      code: this.code,
      options: this.options,
      seats: this.seats,
      autoplay: this.autoplay,
      started: this.started,
      game: this.game,
      botCount: this.botCount,
      players: [...this.players.values()].map(({ id, name, bot }) => ({ id, name, bot })),
    });
  }

  restore(s) {
    this.options = { ...this.options, ...s.options };
    this.seats = s.seats;
    this.autoplay = s.autoplay;
    this.started = s.started;
    this.game = s.game;
    this.botCount = s.botCount || 0;
    for (const p of s.players) {
      this.players.set(p.id, { ...p, connected: p.bot, conn: null });
    }
  }
}
