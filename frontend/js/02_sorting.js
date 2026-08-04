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
  searchQuery: '',
  activeShiftFolderId: null,
  history: [],
  pendingShift: null,
  activeMode: null
};

let analysisState = {
  startTime: null,
  totalMedia: 0,
  rootDir: null
};

document.addEventListener('DOMContentLoaded', () => {
  const btnMapping = document.getElementById('btn-sort-mapping');
  const btnRoot = document.getElementById('btn-sort-root');
  const btnScan = document.getElementById('btn-sort-scan');
  
  const pathMapping = document.getElementById('sort-mapping-path');
  const pathRoot = document.getElementById('sort-root-path');
  
  let currentMapping = null;
  let currentRoot = null;
  
  function checkReady() {
    btnScan.disabled = !(currentMapping && currentRoot);
  }
  
  async function loadMapping(path = null) {
    try {
      const respPath = await window.pywebview.api.sorting_select_mapping_file(path);
      if (respPath) {
        currentMapping = respPath;
        pathMapping.value = currentMapping;
        checkReady();
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
        currentRoot = respPath;
        pathRoot.value = currentRoot;
        checkReady();
      }
    } catch (e) { console.error(e); }
  }

  btnRoot.addEventListener('click', () => loadRoot(null));

  window.makeDropZone('sort-root-container', paths => {
    if (paths && paths.length > 0) loadRoot(paths[0]);
  });
  
  btnScan.addEventListener('click', async () => {
    btnScan.disabled = true;
    analysisState.rootDir = currentRoot;
    
    try {
      const scanRes = await window.pywebview.api.sorting_scan_files(currentMapping, currentRoot);
      if (scanRes.error) {
        window.showToast(scanRes.error, true);
        btnScan.disabled = false;
        return;
      }
      
      // Transition to analysis screen
      document.getElementById('sort-setup-screen').classList.add('hidden');
      document.getElementById('sort-analysis-screen').classList.remove('hidden');
      
      analysisState.totalMedia = scanRes.total_photos + scanRes.total_videos;
      analysisState.startTime = Date.now();
      
      document.getElementById('analysis-progress-text').innerText = `0 / ${analysisState.totalMedia} files`;
      
      addLogEntry(`Discovered ${scanRes.total_files} files (${scanRes.total_photos} photos, ${scanRes.total_videos} videos, ${scanRes.total_other} sidecar/other)`, 'ok');
      addLogEntry(`Contributors: ${scanRes.contributors.join(', ')}`, 'ok');
      addLogEntry('Starting marker detection analysis…', 'info');
      
      await window.pywebview.api.sorting_start_analysis();
      
    } catch (e) {
      window.showToast("An error occurred during scan preparation", true);
      btnScan.disabled = false;
    }
  });

  // Top header actions
  document.getElementById('btn-undo').addEventListener('click', undo);
  document.getElementById('btn-undo-transfer').addEventListener('click', undoTransfer);
  document.getElementById('btn-copy-all').addEventListener('click', () => confirmTransfer('copy'));
  document.getElementById('btn-move-all').addEventListener('click', () => confirmTransfer('move'));

  // Sidebar actions
  document.getElementById('btn-filter-all').addEventListener('click', () => filterContributor('ALL'));
  document.getElementById('btn-expand-all').addEventListener('click', expandAllFolders);
  document.getElementById('btn-collapse-all').addEventListener('click', collapseAllFolders);

  // Search
  document.getElementById('file-search-input').addEventListener('input', (e) => onSearchInput(e.target.value));

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
});

