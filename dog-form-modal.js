(function() {
  const FORM_EMBED_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSdb83b9c0-P9R5L3_f0oFALI6RPREu27ItEID5SPLdZYBouaA/viewform?embedded=true';

  const style = document.createElement('style');
  style.textContent = `
    .dogform-overlay {
      display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(17,17,17,0.75); z-index: 1000; align-items: center; justify-content: center;
    }
    .dogform-overlay.open { display: flex; }
    .dogform-modal {
      background: #fdfcf3; width: 92%; max-width: 640px; height: 85vh; max-height: 780px;
      border: 3px solid #111; position: relative; display: flex; flex-direction: column;
    }
    .dogform-header {
      display: flex; justify-content: space-between; align-items: center;
      padding: 12px 16px; border-bottom: 2px solid #111; font-family: Arial, sans-serif;
      font-weight: bold; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px;
    }
    .dogform-close {
      background: none; border: none; font-size: 22px; cursor: pointer; line-height: 1;
      color: #111; font-family: Arial, sans-serif; padding: 0 4px;
    }
    .dogform-close:hover { color: #b3241c; }
    .dogform-modal iframe { flex: 1; width: 100%; border: none; }
  `;
  document.head.appendChild(style);

  const overlay = document.createElement('div');
  overlay.className = 'dogform-overlay';
  overlay.innerHTML = `
    <div class="dogform-modal">
      <div class="dogform-header">
        <span>Report a Dog Water Bowl or Treat Spot</span>
        <button class="dogform-close" aria-label="Close">&times;</button>
      </div>
      <iframe src="about:blank" title="Report a spot form"></iframe>
    </div>
  `;
  document.body.appendChild(overlay);

  const iframe = overlay.querySelector('iframe');
  const closeBtn = overlay.querySelector('.dogform-close');

  window.openDogFormModal = function(e) {
    if (e) e.preventDefault();
    iframe.src = FORM_EMBED_URL;
    overlay.classList.add('open');
  };

  function closeModal() {
    overlay.classList.remove('open');
    iframe.src = 'about:blank';
  }

  closeBtn.addEventListener('click', closeModal);
  overlay.addEventListener('click', function(e) {
    if (e.target === overlay) closeModal();
  });
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') closeModal();
  });
})();