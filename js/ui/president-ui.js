// Affichage du président.
import { checkPlay } from '../games/president.js';
import { cardLabel } from '../cards.js';
import { esc, payload } from './dom.js';
import {
  nameOf, posFn, playerBadge, chip, menuHTML, eventsHTML, handHTML, slotCard, dialogHTML, endActions, soloScores, ul,
  DEAL_SRC, fxLayer,
} from './common.js';
import { since, flyIn, flyOut, verdict, infoHTML, dealGhosts, passGhosts } from './anim.js';

const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;
const cardsText = (cards) => cards.map((c) => esc(cardLabel(c))).join(' ');
const pileKey = (v) => `p:${v.round}:${v.pile.cards.join('')}`;

const pileSlot = (cards, cls = '', opts = {}) =>
  `<div class="slot at-center ${cls}" style="--n:${cards.length}">${cards.map((c, i) => slotCard(c, { i, ...opts })).join('')}</div>`;

// Centre de la table : la combinaison battue (grisée) sous la dernière posée, qui arrive du paquet
// de son joueur ; quand personne ne la bat, elle s'illumine puis part à la défausse.
function arena(v) {
  const name = (s) => nameOf(v, s);
  let inner = '';
  const lp = v.lastPile;
  const out = lp && flyOut(`lp:${lp.id}`, null);
  if (out) inner += pileSlot(lp.cards, '', { fly: out });
  if (v.prevPile) inner += pileSlot(v.prevPile.cards, 'prev');
  if (v.pile) {
    const vd = v.phase === 'pileEnd' ? verdict(`pe:${pileKey(v)}`, 'win') : {};
    // Chaque carte que je pose repart de sa place exacte dans ma main.
    const mine = v.pile.seat === v.seat;
    inner += `<div class="slot at-center" style="--n:${v.pile.cards.length}">${v.pile.cards
      .map((c, i) => slotCard(c, { i, fly: flyIn(`${pileKey(v)}:${i}`, `deck-${v.pile.seat}`, undefined, mine ? c : null), ...vd }))
      .join('')}</div>`;
  }
  const label = v.pile ? `${name(v.pile.seat)} a posé` : v.phase === 'playing' ? `${name(v.turn)} ouvre un nouveau pli` : '';
  return `<div class="arena">${label ? `<div class="arena-label">${label}</div>` : ''}${inner}</div>`;
}

// Distribution et échanges de cartes entre gagnants et perdants.
function dealAndExchangeFx(v) {
  const me = v.seat;
  let fx = dealGhosts(`deal:${v.dealId}`, v.names.map((_, s) => s).filter((s) => s !== me), { perSeat: 3 });
  const AUTO_DELAY = 750; // les dons automatiques suivent la distribution
  const AUTO_END = AUTO_DELAY + 520 + 70;
  for (const t of v.transfers) {
    // Une carte que je reçois en cours de partie arrive directement dans ma main (voir enter).
    if (!t.auto && t.to === me) continue;
    const key = `x:${v.dealId}:${t.id}`;
    // Une carte rendue part une fois que les dons automatiques sont arrivés.
    const gap = since(`deal:${v.dealId}`) - since(key);
    fx += passGhosts(key, `deck-${t.from}`, `deck-${t.to}`, t.count, {
      cards: t.cards,
      delay: t.auto ? AUTO_DELAY : Math.max(0, AUTO_END - gap),
      fromCards: t.from === me,
    });
  }
  return fx;
}

