/* ===== Zhihua Moulds – main.js ===== */
(function () {
  'use strict';

  /* ---------- Hamburger Toggle ---------- */
  const hamburger = document.querySelector('.hamburger');
  const navLinks  = document.querySelector('.nav-links');
  if (hamburger && navLinks) {
    // Create sidebar overlay
    const sidebarOverlay = document.createElement('div');
    sidebarOverlay.className = 'sidebar-overlay';
    document.body.appendChild(sidebarOverlay);

    function toggleSidebar(show) {
      hamburger.classList.toggle('open', show);
      navLinks.classList.toggle('open', show);
      sidebarOverlay.classList.toggle('open', show);
      document.body.classList.toggle('no-scroll', show);
    }

    hamburger.addEventListener('click', () => {
      toggleSidebar(!hamburger.classList.contains('open'));
    });

    // Close on overlay click
    sidebarOverlay.addEventListener('click', () => {
      toggleSidebar(false);
    });

    // close on link click (mobile)
    navLinks.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        toggleSidebar(false);
      });
    });
  }

  /* ---------- Scroll Fade-in (IntersectionObserver) ---------- */
  const faders = document.querySelectorAll('.fade-in');
  if (faders.length && 'IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15 });
    faders.forEach(el => observer.observe(el));
  } else {
    // fallback: just show everything
    faders.forEach(el => el.classList.add('visible'));
  }

  /* ---------- Contact Form Validation ---------- */
  const form = document.getElementById('inquiryForm');
  if (form) {
    const submitBtn = document.getElementById('submitBtn');
    const btnText = submitBtn?.querySelector('.btn-text');
    const btnLoading = submitBtn?.querySelector('.btn-loading');
    const formSuccess = document.getElementById('formSuccess');
    const formError = document.getElementById('formError');

    let messageTimeout = null;

    function showMessage(element, duration) {
      if (formSuccess) formSuccess.style.display = 'none';
      if (formError) formError.style.display = 'none';
      element.style.display = 'block';
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      
      if (messageTimeout) clearTimeout(messageTimeout);
      messageTimeout = setTimeout(() => {
        element.style.display = 'none';
      }, duration);
    }

    function setLoading(loading) {
      if (btnText && btnLoading && submitBtn) {
        submitBtn.disabled = loading;
        btnText.style.display = loading ? 'none' : 'inline';
        btnLoading.style.display = loading ? 'inline' : 'none';
      }
    }

    function validateField(input) {
      const group = input.closest('.form-group');
      if (!group) return true;

      let valid = true;
      const name = input.name;
      const value = input.value.trim();

      if ((name === 'name' || name === 'email' || name === 'phone' || name === 'message') && !value) {
        valid = false;
      }

      if (name === 'email' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        valid = false;
      }

      group.classList.toggle('has-error', !valid);
      return valid;
    }

    // Real-time validation on input
    form.querySelectorAll('input, textarea, select').forEach(input => {
      input.addEventListener('input', () => validateField(input));
      input.addEventListener('blur', () => validateField(input));
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      
      let valid = true;
      form.querySelectorAll('.form-group').forEach(g => g.classList.remove('has-error'));

      const required = ['name', 'email', 'phone', 'message'];
      required.forEach(name => {
        const input = form.querySelector(`[name="${name}"]`);
        if (input && !validateField(input)) {
          valid = false;
        }
      });

      if (!valid) {
        if (formError) showMessage(formError, 5000);
        return;
      }

      // Show loading state
      setLoading(true);

      const formType = form.getAttribute('data-form-type') || 'mailto';
      const formAction = form.getAttribute('action');

      function resetTurnstile() {
        if (window.turnstile && form.querySelector('.cf-turnstile')) {
          try {
            window.turnstile.reset();
          } catch (error) {
            console.warn('Turnstile reset failed', error);
          }
        }
      }

      // Handle different form types
      if (formType === 'api') {
        const formData = new FormData(form);
        if (form.querySelector('.cf-turnstile') && !formData.get('cf-turnstile-response')) {
          setLoading(false);
          if (formError) {
            formError.textContent = '❌ Please complete the anti-spam check, then submit again. You can also contact us by WhatsApp/email.';
            showMessage(formError, 6000);
          }
          return;
        }

        fetch(formAction || '/api/inquiry', {
          method: 'POST',
          body: formData,
          headers: {
            'Accept': 'application/json'
          }
        }).then(async response => {
          setLoading(false);
          const result = await response.json().catch(() => ({}));
          if (response.ok && result.ok !== false) {
            if (formSuccess) {
              formSuccess.textContent = result.message || formSuccess.dataset.successText || formSuccess.textContent || '✅ Thank you! Your inquiry has been submitted successfully. We will contact you within 24 hours.';
              showMessage(formSuccess, 7000);
              form.reset();
              resetTurnstile();
            }
            if (typeof gtag === 'function') {
              gtag('event', 'generate_lead', { form_location: 'contact_page', form_provider: 'resend_turnstile' });
            }
          } else {
            throw new Error(result.message || 'Submission failed');
          }
        }).catch((error) => {
          setLoading(false);
          resetTurnstile();
          if (formError) {
            formError.textContent = error.message || '❌ Submit failed. Please contact us by WhatsApp or email.';
            showMessage(formError, 6000);
          }
        });
      } else if (formType === 'formspree' || (formAction && formAction.includes('formspree.io'))) {
        // Formspree submission - use fetch API
        const formData = new FormData(form);
        fetch(formAction, {
          method: 'POST',
          body: formData,
          headers: {
            'Accept': 'application/json'
          }
        }).then(response => {
          setLoading(false);
          if (response.ok) {
            if (formSuccess) {
              formSuccess.textContent = formSuccess.dataset.successText || formSuccess.textContent || '✅ Thank you! Your inquiry has been submitted successfully. We will contact you within 24 hours.';
              showMessage(formSuccess, 7000);
              form.reset();
            }
            if (typeof gtag === 'function') {
              gtag('event', 'generate_lead', { form_location: 'contact_page', form_provider: formType });
            }
          } else {
            throw new Error('Submission failed');
          }
        }).catch(() => {
          setLoading(false);
          if (formError) showMessage(formError, 5000);
        });
      } else if (formType === 'netlify' || form.hasAttribute('netlify')) {
        // Netlify Forms - let Netlify handle the submission
        const formData = new FormData(form);
        fetch('/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams(formData).toString()
        }).then(response => {
          setLoading(false);
          if (response.ok) {
            if (formSuccess) {
              showMessage(formSuccess, 5000);
              form.reset();
            }
          } else {
            throw new Error('Submission failed');
          }
        }).catch(() => {
          setLoading(false);
          if (formError) showMessage(formError, 5000);
        });
      } else {
        // mailto fallback - open the visitor's email client with a readable inquiry.
        setTimeout(() => {
          setLoading(false);
          const data = new FormData(form);
          const subject = encodeURIComponent('Website inquiry from ' + (data.get('name') || 'visitor'));
          const lines = [
            'New inquiry from zhihuamoulds.com',
            '',
            'Name: ' + (data.get('name') || ''),
            'Company: ' + (data.get('company') || ''),
            'Country: ' + (data.get('country') || ''),
            'Email: ' + (data.get('email') || ''),
            'Phone / WhatsApp: ' + (data.get('phone') || ''),
            'Product: ' + (data.get('product') || ''),
            'Quantity: ' + (data.get('quantity') || ''),
            'Budget: ' + (data.get('budget') || ''),
            '',
            'Message:',
            data.get('message') || '',
            '',
            'Source page: ' + (data.get('source_page') || window.location.href)
          ];
          const body = encodeURIComponent(lines.join('\n'));
          if (formSuccess) {
            showMessage(formSuccess, 5000);
          }
          window.location.href = 'mailto:354909745@qq.com?subject=' + subject + '&body=' + body;
        }, 300);
      }
    });
  }

  /* ---------- Active Nav Link ---------- */
  const current = location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav-links a').forEach(a => {
    const href = a.getAttribute('href');
    if (href === current || (current === '' && href === 'index.html')) {
      a.classList.add('active');
    }
  });

  /* ---------- Lightbox (facility gallery + certs wall) ---------- */
  // Collect all triggers: any .facility-card or .cert-card that has data-lightbox attribute
  const lightboxTriggers = Array.from(document.querySelectorAll('[data-lightbox]'));
  if (lightboxTriggers.length) {
    // Build lightbox DOM once
    const lb = document.createElement('div');
    lb.className = 'lightbox';
    lb.setAttribute('role', 'dialog');
    lb.setAttribute('aria-modal', 'true');
    lb.setAttribute('aria-label', 'Image viewer');
    lb.innerHTML = `
      <button class="lightbox-close" aria-label="Close">×</button>
      <button class="lightbox-arrow lightbox-prev" aria-label="Previous">‹</button>
      <img alt="" />
      <button class="lightbox-arrow lightbox-next" aria-label="Next">›</button>
    `;
    document.body.appendChild(lb);
    const lbImg = lb.querySelector('img');
    const lbClose = lb.querySelector('.lightbox-close');
    const lbPrev = lb.querySelector('.lightbox-prev');
    const lbNext = lb.querySelector('.lightbox-next');

    // Group triggers by data-lightbox group name (default 'all')
    const groups = {};
    lightboxTriggers.forEach(el => {
      const g = el.getAttribute('data-lightbox') || 'all';
      groups[g] = groups[g] || [];
      groups[g].push(el);
    });

    let currentGroup = [];
    let currentIndex = 0;

    function show(idx) {
      if (!currentGroup.length) return;
      currentIndex = (idx + currentGroup.length) % currentGroup.length;
      const el = currentGroup[currentIndex];
      const src = el.getAttribute('data-lightbox-src') || el.querySelector('img')?.src;
      const alt = el.getAttribute('data-lightbox-alt') || el.querySelector('img')?.alt || '';
      if (src) {
        lbImg.src = src;
        lbImg.alt = alt;
      }
    }
    function open(el) {
      const g = el.getAttribute('data-lightbox') || 'all';
      currentGroup = groups[g] || [el];
      const idx = currentGroup.indexOf(el);
      show(idx >= 0 ? idx : 0);
      lb.classList.add('open');
      document.body.style.overflow = 'hidden';
    }
    function close() {
      lb.classList.remove('open');
      document.body.style.overflow = '';
    }

    lightboxTriggers.forEach(el => {
      el.addEventListener('click', e => {
        e.preventDefault();
        open(el);
      });
    });
    lbClose.addEventListener('click', close);
    lb.addEventListener('click', e => { if (e.target === lb) close(); });
    lbPrev.addEventListener('click', e => { e.stopPropagation(); show(currentIndex - 1); });
    lbNext.addEventListener('click', e => { e.stopPropagation(); show(currentIndex + 1); });
    document.addEventListener('keydown', e => {
      if (!lb.classList.contains('open')) return;
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowLeft') show(currentIndex - 1);
      else if (e.key === 'ArrowRight') show(currentIndex + 1);
    });
  }

})();

