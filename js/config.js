// Configuration réseau.

// Préfixe des identifiants sur le serveur de signaling public de PeerJS
// (évite les collisions avec les autres applications qui l'utilisent).
export const PEER_PREFIX = 'cartes-entre-amis-v1-';

// Serveurs ICE utilisés par WebRTC pour établir la connexion directe.
// Les serveurs STUN (gratuits) suffisent dans la grande majorité des cas.
//
// Si un ami n'arrive jamais à se connecter (certains réseaux 4G ou d'entreprise),
// il faut ajouter un serveur TURN qui relaie le trafic. Des offres gratuites existent
// (ex. Metered.ca, Cloudflare Realtime TURN) : crée un compte et colle ici les infos fournies :
//
//   { urls: 'turn:XXXX:3478', username: 'XXXX', credential: 'XXXX' },
//
// Attention : ce fichier est public sur GitHub Pages, ces identifiants seront visibles.
export const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];
