// ── Media Sorting State & Logic ──

let sortAppState = {
  files: [],
  folders: [],
  allCsvFolders: [],
  newlyCreatedFolders: [],
  root_dir: null,
  contributors: {},
  collapsedFolders: {},
  selectedContributor: 'ALL',
  selectedMediaType: 'ALL',
  searchQuery: '',
  activeShiftFolderId: null,
  history: [],
  pendingShift: null,
  activeMode: null,
  lastSelectedFileId: null
};

let analysisState = {
  startTime: null,
  totalMedia: 0,
  rootDir: null
};

window.CAMERAMAN_PALETTE = [
  { hex: '#06b6d4', lightBg: 'rgba(6, 182, 212, 0.22)', darkHex: '#083344', textHex: '#06b6d4', name: 'Cyan', border: '#06b6d4' },
  { hex: '#a855f7', lightBg: 'rgba(168, 85, 247, 0.22)', darkHex: '#3b0764', textHex: '#a855f7', name: 'Purple', border: '#a855f7' },
  { hex: '#10b981', lightBg: 'rgba(16, 185, 129, 0.22)', darkHex: '#022c22', textHex: '#10b981', name: 'Emerald', border: '#10b981' },
  { hex: '#f59e0b', lightBg: 'rgba(245, 158, 11, 0.22)', darkHex: '#451a03', textHex: '#f59e0b', name: 'Amber', border: '#f59e0b' },
  { hex: '#ec4899', lightBg: 'rgba(236, 72, 153, 0.22)', darkHex: '#500724', textHex: '#ec4899', name: 'Pink', border: '#ec4899' },
  { hex: '#3b82f6', lightBg: 'rgba(59, 130, 246, 0.22)', darkHex: '#172554', textHex: '#3b82f6', name: 'Blue', border: '#3b82f6' },
  { hex: '#84cc16', lightBg: 'rgba(132, 204, 22, 0.22)', darkHex: '#1a2e05', textHex: '#84cc16', name: 'Lime', border: '#84cc16' },
  { hex: '#f97316', lightBg: 'rgba(249, 115, 22, 0.22)', darkHex: '#431407', textHex: '#f97316', name: 'Orange', border: '#f97316' },
  { hex: '#d946ef', lightBg: 'rgba(217, 70, 239, 0.22)', darkHex: '#4a044e', textHex: '#d946ef', name: 'Fuchsia', border: '#d946ef' },
  { hex: '#14b8a6', lightBg: 'rgba(20, 184, 166, 0.22)', darkHex: '#042f2e', textHex: '#14b8a6', name: 'Teal', border: '#14b8a6' },
  { hex: '#eab308', lightBg: 'rgba(234, 179, 8, 0.22)', darkHex: '#422006', textHex: '#eab308', name: 'Yellow', border: '#eab308' },
  { hex: '#6366f1', lightBg: 'rgba(99, 102, 241, 0.22)', darkHex: '#1e1b4b', textHex: '#6366f1', name: 'Indigo', border: '#6366f1' }
];

window.getCameramanColor = function(cameramanName) {
  if (!cameramanName || cameramanName === 'ALL' || cameramanName === 'UNASSIGNED') {
    return { hex: '#64748b', lightBg: 'rgba(100, 116, 139, 0.15)', darkHex: '#0f172a', textHex: '#64748b', name: 'Slate', border: '#64748b' };
  }
  const contribKeys = Object.keys(sortAppState.contributors || {});
  let idx = contribKeys.findIndex(k => window.areContributorsSame ? window.areContributorsSame(k, cameramanName) : (k.toLowerCase() === cameramanName.toLowerCase()));
  if (idx === -1) {
    let hash = 0;
    for (let i = 0; i < cameramanName.length; i++) hash = cameramanName.charCodeAt(i) + ((hash << 5) - hash);
    idx = Math.abs(hash) % window.CAMERAMAN_PALETTE.length;
  } else {
    idx = idx % window.CAMERAMAN_PALETTE.length;
  }
  return window.CAMERAMAN_PALETTE[idx];
};

function hexToRgb(hex) {
  if (!hex) return '56, 189, 248';
  let c = hex.replace('#', '');
  if (c.length === 3) c = c.split('').map(x => x + x).join('');
  const num = parseInt(c, 16);
  if (isNaN(num)) return '56, 189, 248';
  return `${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}`;
}
window.hexToRgb = hexToRgb;

let currentMapping = null;
let currentRoot = null;
let _prefixesConfirmed = false;

function resetMediaSortingState() {
  sortAppState.files = [];
  sortAppState.folders = [];
  sortAppState.allCsvFolders = [];
  sortAppState.newlyCreatedFolders = [];
  sortAppState.root_dir = null;
  sortAppState.contributors = {};
  sortAppState.collapsedFolders = {};
  sortAppState.selectedContributor = 'ALL';
  sortAppState.selectedMediaType = 'ALL';
  sortAppState.searchQuery = '';
  sortAppState.activeShiftFolderId = null;
  sortAppState.history = [];
  sortAppState.pendingShift = null;
  sortAppState.activeMode = null;
  sortAppState.lastSelectedFileId = null;

  analysisState.startTime = null;
  analysisState.totalMedia = 0;
  analysisState.rootDir = null;

  _prefixesConfirmed = false;

  // Show setup screen, hide analysis and main workspace screen
  const setupScreen = document.getElementById('sort-setup-screen');
  const analysisScreen = document.getElementById('sort-analysis-screen');
  const mainScreen = document.getElementById('sort-main-screen');

  if (setupScreen) {
    setupScreen.classList.remove('hidden');
    setupScreen.style.display = '';
  }
  if (analysisScreen) {
    analysisScreen.classList.add('hidden');
    analysisScreen.style.display = 'none';
  }
  if (mainScreen) {
    mainScreen.classList.add('hidden');
    mainScreen.style.display = 'none';
  }

  // Clear folders container & contributor filters
  const foldersContainer = document.getElementById('folders-container');
  if (foldersContainer) {
    foldersContainer.innerHTML = '';
  }
  const contribFilters = document.getElementById('contributor-filters');
  if (contribFilters) {
    contribFilters.innerHTML = '';
  }

  // Reset search inputs
  const dashSearch = document.getElementById('dashboard-folder-search');
  if (dashSearch) dashSearch.value = '';
  const fileSearch = document.getElementById('file-search-input');
  if (fileSearch) fileSearch.value = '';
  const dashSearchClear = document.getElementById('dashboard-folder-search-clear');
  if (dashSearchClear) dashSearchClear.classList.add('hidden');

  // Reset analysis ring & progress UI
  const ringPct = document.getElementById('ring-percent');
  if (ringPct) ringPct.innerText = '0%';
  const ringProgress = document.getElementById('ring-progress');
  if (ringProgress) ringProgress.style.strokeDashoffset = '283';
  const analysisBar = document.getElementById('analysis-bar');
  if (analysisBar) analysisBar.style.width = '0%';
  const analysisText = document.getElementById('analysis-progress-text');
  if (analysisText) analysisText.innerText = '0 / 0 files';
  const analysisEta = document.getElementById('analysis-eta');
  if (analysisEta) analysisEta.innerText = 'Starting analysis…';

  const analysisPhotos = document.getElementById('analysis-photos');
  if (analysisPhotos) analysisPhotos.innerText = '0';
  const analysisVideos = document.getElementById('analysis-videos');
  if (analysisVideos) analysisVideos.innerText = '0';
  const analysisMarkers = document.getElementById('analysis-markers');
  if (analysisMarkers) analysisMarkers.innerText = '0';
  const tickerFilename = document.getElementById('ticker-filename');
  if (tickerFilename) tickerFilename.innerText = 'Waiting…';
  const tickerContributor = document.getElementById('ticker-contributor');
  if (tickerContributor) tickerContributor.innerText = '';

  // Reset undo buttons
  const btnUndo = document.getElementById('btn-undo');
  if (btnUndo) btnUndo.disabled = true;
  const btnUndoTransfer = document.getElementById('btn-undo-transfer');
  if (btnUndoTransfer) btnUndoTransfer.disabled = true;

  // Hide floating selection bar & scroll to top
  const scrollBtn = document.getElementById('btn-sorting-scroll-top');
  if (scrollBtn) scrollBtn.classList.add('hidden');
  const floatBar = document.getElementById('floating-selection-bar');
  if (floatBar) {
    floatBar.classList.add('hidden');
    floatBar.style.display = 'none';
  }

  // Hide all sorting modals
  ['camera-prefix-modal', 'camera-range-modal', 'edit-modal', 'preview-modal', 'report-modal', 'drag-folder-grid-overlay', 'move-confirm-modal'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.classList.add('hidden');
      el.style.display = 'none';
    }
  });

  // Check ready state for scan button
  const btnScan = document.getElementById('btn-sort-scan');
  if (btnScan) {
    btnScan.disabled = !(currentMapping && currentRoot);
  }
}
window.resetMediaSortingState = resetMediaSortingState;

document.addEventListener('DOMContentLoaded', () => {
  resetMediaSortingState();

  const btnMapping = document.getElementById('btn-sort-mapping');
  const btnRoot = document.getElementById('btn-sort-root');
  const btnScan = document.getElementById('btn-sort-scan');
  
  const pathMapping = document.getElementById('sort-mapping-path');
  const pathRoot = document.getElementById('sort-root-path');

  function checkReady() {
    btnScan.disabled = !(currentMapping && currentRoot);
  }

  window.setSortingMappingPath = function(path, syncToCsv = true) {
    if (!path) return;
    currentMapping = path;
    if (pathMapping) pathMapping.value = currentMapping;
    checkReady();
    if (syncToCsv && window.setCsvInputPath) {
      window.setCsvInputPath(path, false);
    }
    if (window.pywebview && window.pywebview.api && window.pywebview.api.set_setting) {
      window.pywebview.api.set_setting('sorting_mapping_path', path);
    }
  };

  window.setSortingRootPath = async function(path, syncToCsv = true) {
    if (!path) return;
    currentRoot = path;
    if (pathRoot) pathRoot.value = currentRoot;
    checkReady();
    if (syncToCsv && window.setCsvDestPath) {
      window.setCsvDestPath(path, false);
    }
    if (window.pywebview && window.pywebview.api && window.pywebview.api.set_setting) {
      window.pywebview.api.set_setting('sorting_root_path', path);
    }

    // Auto-detect mapping CSV in Document folder matching root folder name
    try {
      if (window.pywebview && window.pywebview.api && window.pywebview.api.sorting_auto_detect_mapping) {
        const autoRes = await window.pywebview.api.sorting_auto_detect_mapping(path);
        if (autoRes && autoRes.found && autoRes.mapping_path) {
          window.setSortingMappingPath(autoRes.mapping_path, syncToCsv);
          if (window.showToast) {
            window.showToast(`Auto-detected mapping CSV: ${autoRes.filename}`, false);
          }
        }
      }
    } catch (err) {
      console.warn("Auto-detect mapping CSV error:", err);
    }
  };

  window.getSortingMappingPath = function() { return currentMapping; };
  window.getSortingRootPath = function() { return currentRoot; };
  
  async function loadMapping(path = null) {
    try {
      const respPath = await window.pywebview.api.sorting_select_mapping_file(path);
      if (respPath) {
        window.setSortingMappingPath(respPath, true);
      }
    } catch (e) { console.error(e); }
  }

  btnMapping.addEventListener('click', () => loadMapping(null));

  window.makeDropZone('sort-mapping-container', paths => {
    if (paths && paths.length > 0) {
      const file = paths[0];
      if (file.toLowerCase().endsWith('.csv')) {
        loadMapping(file);
      } else {
        window.showToast("Please drop a valid CSV file (.csv)", true);
      }
    }
  });
  
  async function loadRoot(path = null) {
    try {
      const respPath = await window.pywebview.api.sorting_select_root_dir(path);
      if (respPath) {
        await window.setSortingRootPath(respPath, true);
      }
    } catch (e) { console.error(e); }
  }

  btnRoot.addEventListener('click', () => loadRoot(null));

  window.makeDropZone('sort-root-container', async paths => {
    if (paths && paths.length > 0) await loadRoot(paths[0]);
  });
  
  const dashSearchInput = document.getElementById('dashboard-folder-search');
  const dashSearchClear = document.getElementById('dashboard-folder-search-clear');
  if (dashSearchInput) {
    dashSearchInput.addEventListener('input', function() {
      sortAppState.searchQuery = this.value.toLowerCase().trim();
      if (dashSearchClear) {
        if (this.value) dashSearchClear.classList.remove('hidden');
        else dashSearchClear.classList.add('hidden');
      }
      renderFolders();
    });
  }
  if (dashSearchClear && dashSearchInput) {
    dashSearchClear.addEventListener('click', function() {
      dashSearchInput.value = '';
      sortAppState.searchQuery = '';
      dashSearchClear.classList.add('hidden');
      renderFolders();
    });
  }

  _prefixesConfirmed = false;

  btnScan.addEventListener('click', async () => {
    btnScan.disabled = true;
    analysisState.rootDir = currentRoot;
    
    const setupScreen = document.getElementById('sort-setup-screen');
    const analysisScreen = document.getElementById('sort-analysis-screen');

    try {
      // Step 1: Pre-Analysis Editable Camera Prefix Confirmation Modal (if not yet confirmed for this scan)
      if (!_prefixesConfirmed) {
        const prefRes = await window.pywebview.api.sorting_get_contributor_prefixes(currentMapping, currentRoot);
        if (prefRes && prefRes.ordered_contributors && prefRes.ordered_contributors.length > 0) {
          const confirmed = await showCameraPrefixModal(prefRes, currentMapping);
          if (!confirmed) {
            btnScan.disabled = false;
            return;
          }
          _prefixesConfirmed = true;
        }
      }

      // Step 2: Transition to analysis screen IMMEDIATELY so the user sees the scanning UI right away
      if (setupScreen) {
        setupScreen.classList.add('hidden');
        setupScreen.style.display = 'none';
      }
      if (analysisScreen) {
        analysisScreen.classList.remove('hidden');
        analysisScreen.style.display = 'flex';
      }
      
      const badgePill = document.querySelector('.analysis-badge-pill');
      const badgeText = document.querySelector('.analysis-badge-text');
      if (badgePill) badgePill.classList.remove('complete');
      if (badgeText) badgeText.innerText = 'SCANNING IN PROGRESS';

      document.getElementById('ring-percent').innerText = '0%';
      document.getElementById('ring-progress').style.strokeDashoffset = 326.7;
      document.getElementById('analysis-bar').style.width = '0%';
      document.getElementById('analysis-eta').innerText = 'Scanning files…';
      document.getElementById('analysis-subtitle').classList.add('scanning-pulse');
      document.getElementById('analysis-subtitle').innerText = 'Scanning contributor files and checking camera series…';
      document.getElementById('analysis-progress-text').innerText = 'Discovering media files…';

      addLogEntry('Scanning media files in Contributor directory…', 'info');

      // Allow UI repaint
      await new Promise(r => setTimeout(r, 60));

      // Step 3: Fast Scan Files & Same-Series Conflict Resolution
      const scanRes = await window.pywebview.api.sorting_scan_files(currentMapping, currentRoot);
      if (scanRes.error) {
        window.showToast(scanRes.error, true);
        if (setupScreen) { setupScreen.classList.remove('hidden'); setupScreen.style.display = ''; }
        if (analysisScreen) { analysisScreen.classList.add('hidden'); analysisScreen.style.display = 'none'; }
        btnScan.disabled = false;
        _prefixesConfirmed = false;
        return;
      }

      if (scanRes.has_conflict) {
        if (setupScreen) { setupScreen.classList.remove('hidden'); setupScreen.style.display = ''; }
        if (analysisScreen) { analysisScreen.classList.add('hidden'); analysisScreen.style.display = 'none'; }
        btnScan.disabled = false;
        showCameraRangeModal(scanRes.conflicts, currentMapping, currentRoot);
        return;
      }
      
      _prefixesConfirmed = false;

      analysisState.totalMedia = scanRes.total_photos + scanRes.total_videos;
      analysisState.startTime = Date.now();
      
      document.getElementById('analysis-progress-text').innerText = `0 / ${analysisState.totalMedia} files`;
      document.getElementById('analysis-subtitle').innerText = 'Analyzing media markers and thumbnails…';
      
      addLogEntry(`Discovered ${scanRes.total_files} files (${scanRes.total_photos} photos, ${scanRes.total_videos} videos, ${scanRes.total_other} sidecar/other)`, 'ok');
      addLogEntry(`Contributors: ${scanRes.contributors.join(', ')}`, 'ok');
      addLogEntry('Starting marker detection analysis...', 'info');
      
      await window.pywebview.api.sorting_start_analysis();
      
    } catch (e) {
      console.error(e);
      window.showToast("An error occurred during scan preparation", true);
      if (setupScreen) { setupScreen.classList.remove('hidden'); setupScreen.style.display = ''; }
      if (analysisScreen) { analysisScreen.classList.add('hidden'); analysisScreen.style.display = 'none'; }
      btnScan.disabled = false;
      _prefixesConfirmed = false;
    }
  });

  // Top header actions
  document.getElementById('btn-undo').addEventListener('click', undo);
  document.getElementById('btn-undo-transfer').addEventListener('click', undoTransfer);
  const copyBtn = document.getElementById('btn-copy-all');
  if (copyBtn) copyBtn.addEventListener('click', () => confirmTransfer('move'));
  document.getElementById('btn-move-all').addEventListener('click', () => confirmTransfer('move'));

  // Sidebar actions
  document.getElementById('btn-filter-all').addEventListener('click', () => filterContributor('ALL'));
  document.getElementById('btn-expand-all').addEventListener('click', expandAllFolders);
  document.getElementById('btn-collapse-all').addEventListener('click', collapseAllFolders);

function onSearchInput(queryVal) {
  const q = (queryVal || '').toLowerCase().trim();
  sortAppState.searchQuery = q;
  const dashSearchInput = document.getElementById('dashboard-folder-search');
  const fileSearchInput = document.getElementById('file-search-input');
  const dashSearchClear = document.getElementById('dashboard-folder-search-clear');
  
  if (dashSearchInput && dashSearchInput.value !== queryVal) dashSearchInput.value = queryVal;
  if (fileSearchInput && fileSearchInput.value !== queryVal) fileSearchInput.value = queryVal;
  if (dashSearchClear) {
    if (q) dashSearchClear.classList.remove('hidden');
    else dashSearchClear.classList.add('hidden');
  }
  renderFolders();
}
window.onSearchInput = onSearchInput;

  // Search
  const mainSearchInput = document.getElementById('file-search-input');
  if (mainSearchInput) {
    mainSearchInput.addEventListener('input', (e) => onSearchInput(e.target.value));
  }

  // Modals
  document.getElementById('btn-shift-down').addEventListener('click', () => previewShift('shift-down'));
  document.getElementById('btn-shift-up').addEventListener('click', () => previewShift('shift-up'));
  document.getElementById('btn-move-down').addEventListener('click', () => previewShift('move-down'));
  document.getElementById('btn-move-up').addEventListener('click', () => previewShift('move-up'));
  document.getElementById('btn-edit-cancel').addEventListener('click', closeModal);

  document.getElementById('btn-preview-confirm').addEventListener('click', confirmPreview);
  document.getElementById('btn-preview-cancel').addEventListener('click', cancelPreview);

  document.getElementById('btn-report-done').addEventListener('click', closeReportModal);
  document.getElementById('btn-report-undo').addEventListener('click', undoFromReport);

  // Camera Range Modal events
  document.getElementById('btn-camera-range-cancel').addEventListener('click', () => {
    const rm = document.getElementById('camera-range-modal');
    if (rm) {
      rm.classList.add('hidden');
      rm.style.display = 'none';
    }
  });
  
  // Camera Prefix Modal events
  const btnPrefixCancel = document.getElementById('btn-camera-prefix-cancel');
  if (btnPrefixCancel) {
    btnPrefixCancel.addEventListener('click', () => {
      document.body.classList.remove('modal-open');
      const m = document.getElementById('camera-prefix-modal');
      if (m) {
        m.classList.add('hidden');
        m.style.display = 'none';
      }
    });
  }

  // Move confirm modal + drag listeners are handled in sorting_drag_drop.js
  initScrollToTop();
});

