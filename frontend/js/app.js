// Register Ctrl+R & F5 refresh hotkeys so the UI reloads instantly without app reboot
window.addEventListener('keydown', (e) => {
  const isCtrlR = (e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'r');
  const isF5 = e.key === 'F5';
  if (isCtrlR || isF5) {
    e.preventDefault();
    window.location.reload();
  }
});

// ── Chrome-Style UI Zoom Controller (Ctrl + +, Ctrl + -, Ctrl + 0, Ctrl + Wheel) ──
(function initZoomController() {
  const ZOOM_STEPS = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.75, 2.0];
  let currentZoom = parseFloat(localStorage.getItem('app_zoom_level')) || 1.0;
  let badgeTimer = null;

  function showZoomBadge(zoomVal) {
    let badge = document.getElementById('app-zoom-badge');
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'app-zoom-badge';
      badge.style.position = 'fixed';
      badge.style.top = '16px';
      badge.style.right = '24px';
      badge.style.zIndex = '999999';
      badge.style.background = 'rgba(15, 23, 42, 0.9)';
      badge.style.color = '#38bdf8';
      badge.style.border = '1px solid rgba(56, 189, 248, 0.4)';
      badge.style.borderRadius = '20px';
      badge.style.padding = '5px 14px';
      badge.style.fontSize = '12px';
      badge.style.fontWeight = '700';
      badge.style.fontFamily = 'system-ui, -apple-system, sans-serif';
      badge.style.boxShadow = '0 4px 14px rgba(0, 0, 0, 0.4)';
      badge.style.pointerEvents = 'none';
      badge.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
      badge.style.opacity = '0';
      badge.style.transform = 'translateY(-6px)';
      if (document.body) document.body.appendChild(badge);
    }

    if (badge) {
      const pct = Math.round(zoomVal * 100);
      badge.innerHTML = `🔍 ${pct}%`;
      badge.style.opacity = '1';
      badge.style.transform = 'translateY(0)';

      if (badgeTimer) clearTimeout(badgeTimer);
      badgeTimer = setTimeout(() => {
        badge.style.opacity = '0';
        badge.style.transform = 'translateY(-6px)';
      }, 1300);
    }
  }

  function applyZoom(newZoom, showToastBadge = true) {
    const clamped = Math.max(0.5, Math.min(2.0, parseFloat(newZoom.toFixed(2))));
    currentZoom = clamped;

    document.documentElement.style.setProperty('--app-scale', currentZoom.toString());
    document.documentElement.style.fontSize = (16 * currentZoom) + 'px';

    // Reset zoom on body/documentElement so native flex coordinates remain intact
    if (document.body) {
      document.body.style.zoom = '1';
    }
    if (document.documentElement) {
      document.documentElement.style.zoom = '1';
    }

    localStorage.setItem('app_zoom_level', currentZoom.toString());
    if (showToastBadge) {
      showZoomBadge(currentZoom);
    }
  }

  function zoomIn() {
    let next = ZOOM_STEPS.find(s => s > currentZoom + 0.01);
    if (!next) next = 2.0;
    applyZoom(next);
  }

  function zoomOut() {
    let prev = [...ZOOM_STEPS].reverse().find(s => s < currentZoom - 0.01);
    if (!prev) prev = 0.5;
    applyZoom(prev);
  }

  function resetZoom() {
    applyZoom(1.0);
  }

  // Restore saved zoom level immediately on startup
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => applyZoom(currentZoom, false));
  } else {
    applyZoom(currentZoom, false);
  }

  // Global Keyboard Listener (Ctrl + +, Ctrl + -, Ctrl + 0)
  window.addEventListener('keydown', (e) => {
    const isCtrl = e.ctrlKey || e.metaKey;
    if (!isCtrl) return;

    const key = e.key;
    const code = e.code;

    // Zoom In: Ctrl + '+' or '=' or NumpadAdd
    if (key === '+' || key === '=' || code === 'NumpadAdd' || (e.shiftKey && key === '=')) {
      e.preventDefault();
      zoomIn();
    }
    // Zoom Out: Ctrl + '-' or '_' or NumpadSubtract
    else if (key === '-' || key === '_' || code === 'NumpadSubtract') {
      e.preventDefault();
      zoomOut();
    }
    // Zoom Reset: Ctrl + '0' or Numpad0
    else if (key === '0' || code === 'Numpad0') {
      e.preventDefault();
      resetZoom();
    }
  }, { passive: false });

  // Global Mouse Wheel Listener (Ctrl + Scroll Up / Down)
  window.addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      if (e.deltaY < 0) {
        zoomIn();
      } else if (e.deltaY > 0) {
        zoomOut();
      }
    }
  }, { passive: false });

  // Expose global zoom helpers
  window.appZoomIn = zoomIn;
  window.appZoomOut = zoomOut;
  window.appResetZoom = resetZoom;
  window.appApplyZoom = applyZoom;
})();

