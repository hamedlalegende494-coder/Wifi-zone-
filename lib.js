// Fonctions pures (sans DOM) : testables sous Node
export const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans 0, 1, I, O (lisibilité)
const CODE_RE = new RegExp(`^[${ALPHA}]{4}-[${ALPHA}]{4}$`);

export function genCode() {
  const b = new Uint8Array(8);
  globalThis.crypto.getRandomValues(b);
  let s = '';
  for (const x of b) s += ALPHA[x & 31]; // 256 est un multiple de 32 : tirage uniforme
  return s.slice(0, 4) + '-' + s.slice(4);
}

export const uptime = (m) => `${Math.floor(m / 60)}h${m % 60}m`;
export const stockKey = (routerId, planId) => `${routerId}_${planId}`;
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const money = (n) => Number(n).toLocaleString('fr-FR') + ' FCFA';
export function dur(m) {
  if (m >= 10080 && m % 10080 === 0) return m / 10080 + ' sem.';
  if (m >= 1440 && m % 1440 === 0) return m / 1440 + ' j';
  if (m >= 60 && m % 60 === 0) return m / 60 + ' h';
  return m + ' min';
}

// Script RouterOS à importer sur le MikroTik : un utilisateur hotspot par ticket, avec limite de temps de connexion
export function importScript(tickets, profile) {
  const prof = /^[A-Za-z0-9_.-]{1,40}$/.test(profile || '') ? profile : 'default';
  const lines = tickets.map((t) => {
    if (!CODE_RE.test(t.code) || !Number.isInteger(t.minutes) || t.minutes < 1) throw new Error('Ticket invalide : ' + t.code);
    return `:do {/ip hotspot user add name="${t.code}" password="${t.code}" profile="${prof}" limit-uptime=${uptime(t.minutes)} comment=zone-tickets} on-error={}`;
  });
  return `# Zone Tickets : ${tickets.length} ticket(s)\n${lines.join('\n')}\n`;
}
