// ── Universal API Bridge: Seamlessly supports PyWebView + Standard Web Browsers (Chrome/Edge/Firefox) ──
(function initUniversalApiBridge() {
  if (typeof window === 'undefined') return;

  const getApiEndpoint = (method) => {
    if (window.location.protocol === 'http:' || window.location.protocol === 'https:') {
      return `/api/${String(method)}`;
    }
    const port = window.AIN53_SERVER_PORT || 5353;
    return `http://127.0.0.1:${port}/api/${String(method)}`;
  };

  const createHttpProxy = (baseObj) => {
    return new Proxy(baseObj, {
      get(target, prop) {
        if (prop in target) return target[prop];
        if (window._nativePywebviewApi && typeof window._nativePywebviewApi[prop] === 'function') {
          return window._nativePywebviewApi[prop];
        }
        return async function(...args) {
          try {
            const res = await fetch(getApiEndpoint(prop), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ args: args })
            });
            return await res.text();
          } catch (err) {
            console.error(`[API Bridge HTTP] Call failed for ${String(prop)}:`, err);
            return JSON.stringify({ error: err.message });
          }
        };
      }
    });
  };

  window.addEventListener('pywebviewready', () => {
    if (window.pywebview && window.pywebview.api && !window.pywebview.api.__isProxy) {
      window._nativePywebviewApi = window.pywebview.api;
      if (typeof window.restoreAllAppSettings === 'function') {
        window.restoreAllAppSettings();
      }
    }
  });

  if (!window.pywebview) {
    const proxy = createHttpProxy({});
    proxy.__isProxy = true;
    window.pywebview = { api: proxy };
  } else if (!window.pywebview.api || Object.keys(window.pywebview.api).length === 0) {
    const proxy = createHttpProxy(window.pywebview.api || {});
    proxy.__isProxy = true;
    window.pywebview.api = proxy;
  }
})();

// ── App Edition Initializer (Standard Client UI) ──
window.initEditionFeatures = function() {
  document.body.classList.add('is-standard-edition');
  document.body.classList.remove('is-admin-edition');
};

// ── Register Ctrl+R & F5 Refresh Hotkeys (Direct & Universal Bridge) ──
window.reloadApp = function() {
  try {
    if (typeof window.resetMediaSortingState === 'function') {
      window.resetMediaSortingState();
    }
  } catch (err) {}
  try {
    window.location.reload();
  } catch (e) {
    try {
      window.location.href = window.location.href;
    } catch (e2) {
      if (window.pywebview && window.pywebview.api && window.pywebview.api.reload_app) {
        window.pywebview.api.reload_app();
      }
    }
  }
};

function handleReloadShortcut(e) {
  const isCtrl = e.ctrlKey || e.metaKey;
  const isR = e.key === 'r' || e.key === 'R' || e.code === 'KeyR' || e.keyCode === 82 || e.which === 82;
  const isF5 = e.key === 'F5' || e.code === 'F5' || e.keyCode === 116 || e.which === 116;

  if ((isCtrl && isR) || isF5) {
    try {
      e.preventDefault();
      e.stopPropagation();
    } catch (err) {}
    window.reloadApp();
  }
}

window.addEventListener('keydown', handleReloadShortcut, true);
document.addEventListener('keydown', handleReloadShortcut, true);
if (document.documentElement) {
  document.documentElement.addEventListener('keydown', handleReloadShortcut, true);
}

// ── Chrome-Style UI Zoom Controller (Ctrl + +, Ctrl + -, Ctrl + 0, Ctrl + Wheel) ──
(function initZoomController() {
  const ZOOM_STEPS = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.75, 2.0];
  
  // Default UI zoom is 80% (0.8) as requested
  if (!localStorage.getItem('app_zoom_default_v80')) {
    localStorage.setItem('app_zoom_default_v80', '1');
    localStorage.setItem('app_zoom_level', '0.8');
  }

  let currentZoom = parseFloat(localStorage.getItem('app_zoom_level')) || 0.8;
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
      badge.style.background = 'var(--bg-glass-card)';
      badge.style.color = 'var(--accent-blue)';
      badge.style.border = '1px solid var(--border-glass-hover)';
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
    const sideText = document.getElementById('sidebar-zoom-level-text');
    if (sideText) {
      sideText.innerText = `${Math.round(currentZoom * 100)}%`;
    }
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
    applyZoom(0.8);
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

    const key = e.key ? e.key.toLowerCase() : '';
    const code = e.code || '';
    const keyCode = e.keyCode || e.which || 0;

    // Zoom In: Ctrl + '+' or '=' or NumpadAdd or KeyCode 187/107/61
    const isZoomIn = (
      key === '+' || key === '=' || key === 'add' ||
      code === 'Equal' || code === 'NumpadAdd' ||
      keyCode === 187 || keyCode === 107 || keyCode === 61 ||
      (e.shiftKey && (key === '=' || keyCode === 187))
    );

    // Zoom Out: Ctrl + '-' or '_' or NumpadSubtract or KeyCode 189/109/173
    const isZoomOut = (
      key === '-' || key === '_' || key === 'subtract' ||
      code === 'Minus' || code === 'NumpadSubtract' ||
      keyCode === 189 || keyCode === 109 || keyCode === 173
    );

    // Zoom Reset: Ctrl + '0' or Numpad0 or KeyCode 48/96
    const isZoomReset = (
      key === '0' ||
      code === 'Digit0' || code === 'Numpad0' ||
      keyCode === 48 || keyCode === 96
    );

    if (isZoomIn) {
      e.preventDefault();
      e.stopPropagation();
      zoomIn();
    } else if (isZoomOut) {
      e.preventDefault();
      e.stopPropagation();
      zoomOut();
    } else if (isZoomReset) {
      e.preventDefault();
      e.stopPropagation();
      resetZoom();
    }
  }, { passive: false, capture: true });

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
  }, { passive: false, capture: true });

  // Expose global zoom helpers
  window.appZoomIn = zoomIn;
  window.appZoomOut = zoomOut;
  window.appResetZoom = resetZoom;
  window.appApplyZoom = applyZoom;
})();

