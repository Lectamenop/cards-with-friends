// Registre des jeux disponibles. Chaque module de jeu est "pur" (ni réseau ni affichage) et exporte :
//
//   id, name                      identifiant et nom affiché
//   minSeats, maxSeats,           nombre de places (réglable dans le salon si min < max)
//   defaultSeats
//   teams                         true si les joueurs jouent en équipes (sièges pairs / impairs)
//   targets, defaultTarget,       durées de partie proposées (ou null), et leur libellé
//   targetLabel(t)
//   variants                      options cochables dans le salon : [{ key, label, default }]
//   createGame({ names, target, variants })  → état complet de la partie
//   applyAction(state, seat, action)          → null si OK, sinon message d'erreur
//   systemAction(state)                       → action automatique en attente (ex. ramasser le pli) ou null
//   waiting(state)            (optionnel)     → sièges dont on attend une action (défaut : [state.turn])
//   delays                    (optionnel)     → rythme { bot, system } en ms (délai des robots, temps avant
//                                               l'action automatique, ex. ramasser le pli)
//   view(state, seat)                         → ce que voit ce joueur (jamais les mains des autres)
//   botAction(state, seat)                    → coup d'un robot
//
// Pour ajouter un jeu : créer js/games/<jeu>.js et js/ui/<jeu>-ui.js (render, rules, objective),
// puis les enregistrer ici et dans GAME_UIS de js/main.js.

import * as belote from './belote.js';
import * as coinche from './coinche.js';
import * as president from './president.js';
import * as pouilleux from './pouilleux.js';
import * as bataille from './bataille.js';

export const GAMES = { belote, coinche, president, pouilleux, bataille };

// Sièges dont on attend une action.
export function waitingSeats(mod, state) {
  if (mod.waiting) return mod.waiting(state);
  return state.turn === null || state.turn === undefined ? [] : [state.turn];
}
