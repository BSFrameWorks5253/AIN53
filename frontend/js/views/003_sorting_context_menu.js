/* ============================================================
   AIN53 Data Management — Sorting Context Menu Logic
   003_sorting_context_menu.js
   (Feature removed: No context menu on right click)
   ============================================================ */

window._activeContextFileId    = null;
window._activeContextFolderIdx = null;

window.showSortingContextMenu = function() {
  // Disabled: Right-click context menu removed
};

window.hideSortingContextMenu = function() {
  var ctx = document.getElementById('sorting-context-menu');
  if (ctx) ctx.classList.add('hidden');
};

window.closeContextFolderPicker = function() {
  var picker = document.getElementById('ctx-folder-picker');
  if (picker) picker.classList.add('hidden');
};