function initAppNavigation() {
  const navBtns = document.querySelectorAll('.nav-btn');
  const views = document.querySelectorAll('.view-panel, .view-section');
  const contentArea = document.querySelector('.content-area');

  const viewTitles = {
    'view-pdf': 'PDF to CSV',
    'view-events': 'Event Creation',
    'view-csv': 'CSV to Folders',
    'view-sorting': 'Media Sorting',
    'view-inventory': 'Drive Inventory',
    'view-inventory-mapper': 'Inventory Mapper',
    'view-settings': 'Settings'
  };

  function activateView(viewId) {
    if (!viewId) return;

    try {
      localStorage.setItem('ain53_active_view', viewId);
    } catch (e) {}

    // Synchronize active state across desktop sidebar
    navBtns.forEach(b => {
      if (b.getAttribute('data-view') === viewId) b.classList.add('active');
      else b.classList.remove('active');
    });

    // Hide all view sections, show target section
    views.forEach(v => v.classList.add('hidden'));
    const targetView = document.getElementById(viewId);
    if (targetView) targetView.classList.remove('hidden');

    // Refresh / trigger hooks when activating specific views
    if (viewId === 'view-sorting') {
      const sortMap = window.getSortingMappingPath ? window.getSortingMappingPath() : null;
      const sortRt = window.getSortingRootPath ? window.getSortingRootPath() : null;
      const csvIn = window.getCsvInputPath ? window.getCsvInputPath() : null;
      const csvDst = window.getCsvDestPath ? window.getCsvDestPath() : null;

      if (!sortMap && csvIn && window.setSortingMappingPath) {
        window.setSortingMappingPath(csvIn, false);
      }
      if (!sortRt && csvDst && window.setSortingRootPath) {
        window.setSortingRootPath(csvDst, false);
      }
      setTimeout(() => {
        if (window.updateSortingScrollBtn) window.updateSortingScrollBtn();
        if (window.updateFloatingSelectionBar) window.updateFloatingSelectionBar();
      }, 50);
    } else {
      const floatBar = document.getElementById('floating-selection-bar');
      if (floatBar) {
        floatBar.classList.add('hidden');
        floatBar.style.display = 'none';
      }
    }
    if (viewId === 'view-csv') {
      const sortMap = window.getSortingMappingPath ? window.getSortingMappingPath() : null;
      const sortRt = window.getSortingRootPath ? window.getSortingRootPath() : null;
      const csvIn = window.getCsvInputPath ? window.getCsvInputPath() : null;
      const csvDst = window.getCsvDestPath ? window.getCsvDestPath() : null;

      if (!csvIn && sortMap && window.setCsvInputPath) {
        window.setCsvInputPath(sortMap, false);
      }
      if (!csvDst && sortRt && window.setCsvDestPath) {
        window.setCsvDestPath(sortRt, false);
      }
    } else if (viewId === 'view-events') {
      if (window.refreshEventsView && typeof window.refreshEventsView === 'function') {
        window.refreshEventsView();
      }
    }

    // Update header title in ReactController
    if (window.ReactController && viewTitles[viewId]) {
      window.ReactController.setActiveTitle(viewTitles[viewId]);
    }

    // Keep content-area scrollable across all views
    if (contentArea) {
      contentArea.style.overflowY = 'auto';
    }
  }

  window.switchNavToView = function(viewId) {
    activateView(viewId);
  };

  navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      activateView(btn.getAttribute('data-view'));
    });
  });

  // Sidebar Collapse / Expand Toggle Feature
  const sidebar = document.getElementById('app-sidebar') || document.querySelector('.sidebar');
  const collapseToggleBtn = document.getElementById('sidebar-collapse-toggle');

  function setSidebarCollapsed(collapsed) {
    if (!sidebar) return;
    if (collapsed) {
      sidebar.classList.add('collapsed');
      if (collapseToggleBtn) {
        collapseToggleBtn.title = 'Expand navigation (Ctrl+[)';
        collapseToggleBtn.setAttribute('aria-expanded', 'false');
      }
      localStorage.setItem('ain53_sidebar_collapsed', 'true');
    } else {
      sidebar.classList.remove('collapsed');
      if (collapseToggleBtn) {
        collapseToggleBtn.title = 'Collapse navigation (Ctrl+[)';
        collapseToggleBtn.setAttribute('aria-expanded', 'true');
      }
      localStorage.setItem('ain53_sidebar_collapsed', 'false');
    }
  }

  function toggleSidebarCollapse() {
    if (!sidebar) return;
    const isCollapsed = sidebar.classList.contains('collapsed');
    setSidebarCollapsed(!isCollapsed);
  }

  if (collapseToggleBtn) {
    collapseToggleBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleSidebarCollapse();
    });
  }

  // Restore saved collapsed state
  const savedCollapsed = localStorage.getItem('ain53_sidebar_collapsed');
  if (savedCollapsed === 'true') {
    setSidebarCollapsed(true);
  }

  // Keyboard shortcut: Ctrl+[ or Ctrl+\ to toggle sidebar
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === '[' || e.key === '\\')) {
      e.preventDefault();
      toggleSidebarCollapse();
    }
  });

  window.toggleSidebar = toggleSidebarCollapse;

  // Restore saved theme on startup
  const savedTheme = localStorage.getItem('ain53_theme') || 'light';
  window.setAppTheme(savedTheme);

  // Load app version from backend
  window.loadAppVersion();
  if (typeof window.initEditionFeatures === 'function') {
    window.initEditionFeatures();
  }

  // Handle URL Hash Navigation or restore saved view from localStorage (e.g. #view-sorting)
  const savedView = localStorage.getItem('ain53_active_view');
  const hash = window.location.hash ? window.location.hash.substring(1) : '';
  const initialView = hash || savedView;
  if (initialView && document.getElementById(initialView)) {
    setTimeout(() => window.switchNavToView(initialView), 120);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAppNavigation);
} else {
  initAppNavigation();
}

