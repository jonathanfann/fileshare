/** HTTP helpers — extend as routes are modularized */

export async function fetchJson(url, options = {}) {
  const r = await fetch(url, options);
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}
