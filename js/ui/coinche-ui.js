// Affichage de la coinche (réutilise la mise en page de la belote).
import { BID_VALUES, CAPOT, bidLabel } from '../games/coinche.js';
import { esc, payload } from './dom.js';
import { nameOf, chip, dialogHTML, endActions, ul } from './common.js';
import {
  suitHTML,
  trumpName,
  teamName,
  trickGameLayout,
  dealFx,
  resultTable,
  playAdvice,
  contractProgress,
  teamIntro,
  TRICK_RULES,
  ANNONCES_RULES,
  SA_TA_RULES,
} from './belote-ui.js';

const COINCHE = ['', ' <b>coinché</b>', ' <b>surcoinché</b>'];
const contractHTML = (c) => `${bidLabel(c.value)} ${suitHTML(c.suit)}`;

export function render(v, ctx) {
  const name = (s) => nameOf(v, s);
  const me = v.seat;
  const myTurn = me >= 0 && v.turn === me;
  const c = v.contract;

  const trumpInfo =
    v.phase === 'bidding'
      ? `<small>Enchères</small>`
      : `Contrat ${contractHTML(c)}${COINCHE[v.coinche]} <small>par ${name(c.seat)}</small>`;

  const chips = (s) => {
    let out = s === v.dealer ? chip('Donneur') : '';
    if (v.phase === 'bidding' && v.lastBids[s]) out += chip(esc(v.lastBids[s]), c?.seat === s ? 'taker' : '');
    if (v.phase !== 'bidding' && s === v.taker) out += chip(`Preneur ${bidLabel(c.value)} ${suitHTML(c.suit)}`, 'taker');
    return out;
  };

  let biddingCenter = '';
  if (v.phase === 'bidding') {
    const current = c
      ? `Enchère : <b>${contractHTML(c)}</b> par ${name(c.seat)}${COINCHE[v.coinche]}`
      : 'Aucune enchère pour le moment';
    let controls;
    if (!myTurn) {
      controls = `<p class="waiting">${name(v.turn)} réfléchit…</p>`;
    } else if (v.coinche) {
      controls = `<p>Ton contrat est coinché ! Tu peux surcoincher (points ×4).</p>
        <button ${payload({ type: 'surcoinche' })}>Surcoincher</button>
        <button class="secondary" ${payload({ type: 'pass' })}>Jouer ainsi</button>`;
    } else {
      const allowed = BID_VALUES.filter((x) => !c || x > c.value);
      const chosen = allowed.includes(Number(ctx.fields?.bidValue)) ? Number(ctx.fields.bidValue) : allowed[0];
      const select = allowed.length
        ? `<select data-action="field" data-key="bidValue">${allowed
            .map((x) => `<option value="${x}" ${x === chosen ? 'selected' : ''}>${x === CAPOT ? 'Capot (tous les plis)' : `${x} points`}</option>`)
            .join('')}</select>`
        : '';
      const suits = allowed.length
        ? v.trumpChoices
            .map((s) => `<button ${payload({ type: 'bid', value: chosen, suit: s })} title="${trumpName(s)}">${suitHTML(s)}</button>`)
            .join('')
        : '';
      const canCoinche = c && c.seat % 2 !== me % 2;
      controls = `${select ? `<div class="bid-row">${select}</div><div class="bid-buttons">${suits}</div>` : ''}
        <div class="bid-buttons">
          <button class="secondary" ${payload({ type: 'pass' })}>Passer</button>
          ${canCoinche ? `<button class="danger" ${payload({ type: 'coinche' })}>Coincher !</button>` : ''}
        </div>`;
    }
    biddingCenter = `<div class="bidding">
      <div class="label">${current}</div>
      <div class="bid-controls">${controls}</div>
    </div>`;
  }

  let overlay = '';
  if (v.phase === 'roundEnd' || v.phase === 'gameOver') {
    const r = v.roundResult;
    const rows = [
      ['Points des plis', r.raw],
      ['Belote', r.bel],
      ...(v.variants?.annonces ? [['Annonces', r.ann]] : []),
      ['Réalisé', r.pts],
      ['Marqués', r.gained.map((g) => `<b>+${g}</b>`)],
    ];
    const title =
      v.phase === 'gameOver'
        ? `🏆 Victoire de ${teamName(v, v.winner)} !`
        : `${name(r.contract.seat)} : ${contractHTML(r.contract)}${COINCHE[r.coinche]} — ${esc(r.outcome)}`;
    overlay = dialogHTML({
      title,
      body: (v.phase === 'gameOver' ? `<p>${esc(r.outcome)}</p>` : '') + resultTable(v, rows),
      actions: endActions(v, ctx),
    });
  }

  const startText = c && v.phase !== 'bidding' ? `Contrat : ${name(c.seat)}, ${contractHTML(c)}${COINCHE[v.coinche]}` : '';
  return trickGameLayout(v, ctx, { trumpInfo, chips, biddingCenter, overlay, startText, fx: dealFx(v, 4) });
}

