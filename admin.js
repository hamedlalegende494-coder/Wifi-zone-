import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, collection, query, where, limit,
  onSnapshot, getDocs, writeBatch, runTransaction, serverTimestamp, increment,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';
import { $, toast, copy, download } from './ui.js';
import { esc, money, dur, genCode, importScript, stockKey } from './lib.js';

let auth, db, U = null, OP = null, registering = false, unsubs = [];
let plans = [], routers = [], accounts = [], stats = {}, unimported = [];
const loaded = { plans: false, routers: false, accounts: false };
const fail = (e) => { console.error(e); toast(e.message || 'Une erreur est survenue'); };
const col = (...p) => collection(db, 'operators', U.uid, ...p);
const statsRef = () => doc(db, 'operators', U.uid, 'stats', 'summary');
const num = (v) => Number(String(v).replace(/\s/g, ''));
const AUTH_ERR = {
  'auth/invalid-credential': 'Email ou mot de passe incorrect',
  'auth/wrong-password': 'Email ou mot de passe incorrect',
  'auth/user-not-found': 'Email ou mot de passe incorrect',
  'auth/email-already-in-use': 'Cet email a déjà un compte',
  'auth/weak-password': 'Mot de passe trop court (8 caractères minimum)',
  'auth/invalid-email': 'Email invalide',
  'auth/too-many-requests': 'Trop de tentatives, réessayez plus tard',
};

// ---------- Connexion / inscription ----------
let MODE = 'login';
function setMode(m) {
  MODE = m;
  $('regFields').hidden = m !== 'register';
  $('authTitle').textContent = m === 'register' ? 'Créer un compte' : 'Connexion';
  $('authGo').textContent = m === 'register' ? 'Créer mon compte' : 'Se connecter';
  $('authSwitch').textContent = m === 'register' ? 'J\'ai déjà un compte' : 'Créer un compte';
  $('authMsg').textContent = '';
}
$('authSwitch').onclick = () => setMode(MODE === 'login' ? 'register' : 'login');
$('authGo').onclick = async () => {
  const email = $('aemail').value.trim(), pass = $('apass').value;
  $('authMsg').textContent = '';
  try {
    if (MODE === 'login') { await signInWithEmailAndPassword(auth, email, pass); return; }
    const name = $('aname').value.trim().slice(0, 80), slug = $('aslug').value.trim();
    if (!name || !/^[a-z0-9-]{3,30}$/.test(slug)) throw new Error('Nom et identifiant (3 à 30 caractères : a-z, 0-9, -) requis');
    if (pass.length < 8) throw new Error('Mot de passe trop court (8 caractères minimum)');
    if ((await getDoc(doc(db, 'portals', slug))).exists()) throw new Error('Cet identifiant est déjà pris');
    registering = true;
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    await setDoc(doc(db, 'operators', cred.user.uid), { name, slug, createdAt: serverTimestamp() });
    await setDoc(doc(db, 'portals', slug), { ownerUid: cred.user.uid, name, plans: {}, routers: {}, accounts: {} });
    registering = false;
    await start(cred.user);
  } catch (e) {
    registering = false;
    $('authMsg').textContent = AUTH_ERR[e.code] || e.message;
  }
};
$('logout').onclick = () => signOut(auth);

// ---------- Vitrine publique (ce que voient les clients) ----------
let portalTimer = null;
function schedulePortalSync() {
  clearTimeout(portalTimer);
  portalTimer = setTimeout(syncPortal, 600);
}
async function syncPortal() {
  if (!OP || !loaded.plans || !loaded.routers || !loaded.accounts) return; // pas avant le 1er chargement : ne jamais écraser avec des listes vides
  const m = (arr, f) => Object.fromEntries(arr.map((x) => [x.id, f(x)]));
  try {
    await setDoc(doc(db, 'portals', OP.slug), {
      ownerUid: U.uid, name: OP.name,
      plans: m(plans, (p) => ({ name: p.name, minutes: p.minutes, price: p.price })),
      routers: m(routers, (r) => ({ name: r.name, loginUrl: r.loginUrl || '' })),
      accounts: m(accounts, (a) => ({ label: a.label, number: a.number, holder: a.holder || '' })),
    });
  } catch (e) { fail(e); }
}

