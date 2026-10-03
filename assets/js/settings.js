/* باينباغ — applies the editable site settings (public.site_settings, edited in /admin)
   to the store pages: the WhatsApp number on every WhatsApp button, the home-page
   texts, and the map image and link in the side menu.
   The HTML already holds the current values; they stay as they are if the settings
   cannot be loaded, or if a setting is empty. Uses only the public key. */
(function () {
  'use strict';

  var config = window.BAINBAG_SUPABASE || {};
  var TIMEOUT_MS = 6000;
  var FIELDS = 'whatsapp_number,hero_title,hero_line_1,hero_line_2,map_url,map_image_path';

  function fetchSettings() {
    if (!config.url || !config.publishableKey) return Promise.reject(new Error('Supabase is not configured'));
    var controller = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (controller) controller.abort(); }, TIMEOUT_MS);
    return fetch(config.url + '/rest/v1/site_settings?select=' + FIELDS + '&id=eq.true', {
      headers: { apikey: config.publishableKey, Accept: 'application/json' },
      signal: controller ? controller.signal : undefined
    }).then(function (response) {
      if (!response.ok) throw new Error('Supabase answered HTTP ' + response.status);
      return response.json();
    }).then(function (rows) {
      return rows[0] || null;
    }).finally(function () {
      clearTimeout(timer);
    });
  }

  function setText(element, value) {
    if (element && typeof value === 'string' && value.trim()) element.textContent = value.trim();
  }

  function applyWhatsApp(number) {
    if (!/^[0-9]{8,15}$/.test(number || '')) return;
    var links = document.querySelectorAll('a.contact');
    for (var i = 0; i < links.length; i++) links[i].href = 'https://wa.me/' + number;
  }

  function applyHero(settings) {
    var lines = document.querySelectorAll('.hero-sub');
    setText(document.querySelector('.hero-title'), settings.hero_title);
    setText(lines[0], settings.hero_line_1);
    setText(lines[1], settings.hero_line_2);
  }

  // Resolves once the new map image has loaded (or failed and been put back).
  function applyMap(settings) {
    var figure = document.querySelector('.menu-map');
    var img = figure && figure.querySelector('img');
    if (!img) return null;

    if (/^https:\/\/\S+$/.test(settings.map_url || '') && !figure.querySelector('a')) {
      var link = document.createElement('a');
      link.href = settings.map_url;
      link.target = '_blank';
      link.rel = 'noopener';
      link.setAttribute('aria-label', 'افتح موقع المتجر على الخريطة');
      figure.insertBefore(link, img);
      link.appendChild(img);
    }

    if (!settings.map_image_path) return null;
    var original = img.getAttribute('src');
    return new Promise(function (resolve) {
      img.addEventListener('load', resolve, { once: true });
      img.addEventListener('error', function () {
        img.src = original; // keep the built-in map if the new one cannot load
        resolve();
      }, { once: true });
      img.src = config.url + '/storage/v1/object/public/site-images/'
        + settings.map_image_path.split('/').map(encodeURIComponent).join('/');
    });
  }

  var ready = fetchSettings().then(function (settings) {
    if (!settings) return null;
    applyWhatsApp(settings.whatsapp_number);
    applyHero(settings);
    return applyMap(settings);
  }).catch(function (error) {
    console.warn('Site settings unavailable, keeping the built-in values:', error);
  });

  // Keep the loading screen up until the settings are applied (no visible text swap).
  if (window.bainbagWaitFor) window.bainbagWaitFor(ready);
})();
