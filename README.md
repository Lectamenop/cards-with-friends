# 🃏 Cartes entre amis

Belote en ligne pour jouer entre amis, **sans serveur de jeu** : un joueur crée la partie (l'hôte),
envoie le lien aux autres, et les navigateurs se connectent directement entre eux (WebRTC).

Le site est 100 % statique (HTML/CSS/JS, pas d'étape de build) : il s'héberge gratuitement sur GitHub Pages.

## Jouer

1. Ouvrir le site, entrer son prénom, cliquer **Créer une partie**.
2. Cliquer **Copier le lien** et l'envoyer aux amis (WhatsApp, Discord…).
3. Chacun clique sur une place pour s'asseoir. Les places vides peuvent être remplies par des robots.
4. L'hôte clique **Lancer la partie**.

⚠️ L'hôte doit garder son onglet ouvert : c'est lui qui fait tourner la partie.
S'il recharge la page par erreur, le bouton **Reprendre ma partie** relance la salle avec le même code
et les autres joueurs se reconnectent automatiquement.

Un joueur qui perd la connexion retrouve sa place (et sa main) en rouvrant le lien.
En son absence, l'hôte peut le faire remplacer temporairement par un robot.

## Règles implémentées (belote classique)

- 32 cartes, distribution 3 + 2, une carte retournée ; enchères en deux tours ; le preneur reçoit la carte retournée + 2 cartes, les autres 3.
- Obligation de fournir, de couper (sauf si le partenaire est maître), de surcouper, de monter à l'atout.
- Belote/rebelote (20 points) détectée automatiquement, dix de der, capot (252).
- Le preneur doit faire plus de points que la défense (belote comprise), sinon il est « dedans » : la défense marque 162.
- Partie en 500, 1000, 1500 ou 2000 points (choix de l'hôte).
- Pas d'annonces (tierce, carré…) pour l'instant.

## Tester en local

Les modules JavaScript ne fonctionnent pas en ouvrant directement `index.html` (`file://`) : il faut un petit serveur.

```bash
npm start            # sert le dossier sur http://localhost:8080
npm test             # simule 500 parties pour vérifier le moteur de règles
```

Pour tester seul : ouvrir plusieurs onglets (chaque onglet est un joueur différent), ou compléter la table avec des robots.

## Mettre en ligne sur GitHub Pages

1. Créer un dépôt **public** sur GitHub (ex. `cartes-entre-amis`), sans README.
2. Pousser ce dossier :
   ```bash
   git remote add origin https://github.com/<ton-pseudo>/cartes-entre-amis.git
   git push -u origin main
   ```
3. Sur GitHub : **Settings → Pages → Build and deployment → Source : Deploy from a branch**,
   branche `main`, dossier `/ (root)`, puis **Save**.
4. Après une minute, le site est en ligne sur `https://<ton-pseudo>.github.io/cartes-entre-amis/`.

Chaque `git push` met le site à jour.

## Comment ça marche

```
        ┌──────────── Hôte (navigateur) ────────────┐
        │ mélange, distribue, valide les coups,     │
        │ garde l'état complet de la partie         │
        └───▲──────────────▲──────────────▲─────────┘
            │ WebRTC       │              │
         Joueur 2       Joueur 3       Joueur 4
   (chacun ne reçoit que sa main + les infos publiques)
```

- **Mise en relation** : [PeerJS](https://peerjs.com) et son serveur public gratuit servent uniquement à
  « présenter » les navigateurs entre eux. Ensuite, les messages de jeu passent en direct.
- **Anti-triche entre invités** : l'hôte ne transmet à chaque joueur que ce qu'il a le droit de voir
  (les mains des autres ne transitent jamais vers lui).
- **Connexion impossible pour un ami ?** Sur certains réseaux (4G, entreprise), la connexion directe échoue.
  Il faut alors ajouter un serveur relais TURN dans [js/config.js](js/config.js) (offres gratuites : Metered, Cloudflare).

### Organisation du code

| Fichier | Rôle |
| --- | --- |
| [js/games/belote.js](js/games/belote.js) | Règles de la belote (pur, sans réseau ni affichage) + robot |
| [js/host.js](js/host.js) | Salon et partie côté hôte : places, robots, diffusion des vues |
| [js/net.js](js/net.js) | Connexions PeerJS (créer une salle, rejoindre) |
| [js/main.js](js/main.js) | Écrans (accueil, salon), rôle hôte/invité, reconnexion |
| [js/ui/belote-ui.js](js/ui/belote-ui.js) | Affichage de la table de belote |
| [js/config.js](js/config.js) | Serveurs STUN/TURN |

### Ajouter un jeu (ex. tarot)

Créer `js/games/tarot.js` avec la même API que `belote.js`
(`createGame`, `applyAction`, `systemAction`, `view`, `botAction`, `seatCount`, `targets`),
un affichage `js/ui/tarot-ui.js`, puis les enregistrer dans [js/games/index.js](js/games/index.js)
et dans `GAME_UIS` de [js/main.js](js/main.js).
