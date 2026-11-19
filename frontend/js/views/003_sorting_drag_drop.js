/* ============================================================
   AIN53 Data Management — Sorting Drag-Drop Logic
   003_sorting_drag_drop.js

   Handles:
   - Drag-and-drop gesture (mousedown/move/up + HTML5 drag events)
   - Folder grid overlay rendering (strict cameraman filtering)
   - Move confirmation modal
   - requestMoveFilesToFolder / executeMoveFilesToFolder

   NOTE: Loads after 003_sorting.js. Uses window.* to access
         sortAppState and helper functions from 003_sorting.js.
   ============================================================ */

// ── Shared drag state (exposed on window for tile onmousedown in 003_sorting.js) ──
window._sortDragState = {
  isMouseDown: false,
  startX: 0,
  startY: 0,
  isDragging: false,
  file: null,
  folderIdx: null,
  draggedFiles: []
};

window._draggedMediaFiles = null;
var _dd_pendingMove = null;

// ── Video file extension test ──
var _DD_VIDEO_RE = /\.(mp4|mov|avi|mkv|wmv|mts|m2ts|m4v|webm|flv|3gp)$/i;
function _ddIsVideo(f) {
  return f.is_video || f.file_type === 'video' || _DD_VIDEO_RE.test(f.filename || f.path || '');
}

// ── Extract event-name from full folder path ──
function getEventNameFromFolder(folderStr) {
  if (!folderStr) return 'EVENT';
  var parts = folderStr.split(/[/\\]/).map(function(p) { return p.trim(); }).filter(Boolean);
  if (parts.length === 0) return 'EVENT';

  // Scan parts backwards for an event code pattern like "01-Z", "02-Q", "10a-N", "1a-N", "01b-N", "01b-MF", "03a-N"
  for (var i = parts.length - 1; i >= 0; i--) {
    var clean = parts[i].replace(/\s*\([^)]*\)/g, '').trim();
    if (/^\d+[a-z]*[-_][a-z0-9_-]+/i.test(clean)) {
      return clean;
    }
  }

  // If path has multiple segments and no regex match, fallback intelligently
  if (parts.length >= 2) {
    var last = parts[parts.length - 1].replace(/\s*\([^)]*\)/g, '').trim();
    if (/\s|bhai|ben|kumar|sharma|patel|johar/i.test(last)) {
      return parts[parts.length - 2].replace(/\s*\([^)]*\)/g, '').trim();
    }
    return last;
  }

  return parts[parts.length - 1].replace(/\s*\([^)]*\)/g, '').trim();
}
window.getEventNameFromFolder = getEventNameFromFolder;

// ── Helper to extract cameraman/contributor name from a folder path ──
function getContributorFromFolder(folderPath) {
  if (!folderPath) return '';
  var parts = folderPath.split(/[/\\]/).map(function(p) { return p.trim(); }).filter(Boolean);
  if (parts.length === 0) return '';
  
  for (var i = parts.length - 1; i >= 0; i--) {
    var p = parts[i];
    if (/^\d+[a-z]*[-_][a-z0-9_-]+$/i.test(p)) continue;
    if (/\s|bhai|ben|mulla|kumar|sharma|patel|johar|anuppurwala|wala|shaikh/i.test(p) || /^[A-Za-z\s]+$/.test(p)) {
      return p;
    }
  }

  return parts[parts.length - 1];
}
window.getContributorFromFolder = getContributorFromFolder;

function getContributorNameTokens(str) {
  if (!str) return [];
  return str.toLowerCase().split(/\s+/).filter(function(t) {
    return t.length > 2 && !/^(bhai|ben|mulla|kumar|sharma|patel|johar|anuppurwala|cameraman|contrib|slot)$/i.test(t);
  });
}

// ── Check if two contributor name strings belong to the exact same person ──
function areContributorsSame(contribA, contribB) {
  if (!contribA || !contribB) return false;
  var a = contribA.toLowerCase().trim();
  var b = contribB.toLowerCase().trim();
  if (!a || !b || a === 'all' || b === 'all') return false;

  if (a === b || a.includes(b) || b.includes(a)) return true;

  var tokensA = getContributorNameTokens(a);
  var tokensB = getContributorNameTokens(b);

  if (tokensA.length > 0 && tokensB.length > 0) {
    return tokensA[0] === tokensB[0];
  }

  return false;
}