export function render(v, ctx) {
  const pos = posFn(v);
  const name = (s) => nameOf(v, s);
  const me = v.seat;
  const myTurn = me >= 0 && v.phase === 'playing' && v.turn === me;
  const selected = (ctx.selected || []).filter((c) => v.hand.includes(c));

  const chips = (s) => {
    let out = v.roles ? chip(esc(v.roles[s])) : '';
    const done = v.finished.indexOf(s);
    if (done >= 0) out += chip(`✔ ${esc(v.finishedRoles[done])}`, 'taker');
    else if (v.lastAction[s] === 'pass') out += chip('Passe');
    return out;
  };

  let center = '';
  if (v.phase === 'exchange') {
    center = v.exchange
      ? `<div class="bidding"><div class="label">Échange des cartes</div>
          <p>Tu as reçu ${cardsText(v.exchange.received)}.<br>Choisis ${plural(v.exchange.count, 'carte')} à rendre à ${name(v.exchange.to)}.</p></div>`
      : '<p class="waiting">Échange des cartes entre gagnants et perdants…</p>';
  } else if (v.phase === 'playing' || v.phase === 'pileEnd') {
    center = arena(v);
  }

  // Cartes qui arrivent dans ma main : rendues par le Président (depuis son paquet) ou distribuées.
  const enter = (c) => {
    const t = v.transfers.find((x) => !x.auto && x.to === me && x.cards?.includes(c));
    return t ? `deck-${t.from}` : 'deal-src';
  };
  const mark = (c) => (v.phase === 'exchange' && v.exchange?.received.includes(c) ? 'received' : '');

  let hand;
  let controls = '';
  if (me < 0) {
    hand = '<p class="waiting">Tu regardes la partie en spectateur.</p>';
  } else if (myTurn || v.exchange) {
    hand = handHTML(v.hand, { selectable: true, selected, myTurn: true, id: `deck-${me}`, enter, mark });
    if (v.exchange) {
      const ok = selected.length === v.exchange.count;
      controls = `<button ${ok ? payload({ type: 'give', cards: selected }) : 'disabled'}>Donner ${
        selected.length ? cardsText(selected) : ''
      }</button>`;
    } else {
      const err = selected.length ? checkPlay(v.pile, v.hand, selected) : 'Sélectionne des cartes.';
      controls = `<button ${err ? 'disabled' : payload({ type: 'play', cards: selected })}>Poser ${
        selected.length ? cardsText(selected) : ''
      }</button>
        ${v.pile ? `<button class="secondary" ${payload({ type: 'pass' })}>Passer</button>` : ''}
        ${selected.length && err ? `<div class="muted">${esc(err)}</div>` : ''}`;
    }
  } else {
    hand = handHTML(v.hand, { id: `deck-${me}`, enter, mark });
  }

  let hint = '';
  if (myTurn) hint = v.pile ? 'À toi : pose plus fort ou passe.' : 'À toi de commencer le pli !';
  else if (v.exchange) hint = 'Choisis les cartes à rendre.';
  else if (v.phase === 'playing' && v.turn !== null) hint = `Au tour de ${name(v.turn)}`;

  // Messages d'info : pli remporté, joueur qui termine.
  let info = null;
  if (v.finished.length) since(`fin:${v.round}:${v.finished.length - 1}`); // garde son heure d'apparition
  if (v.phase === 'pileEnd' && v.pile) info = { key: `pe:${pileKey(v)}`, text: `🏆 Personne ne bat : pli pour ${name(v.pile.seat)}` };
  else if (v.finished.length) {
    const k = v.finished.length - 1;
    info = { key: `fin:${v.round}:${k}`, text: `🎉 ${name(v.finished[k])} a fini : ${esc(v.finishedRoles[k])} !` };
  }

  let overlay = '';
  if (v.phase === 'roundEnd' || v.phase === 'gameOver') {
    const r = v.roundResult;
    const rows = r.order
      .map(
        (s, i) => `<tr><th>${i + 1}. ${name(s)}</th><td>${esc(r.roles[i])}</td><td>+${r.gained[s]}</td><td><b>${v.scores[s]}</b></td></tr>`
      )
      .join('');
    overlay = dialogHTML({
      title: v.phase === 'gameOver' ? `🏆 Victoire de ${name(v.winner)} !` : `Manche ${v.round} : ${name(r.order[0])} est Président !`,
      body: `<table class="result"><tr><th></th><th>Rôle</th><th>Manche</th><th>Total</th></tr>${rows}</table>`,
      actions: endActions(v, ctx),
    });
  }

  return `<div class="game">
    <header class="topbar">
      ${soloScores(v, v.scores, { label: `manche ${v.round} / ${v.target}` })}
      ${menuHTML(v, ctx)}
    </header>
    <div class="table">
      ${v.names.map((_, s) => playerBadge(v, ctx, s, { pos, chips: chips(s), active: v.waiting.includes(s) })).join('')}
      <div class="center">${DEAL_SRC}${center}${fxLayer(dealAndExchangeFx(v))}</div>
    </div>
    ${infoHTML(info?.key, info?.text, hint)}
    ${hand}
    ${controls ? `<div class="actions hand-actions">${controls}</div>` : ''}
    ${eventsHTML(v)}
    ${overlay}
  </div>`;
}

// ---------------------------------------------------------------------------
// Aide