function initScrollToTop() {
  const scrollBtn = document.getElementById('btn-sorting-scroll-top');
  if (!scrollBtn) return;

  function updateScrollBtn() {
    const viewSorting = document.getElementById('view-sorting');
    const mainScreen = document.getElementById('sort-main-screen');
    
    // Only show if view-sorting is currently active and in workspace screen
    const isSortingActive = viewSorting && !viewSorting.classList.contains('hidden');
    const isMainScreenVisible = mainScreen && !mainScreen.classList.contains('hidden');

    if (!isSortingActive || !isMainScreenVisible) {
      scrollBtn.classList.add('hidden');
      return;
    }

    const contentArea = document.querySelector('.content-area');
    const dashHeader = document.querySelector('.dashboard-header');
    
    let isHeaderDisappeared = false;

    // Check container scrollTop directly (bulletproof across all zoom levels & DPIs)
    const containerScroll = contentArea ? contentArea.scrollTop : 0;
    const windowScroll = (window.pageYOffset || document.documentElement.scrollTop || 0);

    if (containerScroll > 30 || windowScroll > 30) {
      isHeaderDisappeared = true;
    } else if (dashHeader) {
      const headerRect = dashHeader.getBoundingClientRect();
      const containerTop = contentArea ? contentArea.getBoundingClientRect().top : 0;
      if (headerRect.bottom <= containerTop + 20) {
        isHeaderDisappeared = true;
      }
    }

    if (isHeaderDisappeared) {
      scrollBtn.classList.remove('hidden');
    } else {
      scrollBtn.classList.add('hidden');
    }
  }

  window.updateSortingScrollBtn = updateScrollBtn;

  // Global captured scroll listeners (catches scrolls anywhere on any container)
  window.addEventListener('scroll', updateScrollBtn, { passive: true, capture: true });
  document.addEventListener('scroll', updateScrollBtn, { passive: true, capture: true });

  const contentArea = document.querySelector('.content-area');
  if (contentArea) {
    contentArea.addEventListener('scroll', updateScrollBtn, { passive: true });
  }

  scrollBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const contentArea = document.querySelector('.content-area');
    if (contentArea) {
      contentArea.scrollTo({ top: 0, behavior: 'smooth' });
    }
    const dashHeader = document.querySelector('.dashboard-header');
    if (dashHeader) {
      dashHeader.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
    document.documentElement.scrollTo({ top: 0, behavior: 'smooth' });
    setTimeout(updateScrollBtn, 350);
  });

  const dashHeader = document.querySelector('.dashboard-header');
  if (dashHeader && window.IntersectionObserver) {
    const observer = new IntersectionObserver(() => {
      updateScrollBtn();
    }, { threshold: [0, 0.2, 0.8, 1] });
    observer.observe(dashHeader);
  }

  updateScrollBtn();
}

if (document.readyState !== 'loading') {
  initScrollToTop();
}


function showCameraPrefixModal(prefRes, mappingPath = null) {
  return new Promise((resolve) => {
    const container = document.getElementById('camera-prefix-inputs-container');
    container.innerHTML = '';

    const seriesMap = prefRes.contributor_series || {};
    const contribList = prefRes.ordered_contributors || Object.keys(seriesMap);

    contribList.forEach((cname) => {
      const key = cname.replace(/\s+/g, '_');
      const val = seriesMap[cname] || '';
      const cColor = window.getCameramanColor ? window.getCameramanColor(cname) : { hex: '#06b6d4', darkHex: '#083344' };
      
      const parts = cname.trim().split(/\s+/);
      const initials = parts.length > 1 ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase() : cname.substring(0, 2).toUpperCase();

      const item = document.createElement('div');
      item.className = 'cameraman-prefix-row';
      item.innerHTML = `
        <div class="cameraman-info-col">
          <div class="cameraman-avatar-badge" style="background:${cColor.hex}18; color:${cColor.hex}; border: 1.5px solid ${cColor.hex}44;">
            ${initials}
          </div>
          <div class="cameraman-text-group">
            <span class="cameraman-name-label">${cname}</span>
            <span class="cameraman-role-sub">Assigned Contributor</span>
          </div>
        </div>
        <div class="cameraman-input-col">
          <div class="prefix-input-wrapper">
            <span class="prefix-tag-label">PREFIX</span>
            <input type="text" id="prefix-input-${key}" class="prefix-text-input" value="${val}" placeholder="e.g. C0" maxlength="12" spellcheck="false" autocomplete="off">
          </div>
        </div>
      `;
      container.appendChild(item);
    });

    const modal = document.getElementById('camera-prefix-modal');
    const confirmBtn = document.getElementById('btn-camera-prefix-confirm');
    const cancelBtn = document.getElementById('btn-camera-prefix-cancel');

    const newConfirm = confirmBtn.cloneNode(true);
    const newCancel = cancelBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newConfirm, confirmBtn);
    cancelBtn.parentNode.replaceChild(newCancel, cancelBtn);

    newConfirm.addEventListener('click', async () => {
      const updatedSeries = {};
      contribList.forEach(cname => {
        const key = cname.replace(/\s+/g, '_');
        const inputEl = document.getElementById(`prefix-input-${key}`);
        if (inputEl) {
          updatedSeries[cname] = inputEl.value.trim();
        }
      });

      try {
        const targetMap = mappingPath || currentMapping;
        const res = await window.pywebview.api.sorting_set_contributor_series(JSON.stringify(updatedSeries), targetMap);
        if (res && res.error) {
          window.showToast('Failed to update camera prefixes: ' + res.error, true);
          document.body.classList.remove('modal-open');
          resolve(false);
          return;
        }
        if (typeof window.showToast === 'function') {
          window.showToast('Camera series updated and saved to mapping CSV', false);
        }
        document.body.classList.remove('modal-open');
        modal.classList.add('hidden');
        modal.style.display = 'none';
        resolve(true);
      } catch (err) {
        console.error("Error updating camera prefixes:", err);
        const errMsg = (err && err.message) ? err.message : String(err);
        window.showToast('Failed to update camera prefixes: ' + errMsg, true);
        document.body.classList.remove('modal-open');
        modal.classList.add('hidden');
        modal.style.display = 'none';
        resolve(false);
      }
    });

    newCancel.addEventListener('click', () => {
      document.body.classList.remove('modal-open');
      modal.classList.add('hidden');
      modal.style.display = 'none';
      resolve(false);
    });

    document.body.classList.add('modal-open');
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
  });
}

let currentConflicts = [];
function showCameraRangeModal(conflicts, mappingPath, rootPath) {
  currentConflicts = conflicts;
  const container = document.getElementById('camera-range-inputs-container');
  container.innerHTML = '';

  conflicts.forEach(group => {
    group.cams.forEach((cam, idx) => {
      const key = `${idx}_${cam.cam_name.replace(/\s+/g, '_')}`;
      const item = document.createElement('div');
      item.className = 'card glass';
      item.style.padding = '0.85rem 1.1rem';
      item.style.background = 'var(--input-bg)';
      item.style.border = '1px solid var(--border-glass)';
      item.style.borderRadius = 'var(--radius-sm)';
      item.style.marginBottom = '0.5rem';

      const folderInfo = cam.subfolder ? `<span style="font-size:0.75rem; background:rgba(56,189,248,0.15); color:#38bdf8; padding:2px 8px; border-radius:6px; font-weight:600;">📁 ${cam.subfolder}</span>` : '';

      item.innerHTML = `
        <div style="font-weight: 700; color: var(--accent-blue); font-size: 0.95rem; margin-bottom: 0.5rem; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.4rem;">
          <div style="display:flex; align-items:center; gap:0.5rem;">
            <span>${cam.cam_name} — ${cam.contributor}</span>
            ${folderInfo}
          </div>
          <span style="font-size:0.75rem; color:var(--text-muted); font-weight:500;">Series: <strong>${cam.series}</strong> (${cam.file_count} files)</span>
        </div>
        <div class="grid-2 gap-2 text-xs">
          <div>
            <label style="display:block; margin-bottom:0.25rem; font-weight:600; color:var(--text-secondary);">Start File / Number</label>
            <input type="text" id="range-start-${key}" class="input-glass w-full" value="${cam.min_file || ''}" placeholder="e.g. C0001.MP4 or 1" data-cam-key="${key}">
          </div>
          <div>
            <label style="display:block; margin-bottom:0.25rem; font-weight:600; color:var(--text-secondary);">End File / Number</label>
            <input type="text" id="range-end-${key}" class="input-glass w-full" value="${cam.max_file || ''}" placeholder="e.g. C0050.MP4 or 50" data-cam-key="${key}">
          </div>
        </div>
      `;
      container.appendChild(item);
    });
  });

  const confirmBtn = document.getElementById('btn-camera-range-confirm');
  const newConfirmBtn = confirmBtn.cloneNode(true);
  confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);

  newConfirmBtn.addEventListener('click', async () => {
    const ranges = {};
    conflicts.forEach(group => {
      group.cams.forEach((cam, idx) => {
        const key = `${idx}_${cam.cam_name.replace(/\s+/g, '_')}`;
        const startInput = document.getElementById(`range-start-${key}`);
        const endInput = document.getElementById(`range-end-${key}`);
        const startVal = startInput ? startInput.value.trim() : '';
        const endVal = endInput ? endInput.value.trim() : '';
        
        const rangeObj = {
          start: startVal,
          end: endVal,
          subfolder: cam.subfolder || null
        };
        ranges[cam.contributor] = rangeObj;
        ranges[cam.cam_name] = rangeObj;
      });
    });

    try {
      await window.pywebview.api.sorting_set_camera_ranges(JSON.stringify(ranges));
      const rangeModal = document.getElementById('camera-range-modal');
      if (rangeModal) {
        rangeModal.classList.add('hidden');
        rangeModal.style.display = 'none';
      }
      // Re-trigger scan with ranges applied
      const btnScan = document.getElementById('btn-sort-scan');
      if (btnScan) btnScan.click();
    } catch (e) {
      window.showToast("Failed to save camera range configuration", true);
    }
  });

  const cancelBtn = document.getElementById('btn-camera-range-cancel');
  if (cancelBtn) {
    const newCancelBtn = cancelBtn.cloneNode(true);
    cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
    newCancelBtn.addEventListener('click', () => {
      const rangeModal = document.getElementById('camera-range-modal');
      if (rangeModal) {
        rangeModal.classList.add('hidden');
        rangeModal.style.display = 'none';
      }
      const setupScreen = document.getElementById('sort-setup-screen');
      const analysisScreen = document.getElementById('sort-analysis-screen');
      if (setupScreen) { setupScreen.classList.remove('hidden'); setupScreen.style.display = ''; }
      if (analysisScreen) { analysisScreen.classList.add('hidden'); analysisScreen.style.display = 'none'; }
      const btnScan = document.getElementById('btn-sort-scan');
      if (btnScan) btnScan.disabled = false;
    });
  }

  const rangeModal = document.getElementById('camera-range-modal');
  if (rangeModal) {
    rangeModal.classList.remove('hidden');
    rangeModal.style.display = 'flex';
  }
}


function addLogEntry(text, type) {
  const log = document.getElementById('activity-log');
  if (!log) return;
  const entry = document.createElement('div');
  entry.className = 'log-entry';
  
  let dot = '';
  if (type === 'marker') dot = '<span style="color:var(--accent-red);">●</span>';
  else if (type === 'ok') dot = '<span style="color:var(--accent-green);">●</span>';
  else dot = '<span style="color:var(--text-muted);">●</span>';
  
  entry.innerHTML = `${dot} <span>${text}</span>`;
  log.appendChild(entry);
  log.scrollTop = log.scrollHeight;
  
  while (log.children.length > 100) {
    log.removeChild(log.firstChild);
  }
}

