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
      min-width: 44px; min-height: 44px; margin: -10px -12px -10px 8px;
    }
    .dogform-close:hover { color: #b3241c; }
    .dogform-close:focus-visible { outline: 3px solid #b3241c; outline-offset: 2px; }
    .dogform-modal iframe { flex: 1; width: 100%; border: none; }
  `;
  document.head.appendChild(style);

  // The two edge stops on either side of the dialog catch Tab and Shift+Tab as focus
  // leaves it. Key presses inside the cross-origin Google Form never reach this page,
  // so a keydown trap alone would let focus escape behind the overlay.
  const overlay = document.createElement('div');
  overlay.className = 'dogform-overlay';
  overlay.innerHTML = `
    <span class="dogform-edge" tabindex="0"></span>
    <div class="dogform-modal" role="dialog" aria-modal="true" aria-labelledby="dogform-title">
      <div class="dogform-header">
        <span id="dogform-title">Report a Dog Water Bowl or Treat Spot</span>
        <button type="button" class="dogform-close" aria-label="Close">&times;</button>
      </div>
      <iframe src="about:blank" title="Report a spot form"></iframe>
    </div>
    <span class="dogform-edge" tabindex="0"></span>
  `;
  document.body.appendChild(overlay);

  const iframe = overlay.querySelector('iframe');
  const closeBtn = overlay.querySelector('.dogform-close');
  const edges = overlay.querySelectorAll('.dogform-edge');
  let opener = null;
  let inerted = [];
  let pageOverflow = '';

  function isOpen() { return overlay.classList.contains('open'); }

  window.openDogFormModal = function(e) {
    if (e) e.preventDefault();
    if (isOpen()) return;
    opener = document.activeElement;
    iframe.src = FORM_EMBED_URL;
    overlay.classList.add('open');
    // the page behind can't be reached or scrolled while the dialog is open
    inerted = Array.prototype.filter.call(document.body.children, function(el) {
      return el !== overlay && !el.inert && el.tagName !== 'SCRIPT';
    });
    inerted.forEach(function(el) { el.inert = true; });
    pageOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    closeBtn.focus();
  };

  function closeModal() {
    if (!isOpen()) return;
    overlay.classList.remove('open');
    iframe.src = 'about:blank';
    inerted.forEach(function(el) { el.inert = false; });
    inerted = [];
    document.documentElement.style.overflow = pageOverflow;
    if (opener && document.contains(opener)) opener.focus();
    opener = null;
  }

  // leaving past the form wraps to Close; leaving back before Close wraps into the form
  edges[1].addEventListener('focus', function() { closeBtn.focus(); });
  edges[0].addEventListener('focus', function() { iframe.focus(); });

  closeBtn.addEventListener('click', closeModal);
  overlay.addEventListener('click', function(e) {
    if (e.target === overlay) closeModal();
  });
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') closeModal();
  });
})();
