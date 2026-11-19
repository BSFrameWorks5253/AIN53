// ── CSV to Folders Logic ──

document.addEventListener('DOMContentLoaded', () => {
  const btnInput = document.getElementById('btn-csv-input');
  const btnDest = document.getElementById('btn-csv-dest');
  const btnProcess = document.getElementById('btn-csv-process');
  const inputPath = document.getElementById('csv-input-path');
  const destPath = document.getElementById('csv-dest-path');
  const resultArea = document.getElementById('csv-result');
  
  let currentInput = null;
  let currentDest = null;
  
  function checkReady() {
    btnProcess.disabled = !(currentInput && currentDest);
  }

  window.setCsvInputPath = function(path, syncToSorting = true) {
    if (!path) return;
    currentInput = path;
    if (inputPath) inputPath.value = currentInput;
    checkReady();
    if (syncToSorting && window.setSortingMappingPath) {
      window.setSortingMappingPath(path, false);
    }
    if (window.pywebview && window.pywebview.api && window.pywebview.api.set_setting) {
      window.pywebview.api.set_setting('csv_input_path', path);
    }
  };

  window.setCsvDestPath = function(path, syncToSorting = true) {
    if (!path) return;
    currentDest = path;
    if (destPath) destPath.value = currentDest;
    checkReady();
    if (syncToSorting && window.setSortingRootPath) {
      window.setSortingRootPath(path, false);
    }
    if (window.pywebview && window.pywebview.api && window.pywebview.api.set_setting) {
      window.pywebview.api.set_setting('csv_dest_path', path);
    }
  };

  window.getCsvInputPath = function() { return currentInput; };
  window.getCsvDestPath = function() { return currentDest; };
  
  async function loadInput(path = null) {
    try {
      const resp = await window.pywebview.api.csv_select_input(path);
      const data = JSON.parse(resp);
      if (data.error) {
        if (data.error !== "Cancelled") {
          window.showToast(data.error, true);
        }
        return;
      }
      if (data.path) {
        window.setCsvInputPath(data.path, true);
      }
    } catch (e) { console.error(e); }
  }

  btnInput.addEventListener('click', () => loadInput(null));
  
  window.makeDropZone('csv-input-container', paths => {
    if (paths && paths.length > 0) {
      const file = paths[0];
      if (file.toLowerCase().endsWith('.csv')) {
        loadInput(file);
      } else {
        window.showToast("Please drop a valid CSV file (.csv)", true);
      }
    }
  });
  
  async function loadDest(path = null) {
    try {
      const resp = await window.pywebview.api.csv_select_dest(path);
      const data = JSON.parse(resp);
      if (data.error) {
        if (data.error !== "Cancelled") {
          window.showToast(data.error, true);
        }
        return;
      }
      if (data.path) {
        window.setCsvDestPath(data.path, true);
      }
    } catch (e) { console.error(e); }
  }

  btnDest.addEventListener('click', () => loadDest(null));

  window.makeDropZone('csv-dest-container', paths => {
    if (paths && paths.length > 0) loadDest(paths[0]);
  });
  
  btnProcess.addEventListener('click', async () => {
    btnProcess.disabled = true;
    btnProcess.textContent = 'Processing...';
    resultArea.classList.add('hidden');
    
    try {
      const resp = await window.pywebview.api.csv_process(currentInput, currentDest);
      const data = JSON.parse(resp);
      
      if (data.error) {
        window.showToast(data.error, true);
      } else {
        // Automatically sync updated mapping CSV inside Document/ folder to Media Sorting
        if (data.updated_mapping_path && window.setSortingMappingPath) {
          window.setSortingMappingPath(data.updated_mapping_path, false);
        }
        if (data.updated_mapping_path && window.setCsvInputPath) {
          window.setCsvInputPath(data.updated_mapping_path, false);
        }
        if (data.dest_dir && window.setSortingRootPath) {
          window.setSortingRootPath(data.dest_dir, false);
        }
        if (data.dest_dir && window.setInventoryDrivePath) {
          window.setInventoryDrivePath(data.dest_dir);
        }

        const escPath = (currentDest || '').replace(/\\/g, '\\\\');
        resultArea.innerHTML = `<div class="flex align-center justify-between w-full flex-wrap gap-2"><span>Success! Masters: ${data.masters}, Leaves: ${data.leaves}, Subs: ${data.subs}. Document folder updated!</span><div class="flex gap-2"><button class="btn btn-select btn-sm" style="padding:0.4rem 0.85rem; font-size:0.88rem;" onclick="window.pywebview.api.open_in_explorer('${escPath}')">📁 Open Output Folder</button><button class="btn btn-primary btn-sm" style="padding:0.4rem 0.85rem; font-size:0.88rem;" onclick="if(window.switchNavToView) window.switchNavToView('view-sorting');">⚡ Proceed to Media Sorting</button></div></div>`;
        resultArea.classList.remove('hidden');
        window.showToast("Successfully generated event folder structures & Document archive!", 'success');
      }
    } catch (e) {
      window.showToast("An error occurred during processing", true);
    } finally {
      btnProcess.disabled = false;
      btnProcess.textContent = 'Generate Folders';
    }
  });
});
