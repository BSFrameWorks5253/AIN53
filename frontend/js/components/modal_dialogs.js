/**
 * AIN53 Data Management — Professional Modal Dialogs Suite (modal_dialogs.js)
 * Replaces native browser alert(), confirm(), and prompt() with
 * ultra-modern, accessible, animated glassmorphic dialog cards.
 */

(function () {
  'use strict';

  // SVG Icon definitions for high-res crisp icons
  const ICONS = {
    flag: `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"></path><line x1="4" y1="22" x2="4" y2="15"></line></svg>`,
    trash: `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>`,
    warning: `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`,
    danger: `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2"></polygon><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`,
    undo: `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg>`,
    move: `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline><line x1="3" y1="12" x2="15" y2="12"></line><path d="M21 12h-2"></path></svg>`,
    copy: `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`,
    edit: `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>`,
    info: `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`,
    success: `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`,
    question: `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`
  };

  /**
   * Internal helper to create and display a custom dialog
   */
  function createDialog(options = {}) {
    return new Promise((resolve) => {
      const {
        title = 'Confirmation Required',
        message = '',
        details = '',
        type = 'primary', // 'primary' | 'danger' | 'warning' | 'info' | 'success'
        icon = null,
        confirmText = 'Confirm',
        cancelText = 'Cancel',
        showCancel = true,
        isPrompt = false,
        defaultValue = '',
        placeholder = '',
        inputType = 'text'
      } = options;

      // Ensure old dialogs are closed
      const existing = document.querySelector('.app-dialog-overlay');
      if (existing) {
        existing.remove();
      }

      // Determine default icon based on type if not explicitly passed
      const resolvedIconKey = icon || (
        type === 'danger' ? 'danger' :
        type === 'warning' ? 'warning' :
        type === 'info' ? 'info' :
        type === 'success' ? 'success' :
        isPrompt ? 'edit' : 'question'
      );
      const iconSvg = ICONS[resolvedIconKey] || ICONS.question;

      // Overlay Container
      const overlay = document.createElement('div');
      overlay.className = 'app-dialog-overlay';

      // Dialog Card
      const card = document.createElement('div');
      card.className = `app-dialog-card app-dialog-${type}`;
      card.setAttribute('role', 'dialog');
      card.setAttribute('aria-modal', 'true');

      // Top Header / Icon Badge
      const badgeWrap = document.createElement('div');
      badgeWrap.className = 'app-dialog-badge-wrap';

      const pulseRing = document.createElement('div');
      pulseRing.className = `app-dialog-pulse-ring app-dialog-pulse-${type}`;

      const iconBadge = document.createElement('div');
      iconBadge.className = `app-dialog-badge app-dialog-badge-${type}`;
      iconBadge.innerHTML = iconSvg;

      badgeWrap.appendChild(pulseRing);
      badgeWrap.appendChild(iconBadge);
      card.appendChild(badgeWrap);

      // Body Area
      const bodyEl = document.createElement('div');
      bodyEl.className = 'app-dialog-body';

      const titleEl = document.createElement('h3');
      titleEl.className = 'app-dialog-title';
      titleEl.textContent = title;
      bodyEl.appendChild(titleEl);

      if (message) {
        const msgEl = document.createElement('div');
        msgEl.className = 'app-dialog-message';
        // Allow formatted HTML or string
        msgEl.innerHTML = message;
        bodyEl.appendChild(msgEl);
      }

      if (details) {
        const detailsEl = document.createElement('div');
        detailsEl.className = 'app-dialog-details';
        detailsEl.innerHTML = details;
        bodyEl.appendChild(detailsEl);
      }

      // Prompt Input Field
      let promptInput = null;
      if (isPrompt) {
        const inputWrap = document.createElement('div');
        inputWrap.className = 'app-dialog-input-wrap';

        promptInput = document.createElement('input');
        promptInput.type = inputType;
        promptInput.className = 'input-glass app-dialog-input';
        promptInput.placeholder = placeholder;
        promptInput.value = defaultValue;
        promptInput.spellcheck = false;

        inputWrap.appendChild(promptInput);
        bodyEl.appendChild(inputWrap);
      }

      card.appendChild(bodyEl);

      // Actions / Footer
      const actionsEl = document.createElement('div');
      actionsEl.className = 'app-dialog-actions';

      let cancelBtn = null;
      if (showCancel) {
        cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'btn btn-secondary app-dialog-btn-cancel';
        cancelBtn.textContent = cancelText;
        actionsEl.appendChild(cancelBtn);
      }

      const confirmBtn = document.createElement('button');
      confirmBtn.type = 'button';
      confirmBtn.className = `btn app-dialog-btn-confirm app-dialog-btn-${type}`;
      confirmBtn.textContent = confirmText;
      actionsEl.appendChild(confirmBtn);

      card.appendChild(actionsEl);
      overlay.appendChild(card);
      document.body.appendChild(overlay);

      // Auto-focus input or confirm button
      setTimeout(() => {
        if (promptInput && typeof promptInput.focus === 'function') {
          promptInput.focus();
          if (typeof promptInput.select === 'function') promptInput.select();
        } else if (confirmBtn && typeof confirmBtn.focus === 'function') {
          confirmBtn.focus();
        }
      }, 50);

      // Dismiss helper with smooth exit animation
      let isClosing = false;
      const closeDialog = (result) => {
        if (isClosing) return;
        isClosing = true;

        document.removeEventListener('keydown', onKeyDown);
        card.classList.add('app-dialog-exit');
        overlay.classList.add('app-dialog-overlay-exit');

        setTimeout(() => {
          overlay.remove();
          resolve(result);
        }, 180);
      };

      // Event handlers
      if (cancelBtn) {
        cancelBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          closeDialog(isPrompt ? null : false);
        });
      }

      confirmBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isPrompt) {
          closeDialog(promptInput ? promptInput.value : '');
        } else {
          closeDialog(true);
        }
      });

      // Overlay backdrop click to cancel
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          closeDialog(isPrompt ? null : false);
        }
      });

      // Keyboard support
      const onKeyDown = (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          closeDialog(isPrompt ? null : false);
        } else if (e.key === 'Enter') {
          if (e.target.tagName !== 'TEXTAREA') {
            e.preventDefault();
            if (isPrompt) {
              closeDialog(promptInput ? promptInput.value : '');
            } else {
              closeDialog(true);
            }
          }
        }
      };

      document.addEventListener('keydown', onKeyDown);
    });
  }

  // ── Public Global API ──

  /**
   * Rich Confirmation Dialog
   * @param {Object} opts
   * @returns {Promise<boolean>}
   */
  window.confirmModal = function (opts = {}) {
    return createDialog({
      type: 'primary',
      showCancel: true,
      ...opts,
      isPrompt: false
    });
  };

  /**
   * Rich Prompt Input Dialog
   * @param {Object} opts
   * @returns {Promise<string|null>}
   */
  window.promptModal = function (opts = {}) {
    return createDialog({
      type: 'primary',
      showCancel: true,
      confirmText: 'Save',
      ...opts,
      isPrompt: true
    });
  };

  /**
   * Rich Alert Notice Dialog
   * @param {Object} opts
   * @returns {Promise<void>}
   */
  window.alertModal = function (opts = {}) {
    return createDialog({
      type: 'info',
      confirmText: 'Got It',
      showCancel: false,
      ...opts,
      isPrompt: false
    }).then(() => {});
  };

  // Friendly aliases
  window.showConfirmDialog = window.confirmModal;
  window.showPromptDialog = window.promptModal;
  window.showAlertDialog = window.alertModal;

  console.log('✅ Professional Modal Dialogs Suite initialized successfully.');
})();