// Inquiry form: submit to Cloudflare Pages Function and preserve UTM/source data.
document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('inquiryForm');
  if (!form) return;

  const params = new URLSearchParams(window.location.search);
  ['utm_source', 'utm_medium', 'utm_campaign'].forEach((key) => {
    const input = document.getElementById(key);
    if (input) input.value = params.get(key) || '';
  });
  const source = document.getElementById('source_page');
  if (source) source.value = window.location.pathname + window.location.search;

  form.addEventListener('submit', async (event) => {
    if (form.dataset.formType !== 'api') return;
    event.preventDefault();

    const success = document.getElementById('formSuccess');
    const error = document.getElementById('formError');
    const btn = document.getElementById('submitBtn');
    const btnText = btn?.querySelector('.btn-text');
    const btnLoading = btn?.querySelector('.btn-loading');

    if (success) success.style.display = 'none';
    if (error) error.style.display = 'none';

    if (!form.checkValidity()) {
      form.reportValidity();
      if (error) {
        error.textContent = '❌ Please fill in the required fields and try again.';
        error.style.display = 'block';
      }
      return;
    }

    if (btn) btn.disabled = true;
    if (btnText) btnText.style.display = 'none';
    if (btnLoading) btnLoading.style.display = 'inline';

    try {
      const response = await fetch(form.action, {
        method: 'POST',
        body: new FormData(form),
        headers: { 'accept': 'application/json' }
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.message || 'Submit failed');

      if (success) {
        success.textContent = '✅ ' + (result.message || 'Thank you! Your inquiry has been submitted successfully. We will contact you within 24 hours.');
        success.style.display = 'block';
      }
      if (typeof gtag === 'function') {
        gtag('event', 'generate_lead', { form_location: 'contact_page' });
      }
      form.reset();
    } catch (err) {
      if (error) {
        error.textContent = '❌ ' + (err.message || 'Submit failed. Please contact us by WhatsApp or email.');
        error.style.display = 'block';
      }
    } finally {
      if (btn) btn.disabled = false;
      if (btnText) btnText.style.display = 'inline';
      if (btnLoading) btnLoading.style.display = 'none';
    }
  });
});