// ---------------------------------------------------------------------------
// Aide

export function objective(v) {
  if (v.seat < 0) return '<p>Tu regardes la partie en spectateur.</p>';
  const me = v.seat;
  const c = v.contract;
  const parts = [teamIntro(v)];

  if (v.phase === 'bidding') {
    if (v.turn !== me) {
      parts.push(`<p>Enchères en cours : c'est à ${nameOf(v, v.turn)} de parler.</p>`);
    } else if (v.coinche) {
      parts.push(`<p><b>Ton contrat est coinché</b> : s'il réussit, les points sont doublés… mais s'il chute aussi.
        Tu peux <b>surcoincher</b> (×4) si tu es sûr de toi, ou jouer ainsi.</p>`);
    } else {
      parts.push(`<p><b>À toi de parler.</b> Annonce combien de points ton équipe s'engage à faire (de 80 à 160, ou capot = tous les plis)
        et avec quel atout. Il faut annoncer plus que l'enchère actuelle${c ? ` (<b>${contractHTML(c)}</b>)` : ''}.</p>
        <p>Repère : avec le valet et le 9 d'atout plus un ou deux as, 80 à 100 est raisonnable.
        ${c && c.seat % 2 === me % 2 ? 'Ton partenaire a déjà annoncé : tu peux monter si ta main le soutient, ou passer.' : ''}
        ${c && c.seat % 2 !== me % 2 ? "Si tu penses que l'adversaire va chuter, <b>coinche</b> : les points sont doublés." : ''}</p>`);
    }
  } else if (v.phase === 'playing' || v.phase === 'trickEnd') {
    const mine = c.seat % 2 === me % 2;
    const need = c.value === CAPOT ? 'faire <b>tous les plis</b>' : `faire au moins <b>${c.value} points</b> (belote et annonces comprises) et plus que la défense`;
    parts.push(
      contractProgress(
        v,
        mine
          ? `<b>Ton équipe a le contrat</b> ${contractHTML(c)}${COINCHE[v.coinche]} : vous devez ${need}.`
          : `<b>L'adversaire a le contrat</b> ${contractHTML(c)}${COINCHE[v.coinche]} : il doit ${need}. Faites-le chuter !`
      )
    );
    parts.push(playAdvice(v));
  } else if (v.phase === 'roundEnd') {
    parts.push('<p>La manche est terminée : consulte le résultat, puis passe à la manche suivante.</p>');
  } else {
    parts.push('<p>La partie est terminée !</p>');
  }
  return parts.join('');
}

export function rules(v) {
  const vr = v.variants || {};
  return `
  <h3>But du jeu</h3>
  <p>Deux équipes de deux (partenaires face à face). La première équipe à atteindre ${v.target} points gagne.
  La coinche est une belote où l'on <b>annonce un contrat</b> chiffré avant de jouer.</p>
  <h3>Distribution et enchères</h3>
  ${ul([
    'Chaque joueur reçoit 8 cartes (3, 2 puis 3). Aucune carte n\'est retournée.',
    `Chacun à son tour annonce un <b>contrat</b> : un nombre de points (80, 90… 160, ou <b>capot</b> = tous les plis) et un atout${
      vr.sansToutAtout ? ' (une couleur, sans-atout ou tout-atout)' : ''
    }, plus fort que l'enchère précédente ; ou il passe.`,
    "Les enchères s'arrêtent après 3 « passe » à la suite. Si personne n'annonce, on redistribue.",
    "Un adversaire peut <b>coincher</b> l'enchère en cours (il pense qu'elle va chuter) : les points sont doublés et les enchères s'arrêtent. Le preneur peut alors <b>surcoincher</b> (×4).",
  ])}
  ${TRICK_RULES}
  ${vr.annonces ? ANNONCES_RULES : ''}
  ${vr.sansToutAtout ? SA_TA_RULES : ''}
  <h3>Décompte</h3>
  ${ul([
    "Contrat réussi si l'équipe du preneur fait au moins le nombre annoncé (belote et annonces comprises) et plus que la défense.",
    "<b>Réussi</b> : le preneur marque le contrat + ses points ; la défense marque ses points (rien si elle a coinché, sauf sa belote).",
    '<b>Chuté</b> : la défense marque 160 + le contrat (+ sa belote et ses annonces), le preneur ne garde que sa belote.',
    'Coinche : contrat ×2 · surcoinche : contrat ×4. Un capot non annoncé vaut 252 points de plis.',
  ])}`;
}