// ---------- Affichage ----------
const routerName = (id) => (routers.find((r) => r.id === id) || {}).name || '—';
const ago = (ts) => {
  const ms = ts && ts.toMillis ? ts.toMillis() : Date.now();
  const m = Math.max(0, Math.round((Date.now() - ms) / 60000));
  return m < 1 ? 'à l\'instant' : 'il y a ' + m + ' min';
};

function renderPlans() {
  $('planRows').innerHTML = plans.length ? plans.map((p) =>
    `<tr><td>${esc(p.name)}</td><td>${dur(p.minutes)}</td><td>${money(p.price)}</td><td><button class="btn ghost" data-delp="${esc(p.id)}">Supprimer</button></td></tr>`).join('')
    : '<tr><td colspan="4">Aucun forfait. Ajoutez-en un ci-dessous.</td></tr>';
  $('gp').innerHTML = plans.map((p) => `<option value="${esc(p.id)}">${esc(p.name)} (${dur(p.minutes)})</option>`).join('');
  renderStats();
}
function renderRouters() {
  $('routerRows').innerHTML = routers.length ? routers.map((r) =>
    `<tr><td>${esc(r.name)}</td><td>${esc(r.profile || 'default')}</td><td>${esc(r.loginUrl || '—')}</td><td><button class="btn ghost" data-delr="${esc(r.id)}">Supprimer</button></td></tr>`).join('')
    : '<tr><td colspan="4">Aucun point wifi. Ajoutez votre premier routeur ci-dessous.</td></tr>';
  $('gr').innerHTML = routers.map((r) => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('');
  renderStats(); renderBatches();
}
function renderAccounts() {
  $('accRows').innerHTML = accounts.length ? accounts.map((a) =>
    `<tr><td>${esc(a.label)}</td><td>${esc(a.number)}</td><td>${esc(a.holder || '—')}</td><td><button class="btn ghost" data-dela="${esc(a.id)}">Supprimer</button></td></tr>`).join('')
    : '<tr><td colspan="4">Aucun numéro. Ajoutez-en un pour activer les paiements.</td></tr>';
}
function renderStats() {
  const stock = stats.stock || {};
  const total = Object.values(stock).reduce((a, n) => a + Math.max(0, n), 0);
  $('stats').innerHTML = [['Tickets en stock', total], ['Ventes', stats.sales || 0], ['Revenus', money(stats.revenue || 0)]]
    .map((c) => `<div class="stat"><b>${c[1]}</b><span>${c[0]}</span></div>`).join('');
  const rows = Object.entries(stock).filter(([, n]) => n > 0).map(([k, n]) => {
    const [rid, pid] = k.split('_');
    const p = plans.find((x) => x.id === pid);
    return `<div>${esc(routerName(rid))} · ${esc(p ? p.name : '?')} : <b>${n}</b>${n < 10 ? ' <span class="badge b-expired">stock faible</span>' : ''}</div>`;
  });
  $('stockList').innerHTML = rows.length ? rows.join('') : 'Aucun ticket vendable en stock. Générez un lot puis importez-le sur le routeur.';
}

// ---------- Lots de tickets à importer ----------
function groupByRouter() {
  const g = {};
  unimported.forEach((t) => { (g[t.routerId] = g[t.routerId] || []).push(t); });
  return g;
}
function renderBatches() {
  const g = groupByRouter(), ids = Object.keys(g);
  if (!ids.length) { $('batches').innerHTML = '<p class="hint">Aucun lot en attente.</p>'; return; }
  $('batches').innerHTML = ids.map((rid) => {
    const list = g[rid], r = routers.find((x) => x.id === rid);
    const script = r ? importScript(list.map((t) => ({ code: t.code, minutes: t.minutes })), r.profile) : '';
    return `<div class="panel"><b>${esc(routerName(rid))} : ${list.length} ticket(s)</b>
      <p class="hint">1. Téléchargez le fichier puis glissez-le dans <i>Files</i> de WinBox, et lancez <code>/import file-name=zone-tickets.rsc</code> dans un terminal (ou copiez le script et collez-le dans le terminal).<br>2. Cliquez ensuite sur « Importé » : les tickets deviennent vendables.</p>
      ${r ? `<div class="codes">${esc(script)}</div>
      <div class="row"><button class="btn ghost" data-cps="${esc(rid)}">Copier le script</button><button class="btn ghost" data-dls="${esc(rid)}">Télécharger .rsc</button><button class="btn" data-done="${esc(rid)}">Importé : rendre vendables</button></div>`
      : '<p class="msg err">Ce point wifi a été supprimé : ces tickets ne peuvent plus être importés.</p>'}</div>`;
  }).join('');
}
$('batches').onclick = async (e) => {
  const t = e.target.dataset, g = groupByRouter();
  try {
    const rid = t.cps || t.dls || t.done;
    if (!rid) return;
    const r = routers.find((x) => x.id === rid);
    const script = importScript(g[rid].map((x) => ({ code: x.code, minutes: x.minutes })), r.profile);
    if (t.cps) copy(script);
    else if (t.dls) download('zone-tickets.rsc', script);
    else if (confirm('Avez-vous bien importé ce lot sur le routeur ? Les tickets vont devenir vendables.')) {
      e.target.disabled = true;
      const list = g[rid];
      for (let i = 0; i < list.length; i += 400) { // une écriture groupée accepte 500 opérations au maximum
        const chunk = list.slice(i, i + 400), counts = {};
        const b = writeBatch(db);
        chunk.forEach((x) => {
          b.update(doc(db, 'operators', U.uid, 'tickets', x.code), { imported: true });
          const k = stockKey(x.routerId, x.planId);
          counts[k] = (counts[k] || 0) + 1;
        });
        const stock = Object.fromEntries(Object.entries(counts).map(([k, n]) => [k, increment(n)]));
        b.set(statsRef(), { stock }, { merge: true });
        await b.commit();
      }
      toast('Tickets disponibles à la vente');
    }
  } catch (err) { e.target.disabled = false; fail(err); }
};

// ---------- Paiements à confirmer ----------
let lastPending = null;
const BASE_TITLE = document.title;
function beep() {
  try {
    const c = new (window.AudioContext || window.webkitAudioContext)();
    const o = c.createOscillator();
    o.frequency.value = 880; o.connect(c.destination); o.start();
    setTimeout(() => { o.stop(); c.close(); }, 250);
  } catch { /* son indisponible */ }
}
async function notifyNew(n) {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const title = n + ' paiement(s) à confirmer';
    const opts = { body: 'Ouvrez l\'application pour confirmer.', icon: './icon-192.png', tag: 'zt-pending', renotify: true };
    const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
    if (reg) reg.showNotification(title, opts); else new Notification(title, opts);
  } catch { /* notifications indisponibles */ }
}
function renderPending(rows) {
  rows.sort((a, b) => (a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : 9e15) - (b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 9e15));
  if (lastPending !== null && rows.length > lastPending) { beep(); toast('Nouveau paiement à confirmer'); notifyNew(rows.length); }
  lastPending = rows.length;
  document.title = (rows.length ? `(${rows.length}) ` : '') + BASE_TITLE;
  $('pendBox').innerHTML = rows.length ? rows.map((o) => `<div class="panel" style="margin-top:8px">
    <b>${money(o.amount)}</b> · ${esc(o.planName)} · ${esc(routerName(o.routerId))}<br>
    Via ${esc(o.accountLabel)}<br>Référence : <b>${esc(o.reference)}</b> · Client : ${esc(o.phone)}<br>
    <span class="hint">${ago(o.createdAt)}. Confirmez seulement si vous avez bien reçu ce montant (vérifiez dans votre application ou par SMS).</span>
    <div class="row"><button class="btn" data-ok="${esc(o.id)}">Confirmer le paiement</button><button class="btn ghost" data-no="${esc(o.id)}">Refuser</button></div></div>`).join('')
    : '<p class="hint">Aucun paiement en attente. Gardez cette page ouverte pour être prévenu (son et titre de l\'onglet).</p>';
  renderPending.rows = rows;
}