document.addEventListener('DOMContentLoaded', () => {
  const navBtns = document.querySelectorAll('.nav-btn');
  const views = document.querySelectorAll('.view-panel, .view-section');
  const contentArea = document.querySelector('.content-area');

  const viewTitles = {
    'view-pdf': 'PDF to CSV Extractor',
    'view-csv': 'CSV to Folders Generator',
    'view-sorting': 'Media Sorting Engine',
    'view-inventory': 'Drive Inventory Scanner',
    'view-settings': 'Application Settings'
  };

  navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const viewId = btn.getAttribute('data-view');
      if (!viewId) return;

      // Remove active from all
      navBtns.forEach(b => b.classList.remove('active'));
      views.forEach(v => v.classList.add('hidden'));

      // Set active
      btn.classList.add('active');
      const targetView = document.getElementById(viewId);
      if (targetView) targetView.classList.remove('hidden');

      // Update header title in ReactController
      if (window.ReactController && viewTitles[viewId]) {
        window.ReactController.setActiveTitle(viewTitles[viewId]);
      }

      // Keep content-area scrollable across all views
      if (contentArea) {
        contentArea.style.overflowY = 'auto';
      }
    });
  });

  // Restore saved theme on startup
  const savedTheme = localStorage.getItem('ain53_theme') || 'dark';
  window.setAppTheme(savedTheme);

  // Load app version from backend
  window.loadAppVersion();
});

// Enhanced Utility to show rich toast notifications (success, error, warning, info, progress, actions)
window.showToast = function(msg, type = 'success', duration = 4000, actionButtons = null) {
  let toast = document.getElementById('toast');
  if (!toast) return;

  if (window._toastTimeout) {
    clearTimeout(window._toastTimeout);
    window._toastTimeout = null;
  }

  toast.innerHTML = '';
  toast.className = 'toast';

  const iconBadge = document.createElement('div');
  iconBadge.className = 'toast-icon-badge';

  if (type === 'error' || type === true) {
    toast.style.background = 'linear-gradient(135deg, rgba(220, 38, 38, 0.94) 0%, rgba(185, 28, 28, 0.94) 100%)';
    toast.style.color = '#ffffff';
    toast.style.borderColor = 'rgba(248, 113, 113, 0.45)';
    toast.style.boxShadow = '0 12px 36px rgba(220, 38, 38, 0.35)';
    iconBadge.textContent = '⚠️';
  } else if (type === 'warning') {
    toast.style.background = 'linear-gradient(135deg, rgba(217, 119, 6, 0.94) 0%, rgba(180, 83, 9, 0.94) 100%)';
    toast.style.color = '#ffffff';
    toast.style.borderColor = 'rgba(251, 191, 36, 0.45)';
    toast.style.boxShadow = '0 12px 36px rgba(217, 119, 6, 0.35)';
    iconBadge.textContent = '⚡';
  } else if (type === 'info' || type === 'update') {
    toast.style.background = 'linear-gradient(135deg, rgba(5, 150, 105, 0.94) 0%, rgba(4, 120, 87, 0.94) 100%)';
    toast.style.color = '#ffffff';
    toast.style.borderColor = 'rgba(52, 211, 153, 0.45)';
    toast.style.boxShadow = '0 12px 36px rgba(16, 185, 129, 0.35)';
    iconBadge.textContent = '🚀';
  } else {
    toast.style.background = 'linear-gradient(135deg, rgba(16, 185, 129, 0.94) 0%, rgba(5, 150, 105, 0.94) 100%)';
    toast.style.color = '#ffffff';
    toast.style.borderColor = 'rgba(52, 211, 153, 0.45)';
    toast.style.boxShadow = '0 12px 36px rgba(16, 185, 129, 0.35)';
    iconBadge.textContent = '✅';
  }

  const textNode = document.createElement('div');
  textNode.style.flex = '1';
  textNode.style.lineHeight = '1.45';
  textNode.innerHTML = msg;

  toast.appendChild(iconBadge);
  toast.appendChild(textNode);

  if (actionButtons && Array.isArray(actionButtons)) {
    const btnContainer = document.createElement('div');
    btnContainer.style.display = 'inline-flex';
    btnContainer.style.gap = '6px';

    actionButtons.forEach(btnConfig => {
      const btn = document.createElement('button');
      btn.textContent = btnConfig.text;
      btn.style.padding = '5px 12px';
      btn.style.borderRadius = '8px';
      btn.style.border = 'none';
      btn.style.fontWeight = '700';
      btn.style.fontSize = '0.88rem';
      btn.style.cursor = 'pointer';
      btn.style.fontFamily = 'Outfit, sans-serif';
      btn.style.background = btnConfig.primary ? '#ffffff' : 'rgba(255,255,255,0.22)';
      btn.style.color = btnConfig.primary ? '#047857' : '#ffffff';
      btn.onclick = (evt) => {
        evt.stopPropagation();
        if (btnConfig.onClick) btnConfig.onClick();
        if (!btnConfig.keepOpen) window.hideToast();
      };
      btnContainer.appendChild(btn);
    });
    toast.appendChild(btnContainer);
  }

  // Dismiss button (✕)
  const closeBtn = document.createElement('button');
  closeBtn.className = 'toast-close-btn';
  closeBtn.innerHTML = '✕';
  closeBtn.title = 'Dismiss';
  closeBtn.onclick = (e) => {
    e.stopPropagation();
    window.hideToast();
  };
  toast.appendChild(closeBtn);

  toast.classList.remove('hidden');

  if (duration && duration > 0) {
    window._toastTimeout = setTimeout(() => {
      window.hideToast();
    }, duration);
  }
};