function addLogEntry(text, type) {
  const log = document.getElementById('activity-log');
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
    const response = JSON.parse(jsonStr);
    
    if (response.error) {
      window.showToast(response.error, true);
      document.getElementById('sort-analysis-screen').classList.add('hidden');
      document.getElementById('sort-setup-screen').classList.remove('hidden');
      return;
    }
    
    document.getElementById('ring-percent').innerText = '100%';
    document.getElementById('ring-progress').style.strokeDashoffset = 0;
    document.getElementById('analysis-bar').style.width = '100%';
    document.getElementById('analysis-eta').innerText = 'Complete!';
    document.getElementById('analysis-subtitle').classList.remove('scanning-pulse');
    document.getElementById('analysis-subtitle').innerText = 'Analysis complete!';
    addLogEntry('Analysis complete — loading workspace…', 'ok');
    
    setTimeout(() => {
      sortAppState.files = response.files;
      sortAppState.folders = response.folders;
      sortAppState.allCsvFolders = [...response.folders];
      sortAppState.contributors = response.contributors;
      sortAppState.newlyCreatedFolders = [];
      sortAppState.root_dir = analysisState.rootDir;
      
      sortFoldersAndReassignIndices();
      sortAppState.collapsedFolders = {};
      sortAppState.history = [];
      updateUndoButtonState();
      updateUndoTransferButtonState(false);
      
      document.getElementById('sort-analysis-screen').classList.add('hidden');
      document.getElementById('sort-main-screen').classList.remove('hidden');
      
      renderFolders();
      lazyLoadThumbnails();
    }, 1200);
    
  } catch (e) { console.error(e); }
};

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
}

// ── State Management ──

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
  document.getElementById('btn-undo').disabled = sortAppState.history.length === 0;
}

function updateUndoTransferButtonState(canUndo) {
  document.getElementById('btn-undo-transfer').disabled = !canUndo;
}

function undoTransfer() {
  if (confirm("Are you sure you want to undo the last file transfer?")) {
    window.pywebview.api.sorting_undo_transfer().then(res => {
      if (res.success) {
        updateUndoTransferButtonState(res.can_undo);
        let msg = `Successfully reverted ${res.count} file(s).`;
        if (res.errors && res.errors.length > 0) {
          msg += ` (${res.errors.length} errors occurred)`;
          window.showToast(msg, 'warning');
        } else {
          window.showToast(msg, 'success');
        }
      } else {
        window.showToast("Undo transfer failed: " + res.error, 'error');
      }
    });
  }
}

// ── UI Actions & Rendering ──

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
  const indices = new Set();
  sortAppState.files.forEach(f => {
    if (f.contributor === contributor && f.folder_index >= 0) indices.add(f.folder_index);
  });
  sortAppState.allCsvFolders.forEach((folder, idx) => {
    if (folder.includes(contributor)) {
      const currentIdx = sortAppState.folders.indexOf(folder);
      if (currentIdx !== -1) indices.add(currentIdx);
    }
  });
  return [...indices].sort((a, b) => a - b);
}

window.toggleFileSelect = function(fileId, checked) {
  const file = sortAppState.files.find(f => f.id === fileId);
  if (file) {
    file.selected = checked;
    const tile = document.getElementById(`tile-${fileId}`);
    if (tile) {
      if (checked) tile.classList.add('selected');
      else tile.classList.remove('selected');
    }
    updateFolderHeaderButtons(file.folder_index);
  }
};

function updateFolderHeaderButtons(folderIdx) {
  const folderCard = document.getElementById(`folder-card-${folderIdx}`);
  if (!folderCard) return;
  
  const folderFiles = sortAppState.files.filter(f => f.folder_index === folderIdx);
  const selectedInFolder = folderFiles.filter(f => f.selected).length;
  const allSelectedDontCopy = selectedInFolder > 0 && folderFiles.filter(f => f.selected).every(f => f.dont_copy);
  
  const editBtn = folderCard.querySelector('.edit-btn');
  if (editBtn) editBtn.disabled = selectedInFolder !== 1;
  
  const dontCopyBtn = folderCard.querySelector('.dontcopy-btn');
  if (dontCopyBtn) {
    dontCopyBtn.disabled = selectedInFolder === 0;
    if (allSelectedDontCopy) dontCopyBtn.classList.add('active-dont-copy');
    else dontCopyBtn.classList.remove('active-dont-copy');
  }
}

