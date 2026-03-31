/** Safely normalize a URL string to http/https only. Returns '' if invalid. */
export function normalizeUrl(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  try {
    const u = new URL(s.match(/^https?:\/\//i) ? s : `https://${s}`);
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.toString();
  } catch {}
  return '';
}

/** Correct HTML escaping for text nodes. */
export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderStory(story) {
  const view = document.getElementById('storyView');
  view.innerHTML = '';

  const title = document.createElement('div');
  title.className = 'storyTitle';
  title.textContent = story?.title ?? '';

  if (story?.finalPoints) {
    const pts = document.createElement('span');
    pts.className = 'pointsBadge';
    pts.textContent = `Final: ${story.finalPoints}`;
    title.appendChild(pts);
  }

  const desc = document.createElement('div');
  desc.className = 'storyDesc';
  desc.textContent = story?.desc ?? '';

  const linkDiv = document.createElement('div');
  linkDiv.className = 'storyLink';
  const safe = normalizeUrl(story?.link ?? '');
  if (safe) {
    const a = document.createElement('a');
    a.href = safe; a.target = '_blank'; a.rel = 'noopener noreferrer';
    a.textContent = 'Open Link';
    linkDiv.appendChild(a);
  }

  view.appendChild(title);
  view.appendChild(desc);
  view.appendChild(linkDiv);
}

export function renderQueueEntry(s, state, onSetActive, onRemove) {
  const li = document.createElement('li');
  li.className = 'queueItem' + (state.activeStoryId === s.id ? ' queueActive' : '');

  const left = document.createElement('div');
  left.className = 'queueLeft';

  const titleRow = document.createElement('div');
  titleRow.className = 'queueTitleRow';

  const title = document.createElement('span');
  title.className = 'queueTitle';
  title.textContent = s.title;

  const points = document.createElement('span');
  points.className = 'queuePoints';
  points.textContent = s.finalPoints ? `Final: ${s.finalPoints}` : 'Final: —';

  titleRow.appendChild(title);
  titleRow.appendChild(points);
  left.appendChild(titleRow);

  const meta = document.createElement('div');
  meta.className = 'queueMeta';
  meta.textContent = (state.activeStoryId === s.id ? 'Active Story' : '');
  left.appendChild(meta);

  const actions = document.createElement('div');
  actions.className = 'queueActions';

  if (s.link) {
    const safe = normalizeUrl(s.link);
    if (safe) {
      const a = document.createElement('a');
      a.className = 'queueBtn queueLinkBtn';
      a.href = safe;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.title = 'Open Link';
      a.textContent = '🔗';
      actions.appendChild(a);
    }
  }

  if (state.youAreModerator) {
    const setBtn = document.createElement('button');
    setBtn.className = 'queueBtn primary';
    setBtn.type = 'button';
    setBtn.textContent = 'Set Active';
    setBtn.disabled = state.activeStoryId === s.id;
    setBtn.onclick = onSetActive;

    const rmBtn = document.createElement('button');
    rmBtn.className = 'queueBtn';
    rmBtn.type = 'button';
    rmBtn.textContent = 'Remove';
    rmBtn.onclick = onRemove;

    actions.appendChild(setBtn);
    actions.appendChild(rmBtn);
  }

  li.appendChild(left);
  li.appendChild(actions);
  return li;
}
