// VEYVO website: the pages hold Czech and English; the #en fragment shows English (pure CSS, see site.css).
// This script only (1) opens English for visitors whose browser does not prefer Czech or Slovak, when the
// address has no fragment yet, and (2) keeps <html lang> and the document title in sync with the language.
(function () {
  'use strict';
  var root = document.documentElement;
  function sync() {
    var en = location.hash === '#en';
    root.lang = en ? 'en' : 'cs';
    var title = root.getAttribute(en ? 'data-title-en' : 'data-title-cs');
    if (title) document.title = title;
  }
  if (!location.hash) {
    var list = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || ''];
    var first = String(list[0] || '').toLowerCase();
    if (first && !/^(cs|sk)\b/.test(first)) location.replace('#en');
  }
  sync();
  window.addEventListener('hashchange', sync);
})();
