// Teste la logique de l'hôte : options du salon, pause, sauvegarde / reprise, reprise des places.
import assert from 'node:assert/strict';
import { HostSession } from '../js/host.js';

const conn = () => ({ msgs: [], send(m) { this.msgs.push(m); } });
const last = (c, t) => [...c.msgs].reverse().find((m) => m.t === t);

let saved = null;
const host = new HostSession({ code: 'ABCDE', hostId: 'h', saveId: 's-1', onSave: (d) => (saved = d), delays: { bot: 5, trick: 5 } });
const ch = conn();
const ca = conn();
host.receive('h', { t: 'hello', name: 'Hélène' }, ch);
host.receive('a', { t: 'hello', name: 'Alex' }, ca);

// ---- options du salon
host.receive('a', { t: 'option', game: 'president' }, ca);
assert.equal(host.options.game, 'belote', 'seul l\'hôte change les options');
host.receive('h', { t: 'sit', seat: 0 }, ch);
host.receive('a', { t: 'sit', seat: 3 }, ca);
host.receive('h', { t: 'option', game: 'president' }, ch);
assert.equal(host.seats.length, 4);
host.receive('h', { t: 'option', seats: 3 }, ch);
assert.equal(host.seats.length, 3);
assert.ok(host.seats.includes('a'), 'le joueur assis au-delà garde une place');
host.receive('h', { t: 'option', seats: 9 }, ch);
assert.equal(host.seats.length, 3, 'nombre de places hors limites refusé');
host.receive('h', { t: 'option', target: 10 }, ch);
assert.equal(host.options.target, 10);
host.receive('h', { t: 'option', game: 'coinche' }, ch);
assert.equal(host.seats.length, 4);
assert.deepEqual(host.options.variants, { sansToutAtout: true, annonces: true });
host.receive('h', { t: 'option', variants: { annonces: false, inconnu: true } }, ch);
assert.deepEqual(host.options.variants, { sansToutAtout: true, annonces: false });
assert.equal(last(ca, 'lobby').lobby.game, 'coinche');

// ---- partie
const free = () => host.seats.indexOf(null);
host.receive('h', { t: 'addBot', seat: free() }, ch);
host.receive('h', { t: 'addBot', seat: free() }, ch);
host.receive('h', { t: 'start' }, ch);
assert.ok(host.started);
assert.equal(host.game.game, 'coinche');
assert.equal(host.game.variants.annonces, false);

// ---- pause
host.receive('a', { t: 'pause', on: true }, ca);
assert.equal(host.paused, false, 'seul l\'hôte met en pause');
host.receive('h', { t: 'pause', on: true }, ch);
assert.equal(host.paused, true);
assert.equal(host.timer, null, 'les robots s\'arrêtent');
const aSeat = host.seats.indexOf('a');
host.receive('a', { t: 'action', action: { type: 'pass' } }, ca);
assert.match(last(ca, 'error').msg, /pause/);
assert.equal(last(ca, 'lobby').lobby.paused, true);

// ---- sauvegarde puis reprise dans un nouvel onglet (nouvel identifiant d'hôte)
assert.ok(saved && saved.started && saved.saveId === 's-1');
const snapshot = JSON.parse(JSON.stringify(saved));
host.receive('h', { t: 'pause', on: false }, ch);
host.stopTimer();

const host2 = new HostSession({ code: 'ZZZZZ', hostId: 'h2', saved: snapshot, delays: { bot: 5, trick: 5 } });
assert.equal(host2.saveId, 's-1');
assert.equal(host2.paused, true, 'une partie reprise démarre en pause');
assert.equal(host2.seats[snapshot.seats.indexOf('h')], 'h2', "l'hôte retrouve sa place");
assert.equal(host2.players.get('a').connected, false);
const ch2 = conn();
host2.receive('h2', { t: 'hello', name: 'Hélène' }, ch2);

// Un ami revient avec un nouvel identifiant et le même pseudo : replacé automatiquement.
const cb = conn();
host2.receive('b', { t: 'hello', name: '  alex ' }, cb);
assert.equal(host2.seats[aSeat], 'b');
assert.ok(!host2.players.has('a'));
assert.deepEqual(last(cb, 'seated'), { t: 'seated', seat: aSeat, name: 'alex' });
assert.equal(last(cb, 'state').view.seat, aSeat);

// Il s'est trompé : il libère la place (elle redevient absente), puis la reprend.
host2.receive('b', { t: 'unclaim' }, cb);
const ghost = host2.players.get(host2.seats[aSeat]);
assert.ok(ghost.ghost && !ghost.connected);
assert.equal(ghost.name, host2.game.names[aSeat]);
host2.receive('b', { t: 'claim', seat: aSeat }, cb);
assert.equal(host2.seats[aSeat], 'b');

// Un autre ne peut pas prendre une place occupée par un joueur présent, ni celle de l'hôte.
const cc = conn();
host2.receive('c', { t: 'hello', name: 'Camille' }, cc);
host2.receive('c', { t: 'claim', seat: aSeat }, cc);
assert.equal(host2.seats[aSeat], 'b');
host2.receive('c', { t: 'claim', seat: host2.seats.indexOf('h2') }, cc);
assert.ok(host2.seats.includes('h2'));
assert.ok(last(cc, 'error'));

// Reprise du jeu
host2.receive('h2', { t: 'pause', on: false }, ch2);
assert.equal(host2.paused, false);
host2.stopTimer();

console.log('OK : salon, pause, sauvegarde/reprise et reprise des places.');
