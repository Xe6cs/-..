/* باينباغ — shows a section's products from Supabase.
   The grid names its section in data-category; products come from the "products" table
   in sort_order, photos from the public "site-images" bucket. Only the public
   (publishable) key is used, from assets/js/supabase-config.js, which Netlify
   generates at deploy time. If anything fails, a clear message replaces the grid. */
(function () {
  'use strict';

  var grid = document.querySelector('.grid[data-category]');
  if (!grid) return;

  var config = window.BAINBAG_SUPABASE || {};
  var slug = grid.getAttribute('data-category');
  var TIMEOUT_MS = 15000;

  function photoUrl(path) {
    return config.url + '/storage/v1/object/public/site-images/'
      + path.split('/').map(encodeURIComponent).join('/');
  }

  // One request: the section (its description) with its visible products in order.
  function fetchSection() {
    var controller = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (controller) controller.abort(); }, TIMEOUT_MS);
    var query = 'categories?select=description,products(image_path,alt_text,sort_order)'
      + '&slug=eq.' + encodeURIComponent(slug)
      + '&products.order=sort_order.asc&limit=1';
    return fetch(config.url + '/rest/v1/' + query, {
      headers: { apikey: config.publishableKey, Accept: 'application/json' },
      signal: controller ? controller.signal : undefined
    }).then(function (response) {
      if (!response.ok) throw new Error('Supabase answered HTTP ' + response.status);
      return response.json();
    }).finally(function () {
      clearTimeout(timer);
    });
  }

  function productTile(product) {
    var figure = document.createElement('figure');
    figure.className = 'tile';
    var img = document.createElement('img');
    img.src = photoUrl(product.image_path);
    img.width = 600;
    img.height = 658;
    img.decoding = 'async';
    img.alt = product.alt_text || '';
    figure.appendChild(img);
    return figure;
  }

  function textTile(text) {
    var article = document.createElement('article');
    article.className = 'tile tile--text';
    var p = document.createElement('p');
    p.textContent = text;
    article.appendChild(p);
    return article;
  }

  function render(products, description) {
    var tiles = products.map(productTile);
    // The section text (e.g. pajamas) sits third in the grid, as in the design.
    if (description) tiles.splice(Math.min(2, tiles.length), 0, textTile(description));
    // Design: on phones an odd last tile sits in the left column.
    if (tiles.length % 2 === 1) tiles[tiles.length - 1].classList.add('at-left');
    grid.replaceChildren.apply(grid, tiles);
  }

  function imagesSettled() {
    var imgs = Array.prototype.slice.call(grid.querySelectorAll('img'));
    return Promise.all(imgs.map(function (img) {
      if (img.complete) return null;
      return new Promise(function (resolve) {
        img.addEventListener('load', resolve, { once: true });
        img.addEventListener('error', resolve, { once: true });
      });
    }));
  }

  function showMessage(title, detail, canRetry) {
    var box = document.createElement('div');
    box.className = 'grid-message';
    box.setAttribute('role', 'status');
    var heading = document.createElement('p');
    heading.className = 'grid-message-title';
    heading.textContent = title;
    box.appendChild(heading);
    if (detail) {
      var text = document.createElement('p');
      text.textContent = detail;
      box.appendChild(text);
    }
    if (canRetry) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'tab grid-message-retry';
      button.textContent = 'إعادة المحاولة';
      button.addEventListener('click', function () {
        button.disabled = true;
        button.textContent = 'جارٍ التحميل…';
        load();
      });
      box.appendChild(button);
    }
    grid.replaceChildren(box);
  }

  function load() {
    if (!config.url || !config.publishableKey) {
      console.warn('Supabase is not configured: assets/js/supabase-config.js is missing or empty.');
      showMessage('المنتجات غير متاحة حالياً', 'نعمل على حل المشكلة، يرجى المحاولة لاحقاً.', false);
      return Promise.resolve();
    }
    return fetchSection().then(function (rows) {
      var section = rows[0];
      var products = section && section.products ? section.products : [];
      if (!products.length) {
        showMessage('لا توجد منتجات في هذا القسم حالياً', '', false);
        return null;
      }
      render(products, section.description);
      return imagesSettled();
    }).catch(function (error) {
      console.warn('Could not load products from Supabase:', error);
      showMessage('تعذّر تحميل المنتجات', 'تأكد من اتصالك بالإنترنت ثم حاول مرة أخرى.', true);
    });
  }

  var ready = load();
  if (window.bainbagWaitFor) window.bainbagWaitFor(ready);
})();