async function confirmOrder(o) {
  // Alerte si la même référence a déjà servi pour une vente confirmée
  const dup = await getDocs(query(collection(db, 'orders'), where('ownerUid', '==', U.uid), where('reference', '==', o.reference), where('status', '==', 'paid')));
  if (!dup.empty && !confirm('Cette référence a déjà servi pour une autre vente. Confirmer quand même ?')) return false;
  for (let attempt = 0; attempt < 3; attempt++) {
    const q = await getDocs(query(col('tickets'), where('routerId', '==', o.routerId), where('planId', '==', o.planId),
      where('status', '==', 'new'), where('imported', '==', true), limit(1)));
    if (q.empty) throw new Error('Stock épuisé pour ce forfait sur ce point wifi : générez un lot puis importez-le sur le routeur.');
    const tRef = q.docs[0].ref, oRef = doc(db, 'orders', o.id), key = stockKey(o.routerId, o.planId);
    try {
      await runTransaction(db, async (tx) => {
        const [os, ts] = await Promise.all([tx.get(oRef), tx.get(tRef)]);
        if (!os.exists() || os.data().status !== 'pending') throw new Error('Commande déjà traitée');
        if (ts.data().status !== 'new') throw new Error('RETRY'); // ticket pris entre-temps : on en cherche un autre
        tx.update(tRef, { status: 'sold', soldAt: serverTimestamp(), orderId: o.id });
        tx.update(oRef, { status: 'paid', code: ts.id, ticketId: ts.id, paidAt: serverTimestamp() });
        tx.set(statsRef(), { revenue: increment(o.amount), sales: increment(1), stock: { [key]: increment(-1) } }, { merge: true });
      });
      return true;
    } catch (e) { if (e.message !== 'RETRY') throw e; }
  }
  throw new Error('Réessayez dans un instant.');
}
$('pendBox').onclick = async (e) => {
  const t = e.target.dataset;
  const id = t.ok || t.no;
  if (!id) return;
  const o = (renderPending.rows || []).find((x) => x.id === id);
  if (!o) return;
  try {
    e.target.disabled = true;
    if (t.ok) {
      if (!confirm(`Avez-vous bien reçu ${money(o.amount)} sur votre compte ?\nLe client recevra son code.`)) { e.target.disabled = false; return; }
      if (await confirmOrder(o)) toast('Paiement confirmé : le code est affiché chez le client');
    } else if (confirm('Refuser cette demande ? Le client sera prévenu que le paiement n\'a pas été confirmé.')) {
      await updateDoc(doc(db, 'orders', id), { status: 'cancelled' });
    }
  } catch (err) { fail(err); }
  e.target.disabled = false;
};

