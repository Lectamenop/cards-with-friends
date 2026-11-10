// Affichage du pouilleux.
import { cardLabel } from '../cards.js';
import { esc, cardHTML, payload } from './dom.js';
import { nameOf, posFn, playerBadge, chip, menuHTML, eventsHTML, handHTML, dialogHTML, endActions, ul, DEAL_SRC } from './common.js';
import { since, running, flyOut, infoHTML, dealGhosts, passGhosts } from './anim.js';

// Carte piochée qui vole du paquet du voisin vers celui qui pioche, puis paire défaussée au centre.
function drawFx(v) {
  const me = v.seat;
  // Distribution, puis chacun défausse ses paires au centre.
  let html = dealGhosts(`deal:${v.dealId}`, v.names.map((_, s) => s).filter((s) => s !== me), { perSeat: 3 });
  v.initialPairs.forEach((pairs, s) => {
    if (pairs) html += passGhosts(`pairs:${v.dealId}:${s}`, `deck-${s}`, 'deal-src', 2, { delay: 700 + s * 60 });
  });
  const d = v.lastDraw;
  if (!d) return html ? `<div class="fx-layer">${html}</div>` : '';
  // Si c'est moi qui pioche, la carte arrive directement dans ma main (voir enter).
  const fly = d.to !== me && flyOut(`d:${d.id}`, `deck-${d.to}`, 650);
  if (fly) {
    const face = d.card ? cardHTML(d.card) : '<div class="card back-card"></div>';
    html += `<div class="fx-card fly-through" style="${fly.style}" data-fly-from="deck-${d.from}" ${
      d.from === me && d.card ? `data-from-card="${d.card}"` : ''
    } data-fly-to="deck-${d.to}">${face}</div>`;
  }
  const pop = d.paired ? running(since(`pair:${d.id}`), 1300, 550) : null;
  if (pop) html += `<div class="fx-pair" style="${pop}">${d.pair.map((c) => cardHTML(c)).join('')}</div>`;
  return html ? `<div class="fx-layer">${html}</div>` : '';
}

const backRow = (n, clickable) =>
  `<div class="draw-row" style="--n:${Math.max(n, 1)}">${Array.from({ length: n }, (_, i) =>
    clickable
      ? `<div class="card back-card playable" ${payload({ type: 'draw', index: i })} title="Piocher cette carte"></div>`
      : '<div class="card back-card"></div>'
  ).join('')}</div>`;

export function render(v, ctx) {
  const pos = posFn(v);
  const name = (s) => nameOf(v, s);
  const me = v.seat;
  const myTurn = me >= 0 && v.phase === 'playing' && v.turn === me;

  const chips = (s) => {
    if (v.out.includes(s)) return chip('Sauvé ✔', 'taker');
    if (v.loser === s) return chip('🐒 Pouilleux !', 'danger');
    return '';
  };

  let center = '';
  if (v.phase === 'playing') {
    const src = v.source;
    center = `<div class="bidding">
      <div class="label">${myTurn ? `Pioche une carte chez <b>${name(src)}</b>` : `${name(v.turn)} pioche chez ${name(src)}`}</div>
      ${backRow(v.handCounts[src], myTurn)}
    </div>`;
  }
  center = DEAL_SRC + center + drawFx(v);

  let hint = '';
  const d = v.lastDraw;
  if (d?.card && d.to === me) hint = `Tu as pioché ${esc(cardLabel(d.card))} chez ${name(d.from)}${d.paired ? ' : paire défaussée !' : '.'}`;
  else if (d?.card && d.from === me) hint = `${name(d.to)} t'a pris ${esc(cardLabel(d.card))}.`;
  if (myTurn) hint = (hint ? hint + ' ' : '') + 'À toi de piocher !';
  else if (v.phase === 'playing' && !hint) hint = `Au tour de ${name(v.turn)}`;

  // Messages d'info sur la dernière pioche.
  let info = null;
  if (d) {
    const key = `di:${d.id}`;
    if (d.to === me && d.card === 'JS') info = { key, text: '🐒 Aïe, tu as pioché le pouilleux !' };
    else if (d.from === me && d.card === 'JS') info = { key, text: `😅 Ouf ! ${name(d.to)} t'a pris le pouilleux` };
    else if (d.paired) info = { key, text: `✨ ${name(d.to)} défausse une paire : ${d.pair.map((c) => esc(cardLabel(c))).join(' + ')}` };
  }

  const hand =
    me < 0
      ? '<p class="waiting">Tu regardes la partie en spectateur.</p>'
      : v.hand.length
        ? handHTML(v.hand, {
            id: `deck-${me}`,
            enter: (c) => (d && d.to === me && d.card === c ? `deck-${d.from}` : 'deal-src'),
          })
        : '<p class="waiting">Tu n\'as plus de cartes : tu es sauvé !</p>';

  const overlay =
    v.phase === 'gameOver'
      ? dialogHTML({
          title: v.loser === null ? 'Partie terminée' : `🐒 ${name(v.loser)} est le pouilleux !`,
          body: `<p>Ordre de sortie : ${v.out.map(name).join(', ')}.</p>`,
          actions: endActions(v, ctx),
        })
      : '';

  return `<div class="game">
    <header class="topbar">
      <div class="trump">🐒 Pouilleux <small>${v.out.length} joueur${v.out.length > 1 ? 's' : ''} sauvé${v.out.length > 1 ? 's' : ''}</small></div>
      ${menuHTML(v, ctx)}
    </header>
    <div class="table">
      ${v.names.map((_, s) => playerBadge(v, ctx, s, { pos, chips: chips(s), active: v.turn === s })).join('')}
      <div class="center">${center}</div>
    </div>
    ${infoHTML(info?.key, info?.text, hint)}
    ${hand}
    ${eventsHTML(v)}
    ${overlay}
  </div>`;
}