window.openEditForFolder = function(folderIdx) {
  const folderFiles = sortAppState.files.filter(f => f.folder_index === folderIdx && f.selected);
  if (folderFiles.length === 0) return;
  
  sortAppState.activeShiftFolderId = folderIdx;
  
  const folderPath = sortAppState.folders[folderIdx] || 'Unknown';
  document.getElementById('modal-title').innerText = `Edit: ${folderPath}`;
  
  const mainContributor = folderFiles[0].contributor;
  const contribFolderIndices = getContributorFolderIndices(mainContributor);
  const isFirstFolder = contribFolderIndices.length === 0 || contribFolderIndices[0] === folderIdx;
  const isLastFolder = contribFolderIndices.length === 0 || contribFolderIndices[contribFolderIndices.length - 1] === folderIdx;
  
  document.getElementById('btn-shift-up').disabled = isFirstFolder;
  document.getElementById('btn-move-up').disabled = isFirstFolder;
  document.getElementById('btn-shift-down').disabled = isLastFolder;
  document.getElementById('btn-move-down').disabled = isLastFolder;
  
  document.getElementById('edit-modal').style.display = 'flex';
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
  window.showToast(allMarked ? 'Files restored for copying.' : 'Selected files marked as Don\'t Copy.');
};

function closeModal() {
  document.getElementById('edit-modal').style.display = 'none';
  sortAppState.activeShiftFolderId = null;
}

function previewShift(actionType) {
  const folderIdx = sortAppState.activeShiftFolderId;
  if (folderIdx === null) return;
  
  const selectedFiles = sortAppState.files.filter(f => f.folder_index === folderIdx && f.selected);
  if (selectedFiles.length === 0) return;
  
  const contrib = selectedFiles[0].contributor;
  const contribFolderIndices = getContributorFolderIndices(contrib);
  const previewFiles = JSON.parse(JSON.stringify(sortAppState.files));
  const previewContribFiles = previewFiles.filter(f => f.contributor === contrib);
  const currentPosInContrib = contribFolderIndices.indexOf(folderIdx);
  
  if (actionType === 'shift-down') {
    const firstSelectedId = selectedFiles[0].id;
    const activeIdx = previewContribFiles.findIndex(f => f.id === firstSelectedId);
    for (let i = activeIdx; i < previewContribFiles.length; i++) {
      let f = previewContribFiles[i];
      const curPos = contribFolderIndices.indexOf(f.folder_index);
      if (curPos !== -1 && curPos < contribFolderIndices.length - 1) {
        f.folder_index = contribFolderIndices[curPos + 1];
      }
    }
  } else if (actionType === 'shift-up') {
    const lastSelectedId = selectedFiles[selectedFiles.length - 1].id;
    const activeIdx = previewContribFiles.findIndex(f => f.id === lastSelectedId);
    for (let i = 0; i <= activeIdx; i++) {
      let f = previewContribFiles[i];
      const curPos = contribFolderIndices.indexOf(f.folder_index);
      if (curPos !== -1 && curPos > 0) {
        f.folder_index = contribFolderIndices[curPos - 1];
      }
    }
  } else if (actionType === 'move-down') {
    const nextFolderIdx = (currentPosInContrib < contribFolderIndices.length - 1) ? contribFolderIndices[currentPosInContrib + 1] : folderIdx;
    selectedFiles.forEach(sf => {
      const pf = previewFiles.find(f => f.id === sf.id);
      if (pf) pf.folder_index = nextFolderIdx;
    });
  } else if (actionType === 'move-up') {
    const prevFolderIdx = (currentPosInContrib > 0) ? contribFolderIndices[currentPosInContrib - 1] : folderIdx;
    selectedFiles.forEach(sf => {
      const pf = previewFiles.find(f => f.id === sf.id);
      if (pf) pf.folder_index = prevFolderIdx;
    });
  }
  
  const changes = [];
  previewFiles.forEach(pf => {
    const origFile = sortAppState.files.find(f => f.id === pf.id);
    if (origFile && origFile.folder_index !== pf.folder_index) {
      const fromFolder = origFile.folder_index === -1 ? 'Unmapped' : (sortAppState.folders[origFile.folder_index] || 'Unknown');
      const toFolder = pf.folder_index === -1 ? 'Unmapped' : (sortAppState.folders[pf.folder_index] || 'Unknown');
      changes.push({ filename: pf.filename, from: fromFolder, to: toFolder });
    }
  });
  
  if (changes.length === 0) {
    window.showToast('No changes to apply.');
    closeModal();
    return;
  }
  
  sortAppState.pendingShift = { previewFiles, changes, actionType };
  closeModal();
  showPreviewModal(changes);
}

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
  if (changes.length > 0) showChangesReport(changes);
  window.showToast(`Applied ${changes.length} change(s).`);
}