// ── Helper to match contributor string with target folder path ──
function contributorMatchesFolder(contributor, folderPath, state, folderIdx) {
  if (!contributor || contributor === 'ALL' || !folderPath) return false;
  var contribLower = contributor.toLowerCase().trim();
  if (!contribLower || contribLower === 'all') return false;

  var targetContrib = getContributorFromFolder(folderPath);
  if (targetContrib && areContributorsSame(contributor, targetContrib)) {
    return true;
  }

  var folderLower = folderPath.toLowerCase().trim();

  // 1. Exact or path segment match
  if (folderLower.endsWith('/' + contribLower) || folderLower.endsWith('\\' + contribLower)) {
    return true;
  }

  // 2. CSV folder match
  if (state && state.allCsvFolders && state.allCsvFolders[folderIdx]) {
    var csvFolder = state.allCsvFolders[folderIdx];
    var csvContrib = getContributorFromFolder(csvFolder);
    if (csvContrib && areContributorsSame(contributor, csvContrib)) return true;
  }

  // 3. Primary name token match
  var tokens = getContributorNameTokens(contribLower);
  if (tokens.length > 0 && targetContrib) {
    var targetTokens = getContributorNameTokens(targetContrib);
    if (targetTokens.length > 0 && targetTokens[0] === tokens[0]) {
      return true;
    }
  }

  return false;
}

// ── Infer contributor strictly from active pool of files or source folder path ──
function inferContributorFromFiles(pool) {
  var state = sortAppState;
  if (!pool || pool.length === 0) return null;

  // 1. Direct file object contributor property
  for (var i = 0; i < pool.length; i++) {
    var c = pool[i].contributor;
    if (c && c !== 'ALL' && c !== 'UNSORTED' && c !== 'UNASSIGNED') {
      return c;
    }
  }

  // 2. Extract contributor from source folder path of files in pool
  for (var k = 0; k < pool.length; k++) {
    var file = pool[k];
    if (file && file.folder_index !== undefined && file.folder_index >= 0 && state.folders && state.folders[file.folder_index]) {
      var srcFolderPath = state.folders[file.folder_index];
      var inferred = getContributorFromFolder(srcFolderPath);
      if (inferred && inferred !== 'ALL' && inferred !== 'UNSORTED') {
        return inferred;
      }
    }
  }

  return null;
}

// ── Strict contributor folder matching (ONLY show folders of the EXACT same contributor) ──
function getStrictContributorFolders(contributor) {
  var state = sortAppState;
  if (!state.folders || state.folders.length === 0) return [];

  // Active dragged or selected files pool
  var pool = (window._draggedMediaFiles && window._draggedMediaFiles.length > 0)
    ? window._draggedMediaFiles
    : state.files.filter(function(f) { return f.selected && !f.is_sidecar; });

  // Auto-infer contributor from dragged/selected files if contributor is missing or 'ALL'
  if (!contributor || contributor === 'ALL' || contributor.trim() === '') {
    var inferred = inferContributorFromFiles(pool);
    if (inferred) contributor = inferred;
  }

  // If still 'ALL', try selectedContributor from sidebar if active
  if ((!contributor || contributor === 'ALL' || contributor.trim() === '') && state.selectedContributor && state.selectedContributor !== 'ALL') {
    contributor = state.selectedContributor;
  }

  // If no contributor identified at all, return all folders
  if (!contributor || contributor === 'ALL' || contributor.trim() === '') {
    return state.folders.map(function(_, idx) { return idx; });
  }

  var targetContribLower = contributor.toLowerCase().trim();
  var targetTokens = getContributorNameTokens(targetContribLower);

  var matched = [];
  state.folders.forEach(function(folderPath, idx) {
    var folderContrib = getContributorFromFolder(folderPath);
    if (folderContrib) {
      var fContribLower = folderContrib.toLowerCase().trim();
      // 1. Direct exact or token match
      if (fContribLower === targetContribLower || areContributorsSame(contributor, folderContrib)) {
        matched.push(idx);
        return;
      }
      // 2. Core name token match (e.g. "aliasgar" === "aliasgar")
      var fTokens = getContributorNameTokens(fContribLower);
      if (targetTokens.length > 0 && fTokens.length > 0 && targetTokens[0] === fTokens[0]) {
        matched.push(idx);
        return;
      }
    }

    // 3. Substring match ONLY if targetContribLower is a meaningful non-empty string
    if (targetContribLower.length >= 3) {
      var fPathLower = folderPath.toLowerCase().trim();
      if (fPathLower.endsWith('/' + targetContribLower) || fPathLower.endsWith('\\' + targetContribLower)) {
        matched.push(idx);
      }
    }
  });

  return matched;
}
window.getStrictContributorFolders = getStrictContributorFolders;

