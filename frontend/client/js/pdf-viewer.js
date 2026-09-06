/**
 * Protected PDF Viewer
 * =====================
 * فيوير PDF محمي للاستخدام في صفحات الدروس. بيعمل:
 *  - طلب رابط مؤقت موقّع من الباكند (الباكند هو اللي يتأكد من صلاحية الطالب).
 *  - تحميل الملف كـ ArrayBuffer مرة واحدة (مش عن طريق src مباشر) عشان الرابط
 *    الموقّع ميفضلش ظاهر كمصدر دائم في الصفحة.
 *  - رسم الووترمارك (اسم الطالب/رقمه/المادة/الوقت) *داخل* الـ canvas نفسه
 *    بعد رسم كل صفحة - مش كـ طبقة CSS منفصلة يسهل حذفها من DevTools.
 *  - تقييد عملي (مش ضمان كامل): تعطيل الكليك اليمين، محاولة منع اختصارات
 *    الطباعة/الحفظ، وحجب المحتوى فعليًا عند محاولة الطباعة عبر @media print.
 *
 * تنويه صريح: مفيش أي حل مبني على متصفح ويب قادر يمنع لقطة شاشة أو تصوير
 * الشاشة بكاميرا خارجية بشكل مطلق. الووترمارك موجود عشان يخلي أي تسريب
 * قابل للتتبع لصاحب الحساب، مش عشان يمنع اللقطة نفسها.
 *
 * الاستخدام:
 *   <link rel="stylesheet" href="/css/pdf-viewer.css">
 *   <div id="my-viewer"></div>
 *   <script src="/js/pdf-viewer.js"></script>
 *   <script>
 *     ProtectedPdfViewer.mount(document.getElementById('my-viewer'), {
 *       documentId: 123,
 *       accessUrl: (id) => `/api/student/documents/${id}/access`,
 *     });
 *   </script>
 */