// Global callbacks from Python
window.updateAnalysisProgress = function(jsonStr) {
  try {
    const data = JSON.parse(jsonStr);
    if (data.type !== 'progress') return;
    
    const percent = data.total > 0 ? Math.round((data.current / data.total) * 100) : 0;
    
    // Ring progress
    const ring = document.getElementById('ring-progress');
    const circumference = 283; // 2 * PI * 45
    const offset = circumference - (percent / 100) * circumference;
    ring.style.strokeDashoffset = offset;
    document.getElementById('ring-percent').innerText = percent + '%';
    
    // Bar progress
    document.getElementById('analysis-bar').style.width = percent + '%';
    document.getElementById('analysis-progress-text').innerText = `${data.current} / ${data.total} files`;
    
    // ETA
    if (data.current > 0 && analysisState.startTime) {
      const elapsed = (Date.now() - analysisState.startTime) / 1000;
      const rate = data.current / elapsed;
      const remaining = (data.total - data.current) / rate;
      if (remaining > 60) {
        document.getElementById('analysis-eta').innerText = `~${Math.ceil(remaining / 60)} min remaining`;
      } else {
        document.getElementById('analysis-eta').innerText = `~${Math.ceil(remaining)}s remaining`;
      }
    }
    
    // Stats
    document.getElementById('analysis-photos').innerText = data.photos_analysed;
    document.getElementById('analysis-videos').innerText = data.videos_analysed;
    document.getElementById('analysis-markers').innerText = data.markers_found;
    
    // Highlight
    document.getElementById('stat-card-photos').classList.toggle('active', data.file_type === 'photo');
    document.getElementById('stat-card-videos').classList.toggle('active', data.file_type === 'video');
    document.getElementById('stat-card-markers').classList.toggle('active', data.is_marker);
    
    // Ticker
    const badge = document.getElementById('ticker-badge');
    if (data.file_type === 'photo') {
      badge.className = 'ticker-badge photo'; badge.innerText = 'Photo';
    } else if (data.file_type === 'video') {
      badge.className = 'ticker-badge video'; badge.innerText = 'Video';
    }
    if (data.is_marker) {
      badge.className = 'ticker-badge marker'; badge.innerText = 'Marker';
    }
    document.getElementById('ticker-filename').innerText = data.current_file;
    document.getElementById('ticker-contributor').innerText = data.current_contributor;
    
    if (data.is_marker) addLogEntry(`MARKER: ${data.current_file} (${data.current_contributor})`, 'marker');
    if (data.current % 25 === 0) addLogEntry(`Processed ${data.current}/${data.total} — ${data.photos_analysed} photos, ${data.videos_analysed} videos`, 'ok');
    
  } catch (e) { console.error(e); }
};

window.onAnalysisComplete = function(jsonStr) {
  try {
    let response = jsonStr;
    if (typeof response === 'string') {
      try { response = JSON.parse(response); } catch (e) {}
    }
    if (typeof response === 'string') {
      try { response = JSON.parse(response); } catch (e) {}
    }
    
    if (!response || typeof response !== 'object') {
      console.error('Invalid analysis response payload:', jsonStr);
      if (window.showToast) window.showToast('Failed to parse scan results payload.', true);
      const analysisEl = document.getElementById('sort-analysis-screen');
      const setupEl = document.getElementById('sort-setup-screen');
      if (analysisEl) { analysisEl.classList.add('hidden'); analysisEl.style.display = 'none'; }
      if (setupEl) { setupEl.classList.remove('hidden'); setupEl.style.display = ''; }
      return;
    }

    if (response.error) {
      window.showToast(response.error, true);
      const analysisEl = document.getElementById('sort-analysis-screen');
      const setupEl = document.getElementById('sort-setup-screen');
      if (analysisEl) { analysisEl.classList.add('hidden'); analysisEl.style.display = 'none'; }
      if (setupEl) { setupEl.classList.remove('hidden'); setupEl.style.display = ''; }
      return;
    }
    
    document.getElementById('ring-percent').innerText = '100%';
    document.getElementById('ring-progress').style.strokeDashoffset = 0;
    document.getElementById('analysis-bar').style.width = '100%';
    document.getElementById('analysis-eta').innerText = 'Complete!';
    document.getElementById('analysis-subtitle').classList.remove('scanning-pulse');
    document.getElementById('analysis-subtitle').innerText = 'Analysis complete!';
    
    const badgePill = document.querySelector('.analysis-badge-pill');
    const badgeText = document.querySelector('.analysis-badge-text');
    if (badgePill) badgePill.classList.add('complete');
    if (badgeText) badgeText.innerText = 'ANALYSIS COMPLETE';

    addLogEntry('Analysis complete — loading workspace…', 'ok');
    
    setTimeout(() => {
      sortAppState.files = Array.isArray(response.files) ? response.files : [];
      sortAppState.folders = Array.isArray(response.folders) ? response.folders : [];
      sortAppState.allCsvFolders = [...sortAppState.folders];
      sortAppState.contributors = response.contributors || {};
      sortAppState.newlyCreatedFolders = [];
      sortAppState.root_dir = analysisState.rootDir;
      
      sortFoldersAndReassignIndices();
      sortAppState.collapsedFolders = {};
      sortAppState.history = [];
      updateUndoButtonState();
      updateUndoTransferButtonState(false);
      
      const analysisEl = document.getElementById('sort-analysis-screen');
      const mainEl = document.getElementById('sort-main-screen');
      if (analysisEl) { analysisEl.classList.add('hidden'); analysisEl.style.display = 'none'; }
      if (mainEl) { mainEl.classList.remove('hidden'); mainEl.style.display = ''; }
      
      renderFolders();
      lazyLoadThumbnails();
      setTimeout(() => window.updateSortingScrollBtn?.(), 250);
    }, 1200);
    
  } catch (e) {
    console.error('onAnalysisComplete error:', e);
  }
};

function sanitizeVideoFolderAssignments() {
  if (!sortAppState.files || !sortAppState.folders) return;
  sortAppState.files.forEach(f => {
    const isVideo = f.is_video || f.file_type === 'video' || (/\.(mp4|mov|avi|mkv|wmv|mts|m2ts|m4v|webm|flv|3gp)$/i).test(f.filename || f.path || '');
    if (isVideo && f.folder_index >= 0 && f.folder_index < sortAppState.folders.length) {
      const folderName = sortAppState.folders[f.folder_index] || '';
      if (isPhotoOnlyFolder(folderName)) {
        const contribFolderIndices = getContributorFolderIndices(f.contributor);
        const nextValidIdx = getNextFolderIndexForFile(f, f.folder_index, contribFolderIndices);
        if (nextValidIdx !== f.folder_index) {
          f.folder_index = nextValidIdx;
        } else {
          const prevValidIdx = getPrevFolderIndexForFile(f, f.folder_index, contribFolderIndices);
          f.folder_index = prevValidIdx;
        }
      }
    }
  });
}

function sortFoldersAndReassignIndices() {
  const oldFolders = [...sortAppState.folders];
  sortAppState.folders.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
  
  sortAppState.files.forEach(f => {
    if (f.folder_index !== undefined && f.folder_index >= 0 && f.folder_index < oldFolders.length) {
      const folderPath = oldFolders[f.folder_index];
      const newIdx = sortAppState.folders.indexOf(folderPath);
      if (newIdx !== -1) f.folder_index = newIdx;
    }
  });

  sanitizeVideoFolderAssignments();
}

// —— State Management ——

function saveHistory() {
  sortAppState.history.push({
    files: JSON.parse(JSON.stringify(sortAppState.files)),
    folders: JSON.parse(JSON.stringify(sortAppState.folders))
  });
  if (sortAppState.history.length > 50) sortAppState.history.shift();
  updateUndoButtonState();
}

function undo() {
  if (sortAppState.history.length > 0) {
    const prevState = sortAppState.history.pop();
    sortAppState.files = prevState.files;
    sortAppState.folders = prevState.folders;
    renderFolders();
    lazyLoadThumbnails();
    updateUndoButtonState();
    window.showToast("Undo successful!");
  }
}

function updateUndoButtonState() {
  const disabled = sortAppState.history.length === 0;
  const b1 = document.getElementById('btn-undo');
  const b2 = document.getElementById('top-btn-undo');
  if (b1) b1.disabled = disabled;
  if (b2) b2.disabled = disabled;
}

function updateUndoTransferButtonState(canUndo) {
  const disabled = !canUndo;
  const b1 = document.getElementById('btn-undo-transfer');
  const b2 = document.getElementById('top-btn-undo-transfer');
  if (b1) b1.disabled = disabled;
  if (b2) b2.disabled = disabled;
}

window.triggerSortingUndo = () => undo();
window.triggerSortingUndoTransfer = () => undoTransfer();
window.triggerSortingCopyAll = () => confirmTransfer('move');
window.triggerSortingMoveAll = () => confirmTransfer('move');

async function undoTransfer() {
  const confirmed = window.confirmModal ? await window.confirmModal({
    title: 'Undo Last Transfer?',
    message: 'Are you sure you want to undo the last file transfer operation?',
    details: 'Files moved during the previous batch will be reverted back to their original source folders.',
    confirmText: 'Undo Transfer',
    cancelText: 'Cancel',
    type: 'warning',
    icon: 'undo'
  }) : confirm("Are you sure you want to undo the last file transfer?");

  if (confirmed) {
    if (window.ProgressController) {
      window.ProgressController.start("Undoing File Transfer...", "Reverting transferred files...", 0);
    } else {
      window.showToast("Undoing transfer...");
    }
    
    window.pywebview.api.sorting_undo_transfer().then(res => {
      if (res && res.error) {
        if (window.ProgressController) window.ProgressController.stop();
        window.showToast("Undo error: " + res.error, 'error');
      }
    }).catch(err => {
      if (window.ProgressController) window.ProgressController.stop();
      window.showToast("Undo failed: " + err, 'error');
    });
  }
}

// —— UI Actions & Rendering ——

function filterContributor(c) {
  sortAppState.selectedContributor = c;
  renderFolders();
  lazyLoadThumbnails();
}

function onSearchInput(val) {
  sortAppState.searchQuery = val.trim().toLowerCase();
  renderFolders();
  lazyLoadThumbnails();
}

function expandAllFolders() {
  sortAppState.collapsedFolders = {};
  sortAppState.folders.forEach((_, idx) => {
    const cardEl = document.getElementById(`folder-card-${idx}`);
    if (cardEl) cardEl.classList.remove('collapsed');
  });
  lazyLoadThumbnails();
}

function collapseAllFolders() {
  sortAppState.folders.forEach((_, idx) => {
    sortAppState.collapsedFolders[idx] = true;
    const cardEl = document.getElementById(`folder-card-${idx}`);
    if (cardEl) cardEl.classList.add('collapsed');
  });
}

function toggleFolderCollapse(idx) {
  sortAppState.collapsedFolders[idx] = !sortAppState.collapsedFolders[idx];
  const cardEl = document.getElementById(`folder-card-${idx}`);
  if (cardEl) {
    if (sortAppState.collapsedFolders[idx]) cardEl.classList.add('collapsed');
    else {
      cardEl.classList.remove('collapsed');
      lazyLoadThumbnails();
    }
  }
}

function getContributorFolderIndices(contributor) {
  if (window.getStrictContributorFolders && contributor) {
    const strictIndices = window.getStrictContributorFolders(contributor);
    if (strictIndices && strictIndices.length > 0) return strictIndices;
  }
  const indices = new Set();
  if (contributor) {
    const cLower = contributor.toLowerCase().trim();
    sortAppState.files.forEach(f => {
      if (f.contributor && f.contributor.toLowerCase().trim() === cLower && f.folder_index >= 0) {
        indices.add(f.folder_index);
      }
    });
    if (sortAppState.folders) {
      sortAppState.folders.forEach((folder, idx) => {
        if (folder.toLowerCase().includes(cLower)) {
          indices.add(idx);
        }
      });
    }
    if (sortAppState.allCsvFolders) {
      sortAppState.allCsvFolders.forEach((folder) => {
        if (folder.toLowerCase().includes(cLower)) {
          const currentIdx = sortAppState.folders.indexOf(folder);
          if (currentIdx !== -1) indices.add(currentIdx);
        }
      });
    }
  }
  const sorted = [...indices].sort((a, b) => a - b);
  return sorted;
}

window._isMultiFolderAware = false;

window.showMultiFolderNoticeModal = function(onAware, onNotAware) {
  let modal = document.getElementById('multi-folder-notice-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'multi-folder-notice-modal';
    modal.className = 'modal-overlay';
    modal.style.cssText = 'position:fixed; inset:0; z-index:250000; background:rgba(0,0,0,0.6); backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px); display:flex; align-items:center; justify-content:center; padding:1rem;';
    modal.innerHTML =
      '<div class="modal-card" style="background:#ffffff; color:#0f172a; border-radius:16px; padding:1.75rem; max-width:440px; width:100%; box-shadow:0 25px 60px rgba(0,0,0,0.3); text-align:center; border:1px solid rgba(99,102,241,0.2); transform:scale(1); transition:all 0.2s ease;">' +
        '<div style="width:52px; height:52px; border-radius:50%; background:rgba(245,158,11,0.15); color:#d97706; display:inline-flex; align-items:center; justify-content:center; margin:0 auto 1.1rem auto; border:1px solid rgba(245,158,11,0.3);">' +
          '<svg width="26" height="26" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>' +
        '</div>' +
        '<h3 style="font-size:1.2rem; font-weight:800; margin:0 0 0.5rem 0; color:#0f172a;">Multi-Folder Selection Notice</h3>' +
        '<p style="font-size:0.92rem; color:#475569; margin:0 0 1.6rem 0; line-height:1.5; font-weight:500;">You are selecting files from different folders.</p>' +
        '<div style="display:flex; gap:0.85rem; justify-content:center;">' +
          '<button id="btn-notice-aware" class="btn" style="flex:1; background:#4f46e5; color:#ffffff; font-weight:800; padding:0.65rem 1rem; border-radius:8px; border:none; cursor:pointer; font-size:0.88rem; box-shadow:0 4px 12px rgba(79,70,229,0.25);">I am aware</button>' +
          '<button id="btn-notice-not-aware" class="btn" style="flex:1; background:#f1f5f9; color:#475569; font-weight:700; padding:0.65rem 1rem; border-radius:8px; border:1px solid #cbd5e1; cursor:pointer; font-size:0.88rem;">I am not aware</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(modal);
  }

  modal.style.display = 'flex';
  const btnAware = document.getElementById('btn-notice-aware');
  const btnNotAware = document.getElementById('btn-notice-not-aware');

  btnAware.onclick = function() {
    modal.style.display = 'none';
    if (typeof onAware === 'function') onAware();
  };

  btnNotAware.onclick = function() {
    modal.style.display = 'none';
    if (typeof onNotAware === 'function') onNotAware();
  };
};

let tileClickTimers = {};