// ── Render the folder-card grid inside the overlay ──
function renderDragFolderGridOverlay(contributor) {
  var overlay   = document.getElementById('drag-folder-grid-overlay');
  var container = document.getElementById('drag-folder-grid-container');
  var badge     = document.getElementById('drag-grid-cameraman-badge');
  var infoText  = document.getElementById('drag-grid-info-text');
  if (!overlay || !container) return;

  var state = sortAppState;
  var pool = (window._draggedMediaFiles && window._draggedMediaFiles.length > 0)
    ? window._draggedMediaFiles
    : state.files.filter(function(f) { return f.selected && !f.is_sidecar; });

  if ((!contributor || contributor === 'ALL') && pool.length > 0) {
    var inferred = inferContributorFromFiles(pool);
    if (inferred) contributor = inferred;
  }

  var count = pool.length;
  if (badge) {
    var activeContribStr = contributor || 'ALL';
    badge.innerHTML = '<span class="cameraman-dot"></span><span class="cameraman-text">Cameraman: ' + activeContribStr + '</span>';
  }
  if (infoText) {
    infoText.innerText = count > 0
      ? 'Moving ' + count + ' clip' + (count > 1 ? 's' : '') + ' — Contributor: ' + (contributor || 'ALL')
      : 'Select a target folder to move selected clips';
  }

  var folderIndices = getStrictContributorFolders(contributor);
  container.innerHTML = '';

  if (folderIndices.length === 0) {
    container.innerHTML = '<div class="drag-grid-empty-msg">' +
      '<div class="empty-icon-box"><svg width="32" height="32" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/></svg></div>' +
      '<p class="empty-title">No folders found for contributor "<strong>' + (contributor || 'Selected') + '</strong>"</p>' +
      '<span class="empty-subtitle">Only folders belonging to this cameraman are displayed.</span>' +
      '</div>';
    return;
  }

  folderIndices.forEach(function(folderIdx) {
    var folderPath  = state.folders[folderIdx] || ('Folder ' + folderIdx);
    var eventName   = getEventNameFromFolder(folderPath);
    var cardContrib = getContributorFromFolder(folderPath);
    var folderFiles = state.files.filter(function(f) { return f.folder_index === folderIdx && !f.is_sidecar; });
    var videoCount  = folderFiles.filter(_ddIsVideo).length;
    var photoCount  = folderFiles.length - videoCount;

    var isEmptyFolder = (folderFiles.length === 0);
    var camColor    = window.getCameramanColor ? window.getCameramanColor(cardContrib) : { hex: '#818cf8', darkHex: '#1e1b4b', textHex: '#ffffff', border: 'rgba(129, 140, 248, 0.45)' };

    var strokeColor = isEmptyFolder ? '#ef4444' : camColor.hex;
    var cardBg      = isEmptyFolder ? 'rgba(253, 102, 102, 0.08)' : (camColor.lightBg || 'rgba(6, 182, 212, 0.22)');
    var cardBorder  = isEmptyFolder ? 'rgba(239, 68, 68, 0.4)' : camColor.hex;
    var svgFill     = isEmptyFolder ? 'rgba(239, 68, 68, 0.12)' : (camColor.lightBg || 'rgba(6, 182, 212, 0.25)');
    var badgeBg     = isEmptyFolder ? '#ef4444' : camColor.hex;
    var badgeText   = '#ffffff';
    var badgeBorder = isEmptyFolder ? '#ef4444' : camColor.hex;
    var fontSizeStyle = eventName.length > 8 ? 'font-size: 0.76rem;' : (eventName.length > 6 ? 'font-size: 0.82rem;' : 'font-size: 0.9rem;');

    var card = document.createElement('div');
    card.className = 'drag-folder-card' + (isEmptyFolder ? ' empty-folder' : '');
    card.dataset.folderIdx = folderIdx;

    var dragMetaHTML = '';
    if (videoCount > 0 || photoCount > 0) {
      dragMetaHTML += '<div class="drag-folder-meta">';
      if (videoCount > 0) {
        dragMetaHTML += '<span class="drag-folder-badge badge-video-count"><svg width="11" height="11" fill="currentColor" viewBox="0 0 24 24"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg> ' + videoCount + '</span>';
      }
      if (photoCount > 0) {
        dragMetaHTML += '<span class="drag-folder-badge badge-photo-count"><svg width="11" height="11" fill="currentColor" viewBox="0 0 24 24"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg> ' + photoCount + '</span>';
      }
      dragMetaHTML += '</div>';
    }

    card.innerHTML =
      '<div class="folder-card-top-glow" style="background:' + strokeColor + '; opacity: 0.9;"></div>' +
      '<div class="folder-icon-graphic-box">' +
        '<div class="folder-svg-wrapper">' +
          '<svg class="folder-graphic-svg" viewBox="0 0 100 70" fill="none" xmlns="http://www.w3.org/2000/svg">' +
            '<path d="M4 10C4 6.68629 6.68629 4 10 4H36C38.6 4 40.9 5.4 42.1 7.6L45.5 13.5H90C93.3137 13.5 96 16.1863 96 19.5V60C96 63.3137 93.3137 66 90 66H10C6.68629 66 4 63.3137 4 60V10Z" fill="' + svgFill + '" stroke="' + strokeColor + '" stroke-width="2.2"/>' +
          '</svg>' +
          '<div class="folder-event-text-overlay" style="' + fontSizeStyle + ' background:' + badgeBg + '; color:#ffffff !important; border: 1.5px solid ' + badgeBorder + '; font-weight:800; text-shadow:none;" title="' + eventName + '">' + eventName + '</div>' +
        '</div>' +
      '</div>' +
      dragMetaHTML +
      '<div class="drag-drop-hover-hint"><span>Drop Here</span></div>';

    card.ondragover = function(e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      card.classList.add('drag-over');
    };
    card.ondragleave = function() { card.classList.remove('drag-over'); };
    card.ondrop = function(e) {
      e.preventDefault();
      card.classList.remove('drag-over');
      requestMoveFilesToFolder(folderIdx);
    };
    card.onclick = function() { requestMoveFilesToFolder(folderIdx); };

    container.appendChild(card);
  });
}