export function objective(v) {
  const me = v.seat;
  if (me < 0) return '<p>Tu regardes la partie en spectateur.</p>';
  const parts = [
    `<p>But : <b>te débarrasser de toutes tes cartes le plus vite possible</b>. Manche ${v.round} sur ${v.target}, tu as ${v.scores[me]} point${
      v.scores[me] > 1 ? 's' : ''
    }.${v.roles ? ` À la manche précédente, tu as fini <b>${esc(v.roles[me])}</b>.` : ''}</p>`,
  ];
  const done = v.finished.indexOf(me);
  if (done >= 0) {
    parts.push(`<p>Tu as fini cette manche : tu es <b>${esc(v.finishedRoles[done])}</b> ! Regarde les autres terminer.</p>`);
  } else if (v.phase === 'exchange') {
    parts.push(
      v.exchange
        ? `<p><b>Échange :</b> grâce à ta place à la manche précédente, tu as reçu les meilleures cartes de ${nameOf(v, v.exchange.to)}
          (${cardsText(v.exchange.received)}). Rends-lui ${plural(v.exchange.count, 'carte')} de ton choix : en général tes plus faibles.
          Touche les cartes pour les sélectionner, puis « Donner ».</p>`
        : `<p>Les gagnants de la manche précédente choisissent les cartes qu'ils rendent aux perdants. Patiente un instant.</p>`
    );
  } else if (v.phase === 'playing' && v.turn === me) {
    if (!v.pile) {
      parts.push(`<p><b>Tu ouvres le pli</b> : pose 1, 2, 3 ou 4 cartes de <b>même valeur</b>. Les autres devront poser le même nombre de cartes, plus fortes.
        Conseil : débarrasse-toi de tes petites cartes, et pose ensemble tes paires ou brelans.</p>`);
    } else {
      const k = v.pile.cards.length;
      parts.push(`<p><b>À toi :</b> pose ${plural(k, 'carte')} de même valeur, <b>plus forte${k > 1 ? 's' : ''}</b> que ${cardsText(v.pile.cards)}, ou passe.
        Passer ne t'empêche pas de rejouer si le tour revient à toi dans ce pli. Un 2 ferme le pli immédiatement.</p>`);
    }
    parts.push('<p class="muted">Touche les cartes pour les sélectionner, puis « Poser ».</p>');
  } else if (v.phase === 'playing' || v.phase === 'pileEnd') {
    parts.push(`<p>C'est à ${nameOf(v, v.turn ?? v.pile?.seat)} de jouer.${
      v.pile ? ` Pour reprendre la main, il faudra battre ${cardsText(v.pile.cards)}.` : ''
    }</p>`);
  } else if (v.phase === 'roundEnd') {
    parts.push('<p>La manche est terminée : consulte le classement, puis lance la manche suivante.</p>');
  } else if (v.phase === 'gameOver') {
    parts.push('<p>La partie est terminée !</p>');
  }
  return parts.join('');
}

export function rules(v) {
  return `
  <h3>But du jeu</h3>
  <p>Être le premier à se débarrasser de toutes ses cartes. La partie se joue en ${v.target} manches ;
  celui qui a le plus de points à la fin gagne.</p>
  <h3>Les cartes</h3>
  <p>Jeu de 52 cartes, entièrement distribué. Ordre : <b>3 &lt; 4 &lt; … &lt; 10 &lt; Valet &lt; Dame &lt; Roi &lt; As &lt; 2</b>.
  La couleur n'a pas d'importance.</p>
  <h3>Déroulement d'un pli</h3>
  ${ul([
    'Le joueur qui ouvre pose 1, 2, 3 ou 4 cartes de même valeur (ex. une paire de 7).',
    'Chacun à son tour doit poser <b>le même nombre de cartes</b>, de valeur <b>strictement plus forte</b>, ou passer.',
    "Passer n'empêche pas de rejouer si le tour revient dans le même pli.",
    "Quand tout le monde a passé après une pose, le pli est ramassé et celui qui a posé en dernier ouvre le pli suivant. Poser un <b>2</b> ferme le pli aussitôt.",
    'À la première manche, le joueur qui a le 3♣ commence ; ensuite, c\'est le Trou du cul.',
  ])}
  <h3>Rôles et échanges</h3>
  ${ul([
    "L'ordre d'arrivée donne les rôles : <b>Président</b>, Vice-président, Neutre(s), Vice-trou du cul, <b>Trou du cul</b> (à 3 joueurs : Président, Neutre, Trou du cul).",
    'Au début de la manche suivante, le Trou du cul donne ses 2 meilleures cartes au Président, qui lui rend 2 cartes de son choix.',
    'Le Vice-trou du cul donne sa meilleure carte au Vice-président, qui lui en rend une.',
  ])}
  <h3>Points</h3>
  <p>À chaque manche, le premier sorti marque ${v.names.length - 1} points, le suivant ${v.names.length - 2}… et le dernier 0.</p>`;
}
