// Register Ctrl+R & F5 refresh hotkeys so the UI reloads instantly without app reboot
window.addEventListener('keydown', (e) => {
  const isCtrlR = (e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'r');
  const isF5 = e.key === 'F5';
  if (isCtrlR || isF5) {
    e.preventDefault();
    window.location.reload();
  }
});

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
      btn.style.fontSize = '0.8rem';
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

  update(current, subtitle = null) {
    if (subtitle && this.subtitleEl) this.subtitleEl.textContent = subtitle;
    
    const now = Date.now();
    this.history.push({ time: now, current: current });
    if (this.history.length > 100) this.history.shift();
    
    if (this.total > 0) {
      if (!this.isDeterminateMode) {
        this.switchToDeterminate();
      }
      
      const pct = Math.min(100, Math.floor((current / this.total) * 100));
      this.setProgress(pct);
      if (this.innerText) this.innerText.textContent = `${pct}%`;
      if (this.text) this.text.textContent = `${current} / ${this.total}`;
      
      let calculatedEta = "Almost done...";
      if (this.history.length > 5) {
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
// GITHUB AUTO UPDATE CONTROLLER
// ==============================================================================
window._latestUpdateInfo = null;

window.checkForUpdates = async function(isManual = false) {
  if (!window.pywebview || !window.pywebview.api || !window.pywebview.api.check_for_updates) {
    if (isManual) window.showToast('Updater service initializing... Please try again.', 'warning');
    return;
  }

  if (isManual) window.showToast('Checking GitHub for updates...', 'info', 3000);

  try {
    const rawRes = await window.pywebview.api.check_for_updates();
    const res = (typeof rawRes === 'string') ? JSON.parse(rawRes) : rawRes;

    if (res && res.success && res.data) {
      const data = res.data;
      window._latestUpdateInfo = data;

      if (data.update_available) {
        const badge = document.getElementById('update-nav-badge');
        if (badge) badge.classList.remove('hidden');

        // Show update notification Toast with Action buttons
        window.showToast(
          `✨ <strong>New Update Available (${data.latest_version})!</strong>`,
          'update',
          0,
          [
            {
              text: 'View Notes',
              primary: false,
              onClick: () => window.openUpdateModal()
            },
            {
              text: 'Update Now',
              primary: true,
              onClick: () => window.downloadUpdate(data.download_url)
            }
          ]
        );
      } else {
        if (isManual) {
          window.showToast(`✨ You are running the latest version (${data.current_version}).`, 'success');
        }
      }
    }
  } catch (err) {
    console.error('Check update error:', err);
    if (isManual) window.showToast('Failed to check for updates from GitHub.', 'error');
  }
};

window.openUpdateModal = function() {
  const modal = document.getElementById('update-modal');
  const tag = document.getElementById('update-modal-version-tag');
  const notes = document.getElementById('update-modal-notes');
  const data = window._latestUpdateInfo;

  if (modal) {
    if (tag && data) tag.textContent = `Version ${data.latest_version} Ready`;
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

  const progressBox = document.getElementById('update-modal-progress-container');
  if (progressBox) progressBox.classList.remove('hidden');

  window.showToast('⬇️ Starting download from GitHub repository...', 'info', 0);

  try {
    const rawRes = await window.pywebview.api.download_and_install_update(downloadUrl);
    const res = (typeof rawRes === 'string') ? JSON.parse(rawRes) : rawRes;

    if (res && res.error) {
      window.showToast(`Update error: ${res.error}`, 'error');
    }
  } catch (err) {
    console.error('Download update error:', err);
    window.showToast('Error initiating update download.', 'error');
  }
};

// Progress callback from Python AutoUpdater
window.onUpdateDownloadProgress = function(percent, downloadedBytes, totalBytes, speedKb) {
  const mbDownloaded = (downloadedBytes / (1024 * 1024)).toFixed(1);
  const mbTotal = totalBytes > 0 ? (totalBytes / (1024 * 1024)).toFixed(1) : '?';
  const speedStr = speedKb > 1024 ? `${(speedKb / 1024).toFixed(1)} MB/s` : `${speedKb.toFixed(0)} KB/s`;

  // Update modal progress bar if open
  const pctText = document.getElementById('update-progress-pct-text');
  const fill = document.getElementById('update-progress-bar-fill');
  const bytesText = document.getElementById('update-progress-bytes');
  const speedText = document.getElementById('update-progress-speed');

  if (pctText) pctText.textContent = `${percent}%`;
  if (fill) fill.style.width = `${percent}%`;
  if (bytesText) bytesText.textContent = `${mbDownloaded} MB / ${mbTotal} MB`;
  if (speedText) speedText.textContent = speedStr;

  // Update toast
  window.showToast(
    `⬇️ <strong>Downloading Update... ${percent}%</strong> (${mbDownloaded} MB / ${mbTotal} MB @ ${speedStr})`,
    'info',
    0
  );
};

// Ready to install callback from Python AutoUpdater
window.onUpdateReadyToInstall = function(installerPath, pid) {
  window.showToast(
    `🚀 <strong>Download complete!</strong> Launching silent update installer & restarting application...`,
    'update',
    0
  );
};

// Error callback from Python AutoUpdater
window.onUpdateError = function(err) {
  window.showToast(`⚠️ Update Installation Error: ${err}`, 'error', 6000);
};

window.setAppTheme = function(themeId) {
  if (themeId !== 'dark' && themeId !== 'light') {
    themeId = 'dark';
  }
  localStorage.setItem('ain53_theme', themeId);
  document.documentElement.setAttribute('data-theme', themeId);

  // Update Settings Page Theme Selection Cards
  const darkCard = document.getElementById('theme-card-dark');
  const lightCard = document.getElementById('theme-card-light');

  if (darkCard && lightCard) {
    if (themeId === 'dark') {
      darkCard.style.border = '2px solid #10b981';
      lightCard.style.border = '1px solid var(--border-glass)';
      darkCard.querySelector('.theme-check-icon')?.classList.remove('hidden');
      lightCard.querySelector('.theme-check-icon')?.classList.add('hidden');
    } else {
      lightCard.style.border = '2px solid #10b981';
      darkCard.style.border = '1px solid var(--border-glass)';
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
        document.querySelectorAll('.app-version-tag').forEach(el => {
          el.textContent = vFormatted;
        });
      }
    }
  } catch (err) {
    console.warn('Load app version error:', err);
  }
};

window.openLightbox = function(filePath, fileName = '', isVideo = false) {
  const modal = document.getElementById('lightbox-modal');
  const img = document.getElementById('lightbox-img');
  const video = document.getElementById('lightbox-video');
  const title = document.getElementById('lightbox-title');
  const path = document.getElementById('lightbox-path');

  if (!modal) return;

  if (title) title.textContent = fileName || 'Media Preview';
  if (path) path.textContent = filePath || '';

  const cleanPath = filePath.replace(/\\/g, '/');
  const src = cleanPath.startsWith('file://') ? cleanPath : `file:///${cleanPath}`;

  if (isVideo) {
    if (img) img.classList.add('hidden');
    if (video) {
      video.src = src;
      video.classList.remove('hidden');
      video.play().catch(() => {});
    }
  } else {
    if (video) {
      video.pause();
      video.classList.add('hidden');
    }
    if (img) {
      img.src = src;
      img.classList.remove('hidden');
    }
  }

  modal.classList.remove('hidden');
};

window.closeLightbox = function() {
  const modal = document.getElementById('lightbox-modal');
  const video = document.getElementById('lightbox-video');
  if (video) video.pause();
  if (modal) modal.classList.add('hidden');
};

// Bind UI controls for Auto Updater & Settings Page
document.addEventListener('DOMContentLoaded', () => {
  const btnCheckUpdates = document.getElementById('btn-check-updates');
  const btnSettingsCheckUpdates = document.getElementById('btn-settings-check-updates');
  const btnStartUpdate = document.getElementById('btn-start-update');
  const btnUpdateLater = document.getElementById('btn-update-later');
  const btnCloseModal = document.getElementById('btn-close-update-modal');
  const themeCardDark = document.getElementById('theme-card-dark');
  const themeCardLight = document.getElementById('theme-card-light');
  const btnCloseLightbox = document.getElementById('btn-close-lightbox');
  const lightboxModal = document.getElementById('lightbox-modal');

  const triggerUpdateCheck = () => {
    if (window._latestUpdateInfo && window._latestUpdateInfo.update_available) {
      window.openUpdateModal();
    } else {
      window.checkForUpdates(true);
    }
  };

  if (btnCheckUpdates) btnCheckUpdates.addEventListener('click', triggerUpdateCheck);
  if (btnSettingsCheckUpdates) btnSettingsCheckUpdates.addEventListener('click', triggerUpdateCheck);

  if (themeCardDark) themeCardDark.addEventListener('click', () => window.setAppTheme('dark'));
  if (themeCardLight) themeCardLight.addEventListener('click', () => window.setAppTheme('light'));

  if (btnStartUpdate) {
    btnStartUpdate.addEventListener('click', () => {
      const url = window._latestUpdateInfo ? window._latestUpdateInfo.download_url : '';
      window.downloadUpdate(url);
    });
  }

  if (btnUpdateLater) {
    btnUpdateLater.addEventListener('click', () => window.closeUpdateModal());
  }

  if (btnCloseModal) {
    btnCloseModal.addEventListener('click', () => window.closeUpdateModal());
  }

  if (btnCloseLightbox) {
    btnCloseLightbox.addEventListener('click', () => window.closeLightbox());
  }

  if (lightboxModal) {
    lightboxModal.addEventListener('click', (e) => {
      if (e.target === lightboxModal) window.closeLightbox();
    });
  }

  // Close lightbox on ESC key
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      window.closeLightbox();
      window.closeUpdateModal();
    }
  });

  // Automatic background update check on app launch after 3.5s delay
  setTimeout(() => {
    window.checkForUpdates(false);
  }, 3500);
});
