export const $ = (id) => document.getElementById(id);
export function toast(t) {
  const e = $('toast');
  e.textContent = t;
  e.className = 'on';
  clearTimeout(toast.h);
  toast.h = setTimeout(() => (e.className = ''), 2800);
}
export function copy(t) {
  try { navigator.clipboard.writeText(t).then(() => toast('Copié'), () => toast('Copie impossible')); }
  catch { toast('Copie impossible'); }
}
export function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