window.toggleFileSelect = function(fileId, checked, isShift = false, isCtrl = false, folderIdx = null) {
  const file = sortAppState.files.find(f => f.id === fileId);
  if (!file) return;

  const targetFolderIdx = (folderIdx !== null) ? folderIdx : file.folder_index;
  const isTargetingSelect = (checked !== undefined) ? checked : !file.selected;

  if (isTargetingSelect) {
    const currentlySelected = sortAppState.files.filter(f => f.selected && !f.is_sidecar);
    const uniqueFolders = new Set(currentlySelected.map(f => f.folder_index));
    uniqueFolders.add(targetFolderIdx);

    // CASE 1: 3 or more distinct folders -> STRICTLY BLOCKED!
    if (uniqueFolders.size >= 3) {
      if (window.showToast) {
        window.showToast("Selection limit reached: You can only select files from a maximum of 2 folders at a time.", true);
      }
      const tile = document.getElementById(`tile-${fileId}`);
      if (tile) {
        const cb = tile.querySelector('.thumb-tile-checkbox');
        if (cb) cb.checked = false;
      }
      return;
    }

    // CASE 2: 2 distinct folders -> Check awareness confirmation
    if (uniqueFolders.size === 2 && !window._isMultiFolderAware) {
      window.showMultiFolderNoticeModal(
        function onAware() {
          window._isMultiFolderAware = true;
          file.selected = true;
          sortAppState.lastSelectedFileId = fileId;
          const tile = document.getElementById(`tile-${fileId}`);
          if (tile) {
            tile.classList.add('selected');
            const cb = tile.querySelector('.thumb-tile-checkbox');
            if (cb) cb.checked = true;
          }
          updateFolderHeaderButtons(targetFolderIdx);
          if (window.updateFloatingSelectionBar) window.updateFloatingSelectionBar();
        },
        function onNotAware() {
          window._isMultiFolderAware = false;
          // Deselect files from the OTHER folder(s)
          sortAppState.files.forEach(f => {
            if (f.folder_index !== targetFolderIdx) {
              f.selected = false;
              const t = document.getElementById(`tile-${f.id}`);
              if (t) {
                t.classList.remove('selected');
                const cb = t.querySelector('.thumb-tile-checkbox');
                if (cb) cb.checked = false;
              }
            }
          });
          // Select target file
          file.selected = true;
          sortAppState.lastSelectedFileId = fileId;
          const tile = document.getElementById(`tile-${fileId}`);
          if (tile) {
            tile.classList.add('selected');
            const cb = tile.querySelector('.thumb-tile-checkbox');
            if (cb) cb.checked = true;
          }
          renderFolders();
          lazyLoadThumbnails();
          if (window.updateFloatingSelectionBar) window.updateFloatingSelectionBar();
        }
      );
      return;
    }
  }

  if (isShift && sortAppState.lastSelectedFileId !== null && sortAppState.lastSelectedFileId !== fileId) {
    const folderFiles = sortAppState.files.filter(f => f.folder_index === targetFolderIdx && !f.is_sidecar);
    const idx1 = folderFiles.findIndex(f => f.id === sortAppState.lastSelectedFileId);
    const idx2 = folderFiles.findIndex(f => f.id === fileId);
    if (idx1 !== -1 && idx2 !== -1) {
      const start = Math.min(idx1, idx2);
      const end = Math.max(idx1, idx2);
      const targetState = (checked !== undefined) ? checked : true;
      for (let i = start; i <= end; i++) {
        folderFiles[i].selected = targetState;
        const t = document.getElementById(`tile-${folderFiles[i].id}`);
        if (t) {
          t.classList.toggle('selected', targetState);
          const cb = t.querySelector('.thumb-tile-checkbox');
          if (cb) cb.checked = targetState;
        }
      }
      sortAppState.lastSelectedFileId = fileId;
      updateFolderHeaderButtons(targetFolderIdx);
      if (window.updateFloatingSelectionBar) window.updateFloatingSelectionBar();
      return;
    }
  }

  const newState = (checked !== undefined) ? checked : !file.selected;
  file.selected = newState;
  sortAppState.lastSelectedFileId = fileId;

  const tile = document.getElementById(`tile-${fileId}`);
  if (tile) {
    tile.classList.toggle('selected', newState);
    const cb = tile.querySelector('.thumb-tile-checkbox');
    if (cb && cb.checked !== newState) cb.checked = newState;
  }

  const activeSelected = sortAppState.files.filter(f => f.selected && !f.is_sidecar);
  const activeFolders = new Set(activeSelected.map(f => f.folder_index));
  if (activeFolders.size <= 1) {
    window._isMultiFolderAware = false;
  }

  updateFolderHeaderButtons(targetFolderIdx);
  if (window.updateFloatingSelectionBar) window.updateFloatingSelectionBar();
};

window.selectFolderFiles = function(folderIdx, mode) {
  if (mode !== 'none') {
    const currentlySelected = sortAppState.files.filter(f => f.selected && !f.is_sidecar);
    const uniqueFolders = new Set(currentlySelected.map(f => f.folder_index));
    uniqueFolders.add(folderIdx);

    if (uniqueFolders.size >= 3) {
      if (window.showToast) {
        window.showToast("Selection limit reached: You can only select files from a maximum of 2 folders at a time.", true);
      }
      return;
    }

    if (uniqueFolders.size === 2 && !window._isMultiFolderAware) {
      window.showMultiFolderNoticeModal(
        function onAware() {
          window._isMultiFolderAware = true;
          window.selectFolderFiles(folderIdx, mode);
        },
        function onNotAware() {
          window._isMultiFolderAware = false;
          sortAppState.files.forEach(f => {
            if (f.folder_index !== folderIdx) f.selected = false;
          });
          window.selectFolderFiles(folderIdx, mode);
        }
      );
      return;
    }
  }

  const folderFiles = sortAppState.files.filter(f => f.folder_index === folderIdx && !f.is_sidecar);
  if (folderFiles.length === 0) return;

  folderFiles.forEach(f => {
    const isVideo = f.is_video || (/\.(mp4|mov|avi|mkv|wmv|mts|m2ts|m4v|webm|flv|3gp)$/i).test(f.filename || f.path || '');
    if (mode === 'all') f.selected = true;
    else if (mode === 'none') f.selected = false;
    else if (mode === 'videos') f.selected = isVideo;
    else if (mode === 'photos') f.selected = !isVideo;
    else if (mode === 'invert') f.selected = !f.selected;

    const tile = document.getElementById(`tile-${f.id}`);
    if (tile) {
      tile.classList.toggle('selected', f.selected);
      const cb = tile.querySelector('.thumb-tile-checkbox');
      if (cb) cb.checked = f.selected;
    }
  });

  updateFolderHeaderButtons(folderIdx);
  if (window.updateFloatingSelectionBar) window.updateFloatingSelectionBar();
};

window.selectGlobalMedia = function(type) {
  if (type === 'none') {
    sortAppState.files.forEach(f => {
      if (!f.is_sidecar) f.selected = false;
    });
    renderFolders();
    if (window.updateFloatingSelectionBar) window.updateFloatingSelectionBar();
    return;
  }
  
  if (window.showToast) {
    window.showToast("Selection is restricted to a single folder at a time. Please select files within a specific folder card.", true);
  }
};

window.filterMediaType = function(type) {
  sortAppState.selectedMediaType = type;
  document.querySelectorAll('#btn-type-all, #btn-type-video, #btn-type-photo').forEach(btn => btn.classList.remove('active'));
  if (type === 'ALL') { const b = document.getElementById('btn-type-all'); if (b) b.classList.add('active'); }
  else if (type === 'VIDEO') { const b = document.getElementById('btn-type-video'); if (b) b.classList.add('active'); }
  else if (type === 'PHOTO') { const b = document.getElementById('btn-type-photo'); if (b) b.classList.add('active'); }
  renderFolders();
  lazyLoadThumbnails();
};

function updateFolderHeaderButtons(folderIdx) {
  const folderCard = document.getElementById(`folder-card-${folderIdx}`);
  if (!folderCard) return;
  
  const folderFiles = sortAppState.files.filter(f => f.folder_index === folderIdx && !f.is_sidecar);
  const selectedInFolder = folderFiles.filter(f => f.selected).length;
  const allSelected = (sortAppState.files || []).filter(f => f.selected && !f.is_sidecar);
  const allSelectedCount = allSelected.length;
  const allSelectedDontCopy = selectedInFolder > 0 && folderFiles.filter(f => f.selected).every(f => f.dont_copy);

  const editBtn = folderCard.querySelector('.edit-btn');
  if (editBtn) {
    const isSingleSelected = (selectedInFolder === 1 && allSelectedCount === 1);
    editBtn.disabled = !isSingleSelected;
    if (allSelectedCount > 1) {
      editBtn.setAttribute('title', 'Edit option is closed when multiple files are selected.');
    } else {
      editBtn.removeAttribute('title');
    }
  }
  
  const dontCopyBtn = folderCard.querySelector('.dontcopy-btn');
  if (dontCopyBtn) {
    dontCopyBtn.disabled = selectedInFolder === 0;
    if (allSelectedDontCopy) dontCopyBtn.classList.add('active-dont-copy');
    else dontCopyBtn.classList.remove('active-dont-copy');
  }

  if (window.updateFloatingSelectionBar) window.updateFloatingSelectionBar();
}

window.openEditForFolder = function(folderIdx) {
  const allSelectedFiles = (sortAppState.files || []).filter(f => f.selected && !f.is_sidecar);
  if (allSelectedFiles.length > 1) {
    if (window.showToast) {
      window.showToast('Edit dialog is unavailable when multiple files are selected. Use Don\'t Move or Deselect.', true);
    }
    return;
  }

  let folderFiles = sortAppState.files.filter(f => f.folder_index === folderIdx && f.selected && !f.is_sidecar);
  if (folderFiles.length === 0) {
    const allFolderFiles = sortAppState.files.filter(f => f.folder_index === folderIdx && !f.is_sidecar);
    if (allFolderFiles.length > 0) {
      allFolderFiles[0].selected = true;
      folderFiles = [allFolderFiles[0]];
      renderFolders();
    } else {
      window.showToast('No files in folder to edit.', true);
      return;
    }
  }

  if (folderFiles.length > 1) {
    if (window.showToast) {
      window.showToast('Edit dialog is unavailable when multiple files are selected.', true);
    }
    return;
  }
  
  sortAppState.activeShiftFolderId = folderIdx;
  
  const folderPath = (sortAppState.folders && sortAppState.folders[folderIdx]) ? sortAppState.folders[folderIdx] : 'Unknown';
  const folderName = folderPath.split(/[\\/]/).pop() || folderPath;
  const titleEl = document.getElementById('modal-title');
  const descEl = document.getElementById('modal-desc');
  const safeFolderName = String(folderName).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  if (titleEl) titleEl.innerHTML = `Edit: <span class="edit-folder-pill">${safeFolderName}</span>`;
  const fileName = folderFiles[0].filename || (folderFiles[0].path ? folderFiles[0].path.split(/[\\/]/).pop() : 'Clip');
  const safeFileName = String(fileName).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  if (descEl) descEl.innerHTML = `Reassign folder sequencing for selected item: <span class="edit-file-pill">${safeFileName}</span>`;
  
  const mainContributor = folderFiles[0] ? folderFiles[0].contributor : '';
  const contribFolderIndices = getContributorFolderIndices(mainContributor);
  
  const hasMultipleFolders = contribFolderIndices.length > 1;
  
  const btnShiftUp = document.getElementById('btn-shift-up');
  const btnMoveUp = document.getElementById('btn-move-up');
  const btnShiftDown = document.getElementById('btn-shift-down');
  const btnMoveDown = document.getElementById('btn-move-down');

  if (btnShiftUp) btnShiftUp.disabled = !hasMultipleFolders;
  if (btnShiftDown) btnShiftDown.disabled = !hasMultipleFolders;
  if (btnMoveUp) btnMoveUp.disabled = !hasMultipleFolders;
  if (btnMoveDown) btnMoveDown.disabled = !hasMultipleFolders;
  
  const em = document.getElementById('edit-modal');
  if (em) {
    em.classList.remove('hidden');
    em.style.display = 'flex';
  }
  document.body.classList.add('modal-open');
};

window.toggleDontCopyForFolder = function(folderIdx) {
  const folderFiles = sortAppState.files.filter(f => f.folder_index === folderIdx && f.selected);
  if (folderFiles.length === 0) return;
  
  saveHistory();
  const allMarked = folderFiles.every(f => f.dont_copy);
  folderFiles.forEach(f => {
    f.dont_copy = !allMarked;
    f.selected = false;
  });
  
  renderFolders();
  lazyLoadThumbnails();
  if (window.updateFloatingSelectionBar) window.updateFloatingSelectionBar();
  window.showToast(allMarked ? 'Files restored for moving.' : 'Selected files marked as Don\'t Move.');
};

function closeModal() {
  const em = document.getElementById('edit-modal');
  if (em) {
    em.classList.add('hidden');
    em.style.display = 'none';
  }
  document.body.classList.remove('modal-open');
  sortAppState.activeShiftFolderId = null;
}
window.closeEditModal = closeModal;

