// Morceaux d'affichage partagés par tous les jeux.
import { esc, cardHTML, payload, seatPositions } from './dom.js';
import { since, running, handAnims, setCardRenderer } from './anim.js';

setCardRenderer((c) => cardHTML(c));

// Point de départ des distributions, au centre de la table.
export const DEAL_SRC = '<div id="deal-src" class="deal-src"></div>';
export const fxLayer = (html) => (html ? `<div class="fx-layer">${html}</div>` : '');

export const nameOf = (v, s) => esc(v.names[s]);

// Position à l'écran d'un siège, vue depuis le joueur (un spectateur regarde depuis le siège 0).
export function posFn(v) {
  const n = v.names.length;
  const me = v.seat >= 0 ? v.seat : 0;
  const P = seatPositions(n);
  return (s) => P[(s - me + n) % n];
}

// Paquet de cartes face cachée avec le nombre de cartes. `id` sert de point de départ / d'arrivée
// aux animations (deck-<siège>).
export function deckHTML(id, n, { bump = null, small = false } = {}) {
  const layers = Math.min(n, 3);
  return `<div class="deck ${small ? 'small' : ''} ${n ? '' : 'empty'} ${bump ? 'bump' : ''}" id="${id}" ${
    bump ? `style="${bump}"` : ''
  } title="${n} carte${n > 1 ? 's' : ''}">
    ${Array.from({ length: layers }, (_, i) => `<div class="card back-card" style="--l:${layers - 1 - i}"></div>`).join('')}
    <span class="deck-count">${n}</span>
  </div>`;
}

// Badge d'un joueur autour de la table : nom, statut, puces, et son paquet face cachée.
// `bump` : style d'animation quand le joueur ramasse des cartes.
export function playerBadge(v, ctx, s, { pos, chips = '', extra = '', backs = true, team = false, active = false, bump = null }) {
  const pid = ctx.lobby.seats[s];
  const p = ctx.lobby.players.find((x) => x.id === pid);
  const auto = ctx.lobby.autoplay[s];
  const absent = p && !p.bot && !p.connected;
  const status = p?.bot || auto ? '🤖' : absent ? '<span title="Absent">🔌</span>' : '';
  const buttons = [];
  if (ctx.isHost && p && !p.bot && p.id !== ctx.myId && (absent || auto)) {
    buttons.push(
      `<button class="tiny" data-action="autoplay" data-seat="${s}" data-on="${!auto}">${
        auto ? 'Arrêter le robot' : 'Faire jouer un robot'
      }</button>`
    );
  }
  if (v.seat < 0 && absent && pid !== ctx.lobby.hostId) {
    buttons.push(`<button class="tiny" data-action="claim" data-seat="${s}">Prendre la place</button>`);
  }
  const showDeck = backs && s !== v.seat && v.handCounts;
  return `<div class="player pos-${pos(s)} ${team ? `team-${s % 2}` : 'solo'} ${active ? 'active' : ''}">
    <div class="pname">${status} ${nameOf(v, s)}${s === v.seat ? ' (toi)' : ''}</div>
    ${chips ? `<div class="chips">${chips}</div>` : ''}
    ${showDeck ? deckHTML(`deck-${s}`, v.handCounts[s], { small: true, bump }) : ''}
    ${extra}
    ${buttons.join('')}
  </div>`;
}

export const chip = (text, cls = '') => `<span class="chip ${cls}">${text}</span>`;

// Boutons en haut à droite : dernier pli, jeu automatique, aide, pause (hôte), quitter.
export function menuHTML(v, ctx, { lastTrick, autoSelf = false } = {}) {
  const btns = [];
  if (lastTrick !== undefined) {
    btns.push(`<button class="tiny secondary" data-action="last-trick" ${lastTrick ? '' : 'disabled'}>
      ${ctx.showLast ? 'Cacher' : 'Dernier pli'}</button>`);
  }
  if (autoSelf && v.seat >= 0) {
    const on = ctx.lobby.autoplay[v.seat];
    btns.push(`<button class="tiny secondary" data-action="autoplay" data-seat="${v.seat}" data-on="${!on}"
      title="Jouer automatiquement">${on ? '✋ Manuel' : '🤖 Auto'}</button>`);
  }
  btns.push('<button class="tiny secondary" data-action="help" title="Aide et règles">❓ Aide</button>');
  if (ctx.isHost) btns.push('<button class="tiny secondary" data-action="pause" title="Mettre la partie en pause">⏸ Pause</button>');
  btns.push('<button class="tiny secondary" data-action="leave">Quitter</button>');
  return `<div class="menu">${btns.join('')}</div>`;
}