window.hideToast = function() {
  let toast = document.getElementById('toast');
  if (!toast || toast.classList.contains('hidden')) return;

  if (window._toastTimeout) {
    clearTimeout(window._toastTimeout);
    window._toastTimeout = null;
  }

  toast.classList.add('toast-hiding');
  setTimeout(() => {
    toast.classList.add('hidden');
    toast.classList.remove('toast-hiding');
  }, 240);
};

// ── Global Progress Controller ──
window.ProgressController = {
  overlay: null,
  titleEl: null,
  subtitleEl: null,
  circle: null,
  innerSpinner: null,
  innerText: null,
  detailsContainer: null,
  text: null,
  eta: null,
  
  startTime: 0,
  history: [],
  total: 0,
  isDeterminateMode: false,
  checkInterval: null,

  init() {
    this.overlay = document.getElementById('global-progress-overlay');
    this.titleEl = document.getElementById('global-progress-title');
    this.subtitleEl = document.getElementById('global-progress-subtitle');
    this.circle = document.getElementById('global-progress-circle');
    this.innerSpinner = document.getElementById('global-progress-inner-spinner');
    this.innerText = document.getElementById('global-progress-inner-text');
    this.detailsContainer = document.getElementById('global-progress-details');
    this.text = document.getElementById('global-progress-text');
    this.eta = document.getElementById('global-progress-eta');
  },

  setProgress(percent) {
    const strokeDash = 276.46;
    const offset = strokeDash - (percent / 100) * strokeDash;
    if (this.circle) {
      this.circle.style.strokeDashoffset = offset;
    }
  },

  start(title = "Processing...", subtitle = "Please wait while the task completes.", totalItems = 0) {
    if (!this.overlay) this.init();
    if (this.titleEl) this.titleEl.textContent = title;
    if (this.subtitleEl) this.subtitleEl.textContent = subtitle;
    this.total = totalItems;
    this.startTime = Date.now();
    this.history = [];
    this.isDeterminateMode = false;
    
    // Set circle progress to 0
    this.setProgress(0);
    
    // Update live floating React dock
    if (window.ReactController) {
      window.ReactController.updateDock({
        isProcessing: true,
        title: title,
        subtitle: subtitle,
        current: 0,
        total: totalItems,
        percent: 0,
        eta: 'Calculating...'
      });
      window.ReactController.setStatus(`Processing: ${title}`);
    }

    if (this.innerSpinner) this.innerSpinner.classList.remove('hidden');
    if (this.innerText) this.innerText.classList.add('hidden');
    if (this.detailsContainer) this.detailsContainer.classList.add('hidden');
    
    if (this.overlay) this.overlay.style.display = 'flex';
    
    this.checkInterval = setInterval(() => {
      if (!this.isDeterminateMode && (Date.now() - this.startTime) > 1500 && this.total > 0) {
        this.switchToDeterminate();
      }
    }, 500);
  },

  switchToDeterminate() {
    this.isDeterminateMode = true;
    if (this.innerSpinner) this.innerSpinner.classList.add('hidden');
    if (this.innerText) this.innerText.classList.remove('hidden');
    if (this.detailsContainer) this.detailsContainer.classList.remove('hidden');
  },

  update(current, subtitle = null, customEta = null, customText = null, customPercent = null) {
    if (subtitle && this.subtitleEl) this.subtitleEl.textContent = subtitle;
    
    const now = Date.now();
    this.history.push({ time: now, current: current });
    if (this.history.length > 100) this.history.shift();
    
    if (this.total > 0 || customPercent !== null) {
      if (!this.isDeterminateMode) {
        this.switchToDeterminate();
      }
      
      const pct = customPercent !== null ? Math.min(100, Math.max(0, Math.floor(customPercent))) : Math.min(100, Math.floor((current / this.total) * 100));
      this.setProgress(pct);
      if (this.innerText) this.innerText.textContent = `${pct}%`;
      if (this.text) this.text.textContent = customText || `${current} / ${this.total}`;
      
      let calculatedEta = customEta || "Almost done...";
      if (!customEta && this.history.length > 5) {
        const first = this.history[0];
        const last = this.history[this.history.length - 1];
        const elapsedSec = (last.time - first.time) / 1000;
        const itemsDone = last.current - first.current;
        
        if (elapsedSec > 0 && itemsDone > 0) {
          const rate = itemsDone / elapsedSec;
          const remaining = (this.total - current) / rate;
          if (remaining > 60) {
            calculatedEta = `~${Math.ceil(remaining / 60)} min remaining`;
          } else if (remaining > 0) {
            calculatedEta = `~${Math.ceil(remaining)}s remaining`;
          }
        }
      }
      if (this.eta) this.eta.textContent = calculatedEta;

      // Sync React dock
      if (window.ReactController) {
        window.ReactController.updateDock({
          isProcessing: true,
          subtitle: subtitle || 'Processing...',
          current: current,
          total: this.total,
          percent: pct,
          eta: calculatedEta
        });
      }
    }
  },

  stop() {
    if (this.checkInterval) clearInterval(this.checkInterval);
    if (this.overlay) this.overlay.style.display = 'none';
    if (window.ReactController) {
      window.ReactController.updateDock({ isProcessing: false });
      window.ReactController.setStatus('System Ready');
    }
  }
};

