const toastEl = document.getElementById('toast');
let toastTimer;

export function showToast(msg, type) {
  toastEl.textContent = msg;
  toastEl.className = 'show ' + (type || 'success');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.className = ''; }, 3000);
}