(function (global) {
  'use strict';

  var PDFJS_CDN_BASE = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
  var pdfjsLoadPromise = null;

  function loadPdfJs() {
    if (global.pdfjsLib) return Promise.resolve(global.pdfjsLib);
    if (pdfjsLoadPromise) return pdfjsLoadPromise;

    pdfjsLoadPromise = new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = PDFJS_CDN_BASE + 'pdf.min.js';
      script.onload = function () {
        try {
          global.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_CDN_BASE + 'pdf.worker.min.js';
          resolve(global.pdfjsLib);
        } catch (e) {
          reject(e);
        }
      };
      script.onerror = function () {
        reject(new Error('تعذّر تحميل مكتبة عرض PDF'));
      };
      document.head.appendChild(script);
    });

    return pdfjsLoadPromise;
  }

  function el(tag, className, attrs) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        node.setAttribute(k, attrs[k]);
      });
    }
    return node;
  }

  function formatTimestamp(iso) {
    try {
      var d = new Date(iso);
      return d.toLocaleString('ar-EG', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit',
      });
    } catch (e) {
      return iso || '';
    }
  }

  /**
   * بيرسم ووترمارك متكرر بشكل مائل فوق الـ canvas بعد رسم صفحة الـ PDF.
   * التكرار والانتشار على كل الصفحة يمنع القص السهل للجزء اللي فيه الووترمارك.
   */
  function drawWatermark(ctx, canvasWidth, canvasHeight, lines) {
    ctx.save();
    ctx.globalAlpha = 0.14;
    ctx.fillStyle = '#c0392b';
    ctx.font = '600 16px -apple-system, "Segoe UI", Tahoma, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    var text = lines.join('   —   ');
    var stepX = 340;
    var stepY = 170;
    var angle = -30 * (Math.PI / 180);

    for (var y = -stepY; y < canvasHeight + stepY; y += stepY) {
      for (var x = -stepX; x < canvasWidth + stepX; x += stepX) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(angle);
        ctx.fillText(text, 0, 0);
        ctx.restore();
      }
    }
    ctx.restore();
  }

  function ProtectedViewer(container, options) {
    this.container = container;
    this.options = options || {};
    this.documentId = this.options.documentId;
    this.accessUrl = this.options.accessUrl || function (id) {
      return '/api/student/documents/' + id + '/access';
    };
    this.pdfDoc = null;
    this.watermarkLines = [];
    this.toastTimer = null;
    this._destroyed = false;

    this._buildShell();
    this._bindGuards();
    this._load();
  }

  ProtectedViewer.prototype._buildShell = function () {
    this.container.innerHTML = '';
    this.root = el('div', 'ppv-root');

    this.toolbar = el('div', 'ppv-toolbar');
    this.titleEl = el('span', 'ppv-title');
    this.titleEl.textContent = this.options.title || 'عرض المستند';
    this.pageIndicator = el('span', 'ppv-page-indicator');
    this.pageIndicator.textContent = '';
    this.toolbar.appendChild(this.titleEl);
    this.toolbar.appendChild(this.pageIndicator);

    this.scrollArea = el('div', 'ppv-scroll');
    this.statusEl = el('div', 'ppv-status');
    this.statusEl.innerHTML = '<span class="ppv-spinner"></span><span>جاري تحميل المستند...</span>';
    this.scrollArea.appendChild(this.statusEl);

    this.toast = el('div', 'ppv-toast');
    this.notice = el('div', 'ppv-notice');
    this.notice.textContent = 'هذا المستند محمي وموسوم باسمك — يمنع مشاركته أو إعادة نشره.';

    this.root.appendChild(this.toolbar);
    this.root.appendChild(this.scrollArea);
    this.root.appendChild(this.toast);
    this.root.appendChild(this.notice);

    var printMsg = el('div', 'ppv-print-block-message');
    printMsg.textContent = 'الطباعة غير متاحة لهذا المستند.';
    this.root.appendChild(printMsg);

    this.container.appendChild(this.root);
  };

  ProtectedViewer.prototype._showToast = function (message) {
    var self = this;
    this.toast.textContent = message;
    this.toast.classList.add('ppv-toast-visible');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(function () {
      self.toast.classList.remove('ppv-toast-visible');
    }, 2200);
  };

  ProtectedViewer.prototype._bindGuards = function () {
    var self = this;

    // منع قائمة الكليك اليمين جوه الفيوير (مش ضمان كامل، بس يرفع الاحتكاك).
    this.root.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      self._showToast('النسخ والحفظ غير متاحين لهذا المستند');
    });

    // محاولة اعتراض اختصارات الطباعة/الحفظ الشائعة. المتصفح ممكن يسمح
    // ببعضها برضه (خصوصًا لو المستخدم استخدم قائمة المتصفح مش لوحة المفاتيح)،
    // فده إجراء تقليل احتكاك مش منع مضمون 100%.
    this._keydownHandler = function (e) {
      var ctrlOrCmd = e.ctrlKey || e.metaKey;
      if (ctrlOrCmd && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault();
        self._showToast('الطباعة غير متاحة لهذا المستند');
      }
      if (ctrlOrCmd && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        self._showToast('الحفظ غير متاح لهذا المستند');
      }
    };
    document.addEventListener('keydown', this._keydownHandler);

    var beforePrintHandler = function () {
      self._showToast('الطباعة غير متاحة لهذا المستند');
    };
    global.addEventListener('beforeprint', beforePrintHandler);
    this._beforePrintHandler = beforePrintHandler;
  };

  ProtectedViewer.prototype._setStatus = function (html, isError) {
    this.statusEl.className = isError ? 'ppv-status ppv-status-error' : 'ppv-status';
    this.statusEl.innerHTML = html;
    if (!this.statusEl.parentNode) {
      this.scrollArea.innerHTML = '';
      this.scrollArea.appendChild(this.statusEl);
    }
  };

  ProtectedViewer.prototype._load = function () {
    var self = this;

    fetch(this.accessUrl(this.documentId), {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    })
      .then(function (res) {
        if (!res.ok) {
          return res.json().catch(function () { return {}; }).then(function (body) {
            throw new Error(body.message || 'تعذّر الوصول إلى المستند');
          });
        }
        return res.json();
      })
      .then(function (data) {
        if (self._destroyed) return;

        self.titleEl.textContent = data.title || self.titleEl.textContent;
        var w = data.watermark || {};
        self.watermarkLines = [
          w.studentName ? String(w.studentName) : '',
          w.studentId != null ? 'ID: ' + w.studentId : '',
          w.studentPhone ? String(w.studentPhone) : '',
          w.courseName ? String(w.courseName) : '',
          formatTimestamp(w.issuedAt),
        ].filter(Boolean);

        return loadPdfJs().then(function (pdfjsLib) {
          // بنجيب الملف كـ bytes مرة واحدة عن طريق fetch (مش تعيين src مباشر)
          // عشان الرابط الموقّع يُستخدم مرة واحدة ومايفضلش قابل لإعادة
          // الاستخدام كمصدر دائم في الصفحة.
          return fetch(data.url, { credentials: 'omit' });
        });
      })
      .then(function (res) {
        if (self._destroyed) return;
        if (!res.ok) throw new Error('انتهت صلاحية رابط الوصول، أعد تحميل الصفحة');
        return res.arrayBuffer();
      })
      .then(function (arrayBuffer) {
        if (self._destroyed || !arrayBuffer) return;
        var pdfjsLib = global.pdfjsLib;
        return pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      })
      .then(function (pdfDoc) {
        if (self._destroyed || !pdfDoc) return;
        self.pdfDoc = pdfDoc;
        self._renderAllPages();
      })
      .catch(function (err) {
        if (self._destroyed) return;
        self._setStatus(
          '<div>⚠️ ' + (err && err.message ? err.message : 'حدث خطأ أثناء تحميل المستند') + '</div>',
          true
        );
      });
  };

  ProtectedViewer.prototype._renderAllPages = function () {
    var self = this;
    var numPages = this.pdfDoc.numPages;
    this.scrollArea.innerHTML = '';
    this.pageIndicator.textContent = 'صفحة 1 / ' + numPages;

    var wraps = [];
    for (var i = 1; i <= numPages; i++) {
      var wrap = el('div', 'ppv-page-wrap', { 'data-page': String(i) });
      var placeholder = el('div', 'ppv-page-placeholder');
      placeholder.textContent = 'صفحة ' + i;
      wrap.appendChild(placeholder);
      this.scrollArea.appendChild(wrap);
      wraps.push(wrap);
    }

    // Lazy render: نرسم كل صفحة لما تقرب من مجال الرؤية، عشان الأداء مع
    // ملفات كبيرة العدد صفحات، مع الاحتفاظ بالملف كامل في الذاكرة بالفعل.
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          var pageNum = Number(entry.target.getAttribute('data-page'));
          self._renderPage(pageNum, entry.target);
          observer.unobserve(entry.target);
        }
      });
    }, { root: this.scrollArea, rootMargin: '600px 0px' });

    wraps.forEach(function (w) { observer.observe(w); });
    this._observer = observer;

    this.scrollArea.addEventListener('scroll', function () {
      self._updatePageIndicator();
    });
  };

  ProtectedViewer.prototype._updatePageIndicator = function () {
    var wraps = this.scrollArea.querySelectorAll('.ppv-page-wrap');
    var scrollTop = this.scrollArea.scrollTop;
    var current = 1;
    for (var i = 0; i < wraps.length; i++) {
      if (wraps[i].offsetTop - this.scrollArea.offsetTop <= scrollTop + 40) {
        current = i + 1;
      }
    }
    this.pageIndicator.textContent = 'صفحة ' + current + ' / ' + wraps.length;
  };

  ProtectedViewer.prototype._renderPage = function (pageNum, wrapEl) {
    var self = this;
    this.pdfDoc.getPage(pageNum).then(function (page) {
      if (self._destroyed) return;
      var containerWidth = self.scrollArea.clientWidth * 0.92;
      var baseViewport = page.getViewport({ scale: 1 });
      var scale = Math.min(2, containerWidth / baseViewport.width);
      var viewport = page.getViewport({ scale: scale });

      var canvas = el('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.setAttribute('draggable', 'false');
      canvas.addEventListener('dragstart', function (e) { e.preventDefault(); });

      var ctx = canvas.getContext('2d');
      page.render({ canvasContext: ctx, viewport: viewport }).promise.then(function () {
        if (self.watermarkLines.length) {
          drawWatermark(ctx, canvas.width, canvas.height, self.watermarkLines);
        }
      });

      wrapEl.innerHTML = '';
      wrapEl.appendChild(canvas);
    });
  };

  ProtectedViewer.prototype.destroy = function () {
    this._destroyed = true;
    if (this._observer) this._observer.disconnect();
    document.removeEventListener('keydown', this._keydownHandler);
    global.removeEventListener('beforeprint', this._beforePrintHandler);
    this.container.innerHTML = '';
    this.pdfDoc = null;
  };

  global.ProtectedPdfViewer = {
    mount: function (container, options) {
      return new ProtectedViewer(container, options);
    },
  };
})(window);

