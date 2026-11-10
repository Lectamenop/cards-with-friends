// Affichage de la table de belote à partir de la vue envoyée par l'hôte.
// Les fonctions de mise en page des jeux de plis sont réutilisées par la coinche.
import { SUIT_SYMBOL, SUIT_NAME, suitOf, isRed, cardLabel } from '../cards.js';
import { esc, cardHTML, payload } from './dom.js';
import {
  nameOf, posFn, playerBadge, chip, menuHTML, eventsHTML, handHTML, slotHTML, slotCard, dialogHTML, endActions, ul,
  DEAL_SRC, fxLayer,
} from './common.js';
import { since, running, flyIn, flyOut, verdict, infoHTML, dealGhosts, passGhosts, COLLECT_MS } from './anim.js';

export function suitHTML(s) {
  if (s === 'SA' || s === 'TA') return `<span class="suit sa">${s}</span>`;
  return `<span class="suit ${isRed(s) ? 'red' : 'black'}">${SUIT_SYMBOL[s]}</span>`;
}
export const trumpName = (t) => (t === 'SA' ? 'Sans atout' : t === 'TA' ? 'Tout atout' : SUIT_NAME[t]);
export const teamName = (v, t) => `${nameOf(v, t)} &amp; ${nameOf(v, t + 2)}`;
const isBidding = (v) => v.phase === 'bidding' || v.phase === 'bidding1' || v.phase === 'bidding2';

// ---------------------------------------------------------------------------
// Mise en page commune belote / coinche

// Pli au centre : les cartes arrivent du paquet de chaque joueur, la gagnante s'illumine,
// puis le pli part vers le paquet du gagnant.
function trickArena(v, ctx, pos) {
  if (ctx.showLast && v.lastTrick) {
    const t = v.lastTrick;
    return `<div class="arena"><div class="arena-label">Dernier pli</div>${t.cards
      .map((p) => slotHTML(pos(p.seat), slotCard(p.card, { cls: p.seat === t.winner ? 'won' : '' })))
      .join('')}</div>`;
  }
  const trickNo = v.tricksWon[0] + v.tricksWon[1];
  let inner = v.trick
    .map((p) => {
      const vd = v.phase === 'trickEnd' ? verdict(`te:${v.round}:${trickNo}`, p.seat === v.trickWinner ? 'win' : 'lose') : {};
      const fly = flyIn(`t:${v.round}:${p.card}`, `deck-${p.seat}`, undefined, p.seat === v.seat ? p.card : null);
      return slotHTML(pos(p.seat), slotCard(p.card, { fly, ...vd }));
    })
    .join('');
  const t = v.lastTrick;
  const out = t && flyOut(`lt:${v.round}:${t.cards[0].card}`, `deck-${t.winner}`);
  if (out) inner += t.cards.map((p) => slotHTML(pos(p.seat), slotCard(p.card, { fly: out }))).join('');
  return `<div class="arena">${inner}</div>`;
}

// Message d'info du moment pour les jeux de plis (pli remporté, belote, contrat…).
function trickInfo(v, startText) {
  const name = (s) => nameOf(v, s);
  const startKey = `start:${v.round}`;
  if (startText && (v.phase === 'playing' || v.phase === 'trickEnd')) since(startKey); // garde son heure d'apparition
  if (v.phase === 'trickEnd') {
    return { key: `te:${v.round}:${v.tricksWon[0] + v.tricksWon[1]}`, text: `🏆 ${name(v.trickWinner)} remporte le pli` };
  }
  const last = v.events.at(-1);
  if (last && /Belote|Rebelote|annonce|Annonces/.test(last.text)) return { key: `info:${last.id}`, text: esc(last.text) };
  if ((v.phase === 'playing' || v.phase === 'trickEnd') && startText) return { key: startKey, text: startText };
  return null;
}

// Distribution des cartes aux adversaires (ma main a sa propre animation).
export function dealFx(v, perSeat = 3) {
  const others = [0, 1, 2, 3].filter((s) => s !== v.seat);
  return v.dealId ? dealGhosts(`deal:${v.dealId}`, others, { perSeat }) : '';
}

