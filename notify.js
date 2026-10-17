// Alertes envoyées au gérant quand un client demande une confirmation de paiement.
// - ntfy.sh : notification push gratuite sur le téléphone (canal public : message volontairement générique)
// - FormSubmit : email gratuit, sans compte (l'adresse ou l'alias du gérant est publié dans la vitrine : préférer l'alias)
const NTFY = 'https://ntfy.sh';
const TOPIC_ALPHA = 'abcdefghijkmnpqrstuvwxyz23456789'; // 32 caractères, sans l/o/0/1

export const validTopic = (t) => /^[A-Za-z0-9_-]{8,64}$/.test(t || '');

export function newTopic() {
  const b = new Uint8Array(20);
  globalThis.crypto.getRandomValues(b);
  let s = 'zt-';
  for (const x of b) s += TOPIC_ALPHA[x & 31];
  return s;
}

export async function sendNtfy(topic, { title, message, click }) {
  if (!validTopic(topic)) throw new Error('Canal ntfy invalide');
  const body = { topic, title, message, priority: 4, tags: ['moneybag'] };
  if (click && /^https?:\/\//.test(click)) body.click = click; // toucher la notification ouvre l'espace gérant
  // Publication JSON à la racine : requête simple, sans en-têtes personnalisés
  const r = await fetch(NTFY, { method: 'POST', body: JSON.stringify(body), keepalive: true });
  if (!r.ok) throw new Error('ntfy : erreur HTTP ' + r.status);
}

// FormSubmit : relais gratuit, sans compte. Le 1er envoi déclenche un email d'activation au propriétaire.
const FORMSUBMIT = 'https://formsubmit.co/ajax/';
export const validEmailTarget = (t) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(t || '') || /^[A-Za-z0-9]{8,64}$/.test(t || ''); // adresse, ou alias reçu après activation

export async function sendFormSubmit(target, fields) {
  if (!validEmailTarget(target)) throw new Error('Adresse email invalide');
  const r = await fetch(FORMSUBMIT + encodeURIComponent(target), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ _captcha: 'false', _template: 'table', ...fields }),
    keepalive: true,
  });
  let d = null;
  try { d = await r.json(); } catch { /* réponse non JSON */ }
  if (!r.ok || (d && (d.success === false || d.success === 'false'))) throw new Error((d && d.message) || 'FormSubmit : erreur HTTP ' + r.status);
  return d;
}

// Lance les alertes configurées ; ne lève jamais d'erreur (une alerte ratée ne doit pas bloquer la commande)
export function alertsForOrder(notify, o, adminUrl) {
  const jobs = [];
  if (notify && validTopic(notify.ntfyTopic)) {
    jobs.push(sendNtfy(notify.ntfyTopic, { title: 'Zone Tickets', message: 'Nouvelle demande de paiement à confirmer.', click: adminUrl }));
  }
  if (notify && validEmailTarget(notify.email)) {
    jobs.push(sendFormSubmit(notify.email, {
      _subject: `Paiement à confirmer : ${o.amount} FCFA (${o.wifi})`,
      'Wifi zone': o.wifi, Forfait: o.plan, 'Montant (FCFA)': o.amount, Via: o.method, 'Référence': o.reference, Client: o.phone, Confirmer: adminUrl,
    }));
  }
  return Promise.allSettled(jobs);
}
