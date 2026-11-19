// ── PDF to CSV Logic ──

const pdfCsvColumns = ["Seq", "Event", "Sticker", "Name", "ITS", "Location", "Mobile", "Mauze", "Sub Event"];

document.addEventListener('DOMContentLoaded', () => {
  const btnPick = document.getElementById('btn-pick-pdf');
  const btnPreview = document.getElementById('btn-pdf-preview');
  const btnDownload = document.getElementById('btn-pdf-download');
  const btnAddPartTop = document.getElementById('btn-add-part');
  const partsListContainer = document.getElementById('pdf-parts-list');
  
  let currentPdfHeaders = [];
  let loadedSrMin = null;
  let loadedSrMax = null;
  let currentPdfPath = null;
  let currentPdfFilename = '';
  let currentPdfBlobUrl = null;
  let isSplitViewActive = false;

  const defaultMainEvents = ["Waaz", "Majlis", "Namaz", "Ziyarat", "Isteqbal", "Wada", "QMZ", "Bethak"];
  let availableMainEvents = [...defaultMainEvents];

  // ── PDF In-App Viewer & Split Screen Engine ──
  async function ensurePdfBlobUrl() {
    if (currentPdfBlobUrl) return currentPdfBlobUrl;
    try {
      if (window.pywebview && window.pywebview.api && window.pywebview.api.pdf_get_base64) {
        const resp = await window.pywebview.api.pdf_get_base64(currentPdfPath);
        const data = typeof resp === 'string' ? JSON.parse(resp) : resp;
        if (data && data.success && data.base64) {
          const binaryString = window.atob(data.base64);
          const len = binaryString.length;
          const bytes = new Uint8Array(len);
          for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          const blob = new Blob([bytes], { type: 'application/pdf' });
          currentPdfBlobUrl = URL.createObjectURL(blob);
          return currentPdfBlobUrl;
        }
      }
      // Fallback: local web server streaming endpoint
      if (window.location && window.location.protocol && window.location.protocol.startsWith('http')) {
        return '/api/pdf_preview';
      }
    } catch (e) {
      console.error("Failed to load PDF blob for viewer:", e);
    }
    return null;
  }

  function revokePdfBlobUrl() {
    if (currentPdfBlobUrl) {
      try {
        URL.revokeObjectURL(currentPdfBlobUrl);
      } catch (e) {}
      currentPdfBlobUrl = null;
    }
  }

  async function openPdfModal() {
    const url = await ensurePdfBlobUrl();
    if (!url) {
      window.showToast("Please load a PDF file first to view it.", true);
      return;
    }
    const frame = document.getElementById('pdf-modal-iframe');
    if (frame && frame.src !== url) {
      frame.src = url;
    }
    const titleEl = document.getElementById('pdf-modal-title');
    if (titleEl) {
      titleEl.textContent = currentPdfFilename ? `${currentPdfFilename} — PDF Viewer` : 'PDF Document Viewer';
    }
    const modal = document.getElementById('modal-pdf-viewer');
    if (modal) {
      modal.classList.remove('hidden');
      modal.style.display = 'flex';
    }
  }

  function closePdfModal() {
    const modal = document.getElementById('modal-pdf-viewer');
    if (modal) {
      modal.classList.add('hidden');
      modal.style.display = 'none';
    }
  }

  // ── Draggable Splitter & Width Controls Engine ──
  function getSavedSplitRatio() {
    const saved = localStorage.getItem('pdf_split_ratio');
    const val = parseInt(saved, 10);
    return !isNaN(val) && val >= 25 && val <= 80 ? val : 50;
  }

  function applyPdfSplitWidth(percent) {
    const previewPane = document.getElementById('pdf-pane-preview');
    const controlsPane = document.querySelector('.pdf-pane-controls');
    if (!previewPane || !controlsPane) return;

    previewPane.style.flex = `0 0 ${percent}%`;
    controlsPane.style.flex = `0 0 ${100 - percent}%`;

    document.querySelectorAll('.btn-width-preset').forEach(btn => {
      const w = parseInt(btn.getAttribute('data-width'), 10);
      btn.classList.toggle('active', Math.abs(w - percent) <= 5);
    });

    try {
      localStorage.setItem('pdf_split_ratio', percent);
    } catch (e) {}
  }

  function initSplitResizer() {
    const resizer = document.getElementById('pdf-split-resizer');
    const container = document.getElementById('pdf-workspace-container');
    const previewPane = document.getElementById('pdf-pane-preview');
    const controlsPane = document.querySelector('.pdf-pane-controls');
    const iframe = document.getElementById('pdf-split-iframe');
    if (!resizer || !container || !previewPane) return;

    let isDragging = false;

    resizer.addEventListener('mousedown', (e) => {
      e.preventDefault();
      isDragging = true;
      resizer.classList.add('dragging');
      if (iframe) iframe.style.pointerEvents = 'none';
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const rect = container.getBoundingClientRect();
      const rightWidth = rect.right - e.clientX;
      let percent = Math.round((rightWidth / rect.width) * 100);
      percent = Math.max(25, Math.min(80, percent));
      applyPdfSplitWidth(percent);
    });

    window.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        resizer.classList.remove('dragging');
        if (iframe) iframe.style.pointerEvents = 'auto';
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    });

    document.querySelectorAll('.btn-width-preset').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const w = parseInt(btn.getAttribute('data-width'), 10);
        if (!isNaN(w)) {
          applyPdfSplitWidth(w);
        }
      });
    });
  }

  async function toggleSplitView(forceState) {
    const container = document.getElementById('pdf-workspace-container');
    const previewPane = document.getElementById('pdf-pane-preview');
    const resizer = document.getElementById('pdf-split-resizer');
    const controlsPane = document.querySelector('.pdf-pane-controls');
    if (!container || !previewPane) return;

    const targetState = forceState !== undefined ? forceState : !isSplitViewActive;

    if (targetState) {
      const url = await ensurePdfBlobUrl();
      if (!url) {
        window.showToast("Please load a PDF file first to use split screen.", true);
        return;
      }
      const frame = document.getElementById('pdf-split-iframe');
      if (frame && frame.src !== url) {
        frame.src = url;
      }
      const titleSpan = document.getElementById('pdf-split-preview-filename');
      if (titleSpan && currentPdfFilename) {
        titleSpan.textContent = currentPdfFilename;
      }
      container.classList.add('split-mode');
      previewPane.classList.remove('hidden');
      if (resizer) resizer.classList.remove('hidden');
      isSplitViewActive = true;
      applyPdfSplitWidth(getSavedSplitRatio());

      const splitBtnText = document.getElementById('split-btn-text');
      if (splitBtnText) splitBtnText.textContent = 'Exit Split';
      const headerSplitText = document.getElementById('header-split-btn-text');
      if (headerSplitText) headerSplitText.textContent = 'Exit Split';
    } else {
      container.classList.remove('split-mode');
      previewPane.classList.add('hidden');
      if (resizer) resizer.classList.add('hidden');
      if (previewPane) previewPane.style.flex = '';
      if (controlsPane) controlsPane.style.flex = '';
      isSplitViewActive = false;

      const splitBtnText = document.getElementById('split-btn-text');
      if (splitBtnText) splitBtnText.textContent = 'Split View';
      const headerSplitText = document.getElementById('header-split-btn-text');
      if (headerSplitText) headerSplitText.textContent = 'Split View';
    }
  }

  async function openPdfExternal() {
    try {
      if (window.pywebview && window.pywebview.api && window.pywebview.api.pdf_open_external) {
        const resp = await window.pywebview.api.pdf_open_external();
        const data = typeof resp === 'string' ? JSON.parse(resp) : resp;
        if (data && data.error) {
          window.showToast(data.error, true);
        } else {
          window.showToast("Opening PDF in system viewer...");
        }
      } else {
        window.showToast("External viewer only supported in desktop mode.", true);
      }
    } catch (e) {
      console.error("External PDF launch failed:", e);
      window.showToast("Could not launch external viewer", true);
    }
  }

  // ── Bind PDF Viewer Buttons ──
  initSplitResizer();

  const btnViewMain = document.getElementById('btn-view-pdf-main');
  if (btnViewMain) btnViewMain.addEventListener('click', openPdfModal);

  const btnOpenModal = document.getElementById('btn-open-pdf-modal');
  if (btnOpenModal) btnOpenModal.addEventListener('click', openPdfModal);

  const btnToggleSplit = document.getElementById('btn-toggle-split-btn');
  if (btnToggleSplit) btnToggleSplit.addEventListener('click', () => toggleSplitView());

  const btnToggleSplitHeader = document.getElementById('btn-toggle-split-pdf');
  if (btnToggleSplitHeader) btnToggleSplitHeader.addEventListener('click', () => toggleSplitView());

  const btnCloseSplit = document.getElementById('btn-close-split');
  if (btnCloseSplit) btnCloseSplit.addEventListener('click', () => toggleSplitView(false));

  const btnSplitFullscreen = document.getElementById('btn-split-fullscreen');
  if (btnSplitFullscreen) btnSplitFullscreen.addEventListener('click', openPdfModal);

  const btnOpenExternal = document.getElementById('btn-open-external-pdf');
  if (btnOpenExternal) btnOpenExternal.addEventListener('click', openPdfExternal);

  const btnModalExternal = document.getElementById('btn-pdf-modal-external');
  if (btnModalExternal) btnModalExternal.addEventListener('click', openPdfExternal);

  const btnCloseModal = document.getElementById('btn-close-pdf-modal');
  if (btnCloseModal) btnCloseModal.addEventListener('click', closePdfModal);

  const modalOverlay = document.getElementById('modal-pdf-viewer');
  if (modalOverlay) {
    modalOverlay.addEventListener('click', (e) => {
      if (e.target === modalOverlay) closePdfModal();
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const modal = document.getElementById('modal-pdf-viewer');
      if (modal && !modal.classList.contains('hidden') && modal.style.display !== 'none') {
        closePdfModal();
      }
    }
  });

  const btnChangePdf = document.getElementById('btn-change-pdf');
  if (btnChangePdf) {
    btnChangePdf.addEventListener('click', () => window.loadPdf(null));
  }

  // Register Drag & Drop on Active File Card as well
  window.makeDropZone('pdf-active-file-card', paths => {
    if (paths && paths.length > 0) {
      const file = paths[0];
      if (file.toLowerCase().endsWith('.pdf')) {
        window.loadPdf(file);
      } else {
        window.showToast("Please drop a valid PDF file (.pdf)", true);
      }
    }
  });

  async function loadMainEvents() {
    try {
      if (window.pywebview && window.pywebview.api && window.pywebview.api.pdf_get_main_events) {
        const resp = await window.pywebview.api.pdf_get_main_events();
        const data = typeof resp === 'string' ? JSON.parse(resp) : resp;
        if (data && Array.isArray(data.events) && data.events.length > 0) {
          availableMainEvents = data.events;
        }
      }
    } catch (e) {
      console.warn("Could not load main events from backend, using defaults:", e);
    }
  }

  // Initial fetch of main events
  loadMainEvents();

  // ── Parts & Sequence Ranges Management ──
  function initPartsList(defaultMin = null, defaultMax = null) {
    if (!partsListContainer) return;
    partsListContainer.innerHTML = '';
    addPartRow(defaultMin !== null ? defaultMin : '', defaultMax !== null ? defaultMax : '');
  }

  function updatePartNumbers() {
    if (!partsListContainer) return;
    const rows = partsListContainer.querySelectorAll('.pdf-part-row');
    const hasMultiple = rows.length > 1;

    rows.forEach((row, idx) => {
      row.setAttribute('data-part-index', idx);
      const tag = row.querySelector('.part-badge-tag');
      if (tag) {
        tag.textContent = hasMultiple ? `Part ${idx + 1}` : 'Sequence Range';
      }
      const removeBtn = row.querySelector('.btn-part-remove');
      if (removeBtn) {
        removeBtn.style.display = hasMultiple ? 'inline-flex' : 'none';
      }
    });
  }

  function addPartRow(startVal = '', endVal = '', eventVal = '') {
    if (!partsListContainer) return;
    const row = document.createElement('div');
    row.className = 'pdf-part-row';

    let eventOptionsHtml = `<option value="">-- Select Main Event --</option>`;
    availableMainEvents.forEach(ev => {
      const selected = (ev === eventVal) ? 'selected' : '';
      eventOptionsHtml += `<option value="${ev}" ${selected}>${ev}</option>`;
    });
    if (eventVal && !availableMainEvents.includes(eventVal)) {
      eventOptionsHtml += `<option value="${eventVal}" selected>${eventVal}</option>`;
    }
    eventOptionsHtml += `<option value="__custom__">+ Custom Event...</option>`;

    row.innerHTML = `
      <div class="part-badge-tag">Part 1</div>
      <div class="input-group flex-1" style="min-width: 140px;">
        <label style="font-size:0.78rem; font-weight:700; color:var(--text-secondary); text-transform:uppercase; letter-spacing:0.04em;">Main Event</label>
        <select class="input-glass part-event-select">
          ${eventOptionsHtml}
        </select>
        <input type="text" class="input-glass part-custom-event-input hidden mt-1" placeholder="Type custom event name" value="${eventVal && !availableMainEvents.includes(eventVal) ? eventVal : ''}">
      </div>
      <div class="input-group flex-1">
        <label style="font-size:0.78rem; font-weight:700; color:var(--text-secondary); text-transform:uppercase; letter-spacing:0.04em;">Start Sr Number</label>
        <input type="number" class="input-glass part-start-input" placeholder="Min (Optional)" value="${startVal !== null && startVal !== undefined ? startVal : ''}">
      </div>
      <div class="input-group flex-1">
        <label style="font-size:0.78rem; font-weight:700; color:var(--text-secondary); text-transform:uppercase; letter-spacing:0.04em;">End Sr Number</label>
        <input type="number" class="input-glass part-end-input" placeholder="Max (Optional)" value="${endVal !== null && endVal !== undefined ? endVal : ''}">
      </div>
      <div class="flex align-center gap-1">
        <button type="button" class="btn-part-action btn-part-remove" title="Remove this Part" style="display: none;">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
    `;

    const selectEl = row.querySelector('.part-event-select');
    const customInput = row.querySelector('.part-custom-event-input');

    selectEl.addEventListener('change', () => {
      if (selectEl.value === '__custom__') {
        customInput.classList.remove('hidden');
        customInput.focus();
      } else {
        customInput.classList.add('hidden');
      }
    });

    // Row Actions
    const removeBtn = row.querySelector('.btn-part-remove');

    removeBtn.addEventListener('click', () => {
      row.remove();
      updatePartNumbers();
    });

    partsListContainer.appendChild(row);
    updatePartNumbers();
  }

  if (btnAddPartTop) {
    btnAddPartTop.addEventListener('click', () => {
      const rows = partsListContainer.querySelectorAll('.pdf-part-row');
      let nextStart = '';
      let nextEnd = loadedSrMax !== null ? loadedSrMax : '';
      if (rows.length > 0) {
        const lastRow = rows[rows.length - 1];
        const lastEndInput = lastRow.querySelector('.part-end-input');
        if (lastEndInput && lastEndInput.value.trim() !== '') {
          const parsed = parseInt(lastEndInput.value.trim(), 10);
          if (!isNaN(parsed)) {
            nextStart = parsed + 1;
          }
        }
      }
      addPartRow(nextStart, nextEnd);
    });
  }

  function getParts() {
    if (!partsListContainer) return [];
    const rows = partsListContainer.querySelectorAll('.pdf-part-row');
    const parts = [];
    rows.forEach((row, idx) => {
      const sInput = row.querySelector('.part-start-input');
      const eInput = row.querySelector('.part-end-input');
      const selectEl = row.querySelector('.part-event-select');
      const customInput = row.querySelector('.part-custom-event-input');

      let evVal = selectEl ? selectEl.value.trim() : '';
      if (evVal === '__custom__' && customInput) {
        evVal = customInput.value.trim();
      }

      const sVal = sInput && sInput.value.trim() !== '' ? parseInt(sInput.value.trim(), 10) : null;
      const eVal = eInput && eInput.value.trim() !== '' ? parseInt(eInput.value.trim(), 10) : null;
      parts.push({
        name: `Part ${idx + 1}`,
        event: evVal,
        start: isNaN(sVal) ? null : sVal,
        end: isNaN(eVal) ? null : eVal
      });
    });
    return parts;
  }

  // Initialize with single default part
  initPartsList();

  window.restorePdfState = function(path) {
    if (!path) return;
    const fname = path.split(/[/\\]/).pop();
    currentPdfPath = path;
    currentPdfFilename = fname;

    // Update active file card
    const card = document.getElementById('pdf-active-file-card');
    const fnameEl = document.getElementById('pdf-loaded-filename');
    const metaEl = document.getElementById('pdf-loaded-meta');
    const dropzoneEl = document.getElementById('pdf-dropzone');
    const headerActions = document.getElementById('pdf-header-actions');
    const settingsEl = document.getElementById('pdf-settings');

    if (fnameEl) fnameEl.textContent = fname;
    if (metaEl) metaEl.textContent = 'Active file loaded • Ready to map';
    if (card) card.classList.remove('hidden');
    if (dropzoneEl) dropzoneEl.classList.add('hidden');
    if (headerActions) headerActions.style.display = 'flex';
    if (settingsEl) settingsEl.classList.remove('hidden');

    const infoEl = document.getElementById('pdf-file-info');
    if (infoEl) {
      infoEl.innerHTML = `<div class="dot"></div> Selected: <strong>${fname}</strong>`;
    }
  };
  
  window.loadPdf = async function(path = null) {
    const btnPickText = document.getElementById('btn-pick-pdf-text');
    if (btnPick) btnPick.disabled = true;
    if (btnPickText) btnPickText.textContent = 'Scanning PDF...';
    
    try {
      const resp = await window.pywebview.api.pdf_pick_pdf(path);
      const data = JSON.parse(resp);
      if (data.error) {
        if (data.error !== "No file selected.") {
          window.showToast(data.error, true);
        }
        return;
      }
      
      // Update state
      currentPdfPath = data.path;
      currentPdfFilename = data.filename;
      revokePdfBlobUrl();

      if (data.base64) {
        try {
          const binaryString = window.atob(data.base64);
          const len = binaryString.length;
          const bytes = new Uint8Array(len);
          for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          const blob = new Blob([bytes], { type: 'application/pdf' });
          currentPdfBlobUrl = URL.createObjectURL(blob);
        } catch (b64Err) {
          console.warn("[PDF] Could not build blob from base64:", b64Err);
        }
      }

      // Update UI File Card
      const card = document.getElementById('pdf-active-file-card');
      const fnameEl = document.getElementById('pdf-loaded-filename');
      const metaEl = document.getElementById('pdf-loaded-meta');
      const dropzoneEl = document.getElementById('pdf-dropzone');
      const headerActions = document.getElementById('pdf-header-actions');
      const settingsEl = document.getElementById('pdf-settings');

      if (fnameEl) fnameEl.textContent = data.filename;
      if (metaEl) metaEl.textContent = `${data.row_count} rows detected • Ready to map`;
      if (card) card.classList.remove('hidden');
      if (dropzoneEl) dropzoneEl.classList.add('hidden');
      if (headerActions) headerActions.style.display = 'flex';
      if (settingsEl) settingsEl.classList.remove('hidden');

      const infoEl = document.getElementById('pdf-file-info');
      if (infoEl) {
        infoEl.innerHTML = `<div class="dot"></div> Selected: <strong>${data.filename}</strong> (${data.row_count} rows detected)`;
      }

      const splitTitleSpan = document.getElementById('pdf-split-preview-filename');
      if (splitTitleSpan) splitTitleSpan.textContent = data.filename;

      // If split view is already active, refresh the split preview frame
      if (isSplitViewActive) {
        ensurePdfBlobUrl().then(url => {
          const splitFrame = document.getElementById('pdf-split-iframe');
          if (splitFrame && url) splitFrame.src = url;
        });
      }
      
      currentPdfHeaders = data.pdf_headers;
      buildMappingGrid(currentPdfHeaders, data.auto_mapping);
      
      loadedSrMin = data.sr_min;
      loadedSrMax = data.sr_max;
      
      initPartsList(data.sr_min, data.sr_max);

      // Automatically render and display the formatted CSV preview table below
      setTimeout(() => {
        if (btnPreview) {
          btnPreview.click();
        }
      }, 150);

      if (data.path && window.pywebview && window.pywebview.api && window.pywebview.api.set_setting) {
        window.pywebview.api.set_setting('pdf_source_path', data.path);
      }
    } catch (e) {
      console.error(e);
      window.showToast("Error loading PDF", true);
    } finally {
      if (btnPick) btnPick.disabled = false;
      if (btnPickText) btnPickText.textContent = 'Browse PDF File';
    }
  };

  if (btnPick) {
    btnPick.addEventListener('click', () => window.loadPdf(null));
  }
  
  // Register Drag & Drop on main dropzone
  window.makeDropZone('pdf-dropzone', paths => {
    if (paths && paths.length > 0) {
      const file = paths[0];
      if (file.toLowerCase().endsWith('.pdf')) {
        window.loadPdf(file);
      } else {
        window.showToast("Please drop a valid PDF file (.pdf)", true);
      }
    }
  });
  
  btnPreview.addEventListener('click', async () => {
    const mapping = getMapping();
    const mauze = document.getElementById('pdf-mauze').value;
    const parts = getParts();
    const srStart = parts.length === 1 ? parts[0].start : null;
    const srEnd = parts.length === 1 ? parts[0].end : null;
    const partsJson = parts.length > 1 ? JSON.stringify(parts) : null;
    
    btnPreview.disabled = true;
    try {
      const resp = await window.pywebview.api.pdf_process(JSON.stringify(mapping), mauze, srStart, srEnd, partsJson);
      const data = JSON.parse(resp);
      if (data.error) {
        window.showToast(data.error, true);
        return;
      }
      renderPreviewTable(data.preview);
      document.getElementById('pdf-status').textContent = `Rows found: ${data.total_rows}`;
      document.getElementById('pdf-preview-wrapper').classList.remove('hidden');
    } finally {
      btnPreview.disabled = false;
    }
  });

  btnDownload.addEventListener('click', async () => {
    const mapping = getMapping();
    const mauze = document.getElementById('pdf-mauze').value;
    const parts = getParts();
    const srStart = parts.length === 1 ? parts[0].start : null;
    const srEnd = parts.length === 1 ? parts[0].end : null;
    const partsJson = parts.length > 1 ? JSON.stringify(parts) : null;
    
    btnDownload.disabled = true;
    try {
      const resp = await window.pywebview.api.pdf_download(JSON.stringify(mapping), mauze, srStart, srEnd, partsJson);
      const data = JSON.parse(resp);
      if (data.error) {
        window.showToast(data.error, true);
        if (data.error.includes("No working directory") && window.showFirstBootSetupModal) {
          window.showFirstBootSetupModal();
        }
      } else {
        const savedCsvPath = data.path || data.saved || data.working_csv;
        const msg = data.success || `CSV file has been successfully generated and saved to your temporary working directory at: ${savedCsvPath}`;
        window.showToast(msg);

        // Automatically pass to CSV-to-Folders
        if (savedCsvPath && window.setCsvInputPath) {
          window.setCsvInputPath(savedCsvPath, false);
        }

        const statusEl = document.getElementById('pdf-status');
        const escPath = (savedCsvPath || '').replace(/\\/g, '/');
        if (statusEl) {
          statusEl.innerHTML = `<div class="flex align-center justify-between w-full flex-wrap gap-2"><span>${data.total_rows} rows extracted successfully</span><div class="flex gap-2"><button class="btn btn-select btn-sm" style="padding:0.4rem 0.85rem; font-size:0.88rem;" onclick="window.pywebview.api.open_in_explorer('${escPath}')">📁 Open Folder</button><button class="btn btn-primary btn-sm" style="padding:0.4rem 0.85rem; font-size:0.88rem;" onclick="if(window.switchNavToView) window.switchNavToView('view-csv');">⚡ Proceed to CSV to Folders</button></div></div>`;
        }
      }
    } finally {
      btnDownload.disabled = false;
    }
  });
  
  function buildMappingGrid(pdfHeaders, autoMapping) {
    const grid = document.getElementById('pdf-mapping-grid');
    grid.innerHTML = '';
    
    const colDisplayLabels = {
      'Event': 'Event (Sharaf / QMZ)',
      'Sticker': 'Sticker (Sr / No)',
      'Name': 'Name',
      'ITS': 'ITS ID',
      'Location': 'Location (Address)',
      'Mobile': 'Mobile (Contact)',
      'Sub Event': 'Sub Event (Safar Code)',
    };

    pdfCsvColumns.forEach(csvCol => {
      if (['Seq', 'Mauze'].includes(csvCol)) return;
      
      const row = document.createElement('div');
      row.className = 'mapping-row';
      
      const displayTitle = colDisplayLabels[csvCol] || csvCol;
      const lbl = document.createElement('span');
      lbl.innerHTML = `${displayTitle} <small class="target-tag" style="font-weight:600; opacity:0.65; font-size:0.75rem; text-transform:none;">Target Column</small>`;
      row.appendChild(lbl);
      
      const sel = document.createElement('select');
      sel.setAttribute('data-csv', csvCol);
      sel.className = 'mapping-select';
      
      const optNone = document.createElement('option');
      optNone.value = '';
      optNone.textContent = '-- Ignore Column --';
      sel.appendChild(optNone);
      
      pdfHeaders.forEach(h => {
        const opt = document.createElement('option');
        opt.value = h;
        opt.textContent = h;
        if (autoMapping[csvCol] === h) opt.selected = true;
        sel.appendChild(opt);
      });

      const updateMappedState = () => {
        if (sel.value) {
          row.classList.add('mapped');
          row.querySelector('.target-tag').textContent = '✓ Mapped';
        } else {
          row.classList.remove('mapped');
          row.querySelector('.target-tag').textContent = 'Ignored';
        }
      };

      sel.addEventListener('change', updateMappedState);
      row.appendChild(sel);
      grid.appendChild(row);
      updateMappedState();
    });
  }
  
  function getMapping() {
    const mapping = {};
    const selects = document.querySelectorAll('#pdf-mapping-grid select');
    selects.forEach(sel => {
      const csv = sel.getAttribute('data-csv');
      mapping[csv] = sel.value || null;
    });
    return mapping;
  }
  
  function renderPreviewTable(rows) {
    const tbody = document.querySelector('#pdf-table tbody');
    tbody.innerHTML = '';
    (rows || []).forEach(r => {
      const tr = document.createElement('tr');
      // Check if this row is a Part divider row
      if (r.Seq && String(r.Seq).startsWith('Part ') && !r.Name && !r.ITS && !r.Mobile) {
        tr.className = 'part-divider-row';
        const td = document.createElement('td');
        td.colSpan = pdfCsvColumns.length;
        const evLabel = r.Event ? ` — ${r.Event}` : '';
        td.innerHTML = `
          <div class="part-divider-badge">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
              <line x1="3" y1="9" x2="21" y2="9"></line>
              <line x1="9" y1="21" x2="9" y2="9"></line>
            </svg>
            <span>${r.Seq}${evLabel}</span>
          </div>
        `;
        tr.appendChild(td);
        tbody.appendChild(tr);
        return;
      }

      pdfCsvColumns.forEach(c => {
        const td = document.createElement('td');
        const val = r[c] !== undefined && r[c] !== null ? String(r[c]) : '';
        if (c === 'Seq') {
          td.innerHTML = val ? `<span class="badge badge-seq">${val}</span>` : '';
        } else if (c === 'Event') {
          const evLower = val.toLowerCase();
          td.innerHTML = val ? `<span class="badge badge-event badge-ev-${evLower}">${val}</span>` : '';
        } else if (c === 'Sticker') {
          td.innerHTML = val ? `<span class="badge badge-sticker">${val}</span>` : '';
        } else if (c === 'ITS') {
          td.className = 'col-mono';
          td.textContent = val;
        } else if (c === 'Mobile') {
          td.className = 'col-mono';
          td.textContent = val;
        } else if (c === 'Name') {
          td.className = 'col-name';
          td.textContent = val;
        } else if (c === 'Location') {
          td.className = 'col-location';
          td.title = val;
          td.textContent = val;
        } else {
          td.textContent = val;
        }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
  }
});