export function trickGameLayout(v, ctx, { trumpInfo, chips, biddingCenter, overlay, startText = '', fx = '' }) {
  const pos = posFn(v);
  const myTeam = v.seat >= 0 ? v.seat % 2 : null;
  const myTurn = v.seat >= 0 && v.turn === v.seat;

  const scores = [0, 1]
    .map(
      (t) => `<div class="score ${myTeam === t ? 'mine' : ''}">
        <span class="team">${teamName(v, t)}${myTeam === t ? ' (vous)' : ''}</span>
        <b>${v.scores[t]}</b></div>`
    )
    .join('');

  let center = '';
  if (isBidding(v)) center = biddingCenter;
  else center = trickArena(v, ctx, pos);

  const playing = v.phase === 'playing' && myTurn;
  const hand =
    v.seat >= 0
      ? handHTML(v.hand, {
          playable: playing ? v.legal : null,
          action: (c) => ({ type: 'play', card: c }),
          myTurn: playing,
          id: `deck-${v.seat}`,
        })
      : '<p class="waiting">Tu regardes la partie en spectateur.</p>';

  const hint = myTurn
    ? v.phase === 'playing'
      ? 'À toi de jouer !'
      : 'À toi de parler !'
    : v.turn !== null && v.turn !== undefined
      ? `Au tour de ${nameOf(v, v.turn)}`
      : '';

  // Le paquet du gagnant « rebondit » quand le pli y arrive.
  const t = v.lastTrick;
  const bump = t && v.phase !== 'trickEnd' ? running(since(`lt:${v.round}:${t.cards[0].card}`), 300, COLLECT_MS - 150) : null;
  const info = trickInfo(v, startText);

  return `<div class="game">
    <header class="topbar">
      <div class="scores">${scores}<div class="target">objectif ${v.target}</div></div>
      <div class="trump">${trumpInfo}</div>
      ${menuHTML(v, ctx, { lastTrick: v.lastTrick })}
    </header>
    <div class="table">
      ${[0, 1, 2, 3]
        .map((s) =>
          playerBadge(v, ctx, s, { pos, chips: chips(s), team: true, active: v.turn === s, bump: bump && t.winner === s ? bump : null })
        )
        .join('')}
      <div class="center">${DEAL_SRC}${center}${fxLayer(fx)}</div>
    </div>
    ${infoHTML(info?.key, info?.text, hint)}
    ${hand}
    ${eventsHTML(v)}
    ${overlay}
  </div>`;
}

// Tableau de fin de manche.
export function resultTable(v, rows) {
  const row = (label, vals) => `<tr><th>${label}</th><td>${vals[0]}</td><td>${vals[1]}</td></tr>`;
  return `<table class="result">
    <tr><th></th><th>${teamName(v, 0)}</th><th>${teamName(v, 1)}</th></tr>
    ${rows.map(([label, vals]) => row(label, vals)).join('')}
    ${row('Total', v.scores.map((s) => `<b>${s}</b>`))}
  </table>`;
}

// ---------------------------------------------------------------------------
// Belote

