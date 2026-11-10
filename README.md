# 🃏 Cartes entre amis

Jeux de cartes en ligne pour jouer entre amis, **sans serveur de jeu** : un joueur crée la partie (l'hôte),
envoie le lien aux autres, et les navigateurs se connectent directement entre eux (WebRTC).

Le site est 100 % statique (HTML/CSS/JS, pas d'étape de build) : il s'héberge gratuitement sur GitHub Pages.

## Jeux disponibles

| Jeu | Joueurs | Options dans le salon |
| --- | --- | --- |
| **Belote** classique | 4 (en équipes) | partie en 500 à 2000 points, annonces, sans-atout / tout-atout |
| **Coinche** | 4 (en équipes) | partie en 1000 à 3000 points, annonces, sans-atout / tout-atout |
| **Président** | 3 à 6 | 3 à 15 manches |
| **Pouilleux** | 2 à 6 | — |
| **Bataille** | 2 à 4 | limite de tours, jeu de 32 cartes |

## Jouer

1. Ouvrir le site, entrer son prénom, cliquer **Créer une partie**.
2. Choisir le jeu, le nombre de places et les options.
3. Cliquer **Copier le lien** et l'envoyer aux amis (WhatsApp, Discord…).
4. Chacun clique sur une place pour s'asseoir. Les places vides peuvent être remplies par des robots.
5. L'hôte clique **Lancer la partie**.

Pendant la partie, le bouton **❓ Aide** affiche :
- **Objectif actuel** : ce que tu dois faire maintenant (enchérir, fournir, couper, échanger des cartes…) et pourquoi certaines cartes sont grisées ;
- **Règles** : les règles complètes du jeu, avec les options choisies.

## Pause et sauvegarde

L'hôte peut mettre la partie en **⏸ Pause** à tout moment, puis **Sauvegarder et quitter**.
La partie est enregistrée dans son navigateur (elle est aussi sauvegardée automatiquement à chaque coup).

Pour la reprendre, même des jours plus tard : sur l'écran d'accueil, **Parties sauvegardées → Reprendre**.
La partie repart en pause ; l'hôte renvoie le lien aux autres :
- un ami qui revient **avec le même prénom** retrouve automatiquement sa place (et sa main) ;
- s'il s'est trompé de place, il clique **Changer de place**, puis **Prendre cette place** sur la bonne ;
- l'hôte peut faire jouer un robot à la place d'un absent.

Quand tout le monde est là, l'hôte clique **▶ Reprendre la partie**.

⚠️ L'hôte doit garder son onglet ouvert : c'est lui qui fait tourner la partie.
S'il recharge la page par erreur, il retrouve la partie dans **Parties sauvegardées**.
Un joueur qui perd la connexion retrouve sa place en rouvrant le lien.
