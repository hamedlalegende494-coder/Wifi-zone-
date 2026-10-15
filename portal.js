import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getFirestore, doc, getDoc, addDoc, collection, serverTimestamp, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';
import { $, toast, copy } from './ui.js';
import { esc, money, dur } from './lib.js';

const QS = new URLSearchParams(location.search);
// Fonctionne avec /p/<identifiant> (Firebase Hosting) ou ?op=<identifiant> (GitHub Pages)
const slug = (location.pathname.match(/\/p\/([a-z0-9-]+)/) || [])[1] || QS.get('op');
const LS = 'zt_order_' + slug;
let db, P, plans = [], routers = [], accounts = [], selPlan = null, selAccount = null, refValue = '', busy = false, unsub = null;

const say = (cls, t) => { $('payMsg').className = 'msg ' + cls; $('payMsg').textContent = t; };
function showError(msg) { $('error').hidden = false; $('error').textContent = msg; }
const list = (m) => Object.entries(m || {}).map(([id, v]) => ({ id, ...v }));

function render() {
  $('plans').innerHTML = plans.map((p) =>
    `<button class="plan" role="radio" data-id="${esc(p.id)}" aria-checked="${selPlan === p.id}"><b>${esc(p.name)}</b><span>${dur(p.minutes)} de connexion</span><em>${money(p.price)}</em></button>`).join('');
  const plan = plans.find((p) => p.id === selPlan);
  if (!selAccount && accounts.length === 1) selAccount = accounts[0].id;
  $('manualBox').innerHTML = `<b>1. Envoyez ${plan ? money(plan.price) : 'le montant du forfait'} par Mobile Money</b>
    <p class="hint">Choisissez le numéro sur lequel vous envoyez l'argent :</p>
    <div class="chips">${accounts.map((a) => `<button class="chip" data-acc="${esc(a.id)}" aria-pressed="${selAccount === a.id}">${esc(a.label)} · ${esc(a.number)}${a.holder ? ' (' + esc(a.holder) + ')' : ''}</button>`).join('')}</div>
    ${selAccount ? '<div class="row"><button class="btn ghost" id="cpn">Copier le numéro</button></div>' : ''}
    <p style="margin:14px 0 4px"><b>2. Indiquez la référence de la transaction</b></p>
    <label for="ref">Référence reçue par SMS</label><input id="ref" value="${esc(refValue)}" autocomplete="off" placeholder="Ex. MP260101.1234.A56789">
    <p class="hint">Le gérant vérifiera votre paiement, puis votre code s'affichera ici.</p>`;
  if (selAccount) $('cpn').onclick = () => copy(accounts.find((a) => a.id === selAccount).number);
  $('ref').oninput = () => { refValue = $('ref').value; };
}

function showTicket(o) {
  const r = routers.find((x) => x.id === o.routerId);
  const canLogin = r && /^https?:\/\//.test(r.loginUrl || '');
  $('result').innerHTML = `<div class="ticket"><div class="main"><span style="color:var(--mute)">Votre ticket wifi</span>
    <div class="code">${esc(o.code)}</div>
    <button class="btn" id="cp">Copier le code</button>${canLogin ? ' <button class="btn ghost" id="go">Me connecter maintenant</button>' : ''}
    <p class="hint">${canLogin ? '' : 'Entrez ce code sur la page de connexion du wifi. '}Gardez-le : il reste affiché sur cette page.</p></div>
    <div class="perf"></div><div class="stub"><b>${dur(o.minutes)}</b><span>${esc(o.planName)}</span></div></div>`;
  $('cp').onclick = () => copy(o.code);
  if (canLogin) $('go').onclick = () => {
    const q = 'username=' + encodeURIComponent(o.code) + '&password=' + encodeURIComponent(o.code);
    location.href = r.loginUrl + (r.loginUrl.includes('?') ? '&' : '?') + q;
  };
}