export function render(v, ctx) {
  const name = (s) => nameOf(v, s);
  const myTurn = v.seat >= 0 && v.turn === v.seat;

  const trumpInfo = v.trump
    ? `Atout ${suitHTML(v.trump)} <small>pris par ${name(v.taker)}</small>`
    : `<small>Enchères ${v.phase === 'bidding2' ? '(2e tour)' : ''}</small>`;
  const chips = (s) =>
    (s === v.dealer ? chip('Donneur') : '') + (s === v.taker ? chip(`Preneur ${suitHTML(v.trump)}`, 'taker') : '');

  let biddingCenter = '';
  if (isBidding(v)) {
    const turnSuit = suitOf(v.turnCard);
    let controls;
    if (myTurn && v.phase === 'bidding1') {
      controls = `<button ${payload({ type: 'take' })}>Prendre à ${suitHTML(turnSuit)}</button>
        <button class="secondary" ${payload({ type: 'pass' })}>Passer</button>`;
    } else if (myTurn) {
      controls =
        v.choices
          .map((s) => `<button ${payload({ type: 'choose', suit: s })}>${suitHTML(s)} ${trumpName(s)}</button>`)
          .join('') + `<button class="secondary" ${payload({ type: 'pass' })}>Passer</button>`;
    } else {
      controls = `<p class="waiting">${name(v.turn)} réfléchit…</p>`;
    }
    biddingCenter = `<div class="bidding">
      <div class="label">${v.phase === 'bidding1' ? '1er tour' : '2e tour : choisis un autre atout'}</div>
      ${cardHTML(v.turnCard, { extra: 'pop-in', attrs: `data-cid="${v.turnCard}" style="${running(since(`turn:${v.dealId}`), 300, 520) || 'animation:none'}"` })}
      <div class="bid-buttons">${controls}</div>
    </div>`;
  }

  let overlay = '';
  if (v.phase === 'roundEnd' || v.phase === 'gameOver') {
    const r = v.roundResult;
    const rows = [
      ['Points des plis', r.raw],
      ['Belote', r.bel],
      ...(v.variants?.annonces ? [['Annonces', r.ann]] : []),
      ['Marqués', r.gained.map((g) => `<b>+${g}</b>`)],
    ];
    const title =
      v.phase === 'gameOver'
        ? `🏆 Victoire de ${teamName(v, v.winner)} !`
        : `${name(r.taker)} a pris à ${suitHTML(r.trump)} : ${esc(r.outcome)}`;
    overlay = dialogHTML({
      title,
      body: (v.phase === 'gameOver' ? `<p>${esc(r.outcome)}</p>` : '') + resultTable(v, rows),
      actions: endActions(v, ctx),
    });
  }

  const startText = v.taker !== null ? `${name(v.taker)} prend à ${suitHTML(v.trump)}` : '';

  // Distribution, puis après la prise : la carte retournée rejoint le preneur
  // et chacun reçoit le reste de ses cartes.
  let fx = dealFx(v, 3);
  if (v.takenCard) {
    const k = `deal2:${v.dealId}`;
    if (v.taker !== v.seat) fx += passGhosts(k, 'deal-src', `deck-${v.taker}`, 1, { cards: [v.takenCard], fromCards: true });
    fx += dealGhosts(k, [0, 1, 2, 3].filter((s) => s !== v.seat), { perSeat: 2, delay: 200 });
  }
  return trickGameLayout(v, ctx, { trumpInfo, chips, biddingCenter, overlay, startText, fx });
}

// ---------------------------------------------------------------------------
// Aide : objectif du moment et règles

// Explique les cartes autorisées pour le joueur dont c'est le tour.
export function playAdvice(v) {
  const me = v.seat;
  if (v.phase === 'trickEnd') return `<p>Le pli est terminé : ${nameOf(v, v.trickWinner)} le remporte.</p>`;
  if (v.turn !== me) {
    return `<p>C'est à <b>${nameOf(v, v.turn)}</b> de jouer. Observe les cartes qui tombent : retenir les atouts déjà joués t'aidera à savoir quelles cartes sont maîtresses.</p>`;
  }
  const t = v.trump;
  if (!v.trick.length) {
    return `<p><b>Tu commences le pli</b> : tu peux jouer n'importe quelle carte.
      Conseil : joue une carte maîtresse (${t === 'TA' ? 'un valet' : 'un as'}) pour ramasser des points${
        t !== 'SA' && t !== 'TA' ? ', ou fais tomber les atouts adverses si ton équipe a pris' : ''
      }.</p>`;
  }
  const lead = suitOf(v.trick[0].card);
  const hasLead = v.hand.some((c) => suitOf(c) === lead);
  const leadTxt = `${suitHTML(lead)} ${SUIT_NAME[lead]}`;
  let rule;
  if (t === 'SA') {
    rule = hasLead ? `Tu dois <b>fournir</b> à ${leadTxt}.` : `Tu n'as pas de ${leadTxt} : en sans-atout, tu te défausses de la carte de ton choix.`;
  } else if (t === 'TA' || lead === t) {
    rule = hasLead
      ? `Tu dois <b>fournir</b> à ${leadTxt} et <b>monter</b> (jouer plus fort que la meilleure carte posée) si tu le peux.`
      : `Tu n'as pas de ${leadTxt} : tu joues la carte de ton choix.`;
  } else if (hasLead) {
    rule = `Tu dois <b>fournir</b> à ${leadTxt} (la couleur demandée).`;
  } else if (v.legal.length === v.hand.length) {
    rule = `Tu n'as pas de ${leadTxt}. Ton partenaire est maître du pli (ou tu n'as pas d'atout) : tu joues ce que tu veux. Si ton partenaire gagne, donne-lui des points !`;
  } else {
    rule = `Tu n'as pas de ${leadTxt} : tu dois <b>couper</b> avec un atout ${suitHTML(t)}, et <b>surcouper</b> (plus fort) si un adversaire a déjà coupé.`;
  }
  return `<p><b>À toi de jouer.</b> ${rule}</p><p class="muted">Les cartes que tu ne peux pas jouer sont grisées.</p>`;
}

