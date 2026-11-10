// Logique de l'hôte : salon (joueurs, places, robots) + état de la partie qui fait autorité.
// Indépendant du réseau et de l'affichage : on lui passe des objets `conn` ayant une méthode send(msg).
//
// Messages reçus des joueurs (champ `t`) :
//   hello {id, name} · ping · sit {seat} · stand · addBot {seat} · unseat {seat}
//   option {game?, seats?, target?, variants?} · start · action {action} · autoplay {seat, on}
//   restart · lobby · pause {on} · claim {seat} · unclaim
// Messages envoyés :
//   lobby {lobby} · state {view} · error {msg} · seated {seat, name} · ping

import { GAMES, waitingSeats } from './games/index.js';

const BOT_NAMES = ['Robot Ada', 'Robot Alan', 'Robot Grace', 'Robot Linus', 'Robot Margaret', 'Robot Dennis'];
const TIMEOUT_MS = 15000;
const norm = (s) => String(s || '').trim().toLowerCase();

export function defaultOptions(game) {
  const mod = GAMES[game];
  return {
    game,
    seats: mod.defaultSeats,
    target: mod.defaultTarget ?? null,
    variants: Object.fromEntries(mod.variants.map((v) => [v.key, v.default])),
  };
}

export class HostSession {
  constructor({ code, hostId, saveId = null, saved = null, onSave = null, delays = { bot: 900, trick: 1500 } }) {
    this.code = code;
    this.hostId = hostId;
    this.saveId = saveId;
    this.onSave = onSave;
    this.delays = delays;
    this.players = new Map(); // id -> { id, name, bot, ghost, connected, conn, lastSeen }
    this.options = defaultOptions('belote');
    this.seats = [];
    this.autoplay = [];
    this.started = false;
    this.paused = false;
    this.game = null;
    this.botCount = 0;
    this.ghostCount = 0;
    this.timer = null;
    this.resizeSeats(this.options.seats);
    if (saved) this.restore(saved);
  }

  get mod() {
    return GAMES[this.options.game];
  }

  // Change le nombre de places en gardant les joueurs assis autant que possible.
  resizeSeats(n) {
    const seats = Array(n).fill(null);
    const overflow = [];
    this.seats.forEach((id, i) => {
      if (!id) return;
      if (i < n) seats[i] = id;
      else overflow.push(id);
    });
    for (const id of overflow) {
      const p = this.players.get(id);
      if (p?.bot) {
        this.players.delete(id);
        continue;
      }
      const free = seats.indexOf(null);
      if (free >= 0) seats[free] = id;
    }
    this.seats = seats;
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
        this.setOptions(msg);
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
        this.paused = false;
        this.game = null;
        this.autoplay.fill(false);
        // Les places absentes sont libérées.
        this.seats = this.seats.map((s) => (s && this.players.get(s)?.ghost ? null : s));
        for (const [pid, q] of this.players) if (q.ghost) this.players.delete(pid);
        break;

      case 'pause':
        if (!isHost || !this.started) return;
        this.paused = !!msg.on;
        if (this.paused) this.stopTimer();
        break;

      case 'autoplay':
        // L'hôte peut faire jouer un robot à n'importe quelle place ; un joueur, à la sienne.
        if (!this.started || seatArg === null) return;
        if (!isHost && this.seats[seatArg] !== id) return;
        this.autoplay[seatArg] = !!msg.on;
        break;

      case 'claim':
        if (!this.started || seatArg === null) return;
        if (!this.canClaim(seatArg, id)) return err("Cette place n'est pas libre.");
        this.takeSeat(id, seatArg);
        break;

      case 'unclaim': {
        if (!this.started) return;
        const s = this.seats.indexOf(id);
        if (s < 0) return;
        this.leaveSeat(s);
        break;
      }

      case 'action': {
        if (!this.started || !this.game) return;
        if (this.paused) return err('La partie est en pause.');
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

  setOptions(msg) {
    if (typeof msg.game === 'string' && Object.hasOwn(GAMES, msg.game) && msg.game !== this.options.game) {
      this.options = defaultOptions(msg.game);
      this.resizeSeats(this.options.seats);
    }
    const mod = this.mod;
    if (Number.isInteger(msg.seats) && msg.seats >= mod.minSeats && msg.seats <= mod.maxSeats) {
      this.options.seats = msg.seats;
      this.resizeSeats(msg.seats);
    }
    if (mod.targets?.includes(msg.target)) this.options.target = msg.target;
    if (msg.variants && typeof msg.variants === 'object') {
      for (const v of mod.variants) {
        if (typeof msg.variants[v.key] === 'boolean') this.options.variants[v.key] = msg.variants[v.key];
      }
    }
  }

  onHello(id, msg, conn) {
    const name = String(msg.name || '').trim().slice(0, 20) || 'Joueur';
    let p = this.players.get(id);
    if (p && !p.bot && !p.ghost) {
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
    const seat = this.seats.indexOf(id);
    if (seat >= 0) {
      // Un joueur qui revient reprend sa place (le robot de remplacement s'arrête).
      this.autoplay[seat] = false;
    } else if (this.started) {
      // Partie reprise : on replace automatiquement le joueur qui a le même pseudo qu'une place absente.
      const s = this.seats.findIndex((sid, i) => this.canClaim(i, id) && norm(this.seatName(i)) === norm(name));
      if (s >= 0) {
        this.takeSeat(id, s);
        this.sendTo(p, { t: 'seated', seat: s, name: this.seatName(s) });
      }
    }
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
      if (p.bot || p.ghost || p.id === this.hostId || !p.connected) continue;
      if (now - (p.lastSeen || 0) > TIMEOUT_MS) {
        p.connected = false;
        changed = true;
      } else {
        this.sendTo(p, { t: 'ping' });
      }
    }
    if (changed) this.update();
  }

  // ------------------------------------------------------------------ places pendant la partie

  seatName(seat) {
    return this.game?.names?.[seat] ?? this.players.get(this.seats[seat])?.name ?? '';
  }

  // Une place est libre si son joueur humain est absent.
  canClaim(seat, id) {
    const q = this.players.get(this.seats[seat]);
    return !!q && !q.bot && !q.connected && q.id !== id && q.id !== this.hostId;
  }

  takeSeat(id, seat) {
    const prev = this.seats.indexOf(id);
    if (prev >= 0) this.leaveSeat(prev);
    const old = this.players.get(this.seats[seat]);
    if (old && !old.bot) this.players.delete(old.id);
    this.seats[seat] = id;
    this.autoplay[seat] = false;
    const p = this.players.get(id);
    if (this.game?.names && p) this.game.names[seat] = p.name;
  }

  // La place redevient « absente » (joueur fantôme) pour qu'un autre puisse la reprendre.
  leaveSeat(seat) {
    const ghost = { id: `ghost-${++this.ghostCount}`, name: this.seatName(seat), bot: false, ghost: true, connected: false, conn: null };
    this.players.set(ghost.id, ghost);
    this.seats[seat] = ghost.id;
  }

  // ------------------------------------------------------------------ partie

  startGame() {
    this.stopTimer();
    const names = this.seats.map((id) => this.players.get(id)?.name || '?');
    this.game = this.mod.createGame({ names, target: this.options.target, variants: { ...this.options.variants } });
    this.started = true;
    this.paused = false;
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

  // Programme la prochaine action automatique (ramasser le pli, coups des robots).
  schedule() {
    if (this.timer || !this.game || this.paused) return;
    const g = this.game;
    const mod = this.mod;
    let delay;
    if (mod.systemAction(g)) delay = mod.delays?.system ?? this.delays.trick;
    else if (waitingSeats(mod, g).some((s) => this.isAuto(s))) delay = mod.delays?.bot ?? this.delays.bot;
    else return;

    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.game !== g || this.paused) return;
      const sys = mod.systemAction(g);
      if (sys) {
        mod.applyAction(g, 'system', sys);
      } else {
        for (const s of waitingSeats(mod, g)) {
          if (!this.isAuto(s) || !waitingSeats(mod, g).includes(s)) continue;
          const a = mod.botAction(g, s);
          const error = a && mod.applyAction(g, s, a);
          if (error) console.error('[robot] action refusée', a, error);
        }
      }
      this.update();
    }, delay);
  }