// ── Global Drag & Drop Handler ──
window._lastDropZoneId = null;
window._dropCallbacks = {};

window.makeDropZone = function(elementId, callback) {
  const container = document.getElementById(elementId);
  if (!container) return;

  container.addEventListener('dragover', e => {
    e.preventDefault();
    container.classList.add('drag-over');
    window._lastDropZoneId = elementId;
  });

  container.addEventListener('dragleave', e => {
    e.preventDefault();
    container.classList.remove('drag-over');
    if (window._lastDropZoneId === elementId) {
      window._lastDropZoneId = null;
    }
  });

  container.addEventListener('drop', e => {
    e.preventDefault();
    container.classList.remove('drag-over');
    window._lastDropZoneId = elementId;
    
    const file = e.dataTransfer.files[0];
    if (file && file.path) {
      window.handleGlobalDrop([file.path]);
    }
  });

  window._dropCallbacks[elementId] = callback;
};

window.handleGlobalDrop = function(paths) {
  const dragOverlay = document.getElementById('drag-drop-overlay');
  if (dragOverlay) dragOverlay.classList.add('hidden');
  window._dragCounter = 0;

  if (!paths || paths.length === 0) return;

  const activeNavBtn = document.querySelector('.nav-btn.active');
  const activeViewId = activeNavBtn ? activeNavBtn.getAttribute('data-view') : null;

  let targetDropZoneId = window._lastDropZoneId;

  if (activeViewId === 'view-pdf') {
    targetDropZoneId = 'pdf-dropzone';
  } else if (activeViewId === 'view-csv') {
    const file = paths[0];
    if (file && file.toLowerCase().endsWith('.csv')) {
      targetDropZoneId = 'csv-input-container';
    } else {
      targetDropZoneId = 'csv-dest-container';
    }
  } else if (activeViewId === 'view-sorting') {
    const file = paths[0];
    if (file && file.toLowerCase().endsWith('.csv')) {
      targetDropZoneId = 'sort-mapping-container';
    } else {
      targetDropZoneId = 'sort-root-container';
    }
  } else if (activeViewId === 'view-inventory') {
    targetDropZoneId = 'inv-drive-container';
  }

  if (targetDropZoneId) {
    const callback = window._dropCallbacks[targetDropZoneId];
    if (callback) {
      callback(paths);
    }
    window._lastDropZoneId = null;
  }
};


