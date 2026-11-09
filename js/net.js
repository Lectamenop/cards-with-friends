// Couche réseau : connexions WebRTC directes via PeerJS.
// Le serveur public de PeerJS sert uniquement à la mise en relation (signaling) ;
// ensuite, les messages de jeu passent directement entre les navigateurs.
//
// PeerJS est chargé par une balise <script> dans index.html (variable globale `Peer`).

import { PEER_PREFIX, ICE_SERVERS } from './config.js';

const PEER_OPTIONS = { config: { iceServers: ICE_SERVERS }, debug: 1 };
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans I, O, 0, 1 (ambigus)

export function randomCode(length = 5) {
  const rnd = new Uint32Array(length);
  crypto.getRandomValues(rnd);
  return Array.from(rnd, (n) => CODE_CHARS[n % CODE_CHARS.length]).join('');
}

export function normalizeCode(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// Crée le "peer" de l'hôte avec un identifiant dérivé du code de la salle.
// Rejette avec err.type === 'unavailable-id' si le code est déjà utilisé.
export function createHostPeer(code) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const peer = new Peer(PEER_PREFIX + code, PEER_OPTIONS);
    peer.on('open', () => {
      settled = true;
      resolve(peer);
    });
    peer.on('error', (err) => {
      if (!settled) {
        settled = true;
        peer.destroy();
        reject(err);
      } else {
        console.warn('[peer hôte]', err.type, err);
      }
    });
    // Perte du serveur de signaling : les connexions existantes continuent,
    // on se reconnecte pour pouvoir accepter de nouveaux joueurs.
    peer.on('disconnected', () => {
      if (!settled) return;
      setTimeout(() => {
        if (!peer.destroyed && peer.disconnected) peer.reconnect();
      }, 2000);
    });
  });
}

// Se connecte à l'hôte de la salle `code`. Résout avec { peer, conn } quand le canal est ouvert.
export function connectToHost(code, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const peer = new Peer(PEER_OPTIONS);
    const fail = (err) => {
      if (settled) return console.warn('[peer client]', err?.type, err);
      settled = true;
      clearTimeout(timer);
      peer.destroy();
      reject(err);
    };
    const timer = setTimeout(
      () => fail(new Error("Impossible de joindre l'hôte (délai dépassé). Vérifie le code ou réessaie.")),
      timeoutMs
    );
    peer.on('open', () => {
      const conn = peer.connect(PEER_PREFIX + code, { reliable: true, serialization: 'json' });
      conn.on('open', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ peer, conn });
      });
      conn.on('error', fail);
    });
    peer.on('error', (err) => {
      if (err?.type === 'peer-unavailable') {
        const e = new Error(`Aucune partie ouverte avec le code ${code}.`);
        e.type = err.type;
        fail(e);
      } else {
        fail(err);
      }
    });
  });
}