/* —— Floating Selection Bar & Context Menu Helpers —— */
window.updateFloatingSelectionBar = function() {
  const bar = document.getElementById('floating-selection-bar');
  if (!bar) return;

  const sortingView = document.getElementById('view-sorting');
  if (sortingView && sortingView.classList.contains('hidden')) {
    bar.classList.add('hidden');
    bar.style.display = 'none';
    return;
  }

  const selectedFiles = (sortAppState.files || []).filter(f => f.selected && !f.is_sidecar);
  if (selectedFiles.length === 0) {
    bar.classList.add('hidden');
    bar.style.display = 'none';
    return;
  }

  bar.classList.remove('hidden');
  bar.style.display = 'flex';
  const countEl = document.getElementById('floating-selection-count');
  const detailsEl = document.getElementById('floating-selection-details');
  const folderLineEl = document.getElementById('floating-selection-folder-line');
  const folderNameEl = document.getElementById('floating-selection-foldername');
  const dontCopyBtn = document.getElementById('floating-btn-dont-copy');
  const dontCopyText = document.getElementById('floating-btn-dont-copy-text');

  const videoCount = selectedFiles.filter(f => f.is_video || (/\.(mp4|mov|avi|mkv|wmv|mts|m2ts|m4v|webm|flv|3gp)$/i).test(f.filename || f.path || '')).length;
  const photoCount = selectedFiles.length - videoCount;

  if (countEl) {
    countEl.innerText = `${selectedFiles.length} item${selectedFiles.length > 1 ? 's' : ''} selected`;
  }

  // Calculate unique folder(s) for selected items
  const uniqueFolderIndices = [...new Set(selectedFiles.map(f => f.folder_index))];
  if (folderLineEl && folderNameEl) {
    if (uniqueFolderIndices.length === 1) {
      const idx = uniqueFolderIndices[0];
      let name = '';
      if (idx >= 0 && sortAppState.folders && sortAppState.folders[idx]) {
        name = sortAppState.folders[idx];
      } else if (idx === -1) {
        name = 'Unmapped';
      } else {
        name = 'Unknown Folder';
      }

      const cleanPath = (name || '').replace(/\\/g, '/');
      const parts = cleanPath.split('/').filter(Boolean);
      if (parts.length >= 3) {
        const eventName = parts[0];
        const subEvent = parts.slice(1, -1).join(' / ');
        const endingPerson = parts[parts.length - 1];
        folderNameEl.innerHTML = `
          <span class="floating-crumb-path" title="${eventName}">${eventName}</span>
          <span class="floating-crumb-sep">›</span>
          <span class="floating-crumb-seq" title="${subEvent}">${subEvent}</span>
          <span class="floating-crumb-sep">›</span>
          <span class="floating-crumb-ending" title="${endingPerson}">● ${endingPerson}</span>
        `;
      } else if (parts.length === 2) {
        const eventName = parts[0];
        const endingPerson = parts[1];
        folderNameEl.innerHTML = `
          <span class="floating-crumb-path" title="${eventName}">${eventName}</span>
          <span class="floating-crumb-sep">›</span>
          <span class="floating-crumb-ending" title="${endingPerson}">● ${endingPerson}</span>
        `;
      } else {
        folderNameEl.innerText = name;
      }
      folderNameEl.title = `Folder: ${name} (Click to scroll to folder)`;
      folderLineEl.classList.remove('hidden');
      folderLineEl.onclick = function() {
        if (idx >= 0) {
          const card = document.getElementById(`folder-card-${idx}`);
          if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      };
    } else if (uniqueFolderIndices.length > 1) {
      const folderNames = uniqueFolderIndices.map(idx => {
        if (idx >= 0 && sortAppState.folders && sortAppState.folders[idx]) return sortAppState.folders[idx];
        if (idx === -1) return 'Unmapped';
        return 'Unknown Folder';
      });
      const summaryText = `${uniqueFolderIndices.length} Folders`;
      folderNameEl.innerHTML = `<span class="floating-crumb-ending">${summaryText}</span>`;
      folderNameEl.title = `Selected across folders:\n${folderNames.join('\n')}`;
      folderLineEl.classList.remove('hidden');
      folderLineEl.onclick = null;
    } else {
      folderLineEl.classList.add('hidden');
      folderLineEl.onclick = null;
    }
  }

  if (detailsEl) {
    const parts = [];
    if (videoCount > 0) parts.push(`${videoCount} video${videoCount > 1 ? 's' : ''}`);
    if (photoCount > 0) parts.push(`${photoCount} photo${photoCount > 1 ? 's' : ''}`);
    const detailText = parts.join(', ');
    detailsEl.innerText = detailText;
    const dotEl = document.getElementById('floating-selection-dot');
    if (dotEl) {
      if (detailText) dotEl.classList.remove('hidden');
      else dotEl.classList.add('hidden');
    }
  }

  const allDontCopy = selectedFiles.every(f => f.dont_copy);
  if (dontCopyBtn) {
    if (allDontCopy) dontCopyBtn.classList.add('active-dont-copy');
    else dontCopyBtn.classList.remove('active-dont-copy');
  }
  if (dontCopyText) {
    dontCopyText.innerText = allDontCopy ? 'Enable Move' : "Don't Move";
  }

  const editBtn = document.getElementById('floating-btn-edit');
  if (editBtn) {
    if (selectedFiles.length > 1) {
      editBtn.style.display = 'none';
    } else {
      editBtn.style.display = 'inline-flex';
    }
  }
};

window.toggleSelectedDontCopy = function() {
  const selectedFiles = (sortAppState.files || []).filter(f => f.selected && !f.is_sidecar);
  if (selectedFiles.length === 0) return;

  saveHistory();
  const allMarked = selectedFiles.every(f => f.dont_copy);
  selectedFiles.forEach(f => {
    f.dont_copy = !allMarked;
    f.selected = false; // Deselect video or photo immediately when toggling Don't Move
  });

  renderFolders();
  lazyLoadThumbnails();
  if (window.updateFloatingSelectionBar) window.updateFloatingSelectionBar();
  window.showToast(allMarked ? 'Selected files restored for moving.' : "Selected files marked as Don't Move.");
};

window.openEditForSelected = function() {
  const selectedFiles = (sortAppState.files || []).filter(f => f.selected && !f.is_sidecar);
  if (selectedFiles.length !== 1) {
    if (selectedFiles.length > 1 && window.showToast) {
      window.showToast('Edit dialog is unavailable when multiple files are selected. Use Don\'t Move or Deselect.', true);
    }
    return;
  }

  const firstFolderIdx = selectedFiles[0].folder_index;
  if (firstFolderIdx === undefined || firstFolderIdx < 0) return;

  window.openEditForFolder(firstFolderIdx);
};


// Drag-drop logic → 003_sorting_drag_drop.js
// Context menu logic → 003_sorting_context_menu.js


function isPhotoOnlyFolder(folderNameOrPath) {
  if (!folderNameOrPath) return false;
  return /(?:^|[\s\-_/\\.]|\d+)(MQ|H|MF)\d*(?:[\s\-_/\\.]|$)/i.test(folderNameOrPath);
}

function getNextFolderIndexForFile(file, currentFolderIdx, contribFolderIndices) {
  const isVideo = file.is_video || file.file_type === 'video' || (/\.(mp4|mov|avi|mkv|wmv|mts|m2ts|m4v|webm|flv|3gp)$/i).test(file.filename || file.path || '');
  const curPos = contribFolderIndices.indexOf(currentFolderIdx);
  if (curPos === -1) return currentFolderIdx;

  for (let p = curPos + 1; p < contribFolderIndices.length; p++) {
    const fIdx = contribFolderIndices[p];
    const folderName = sortAppState.folders[fIdx] || '';
    if (isVideo && isPhotoOnlyFolder(folderName)) {
      continue; // Skip photo-only folders (MQ, H, MF) for video files
    }
    return fIdx;
  }
  return currentFolderIdx;
}

function getPrevFolderIndexForFile(file, currentFolderIdx, contribFolderIndices) {
  const isVideo = file.is_video || file.file_type === 'video' || (/\.(mp4|mov|avi|mkv|wmv|mts|m2ts|m4v|webm|flv|3gp)$/i).test(file.filename || file.path || '');
  const curPos = contribFolderIndices.indexOf(currentFolderIdx);
  if (curPos === -1) return currentFolderIdx;

  for (let p = curPos - 1; p >= 0; p--) {
    const fIdx = contribFolderIndices[p];
    const folderName = sortAppState.folders[fIdx] || '';
    if (isVideo && isPhotoOnlyFolder(folderName)) {
      continue; // Skip photo-only folders (MQ, H, MF) for video files
    }
    return fIdx;
  }
  return currentFolderIdx;
}

function previewShift(actionType) {
  const folderIdx = sortAppState.activeShiftFolderId;
  
  if (actionType === 'shift-down') {
    window.startShiftAllDownFlow(folderIdx);
    return;
  }
  if (actionType === 'shift-up') {
    window.startShiftAllUpFlow(folderIdx);
    return;
  }
  if (actionType === 'move-down') {
    window.startMoveDownFlow(folderIdx);
    return;
  }
  if (actionType === 'move-up') {
    window.startMoveUpFlow(folderIdx);
    return;
  }
}

// ── Interactive Shift All Down Flow ──
window.startShiftAllDownFlow = function(folderIdx = null, targetFileId = null) {
  if (folderIdx === null || folderIdx === undefined || folderIdx < 0) {
    const selectedFiles = sortAppState.files.filter(f => f.selected && !f.is_sidecar);
    if (selectedFiles.length > 0) {
      folderIdx = selectedFiles[0].folder_index;
    } else {
      const firstFile = sortAppState.files.find(f => f.folder_index >= 0 && !f.is_sidecar);
      if (firstFile) folderIdx = firstFile.folder_index;
    }
  }

  if (folderIdx === null || folderIdx === undefined || folderIdx < 0) {
    window.showToast('Please select a folder or clip to shift down.', true);
    return;
  }

  const allFolderFiles = sortAppState.files.filter(f => f.folder_index === folderIdx && !f.is_sidecar);
  if (allFolderFiles.length === 0) {
    window.showToast('No clips in selected folder to shift.', true);
    return;
  }

  let selectedFilesInFolder = allFolderFiles.filter(f => f.selected);
  let firstSelected = null;

  if (targetFileId !== null && targetFileId !== undefined) {
    firstSelected = allFolderFiles.find(f => f.id === targetFileId);
  }
  if (!firstSelected && selectedFilesInFolder.length > 0) {
    firstSelected = selectedFilesInFolder[0];
  }
  if (!firstSelected) {
    firstSelected = allFolderFiles[0];
  }

  const startIdx = allFolderFiles.findIndex(f => f.id === firstSelected.id);
  const clipsToShift = allFolderFiles.slice(startIdx >= 0 ? startIdx : 0);

  if (clipsToShift.length === 0) {
    window.showToast('No clips available to shift.', true);
    return;
  }

  const cameraman = firstSelected.contributor || (window.inferContributorFromFiles ? window.inferContributorFromFiles([firstSelected]) : null) || 'ALL';
  const contribFolderIndices = getContributorFolderIndices(cameraman);

  if (contribFolderIndices.length <= 1) {
    window.showToast(`No subsequent folders found for contributor "${cameraman}".`, true);
    return;
  }

  const targetFolderIdx = getNextFolderIndexForFile(firstSelected, folderIdx, contribFolderIndices);

  if (targetFolderIdx === folderIdx || targetFolderIdx < 0 || contribFolderIndices.indexOf(targetFolderIdx) <= contribFolderIndices.indexOf(folderIdx)) {
    window.showToast(`Cannot shift down: already in the last folder for contributor "${cameraman}".`, true);
    return;
  }

  const sourceFolderName = (sortAppState.folders && sortAppState.folders[folderIdx])
    ? sortAppState.folders[folderIdx]
    : ('Folder ' + folderIdx);
  const targetFolderName = (sortAppState.folders && sortAppState.folders[targetFolderIdx])
    ? sortAppState.folders[targetFolderIdx]
    : ('Folder ' + targetFolderIdx);

  const shiftState = {
    sourceFolderIdx: folderIdx,
    sourceFolderName: sourceFolderName,
    targetFolderIdx: targetFolderIdx,
    targetFolderName: targetFolderName,
    clipsToShift: clipsToShift,
    firstClipName: firstSelected.filename || (firstSelected.path ? firstSelected.path.split(/[\\/]/).pop() : 'Clip'),
    contributor: cameraman
  };

  closeModal();
  window.executeShiftAllDown(shiftState);
};

window.executeShiftAllDown = function(shiftState) {
  if (!shiftState || !shiftState.clipsToShift || shiftState.clipsToShift.length === 0) return;

  saveHistory();

  const contributor = shiftState.contributor;
  const contribFolderIndices = getContributorFolderIndices(contributor);
  const targetFolderIdx = shiftState.targetFolderIdx;
  const posTarget = contribFolderIndices.indexOf(targetFolderIdx);

  if (posTarget === -1) {
    if (window.showToast) window.showToast('Selected folder is not in contributor\'s folder sequence.', true);
    sortAppState.pendingShiftDownState = null;
    return;
  }

  const shiftClipIds = new Set(shiftState.clipsToShift.map(c => c.id));

  // Snapshot files in each contributor folder from posTarget to end BEFORE moving
  const existingFilesByFolder = {};
  for (let k = posTarget; k < contribFolderIndices.length; k++) {
    const fIdx = contribFolderIndices[k];
    existingFilesByFolder[fIdx] = sortAppState.files.filter(f =>
      f.contributor === contributor &&
      f.folder_index === fIdx &&
      !shiftClipIds.has(f.id)
    );
  }

  // 1. Move clipsToShift to targetFolderIdx
  sortAppState.files.forEach(f => {
    if (shiftClipIds.has(f.id)) {
      f.folder_index = targetFolderIdx;
      f.selected = false;
    }
  });

  // 2. Cascade existing files down the contributor folder chain
  for (let k = posTarget; k < contribFolderIndices.length; k++) {
    const fIdx = contribFolderIndices[k];
    const preExistingClips = existingFilesByFolder[fIdx] || [];

    preExistingClips.forEach(origFile => {
      const f = sortAppState.files.find(item => item.id === origFile.id);
      if (f) {
        f.folder_index = getNextFolderIndexForFile(f, fIdx, contribFolderIndices);
        f.selected = false;
      }
    });
  }

  sanitizeVideoFolderAssignments();

  // Compute detailed changes
  const lastHistory = sortAppState.history.length > 0 ? sortAppState.history[sortAppState.history.length - 1] : null;
  const changes = [];
  sortAppState.files.forEach(f => {
    const orig = lastHistory ? lastHistory.files.find(h => h.id === f.id) : null;
    if (orig && orig.folder_index !== f.folder_index) {
      const fromFolder = orig.folder_index === -1 ? 'Unmapped' : (sortAppState.folders[orig.folder_index] || 'Unknown');
      const toFolder = f.folder_index === -1 ? 'Unmapped' : (sortAppState.folders[f.folder_index] || 'Unknown');
      changes.push({
        filename: f.filename || (f.path ? f.path.split(/[\\/]/).pop() : 'File'),
        from: fromFolder,
        to: toFolder,
        contributor: f.contributor || contributor
      });
    }
  });

  sortAppState.pendingShiftDownState = null;
  sortAppState.files.forEach(f => f.selected = false);

  renderFolders();
  lazyLoadThumbnails();
  if (window.updateFloatingSelectionBar) window.updateFloatingSelectionBar();

  if (changes.length > 0) {
    const targetDisplay = window.getEventNameFromFolder ? window.getEventNameFromFolder(shiftState.targetFolderName) : shiftState.targetFolderName;
    if (window.showToast) window.showToast(`⚡ Shift All Down applied: ${changes.length} file(s) shifted to ${targetDisplay} and cascaded.`);
  } else {
    if (window.showToast) window.showToast('No file assignment changes were made.');
  }
};

// ── Interactive Shift All Up Flow ──
window.startShiftAllUpFlow = function(folderIdx = null, targetFileId = null) {
  if (folderIdx === null || folderIdx === undefined || folderIdx < 0) {
    const selectedFiles = sortAppState.files.filter(f => f.selected && !f.is_sidecar);
    if (selectedFiles.length > 0) {
      folderIdx = selectedFiles[0].folder_index;
    } else {
      const firstFile = sortAppState.files.find(f => f.folder_index >= 0 && !f.is_sidecar);
      if (firstFile) folderIdx = firstFile.folder_index;
    }
  }

  if (folderIdx === null || folderIdx === undefined || folderIdx < 0) {
    window.showToast('Please select a folder or clip to shift up.', true);
    return;
  }

  const allFolderFiles = sortAppState.files.filter(f => f.folder_index === folderIdx && !f.is_sidecar);
  if (allFolderFiles.length === 0) {
    window.showToast('No clips in selected folder to shift.', true);
    return;
  }

  let selectedFilesInFolder = allFolderFiles.filter(f => f.selected);
  let lastSelected = null;

  if (targetFileId !== null && targetFileId !== undefined) {
    lastSelected = allFolderFiles.find(f => f.id === targetFileId);
  }
  if (!lastSelected && selectedFilesInFolder.length > 0) {
    lastSelected = selectedFilesInFolder[selectedFilesInFolder.length - 1];
  }
  if (!lastSelected) {
    lastSelected = allFolderFiles[allFolderFiles.length - 1];
  }

  const endIdx = allFolderFiles.findIndex(f => f.id === lastSelected.id);
  const clipsToShift = allFolderFiles.slice(0, endIdx >= 0 ? endIdx + 1 : allFolderFiles.length);

  if (clipsToShift.length === 0) {
    window.showToast('No clips available to shift.', true);
    return;
  }

  const cameraman = lastSelected.contributor || (window.inferContributorFromFiles ? window.inferContributorFromFiles([lastSelected]) : null) || 'ALL';
  const contribFolderIndices = getContributorFolderIndices(cameraman);

  if (contribFolderIndices.length <= 1) {
    window.showToast(`No preceding folders found for contributor "${cameraman}".`, true);
    return;
  }

  const targetFolderIdx = getPrevFolderIndexForFile(lastSelected, folderIdx, contribFolderIndices);

  if (targetFolderIdx === folderIdx || targetFolderIdx < 0 || contribFolderIndices.indexOf(targetFolderIdx) >= contribFolderIndices.indexOf(folderIdx)) {
    window.showToast(`Cannot shift up: already in the first folder for contributor "${cameraman}".`, true);
    return;
  }

  const sourceFolderName = (sortAppState.folders && sortAppState.folders[folderIdx])
    ? sortAppState.folders[folderIdx]
    : ('Folder ' + folderIdx);
  const targetFolderName = (sortAppState.folders && sortAppState.folders[targetFolderIdx])
    ? sortAppState.folders[targetFolderIdx]
    : ('Folder ' + targetFolderIdx);

  const shiftState = {
    sourceFolderIdx: folderIdx,
    sourceFolderName: sourceFolderName,
    targetFolderIdx: targetFolderIdx,
    targetFolderName: targetFolderName,
    clipsToShift: clipsToShift,
    lastClipName: lastSelected.filename || (lastSelected.path ? lastSelected.path.split(/[\\/]/).pop() : 'Clip'),
    contributor: cameraman
  };

  closeModal();
  window.executeShiftAllUp(shiftState);
};

window.executeShiftAllUp = function(shiftState) {
  if (!shiftState || !shiftState.clipsToShift || shiftState.clipsToShift.length === 0) return;

  saveHistory();

  const contributor = shiftState.contributor;
  const contribFolderIndices = getContributorFolderIndices(contributor);
  const targetFolderIdx = shiftState.targetFolderIdx;
  const posTarget = contribFolderIndices.indexOf(targetFolderIdx);

  if (posTarget === -1) {
    if (window.showToast) window.showToast('Selected folder is not in contributor\'s folder sequence.', true);
    sortAppState.pendingShiftUpState = null;
    return;
  }

  const shiftClipIds = new Set(shiftState.clipsToShift.map(c => c.id));

  // Snapshot files in each contributor folder from posTarget down to 0 BEFORE moving
  const existingFilesByFolder = {};
  for (let k = posTarget; k >= 0; k--) {
    const fIdx = contribFolderIndices[k];
    existingFilesByFolder[fIdx] = sortAppState.files.filter(f =>
      f.contributor === contributor &&
      f.folder_index === fIdx &&
      !shiftClipIds.has(f.id)
    );
  }

  // 1. Move clipsToShift to targetFolderIdx
  sortAppState.files.forEach(f => {
    if (shiftClipIds.has(f.id)) {
      f.folder_index = targetFolderIdx;
      f.selected = false;
    }
  });

  // 2. Cascade existing files UP the contributor folder chain
  for (let k = posTarget; k >= 0; k--) {
    const fIdx = contribFolderIndices[k];
    const preExistingClips = existingFilesByFolder[fIdx] || [];

    preExistingClips.forEach(origFile => {
      const f = sortAppState.files.find(item => item.id === origFile.id);
      if (f) {
        f.folder_index = getPrevFolderIndexForFile(f, fIdx, contribFolderIndices);
        f.selected = false;
      }
    });
  }

  sanitizeVideoFolderAssignments();

  // Compute detailed changes
  const lastHistory = sortAppState.history.length > 0 ? sortAppState.history[sortAppState.history.length - 1] : null;
  const changes = [];
  sortAppState.files.forEach(f => {
    const orig = lastHistory ? lastHistory.files.find(h => h.id === f.id) : null;
    if (orig && orig.folder_index !== f.folder_index) {
      const fromFolder = orig.folder_index === -1 ? 'Unmapped' : (sortAppState.folders[orig.folder_index] || 'Unknown');
      const toFolder = f.folder_index === -1 ? 'Unmapped' : (sortAppState.folders[f.folder_index] || 'Unknown');
      changes.push({
        filename: f.filename || (f.path ? f.path.split(/[\\/]/).pop() : 'File'),
        from: fromFolder,
        to: toFolder,
        contributor: f.contributor || contributor
      });
    }
  });

  sortAppState.pendingShiftUpState = null;
  sortAppState.files.forEach(f => f.selected = false);

  renderFolders();
  lazyLoadThumbnails();
  if (window.updateFloatingSelectionBar) window.updateFloatingSelectionBar();

  if (changes.length > 0) {
    const targetDisplay = window.getEventNameFromFolder ? window.getEventNameFromFolder(shiftState.targetFolderName) : shiftState.targetFolderName;
    if (window.showToast) window.showToast(`⚡ Shift All Up applied: ${changes.length} file(s) shifted to ${targetDisplay} and cascaded.`);
  } else {
    if (window.showToast) window.showToast('No file assignment changes were made.');
  }
};

// ── Interactive Move Up Flow (Files 1..N to Previous Contributor Folder, No Cascade) ──
window.startMoveUpFlow = function(folderIdx = null, targetFileId = null) {
  if (folderIdx === null || folderIdx === undefined || folderIdx < 0) {
    const selectedFiles = sortAppState.files.filter(f => f.selected && !f.is_sidecar);
    if (selectedFiles.length > 0) {
      folderIdx = selectedFiles[0].folder_index;
    } else {
      const firstFile = sortAppState.files.find(f => f.folder_index >= 0 && !f.is_sidecar);
      if (firstFile) folderIdx = firstFile.folder_index;
    }
  }

  if (folderIdx === null || folderIdx === undefined || folderIdx < 0) {
    window.showToast('Please select a folder or file to move up.', true);
    return;
  }

  const allFolderFiles = sortAppState.files.filter(f => f.folder_index === folderIdx && !f.is_sidecar);
  if (allFolderFiles.length === 0) {
    window.showToast('No files in selected folder to move.', true);
    return;
  }

  let selectedFilesInFolder = allFolderFiles.filter(f => f.selected);
  let targetFile = null;

  if (targetFileId !== null && targetFileId !== undefined) {
    targetFile = allFolderFiles.find(f => f.id === targetFileId);
  }
  if (!targetFile && selectedFilesInFolder.length > 0) {
    targetFile = selectedFilesInFolder[0];
  }
  if (!targetFile) {
    targetFile = allFolderFiles[0];
  }

  const endIdx = allFolderFiles.findIndex(f => f.id === targetFile.id);
  // Files 1 to N (from start of folder up to selected file)
  const clipsToMove = allFolderFiles.slice(0, endIdx >= 0 ? endIdx + 1 : allFolderFiles.length);

  if (clipsToMove.length === 0) {
    window.showToast('No files available to move.', true);
    return;
  }

  const cameraman = targetFile.contributor || (window.inferContributorFromFiles ? window.inferContributorFromFiles([targetFile]) : null) || 'ALL';
  const contribFolderIndices = getContributorFolderIndices(cameraman);

  if (contribFolderIndices.length <= 1) {
    window.showToast(`No preceding folders found for contributor "${cameraman}".`, true);
    return;
  }

  const targetFolderIdx = getPrevFolderIndexForFile(targetFile, folderIdx, contribFolderIndices);

  if (targetFolderIdx === folderIdx || targetFolderIdx < 0 || contribFolderIndices.indexOf(targetFolderIdx) >= contribFolderIndices.indexOf(folderIdx)) {
    window.showToast(`Cannot move up: already in the first folder for contributor "${cameraman}".`, true);
    return;
  }

  const sourceFolderName = (sortAppState.folders && sortAppState.folders[folderIdx])
    ? sortAppState.folders[folderIdx]
    : ('Folder ' + folderIdx);
  const targetFolderName = (sortAppState.folders && sortAppState.folders[targetFolderIdx])
    ? sortAppState.folders[targetFolderIdx]
    : ('Folder ' + targetFolderIdx);

  const moveState = {
    sourceFolderIdx: folderIdx,
    sourceFolderName: sourceFolderName,
    targetFolderIdx: targetFolderIdx,
    targetFolderName: targetFolderName,
    clipsToMove: clipsToMove,
    targetFileName: targetFile.filename || (targetFile.path ? targetFile.path.split(/[\\/]/).pop() : 'Clip'),
    contributor: cameraman
  };

  closeModal();
  window.executeMoveUp(moveState);
};

window.executeMoveUp = function(moveState) {
  if (!moveState || !moveState.clipsToMove || moveState.clipsToMove.length === 0) return;

  saveHistory();

  const contributor = moveState.contributor;
  const targetFolderIdx = moveState.targetFolderIdx;
  const moveClipIds = new Set(moveState.clipsToMove.map(c => c.id));

  // Only move the clipsToMove to targetFolderIdx.
  // Existing files in target folder and other folders are untouched (no ripple cascade).
  sortAppState.files.forEach(f => {
    if (moveClipIds.has(f.id)) {
      f.folder_index = targetFolderIdx;
      f.selected = false;
    }
  });

  sanitizeVideoFolderAssignments();

  // Compute detailed changes
  const lastHistory = sortAppState.history.length > 0 ? sortAppState.history[sortAppState.history.length - 1] : null;
  const changes = [];
  sortAppState.files.forEach(f => {
    const orig = lastHistory ? lastHistory.files.find(h => h.id === f.id) : null;
    if (orig && orig.folder_index !== f.folder_index) {
      const fromFolder = orig.folder_index === -1 ? 'Unmapped' : (sortAppState.folders[orig.folder_index] || 'Unknown');
      const toFolder = f.folder_index === -1 ? 'Unmapped' : (sortAppState.folders[f.folder_index] || 'Unknown');
      changes.push({
        filename: f.filename || (f.path ? f.path.split(/[\\/]/).pop() : 'File'),
        from: fromFolder,
        to: toFolder,
        contributor: f.contributor || contributor
      });
    }
  });

  sortAppState.files.forEach(f => f.selected = false);

  renderFolders();
  lazyLoadThumbnails();
  if (window.updateFloatingSelectionBar) window.updateFloatingSelectionBar();

  if (changes.length > 0) {
    const targetDisplay = window.getEventNameFromFolder ? window.getEventNameFromFolder(moveState.targetFolderName) : moveState.targetFolderName;
    if (window.showToast) window.showToast(`Moved ${changes.length} file(s) up into ${targetDisplay}.`);
  } else {
    if (window.showToast) window.showToast('No file assignment changes were made.');
  }
};

// ── Interactive Move Down Flow (Files N..End to Next Contributor Folder, No Cascade) ──
window.startMoveDownFlow = function(folderIdx = null, targetFileId = null) {
  if (folderIdx === null || folderIdx === undefined || folderIdx < 0) {
    const selectedFiles = sortAppState.files.filter(f => f.selected && !f.is_sidecar);
    if (selectedFiles.length > 0) {
      folderIdx = selectedFiles[0].folder_index;
    } else {
      const firstFile = sortAppState.files.find(f => f.folder_index >= 0 && !f.is_sidecar);
      if (firstFile) folderIdx = firstFile.folder_index;
    }
  }

  if (folderIdx === null || folderIdx === undefined || folderIdx < 0) {
    window.showToast('Please select a folder or file to move down.', true);
    return;
  }

  const allFolderFiles = sortAppState.files.filter(f => f.folder_index === folderIdx && !f.is_sidecar);
  if (allFolderFiles.length === 0) {
    window.showToast('No files in selected folder to move.', true);
    return;
  }

  let selectedFilesInFolder = allFolderFiles.filter(f => f.selected);
  let targetFile = null;

  if (targetFileId !== null && targetFileId !== undefined) {
    targetFile = allFolderFiles.find(f => f.id === targetFileId);
  }
  if (!targetFile && selectedFilesInFolder.length > 0) {
    targetFile = selectedFilesInFolder[0];
  }
  if (!targetFile) {
    targetFile = allFolderFiles[0];
  }

  const startIdx = allFolderFiles.findIndex(f => f.id === targetFile.id);
  // Files N to End (from selected file index to end of folder)
  const clipsToMove = allFolderFiles.slice(startIdx >= 0 ? startIdx : 0);

  if (clipsToMove.length === 0) {
    window.showToast('No files available to move.', true);
    return;
  }

  const cameraman = targetFile.contributor || (window.inferContributorFromFiles ? window.inferContributorFromFiles([targetFile]) : null) || 'ALL';
  const contribFolderIndices = getContributorFolderIndices(cameraman);

  if (contribFolderIndices.length <= 1) {
    window.showToast(`No subsequent folders found for contributor "${cameraman}".`, true);
    return;
  }

  const targetFolderIdx = getNextFolderIndexForFile(targetFile, folderIdx, contribFolderIndices);

  if (targetFolderIdx === folderIdx || targetFolderIdx < 0 || contribFolderIndices.indexOf(targetFolderIdx) <= contribFolderIndices.indexOf(folderIdx)) {
    window.showToast(`Cannot move down: already in the last folder for contributor "${cameraman}".`, true);
    return;
  }

  const sourceFolderName = (sortAppState.folders && sortAppState.folders[folderIdx])
    ? sortAppState.folders[folderIdx]
    : ('Folder ' + folderIdx);
  const targetFolderName = (sortAppState.folders && sortAppState.folders[targetFolderIdx])
    ? sortAppState.folders[targetFolderIdx]
    : ('Folder ' + targetFolderIdx);

  const moveState = {
    sourceFolderIdx: folderIdx,
    sourceFolderName: sourceFolderName,
    targetFolderIdx: targetFolderIdx,
    targetFolderName: targetFolderName,
    clipsToMove: clipsToMove,
    targetFileName: targetFile.filename || (targetFile.path ? targetFile.path.split(/[\\/]/).pop() : 'Clip'),
    contributor: cameraman
  };

  closeModal();
  window.executeMoveDown(moveState);
};

window.executeMoveDown = function(moveState) {
  if (!moveState || !moveState.clipsToMove || moveState.clipsToMove.length === 0) return;

  saveHistory();

  const contributor = moveState.contributor;
  const targetFolderIdx = moveState.targetFolderIdx;
  const moveClipIds = new Set(moveState.clipsToMove.map(c => c.id));

  // Only move the clipsToMove to targetFolderIdx (isolated move inside contributor's next folder).
  // Existing files in target folder and other folders are untouched (no ripple cascade).
  sortAppState.files.forEach(f => {
    if (moveClipIds.has(f.id)) {
      f.folder_index = targetFolderIdx;
      f.selected = false;
    }
  });

  sanitizeVideoFolderAssignments();

  // Compute detailed changes
  const lastHistory = sortAppState.history.length > 0 ? sortAppState.history[sortAppState.history.length - 1] : null;
  const changes = [];
  sortAppState.files.forEach(f => {
    const orig = lastHistory ? lastHistory.files.find(h => h.id === f.id) : null;
    if (orig && orig.folder_index !== f.folder_index) {
      const fromFolder = orig.folder_index === -1 ? 'Unmapped' : (sortAppState.folders[orig.folder_index] || 'Unknown');
      const toFolder = f.folder_index === -1 ? 'Unmapped' : (sortAppState.folders[f.folder_index] || 'Unknown');
      changes.push({
        filename: f.filename || (f.path ? f.path.split(/[\\/]/).pop() : 'File'),
        from: fromFolder,
        to: toFolder,
        contributor: f.contributor || contributor
      });
    }
  });

  sortAppState.files.forEach(f => f.selected = false);

  renderFolders();
  lazyLoadThumbnails();
  if (window.updateFloatingSelectionBar) window.updateFloatingSelectionBar();

  if (changes.length > 0) {
    const targetDisplay = window.getEventNameFromFolder ? window.getEventNameFromFolder(moveState.targetFolderName) : moveState.targetFolderName;
    if (window.showToast) window.showToast(`Moved ${changes.length} file(s) down into ${targetDisplay}.`);
  } else {
    if (window.showToast) window.showToast('No file assignment changes were made.');
  }
};

function showReadableChangesReport(changes, cameraman, sourceFolder, targetFolder, actionTitle = 'Shift All') {
  const body = document.getElementById('report-modal-body');
  if (!body) return;

  const groupedByTarget = {};
  changes.forEach(c => {
    if (!groupedByTarget[c.to]) groupedByTarget[c.to] = [];
    groupedByTarget[c.to].push(c);
  });

  let html = `<div style="font-family: inherit;">`;
  html += `<div style="background: rgba(79,70,229,0.1); border:1px solid rgba(79,70,229,0.25); border-radius:10px; padding:0.85rem; margin-bottom:1rem; text-align:center;">`;
  html += `<div style="font-weight:800; color:var(--text-primary); font-size:0.95rem;">⚡ ${actionTitle} Summary (${cameraman || 'Contributor'})</div>`;
  html += `<div style="font-size:0.82rem; color:var(--text-muted); margin-top:4px;">Shifted <strong>${changes.length}</strong> file(s) across <strong>${Object.keys(groupedByTarget).length}</strong> folder(s)</div>`;
  html += `</div>`;

  Object.keys(groupedByTarget).forEach(toFolder => {
    const items = groupedByTarget[toFolder];
    const toFolderEvent = window.getEventNameFromFolder ? window.getEventNameFromFolder(toFolder) : toFolder;
    const toFolderShort = toFolder.split(/[\\/]/).pop() || toFolder;

    html += `<div style="margin-bottom:1rem; background:var(--bg-glass-card); border:1px solid var(--border-glass); border-radius:10px; padding:0.75rem 0.9rem;">`;
    html += `<div style="font-weight:700; color:#38bdf8; font-size:0.88rem; display:flex; align-items:center; justify-content:space-between; margin-bottom:0.5rem;">`;
    html += `<span>📁 Target Folder: <strong>${toFolderEvent}</strong> <span style="font-weight:400; opacity:0.75; font-size:0.78rem;">(${toFolderShort})</span></span>`;
    html += `<span style="background:rgba(56,189,248,0.15); padding:2px 8px; border-radius:12px; font-size:0.75rem;">${items.length} file${items.length > 1 ? 's' : ''}</span>`;
    html += `</div>`;
    html += `<ul style="margin:0; padding-left:1.2rem; line-height:1.6; font-size:0.83rem;">`;
    items.forEach(c => {
      const fromEvent = window.getEventNameFromFolder ? window.getEventNameFromFolder(c.from) : c.from;
      html += `<li style="margin-bottom:0.35rem; color:var(--text-primary);">`;
      html += `<strong>${c.filename}</strong>`;
      html += `<div style="font-size:0.78rem; color:var(--text-muted); display:flex; gap:0.5rem; align-items:center; margin-top:1px;">`;
      html += `<span style="color:#ef4444;">from: <code>${fromEvent}</code></span> ➔ `;
      html += `<span style="color:#10b981;">to: <code>${toFolderEvent}</code></span>`;
      html += `</div>`;
      html += `</li>`;
    });
    html += `</ul>`;
    html += `</div>`;
  });

  html += `</div>`;
  body.innerHTML = html;

  const reportTitle = document.querySelector('#report-modal .card-title');
  if (reportTitle) reportTitle.innerText = `⚡ ${actionTitle} Report`;
  document.getElementById('report-modal').style.display = 'flex';
}
window.showReadableChangesReport = showReadableChangesReport;

function showPreviewModal(changes) {
  const body = document.getElementById('preview-modal-body');
  let html = '<ul style="margin:0; padding-left:20px; line-height:1.6;">';
  changes.forEach(c => {
    html += `<li class="mb-2"><strong>${c.filename}</strong>: <br><span style="color:var(--accent-red);">from:</span> <code>${c.from}</code><br><span style="color:var(--accent-green);">to:</span> <code>${c.to}</code></li>`;
  });
  html += '</ul>';
  body.innerHTML = html;
  document.getElementById('preview-modal').style.display = 'flex';
}

function confirmPreview() {
  if (!sortAppState.pendingShift) return;
  saveHistory();
  sortAppState.files = sortAppState.pendingShift.previewFiles;
  const changes = sortAppState.pendingShift.changes;
  sortAppState.pendingShift = null;
  document.getElementById('preview-modal').style.display = 'none';
  sortAppState.files.forEach(f => f.selected = false);
  renderFolders();
  lazyLoadThumbnails();
  if (changes.length > 0) showReadableChangesReport(changes, '', '', '');
  window.showToast(`Applied ${changes.length} change(s).`);
}

function cancelPreview() {
  sortAppState.pendingShift = null;
  document.getElementById('preview-modal').style.display = 'none';
  window.showToast('Changes cancelled.');
}

function showChangesReport(changes) {
  showReadableChangesReport(changes, '', '', '');
}

function closeReportModal() { document.getElementById('report-modal').style.display = 'none'; }
function undoFromReport() { closeReportModal(); undo(); }

function formatFolderDisplay(folderPath, folderContrib, camColor, isEmptyGlobally) {
  const cleanPath = (folderPath || '').replace(/\\/g, '/');
  const parts = cleanPath.split('/').filter(Boolean);
  
  if (parts.length >= 3) {
    const eventName = parts[0];
    const subEvent = parts.slice(1, -1).join(' / ');
    const contributor = parts[parts.length - 1];
    return `
      <div class="folder-title-box">
        <span class="folder-event-crumb" title="${eventName}">${eventName}</span>
        <span class="folder-crumb-slash">›</span>
        <span class="folder-subevent-badge" title="${subEvent}">${subEvent}</span>
        <span class="folder-cameraman-pill" style="border-color:${camColor.hex}44; background:${camColor.hex}14; color:${camColor.hex};">
          <span class="cameraman-pill-dot" style="background:${camColor.hex};"></span>
          ${contributor}
        </span>
      </div>
    `;
  } else if (parts.length === 2) {
    const eventName = parts[0];
    const subEvent = parts[1];
    return `
      <div class="folder-title-box">
        <span class="folder-event-crumb" title="${eventName}">${eventName}</span>
        <span class="folder-crumb-slash">›</span>
        <span class="folder-subevent-badge" title="${subEvent}">${subEvent}</span>
        ${folderContrib ? `
        <span class="folder-cameraman-pill" style="border-color:${camColor.hex}44; background:${camColor.hex}14; color:${camColor.hex};">
          <span class="cameraman-pill-dot" style="background:${camColor.hex};"></span>
          ${folderContrib}
        </span>` : ''}
      </div>
    `;
  } else {
    return `
      <div class="folder-title-box">
        <span class="folder-subevent-badge" title="${folderPath}">${folderPath}</span>
        ${folderContrib ? `
        <span class="folder-cameraman-pill" style="border-color:${camColor.hex}44; background:${camColor.hex}14; color:${camColor.hex};">
          <span class="cameraman-pill-dot" style="background:${camColor.hex};"></span>
          ${folderContrib}
        </span>` : ''}
      </div>
    `;
  }
}

function renderFolders() {
  const container = document.getElementById('folders-container');
  container.innerHTML = '';
  
  const query = (sortAppState.searchQuery || '').toLowerCase().trim();

  function folderMatchesSearch(folderIdx) {
    if (!query) return true;
    if (folderIdx < 0 || folderIdx >= sortAppState.folders.length) return false;
    const pathStr = (sortAppState.folders[folderIdx] || '').toLowerCase();
    const evtStr = (window.getEventNameFromFolder ? window.getEventNameFromFolder(pathStr) : pathStr.split(/[/\\]/).pop()).toLowerCase();
    return pathStr.includes(query) || evtStr.includes(query);
  }

  let filteredFiles = sortAppState.files.filter(f => {
    if (f.is_sidecar) return false;
    if (sortAppState.selectedContributor !== 'ALL' && f.contributor !== sortAppState.selectedContributor) return false;
    
    const isVideo = f.is_video || (/\.(mp4|mov|avi|mkv|wmv|mts|m2ts|m4v|webm|flv|3gp)$/i).test(f.filename || f.path || '');
    if (sortAppState.selectedMediaType === 'VIDEO' && !isVideo) return false;
    if (sortAppState.selectedMediaType === 'PHOTO' && isVideo) return false;

    if (query) {
      const fn = (f.filename || '').toLowerCase();
      const fp = (f.path || '').toLowerCase();
      const matchFile = fn.includes(query) || fp.includes(query);
      const matchFolder = folderMatchesSearch(f.folder_index);
      return matchFile || matchFolder;
    }
    return true;
  });

  // Visible files = non-sidecar files (sidecars stay in data model but are hidden from UI)
  const visibleFiltered = filteredFiles.filter(f => !f.is_sidecar);
  
  const searchInfo = document.getElementById('search-results-info');
  if (searchInfo) {
    searchInfo.innerText = query ? `${visibleFiltered.length} file${visibleFiltered.length !== 1 ? 's' : ''} matching "${query}"` : '';
  }
  
  let filesByFolder = {};
  sortAppState.folders.forEach((_, idx) => filesByFolder[idx] = []);
  filesByFolder[-1] = [];
  
  visibleFiltered.forEach(f => {
    let idx = f.folder_index;
    if (idx === undefined || idx < 0 || idx >= sortAppState.folders.length) filesByFolder[-1].push(f);
    else filesByFolder[idx].push(f);
  });
  sortAppState.filesByFolder = filesByFolder;
  
  // Filter buttons update
  const filterContainer = document.getElementById('contributor-filters');
  filterContainer.innerHTML = '';
  
  const allBtn = document.getElementById('btn-filter-all');
  if (allBtn) {
    if (sortAppState.selectedContributor === 'ALL') allBtn.classList.add('active');
    else allBtn.classList.remove('active');
  }
  
  Object.keys(sortAppState.contributors).forEach(c => {
    const cColor = window.getCameramanColor(c);
    const btn = document.createElement('button');
    btn.className = `btn btn-secondary w-full text-left justify-start mb-1 ${sortAppState.selectedContributor === c ? 'active' : ''}`;
    btn.title = c;
    btn.innerHTML = `<span class="cameraman-filter-dot" style="background-color:${cColor.hex}; box-shadow:0 0 8px ${cColor.hex};"></span><span>${c}</span>`;
    btn.onclick = () => filterContributor(c);
    filterContainer.appendChild(btn);
  });
  
  // Update statistics (show only visible, non-sidecar counts)
  const visibleTotal = sortAppState.files.filter(f => !f.is_sidecar);
  document.getElementById('stat-total-files').innerText = visibleTotal.length;
  document.getElementById('stat-excluded').innerText = sortAppState.files.filter(f => f.dont_copy && !f.is_sidecar).length;
  document.getElementById('stat-total-folders').innerText = sortAppState.folders.length;
  
  const allFilesByFolder = {};
  sortAppState.folders.forEach((_, idx) => allFilesByFolder[idx] = 0);
  sortAppState.files.forEach(f => {
    if (!f.is_sidecar && f.folder_index >= 0 && f.folder_index < sortAppState.folders.length) allFilesByFolder[f.folder_index]++;
  });
  
  const folderOrder = Object.keys(filesByFolder).map(Number).sort((a, b) => a - b);
  
  folderOrder.forEach(folderIdx => {
    if (folderIdx === -1) return;
    
    const folderFiles = filesByFolder[folderIdx] || [];
    const folderPath = sortAppState.folders[folderIdx] || '';
    const matchFolder = folderMatchesSearch(folderIdx);

    const isEmpty = folderFiles.length === 0;
    const totalUnfiltered = allFilesByFolder[folderIdx] || 0;
    const isEmptyGlobally = totalUnfiltered === 0;
    const isCollapsed = sortAppState.collapsedFolders[folderIdx] !== undefined 
      ? sortAppState.collapsedFolders[folderIdx] 
      : isEmptyGlobally;
    
    if (query && !matchFolder && isEmpty) return;
    
    const selectedInFolder = folderFiles.filter(f => f.selected).length;
    const allSelectedDontCopy = selectedInFolder > 0 && folderFiles.filter(f => f.selected).every(f => f.dont_copy);
    const allSelectedTotal = visibleTotal.filter(f => f.selected).length;
    const editDisabled = !(selectedInFolder === 1 && allSelectedTotal === 1);
    const dontCopyDisabled = selectedInFolder === 0;

    const videoCount = folderFiles.filter(f => f.is_video || (/\.(mp4|mov|avi|mkv|wmv|mts|m2ts|m4v|webm|flv|3gp)$/i).test(f.filename || f.path || '')).length;
    const photoCount = folderFiles.length - videoCount;

    const folderContrib = window.getContributorFromFolder ? window.getContributorFromFolder(folderPath) : '';
    const camColor = window.getCameramanColor(folderContrib);

    let folderIconSVG = `<svg width="15" height="15" fill="none" stroke="${isEmptyGlobally ? '#64748b' : camColor.hex}" stroke-width="2" viewBox="0 0 24 24"><path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/></svg>`;
    let folderBadgeHTML = isEmptyGlobally
      ? `<span class="folder-type-badge badge-empty"><svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg> Empty</span>`
      : `<span class="folder-type-badge badge-count"><svg width="11" height="11" fill="currentColor" viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg> ${folderFiles.length} file${folderFiles.length !== 1 ? 's' : ''}</span>`;

    const card = document.createElement('div');
    card.className = `folder-card ${isCollapsed ? 'collapsed' : ''} ${isEmptyGlobally ? 'empty-folder' : ''}`;
    card.id = `folder-card-${folderIdx}`;

    if (!isEmptyGlobally) {
      card.style.setProperty('--cam-color', camColor.hex);
      const rgb = hexToRgb(camColor.hex);
      card.style.setProperty('--cam-rgb', rgb);
    }
    
    // Header
    const header = document.createElement('div');
    header.className = 'folder-card-header';

    header.onclick = (e) => { if (!e.target.closest('.folder-header-actions')) toggleFolderCollapse(folderIdx); };
    header.oncontextmenu = (e) => {
      e.preventDefault();
      e.stopPropagation();
    };
    
    const folderDisplayHTML = formatFolderDisplay(folderPath, folderContrib, camColor, isEmptyGlobally);

    let headerHTML = `
      <div class="folder-header-left flex align-center gap-2" style="flex: 1; min-width: 0;">
        <span class="folder-toggle-icon"><svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg></span>
        <span class="folder-icon" style="display:inline-flex; align-items:center; opacity:0.9;">${folderIconSVG}</span>
        ${folderDisplayHTML}
        ${folderBadgeHTML}
      </div>
      <div class="folder-header-actions">
        ${isEmptyGlobally ? `
          <span class="folder-empty-notice-tag">No media</span>
        ` : `
          <div class="folder-action-pill-group">
            <button class="folder-pill-btn" onclick="event.stopPropagation(); window.selectFolderFiles(${folderIdx}, 'all')">All</button>
            <button class="folder-pill-btn" onclick="event.stopPropagation(); window.selectFolderFiles(${folderIdx}, 'videos')">Videos</button>
            <button class="folder-pill-btn" onclick="event.stopPropagation(); window.selectFolderFiles(${folderIdx}, 'none')">Clear</button>
          </div>
          <button class="folder-micro-btn edit-micro-btn" ${editDisabled ? 'disabled' : ''} onclick="event.stopPropagation(); window.openEditForFolder(${folderIdx})" title="Reassign Sequence / Shift">
            <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            <span>Edit</span>
          </button>
          <button class="folder-micro-btn dontcopy-micro-btn ${allSelectedDontCopy ? 'active-dont-copy' : ''}" ${dontCopyDisabled ? 'disabled' : ''} onclick="event.stopPropagation(); window.toggleDontCopyForFolder(${folderIdx})" title="Exclude from moving">
            <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>
            <span>Don't Move</span>
          </button>
        `}
      </div>`;
    header.innerHTML = headerHTML;
    card.appendChild(header);
    
    // Body
    const body = document.createElement('div');
    body.className = 'folder-card-body';
    
    if (isEmptyGlobally) {
      body.innerHTML = `<div class="text-center text-muted text-sm py-4">No files assigned to this folder.</div>`;
    } else if (isEmpty) {
      body.innerHTML = `<div class="text-center text-muted text-sm py-4">No files match filters.</div>`;
    } else {
      const grid = document.createElement('div');
      grid.className = 'thumbnail-grid';
      folderFiles.forEach(f => {
        const tile = document.createElement('div');
        const isMarker = f.is_marker;
        tile.className = `thumb-tile ${f.selected ? 'selected' : ''} ${f.dont_copy ? 'dont-copy-tile' : ''} ${isMarker ? 'marker-tile' : ''}`;
        tile.id = `tile-${f.id}`;
        tile.setAttribute('draggable', 'false');

        const fileName = f.filename || f.path.split(/[\\/]/).pop();
        const cachedB64 = f.thumbnail || window._thumbCache[f.path] || '';
        if (cachedB64) window._thumbCache[f.path] = cachedB64;
        const imgSrc = cachedB64 ? cachedB64 : `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='140' height='100'><rect width='140' height='100' fill='%23ddd'/></svg>`;
        const imgHTML = `<img class="thumb-tile-img" draggable="false" data-src="${f.path}" src="${imgSrc}">`;
        
        const isVideo = f.is_video || (/\.(mp4|mov|avi|mkv|wmv|mts|m2ts|m4v|webm|flv|3gp)$/i).test(fileName);
        const markerBadge = isMarker ? `<div class="thumb-tile-marker-badge"><svg width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 01-2 2zm9-13.5V9"/></svg> MARKER</div>` : '';
        const videoBadge = isVideo && !isMarker ? `<div class="thumb-tile-video-badge"><svg width="10" height="10" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg> VIDEO</div>` : '';
        const dontCopyBadge = f.dont_copy ? `<div class="thumb-tile-dontcopy-badge"><svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg> DON'T MOVE</div>` : '';

        tile.onclick = (e) => {
          if (e.target.classList.contains('thumb-tile-checkbox')) return;
          if (e.detail === 1) {
            if (tileClickTimers[f.id]) clearTimeout(tileClickTimers[f.id]);
            tileClickTimers[f.id] = setTimeout(() => {
              window.toggleFileSelect(f.id, undefined, e.shiftKey, e.ctrlKey || e.metaKey, folderIdx);
            }, 180);
          }
        };

        tile.ondblclick = (e) => {
          if (tileClickTimers[f.id]) clearTimeout(tileClickTimers[f.id]);
          e.stopPropagation();
          if (!e.target.classList.contains('thumb-tile-checkbox')) {
            if (window.openSortingMediaLightbox) {
              window.openSortingMediaLightbox(f.id, folderIdx);
            } else if (window.openLightbox) {
              window.openLightbox(f.path, fileName, isVideo);
            }
          }
        };

        tile.oncontextmenu = (e) => {
          e.preventDefault();
          e.stopPropagation();
        };

        tile.innerHTML = `
          <input type="checkbox" class="thumb-tile-checkbox" ${f.selected ? 'checked' : ''} onchange="window.toggleFileSelect(${f.id}, this.checked, event.shiftKey, event.ctrlKey || event.metaKey, ${folderIdx})">
          <button type="button" class="thumb-tile-preview-btn" title="Open Full Preview (Double-click)" onclick="event.stopPropagation(); window.openSortingMediaLightbox ? window.openSortingMediaLightbox(${f.id}, ${folderIdx}) : (window.openLightbox && window.openLightbox('${f.path.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}', '${fileName.replace(/'/g, "\\'")}', ${isVideo}))">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="15 3 21 3 21 9"></polyline>
              <polyline points="9 21 3 21 3 15"></polyline>
              <line x1="21" y1="3" x2="14" y2="10"></line>
              <line x1="3" y1="21" x2="10" y2="14"></line>
            </svg>
          </button>
          ${markerBadge}
          ${videoBadge}
          ${dontCopyBadge}
          ${imgHTML}
          <div class="thumb-tile-caption" title="${fileName}">${fileName}</div>
        `;
        grid.appendChild(tile);
      });
      body.appendChild(grid);
    }
    card.appendChild(body);
    container.appendChild(card);
  });

  if (window.updateFloatingSelectionBar) window.updateFloatingSelectionBar();
  if (window.updateSortingScrollBtn) window.updateSortingScrollBtn();
}

window.openSortingMediaLightbox = function(fileId, folderIdx) {
  if (tileClickTimers[fileId]) clearTimeout(tileClickTimers[fileId]);

  const visibleFiles = [];
  const filesByFolder = sortAppState.filesByFolder || {};
  const folderOrder = Object.keys(filesByFolder).map(Number).sort((a, b) => a - b);

  folderOrder.forEach(fIdx => {
    if (fIdx === -1) return;
    const fFiles = filesByFolder[fIdx] || [];
    const folderPath = sortAppState.folders[fIdx] || `Folder ${fIdx + 1}`;
    const folderName = folderPath.split(/[\\/]/).pop() || folderPath;

    fFiles.forEach(f => {
      if (f.is_sidecar) return;
      const fileName = f.filename || f.path.split(/[\\/]/).pop();
      const isVideo = f.is_video || (/\.(mp4|mov|avi|mkv|wmv|mts|m2ts|m4v|webm|flv|3gp)$/i).test(fileName);
      visibleFiles.push({
        id: f.id,
        path: f.path,
        name: fileName,
        isVideo: isVideo,
        folderIdx: f.folder_index,
        folderName: folderName
      });
    });
  });

  // Fallback if visibleFiles was empty
  if (visibleFiles.length === 0) {
    (sortAppState.files || []).forEach(f => {
      if (f.is_sidecar) return;
      const fileName = f.filename || f.path.split(/[\\/]/).pop();
      const isVideo = f.is_video || (/\.(mp4|mov|avi|mkv|wmv|mts|m2ts|m4v|webm|flv|3gp)$/i).test(fileName);
      const folderPath = (f.folder_index !== undefined && sortAppState.folders[f.folder_index]) || '';
      visibleFiles.push({
        id: f.id,
        path: f.path,
        name: fileName,
        isVideo: isVideo,
        folderIdx: f.folder_index,
        folderName: folderPath ? folderPath.split(/[\\/]/).pop() : ''
      });
    });
  }

  let currentIndex = visibleFiles.findIndex(it => it.id === fileId);
  if (currentIndex === -1) currentIndex = 0;

  const currentItem = visibleFiles[currentIndex];

  if (window.openLightbox && currentItem) {
    window.openLightbox({
      filePath: currentItem.path,
      fileName: currentItem.name,
      isVideo: currentItem.isVideo,
      items: visibleFiles,
      currentIndex: currentIndex,
      onClose: window.onSortingLightboxClose
    });
  }
};

window.onSortingLightboxClose = function(activeItem) {
  if (!activeItem || !activeItem.id) return;
  const targetId = activeItem.id;
  const file = (sortAppState.files || []).find(f => f.id === targetId);
  if (!file) return;

  const targetFolderIdx = file.folder_index;

  // Deselect all other files, select the target file
  (sortAppState.files || []).forEach(f => {
    const shouldSelect = (f.id === targetId);
    if (f.selected !== shouldSelect) {
      f.selected = shouldSelect;
      const t = document.getElementById(`tile-${f.id}`);
      if (t) {
        t.classList.toggle('selected', shouldSelect);
        const cb = t.querySelector('.thumb-tile-checkbox');
        if (cb && cb.checked !== shouldSelect) cb.checked = shouldSelect;
      }
    }
  });

  sortAppState.lastSelectedFileId = targetId;

  // Uncollapse folder if collapsed
  if (sortAppState.collapsedFolders[targetFolderIdx]) {
    sortAppState.collapsedFolders[targetFolderIdx] = false;
    const cardEl = document.getElementById(`folder-card-${targetFolderIdx}`);
    if (cardEl) {
      cardEl.classList.remove('collapsed');
      lazyLoadThumbnails();
    }
  }

  // Update UI & smooth scroll into center
  const tile = document.getElementById(`tile-${targetId}`);
  if (tile) {
    tile.classList.add('selected');
    const cb = tile.querySelector('.thumb-tile-checkbox');
    if (cb) cb.checked = true;

    setTimeout(() => {
      tile.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
      tile.classList.remove('tile-just-minimized');
      void tile.offsetWidth; // trigger reflow for pulse animation
      tile.classList.add('tile-just-minimized');
      setTimeout(() => tile.classList.remove('tile-just-minimized'), 1200);
    }, 60);
  }

  updateFolderHeaderButtons(targetFolderIdx);
  if (window.updateFloatingSelectionBar) window.updateFloatingSelectionBar();
};

window._thumbCache = window._thumbCache || {};
let _pendingBatchPaths = new Set();
let _pendingBatchElements = new Map();
let _batchTimeout = null;

function _processThumbnailBatch() {
  if (_pendingBatchPaths.size === 0) return;
  
  const pathsToFetch = Array.from(_pendingBatchPaths);
  const elementsMap = new Map(_pendingBatchElements);
  
  _pendingBatchPaths.clear();
  _pendingBatchElements.clear();
  _batchTimeout = null;

  const missingPaths = [];
  pathsToFetch.forEach(path => {
    if (window._thumbCache[path]) {
      const imgs = elementsMap.get(path) || [];
      imgs.forEach(img => { img.src = window._thumbCache[path]; });
    } else {
      missingPaths.push(path);
    }
  });

  if (missingPaths.length === 0) return;

  if (window.pywebview && window.pywebview.api && window.pywebview.api.sorting_generate_thumbnails_batch) {
    window.pywebview.api.sorting_generate_thumbnails_batch(missingPaths).then(results => {
      if (results) {
        Object.keys(results).forEach(path => {
          const b64 = results[path];
          if (b64) {
            window._thumbCache[path] = b64;
            const imgs = elementsMap.get(path) || [];
            imgs.forEach(img => { img.src = b64; });
          }
        });
      }
    }).catch(err => {
      console.error('Batch thumbnail load error, falling back to single calls:', err);
      missingPaths.forEach(path => {
        if (window.pywebview && window.pywebview.api && window.pywebview.api.sorting_generate_thumbnail) {
          window.pywebview.api.sorting_generate_thumbnail(path).then(b64 => {
            if (b64) {
              window._thumbCache[path] = b64;
              const imgs = elementsMap.get(path) || [];
              imgs.forEach(img => { img.src = b64; });
            }
          });
        }
      });
    });
  } else {
    missingPaths.forEach(path => {
      window.pywebview.api.sorting_generate_thumbnail(path).then(b64 => {
        if (b64) {
          window._thumbCache[path] = b64;
          const imgs = elementsMap.get(path) || [];
          imgs.forEach(img => { img.src = b64; });
        }
      });
    });
  }
}

function queueThumbnailLoad(path, img) {
  if (window._thumbCache[path]) {
    img.src = window._thumbCache[path];
    return;
  }

  _pendingBatchPaths.add(path);
  if (!_pendingBatchElements.has(path)) {
    _pendingBatchElements.set(path, []);
  }
  _pendingBatchElements.get(path).push(img);

  if (_batchTimeout) clearTimeout(_batchTimeout);
  _batchTimeout = setTimeout(_processThumbnailBatch, 30);
}

function lazyLoadThumbnails() {
  const images = document.querySelectorAll('.thumb-tile-img:not([data-loaded="true"])');
  if (images.length === 0) return;
  
  const contentArea = document.querySelector('.content-area');
  const observer = new IntersectionObserver((entries, obs) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const img = entry.target;
        const parentCard = img.closest('.folder-card');
        if (parentCard && parentCard.classList.contains('collapsed')) return;
        
        const path = img.getAttribute('data-src');
        if (path && !img.dataset.loaded) {
          img.dataset.loaded = 'true';
          obs.unobserve(img);
          queueThumbnailLoad(path, img);
        } else {
          obs.unobserve(img);
        }
      }
    });
  }, {
    root: contentArea || null,
    rootMargin: '300px 0px 300px 0px',
    threshold: 0.01
  });
  
  images.forEach(img => observer.observe(img));
}

