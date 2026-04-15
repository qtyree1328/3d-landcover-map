// Loading state and title overlay management

export function showLoading(message = 'Loading terrain...') {
  const el = document.getElementById('loading');
  const text = document.getElementById('loading-text');
  text.textContent = message;
  el.classList.add('visible');
}

export function hideLoading() {
  document.getElementById('loading').classList.remove('visible');
}

export function updateTitle(title, subtitle) {
  if (title) document.getElementById('map-title').textContent = title;
  if (subtitle) document.getElementById('map-subtitle').textContent = subtitle;
}

export function updateSampleCounter(count, visible = true) {
  const el = document.getElementById('sample-counter');
  if (visible) {
    el.style.display = 'block';
    el.textContent = `Samples: ${count}`;
  } else {
    el.style.display = 'none';
  }
}