  // ------------------------------------------------------------------ diffusion

  lobbyData() {
    const mod = this.mod;
    return {
      code: this.code,
      hostId: this.hostId,
      game: this.options.game,
      gameName: mod.name,
      games: Object.values(GAMES).map((m) => ({ id: m.id, name: m.name })),
      minSeats: mod.minSeats,
      maxSeats: mod.maxSeats,
      teams: !!mod.teams,
      target: this.options.target,
      targets: mod.targets ? mod.targets.map((t) => ({ value: t, label: mod.targetLabel(t) })) : null,
      variants: mod.variants.map((v) => ({ key: v.key, label: v.label, on: !!this.options.variants[v.key] })),
      started: this.started,
      paused: this.paused,
      names: this.game?.names ?? null,
      seats: this.seats,
      autoplay: this.autoplay,
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        name: p.name,
        bot: p.bot,
        ghost: !!p.ghost,
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
      if (p.bot || p.ghost) continue;
      this.sendTo(p, { t: 'lobby', lobby });
      if (this.started && this.game) {
        this.sendTo(p, { t: 'state', view: this.mod.view(this.game, this.seats.indexOf(p.id)) });
      }
    }
    this.save();
    this.schedule();
  }

  // ------------------------------------------------------------------ sauvegarde (reprise plus tard)

  snapshot() {
    return {
      code: this.code,
      hostId: this.hostId,
      saveId: this.saveId,
      savedAt: Date.now(),
      options: this.options,
      seats: this.seats,
      autoplay: this.autoplay,
      started: this.started,
      paused: this.paused,
      game: this.game,
      botCount: this.botCount,
      ghostCount: this.ghostCount,
      players: [...this.players.values()].map(({ id, name, bot, ghost }) => ({ id, name, bot, ghost: !!ghost })),
    };
  }

  save() {
    if (this.onSave) this.onSave(this.snapshot());
  }

  // Reprise d'une sauvegarde : l'hôte peut avoir changé d'identifiant (nouvel onglet),
  // les autres joueurs sont considérés absents, et la partie repart en pause.
  restore(s) {
    const oldHost = s.hostId;
    const map = (id) => (id && id === oldHost ? this.hostId : id);
    const game = Object.hasOwn(GAMES, s.options?.game) ? s.options.game : 'belote';
    this.saveId = s.saveId || this.saveId;
    this.options = { ...defaultOptions(game), ...s.options };
    this.seats = s.seats.map(map);
    this.autoplay = s.autoplay;
    this.started = s.started;
    this.game = s.game;
    this.paused = !!s.started && s.game?.phase !== 'gameOver';
    this.botCount = s.botCount || 0;
    this.ghostCount = s.ghostCount || 0;
    for (const p of s.players) {
      const id = map(p.id);
      this.players.set(id, { ...p, id, connected: !!p.bot, conn: null });
    }
  }
}
