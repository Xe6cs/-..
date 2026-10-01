/* باينباغ — page transitions from the Figma prototype + WhatsApp link.
   Loaded (blocking) in <head> so it can catch the "pagereveal" event. */
(function () {
  'use strict';

  /* ضع رقم الواتساب هنا بالصيغة الدولية بدون + أو أصفار، مثال: '9647701234567' */
  var WHATSAPP_NUMBER = '';

  var KEY = 'bainbag-vt';
  var root = document.documentElement;

  function store(type) {
    try {
      sessionStorage.setItem(KEY, JSON.stringify({ type: type, t: Date.now() }));
    } catch (e) { /* storage disabled: navigate without the animation */ }
  }

  function take() {
    try {
      var v = JSON.parse(sessionStorage.getItem(KEY) || 'null');
      sessionStorage.removeItem(KEY);
      if (v && Date.now() - v.t < 5000) return v.type;
    } catch (e) { /* ignore */ }
    return null;
  }

  var arriving = null;
  try { arriving = sessionStorage.getItem(KEY); } catch (e) { /* ignore */ }

  // First visit / reload of the landing page plays the design's fade-in.
  if (!arriving) root.classList.add('intro');

  if ('onpagereveal' in window) {
    window.addEventListener('pagereveal', function (e) {
      var type = take();
      var vt = e.viewTransition;
      if (!vt) return;
      if (!type || matchMedia('(prefers-reduced-motion: reduce)').matches) {
        vt.skipTransition();
        return;
      }
      if (vt.types) vt.types.add(type);
    });
  } else {
    take();
  }

  function sameOriginReferrer() {
    try {
      return document.referrer && new URL(document.referrer).origin === location.origin;
    } catch (e) {
      return false;
    }
  }

  document.addEventListener('click', function (e) {
    var a = e.target.closest ? e.target.closest('a[data-vt]') : null;
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var type = a.getAttribute('data-vt');

    // Close the side menu: go back to the page it was opened from.
    if (a.hasAttribute('data-back') && history.length > 1 && sameOriginReferrer()) {
      e.preventDefault();
      store(type);
      history.back();
      return;
    }

    store(type);
    if (a.hasAttribute('data-replace')) {
      e.preventDefault();
      location.replace(a.href);
    }
  });

  document.addEventListener('DOMContentLoaded', function () {
    if (!WHATSAPP_NUMBER) return;
    var links = document.querySelectorAll('a.contact');
    for (var i = 0; i < links.length; i++) links[i].href = 'https://wa.me/' + WHATSAPP_NUMBER;
  });
})();