// ==============================================================================
// GITHUB AUTO UPDATE CONTROLLER  (Push-model + 7-state machine)
// ==============================================================================

// Holds the latest manifest received from either silent check or manual check
window._latestUpdateInfo = null;

// Current update UI state: idle | checking | available | downloading | ready | uptodate | error
window._updateState = 'idle';

/**
 * _setUpdateState — drives the Settings page update button through all 7 states.
 * @param {string} state
 * @param {object} [opts]  Optional extra data (version string, error message)
 */
window._setUpdateState = function(state, opts = {}) {
  window._updateState = state;
  const btn       = document.getElementById('btn-settings-check-updates');
  const statusEl  = document.getElementById('settings-update-status');
  const progressEl = document.getElementById('settings-update-progress-row');

  if (!btn) return;

  // Reset common classes
  btn.disabled = false;

  const icons = {
    idle:        `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
    checking:    `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="animation:rotate 1s linear infinite"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>`,
    available:   `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
    downloading: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="animation:rotate 1s linear infinite"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>`,
    ready:       `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
    uptodate:    `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
    error:       `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
  };

  const labels = {
    idle:        'Check for Updates Now',
    checking:    'Checking...',
    available:   `Update v${opts.version || ''} Available — View Details`,
    downloading: `Downloading...`,
    ready:       'Install Now & Restart',
    uptodate:    `Up to Date (v${opts.version || ''})`,
    error:       'Retry Check',
  };

  const colors = {
    idle:        '',
    checking:    'var(--accent-blue)',
    available:   '#10b981',
    downloading: 'var(--accent-blue)',
    ready:       '#059669',
    uptodate:    '#6b7280',
    error:       '#dc2626',
  };

  btn.innerHTML = `${icons[state] || ''}<span>${labels[state] || state}</span>`;
  if (colors[state]) btn.style.background = colors[state];
  else btn.style.background = '';

  if (state === 'checking' || state === 'downloading') {
    btn.disabled = true;
  }

  if (statusEl) {
    const statusMsgs = {
      idle:        '',
      checking:    'Connecting to GitHub...',
      available:   `🚀 New version v${opts.version || ''} is available.`,
      downloading: `⬇️ Downloading update...`,
      ready:       '✅ Download complete. Ready to install.',
      uptodate:    `✅ You are on the latest version.`,
      error:       `⚠️ ${opts.error || 'Update check failed.'}`,
    };
    statusEl.textContent = statusMsgs[state] || '';
    statusEl.style.color = colors[state] || 'var(--text-muted)';
  }

  if (progressEl) {
    progressEl.classList.toggle('hidden', state !== 'downloading');
  }
};

/**
 * PUSH MODEL — called by Python (via window.evaluate_js) when the silent
 * startup check finds a newer version. The renderer reacts passively;
 * no user action is needed to trigger this.
 */
window.onUpdateAvailable = function(manifest) {
  window._latestUpdateInfo = manifest;
  window._setUpdateState('available', { version: manifest.latest_version });

  const badge = document.getElementById('update-nav-badge');
  if (badge) badge.classList.remove('hidden');

  // Show passive banner with action buttons
  window.showToast(
    `✨ <strong>New Update Available (v${manifest.latest_version})!</strong>`,
    'update',
    0,
    [
      { text: 'View Notes', primary: false, keepOpen: false, onClick: () => window.openUpdateModal() },
      { text: 'Update Now', primary: true,  keepOpen: false, onClick: () => window.downloadUpdate(manifest.download_url) },
    ]
  );
};

/**
 * MANUAL CHECK — triggered by user clicking "Check for Updates" in Settings.
 * Drives the full state machine: idle → checking → available/uptodate/error.
 */
window.checkForUpdates = async function(isManual = false) {
  if (!window.pywebview || !window.pywebview.api || !window.pywebview.api.check_for_updates) {
    if (isManual) window.showToast('Updater service initializing… Please try again.', 'warning');
    return;
  }

  // If we already have a cached update, just open the modal
  if (isManual && window._latestUpdateInfo && window._latestUpdateInfo.update_available) {
    window.openUpdateModal();
    return;
  }

  window._setUpdateState('checking');
  if (isManual) window.showToast('Checking GitHub for updates…', 'info', 2500);

  try {
    const rawRes = await window.pywebview.api.check_for_updates();
    const res = (typeof rawRes === 'string') ? JSON.parse(rawRes) : rawRes;

    if (res && res.success && res.data) {
      const data = res.data;
      window._latestUpdateInfo = data;

      if (data.update_available) {
        window.onUpdateAvailable(data);
      } else {
        window._setUpdateState('uptodate', { version: data.current_version });
        if (isManual) {
          window.showToast(`✅ You are running the latest version (v${data.current_version}).`, 'success');
        }
      }
    } else {
      window._setUpdateState('error', { error: 'Unexpected response from update server.' });
    }
  } catch (err) {
    console.error('[Update] Check error:', err);
    window._setUpdateState('error', { error: 'Network error while checking for updates.' });
    if (isManual) window.showToast('⚠️ Failed to check for updates from GitHub.', 'error');
  }
};

