/* One Share button for a story page.

   <button data-share-url="…" data-share-title="…" aria-controls="share-status" hidden>

   Where the browser can share (most phones, Safari, Edge), the button opens the
   device's own share sheet. Elsewhere it copies the story link and says so. If
   copying is not possible, the link is shown ready to select. Closing the share
   sheet is not an error: nothing is copied and nothing is announced. Nothing is
   ever posted automatically. Without JavaScript the button stays hidden. */
(function () {
  var button = document.querySelector('button[data-share-url]');
  if (!button) return;
  var url = button.getAttribute('data-share-url');
  var title = button.getAttribute('data-share-title') || document.title;
  var status = document.getElementById(button.getAttribute('aria-controls'));
  var manual = document.getElementById('share-manual');

  function say(text) {
    if (status) status.textContent = text;
  }

  function showLink() {
    say('Copy this link:');
    if (!manual) return;
    var field = manual.querySelector('input');
    field.value = url;
    manual.hidden = false;
    field.focus();
    field.select();
  }

  function copyLink() {
    if (!navigator.clipboard || !navigator.clipboard.writeText) {
      showLink();
      return;
    }
    navigator.clipboard.writeText(url).then(function () {
      if (manual) manual.hidden = true;
      say('Story link copied.');
    }, showLink);
  }

  button.addEventListener('click', function () {
    say('');
    if (navigator.share) {
      // called straight from the click, while the browser still counts it as the reader's action
      navigator.share({ title: title, url: url }).catch(function (error) {
        if (error && error.name === 'AbortError') return;   // the reader closed the share sheet
        showLink();
      });
    } else {
      copyLink();
    }
  });

  button.hidden = false;
})();