// ---------- Actions : forfaits, routeurs, numéros, génération ----------
$('addPlan').onclick = async () => {
  const name = $('pn').value.trim(), minutes = num($('pm').value), price = num($('pp').value);
  if (!name || !Number.isInteger(minutes) || minutes < 1 || !Number.isInteger(price) || price < 0) return toast('Renseignez le nom, la durée (minutes) et le prix');
  try { await addDoc(col('plans'), { name: name.slice(0, 60), minutes, price }); ['pn', 'pm', 'pp'].forEach((i) => ($(i).value = '')); } catch (e) { fail(e); }
};
$('planRows').onclick = async (e) => {
  const id = e.target.dataset.delp;
  if (!id) return;
  const left = Object.entries(stats.stock || {}).filter(([k, n]) => k.endsWith('_' + id) && n > 0).length;
  if (left && !confirm('Des tickets de ce forfait sont encore en stock. Supprimer quand même ?')) return;
  try { await deleteDoc(doc(db, 'operators', U.uid, 'plans', id)); } catch (err) { fail(err); }
};
$('addRouter').onclick = async () => {
  const name = $('rn').value.trim(), profile = $('rp').value.trim() || 'default', loginUrl = $('rl').value.trim();
  if (!name) return toast('Donnez un nom au point wifi');
  if (!/^[A-Za-z0-9_.-]{1,40}$/.test(profile)) return toast('Profil hotspot : lettres, chiffres, tiret, point ou souligné');
  if (loginUrl && !/^https?:\/\//.test(loginUrl)) return toast('L\'URL doit commencer par http:// ou https://');
  try { await addDoc(col('routers'), { name: name.slice(0, 60), profile, loginUrl }); ['rn', 'rp', 'rl'].forEach((i) => ($(i).value = '')); } catch (e) { fail(e); }
};
$('routerRows').onclick = async (e) => {
  const id = e.target.dataset.delr;
  if (!id || !confirm('Supprimer ce point wifi ? (Les tickets déjà importés restent sur le routeur.)')) return;
  try { await deleteDoc(doc(db, 'operators', U.uid, 'routers', id)); } catch (err) { fail(err); }
};
$('addAcc').onclick = async () => {
  const label = $('al').value.trim(), number = $('an').value.trim(), holder = $('ah').value.trim();
  if (!label || !/^[0-9 +().-]{6,30}$/.test(number)) return toast('Opérateur et numéro valide requis');
  try { await addDoc(col('accounts'), { label: label.slice(0, 40), number, holder: holder.slice(0, 60) }); ['al', 'an', 'ah'].forEach((i) => ($(i).value = '')); } catch (e) { fail(e); }
};
$('accRows').onclick = async (e) => {
  const id = e.target.dataset.dela;
  if (!id) return;
  try { await deleteDoc(doc(db, 'operators', U.uid, 'accounts', id)); } catch (err) { fail(err); }
};
$('gen').onclick = async () => {
  const routerId = $('gr').value, planId = $('gp').value, n = Math.min(200, Math.max(1, Math.floor(num($('gq').value)) || 0));
  const plan = plans.find((p) => p.id === planId);
  if (!routerId || !plan) return toast('Ajoutez d\'abord un point wifi et un forfait');
  $('gen').disabled = true;
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const codes = new Set();
      while (codes.size < n) codes.add(genCode());
      const b = writeBatch(db);
      codes.forEach((c) => b.set(doc(db, 'operators', U.uid, 'tickets', c), {
        code: c, routerId, planId, planName: plan.name, minutes: plan.minutes, status: 'new', imported: false, createdAt: serverTimestamp(),
      }));
      try { await b.commit(); toast(n + ' tickets créés : importez-les sur le routeur'); break; }
      catch (e) { if (attempt === 2) throw e; } // collision de code (très rare) : on retire un nouveau lot
    }
  } catch (e) { fail(e); }
  $('gen').disabled = false;
};
$('copyLink').onclick = () => copy($('clientLink').textContent);