// Suivi en direct de la commande : le code apparaît dès que le gérant confirme
function watch(id) {
  if (unsub) unsub();
  unsub = onSnapshot(doc(db, 'orders', id), (snap) => {
    if (!snap.exists()) return;
    const o = snap.data();
    if (o.status === 'paid' && o.code) {
      say('ok', 'Paiement confirmé par le gérant.');
      showTicket(o);
      $('pay').disabled = false; busy = false;
      unsub(); unsub = null;
    } else if (o.status === 'cancelled') {
      try { localStorage.removeItem(LS); } catch {}
      say('err', 'Le gérant n\'a pas pu confirmer votre paiement. Vérifiez la référence ou contactez-le (commande ' + id + ').');
      $('pay').disabled = false; busy = false;
      unsub(); unsub = null;
    } else {
      say('', 'Demande envoyée au gérant. Dès qu\'il confirme votre paiement, votre code s\'affichera ici : gardez cette page ouverte.');
      $('pay').disabled = true; busy = true;
    }
  }, () => say('err', 'Impossible de suivre la commande. Rechargez la page.'));
}

async function pay() {
  if (busy) return;
  const phone = $('phone').value.replace(/\D/g, '');
  if (!selPlan) return say('err', 'Choisissez un forfait.');
  if (!selAccount) return say('err', 'Choisissez le numéro sur lequel vous avez envoyé l\'argent.');
  if (phone.length < 8 || phone.length > 20) return say('err', 'Entrez un numéro de téléphone valide.');
  if (refValue.trim().length < 4) return say('err', 'Entrez la référence de la transaction reçue par SMS.');
  const p = plans.find((x) => x.id === selPlan), a = accounts.find((x) => x.id === selAccount);
  busy = true; $('pay').disabled = true;
  try {
    const ref = await addDoc(collection(db, 'orders'), {
      ownerUid: P.ownerUid, slug, routerId: $('router').value,
      planId: p.id, planName: p.name, minutes: p.minutes, amount: p.price,
      phone, accountId: a.id, accountLabel: a.label + ' ' + a.number,
      reference: refValue.trim().slice(0, 60), status: 'pending', createdAt: serverTimestamp(),
    });
    try { localStorage.setItem(LS, ref.id); } catch {}
    watch(ref.id);
  } catch (e) {
    console.error(e);
    busy = false; $('pay').disabled = false;
    say('err', 'La demande n\'a pas pu être envoyée. Vérifiez votre connexion puis réessayez.');
  }
}

async function init() {
  if (!firebaseConfig.projectId) return showError('Configuration Firebase manquante (fichier firebase-config.js).');
  if (!slug) return showError('Lien invalide : ouvrez le portail depuis le lien fourni par votre point wifi.');
  db = getFirestore(initializeApp(firebaseConfig));
  let snap;
  try { snap = await getDoc(doc(db, 'portals', slug)); }
  catch { return showError('Connexion impossible. Vérifiez votre connexion internet.'); }
  if (!snap.exists()) return showError('Portail introuvable.');
  P = snap.data();
  plans = list(P.plans).sort((a, b) => a.minutes - b.minutes);
  routers = list(P.routers);
  accounts = list(P.accounts);
  document.title = P.name; $('brand').textContent = P.name;
  if (!plans.length || !routers.length) return showError('Ce point wifi n\'est pas encore configuré.');
  if (!accounts.length) return showError('Aucun moyen de paiement n\'est encore configuré pour ce point wifi.');
  $('main').hidden = false;
  $('router').innerHTML = routers.map((r) => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('');
  const pre = QS.get('r');
  if (pre && routers.some((r) => r.id === pre)) $('router').value = pre;
  $('routerBox').hidden = routers.length < 2;
  render();
  $('plans').onclick = (e) => { const b = e.target.closest('.plan'); if (b) { selPlan = b.dataset.id; render(); } };
  $('manualBox').onclick = (e) => { const b = e.target.closest('[data-acc]'); if (b) { selAccount = b.dataset.acc; render(); } };
  $('pay').onclick = pay;
  let saved = null;
  try { saved = localStorage.getItem(LS); } catch {}
  if (saved) watch(saved); // reprend la commande en cours (page rechargée)
}
init();
