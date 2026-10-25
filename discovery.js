/* Explore Stories: topic buttons and a title/hook search that narrow the story
   cards together. Everything stays on the page; nothing is sent anywhere.
   Without JavaScript every card is shown and every link works. */
(function () {
  var cards = Array.prototype.slice.call(document.querySelectorAll('.storycard'));
  var buttons = Array.prototype.slice.call(document.querySelectorAll('[data-filter]'));
  var search = document.getElementById('story-search');
  var count = document.getElementById('story-count');
  var empty = document.getElementById('empty');
  if (!cards.length || !search) return;
  var topic = 'all';

  function filter() {
    var q = search.value.trim().toLowerCase(), shown = 0;
    cards.forEach(function (card) {
      var show = (topic === 'all' || card.getAttribute('data-topic') === topic) &&
                 card.textContent.toLowerCase().indexOf(q) !== -1;
      card.hidden = !show;
      if (show) shown++;
    });
    count.textContent = shown + (shown === 1 ? ' story' : ' stories') + ' to wander into';
    empty.hidden = shown > 0;
  }

  buttons.forEach(function (button) {
    button.addEventListener('click', function () {
      topic = button.getAttribute('data-filter');
      buttons.forEach(function (b) { b.setAttribute('aria-pressed', String(b === button)); });
      filter();
    });
  });
  search.addEventListener('input', filter);
  filter();
})();