export function contractProgress(v, takerTeamText) {
  const myTeam = v.seat % 2;
  const pts = v.trickPoints || [0, 0];
  return `<p>${takerTeamText}</p>
    <p>Points ramassés dans les plis : <b>vous ${pts[myTeam]}</b>, adversaires ${pts[1 - myTeam]}
    (sur 162, dix de der compris${v.annonces?.team != null ? ` ; annonces : ${v.annonces.points[myTeam]} pour vous, ${v.annonces.points[1 - myTeam]} pour eux` : ''}).</p>`;
}

export function teamIntro(v) {
  const me = v.seat;
  const myTeam = me % 2;
  return `<p>Tu joues avec <b>${nameOf(v, (me + 2) % 4)}</b> (en face de toi) contre ${nameOf(v, (me + 1) % 4)} et ${nameOf(v, (me + 3) % 4)}.
    Partie en <b>${v.target}</b> points : vous en avez <b>${v.scores[myTeam]}</b>, eux ${v.scores[1 - myTeam]}.</p>`;
}

export function objective(v) {
  if (v.seat < 0) return '<p>Tu regardes la partie en spectateur.</p>';
  const myTurn = v.turn === v.seat;
  const parts = [teamIntro(v)];

  if (v.phase === 'bidding1') {
    const s = suitOf(v.turnCard);
    parts.push(
      myTurn
        ? `<p><b>À toi de parler (1er tour).</b> La carte retournée est ${esc(cardLabel(v.turnCard))}.
          « Prendre » veut dire choisir ${suitHTML(s)} comme atout : tu ramasses cette carte et ton équipe s'engage à faire
          <b>plus de points que l'autre équipe</b>. Prends si tu as plusieurs atouts dont le valet ou le 9 (les plus forts), sinon passe.</p>`
        : `<p>Premier tour d'enchères : ${nameOf(v, v.turn)} décide s'il prend à ${suitHTML(s)}.</p>`
    );
  } else if (v.phase === 'bidding2') {
    parts.push(
      myTurn
        ? `<p><b>À toi de parler (2e tour).</b> Personne n'a pris la couleur retournée : tu peux choisir un <b>autre atout</b>
          (si ta main est forte dans cette couleur) ou passer. Si tout le monde passe, on redistribue.</p>`
        : `<p>Deuxième tour d'enchères : ${nameOf(v, v.turn)} peut choisir un autre atout.</p>`
    );
  } else if (v.phase === 'playing' || v.phase === 'trickEnd') {
    const mine = v.taker % 2 === v.seat % 2;
    parts.push(
      contractProgress(
        v,
        mine
          ? `<b>Ton équipe a pris</b> à ${suitHTML(v.trump)} : vous devez faire <b>plus de points</b> que l'adversaire, sinon vous êtes « dedans » et il marque 162.`
          : `<b>L'adversaire a pris</b> à ${suitHTML(v.trump)} : empêchez-le de faire plus de points que vous pour le mettre « dedans ».`
      )
    );
    parts.push(playAdvice(v));
  } else if (v.phase === 'roundEnd') {
    parts.push('<p>La manche est terminée : consulte le résultat, puis passe à la manche suivante.</p>');
  } else if (v.phase === 'gameOver') {
    parts.push('<p>La partie est terminée !</p>');
  }
  return parts.join('');
}