// Historique : le dernier événement est mis en valeur quelques instants.
export function eventsHTML(v, n = 4) {
  const list = v.events.slice(-n);
  return `<ul class="events">${list
    .map((e, i) => {
      const a = i === list.length - 1 ? running(since(`ev:${e.id}`), 1500) : null;
      return `<li ${a ? `class="new" style="${a}"` : ''}>${esc(e.text)}</li>`;
    })
    .join('')}</ul>`;
}

// Main du joueur. `playable` : liste des cartes jouables (null = pas de jeu en cours),
// `selectable` : les cartes se sélectionnent au clic (président).
// `id` : identifiant de la main (deck-<siège>) pour les animations de cartes.
// `enter(card)` : d'où arrive une carte nouvelle dans la main (défaut : le centre de la table).
// `mark(card)` : classe supplémentaire (ex. carte reçue).
export function handHTML(
  cards,
  { playable = null, action = null, selectable = false, selected = [], myTurn = false, id = '', enter = () => 'deal-src', mark = () => '' } = {}
) {
  const anims = handAnims(cards, enter);
  return `<div class="hand ${myTurn ? 'my-turn' : ''}" ${id ? `id="${id}"` : ''} style="--n:${Math.max(cards.length, 1)}">
    ${cards
      .map((c, i) => {
        const a = anims[i];
        const anim = a ? ` ${a.attrs} style="${a.style}"` : '';
        const base = `data-cid="${esc(c)}"${anim}`;
        const extra = [a?.cls, mark(c)].filter(Boolean).join(' ');
        if (selectable) {
          return cardHTML(c, {
            extra: `selectable ${selected.includes(c) ? 'selected' : ''} ${extra}`,
            attrs: `data-action="select" data-card="${esc(c)}" ${base}`,
          });
        }
        const ok = playable?.includes(c);
        return cardHTML(c, {
          playable: playable !== null && ok,
          disabled: playable !== null && !ok,
          extra,
          attrs: `${playable !== null && ok && action ? payload(action(c)) : ''} ${base}`,
        });
      })
      .join('')}
  </div>`;
}

// Carte posée au centre, dans son enveloppe animée. `fly` : résultat de flyIn / flyOut.
// (une carte que je viens de jouer repart de sa position exacte dans ma main : voir flyIn)
export function slotCard(card, { i = 0, fly = null, cls = '', style = '', hidden = false } = {}) {
  const f = fly || { cls: '', style: '', attrs: '' };
  const inner = hidden ? '<div class="card back-card"></div>' : cardHTML(card, { extra: cls, attrs: style ? `style="${style}"` : '' });
  return `<div class="slot-card ${f.cls}" style="--i:${i};${f.style}" ${f.attrs}>${inner}</div>`;
}

// Emplacement d'un joueur au centre de la table (bas, haut, gauche…).
export const slotHTML = (pos, inner, cls = '') => (inner ? `<div class="slot at-${pos} ${cls}">${inner}</div>` : '');

export function dialogHTML({ title, body = '', actions = '' }) {
  return `<div class="overlay"><div class="dialog">
    <h2>${title}</h2>
    ${body}
    <div class="actions">${actions}</div>
  </div></div>`;
}

// Boutons de fin de manche / de partie.
export function endActions(v, ctx, nextLabel = 'Manche suivante') {
  if (v.phase === 'roundEnd') {
    return v.seat >= 0 ? `<button ${payload({ type: 'next' })}>${nextLabel}</button>` : '';
  }
  if (ctx.isHost) {
    return `<button data-action="restart">Rejouer</button>
      <button class="secondary" data-action="back-lobby">Retour au salon</button>`;
  }
  return '<p class="waiting">En attente de l\'hôte…</p>';
}

// Scores individuels (jeux sans équipes).
export function soloScores(v, values, { label = '' } = {}) {
  return `<div class="scores solo">${v.names
    .map(
      (_, s) => `<div class="score ${s === v.seat ? 'mine' : ''}">
        <span class="team">${nameOf(v, s)}</span><b>${values[s]}</b></div>`
    )
    .join('')}${label ? `<div class="target">${label}</div>` : ''}</div>`;
}

// Petite liste à puces pour l'aide.
export const ul = (items) => `<ul>${items.filter(Boolean).map((i) => `<li>${i}</li>`).join('')}</ul>`;
