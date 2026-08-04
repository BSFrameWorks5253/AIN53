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
        currentInput = data.path;
        inputPath.value = currentInput;
        checkReady();
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
        currentDest = data.path;
        destPath.value = currentDest;
        checkReady();
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
        const escPath = (currentDest || '').replace(/\\/g, '\\\\');
        resultArea.innerHTML = `<div class="flex align-center justify-between w-full"><span>Success! Masters: ${data.masters}, Leaves: ${data.leaves}, Subs: ${data.subs}</span><button class="btn btn-select btn-sm" style="padding:0.4rem 0.85rem; font-size:0.82rem;" onclick="window.pywebview.api.open_in_explorer('${escPath}')">📁 Open Output Folder</button></div>`;
        resultArea.classList.remove('hidden');
        window.showToast("Successfully generated event folder structures!", 'success');
      }
    } catch (e) {
      window.showToast("An error occurred during processing", true);
    } finally {
      btnProcess.disabled = false;
      btnProcess.textContent = 'Generate Folders';
    }
  });
});
