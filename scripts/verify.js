(async () => {
  const base = 'http://localhost:3000';
  let r = await fetch(base + '/api/files?view=songs&page=1');
  let d = await r.json();
  console.log('songs view:', r.status, 'mode=' + d.mode, 'items=' + (d.items || []).length);

  r = await fetch(base + '/api/songs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Verify Test Song' }),
  });
  d = await r.json();
  console.log('create song:', r.status, 'id=' + d.id);
  const songId = d.id;

  r = await fetch(base + '/api/files?view=songs&page=1');
  d = await r.json();
  console.log('songs list:', d.items?.[0]?.name, 'assets=' + d.items?.[0]?.assetCount);

  r = await fetch(base + '/api/tags');
  const tags = await r.json();
  if (tags.length) {
    r = await fetch(base + '/api/folders/tag', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '', tag_id: tags[0].id }),
    });
    const ft = await r.json();
    console.log('folder tag:', r.status, (ft.tags || []).map((t) => t.name).join(','));
  }

  if (songId) {
    r = await fetch(base + '/api/songs/' + songId, { method: 'DELETE' });
    console.log('delete song:', r.status);
  }

  r = await fetch(base + '/');
  const html = await r.text();
  for (const c of [
    'view-tab-songs', 'name-input-modal', 'viewer-pdf-btn',
    'viewer-song-bar', 'add-song-modal', '/css/app.css', 'type="module"',
  ]) {
    console.log('html', c + ':', html.includes(c));
  }

  r = await fetch(base + '/api/setup');
  d = await r.json();
  console.log('setup:', 'configured=' + d.configured, 'docker=' + d.docker, 'shareDir=' + (d.shareDir || '(none)'));
})();
