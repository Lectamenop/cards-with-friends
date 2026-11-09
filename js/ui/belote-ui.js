// Affichage de la table de belote à partir de la vue envoyée par l'hôte.
import { SUITS, SUIT_SYMBOL, SUIT_NAME, suitOf, isRed } from '../cards.js';
import { esc, cardHTML, backsHTML, payload } from './dom.js';

const POSITIONS = ['bottom', 'right', 'top', 'left'];

export function render(v, ctx) {
  const me = v.seat >= 0 ? v.seat : 0; // un spectateur regarde depuis le siège 0
  const pos = (s) => POSITIONS[(s - me + 4) % 4];
  const name = (s) => esc(v.names[s]);
  const teamName = (t) => `${name(t)} &amp; ${name(t + 2)}`;
  const myTeam = v.seat >= 0 ? v.seat % 2 : null;
  const myTurn = v.seat >= 0 && v.turn === v.seat;
  const suitHTML = (s) => `<span class="suit ${isRed(s) ? 'red' : 'black'}">${SUIT_SYMBOL[s]}</span>`;

  // ---- en-tête : scores + atout
  const scores = [0, 1]
    .map(
      (t) => `<div class="score ${myTeam === t ? 'mine' : ''}">
        <span class="team">${teamName(t)}${myTeam === t ? ' (vous)' : ''}</span>
        <b>${v.scores[t]}</b></div>`
    )
    .join('');
  const trumpInfo = v.trump
    ? `Atout ${suitHTML(v.trump)} <small>pris par ${name(v.taker)}</small>`
    : `<small>Enchères ${v.phase === 'bidding2' ? '(2e tour)' : ''}</small>`;

  // ---- badges des joueurs
  const badge = (s) => {
    const pid = ctx.lobby.seats[s];
    const p = ctx.lobby.players.find((x) => x.id === pid);
    const auto = ctx.lobby.autoplay[s];
    const status = p?.bot ? '🤖' : !p?.connected ? '<span title="Déconnecté">🔌</span>' : auto ? '🤖' : '';
    const chips = [
      s === v.dealer ? '<span class="chip">Donneur</span>' : '',
      s === v.taker ? `<span class="chip taker">Preneur ${SUIT_SYMBOL[v.trump]}</span>` : '',
    ].join('');
    const hostBtn =
      ctx.isHost && p && !p.bot && p.id !== ctx.myId && (!p.connected || auto)
        ? `<button class="tiny" data-action="autoplay" data-seat="${s}" data-on="${!auto}">${
            auto ? 'Arrêter le robot' : 'Faire jouer un robot'
          }</button>`
        : '';
    const showBacks = s !== v.seat && v.handCounts[s] > 0;
    return `<div class="player pos-${pos(s)} team-${s % 2} ${v.turn === s ? 'active' : ''}">
      <div class="pname">${status} ${name(s)}${s === v.seat ? ' (toi)' : ''}</div>
      <div class="chips">${chips}</div>
      ${showBacks ? backsHTML(v.handCounts[s]) : ''}
      ${hostBtn}
    </div>`;
  };

  // ---- centre de la table
  let center = '';
  if (v.phase === 'bidding1' || v.phase === 'bidding2') {
    const turnSuit = suitOf(v.turnCard);
    let controls;
    if (myTurn && v.phase === 'bidding1') {
      controls = `<button ${payload({ type: 'take' })}>Prendre à ${suitHTML(turnSuit)}</button>
        <button class="secondary" ${payload({ type: 'pass' })}>Passer</button>`;
    } else if (myTurn) {
      controls =
        SUITS.filter((s) => s !== turnSuit)
          .map((s) => `<button ${payload({ type: 'choose', suit: s })}>${suitHTML(s)} ${SUIT_NAME[s]}</button>`)
          .join('') + `<button class="secondary" ${payload({ type: 'pass' })}>Passer</button>`;
    } else {
      controls = `<p class="waiting">${name(v.turn)} réfléchit…</p>`;
    }
    center = `<div class="bidding">
      <div class="label">${v.phase === 'bidding1' ? '1er tour' : '2e tour : choisis une autre couleur'}</div>
      ${cardHTML(v.turnCard)}
      <div class="bid-buttons">${controls}</div>
    </div>`;
  } else if (ctx.showLast && v.lastTrick) {
    center = trickHTML(v.lastTrick.cards, v.lastTrick.winner, pos, 'Dernier pli');
  } else if (v.phase === 'playing' || v.phase === 'trickEnd') {
    center = trickHTML(v.trick, v.trickWinner, pos, '');
  }

  // ---- ma main
  const hand =
    v.seat >= 0
      ? `<div class="hand ${myTurn && v.phase === 'playing' ? 'my-turn' : ''}">
        ${v.hand
          .map((c) => {
            const playable = v.legal.includes(c);
            const inPlay = v.phase === 'playing' && myTurn;
            return cardHTML(c, {
              playable: inPlay && playable,
              disabled: inPlay && !playable,
              attrs: inPlay && playable ? payload({ type: 'play', card: c }) : '',
            });
          })
          .join('')}
      </div>`
      : '<p class="waiting">Tu regardes la partie en spectateur.</p>';

  const hint = myTurn
    ? v.phase === 'playing'
      ? 'À toi de jouer !'
      : 'À toi de parler !'
    : v.turn !== null && v.turn !== undefined
      ? `Au tour de ${name(v.turn)}`
      : '';

  // ---- fenêtres de fin de manche / partie
  let overlay = '';
  if (v.phase === 'roundEnd' || v.phase === 'gameOver') {
    const r = v.roundResult;
    const row = (label, vals) => `<tr><th>${label}</th><td>${vals[0]}</td><td>${vals[1]}</td></tr>`;
    const table = `<table class="result">
      <tr><th></th><th>${teamName(0)}</th><th>${teamName(1)}</th></tr>
      ${row('Points des plis', r.raw)}
      ${row('Belote', r.bel)}
      ${row('Marqués', r.gained.map((g) => `<b>+${g}</b>`))}
      ${row('Total', v.scores.map((s) => `<b>${s}</b>`))}
    </table>`;
    let actions;
    if (v.phase === 'roundEnd') {
      actions = v.seat >= 0 ? `<button ${payload({ type: 'next' })}>Manche suivante</button>` : '';
    } else if (ctx.isHost) {
      actions = `<button data-action="restart">Rejouer</button>
        <button class="secondary" data-action="back-lobby">Retour au salon</button>`;
    } else {
      actions = "<p class=\"waiting\">En attente de l'hôte…</p>";
    }
    const title =
      v.phase === 'gameOver'
        ? `🏆 Victoire de ${teamName(v.winner)} !`
        : `${name(r.taker)} a pris à ${suitHTML(r.trump)} : ${esc(r.outcome)}`;
    overlay = `<div class="overlay"><div class="dialog">
      <h2>${title}</h2>
      ${v.phase === 'gameOver' ? `<p>${esc(r.outcome)}</p>` : ''}
      ${table}
      <div class="actions">${actions}</div>
    </div></div>`;
  }

  const events = v.events
    .slice(-4)
    .map((e) => `<li>${esc(e.text)}</li>`)
    .join('');

  return `<div class="game">
    <header class="topbar">
      <div class="scores">${scores}<div class="target">objectif ${v.target}</div></div>
      <div class="trump">${trumpInfo}</div>
      <div class="menu">
        <button class="tiny secondary" data-action="last-trick" ${v.lastTrick ? '' : 'disabled'}>
          ${ctx.showLast ? 'Cacher' : 'Dernier pli'}</button>
        <button class="tiny secondary" data-action="leave">Quitter</button>
      </div>
    </header>
    <div class="table">
      ${[0, 1, 2, 3].map(badge).join('')}
      <div class="center">${center}</div>
    </div>
    <div class="hint">${hint}</div>
    ${hand}
    <ul class="events">${events}</ul>
    ${overlay}
  </div>`;
}

function trickHTML(trick, winner, pos, label) {
  return `<div class="trick">
    ${label ? `<div class="label">${label}</div>` : ''}
    ${trick.map((p) => cardHTML(p.card, { extra: `at-${pos(p.seat)} ${p.seat === winner ? 'winner' : ''}` })).join('')}
  </div>`;
}