// ---------- Démarrage ----------
function stop() { unsubs.forEach((u) => u()); unsubs = []; }
function watchList(ref, assign, key) {
  unsubs.push(onSnapshot(ref, (s) => {
    assign(s.docs.map((d) => ({ id: d.id, ...d.data() })));
    if (key) { loaded[key] = true; schedulePortalSync(); }
  }, fail));
}
async function start(user) {
  U = user;
  const snap = await getDoc(doc(db, 'operators', U.uid));
  if (!snap.exists()) { await signOut(auth); $('authMsg').textContent = 'Compte incomplet : créez un nouveau compte.'; return; }
  OP = snap.data();
  $('auth').hidden = true; $('app').hidden = false;
  $('brand').textContent = OP.name;
  $('clientLink').textContent = new URL('./?op=' + OP.slug, location.href).href;
  loaded.plans = loaded.routers = loaded.accounts = false;
  stop();
  watchList(col('plans'), (l) => { plans = l.sort((a, b) => a.minutes - b.minutes); renderPlans(); }, 'plans');
  watchList(col('routers'), (l) => { routers = l; renderRouters(); }, 'routers');
  watchList(col('accounts'), (l) => { accounts = l; renderAccounts(); }, 'accounts');
  watchList(query(col('tickets'), where('imported', '==', false)), (l) => { unimported = l.sort((a, b) => a.code.localeCompare(b.code)); renderBatches(); });
  unsubs.push(onSnapshot(statsRef(), (s) => { stats = s.exists() ? s.data() : {}; renderStats(); }, fail));
  lastPending = null;
  watchList(query(collection(db, 'orders'), where('ownerUid', '==', U.uid), where('status', '==', 'pending')), renderPending);
}

// ---------- Application installable (PWA) ----------
let installEvt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; $('installBtn').hidden = false; });
window.addEventListener('appinstalled', () => { $('installBtn').hidden = true; toast('Application installée'); });
$('installBtn').onclick = async () => {
  if (!installEvt) return;
  installEvt.prompt();
  await installEvt.userChoice.catch(() => {});
  installEvt = null; $('installBtn').hidden = true;
};
function updateNotifBtn() { $('notifBtn').hidden = !('Notification' in window) || Notification.permission !== 'default'; }
$('notifBtn').onclick = async () => { try { await Notification.requestPermission(); } catch { /* refusé */ } updateNotifBtn(); };
updateNotifBtn();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});

function init() {
  if (!firebaseConfig.projectId) { $('auth').hidden = false; $('authMsg').textContent = 'Configuration Firebase manquante (fichier firebase-config.js).'; return; }
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app); db = getFirestore(app);
  onAuthStateChanged(auth, (user) => {
    if (registering) return;
    if (user) start(user).catch(fail);
    else { stop(); U = OP = null; $('app').hidden = true; $('auth').hidden = false; document.title = BASE_TITLE; }
  });
}
init();
