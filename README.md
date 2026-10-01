# باينباغ

موقع متجر باينباغ — محوَّل من تصميم فيجما إلى HTML/CSS ثابت ومتجاوب (هاتف، آيباد، ديسكتوب).

## النشر على Netlify

1. في Netlify: **Add new site → Import an existing project → GitHub** واختر هذا المستودع.
2. الإعدادات تُقرأ تلقائياً من `netlify.toml` (لا يوجد أمر بناء، ومجلد النشر هو `site`).
3. اضغط **Deploy**.

## رقم الواتساب

ضع الرقم بالصيغة الدولية (بدون + أو أصفار) في أول ملف `site/assets/js/main.js`:

```js
var WHATSAPP_NUMBER = '9647701234567';
```

## هيكل الملفات

```
site/
  index.html             الصفحة الرئيسية
  ties-5cm.html          ربطة عنق 5 سنتميتر
  ties-7cm.html          ربطة عنق 7 سنتميتر
  ties-9cm.html          ربطة عنق 9 سنتميتر
  other-products.html    منتجات اخرى
  bow-ties.html          بابيون
  suspenders.html        شيال بنطرون
  pajamas.html           بجامة نوم
  menu.html              القائمة الجانبية
  assets/css|js|icons|img
```