// Enhanced Utility to show rich toast notifications (success, error, warning, info, progress, actions)
window.showToast = function(msg, type = 'success', duration = 4000, actionButtons = null) {
  let toast = document.getElementById('toast');
  if (!toast) return;

  if (window._toastTimeout) {
    clearTimeout(window._toastTimeout);
    window._toastTimeout = null;
  }

  toast.innerHTML = '';
  toast.removeAttribute('style');

  let typeClass = 'success';
  let mainColor = '#10b981';
  let iconSVG = '<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>';

  if (type === 'error' || type === true) {
    typeClass = 'error';
    mainColor = '#f43f5e';
    iconSVG = '<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 7.5h.008v.008H12v-.008z"/></svg>';
  } else if (type === 'warning') {
    typeClass = 'warning';
    mainColor = '#f59e0b';
    iconSVG = '<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 18.75h.007v.008H12v-.008z"/></svg>';
  } else if (type === 'info' || type === 'update') {
    typeClass = 'info';
    mainColor = '#38bdf8';
    iconSVG = '<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z"/></svg>';
  }

  toast.className = `toast toast-${typeClass}`;

  const iconBadge = document.createElement('div');
  iconBadge.className = 'toast-icon-badge';
  iconBadge.innerHTML = iconSVG;

  const progressBar = document.createElement('div');
  progressBar.className = 'toast-progress-bar';
  progressBar.style.background = mainColor;

  const textNode = document.createElement('div');
  textNode.className = 'toast-message-content';
  textNode.innerHTML = msg;

  toast.appendChild(iconBadge);
  toast.appendChild(textNode);

  if (actionButtons && Array.isArray(actionButtons)) {
    const btnContainer = document.createElement('div');
    btnContainer.className = 'toast-actions-container';

    const isLight = document.body.getAttribute('data-theme') === 'light' || (!document.body.classList.contains('dark-theme') && !document.documentElement.classList.contains('dark'));

    actionButtons.forEach(btnConfig => {
      const btn = document.createElement('button');
      btn.textContent = btnConfig.text;
      btn.className = 'toast-action-btn' + (btnConfig.primary ? ' toast-action-primary' : ' toast-action-secondary');
      btn.style.padding = '6px 14px';
      btn.style.borderRadius = '99px';
      btn.style.fontWeight = '700';
      btn.style.fontSize = '0.82rem';
      btn.style.cursor = 'pointer';
      btn.style.fontFamily = 'Outfit, sans-serif';
      btn.style.whiteSpace = 'nowrap';
      btn.style.transition = 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)';
      if (btnConfig.primary) {
        btn.style.background = mainColor;
        btn.style.color = '#ffffff';
        btn.style.border = 'none';
        btn.style.boxShadow = `0 4px 14px ${mainColor}55`;
      } else {
        btn.style.background = isLight ? 'rgba(0, 0, 0, 0.07)' : 'rgba(255, 255, 255, 0.14)';
        btn.style.color = isLight ? '#0f172a' : '#f8fafc';
        btn.style.border = isLight ? '1px solid rgba(0, 0, 0, 0.16)' : '1px solid rgba(255, 255, 255, 0.22)';
        btn.style.boxShadow = 'none';
      }
      btn.onmouseenter = () => { btn.style.transform = 'translateY(-1px) scale(1.04)'; };
      btn.onmouseleave = () => { btn.style.transform = 'none'; };
      btn.onmousedown = () => { btn.style.transform = 'scale(0.96)'; };
      btn.onclick = (evt) => {
        evt.stopPropagation();
        if (btnConfig.onClick) btnConfig.onClick();
        if (!btnConfig.keepOpen) window.hideToast();
      };
      btnContainer.appendChild(btn);
    });
    toast.appendChild(btnContainer);
  }

  // Dismiss button (✕ SVG)
  const closeBtn = document.createElement('button');
  closeBtn.className = 'toast-close-btn';
  closeBtn.innerHTML = '<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>';
  closeBtn.title = 'Dismiss';
  closeBtn.onclick = (e) => {
    e.stopPropagation();
    window.hideToast();
  };
  toast.appendChild(closeBtn);

  // Add bottom progress bar
  toast.appendChild(progressBar);

  toast.classList.remove('hidden', 'toast-hiding');

  // Animate progress bar & auto hide with hover pause support
  if (duration && duration > 0) {
    progressBar.style.transition = `width ${duration}ms linear`;
    requestAnimationFrame(() => {
      progressBar.style.width = '0%';
    });

    let remainingTime = duration;
    let startTime = Date.now();

    const startTimer = () => {
      startTime = Date.now();
      window._toastTimeout = setTimeout(() => {
        window.hideToast();
      }, remainingTime);
    };

    startTimer();

    toast.onmouseenter = () => {
      if (window._toastTimeout) {
        clearTimeout(window._toastTimeout);
        window._toastTimeout = null;
      }
      remainingTime -= (Date.now() - startTime);
      const computedWidth = getComputedStyle(progressBar).width;
      progressBar.style.transition = 'none';
      progressBar.style.width = computedWidth;
    };

    toast.onmouseleave = () => {
      if (remainingTime > 0) {
        progressBar.style.transition = `width ${remainingTime}ms linear`;
        progressBar.style.width = '0%';
        startTimer();
      }
    };
  }
};

