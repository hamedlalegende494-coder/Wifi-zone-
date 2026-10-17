// Prévenir le gérant par WhatsApp ou SMS : le client touche un bouton, son téléphone ouvre l'application
// avec un message déjà écrit (montant, forfait, référence, numéro). Aucun service ni serveur nécessaire.
// Le numéro est publié dans la vitrine publique (comme les numéros Mobile Money).

// Chiffres uniquement, sans « + » ni « 00 » initial (format international : indicatif pays + numéro)
export const digits = (s) => String(s == null ? '' : s).replace(/\D/g, '').replace(/^00/, '');
export function normalizePhone(s) {
  const d = digits(s);
  return /^\d{10,15}$/.test(d) ? d : null;
}

export function orderMessage(o) {
  return `Bonjour, j'ai payé ${o.amount} FCFA (${o.plan}) via ${o.method}.\n` +
    `Référence : ${o.reference}\nMon numéro : ${o.phone}\n` +
    `Merci de confirmer mon paiement. (${o.wifi})`;
}

export const whatsappLink = (num, msg) => `https://wa.me/${num}?text=${encodeURIComponent(msg)}`;
export const smsLink = (num, msg) => `sms:+${num}?&body=${encodeURIComponent(msg)}`; // « ?& » : compatible Android et iPhone

export function contactLinks(notify, order) {
  const msg = orderMessage(order);
  const wa = normalizePhone(notify && notify.whatsapp), sm = normalizePhone(notify && notify.sms);
  return { whatsapp: wa ? whatsappLink(wa, msg) : null, sms: sm ? smsLink(sm, msg) : null };
}