export function objective(v) {
  const me = v.seat;
  if (me < 0) return '<p>Tu regardes la partie en spectateur.</p>';
  const parts = ['<p>But : <b>ne pas finir avec le valet de pique</b> (le pouilleux). Débarrasse-toi de tes cartes en formant des paires.</p>'];
  const hasPouilleux = v.hand.includes('JS');
  if (v.phase === 'gameOver') {
    parts.push(v.loser === me ? '<p>Perdu : tu as gardé le pouilleux…</p>' : '<p>Partie terminée, tu as échappé au pouilleux !</p>');
  } else if (v.out.includes(me)) {
    parts.push("<p>Tu n'as plus de cartes : <b>tu es sauvé</b> ! Regarde qui va finir avec le pouilleux.</p>");
  } else if (v.turn === me) {
    parts.push(`<p><b>À toi de piocher</b> : touche une des cartes cachées de ${nameOf(v, v.source)}.
      Si elle forme une paire avec une de tes cartes (même valeur et même couleur, rouge ou noire), la paire est défaussée automatiquement.</p>`);
  } else {
    parts.push(`<p>C'est à ${nameOf(v, v.turn)} de piocher chez ${nameOf(v, v.source)}.</p>`);
  }
  if (hasPouilleux && v.phase === 'playing') {
    parts.push("<p>🐒 <b>Tu as le pouilleux !</b> Garde ton calme : espère que ton voisin le pioche.</p>");
  }
  return parts.join('');
}

export function rules() {
  return `
  <h3>But du jeu</h3>
  <p>Se débarrasser de toutes ses cartes en formant des paires, et surtout <b>ne pas garder le pouilleux</b> (le valet de pique) à la fin.</p>
  <h3>Préparation</h3>
  ${ul([
    "On retire le valet de trèfle d'un jeu de 52 cartes : le valet de pique n'a donc plus de paire.",
    'Toutes les cartes sont distribuées.',
    'Une paire = deux cartes de même valeur et de même couleur (rouge avec rouge, noir avec noir), par exemple 7♥ et 7♦.',
    'Chacun défausse automatiquement ses paires.',
  ])}
  <h3>Déroulement</h3>
  ${ul([
    'À son tour, on pioche une carte au hasard, face cachée, dans la main du joueur suivant (qui a encore des cartes).',
    "Si la carte forme une paire avec une de nos cartes, la paire est défaussée ; sinon on la garde.",
    "Un joueur qui n'a plus de cartes est sauvé et sort du jeu.",
    'Le dernier joueur, celui qui reste avec le valet de pique, a perdu : c\'est le pouilleux !',
  ])}`;
}