// —— Transfer Helper Utilities & Live Progress Listeners ——

function formatTransferBytes(bytes, decimals = 1) {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function formatTransferSpeed(speedBps) {
  if (!speedBps || speedBps <= 0) return '0 MB/s';
  return formatTransferBytes(speedBps, 1) + '/s';
}

function formatTransferEta(seconds) {
  if (!seconds || seconds <= 0) return 'Almost done...';
  if (seconds > 60) {
    const mins = Math.ceil(seconds / 60);
    return `~${mins} min remaining`;
  }
  return `~${Math.ceil(seconds)}s remaining`;
}

async function confirmTransfer(action) {
  action = 'move'; // Everything will be moved (copy removed)
  const actionTitle = 'Move All Mapped Files?';
  const actionBtn = 'Move All Files';
  const confirmed = window.confirmModal ? await window.confirmModal({
    title: actionTitle,
    message: `Are you sure you want to <strong>move</strong> all mapped files to their destination folders?`,
    details: 'All verified media files will be transferred directly to their corresponding event directories.',
    confirmText: actionBtn,
    cancelText: 'Cancel',
    type: 'primary',
    icon: 'move'
  }) : confirm(`Are you sure you want to move all mapped files to their destination folders?`);

  if (confirmed) {
    window._lastTransferAction = 'move';
    const validFiles = (sortAppState.files || []).filter(f => !f.dont_copy && f.folder_index >= 0);
    const totalCount = validFiles.length || (sortAppState.files ? sortAppState.files.length : 0);
    
    if (window.ProgressController) {
      window.ProgressController.start(
        `Moving Media Files...`,
        `Preparing move operation...`,
        totalCount
      );
    } else {
      window.showToast(`Executing move...`);
    }

    window.pywebview.api.sorting_execute_transfer('move', sortAppState.files, sortAppState.folders).then(res => {
      if (res && res.error) {
        if (window.ProgressController) window.ProgressController.stop();
        window.showToast('Transfer error: ' + res.error, 'error');
      }
    }).catch(err => {
      if (window.ProgressController) window.ProgressController.stop();
      window.showToast('Transfer failed: ' + err, 'error');
    });
  }
}

// Global live transfer progress handler called by Python evaluate_js
window.updateTransferProgress = function(jsonStr) {
  try {
    const data = typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr;
    if (!data || data.type !== 'progress') return;

    const actionText = data.action === 'move' ? 'Moving' : 'Copying';
    const title = `${actionText} Media Files...`;
    const subtitle = `${actionText} ${data.current_file || ''} → ${data.target_folder || 'Folder'}`;
    
    let detailText = `${data.completed_files || 0} / ${data.total_files || 0} files`;
    if (data.total_bytes && data.total_bytes > 0) {
      detailText += ` (${formatTransferBytes(data.completed_bytes)} / ${formatTransferBytes(data.total_bytes)})`;
    }
    
    const etaStr = `${formatTransferEta(data.eta_sec)} • ${formatTransferSpeed(data.speed_bps)}`;

    if (window.ProgressController) {
      if (!window.ProgressController.overlay || window.ProgressController.overlay.style.display === 'none') {
        window.ProgressController.start(title, subtitle, data.total_files || 0);
      }
      window.ProgressController.update(
        data.completed_files || 0,
        subtitle,
        etaStr,
        detailText,
        data.percent !== undefined ? data.percent : null
      );
    }
  } catch (err) {
    console.error('Error updating transfer progress:', err);
  }
};

window.onTransferComplete = function(jsonStr) {
  try {
    const res = typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr;
    if (window.ProgressController) {
      window.ProgressController.stop();
    }
    
    if (res.success) {
      updateUndoTransferButtonState(res.can_undo);
      const action = window._lastTransferAction || 'transfer';
      window.showToast(`Successfully ${action}ed ${res.count} file(s)!`, 'success');
      
      if (res.mismatches && res.mismatches > 0) {
        window.showToast(`Notice: ${res.mismatches} file mismatch(es) logged in transfer_log.txt`, 'warning');
      }
      
      const headerActions = document.querySelector('.header-actions');
      if (headerActions && !document.getElementById('btn-open-sort-output')) {
        const btnOpen = document.createElement('button');
        btnOpen.id = 'btn-open-sort-output';
        btnOpen.className = 'btn btn-select';
        btnOpen.innerHTML = '<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24" style="vertical-align:-1px; margin-right:5px;"><path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/></svg> Open Output Folder';
        btnOpen.onclick = () => {
          const dest = sortAppState.root_dir || (sortAppState.folders[0] ? sortAppState.folders[0] : null);
          if (dest) window.pywebview.api.open_in_explorer(dest);
        };
        headerActions.appendChild(btnOpen);
      }
    } else {
      window.showToast('Transfer failed: ' + (res.error || 'Unknown error'), 'error');
    }
  } catch (err) {
    if (window.ProgressController) window.ProgressController.stop();
    console.error('Error on transfer complete:', err);
  }
};

window.updateUndoTransferProgress = function(jsonStr) {
  try {
    const data = typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr;
    if (!data || data.type !== 'progress') return;

    const title = "Undoing File Transfer...";
    const subtitle = `Reverting ${data.current_file || ''}...`;
    const detailText = `${data.completed_files || 0} / ${data.total_files || 0} files reverted`;
    
    if (window.ProgressController) {
      if (!window.ProgressController.overlay || window.ProgressController.overlay.style.display === 'none') {
        window.ProgressController.start(title, subtitle, data.total_files || 0);
      }
      window.ProgressController.update(
        data.completed_files || 0,
        subtitle,
        "Reverting...",
        detailText,
        data.percent !== undefined ? data.percent : null
      );
    }
  } catch (err) {
    console.error('Error updating undo progress:', err);
  }
};

window.onUndoTransferComplete = function(jsonStr) {
  try {
    const res = typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr;
    if (window.ProgressController) {
      window.ProgressController.stop();
    }
    
    if (res.success) {
      updateUndoTransferButtonState(res.can_undo);
      let msg = `Successfully reverted ${res.count} file(s).`;
      if (res.errors && res.errors.length > 0) {
        msg += ` (${res.errors.length} error(s) occurred)`;
        window.showToast(msg, 'warning');
      } else {
        window.showToast(msg, 'success');
      }
    } else {
      window.showToast("Undo transfer failed: " + (res.error || 'Unknown error'), 'error');
    }
  } catch (err) {
    if (window.ProgressController) window.ProgressController.stop();
    console.error('Error on undo complete:', err);
  }
};
