/* باينباغ — admin panel.
   Uses only the public (publishable) key from ../assets/js/supabase-config.js.
   Everything an admin can do is decided by Supabase itself (Row Level Security):
   the panel just offers the actions, and Supabase refuses them for anyone who is
   not in public.admins. */
(function () {
  'use strict';

  var BUCKET = 'site-images';
  var MAX_UPLOAD_BYTES = 5 * 1024 * 1024;  // the bucket's file_size_limit
  var MAX_PICK_BYTES = 30 * 1024 * 1024;   // refuse huge files before trying to read them
  var KEEP_AS_IS_BYTES = 600 * 1024;       // small WebP files are uploaded unchanged
  var WEBP_QUALITY = 0.82;
  var PRODUCT_MAX = { width: 1000, height: 1200 }; // store tiles show at most ~240px wide
  var MAP_MAX = { width: 1600, height: 900 };

  var config = window.BAINBAG_SUPABASE || {};
  var sb = null;
  var state = { user: null, sections: [], groups: {}, products: [], settings: null };
  var editing = null;     // product being edited (null = new product)
  var pendingImage = null;
  var pendingMap = null;

  function $(id) { return document.getElementById(id); }

  // ---------------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------------
  var toastTimer = null;
  function toast(message, kind) {
    var el = $('toast');
    el.textContent = message;
    el.className = 'toast' + (kind ? ' is-' + kind : '');
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, kind === 'error' ? 6000 : 3000);
  }

  function setBusy(button, busy, busyLabel) {
    if (busy) {
      button.dataset.label = button.textContent;
      button.textContent = busyLabel || 'جارٍ التنفيذ…';
      button.disabled = true;
    } else {
      button.textContent = button.dataset.label || button.textContent;
      button.disabled = false;
    }
  }

  function showError(id, message) {
    var el = $(id);
    el.textContent = message || '';
    el.hidden = !message;
  }

  function errorText(error) {
    var text = (error && (error.message || error.error_description || error.msg)) || String(error || '');
    var code = error && (error.code || error.statusCode || error.status);
    if (/failed to fetch|networkerror|load failed|network/i.test(text)) return 'تعذّر الاتصال بالخادم. تأكد من الإنترنت ثم حاول مرة أخرى.';
    if (code === '42501' || code === 403 || code === '403' || /row-level security|permission denied|unauthorized/i.test(text)) return 'لا تملك صلاحية لهذا الإجراء.';
    if (code === '23514' || /check constraint/i.test(text)) return 'إحدى القيم غير صالحة.';
    if (code === '23503' || /foreign key/i.test(text)) return 'لا يمكن تنفيذ هذا لأن بيانات أخرى مرتبطة به.';
    if (/exceeded|too large|maximum allowed size/i.test(text)) return 'حجم الصورة أكبر من المسموح (5 ميغابايت).';
    if (/mime|invalid_mime_type/i.test(text)) return 'نوع الملف غير مسموح. ارفع صورة فقط.';
    return 'حدث خطأ غير متوقع: ' + text;
  }

  function kb(bytes) {
    return bytes >= 1024 * 1024 ? (bytes / 1024 / 1024).toFixed(1) + ' ميغابايت' : Math.round(bytes / 1024) + ' كيلوبايت';
  }

  function publicUrl(path) {
    return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  }

  function fileName(path) {
    return path.split('/').pop();
  }

  function newImagePath(folder, blob) {
    var ext = blob.type === 'image/webp' ? 'webp' : blob.type === 'image/png' ? 'png' : 'jpg';
    var stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
    return folder + '/' + stamp + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext;
  }

  function sectionById(id) {
    return state.sections.find(function (s) { return s.id === id; });
  }

  function sectionLabel(section) {
    var group = state.groups[section.parent_id];
    return group ? section.name + ' — ' + group.name : section.name;
  }

  function productsIn(sectionId) {
    return state.products
      .filter(function (p) { return p.category_id === sectionId; })
      .sort(function (a, b) { return a.sort_order - b.sort_order; });
  }

  function imageInUse(path, exceptId) {
    return state.products.some(function (p) { return p.image_path === path && p.id !== exceptId; });
  }

  // Opens a <dialog> and resolves with the value of the button that closed it.
  function ask(dialog) {
    return new Promise(function (resolve) {
      dialog.returnValue = '';
      dialog.addEventListener('close', function () { resolve(dialog.returnValue); }, { once: true });
      dialog.showModal();
    });
  }

  function confirmQuestion(title, text, yesLabel) {
    $('confirm-title').textContent = title;
    $('confirm-text').textContent = text;
    $('confirm-yes').textContent = yesLabel || 'نعم';
    return ask($('confirm-dialog')).then(function (value) { return value === 'yes'; });
  }

  // ---------------------------------------------------------------------------
  // Images: checked, shrunk and converted in the browser before uploading
  // ---------------------------------------------------------------------------
  function canvasBlob(canvas, type, quality) {
    return new Promise(function (resolve) { canvas.toBlob(resolve, type, quality); });
  }

  async function prepareImage(file, max) {
    if (!file) throw new Error('اختر صورة أولاً.');
    if (file.type && !/^image\//.test(file.type)) throw new Error('الملف المختار ليس صورة. اختر صورة JPG أو PNG أو WebP.');
    if (file.size > MAX_PICK_BYTES) throw new Error('الصورة كبيرة جداً (أكثر من 30 ميغابايت).');

    var bitmap;
    try {
      bitmap = await createImageBitmap(file);
    } catch (e) {
      throw new Error('تعذّر قراءة الملف كصورة. اختر صورة JPG أو PNG أو WebP.');
    }
    var scale = Math.min(1, max.width / bitmap.width, max.height / bitmap.height);
    var width = Math.round(bitmap.width * scale);
    var height = Math.round(bitmap.height * scale);

    if (file.type === 'image/webp' && scale === 1 && file.size <= KEEP_AS_IS_BYTES) {
      bitmap.close();
      return { blob: file, width: width, height: height, original: file.size };
    }

    var canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    var ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, width, height);
    var blob = await canvasBlob(canvas, 'image/webp', WEBP_QUALITY);
    if (!blob || blob.type !== 'image/webp') {
      // Browsers without WebP encoding (older Safari): JPEG on a white background.
      ctx.globalCompositeOperation = 'destination-over';
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      blob = await canvasBlob(canvas, 'image/jpeg', 0.85);
    }
    bitmap.close();
    if (!blob) throw new Error('تعذّر تجهيز الصورة.');
    if (blob.size > MAX_UPLOAD_BYTES) throw new Error('حتى بعد الضغط ما زالت الصورة أكبر من 5 ميغابايت.');
    return { blob: blob, width: width, height: height, original: file.size };
  }

  function previewInto(container, src, alt) {
    container.replaceChildren();
    var img = document.createElement('img');
    img.src = src;
    img.alt = alt || '';
    container.appendChild(img);
  }

  async function upload(path, blob) {
    var res = await sb.storage.from(BUCKET).upload(path, blob, {
      contentType: blob.type, cacheControl: '31536000', upsert: false
    });
    if (res.error) throw res.error;
  }

  async function removeImage(path) {
    var res = await sb.storage.from(BUCKET).remove([path]);
    if (res.error) throw res.error;
    if (!res.data || !res.data.length) throw new Error('permission denied');
  }

  // ---------------------------------------------------------------------------
  // Sign in / out
  // ---------------------------------------------------------------------------
  function showLogin(message) {
    $('boot').hidden = true;
    $('app').hidden = true;
    $('login').hidden = false;
    showError('login-error', message);
  }

  async function enter(user) {
    // RLS shows a signed-in user only their own row in public.admins.
    var res = await sb.from('admins').select('user_id').eq('user_id', user.id);
    if (res.error || !res.data || res.data.length !== 1) {
      await sb.auth.signOut();
      showLogin(res.error ? errorText(res.error) : 'هذا الحساب لا يملك صلاحية إدارة الموقع.');
      return;
    }
    state.user = user;
    $('admin-email').textContent = user.email || '';
    $('boot').hidden = true;
    $('login').hidden = true;
    $('app').hidden = false;
    await loadEverything();
  }

  async function onLogin(event) {
    event.preventDefault();
    var form = event.target;
    var email = form.email.value.trim();
    var password = form.password.value;
    if (!email || !password) {
      showError('login-error', 'اكتب البريد الإلكتروني وكلمة المرور.');
      return;
    }
    var button = $('login-button');
    setBusy(button, true, 'جارٍ تسجيل الدخول…');
    showError('login-error', '');
    var res = await sb.auth.signInWithPassword({ email: email, password: password });
    setBusy(button, false);
    form.password.value = '';
    if (res.error) {
      var status = res.error.status;
      showError('login-error',
        status === 429 ? 'محاولات كثيرة. انتظر قليلاً ثم حاول مرة أخرى.'
          : /fetch|network/i.test(res.error.message || '') ? errorText(res.error)
            : 'البريد الإلكتروني أو كلمة المرور غير صحيحة.');
      return;
    }
    form.reset();
    await enter(res.data.user);
  }

  async function onLogout() {
    state.user = null;
    await sb.auth.signOut();
    state.products = [];
    $('product-list').replaceChildren();
    showLogin('');
    toast('تم تسجيل الخروج.', 'ok');
  }

  // ---------------------------------------------------------------------------
  // Data
  // ---------------------------------------------------------------------------
  async function loadEverything() {
    try {
      var results = await Promise.all([
        sb.from('categories').select('id,slug,name,parent_id,sort_order').order('sort_order'),
        sb.from('products').select('id,category_id,image_path,alt_text,sort_order,is_visible').order('sort_order'),
        sb.from('site_settings').select('whatsapp_number,hero_title,hero_line_1,hero_line_2,map_url,map_image_path').eq('id', true)
      ]);
      results.forEach(function (r) { if (r.error) throw r.error; });
      var categories = results[0].data;
      state.groups = {};
      categories.forEach(function (c) { if (!c.parent_id) state.groups[c.id] = c; });
      // Product sections, grouped like the store: ties first, then other products.
      state.sections = categories.filter(function (c) { return c.parent_id; }).sort(function (a, b) {
        var ga = state.groups[a.parent_id], gb = state.groups[b.parent_id];
        return ((ga ? ga.sort_order : 0) - (gb ? gb.sort_order : 0)) || (a.sort_order - b.sort_order);
      });
      state.products = results[1].data;
      state.settings = results[2].data[0] || null;
      renderFilter();
      renderProducts();
      fillSettings();
    } catch (error) {
      toast(errorText(error), 'error');
    }
  }

  // Gives the listed products positions 1..n, saving only the ones that changed.
  async function applyOrder(list) {
    for (var i = 0; i < list.length; i++) {
      var product = list[i];
      if (product.sort_order === i + 1) continue;
      var res = await sb.from('products').update({ sort_order: i + 1 }).eq('id', product.id).select('id');
      if (res.error) throw res.error;
      if (!res.data.length) throw new Error('permission denied');
      product.sort_order = i + 1;
    }
  }

  async function placeAt(product, position) {
    var others = productsIn(product.category_id).filter(function (p) { return p.id !== product.id; });
    var index = Math.max(0, Math.min(others.length, position - 1));
    others.splice(index, 0, product);
    await applyOrder(others);
  }

  // ---------------------------------------------------------------------------
  // Products list
  // ---------------------------------------------------------------------------
  function renderFilter() {
    var select = $('filter-section');
    var current = select.value;
    select.replaceChildren(new Option('كل الأقسام (' + state.products.length + ')', ''));
    state.sections.forEach(function (s) {
      select.appendChild(new Option(sectionLabel(s) + ' (' + productsIn(s.id).length + ')', s.id));
    });
    select.value = state.sections.some(function (s) { return s.id === current; }) ? current : '';
  }

  function actionButton(label, action, id, extraClass, ariaLabel) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn-ghost btn-small' + (extraClass ? ' ' + extraClass : '');
    b.textContent = label;
    b.dataset.action = action;
    b.dataset.id = id;
    if (ariaLabel) b.setAttribute('aria-label', ariaLabel);
    return b;
  }

  function renderProducts() {
    var sectionId = $('filter-section').value;
    var query = $('search').value.trim().toLowerCase();
    var order = {};
    state.sections.forEach(function (s, i) { order[s.id] = i; });

    var list = (sectionId ? productsIn(sectionId) : state.products.slice().sort(function (a, b) {
      return (order[a.category_id] - order[b.category_id]) || (a.sort_order - b.sort_order);
    })).filter(function (p) {
      if (!query) return true;
      var section = sectionById(p.category_id);
      return (p.alt_text || '').toLowerCase().indexOf(query) !== -1
        || fileName(p.image_path).toLowerCase().indexOf(query) !== -1
        || (section && sectionLabel(section).toLowerCase().indexOf(query) !== -1);
    });

    var total = state.products.length;
    $('products-summary').textContent = list.length === total
      ? total + ' منتجاً'
      : list.length + ' من أصل ' + total + ' منتجاً';
    $('order-hint').hidden = !!sectionId;

    var grid = $('product-list');
    if (!list.length) {
      var empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = query ? 'لا توجد منتجات تطابق البحث.' : 'لا توجد منتجات في هذا القسم.';
      grid.replaceChildren(empty);
      return;
    }

    var cards = list.map(function (p) {
      var section = sectionById(p.category_id);
      var card = document.createElement('article');
      card.className = 'product-card' + (p.is_visible ? '' : ' is-hidden');

      var thumb = document.createElement('div');
      thumb.className = 'product-thumb';
      var img = document.createElement('img');
      img.src = publicUrl(p.image_path);
      img.alt = p.alt_text || '';
      img.loading = 'lazy';
      img.decoding = 'async';
      thumb.appendChild(img);
      var position = document.createElement('span');
      position.className = 'badge badge-position';
      position.textContent = '#' + p.sort_order;
      thumb.appendChild(position);
      if (!p.is_visible) {
        var hidden = document.createElement('span');
        hidden.className = 'badge badge-hidden';
        hidden.textContent = 'مخفي';
        thumb.appendChild(hidden);
      }

      var meta = document.createElement('p');
      meta.className = 'product-meta';
      meta.textContent = sectionId ? fileName(p.image_path) : (section ? sectionLabel(section) : '');

      var actions = document.createElement('div');
      actions.className = 'product-actions';
      actions.appendChild(actionButton('تعديل', 'edit', p.id));
      actions.appendChild(actionButton(p.is_visible ? 'إخفاء' : 'إظهار', 'toggle', p.id));
      if (sectionId) {
        actions.appendChild(actionButton('↑', 'up', p.id, 'btn-move', 'تقديم المنتج خطوة'));
        actions.appendChild(actionButton('↓', 'down', p.id, 'btn-move', 'تأخير المنتج خطوة'));
      }
      actions.appendChild(actionButton('حذف', 'delete', p.id, 'btn-danger-outline'));

      card.appendChild(thumb);
      card.appendChild(meta);
      card.appendChild(actions);
      return card;
    });
    grid.replaceChildren.apply(grid, cards);
  }

  async function onProductAction(event) {
    var button = event.target.closest('button[data-action]');
    if (!button) return;
    var product = state.products.find(function (p) { return p.id === button.dataset.id; });
    if (!product) return;
    var action = button.dataset.action;
    if (action === 'edit') return openEditor(product);
    if (action === 'delete') return deleteProduct(product);

    setBusy(button, true, '…');
    try {
      if (action === 'toggle') {
        var res = await sb.from('products').update({ is_visible: !product.is_visible }).eq('id', product.id).select('id,is_visible');
        if (res.error) throw res.error;
        if (!res.data.length) throw new Error('permission denied');
        product.is_visible = res.data[0].is_visible;
        toast(product.is_visible ? 'أصبح المنتج ظاهراً في المتجر.' : 'أصبح المنتج مخفياً عن المتجر.', 'ok');
      } else {
        var list = productsIn(product.category_id);
        var i = list.indexOf(product);
        var j = action === 'up' ? i - 1 : i + 1;
        if (j < 0 || j >= list.length) { setBusy(button, false); return; }
        list[i] = list[j];
        list[j] = product;
        await applyOrder(list);
      }
    } catch (error) {
      toast(errorText(error), 'error');
    }
    renderProducts();
  }

  // ---------------------------------------------------------------------------
  // Add / edit
  // ---------------------------------------------------------------------------
  function fillSectionSelect(select, selectedId) {
    select.replaceChildren();
    state.sections.forEach(function (s) { select.appendChild(new Option(sectionLabel(s), s.id)); });
    select.value = selectedId || (state.sections[0] && state.sections[0].id) || '';
  }

  function updatePositionLimit() {
    var sectionId = $('product-section').value;
    var count = productsIn(sectionId).filter(function (p) { return !editing || p.id !== editing.id; }).length;
    var input = $('product-position');
    input.max = String(count + 1);
    if (!editing || editing.category_id !== sectionId) input.value = String(count + 1);
  }

  function openEditor(product) {
    editing = product || null;
    pendingImage = null;
    var form = $('product-form');
    form.reset();
    showError('product-error', '');
    $('product-dialog-title').textContent = product ? 'تعديل المنتج' : 'إضافة منتج';
    fillSectionSelect($('product-section'), product ? product.category_id : $('filter-section').value);
    $('product-position').value = product ? String(product.sort_order) : '';
    updatePositionLimit();
    if (product) $('product-position').value = String(product.sort_order);
    $('product-alt').value = product ? (product.alt_text || '') : '';
    $('product-visible').checked = product ? product.is_visible : true;
    $('product-file-info').textContent = product
      ? 'اختر صورة جديدة فقط إذا أردت استبدال الصورة الحالية.'
      : 'الصور الكبيرة تُضغط تلقائياً قبل الرفع.';
    var preview = $('product-preview');
    if (product) previewInto(preview, publicUrl(product.image_path), product.alt_text);
    else {
      var none = document.createElement('span');
      none.className = 'muted';
      none.textContent = 'لم تُختر صورة';
      preview.replaceChildren(none);
    }
    $('product-dialog').showModal();
  }

  async function onProductFile(event) {
    var file = event.target.files[0];
    pendingImage = null;
    showError('product-error', '');
    if (!file) return;
    var info = $('product-file-info');
    info.textContent = 'جارٍ تجهيز الصورة…';
    try {
      pendingImage = await prepareImage(file, PRODUCT_MAX);
      previewInto($('product-preview'), URL.createObjectURL(pendingImage.blob), '');
      info.textContent = 'جاهزة للرفع: ' + pendingImage.width + '×' + pendingImage.height + '، '
        + kb(pendingImage.blob.size) + (pendingImage.blob !== file ? ' (كانت ' + kb(pendingImage.original) + ')' : '');
    } catch (error) {
      event.target.value = '';
      info.textContent = '';
      showError('product-error', error.message);
    }
  }

  async function onSaveProduct(event) {
    event.preventDefault();
    var section = sectionById($('product-section').value);
    var position = parseInt($('product-position').value, 10);
    var alt = $('product-alt').value.trim() || null;
    var visible = $('product-visible').checked;
    if (!section) return showError('product-error', 'اختر القسم.');
    if (!editing && !pendingImage) return showError('product-error', 'اختر صورة المنتج.');
    if (!(position >= 1)) return showError('product-error', 'اكتب رقم ترتيب صحيحاً (1 أو أكثر).');

    var button = $('product-save');
    setBusy(button, true, 'جارٍ الحفظ…');
    showError('product-error', '');
    var uploaded = null;
    try {
      if (pendingImage) {
        uploaded = newImagePath('products/' + section.slug, pendingImage.blob);
        await upload(uploaded, pendingImage.blob);
      }
      var product;
      var oldPath = editing ? editing.image_path : null;
      var oldSectionId = editing ? editing.category_id : null;
      if (!editing) {
        var inserted = await sb.from('products').insert({
          category_id: section.id, image_path: uploaded, alt_text: alt, is_visible: visible,
          sort_order: productsIn(section.id).length + 1
        }).select('id,category_id,image_path,alt_text,sort_order,is_visible');
        if (inserted.error) throw inserted.error;
        product = inserted.data[0];
        state.products.push(product);
      } else {
        var changes = { category_id: section.id, alt_text: alt, is_visible: visible };
        if (uploaded) changes.image_path = uploaded;
        if (section.id !== oldSectionId) changes.sort_order = productsIn(section.id).length + 1;
        var updated = await sb.from('products').update(changes).eq('id', editing.id)
          .select('id,category_id,image_path,alt_text,sort_order,is_visible');
        if (updated.error) throw updated.error;
        if (!updated.data.length) throw new Error('permission denied');
        product = editing;
        Object.assign(product, updated.data[0]);
      }
      uploaded = null; // the row now points at it: keep it from here on
      await placeAt(product, position);
      if (oldSectionId && oldSectionId !== product.category_id) await applyOrder(productsIn(oldSectionId));
      $('product-dialog').close();
      renderFilter();
      renderProducts();
      toast(editing ? 'تم حفظ التعديلات.' : 'تمت إضافة المنتج.', 'ok');

      if (oldPath && product.image_path !== oldPath && !imageInUse(oldPath, null)) {
        var drop = await confirmQuestion('الصورة القديمة', 'لم تعد الصورة القديمة مستخدمة. هل تريد حذفها من التخزين (Storage)؟', 'احذفها');
        if (drop) {
          try { await removeImage(oldPath); toast('تم حذف الصورة القديمة.', 'ok'); }
          catch (e) { toast(errorText(e), 'error'); }
        }
      }
    } catch (error) {
      if (uploaded) { try { await removeImage(uploaded); } catch (e) { /* best effort */ } }
      showError('product-error', errorText(error));
    } finally {
      setBusy(button, false);
    }
  }

  // ---------------------------------------------------------------------------
  // Delete
  // ---------------------------------------------------------------------------
  async function deleteProduct(product) {
    previewInto($('delete-preview'), publicUrl(product.image_path), product.alt_text);
    var choice = await ask($('delete-dialog'));
    if (choice !== 'with-image' && choice !== 'product-only') return;
    try {
      var res = await sb.from('products').delete().eq('id', product.id).select('id');
      if (res.error) throw res.error;
      if (!res.data.length) throw new Error('permission denied');
      state.products = state.products.filter(function (p) { return p.id !== product.id; });
      await applyOrder(productsIn(product.category_id));
      var message = 'تم حذف المنتج.';
      if (choice === 'with-image') {
        if (imageInUse(product.image_path, null)) {
          message += ' أُبقيت الصورة لأن منتجاً آخر يستخدمها.';
        } else {
          try { await removeImage(product.image_path); message = 'تم حذف المنتج وصورته.'; }
          catch (e) { message += ' لكن تعذّر حذف الصورة: ' + errorText(e); }
        }
      }
      toast(message, 'ok');
    } catch (error) {
      toast(errorText(error), 'error');
    }
    renderFilter();
    renderProducts();
  }

  // ---------------------------------------------------------------------------
  // Site settings
  // ---------------------------------------------------------------------------
  function fillSettings() {
    var s = state.settings;
    var form = $('settings-form');
    if (!s) return;
    form.whatsapp_number.value = s.whatsapp_number || '';
    form.hero_title.value = s.hero_title || '';
    form.hero_line_1.value = s.hero_line_1 || '';
    form.hero_line_2.value = s.hero_line_2 || '';
    form.map_url.value = s.map_url || '';
    pendingMap = null;
    $('map-file').value = '';
    $('map-file-info').textContent = '';
    var preview = $('map-preview');
    if (s.map_image_path) previewInto(preview, publicUrl(s.map_image_path), 'صورة الخريطة');
    else {
      var none = document.createElement('span');
      none.className = 'muted';
      none.textContent = 'لا توجد صورة';
      preview.replaceChildren(none);
    }
  }

  async function onMapFile(event) {
    var file = event.target.files[0];
    pendingMap = null;
    showError('settings-error', '');
    if (!file) return;
    try {
      pendingMap = await prepareImage(file, MAP_MAX);
      previewInto($('map-preview'), URL.createObjectURL(pendingMap.blob), 'صورة الخريطة');
      $('map-file-info').textContent = 'جاهزة للرفع: ' + kb(pendingMap.blob.size);
    } catch (error) {
      event.target.value = '';
      showError('settings-error', error.message);
    }
  }

  async function onSaveSettings(event) {
    event.preventDefault();
    var form = event.target;
    var whatsapp = form.whatsapp_number.value.replace(/[\s\-()]/g, '').replace(/^\+/, '').replace(/^00/, '');
    var mapUrl = form.map_url.value.trim();
    var hero = [form.hero_title.value.trim(), form.hero_line_1.value.trim(), form.hero_line_2.value.trim()];

    if (whatsapp && /^0/.test(whatsapp)) return showError('settings-error', 'الرقم يبدأ بصفر. اكتب رمز الدولة بدلاً منه، مثل 9647701234567.');
    if (whatsapp && !/^[0-9]{8,15}$/.test(whatsapp)) return showError('settings-error', 'رقم الواتساب يجب أن يكون أرقاماً فقط (من 8 إلى 15 رقماً) مع رمز الدولة.');
    if (hero.some(function (t) { return !t; })) return showError('settings-error', 'نصوص الصفحة الرئيسية لا يمكن أن تكون فارغة.');
    if (mapUrl && !/^https:\/\/\S+$/.test(mapUrl)) return showError('settings-error', 'رابط الخريطة يجب أن يبدأ بـ https://');

    var button = $('settings-save');
    setBusy(button, true, 'جارٍ الحفظ…');
    showError('settings-error', '');
    var uploaded = null;
    var oldMap = state.settings && state.settings.map_image_path;
    try {
      var changes = {
        whatsapp_number: whatsapp || null,
        hero_title: hero[0], hero_line_1: hero[1], hero_line_2: hero[2],
        map_url: mapUrl || null
      };
      if (pendingMap) {
        uploaded = newImagePath('settings', pendingMap.blob);
        await upload(uploaded, pendingMap.blob);
        changes.map_image_path = uploaded;
      }
      var res = await sb.from('site_settings').update(changes).eq('id', true)
        .select('whatsapp_number,hero_title,hero_line_1,hero_line_2,map_url,map_image_path');
      if (res.error) throw res.error;
      if (!res.data.length) throw new Error('permission denied');
      uploaded = null;
      state.settings = res.data[0];
      fillSettings();
      toast('تم حفظ الإعدادات.', 'ok');
      if (changes.map_image_path && oldMap && oldMap !== changes.map_image_path) {
        var drop = await confirmQuestion('صورة الخريطة القديمة', 'هل تريد حذف صورة الخريطة القديمة من التخزين (Storage)؟', 'احذفها');
        if (drop) {
          try { await removeImage(oldMap); } catch (e) { toast(errorText(e), 'error'); }
        }
      }
    } catch (error) {
      if (uploaded) { try { await removeImage(uploaded); } catch (e) { /* best effort */ } }
      showError('settings-error', errorText(error));
    } finally {
      setBusy(button, false);
    }
  }

  // ---------------------------------------------------------------------------
  // Start
  // ---------------------------------------------------------------------------
  function switchView(view) {
    document.querySelectorAll('.view-tab').forEach(function (tab) {
      var on = tab.dataset.view === view;
      tab.classList.toggle('is-active', on);
      if (on) tab.setAttribute('aria-current', 'page'); else tab.removeAttribute('aria-current');
    });
    $('products-view').hidden = view !== 'products';
    $('settings-view').hidden = view !== 'settings';
  }

  function wireUp() {
    $('login-form').addEventListener('submit', onLogin);
    $('logout-button').addEventListener('click', onLogout);
    document.querySelectorAll('.view-tab').forEach(function (tab) {
      tab.addEventListener('click', function () { switchView(tab.dataset.view); });
    });
    $('filter-section').addEventListener('change', renderProducts);
    $('search').addEventListener('input', renderProducts);
    $('add-product').addEventListener('click', function () { openEditor(null); });
    $('product-list').addEventListener('click', onProductAction);
    $('product-form').addEventListener('submit', onSaveProduct);
    $('product-file').addEventListener('change', onProductFile);
    $('product-section').addEventListener('change', updatePositionLimit);
    document.querySelectorAll('[data-close]').forEach(function (b) {
      b.addEventListener('click', function () { b.closest('dialog').close(); });
    });
    $('settings-form').addEventListener('submit', onSaveSettings);
    $('map-file').addEventListener('change', onMapFile);
  }

  async function start() {
    if (!config.url || !config.publishableKey || !window.supabase) {
      showLogin('لوحة التحكم غير مهيأة: إعدادات Supabase غير موجودة على هذا الموقع.');
      $('login-button').disabled = true;
      return;
    }
    sb = window.supabase.createClient(config.url, config.publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
    });
    wireUp();
    // If the session ends elsewhere (expired, signed out in another tab), lock the panel.
    sb.auth.onAuthStateChange(function (event) {
      if (event === 'SIGNED_OUT' && state.user) {
        state.user = null;
        showLogin('انتهت الجلسة. سجّل الدخول مرة أخرى.');
      }
    });
    var session = (await sb.auth.getSession()).data.session;
    if (session) await enter(session.user);
    else showLogin('');
  }

  start().catch(function (error) {
    showLogin(errorText(error));
  });
})();