function cancelPreview() {
  sortAppState.pendingShift = null;
  document.getElementById('preview-modal').style.display = 'none';
  window.showToast('Changes cancelled.');
}

function showChangesReport(changes) {
  const body = document.getElementById('report-modal-body');
  let html = '<ul style="margin:0; padding-left:20px; line-height:1.6;">';
  changes.forEach(c => {
    html += `<li class="mb-2"><strong>${c.filename}</strong>: <br><span style="color:var(--accent-red);">from:</span> <code>${c.from}</code><br><span style="color:var(--accent-green);">to:</span> <code>${c.to}</code></li>`;
  });
  html += '</ul>';
  body.innerHTML = html;
  document.getElementById('report-modal').style.display = 'flex';
}

function closeReportModal() { document.getElementById('report-modal').style.display = 'none'; }
function undoFromReport() { closeReportModal(); undo(); }

function renderFolders() {
  const container = document.getElementById('folders-container');
  container.innerHTML = '';
  
  let filteredFiles = sortAppState.files;
  if (sortAppState.selectedContributor !== 'ALL') {
    filteredFiles = sortAppState.files.filter(f => f.contributor === sortAppState.selectedContributor);
  }
  
  const query = sortAppState.searchQuery || '';
  if (query) {
    filteredFiles = filteredFiles.filter(f => f.filename.toLowerCase().includes(query));
  }

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
  
  // Filter buttons update
  const filterContainer = document.getElementById('contributor-filters');
  filterContainer.innerHTML = '';
  
  const allBtn = document.getElementById('btn-filter-all');
  if (allBtn) {
    if (sortAppState.selectedContributor === 'ALL') allBtn.classList.add('active');
    else allBtn.classList.remove('active');
  }
  
  Object.keys(sortAppState.contributors).forEach(c => {
    const btn = document.createElement('button');
    btn.className = `btn btn-secondary w-full text-left justify-start mb-2 ${sortAppState.selectedContributor === c ? 'active' : ''}`;
    btn.innerText = c;
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
    
    const folderFiles = filesByFolder[folderIdx];
    const folderPath = sortAppState.folders[folderIdx];
    const isCollapsed = sortAppState.collapsedFolders[folderIdx];
    const isEmpty = folderFiles.length === 0;
    const totalUnfiltered = allFilesByFolder[folderIdx] || 0;
    const isEmptyGlobally = totalUnfiltered === 0;
    
    if (query && isEmpty && !isEmptyGlobally) return;
    
    const selectedInFolder = folderFiles.filter(f => f.selected).length;
    const allSelectedDontCopy = selectedInFolder > 0 && folderFiles.filter(f => f.selected).every(f => f.dont_copy);
    
    const editDisabled = selectedInFolder !== 1;
    const dontCopyDisabled = selectedInFolder === 0;
    
    const card = document.createElement('div');
    card.className = `folder-card ${isCollapsed ? 'collapsed' : ''} ${isEmptyGlobally ? 'empty-folder' : ''}`;
    card.id = `folder-card-${folderIdx}`;
    
    // Header
    const header = document.createElement('div');
    header.className = 'folder-card-header';
    header.onclick = (e) => { if (!e.target.closest('.folder-header-actions')) toggleFolderCollapse(folderIdx); };
    
    let headerHTML = `
      <div class="folder-header-left">
        <span class="folder-toggle-icon"><svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg></span>
        <span class="folder-name" title="${folderPath}">${folderPath}</span>
        <span class="folder-file-count">(${folderFiles.length} files)</span>
    `;
    if (isEmptyGlobally) headerHTML += `<span class="badge" style="background:rgba(239,68,68,0.1); color:var(--accent-red); padding:0.1rem 0.4rem; font-size:0.7rem; border-radius:4px;">Empty</span>`;
    headerHTML += `</div><div class="folder-header-actions">`;
    headerHTML += `
        <button class="folder-action-btn edit-btn" ${editDisabled ? 'disabled' : ''} onclick="event.stopPropagation(); window.openEditForFolder(${folderIdx})">Edit</button>
        <button class="folder-action-btn dontcopy-btn ${allSelectedDontCopy ? 'active-dont-copy' : ''}" ${dontCopyDisabled ? 'disabled' : ''} onclick="event.stopPropagation(); window.toggleDontCopyForFolder(${folderIdx})">Don't Copy</button>
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
        tile.className = `thumb-tile ${f.selected ? 'selected' : ''} ${f.dont_copy ? 'dont-copy-tile' : ''}`;
        tile.id = `tile-${f.id}`;
        
        const fileName = f.filename || f.path.split(/[\\/]/).pop();
        // All files reaching here are non-sidecars (media files) - render thumbnail
        const imgHTML = `<img class="thumb-tile-img" data-src="${f.path}" src="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='140' height='100'><rect width='140' height='100' fill='%23ddd'/></svg>">`;
        
        const isVideo = f.is_video || (/\.(mp4|mov|avi|mkv|wmv)$/i).test(fileName);
        tile.ondblclick = (e) => {
          if (!e.target.classList.contains('thumb-tile-checkbox')) {
            if (window.openLightbox) window.openLightbox(f.path, fileName, isVideo);
          }
        };

        tile.innerHTML = `
          <input type="checkbox" class="thumb-tile-checkbox" ${f.selected ? 'checked' : ''} onchange="window.toggleFileSelect(${f.id}, this.checked)">
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
          window.pywebview.api.sorting_generate_thumbnail(path).then(base64Data => {
            if (base64Data) img.src = base64Data;
          }).catch(err => {
            console.error('Thumbnail load failed for:', path, err);
          });
        } else {
          obs.unobserve(img);
        }
      }
    });
  }, {
    root: contentArea || null,
    rootMargin: '200px 0px 200px 0px',
    threshold: 0.01
  });
  
  images.forEach(img => observer.observe(img));
}

function confirmTransfer(action) {
  if (confirm(`Are you sure you want to ${action} all mapped files to their destination folders?`)) {
    window.showToast(`Executing ${action}...`);
    window.pywebview.api.sorting_execute_transfer(action, sortAppState.files, sortAppState.folders).then(res => {
      if (res.success) {
        updateUndoTransferButtonState(res.can_undo);
        window.showToast(`Successfully ${action}ed ${res.count} file(s)!`, 'success');
        const headerActions = document.querySelector('.header-actions');
        if (headerActions && !document.getElementById('btn-open-sort-output')) {
          const btnOpen = document.createElement('button');
          btnOpen.id = 'btn-open-sort-output';
          btnOpen.className = 'btn btn-select';
          btnOpen.innerHTML = '📁 Open Output Folder';
          btnOpen.onclick = () => {
            const dest = sortAppState.root_dir || (sortAppState.folders[0] ? sortAppState.folders[0] : null);
            if (dest) window.pywebview.api.open_in_explorer(dest);
          };
          headerActions.appendChild(btnOpen);
        }
      } else {
        window.showToast('Transfer failed: ' + res.error, 'error');
      }
    });
  }
}
