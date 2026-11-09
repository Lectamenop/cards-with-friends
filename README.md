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