window.openUpdateModal = function() {
  const modal = document.getElementById('update-modal');
  const tag   = document.getElementById('update-modal-version-tag');
  const notes = document.getElementById('update-modal-notes');
  const data  = window._latestUpdateInfo;

  if (modal) {
    if (tag   && data) tag.textContent   = `Version ${data.latest_version} Ready`;
    if (notes && data) notes.textContent = data.release_notes || 'Bug fixes and performance enhancements.';
    modal.classList.remove('hidden');
  }
};

window.closeUpdateModal = function() {
  const modal = document.getElementById('update-modal');
  if (modal) modal.classList.add('hidden');
};

window.downloadUpdate = async function(downloadUrl = '') {
  if (!window.pywebview || !window.pywebview.api || !window.pywebview.api.download_and_install_update) {
    window.showToast('Updater backend not ready.', 'error');
    return;
  }

  // Resolve URL from cached manifest if not supplied
  if (!downloadUrl && window._latestUpdateInfo) {
    downloadUrl = window._latestUpdateInfo.download_url || '';
  }

  // Show progress box inside modal
  const progressBox = document.getElementById('update-modal-progress-container');
  if (progressBox) progressBox.classList.remove('hidden');

  window._setUpdateState('downloading');
  window.showToast('⬇️ Starting download from GitHub repository…', 'info', 0);

  try {
    const rawRes = await window.pywebview.api.download_and_install_update(downloadUrl);
    const res = (typeof rawRes === 'string') ? JSON.parse(rawRes) : rawRes;
    if (res && res.error) {
      window._setUpdateState('error', { error: res.error });
      window.showToast(`Update error: ${res.error}`, 'error');
    }
    // Actual completion is signalled by window.onUpdateReadyToInstall() push
  } catch (err) {
    console.error('[Update] Download error:', err);
    window._setUpdateState('error', { error: 'Download failed. Please retry.' });
    window.showToast('⚠️ Error initiating update download.', 'error');
  }
};

// Progress callback — called by Python AutoUpdater via evaluate_js (throttled to 350ms)
window.onUpdateDownloadProgress = function(percent, downloadedBytes, totalBytes, speedKb) {
  const mbDownloaded = (downloadedBytes / 1_048_576).toFixed(1);
  const mbTotal      = totalBytes > 0 ? (totalBytes / 1_048_576).toFixed(1) : '?';
  const speedStr     = speedKb > 1024 ? `${(speedKb / 1024).toFixed(1)} MB/s` : `${speedKb.toFixed(0)} KB/s`;

  // Update modal progress bar
  const pctText  = document.getElementById('update-progress-pct-text');
  const fill     = document.getElementById('update-progress-bar-fill');
  const bytesEl  = document.getElementById('update-progress-bytes');
  const speedEl  = document.getElementById('update-progress-speed');

  if (pctText) pctText.textContent = `${percent}%`;
  if (fill)    fill.style.width    = `${percent}%`;
  if (bytesEl) bytesEl.textContent = `${mbDownloaded} MB / ${mbTotal} MB`;
  if (speedEl) speedEl.textContent = speedStr;

  // Update Settings progress bar if present
  const settingsFill = document.getElementById('settings-update-bar-fill');
  const settingsPct  = document.getElementById('settings-update-bar-pct');
  if (settingsFill) settingsFill.style.width = `${percent}%`;
  if (settingsPct)  settingsPct.textContent  = `${percent}%`;

  window.showToast(
    `⬇️ <strong>Downloading Update… ${percent}%</strong> (${mbDownloaded} MB / ${mbTotal} MB @ ${speedStr})`,
    'info', 0
  );
};