export const TRICK_RULES = `
  <h3>Les cartes</h3>
  <p>Jeu de 32 cartes. À l'atout, l'ordre est : <b>Valet (20) &gt; 9 (14) &gt; As (11) &gt; 10 (10) &gt; Roi (4) &gt; Dame (3) &gt; 8 &gt; 7</b>.
  Dans les autres couleurs : <b>As (11) &gt; 10 (10) &gt; Roi (4) &gt; Dame (3) &gt; Valet (2) &gt; 9 &gt; 8 &gt; 7</b>.
  Le dernier pli rapporte 10 points (« dix de der ») : il y a 162 points en jeu par manche.</p>
  <h3>Jouer un pli</h3>
  ${ul([
    'Le joueur qui commence pose la carte de son choix ; les autres doivent <b>fournir</b> (jouer la couleur demandée).',
    "Si on ne peut pas fournir, on doit <b>couper</b> (jouer un atout), sauf si son partenaire est maître du pli.",
    "Si un adversaire a déjà coupé, il faut <b>surcouper</b> (atout plus fort) si possible, sinon on peut sous-couper.",
    "Quand l'atout est demandé, il faut <b>monter</b> (jouer un atout plus fort) si on le peut.",
    "Le pli est remporté par l'atout le plus fort, ou à défaut par la plus forte carte de la couleur demandée. Le gagnant commence le pli suivant.",
  ])}
  <h3>Belote et rebelote</h3>
  <p>Le joueur qui possède le Roi et la Dame d'atout marque 20 points (annoncés automatiquement « Belote ! » puis « Rebelote ! »).</p>`;

export const ANNONCES_RULES = `
  <h3>Annonces</h3>
  <p>Au début du jeu, les combinaisons de chaque joueur sont annoncées automatiquement :</p>
  ${ul([
    'Tierce (3 cartes qui se suivent dans une couleur, ordre 7 8 9 10 V D R A) : 20 points',
    'Cinquante (4 cartes qui se suivent) : 50 points',
    'Cent (5 cartes ou plus qui se suivent) : 100 points',
    'Carré de valets : 200 · carré de 9 : 150 · carré d\'as, de 10, de rois ou de dames : 100',
  ])}
  <p>Seule l'équipe qui a la <b>meilleure annonce</b> marque (toutes ses annonces). À égalité : le carré bat la suite,
  puis la carte la plus haute, puis la suite à l'atout, puis le premier joueur dans l'ordre de jeu.</p>`;

export const SA_TA_RULES = `
  <h3>Sans-atout et tout-atout</h3>
  <p><b>Sans atout</b> : aucune couleur ne coupe. As 19, 10 10, Roi 4, Dame 3, Valet 2.
  <b>Tout atout</b> : chaque couleur se joue comme un atout (ordre V 9 A 10 R D 8 7, il faut monter). Valet 14, 9 9, As 6, 10 5, Roi 3, Dame 1.
  Dans les deux cas, il y a toujours 162 points en jeu, et pas de belote.</p>`;

export function rules(v) {
  const vr = v.variants || {};
  return `
  <h3>But du jeu</h3>
  <p>Deux équipes de deux (les partenaires sont face à face). La première équipe à atteindre le score fixé (${v.target} points) gagne.</p>
  <h3>Distribution et enchères</h3>
  ${ul([
    "Chaque joueur reçoit 5 cartes (3 puis 2), puis une carte est retournée au milieu.",
    "<b>1er tour</b> : chacun à son tour peut <b>prendre</b> (la couleur retournée devient l'atout) ou passer.",
    `<b>2e tour</b> : si personne n'a pris, chacun peut choisir une <b>autre couleur</b>${vr.sansToutAtout ? ', ou sans-atout / tout-atout' : ''} comme atout, ou passer. Si tout le monde passe encore, on redistribue.`,
    'Le preneur ramasse la carte retournée et reçoit 2 cartes ; les autres en reçoivent 3 (8 cartes chacun).',
  ])}
  ${TRICK_RULES}
  ${vr.annonces ? ANNONCES_RULES : ''}
  ${vr.sansToutAtout ? SA_TA_RULES : ''}
  <h3>Décompte</h3>
  ${ul([
    "L'équipe du preneur doit faire <b>plus de points</b> que la défense (belote et annonces comprises) : chaque équipe marque alors ses points.",
    'Sinon le preneur est <b>dedans</b> : la défense marque 162 (+ sa belote et les annonces), le preneur ne garde que sa belote.',
    "<b>Capot</b> : l'équipe qui fait tous les plis marque 252 points.",
  ])}`;
}
