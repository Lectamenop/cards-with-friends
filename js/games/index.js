// Registre des jeux disponibles. Pour ajouter un jeu (ex. tarot) :
// 1. créer js/games/tarot.js avec la même API que belote.js
//    (createGame, applyAction, systemAction, view, botAction, seatCount, targets) ;
// 2. créer js/ui/tarot-ui.js avec une fonction render(view, ctx) ;
// 3. l'enregistrer ici.

import * as belote from './belote.js';

export const GAMES = { belote };