// Push from Python: download complete, installer is ready
window.onUpdateReadyToInstall = function(installerPath, pid) {
  window._setUpdateState('ready');
  window.showToast(
    `🚀 <strong>Download complete!</strong> Click <strong>Install Now & Restart</strong> to apply the update.`,
    'update', 0
  );

  // Update the modal button to install
  const startBtn = document.getElementById('btn-start-update');
  if (startBtn) {
    startBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg><span>Install Now & Restart</span>`;
    startBtn.onclick = async () => {
      window.showToast('🔄 Launching installer & restarting app…', 'info', 0);
      try {
        if (window.pywebview && window.pywebview.api && window.pywebview.api.apply_update_now) {
          await window.pywebview.api.apply_update_now();
        }
      } catch (e) {
        console.error("[Update] Apply error:", e);
      }
    };
  }
};

// Push from Python: download or install error
window.onUpdateError = function(err) {
  window._setUpdateState('error', { error: err });
  window.showToast(`⚠️ Update Error: ${err}`, 'error', 7000);
};

// ---------------------------------------------------------------------------
// SETTINGS AUTO-CHECK TOGGLE helpers
// ---------------------------------------------------------------------------

window.loadAutoCheckSetting = async function() {
  try {
    if (window.pywebview && window.pywebview.api && window.pywebview.api.get_setting) {
      const raw = await window.pywebview.api.get_setting('auto_check_updates');
      const res = (typeof raw === 'string') ? JSON.parse(raw) : raw;
      const val = res.value;
      // Defaults to true if undefined
      const enabled = (val === null || val === undefined) ? true : Boolean(val);
      const toggle = document.getElementById('toggle-auto-check-updates');
      if (toggle) {
        toggle.checked = enabled;
        // Sync visuals only — do NOT dispatch change (avoids re-saving on load)
        if (window._syncToggleVisual) window._syncToggleVisual(enabled);
      }
    }
  } catch (e) {
    console.warn('[Update] loadAutoCheckSetting:', e);
  }
};

window.saveAutoCheckSetting = async function(enabled) {
  try {
    if (window.pywebview && window.pywebview.api && window.pywebview.api.set_setting) {
      await window.pywebview.api.set_setting('auto_check_updates', enabled);
    }
  } catch (e) {
    console.warn('[Update] saveAutoCheckSetting:', e);
  }
};

// ---------------------------------------------------------------------------
// UI BINDINGS (DOMContentLoaded)
// ---------------------------------------------------------------------------

window.setAppTheme = function(themeId) {
  if (themeId !== 'dark' && themeId !== 'light') themeId = 'dark';
  localStorage.setItem('ain53_theme', themeId);
  document.documentElement.setAttribute('data-theme', themeId);

  const darkCard  = document.getElementById('theme-card-dark');
  const lightCard = document.getElementById('theme-card-light');
  if (darkCard && lightCard) {
    if (themeId === 'dark') {
      darkCard.style.border  = '2px solid #10b981';
      lightCard.style.border = '1px solid var(--border-glass)';
      darkCard.querySelector('.theme-check-icon')?.classList.remove('hidden');
      lightCard.querySelector('.theme-check-icon')?.classList.add('hidden');
    } else {
      lightCard.style.border = '2px solid #10b981';
      darkCard.style.border  = '1px solid var(--border-glass)';
      lightCard.querySelector('.theme-check-icon')?.classList.remove('hidden');
      darkCard.querySelector('.theme-check-icon')?.classList.add('hidden');
    }
  }
};

window.loadAppVersion = async function() {
  try {
    if (window.pywebview && window.pywebview.api && window.pywebview.api.get_app_version) {
      const rawRes = await window.pywebview.api.get_app_version();
      const res = (typeof rawRes === 'string') ? JSON.parse(rawRes) : rawRes;
      if (res && res.version) {
        const vFormatted = `v ${res.version}`;
        document.querySelectorAll('.app-version-tag').forEach(el => { el.textContent = vFormatted; });
      }
    }
  } catch (err) {
    console.warn('[App] Load version error:', err);
  }
};

window.openLightbox = function(filePath, fileName = '', isVideo = false) {
  const modal = document.getElementById('lightbox-modal');
  const img   = document.getElementById('lightbox-img');
  const video = document.getElementById('lightbox-video');
  const title = document.getElementById('lightbox-title');
  const path  = document.getElementById('lightbox-path');
  if (!modal) return;
  if (title) title.textContent = fileName || 'Media Preview';
  if (path)  path.textContent  = filePath || '';
  const cleanPath = filePath.replace(/\\/g, '/');
  const src = cleanPath.startsWith('file://') ? cleanPath : `file:///${cleanPath}`;
  if (isVideo) {
    if (img)   img.classList.add('hidden');
    if (video) { video.src = src; video.classList.remove('hidden'); video.play().catch(() => {}); }
  } else {
    if (video) { video.pause(); video.classList.add('hidden'); }
    if (img)   { img.src = src; img.classList.remove('hidden'); }
  }
  modal.classList.remove('hidden');
};

window.closeLightbox = function() {
  const modal = document.getElementById('lightbox-modal');
  const video = document.getElementById('lightbox-video');
  if (video) video.pause();
  if (modal) modal.classList.add('hidden');
};

document.addEventListener('DOMContentLoaded', () => {
  // Restore theme
  const savedTheme = localStorage.getItem('ain53_theme') || 'dark';
  window.setAppTheme(savedTheme);

  // Load version from Python
  window.loadAppVersion();

  // Load auto-check toggle state from Python settings store
  window.loadAutoCheckSetting();

  // ── Update UI button bindings ──
  const btnSettingsCheckUpdates = document.getElementById('btn-settings-check-updates');
  const btnStartUpdate          = document.getElementById('btn-start-update');
  const btnUpdateLater          = document.getElementById('btn-update-later');
  const btnCloseModal           = document.getElementById('btn-close-update-modal');
  const themeCardDark           = document.getElementById('theme-card-dark');
  const themeCardLight          = document.getElementById('theme-card-light');
  const btnCloseLightbox        = document.getElementById('btn-close-lightbox');
  const lightboxModal           = document.getElementById('lightbox-modal');
  const autoCheckToggle         = document.getElementById('toggle-auto-check-updates');

  // Settings check button — state-aware handler
  if (btnSettingsCheckUpdates) {
    btnSettingsCheckUpdates.addEventListener('click', () => {
      const state = window._updateState;
      if (state === 'available') {
        window.openUpdateModal();
      } else if (state === 'ready') {
        // Download already done — Python will call os._exit when installer is launched
        // Just show the modal so user sees Install Now button
        window.openUpdateModal();
      } else if (state === 'downloading') {
        // Ignore clicks while downloading
      } else {
        window.checkForUpdates(true);
      }
    });
  }

  if (themeCardDark)  themeCardDark.addEventListener('click',  () => window.setAppTheme('dark'));
  if (themeCardLight) themeCardLight.addEventListener('click', () => window.setAppTheme('light'));

  if (btnStartUpdate) {
    btnStartUpdate.addEventListener('click', () => {
      if (window._updateState === 'ready') {
        window.showToast('🔄 Launching installer… App will restart.', 'info', 0);
        return; // Installer already spawned by Python
      }
      const url = window._latestUpdateInfo ? window._latestUpdateInfo.download_url : '';
      window.downloadUpdate(url);
    });
  }

  if (btnUpdateLater) btnUpdateLater.addEventListener('click', () => window.closeUpdateModal());
  if (btnCloseModal)  btnCloseModal.addEventListener('click',  () => window.closeUpdateModal());
  if (btnCloseLightbox) btnCloseLightbox.addEventListener('click', () => window.closeLightbox());

  if (lightboxModal) {
    lightboxModal.addEventListener('click', e => {
      if (e.target === lightboxModal) window.closeLightbox();
    });
  }

  if (autoCheckToggle) {
    // Expose visual sync helper globally so loadAutoCheckSetting can call it
    window._syncToggleVisual = (checked) => {
      const track = document.getElementById('auto-check-track');
      const thumb = document.getElementById('auto-check-thumb');
      const lbl   = document.getElementById('auto-check-label');
      if (track) track.style.background = checked ? '#10b981' : 'rgba(156,163,175,0.4)';
      if (thumb) thumb.style.transform  = checked ? 'translateX(20px)' : 'translateX(0)';
      if (lbl)   lbl.textContent        = checked ? 'Enabled' : 'Disabled';
    };
    // Sync visual on load
    window._syncToggleVisual(autoCheckToggle.checked);

    autoCheckToggle.addEventListener('change', () => {
      window._syncToggleVisual(autoCheckToggle.checked);
      window.saveAutoCheckSetting(autoCheckToggle.checked);
      window.showToast(
        autoCheckToggle.checked
          ? '🔔 Auto-check for updates <strong>enabled</strong>.'
          : '🔕 Auto-check for updates <strong>disabled</strong>.',
        'info', 3000
      );
    });
  }

  window.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      window.closeLightbox();
      window.closeUpdateModal();
    }
  });

  // NOTE: The startup silent update check is now driven by Python's
  // silent_check_and_push() (4-second delay from main.py set_window).
  // Python calls window.onUpdateAvailable() via evaluate_js — fully passive.
});