function showDragFolderGridOverlay(contributor) {
  renderDragFolderGridOverlay(contributor);
  var overlay = document.getElementById('drag-folder-grid-overlay');
  if (overlay) {
    overlay.style.display = 'flex';
    overlay.classList.remove('hidden');
  }
}
window.showDragFolderGridOverlay = showDragFolderGridOverlay;

function closeDragFolderGridOverlay() {
  var overlay = document.getElementById('drag-folder-grid-overlay');
  if (overlay) {
    overlay.classList.add('fade-out');
    setTimeout(function() {
      overlay.style.display = 'none';
      overlay.classList.add('hidden');
      overlay.classList.remove('fade-out');
    }, 150);
  }
  window._draggedMediaFiles = null;
  if (window._sortDragState) {
    window._sortDragState.isMouseDown = false;
    window._sortDragState.isDragging  = false;
    window._sortDragState.draggedFiles = null;
  }
  window._isInternalDragging = false;

  var av = document.getElementById('drag-floating-avatar');
  if (av) av.style.display = 'none';

  if (sortAppState && overlay && overlay.style.display !== 'none' && !overlay.getAttribute('data-was-open-for-confirm')) {
    sortAppState.pendingShiftDownState = null;
  }

  document.querySelectorAll('.drag-folder-card').forEach(function(c) { c.classList.remove('drag-over'); });
}
window.closeDragFolderGridOverlay = closeDragFolderGridOverlay;

// ── Open overlay from floating bar "Move Clips" button ──
function openMoveFolderGridModal() {
  var selectedFiles = sortAppState.files.filter(function(f) { return f.selected && !f.is_sidecar; });
  var contrib = 'ALL';
  var ctxFileId = window._activeContextFileId !== undefined ? window._activeContextFileId : null;
  if (ctxFileId !== null) {
    var ctxFile = sortAppState.files.find(function(item) { return item.id === ctxFileId; });
    if (ctxFile) {
      contrib = inferContributorFromFiles([ctxFile]) || ctxFile.contributor || 'ALL';
    }
  } else if (selectedFiles.length > 0) {
    contrib = inferContributorFromFiles(selectedFiles) || selectedFiles[0].contributor || 'ALL';
  }
  showDragFolderGridOverlay(contrib);
}
window.openMoveFolderGridModal = openMoveFolderGridModal;

