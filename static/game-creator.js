import { loadShell } from './shell.js';

const $ = (id) => document.getElementById(id);
const API = '/api/game-creator';
const imageURL = (id) => `${API}/assets/${encodeURIComponent(id)}/image`;
const state = { draft: null, record: null, baseline: '', busy: false, crop: null, preview: null, libraryLoaded: false };
const actor = () => ({ name: '', asset_id: '', behavior: 'straight', speed: 'normal' });
const newRecipe = () => ({ schema_version: 1, title: '', template: 'flyer', theme: 'sky', difficulty: 'gentle', shots: 'bubbles', player: { name: '', asset_id: '' }, enemies: [actor()] });
const recipeOf = (r) => ({ schema_version: 1, title: r.title, template: r.template, theme: r.theme, difficulty: r.difficulty, shots: r.shots, player: { ...r.player }, enemies: r.enemies.map((e) => ({ ...e })) });
const dirty = () => state.draft && JSON.stringify(state.draft) !== state.baseline;
function node(tag, text, className) { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; }
function button(text, action) { const el = node('button', text); el.type = 'button'; el.addEventListener('click', action); return el; }
function notice(id, text = '') { $(id).textContent = text; }
async function request(path, options = {}) {
  const response = await fetch(API + path, options);
  let body;
  try { body = await response.json(); } catch { body = null; }
  if (!response.ok) {
    const detail = typeof body?.detail === 'string' ? body.detail : typeof body?.error === 'string' ? body.error : `The server could not finish that request (${response.status}).`;
    const error = new Error(detail); error.status = response.status; throw error;
  }
  return body;
}
function setBusy(value) {
  state.busy = value;
  $('editor-fields').disabled = value;
  $('crop-fields').disabled = value;
  for (const id of ['new-game', 'resume-game', 'refresh-library', 'back-library', 'save-copy', 'load-latest']) $(id).disabled = value;
  $('library-grid').querySelectorAll('button').forEach((el) => { el.disabled = value; });
}
async function run(target, work) {
  if (state.busy) return;
  setBusy(true); notice(target);
  try { await work(); } catch (error) { notice(target, `${error.message} Your draft has not been discarded. Please try again.`); }
  finally { setBusy(false); }
}
function changed() {
  $('draft-status').textContent = dirty() ? 'Unsaved changes · Your draft stays here while you preview or visit your library. Save before leaving this page.' : state.record ? `Saved · revision ${state.record.revision}` : 'Start with a name, then add your drawings.';
  $('saved-play').hidden = !state.record || dirty();
}
function mayReplace() { return !dirty() || window.confirm('Replace your unsaved draft? Choose Cancel to keep working and save it first.'); }
function showEditor() { $('library-view').hidden = true; $('editor-view').hidden = false; changed(); }
function openDraft(record = null) {
  state.record = record; state.draft = record ? recipeOf(record) : newRecipe(); state.baseline = JSON.stringify(state.draft);
  $('editor-heading').textContent = record ? 'Edit your game' : 'Create a game';
  $('conflict-panel').hidden = true; notice('editor-notice');
  for (const key of ['title', 'template', 'theme', 'difficulty', 'shots']) $(`game-${key}`).value = state.draft[key];
  if (record) $('saved-play').href = `game-player.html?id=${encodeURIComponent(record.id)}`;
  renderActors(); updateTemplate(); showEditor();
}
function updateTemplate() {
  const puzzle = state.draft.template === 'puzzle';
  $('shots-label').hidden = puzzle;
  $('template-help').textContent = puzzle ? 'Swap neighboring blocks and make matches in Puzzle Battle. Choose any one of your rivals before each match. This is not an automatic campaign.' : 'Fly sideways, dodge your characters, and send bubbles or stars across the sky. Every character you add can appear in your adventure.';
  $('enemy-help').textContent = puzzle ? 'Add one or more rivals. You will choose who to play against when the game opens. Flyer movement choices are kept if you switch back.' : 'Add at least one character. Give each a name, picture, movement style, and speed.';
  document.querySelectorAll('.flyer-options').forEach((el) => { el.hidden = puzzle; });
}
function renderActors() {
  $('player-slot').replaceChildren(actorCard(state.draft.player, null));
  $('enemies-slot').replaceChildren(...state.draft.enemies.map((a, i) => actorCard(a, i)));
  updateTemplate();
}
function actorCard(a, index) {
  const card = node('div', undefined, 'actor-card');
  const art = node('div', undefined, 'actor-art');
  if (a.asset_id) { const img = node('img'); img.src = imageURL(a.asset_id); img.alt = a.name || 'Your character'; img.addEventListener('error', () => art.replaceChildren(node('span', 'Picture could not load. Try re-cropping or choosing it again.'))); art.append(img); }
  else art.textContent = index === null ? 'Your hero goes here' : 'Your character goes here';
  const label = node('label', index === null ? 'Hero name' : `Character ${index + 1} name`);
  const input = node('input'); input.type = 'text'; input.maxLength = 60; input.required = true; input.value = a.name; input.autocomplete = 'off'; input.addEventListener('input', () => { a.name = input.value; changed(); }); label.append(input);
  const actions = node('div', undefined, 'actions');
  for (const camera of [true, false]) {
    const file = node('input'); file.type = 'file'; file.accept = 'image/*'; file.hidden = true; if (camera) file.setAttribute('capture', 'environment');
    file.addEventListener('change', () => { const selected = file.files[0]; file.value = ''; if (selected) run('editor-notice', () => uploadOriginal(a, selected)); });
    actions.append(button(camera ? 'Take a photo' : 'Choose a picture', () => file.click()), file);
  }
  if (a.asset_id) actions.append(button('Re-crop original', () => run('editor-notice', async () => { const meta = await request(`/assets/${encodeURIComponent(a.asset_id)}`); await openCrop(a, meta.original_id); })));
  card.append(art, label, actions);
  if (index !== null) {
    const opts = node('div', undefined, 'settings-grid flyer-options');
    for (const [key, title, values] of [['behavior', 'Movement', [['straight', 'Straight ahead'], ['weave', 'Wiggly weave'], ['chase', 'Follow the hero']]], ['speed', 'Speed', [['slow', 'Slow'], ['normal', 'Normal'], ['fast', 'Fast']]]]) {
      const l = node('label', title); const select = node('select');
      for (const [value, text] of values) { const option = node('option', text); option.value = value; select.append(option); }
      select.value = a[key]; select.addEventListener('change', () => { a[key] = select.value; changed(); }); l.append(select); opts.append(l);
    }
    const remove = button('Remove character', () => { if ((a.name || a.asset_id) && !window.confirm('Remove this character from the draft? The original picture will still be kept.')) return; state.draft.enemies.splice(index, 1); renderActors(); changed(); });
    remove.className = 'remove-actor'; remove.disabled = state.draft.enemies.length === 1;
    card.append(opts, remove);
  }
  return card;
}
async function loadLibrary() {
  const games = await request('/games');
  $('library-grid').replaceChildren();
  notice('library-notice', games.length ? '' : 'Your shelf is ready. Create your first game to fill it with your own characters!');
  for (const game of games) {
    const card = node('article', undefined, 'game-card'); const thumb = node('div', undefined, 'game-thumb');
    for (const a of [game.player, game.enemies[0]]) { if (!a) continue; const img = node('img'); img.src = imageURL(a.asset_id); img.alt = a.name; img.loading = 'lazy'; thumb.append(img); }
    const play = node('a', 'Play', 'button'); play.href = `game-player.html?id=${encodeURIComponent(game.id)}`;
    const actions = node('div', undefined, 'actions');
    actions.append(play, button('Edit', () => { if (state.busy || !mayReplace()) return; run('library-notice', async () => openDraft(await request(`/games/${encodeURIComponent(game.id)}`))); }), button('Duplicate', () => { if (state.busy || !mayReplace()) return; run('library-notice', async () => { const copy = await request(`/games/${encodeURIComponent(game.id)}/duplicate`, { method: 'POST' }); state.libraryLoaded = false; openDraft(copy); }); }));
    card.append(thumb, node('h2', game.title), node('p', `${game.template === 'puzzle' ? 'Puzzle Battle' : 'Sideways Flyer'} · ${game.theme} · ${game.difficulty}`, 'muted'), actions); $('library-grid').append(card);
  }
  state.libraryLoaded = true;
}
function validatedRecipe() {
  if (!$('editor-form').reportValidity()) return null;
  const r = recipeOf(state.draft); r.title = r.title.trim(); r.player.name = r.player.name.trim(); r.enemies.forEach((a) => { a.name = a.name.trim(); });
  if (!r.title || !r.player.name || r.enemies.some((a) => !a.name)) { notice('editor-notice', 'Give your game and every character a name.'); return null; }
  if (!r.player.asset_id || r.enemies.some((a) => !a.asset_id)) { notice('editor-notice', 'Add a picture for your hero and every other character before saving or previewing.'); return null; }
  return r;
}
async function save(asNew = false) {
  if (state.busy) return;
  const recipe = validatedRecipe(); if (!recipe) return;
  await run('editor-notice', async () => {
    const update = state.record && !asNew;
    try {
      const saved = await request(update ? `/games/${encodeURIComponent(state.record.id)}` : '/games', { method: update ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(update ? { ...recipe, revision: state.record.revision } : recipe) });
      openDraft(saved); notice('editor-notice', 'Saved! Your game is ready in your library.'); state.libraryLoaded = false;
    } catch (error) { if (error.status === 409) { $('conflict-panel').hidden = false; throw new Error('Someone saved a newer version of this game. Nothing was overwritten. Choose an option below.'); } throw error; }
  });
}
async function uploadOriginal(a, file) {
  notice('editor-notice', 'Uploading your original picture…');
  const form = new FormData(); form.append('image', file);
  const meta = await request('/assets', { method: 'POST', body: form });
  await openCrop(a, meta.original_id); notice('editor-notice');
}
async function openCrop(a, originalId) {
  const img = new Image(); img.src = imageURL(originalId); await img.decode();
  state.crop = { actor: a, originalId, img, x: 0, y: 0, width: img.naturalWidth, height: img.naturalHeight, pointer: null };
  const scale = Math.min(1, 1000 / img.naturalWidth, 800 / img.naturalHeight);
  $('crop-canvas').width = Math.max(1, Math.round(img.naturalWidth * scale)); $('crop-canvas').height = Math.max(1, Math.round(img.naturalHeight * scale));
  $('remove-white').checked = false; notice('crop-notice'); drawCrop(); $('crop-dialog').showModal();
}
function cropCanvas(maxSize) {
  const c = state.crop; const canvas = document.createElement('canvas'); const scale = Math.min(1, maxSize / Math.max(c.width, c.height));
  canvas.width = Math.max(1, Math.round(c.width * scale)); canvas.height = Math.max(1, Math.round(c.height * scale));
  const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(c.img, c.x, c.y, c.width, c.height, 0, 0, canvas.width, canvas.height);
  if ($('remove-white').checked) {
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height); const d = pixels.data;
    for (let i = 0; i < d.length; i += 4) { const low = Math.min(d[i], d[i + 1], d[i + 2]); const high = Math.max(d[i], d[i + 1], d[i + 2]); if (low >= 225 && high - low < 25) d[i + 3] = Math.round(d[i + 3] * Math.max(0, (245 - low) / 20)); }
    ctx.putImageData(pixels, 0, 0);
  }
  return canvas;
}
function drawCrop() {
  const c = state.crop; if (!c) return;
  for (const key of ['x', 'y', 'width', 'height']) $(`crop-${key}`).value = c[key];
  $('crop-x').max = c.img.naturalWidth - 1; $('crop-y').max = c.img.naturalHeight - 1; $('crop-width').max = c.img.naturalWidth - c.x; $('crop-height').max = c.img.naturalHeight - c.y;
  const canvas = $('crop-canvas'); const ctx = canvas.getContext('2d'); const sx = canvas.width / c.img.naturalWidth; const sy = canvas.height / c.img.naturalHeight;
  ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(c.img, 0, 0, canvas.width, canvas.height); ctx.fillStyle = '#101a4899'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(c.img, c.x, c.y, c.width, c.height, c.x * sx, c.y * sy, c.width * sx, c.height * sy); ctx.strokeStyle = '#ffd65b'; ctx.lineWidth = 3; ctx.strokeRect(c.x * sx, c.y * sy, c.width * sx, c.height * sy);
  const preview = cropCanvas(200); const target = $('crop-preview'); target.width = preview.width; target.height = preview.height; target.getContext('2d').drawImage(preview, 0, 0);
}
function cropPoint(event) { const bounds = $('crop-canvas').getBoundingClientRect(); const c = state.crop; return { x: Math.max(0, Math.min(c.img.naturalWidth - 1, Math.round((event.clientX - bounds.left) / bounds.width * c.img.naturalWidth))), y: Math.max(0, Math.min(c.img.naturalHeight - 1, Math.round((event.clientY - bounds.top) / bounds.height * c.img.naturalHeight))) }; }
$('crop-canvas').addEventListener('pointerdown', (event) => { if (state.busy || !state.crop) return; event.preventDefault(); const c = state.crop; c.pointer = { ...cropPoint(event), id: event.pointerId }; $('crop-canvas').setPointerCapture(event.pointerId); });
$('crop-canvas').addEventListener('pointermove', (event) => { const c = state.crop; if (!c?.pointer || c.pointer.id !== event.pointerId || state.busy) return; const p = cropPoint(event); c.x = Math.min(p.x, c.pointer.x); c.y = Math.min(p.y, c.pointer.y); c.width = Math.abs(p.x - c.pointer.x) + 1; c.height = Math.abs(p.y - c.pointer.y) + 1; drawCrop(); });
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) $('crop-canvas').addEventListener(type, () => { if (state.crop) state.crop.pointer = null; });
for (const key of ['x', 'y', 'width', 'height']) $(`crop-${key}`).addEventListener('change', () => {
  const c = state.crop; const value = Number($(`crop-${key}`).value); if (!Number.isFinite(value)) return drawCrop(); c[key] = Math.round(value);
  c.x = Math.max(0, Math.min(c.img.naturalWidth - 1, c.x)); c.y = Math.max(0, Math.min(c.img.naturalHeight - 1, c.y)); c.width = Math.max(1, Math.min(c.img.naturalWidth - c.x, c.width)); c.height = Math.max(1, Math.min(c.img.naturalHeight - c.y, c.height)); drawCrop();
});
$('crop-reset').addEventListener('click', () => { Object.assign(state.crop, { x: 0, y: 0, width: state.crop.img.naturalWidth, height: state.crop.img.naturalHeight }); $('remove-white').checked = false; drawCrop(); });
$('remove-white').addEventListener('change', drawCrop);
function closeCrop() { if (state.busy) return; $('crop-dialog').close(); state.crop = null; }
$('crop-cancel').addEventListener('click', closeCrop);
$('crop-dialog').addEventListener('cancel', (event) => { event.preventDefault(); closeCrop(); });
$('crop-use').addEventListener('click', () => run('crop-notice', async () => {
  notice('crop-notice', 'Saving your character picture…'); const c = state.crop; const canvas = cropCanvas(2048);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png')); if (!blob) throw new Error('This browser could not prepare the picture.');
  const form = new FormData(); form.append('image', blob, 'character.png'); form.append('original_id', c.originalId);
  const meta = await request('/assets', { method: 'POST', body: form }); c.actor.asset_id = meta.id; state.crop = null; $('crop-dialog').close(); renderActors(); changed();
}));
$('new-game').addEventListener('click', () => { if (!state.busy && mayReplace()) openDraft(); });
$('resume-game').addEventListener('click', showEditor);
$('refresh-library').addEventListener('click', () => run('library-notice', loadLibrary));
$('back-library').addEventListener('click', () => { if (state.busy) return; $('editor-view').hidden = true; $('library-view').hidden = false; $('resume-game').hidden = false; if (!state.libraryLoaded) run('library-notice', loadLibrary); });
for (const key of ['title', 'template', 'theme', 'difficulty', 'shots']) $(`game-${key}`).addEventListener(key === 'title' ? 'input' : 'change', () => { state.draft[key] = $(`game-${key}`).value; if (key === 'template') updateTemplate(); changed(); });
$('add-enemy').addEventListener('click', () => { state.draft.enemies.push(actor()); renderActors(); changed(); const inputs = $('enemies-slot').querySelectorAll('input[type=text]'); inputs[inputs.length - 1].focus(); });
$('editor-form').addEventListener('submit', (event) => { event.preventDefault(); save(); });
$('save-copy').addEventListener('click', () => save(true));
$('load-latest').addEventListener('click', () => { if (state.busy || !mayReplace()) return; run('editor-notice', async () => openDraft(await request(`/games/${encodeURIComponent(state.record.id)}`))); });
$('preview-game').addEventListener('click', () => {
  if (state.busy) return; const recipe = validatedRecipe(); if (!recipe) return;
  const iframe = node('iframe'); iframe.title = 'Preview your game'; iframe.src = 'game-player.html?preview=1'; state.preview = { iframe, recipe }; $('preview-frame').replaceChildren(iframe); $('preview-dialog').showModal();
});
window.addEventListener('message', (event) => { const p = state.preview; if (!p || event.origin !== location.origin || event.source !== p.iframe.contentWindow || event.data?.type !== 'game-creator-ready') return; p.iframe.contentWindow.postMessage({ type: 'game-creator-preview', recipe: p.recipe }, location.origin); });
function closePreview() { $('preview-dialog').close(); $('preview-frame').replaceChildren(); state.preview = null; }
$('close-preview').addEventListener('click', closePreview);
$('preview-dialog').addEventListener('cancel', (event) => { event.preventDefault(); closePreview(); });
window.addEventListener('beforeunload', (event) => { if (dirty() || state.crop || state.busy) { event.preventDefault(); event.returnValue = ''; } });
document.addEventListener('click', (event) => { const link = event.target.closest('a[href]'); if (link && (dirty() || state.crop || state.busy) && !window.confirm('Leave the workshop? Unsaved changes will be lost. Choose Cancel to save your draft first.')) event.preventDefault(); });
loadShell('Game Creator');
run('library-notice', loadLibrary);