window.hideToast = function() {
  let toast = document.getElementById('toast');
  if (!toast || toast.classList.contains('hidden') || toast.classList.contains('toast-hiding')) return;

  if (window._toastTimeout) {
    clearTimeout(window._toastTimeout);
    window._toastTimeout = null;
  }

  toast.classList.add('toast-hiding');
  setTimeout(() => {
    toast.classList.add('hidden');
    toast.classList.remove('toast-hiding');
  }, 280);
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
  if (!window.pywebview || !window.pywebview.api) {
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

  // ── Non-blocking async path ──────────────────────────────────────────────
  // Use check_for_updates_async() which returns {status:'pending'} immediately
  // and pushes the real result via window.onUpdateCheckResult() from a thread.
  // This prevents PyWebView's return-value marshaling from freezing the UI.
  if (window.pywebview.api.check_for_updates_async) {
    // Safety timeout: if Python never responds (network totally unreachable),
    // reset the button after 30s so it doesn't stay stuck in 'checking'.
    if (window._updateCheckTimeout) clearTimeout(window._updateCheckTimeout);
    window._updateCheckTimeout = setTimeout(() => {
      if (window._updateState === 'checking') {
        window._setUpdateState('error', { error: 'Update check timed out. Check your internet connection.' });
        if (isManual) window.showToast('⚠️ Update check timed out.', 'error');
      }
    }, 30000);

    try {
      await window.pywebview.api.check_for_updates_async();
      // Result arrives via window.onUpdateCheckResult() — nothing more to do here.
    } catch (err) {
      if (window._updateCheckTimeout) clearTimeout(window._updateCheckTimeout);
      console.error('[Update] check_for_updates_async call error:', err);
      window._setUpdateState('error', { error: 'Network error while checking for updates.' });
      if (isManual) window.showToast('⚠️ Failed to reach update server.', 'error');
    }
    return;
  }

  // ── Legacy fallback: direct await (only used if async method unavailable) ──
  try {
    const rawRes = await window.pywebview.api.check_for_updates();
    const res = (typeof rawRes === 'string') ? JSON.parse(rawRes) : rawRes;
    window._handleUpdateCheckResult(res, isManual);
  } catch (err) {
    console.error('[Update] Check error:', err);
    window._setUpdateState('error', { error: 'Network error while checking for updates.' });
    if (isManual) window.showToast('⚠️ Failed to check for updates from GitHub.', 'error');
  }
};

/**
 * Push handler — called by Python's check_for_updates_async() via evaluate_js
 * when the background thread finishes the update check.
 */
window.onUpdateCheckResult = function(res) {
  if (window._updateCheckTimeout) {
    clearTimeout(window._updateCheckTimeout);
    window._updateCheckTimeout = null;
  }

  // Determine if the user manually triggered this check (checking state was set by user click)
  const isManual = (window._updateState === 'checking');
  window._handleUpdateCheckResult(res, isManual);
};

/**
 * Shared result handler for both async push and legacy direct-await paths.
 */
window._handleUpdateCheckResult = function(res, isManual) {
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
    window._setUpdateState('error', { error: (res && res.error) || 'Unexpected response from update server.' });
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
    `🚀 <strong>Download complete!</strong> Installing update & restarting app in 2 seconds…`,
    'update', 5000
  );

  // Auto trigger installer after short countdown delay
  setTimeout(async () => {
    try {
      if (window.pywebview && window.pywebview.api && window.pywebview.api.apply_update_now) {
        await window.pywebview.api.apply_update_now();
      }
    } catch (e) {
      console.error("[Update] Auto-apply error:", e);
    }
  }, 1500);

  // Update the modal button to install manually if clicked early
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

window.setAppTheme = function(themeId, skipSaveToBackend = false) {
  if (themeId !== 'dark' && themeId !== 'light') themeId = 'light';

  // 1. Immediate DOM attribute updates
  document.documentElement.setAttribute('data-theme', themeId);
  if (document.body) document.body.setAttribute('data-theme', themeId);
  localStorage.setItem('ain53_theme', themeId);

  // 2. Sync React Header state if ReactController active
  if (window.ReactController) {
    window.ReactController.headerState.theme = themeId;
    if (typeof window.ReactController.renderHeader === 'function') {
      window.ReactController.renderHeader();
    }
  }

  // 3. Sync Settings cards visual state
  const darkCard  = document.getElementById('theme-card-dark');
  const lightCard = document.getElementById('theme-card-light');
  if (darkCard && lightCard) {
    if (themeId === 'dark') {
      darkCard.classList.add('active');
      lightCard.classList.remove('active');
      darkCard.style.border = '';
      darkCard.style.boxShadow = '';
      lightCard.style.border = '';
      lightCard.style.boxShadow = '';
      darkCard.querySelector('.theme-check-icon')?.classList.remove('hidden');
      lightCard.querySelector('.theme-check-icon')?.classList.add('hidden');
    } else {
      lightCard.classList.add('active');
      darkCard.classList.remove('active');
      lightCard.style.border = '';
      lightCard.style.boxShadow = '';
      darkCard.style.border = '';
      darkCard.style.boxShadow = '';
      lightCard.querySelector('.theme-check-icon')?.classList.remove('hidden');
      darkCard.querySelector('.theme-check-icon')?.classList.add('hidden');
    }
  }

  // 4. Persist to Python backend settings store
  if (!skipSaveToBackend) {
    try {
      if (window.pywebview && window.pywebview.api && window.pywebview.api.set_setting) {
        window.pywebview.api.set_setting('app_theme', themeId).catch(e => console.warn('[Theme] Backend save error:', e));
      }
    } catch (e) {
      console.warn('[Theme] Backend save error:', e);
    }
  }
};

window.loadSavedTheme = async function() {
  let theme = localStorage.getItem('ain53_theme') || 'light';
  try {
    if (window.pywebview && window.pywebview.api && window.pywebview.api.get_setting) {
      const raw = await window.pywebview.api.get_setting('app_theme');
      const res = (typeof raw === 'string') ? JSON.parse(raw) : raw;
      if (res && res.value && (res.value === 'dark' || res.value === 'light')) {
        theme = res.value;
      }
    }
  } catch (e) {
    console.warn('[Theme] Backend load error:', e);
  }
  window.setAppTheme(theme, true);
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

window._lightboxState = {
  items: [],
  currentIndex: -1,
  onClose: null,
  requestId: 0
};

window.openLightbox = async function(filePathOrOpts, fileName = '', isVideo = false, items = [], currentIndex = -1, onClose = null) {
  let filePath = filePathOrOpts;
  if (typeof filePathOrOpts === 'object' && filePathOrOpts !== null && !Array.isArray(filePathOrOpts)) {
    filePath = filePathOrOpts.filePath || '';
    fileName = filePathOrOpts.fileName || '';
    isVideo = filePathOrOpts.isVideo || false;
    items = filePathOrOpts.items || [];
    currentIndex = filePathOrOpts.currentIndex !== undefined ? filePathOrOpts.currentIndex : -1;
    onClose = filePathOrOpts.onClose || null;
  }

  // If items provided but currentIndex not set, find it
  if (Array.isArray(items) && items.length > 0) {
    if (currentIndex < 0 || currentIndex >= items.length) {
      const searchTarget = (filePathOrOpts && filePathOrOpts.id) ? filePathOrOpts.id : filePath;
      const foundIdx = items.findIndex(it => (it.id && it.id === searchTarget) || it.path === filePath);
      currentIndex = foundIdx >= 0 ? foundIdx : 0;
    }
  } else if (filePath) {
    // Single item fallback
    items = [{
      path: filePath,
      name: fileName || (filePath ? filePath.split(/[/\\]/).pop() : 'Media Preview'),
      isVideo: isVideo
    }];
    currentIndex = 0;
  }

  window._lightboxState.items = items;
  window._lightboxState.currentIndex = currentIndex;
  window._lightboxState.onClose = onClose;

  const modal = document.getElementById('lightbox-modal');
  if (!modal) return;
  modal.style.display = 'flex';
  modal.classList.remove('hidden');

  await window.renderLightboxCurrentItem();
};

window.renderLightboxCurrentItem = async function() {
  const state = window._lightboxState;
  const modal = document.getElementById('lightbox-modal');
  const img   = document.getElementById('lightbox-img');
  const video = document.getElementById('lightbox-video');
  const title = document.getElementById('lightbox-title');
  const path  = document.getElementById('lightbox-path');
  const icon  = document.getElementById('lightbox-icon');
  const counter = document.getElementById('lightbox-counter');
  const folderBadge = document.getElementById('lightbox-folder-badge');
  const prevBtn = document.getElementById('lightbox-btn-prev');
  const nextBtn = document.getElementById('lightbox-btn-next');
  const meta = document.getElementById('lightbox-meta');

  if (!modal) return;

  const item = (state.items && state.currentIndex >= 0 && state.currentIndex < state.items.length)
    ? state.items[state.currentIndex]
    : null;

  if (!item) return;

  const filePath = item.path || '';
  const fileName = item.name || item.filename || (filePath ? filePath.split(/[/\\]/).pop() : 'Media Preview');
  const isVideo  = item.isVideo || item.is_video || (/\.(mp4|mov|avi|mkv|wmv|mts|m2ts|m4v|webm|flv|3gp)$/i).test(fileName);
  const folderName = item.folderName || '';

  if (title) {
    title.textContent = fileName;
    title.title = fileName;
  }
  if (path)  path.textContent  = filePath;
  if (icon)  icon.textContent  = isVideo ? '🎬' : '🖼️';
  if (meta)  meta.textContent  = isVideo ? 'Video Playback' : 'High-Res View';

  // Counter
  if (counter) {
    if (state.items.length > 1) {
      counter.textContent = `${state.currentIndex + 1} / ${state.items.length}`;
      counter.classList.remove('hidden');
    } else {
      counter.classList.add('hidden');
    }
  }

  // Folder badge
  if (folderBadge) {
    if (folderName) {
      folderBadge.textContent = `📁 ${folderName}`;
      folderBadge.title = `Folder: ${folderName}`;
      folderBadge.classList.remove('hidden');
    } else {
      folderBadge.classList.add('hidden');
    }
  }

  // Prev / Next button states
  if (prevBtn) {
    const hasPrev = state.items.length > 1 && state.currentIndex > 0;
    prevBtn.disabled = !hasPrev;
    prevBtn.classList.toggle('disabled', !hasPrev);
    prevBtn.style.display = state.items.length > 1 ? 'flex' : 'none';
  }
  if (nextBtn) {
    const hasNext = state.items.length > 1 && state.currentIndex < state.items.length - 1;
    nextBtn.disabled = !hasNext;
    nextBtn.classList.toggle('disabled', !hasNext);
    nextBtn.style.display = state.items.length > 1 ? 'flex' : 'none';
  }

  // Increment requestId to avoid race conditions with async raw thumbnail fetching
  const currentReqId = ++state.requestId;

  const ext = (filePath.split('.').pop() || '').toLowerCase();
  const rawExts = ['cr2', 'cr3', 'nef', 'arw', 'dng', 'raf', 'orf', 'pef', 'rw2', 'srw'];
  const isRaw = rawExts.includes(ext);

  if (isVideo) {
    if (img) img.classList.add('hidden');
    if (video) {
      const cleanPath = filePath.replace(/\\/g, '/');
      video.src = cleanPath.startsWith('file://') ? cleanPath : `file:///${cleanPath}`;
      video.classList.remove('hidden');
      video.play().catch(() => {});
    }
  } else {
    if (video) {
      video.pause();
      video.src = '';
      video.classList.add('hidden');
    }
    if (img) {
      img.classList.remove('hidden');
      if (isRaw) {
        // Show cached thumbnail enlarged immediately (0ms Instant!)
        const cached = (window._thumbCache && window._thumbCache[filePath]) ? window._thumbCache[filePath] : '';
        if (cached) {
          img.src = cached;
        } else {
          img.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="%230f172a"/><text x="50%" y="50%" fill="%2338bdf8" dominant-baseline="middle" text-anchor="middle" font-size="16" font-family="sans-serif">Loading Preview…</text></svg>';
        }
        try {
          if (window.pywebview && window.pywebview.api && window.pywebview.api.get_high_res_preview) {
            const b64 = await window.pywebview.api.get_high_res_preview(filePath);
            if (state.requestId === currentReqId && b64) img.src = b64;
          } else if (window.pywebview && window.pywebview.api && window.pywebview.api.generate_thumbnail) {
            const b64 = await window.pywebview.api.generate_thumbnail(filePath);
            if (state.requestId === currentReqId && b64) img.src = b64;
          }
        } catch (e) {
          console.error('[Lightbox] RAW preview fetch error:', e);
        }
      } else {
        const cleanPath = filePath.replace(/\\/g, '/');
        img.src = cleanPath.startsWith('file://') ? cleanPath : `file:///${cleanPath}`;
      }
    }
  }
};

window.navigateLightbox = function(delta) {
  const state = window._lightboxState;
  if (!state.items || state.items.length <= 1) return;
  const newIndex = state.currentIndex + delta;
  if (newIndex >= 0 && newIndex < state.items.length) {
    state.currentIndex = newIndex;
    window.renderLightboxCurrentItem();
  }
};

window.closeLightbox = function() {
  const modal = document.getElementById('lightbox-modal');
  const video = document.getElementById('lightbox-video');
  if (video) {
    video.pause();
    video.src = '';
  }
  if (modal) {
    modal.classList.add('hidden');
    modal.style.display = 'none';
  }

  const state = window._lightboxState;
  if (state.onClose && state.items && state.currentIndex >= 0 && state.currentIndex < state.items.length) {
    const activeItem = state.items[state.currentIndex];
    const cb = state.onClose;
    state.items = [];
    state.currentIndex = -1;
    state.onClose = null;
    try {
      cb(activeItem);
    } catch (err) {
      console.error('[Lightbox] onClose callback error:', err);
    }
  } else {
    state.items = [];
    state.currentIndex = -1;
    state.onClose = null;
  }
};

document.addEventListener('DOMContentLoaded', () => {
  // Restore theme from localStorage and backend
  window.loadSavedTheme();

  // Load version from Python
  window.loadAppVersion();
  if (typeof window.initEditionFeatures === 'function') {
    window.initEditionFeatures();
  }

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

  // Disable "Remind Me Later" while a download is in progress to prevent accidental dismiss
  if (btnUpdateLater) {
    const _origUpdateLater = btnUpdateLater.onclick;
    btnUpdateLater.addEventListener('click', () => {
      if (window._updateState === 'downloading') {
        window.showToast('⏳ Download in progress — please wait.', 'warning', 2500);
        return;
      }
      window.closeUpdateModal();
    }, true);
    // Remove the simple listener added below so we don't double-fire
    btnUpdateLater._laterGuarded = true;
  }

  // btnUpdateLater already guarded above (download-aware handler)
  if (!btnUpdateLater?._laterGuarded) {
    if (btnUpdateLater) btnUpdateLater.addEventListener('click', () => window.closeUpdateModal());
  }
  if (btnCloseModal) {
    btnCloseModal.addEventListener('click', () => {
      if (window._updateState === 'downloading') {
        window.showToast('⏳ Download in progress — please wait before closing.', 'warning', 2500);
        return;
      }
      window.closeUpdateModal();
    });
  }
  const btnPrevLightbox = document.getElementById('lightbox-btn-prev');
  const btnNextLightbox = document.getElementById('lightbox-btn-next');

  if (btnCloseLightbox) btnCloseLightbox.addEventListener('click', () => window.closeLightbox());

  if (btnPrevLightbox) {
    btnPrevLightbox.addEventListener('click', (e) => {
      e.stopPropagation();
      window.navigateLightbox(-1);
    });
  }

  if (btnNextLightbox) {
    btnNextLightbox.addEventListener('click', (e) => {
      e.stopPropagation();
      window.navigateLightbox(1);
    });
  }

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
    const lbModal = document.getElementById('lightbox-modal');
    const isLightboxOpen = lbModal && !lbModal.classList.contains('hidden') && lbModal.style.display !== 'none';

    if (isLightboxOpen) {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        window.navigateLightbox(-1);
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        window.navigateLightbox(1);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        window.closeLightbox();
        return;
      }
    }

    if (e.key === 'Escape') {
      window.closeUpdateModal();
    }
  });

  // ── Working & Downloads Directory Settings Bindings ──
  const btnChangeDownloads = document.getElementById('btn-settings-change-downloads');
  const btnOpenDownloads   = document.getElementById('btn-settings-open-downloads');
  const downloadsInput     = document.getElementById('settings-downloads-path');

  if (downloadsInput) {
    downloadsInput.removeAttribute('readonly');
    downloadsInput.addEventListener('change', async () => {
      const p = downloadsInput.value.trim();
      if (p && window.pywebview && window.pywebview.api && window.pywebview.api.set_setting) {
        await window.pywebview.api.set_setting('pdf_output_folder', p);
        window.showToast(`Working directory updated: ${p}`, 'success');
      }
    });
  }

  // ── Browse Button: Mutex guard to prevent UI freeze & stuck-disabled state ──
  // Python's folder dialog is now non-blocking (runs in a thread). It pushes the
  // result back via window.onFolderSelected(path, callbackId). We register a
  // callback keyed by a unique ID so multiple browse buttons don't conflict.
  window._folderCallbacks = {};
  window._browseInProgress = false;

  window.onFolderSelected = function(folderPath, callbackId) {
    window._browseInProgress = false;
    const cb = window._folderCallbacks[callbackId];
    if (cb) {
      delete window._folderCallbacks[callbackId];
      try { cb(folderPath || null); } catch(e) { console.error('[Browse] Callback error:', e); }
    }
  };

  function _openFolderDialog(callbackFn) {
    if (window._browseInProgress) {
      // If it's been in progress for more than 45 seconds, reset flag
      if (Date.now() - (window._browseStartTime || 0) > 45000) {
        window._browseInProgress = false;
      } else {
        window.showToast('A folder picker is already open.', 'warning', 2000);
        return;
      }
    }
    if (!window.pywebview || !window.pywebview.api || !window.pywebview.api.settings_select_downloads_folder) {
      window.showToast('Folder picker not available.', 'error', 3000);
      return;
    }
    const callbackId = `browse_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    window._folderCallbacks[callbackId] = callbackFn;
    window._browseInProgress = true;
    window._browseStartTime = Date.now();
    // Safety auto-reset after 60 seconds
    setTimeout(() => {
      if (window._folderCallbacks[callbackId]) {
        delete window._folderCallbacks[callbackId];
        window._browseInProgress = false;
      }
    }, 60000);

    // Fire call: Python will launch dialog and notify back
    window.pywebview.api.settings_select_downloads_folder(callbackId).catch(err => {
      console.error('[Browse] dialog error:', err);
      window._browseInProgress = false;
      delete window._folderCallbacks[callbackId];
    });
  }
  window.openFolderDialog = _openFolderDialog;

  if (btnChangeDownloads) {
    btnChangeDownloads.addEventListener('click', () => {
      const originalText = btnChangeDownloads.textContent;
      btnChangeDownloads.disabled = true;
      btnChangeDownloads.textContent = 'Opening...';
      _openFolderDialog((folderPath) => {
        btnChangeDownloads.disabled = false;
        btnChangeDownloads.textContent = originalText;
        if (folderPath) {
          if (downloadsInput) downloadsInput.value = folderPath;
          try {
            localStorage.setItem('ain53_workspace_configured', 'true');
            localStorage.setItem('ain53_workspace_path', folderPath);
          } catch (e) {}
          window.showToast(`Working directory updated: ${folderPath}`, 'success');
        }
      });
    });
  }

  if (btnOpenDownloads) {
    btnOpenDownloads.addEventListener('click', async () => {
      const p = (downloadsInput && downloadsInput.value) ? downloadsInput.value : '';
      if (p && window.pywebview && window.pywebview.api && window.pywebview.api.open_in_explorer) {
        window.pywebview.api.open_in_explorer(p);
      } else {
        window.showToast('No working directory configured yet.', 'warning');
      }
    });
  }


  // ── First-Boot Workspace Setup Modal Controller ──
  const setupModal = document.getElementById('setup-workspace-modal');
  const setupPathInput = document.getElementById('setup-workspace-path');
  const btnSetupBrowse = document.getElementById('btn-setup-browse-workspace');
  const btnSetupConfirm = document.getElementById('btn-setup-confirm-workspace');
  const btnSetupSkip = document.getElementById('btn-setup-skip-workspace');

  window.showFirstBootSetupModal = function() {
    const modal = document.getElementById('setup-workspace-modal') || setupModal;
    if (!modal) return;
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
  };

  window.closeFirstBootSetupModal = function() {
    const modal = document.getElementById('setup-workspace-modal') || setupModal;
    if (!modal) return;
    modal.classList.add('hidden');
    modal.style.display = 'none';
  };

  if (btnSetupBrowse) {
    btnSetupBrowse.addEventListener('click', () => {
      const originalText = btnSetupBrowse.textContent.trim();
      btnSetupBrowse.disabled = true;
      btnSetupBrowse.textContent = 'Opening...';
      _openFolderDialog((folderPath) => {
        btnSetupBrowse.disabled = false;
        btnSetupBrowse.textContent = originalText || 'Browse';
        if (folderPath) {
          if (setupPathInput) setupPathInput.value = folderPath;
          if (downloadsInput) downloadsInput.value = folderPath;
          if (btnSetupConfirm) btnSetupConfirm.disabled = false;
          try {
            localStorage.setItem('ain53_workspace_configured', 'true');
            localStorage.setItem('ain53_workspace_path', folderPath);
          } catch (e) {}
        }
      });
    });
  }

  if (btnSetupConfirm) {
    btnSetupConfirm.addEventListener('click', async () => {
      const p = (setupPathInput ? setupPathInput.value : '').trim();
      if (p) {
        try {
          localStorage.setItem('ain53_workspace_configured', 'true');
          localStorage.setItem('ain53_workspace_path', p);
        } catch (e) {}
        const api = window._nativePywebviewApi || (window.pywebview && window.pywebview.api);
        if (api && api.set_setting) {
          await api.set_setting('pdf_output_folder', p);
          await api.set_setting('workspace_configured', true);
          await api.set_setting('workspace_setup_dismissed', true);
        }
        window.closeFirstBootSetupModal();
        window.showToast(`Workspace directory configured: ${p}`, 'success');
      }
    });
  }

  if (btnSetupSkip) {
    btnSetupSkip.addEventListener('click', async () => {
      try {
        localStorage.setItem('ain53_workspace_configured', 'true');
      } catch (e) {}
      const api = window._nativePywebviewApi || (window.pywebview && window.pywebview.api);
      if (api && api.set_setting) {
        await api.set_setting('workspace_configured', true);
        await api.set_setting('workspace_setup_dismissed', true);
      }
      window.closeFirstBootSetupModal();
      window.showToast('You can configure the working directory anytime in Settings.', 'info');
    });
  }

  // Restore all application paths and settings on launch
  window.restoreAllAppSettings();
});

// ---------------------------------------------------------------------------
// GLOBAL PERSISTENCE RESTORATION CONTROLLER
// ---------------------------------------------------------------------------
window.restoreAllAppSettings = async function() {
  try {
    const isBrowserMode = window.location.protocol === 'http:' || window.location.protocol === 'https:';
    const hasNativeApi = Boolean(window._nativePywebviewApi || (window.pywebview && window.pywebview.api && !window.pywebview.api.__isProxy));

    // In desktop mode (file: protocol), wait until the native PyWebView bridge has initialized
    if (!isBrowserMode && !hasNativeApi) {
      setTimeout(window.restoreAllAppSettings, 150);
      return;
    }

    const api = window._nativePywebviewApi || (window.pywebview && window.pywebview.api);
    if (!api || typeof api.get_all_settings !== 'function') {
      setTimeout(window.restoreAllAppSettings, 150);
      return;
    }

    const raw = await api.get_all_settings();
    let settings = {};
    if (typeof raw === 'string') {
      try {
        settings = JSON.parse(raw);
      } catch (e) {
        settings = {};
      }
    } else if (raw && typeof raw === 'object') {
      settings = raw;
    }

    // If an error object was returned from a failed fetch or backend initializing, retry shortly
    if (settings.error && !settings.pdf_output_folder) {
      console.warn('[Settings] Waiting for backend API to initialize...', settings.error);
      setTimeout(window.restoreAllAppSettings, 300);
      return;
    }

    // Dual-layer state check (settings + localStorage fallback)
    let localConfigured = false;
    let localPath = '';
    try {
      localConfigured = localStorage.getItem('ain53_workspace_configured') === 'true';
      localPath = localStorage.getItem('ain53_workspace_path') || '';
    } catch (e) {}

    const downloadsFolder = settings.pdf_output_folder || (localConfigured ? localPath : '');
    const isConfigured = Boolean(
      settings.workspace_configured ||
      settings.workspace_setup_dismissed ||
      localConfigured ||
      (downloadsFolder && String(downloadsFolder).trim().length > 0)
    );

    const downloadsInput = document.getElementById('settings-downloads-path');
    const setupPathInput = document.getElementById('setup-workspace-path');

    if (downloadsFolder) {
      if (downloadsInput) downloadsInput.value = downloadsFolder;
      if (setupPathInput) setupPathInput.value = downloadsFolder;
      try {
        localStorage.setItem('ain53_workspace_configured', 'true');
        localStorage.setItem('ain53_workspace_path', downloadsFolder);
      } catch (e) {}
    }

    if (isConfigured || (downloadsFolder && String(downloadsFolder).trim().length > 0)) {
      window.closeFirstBootSetupModal();
    } else {
      window.showFirstBootSetupModal();
    }

    // 2. Clear PDF to CSV state on reload so no stale PDF lingers
    if (window.clearPdfState) {
      window.clearPdfState();
    }

    // 3. Restore CSV to Folders paths
    if (settings.csv_input_path && window.setCsvInputPath) {
      window.setCsvInputPath(settings.csv_input_path, false);
    }
    if (settings.csv_dest_path && window.setCsvDestPath) {
      window.setCsvDestPath(settings.csv_dest_path, false);
    }

    // 4. Restore Media Sorting paths & reset view state on reload
    if (settings.sorting_mapping_path && window.setSortingMappingPath) {
      window.setSortingMappingPath(settings.sorting_mapping_path, false);
    }
    if (settings.sorting_root_path && window.setSortingRootPath) {
      window.setSortingRootPath(settings.sorting_root_path, false);
    }
    if (typeof window.resetMediaSortingState === 'function') {
      window.resetMediaSortingState();
    }

    // 5. Restore Drive Inventory paths
    if (settings.inventory_drive_path && window.setInventoryDrivePath) {
      window.setInventoryDrivePath(settings.inventory_drive_path);
    }
    if (settings.inventory_save_path && window.setInventorySavePath) {
      window.setInventorySavePath(settings.inventory_save_path);
    }
  } catch (err) {
    console.warn('[Settings] restoreAllAppSettings error:', err);
  }
};