// ── Move request — shows confirmation if target folder already has existing files ──
function requestMoveFilesToFolder(targetFolderIdx) {
  if (sortAppState.pendingShiftDownState) {
    var shiftState = sortAppState.pendingShiftDownState;

    if (targetFolderIdx === shiftState.sourceFolderIdx) {
      if (window.showToast) window.showToast('Destination folder is the same as source folder.', true);
      return;
    }

    shiftState.targetFolderIdx = targetFolderIdx;
    shiftState.targetFolderName = sortAppState.folders[targetFolderIdx] || ('Folder ' + targetFolderIdx);

    var dragOverlay = document.getElementById('drag-folder-grid-overlay');
    if (dragOverlay) dragOverlay.style.display = 'none';

    showShiftDownConfirmModal(shiftState);
    return;
  }

  if (sortAppState.pendingShiftUpState) {
    var shiftUpState = sortAppState.pendingShiftUpState;

    if (targetFolderIdx === shiftUpState.sourceFolderIdx) {
      if (window.showToast) window.showToast('Destination folder is the same as source folder.', true);
      return;
    }

    shiftUpState.targetFolderIdx = targetFolderIdx;
    shiftUpState.targetFolderName = sortAppState.folders[targetFolderIdx] || ('Folder ' + targetFolderIdx);

    var dragOverlayUp = document.getElementById('drag-folder-grid-overlay');
    if (dragOverlayUp) dragOverlayUp.style.display = 'none';

    showShiftUpConfirmModal(shiftUpState);
    return;
  }

  var filesToMove = (window._draggedMediaFiles && window._draggedMediaFiles.length > 0)
    ? window._draggedMediaFiles
    : sortAppState.files.filter(function(f) { return f.selected && !f.is_sidecar; });

  if ((!filesToMove || filesToMove.length === 0) && window._activeContextFileId !== null) {
    var ctxFile = sortAppState.files.find(function(f) { return f.id === window._activeContextFileId; });
    if (ctxFile) filesToMove = [ctxFile];
  }

  if (!filesToMove || filesToMove.length === 0) {
    if (window.showToast) window.showToast('No files selected to move.', true);
    closeDragFolderGridOverlay();
    return;
  }

  var targetFolderName  = sortAppState.folders[targetFolderIdx] || ('Folder ' + targetFolderIdx);
  var targetFolderFiles = sortAppState.files.filter(function(f) { return f.folder_index === targetFolderIdx && !f.is_sidecar; });

  if (targetFolderFiles.length > 0) {
    _dd_pendingMove = {
      fileIds: filesToMove.map(function(f) { return f.id; }),
      targetFolderIdx: targetFolderIdx,
      targetFolderName: targetFolderName
    };

    // Minimize / hide the drag grid overlay so only the confirmation popup is active
    var dragOverlay = document.getElementById('drag-folder-grid-overlay');
    if (dragOverlay && dragOverlay.style.display !== 'none') {
      dragOverlay.style.display = 'none';
      dragOverlay.setAttribute('data-was-open-for-confirm', 'true');
    }

    var confirmModal = document.getElementById('move-confirm-modal');
    var titleEl      = document.querySelector('#move-confirm-modal .move-confirm-title');
    var msgEl        = document.getElementById('move-confirm-message');
    var okBtn        = document.getElementById('btn-move-confirm-ok');
    var cancelBtn    = document.getElementById('btn-move-confirm-cancel');
    
    if (titleEl) {
      titleEl.innerText = 'Folder Already Contains Files';
    }
    if (msgEl) {
      var displayName = getEventNameFromFolder(targetFolderName);
      msgEl.innerHTML = 'Are you sure you want to add <strong>' + filesToMove.length +
        '</strong> file(s) to <strong>' + displayName + '</strong>? This folder already contains <strong>' + targetFolderFiles.length + '</strong> file(s).';
    }

    if (okBtn) {
      okBtn.innerText = 'Yes, Move Files';
      okBtn.onclick = function() {
        if (_dd_pendingMove) {
          executeMoveFilesToFolder(_dd_pendingMove.fileIds, _dd_pendingMove.targetFolderIdx, _dd_pendingMove.targetFolderName);
          _dd_pendingMove = null;
        }
      };
    }

    if (cancelBtn) {
      cancelBtn.onclick = function() {
        var confirmModal = document.getElementById('move-confirm-modal');
        if (confirmModal) confirmModal.style.display = 'none';
        _dd_pendingMove = null;
        if (window.showToast) window.showToast('Move cancelled.');
      };
    }

    if (confirmModal) {
      confirmModal.style.display = 'flex';
      confirmModal.classList.remove('hidden');
    }
  } else {
    executeMoveFilesToFolder(filesToMove.map(function(f) { return f.id; }), targetFolderIdx, targetFolderName);
  }
}
window.requestMoveFilesToFolder = requestMoveFilesToFolder;

