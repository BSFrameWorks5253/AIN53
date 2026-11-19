/* ==============================================================================
   AIN53 Data Management — Global Drag and Drop Overlay Controller (drag_drop.js)
   ============================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  const dragOverlay = document.getElementById('drag-drop-overlay');
  window._dragCounter = 0;

  if (!dragOverlay) return;

  function isExternalFileDrag(e) {
    if (window._draggedMediaFiles || window._isInternalDragging) return false;
    if (!e.dataTransfer || !e.dataTransfer.types) return false;
    const types = Array.from(e.dataTransfer.types);
    return types.includes('Files') || types.includes('application/x-moz-file');
  }

  window.addEventListener('dragenter', (e) => {
    e.preventDefault();
    if (!isExternalFileDrag(e)) return;
    window._dragCounter++;
    if (window._dragCounter === 1) {
      dragOverlay.classList.remove('hidden');
    }
  });

  window.addEventListener('dragleave', (e) => {
    e.preventDefault();
    if (window._dragCounter > 0) {
      window._dragCounter--;
      if (window._dragCounter === 0) {
        dragOverlay.classList.add('hidden');
      }
    }
  });

  window.addEventListener('dragover', (e) => {
    e.preventDefault();
  });

  window.addEventListener('drop', (e) => {
    e.preventDefault();
    window._dragCounter = 0;
    dragOverlay.classList.add('hidden');
  });
});
