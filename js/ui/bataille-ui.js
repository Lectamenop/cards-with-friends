// Affichage de la bataille : chaque joueur a sa pile face cachée, les cartes jouées volent
// de la pile vers le centre, la plus forte s'illumine, puis le tas part vers la pile du gagnant.
import { payload } from './dom.js';
import {
  nameOf, posFn, playerBadge, chip, menuHTML, eventsHTML, dialogHTML, endActions, soloScores, ul,
  deckHTML as deckBase, slotHTML as slotBase, slotCard,
} from './common.js';
import { since, running, flyIn, flyOut, verdict, dealGhosts, COLLECT_MS } from './anim.js';
import { DEAL_SRC, fxLayer } from './common.js';

const deckHTML = (v, s, bump = null) => deckBase(`deck-${s}`, v.pileCounts[s], { bump });

// Tas de cartes posées par un joueur au centre.
function slotHTML(v, s, pos) {
  const cards = v.table[s];
  const unique = v.best.length === 1;
  return slotBase(
    pos(s),
    cards
      .map((p, i) => {
        const fly = flyIn(p.hidden ? `h:${s}:${i}:${v.tours}` : `c:${p.card}:${v.tours}`, `deck-${s}`);
        if (p.hidden) return slotCard(null, { i, fly, hidden: true });
        const last = i === cards.length - 1;
        const vd =
          v.phase === 'reveal' && last
            ? verdict(`reveal:${v.tours}:${v.battle}`, v.best.includes(s) ? (unique ? 'win' : 'tie') : 'lose')
            : {};
        return slotCard(p.card, { i, fly, ...vd });
      })
      .join('')
  );
}

// Cartes remportées qui partent vers la pile du gagnant.
function collectHTML(v, pos) {
  const w = v.lastWin;
  const out = w && flyOut(`win:${w.id}`, `deck-${w.seat}`);
  if (!out) return '';
  return w.table.map((cards, s) => slotBase(pos(s), cards.map((c, i) => slotCard(c, { i, fly: out })).join(''))).join('');
}

export function render(v, ctx) {
  const pos = posFn(v);
  const name = (s) => nameOf(v, s);
  const me = v.seat;
  const bottom = me >= 0 ? me : 0;
  const mustFlip = me >= 0 && v.waiting.includes(me);

  // La pile du gagnant « rebondit » quand les cartes y arrivent.
  const won = v.lastWin ? running(since(`win:${v.lastWin.id}`), 300, COLLECT_MS - 150) : null;
  const deck = (s) => deckHTML(v, s, won && v.lastWin.seat === s ? won : null);

  const zone = (s) => {
    let extra = deck(s);
    if (s === bottom) {
      const action = mustFlip
        ? `<button class="big play-card" ${payload({ type: 'flip' })}>Jouer une carte</button>`
        : me < 0
          ? ''
          : `<div class="waiting deck-status">${
              v.out.includes(me) ? 'Éliminé' : v.phase === 'reveal' ? 'Comparaison…' : v.phase === 'flip' ? 'En attente…' : ''
            }</div>`;
      extra = `<div class="deck-row">${extra}${action}</div>`;
    }
    const chips = v.out.includes(s) ? chip('Éliminé') : v.winner === s ? chip('🏆', 'taker') : '';
    return playerBadge(v, ctx, s, { pos, chips, extra, backs: false, active: v.waiting.includes(s) });
  };

  // Bandeau « Bataille ! » : il apparaît puis s'efface pour laisser voir les cartes.
  const bannerAnim = v.battle > 0 && v.phase !== 'gameOver' ? running(since(`battle:${v.tours}:${v.battle}`), 1500) : null;
  const battle = bannerAnim ? `<div class="battle-banner" style="${bannerAnim}">⚔️ Bataille !</div>` : '';

  // Distribution : les cartes partent du centre vers la pile de chaque joueur.
  const deal = fxLayer(dealGhosts(`deal:${v.dealId}`, v.names.map((_, s) => s), { perSeat: 3 }));
  const center = `${DEAL_SRC}${deal}<div class="arena">
    ${v.names.map((_, s) => slotHTML(v, s, pos)).join('')}
    ${collectHTML(v, pos)}
    ${battle}
  </div>`;

  const overlay =
    v.phase === 'gameOver'
      ? dialogHTML({
          title: `🏆 Victoire de ${name(v.winner)} !`,
          body: `<p>${v.names.map((_, s) => `${name(s)} : ${v.pileCounts[s]} cartes`).join(' · ')}</p><p class="muted">${v.tours} tours joués.</p>`,
          actions: endActions(v, ctx),
        })
      : '';

  return `<div class="game">
    <header class="topbar">
      ${soloScores(v, v.pileCounts, { label: `tour ${v.tours}${v.target ? ` / ${v.target}` : ''}` })}
      ${menuHTML(v, ctx, { autoSelf: true })}
    </header>
    <div class="table bataille">
      ${v.names.map((_, s) => zone(s)).join('')}
      <div class="center">${center}</div>
    </div>
    ${me < 0 ? '<p class="waiting">Tu regardes la partie en spectateur.</p>' : ''}
    ${eventsHTML(v, 3)}
    ${overlay}
  </div>`;
}

export function objective(v) {
  const me = v.seat;
  if (me < 0) return '<p>Tu regardes la partie en spectateur.</p>';
  const parts = [
    `<p>But : <b>remporter toutes les cartes</b>${v.target ? ` (ou en avoir le plus après ${v.target} tours)` : ''}. Tu as <b>${v.pileCounts[me]}</b> cartes.</p>`,
  ];
  if (v.out.includes(me)) parts.push("<p>Tu n'as plus de cartes : tu es éliminé.</p>");
  else if (v.waiting.includes(me)) {
    parts.push(
      v.battle
        ? '<p><b>Bataille !</b> Ta carte était à égalité avec la meilleure : une carte face cachée a été posée pour toi. Joue une nouvelle carte : la plus forte remporte tout le tas.</p>'
        : '<p><b>Joue ta carte</b> : la plus forte (As &gt; Roi &gt; Dame &gt; Valet &gt; 10 … &gt; 2) remporte toutes les cartes posées.</p>'
    );
  } else if (v.phase === 'gameOver') parts.push('<p>La partie est terminée !</p>');
  else parts.push('<p>Patiente pendant que les autres jouent leur carte.</p>');
  parts.push('<p class="muted">Astuce : le bouton « 🤖 Auto » joue tes cartes automatiquement.</p>');
  return parts.join('');
}

export function rules(v) {
  return `
  <h3>But du jeu</h3>
  <p>Remporter toutes les cartes du jeu. ${
    v.target ? `La partie est limitée à ${v.target} tours : à la fin, celui qui a le plus de cartes gagne.` : ''
  }</p>
  <h3>Déroulement</h3>
  ${ul([
    `Toutes les cartes (${v.variants?.jeu32 ? '32' : '52'}) sont distribuées en piles face cachée.`,
    'À chaque tour, chaque joueur pose la carte du dessus de sa pile au centre, face visible.',
    'La carte la plus forte remporte toutes les cartes posées, qui vont sous la pile du gagnant. Ordre : As &gt; Roi &gt; Dame &gt; Valet &gt; 10 &gt; … &gt; 2. La couleur ne compte pas.',
    "En cas d'égalité pour la plus forte carte, c'est la <b>bataille</b> : les joueurs à égalité posent une carte face cachée sur le tas, puis jouent une nouvelle carte ; la plus forte remporte tout. On recommence en cas de nouvelle égalité.",
    "Un joueur qui n'a plus de cartes est éliminé.",
  ])}`;
}