function showShiftDownConfirmModal(shiftState) {
  var confirmModal = document.getElementById('move-confirm-modal');
  var titleEl      = document.querySelector('#move-confirm-modal .move-confirm-title');
  var msgEl        = document.getElementById('move-confirm-message');
  var okBtn        = document.getElementById('btn-move-confirm-ok');
  var cancelBtn    = document.getElementById('btn-move-confirm-cancel');

  var srcName  = window.getEventNameFromFolder ? window.getEventNameFromFolder(shiftState.sourceFolderName) : shiftState.sourceFolderName;
  var destName = window.getEventNameFromFolder ? window.getEventNameFromFolder(shiftState.targetFolderName) : shiftState.targetFolderName;

  if (titleEl) {
    titleEl.innerHTML = '⚡ Confirm Shift All Down';
  }
  if (msgEl) {
    msgEl.innerHTML = 'Are you sure you want to shift <strong>' + shiftState.clipsToShift.length +
      '</strong> clip(s) (starting from clip <strong>"' + shiftState.firstClipName + '"</strong>) from <strong>' +
      srcName + '</strong> to <strong>' + destName + '</strong>?<br><br>' +
      '<span style="color:#f59e0b; font-weight:600; font-size:0.88rem;">' +
      '⚡ Existing clips in <strong>' + destName + '</strong> and subsequent folders will cascade down across folders of contributor "' + shiftState.contributor + '". No files will be moved outside this contributor.' +
      '</span>';
  }

  if (okBtn) {
    okBtn.innerText = 'Yes, Confirm Shift All Down';
    okBtn.onclick = function() {
      if (confirmModal) confirmModal.style.display = 'none';
      if (window.executeShiftAllDown) window.executeShiftAllDown(shiftState);
    };
  }

  if (cancelBtn) {
    cancelBtn.onclick = function() {
      if (confirmModal) confirmModal.style.display = 'none';
      sortAppState.pendingShiftDownState = null;
      if (window.showToast) window.showToast('Shift cancelled.');
    };
  }

  if (confirmModal) {
    confirmModal.style.display = 'flex';
    confirmModal.classList.remove('hidden');
  }
}
window.showShiftDownConfirmModal = showShiftDownConfirmModal;

function showShiftUpConfirmModal(shiftState) {
  var confirmModal = document.getElementById('move-confirm-modal');
  var titleEl      = document.querySelector('#move-confirm-modal .move-confirm-title');
  var msgEl        = document.getElementById('move-confirm-message');
  var okBtn        = document.getElementById('btn-move-confirm-ok');
  var cancelBtn    = document.getElementById('btn-move-confirm-cancel');

  var srcName  = window.getEventNameFromFolder ? window.getEventNameFromFolder(shiftState.sourceFolderName) : shiftState.sourceFolderName;
  var destName = window.getEventNameFromFolder ? window.getEventNameFromFolder(shiftState.targetFolderName) : shiftState.targetFolderName;

  if (titleEl) {
    titleEl.innerHTML = '⚡ Confirm Shift All Up';
  }
  if (msgEl) {
    msgEl.innerHTML = 'Are you sure you want to shift <strong>' + shiftState.clipsToShift.length +
      '</strong> clip(s) (from start of folder up to clip <strong>"' + shiftState.lastClipName + '"</strong>) from <strong>' +
      srcName + '</strong> to <strong>' + destName + '</strong>?<br><br>' +
      '<span style="color:#f59e0b; font-weight:600; font-size:0.88rem;">' +
      '⚡ Existing clips in <strong>' + destName + '</strong> and preceding folders will cascade up across folders of contributor "' + shiftState.contributor + '". No files will be moved outside this contributor.' +
      '</span>';
  }

  if (okBtn) {
    okBtn.innerText = 'Yes, Confirm Shift All Up';
    okBtn.onclick = function() {
      if (confirmModal) confirmModal.style.display = 'none';
      if (window.executeShiftAllUp) window.executeShiftAllUp(shiftState);
    };
  }

  if (cancelBtn) {
    cancelBtn.onclick = function() {
      if (confirmModal) confirmModal.style.display = 'none';
      sortAppState.pendingShiftUpState = null;
      if (window.showToast) window.showToast('Shift cancelled.');
    };
  }

  if (confirmModal) {
    confirmModal.style.display = 'flex';
    confirmModal.classList.remove('hidden');
  }
}
window.showShiftUpConfirmModal = showShiftUpConfirmModal;

// ── Execute the actual move ──
function executeMoveFilesToFolder(fileIds, targetFolderIdx, targetFolderName) {
  if (!fileIds || fileIds.length === 0) return;
  if (targetFolderName === undefined && sortAppState.folders[targetFolderIdx]) {
    targetFolderName = sortAppState.folders[targetFolderIdx];
  }

  saveHistory();

  var targetSet = new Set(fileIds);
  var movedFiles = [];

  sortAppState.files.forEach(function(f) {
    if (targetSet.has(f.id)) {
      f.folder_index = targetFolderIdx;
      f.selected = false;
      movedFiles.push(f);
    }
  });

  sanitizeVideoFolderAssignments();

  var dragOverlay = document.getElementById('drag-folder-grid-overlay');
  if (dragOverlay) {
    dragOverlay.removeAttribute('data-was-open-for-confirm');
  }
  closeDragFolderGridOverlay();
  if (window.closeContextFolderPicker) window.closeContextFolderPicker();

  var confirmModal = document.getElementById('move-confirm-modal');
  if (confirmModal) {
    confirmModal.style.display = 'none';
    confirmModal.classList.add('hidden');
  }

  _dd_pendingMove = null;
  window._draggedMediaFiles = null;
  window._activeContextFileId = null;
  window._activeContextFolderIdx = null;

  renderFolders();
  lazyLoadThumbnails();
  if (window.updateFloatingSelectionBar) window.updateFloatingSelectionBar();

  var label = targetFolderName ? getEventNameFromFolder(targetFolderName) : ('Folder ' + targetFolderIdx);
  
  var videoCount = movedFiles.filter(_ddIsVideo).length;
  var photoCount = movedFiles.length - videoCount;

  var parts = [];
  if (videoCount > 0) parts.push(videoCount + ' Video' + (videoCount > 1 ? 's' : ''));
  if (photoCount > 0) parts.push(photoCount + ' Photo' + (photoCount > 1 ? 's' : ''));
  var mediaStr = parts.length > 0 ? parts.join(' and ') : (movedFiles.length + ' file' + (movedFiles.length > 1 ? 's' : ''));

  if (window.showToast) {
    window.showToast('Transferred ' + mediaStr + ' to folder: ' + label + ' ✓', false);
  }
}
window.executeMoveFilesToFolder = executeMoveFilesToFolder;

// ── Wire up move-confirm modal buttons ──
(function wireConfirmModal() {
  var okBtn = document.getElementById('btn-move-confirm-ok');
  if (okBtn) {
    okBtn.addEventListener('click', function() {
      if (_dd_pendingMove) {
        executeMoveFilesToFolder(_dd_pendingMove.fileIds, _dd_pendingMove.targetFolderIdx, _dd_pendingMove.targetFolderName);
      }
    });
  }
  var cancelBtn = document.getElementById('btn-move-confirm-cancel');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', function() {
      _dd_pendingMove = null;
      var modal = document.getElementById('move-confirm-modal');
      if (modal) {
        modal.style.display = 'none';
        modal.classList.add('hidden');
      }

      // If drag folder grid overlay was hidden for confirmation, restore it so user can choose another folder
      var dragOverlay = document.getElementById('drag-folder-grid-overlay');
      if (dragOverlay && dragOverlay.getAttribute('data-was-open-for-confirm') === 'true') {
        dragOverlay.removeAttribute('data-was-open-for-confirm');
        dragOverlay.style.display = 'flex';
      }
    });
  }
})();

// ================================================================
// Global Drag Listeners — disabled (Drag Drop feature removed)
// ================================================================
function initGlobalDragListeners() {
  // Drag and drop gestures removed
}

window.initGlobalDragListeners = initGlobalDragListeners;

