// ── Drive Inventory Logic ──

document.addEventListener('DOMContentLoaded', () => {
  const btnDrive = document.getElementById('btn-inv-drive');
  const btnSave = document.getElementById('btn-inv-save');
  const btnGenerate = document.getElementById('btn-inv-generate');
  
  const pathDrive = document.getElementById('inv-drive-path');
  const pathSave = document.getElementById('inv-save-path');
  const resultArea = document.getElementById('inv-result');
  
  let currentDrive = null;
  let currentSave = null;
  
  function checkReady() {
    if (currentDrive) {
      btnSave.disabled = false;
    }
    btnGenerate.disabled = !(currentDrive && currentSave);
  }
  
  async function loadDrive(path = null) {
    try {
      const resp = await window.pywebview.api.inventory_select_drive(path);
      const data = JSON.parse(resp);
      if (data.error) {
        if (data.error !== "Cancelled") {
          window.showToast(data.error, true);
        }
        return;
      }
      if (data.path) {
        currentDrive = data.path;
        pathDrive.value = currentDrive;
        checkReady();
      }
    } catch (e) { console.error(e); }
  }

  btnDrive.addEventListener('click', () => loadDrive(null));

  window.makeDropZone('inv-drive-container', paths => {
    if (paths && paths.length > 0) loadDrive(paths[0]);
  });
  
  btnSave.addEventListener('click', async () => {
    try {
      // Extract a default name from the drive path
      let defaultName = currentDrive.split(/[\\/]/).pop();
      if (!defaultName) defaultName = "Drive_Inventory_Report";
      
      const resp = await window.pywebview.api.inventory_select_save_file(defaultName);
      const data = JSON.parse(resp);
      if (data.path) {
        currentSave = data.path;
        pathSave.value = currentSave;
        checkReady();
      }
    } catch (e) { console.error(e); }
  });
  
  btnGenerate.addEventListener('click', async () => {
    btnGenerate.disabled = true;
    btnGenerate.textContent = 'Scanning Drive...';
    resultArea.classList.add('hidden');
    
    try {
      const resp = await window.pywebview.api.inventory_generate_report(currentDrive, currentSave);
      const data = JSON.parse(resp);
      
      if (data.error) {
        window.showToast(data.error, true);
      } else {
        const escPath = (data.path || currentSave || '').replace(/\\/g, '\\\\');
        resultArea.innerHTML = `<div class="flex align-center justify-between w-full"><span>Report generated successfully at: ${data.path}</span><button class="btn btn-select btn-sm" style="padding:0.4rem 0.85rem; font-size:0.88rem;" onclick="window.pywebview.api.open_in_explorer('${escPath}')">📁 Open Output Folder</button></div>`;
        resultArea.classList.remove('hidden');
        window.showToast("Drive inventory Excel report generated successfully!", 'success');
      }
    } catch (e) {
      window.showToast("An error occurred generating the report", true);
    } finally {
      btnGenerate.disabled = false;
      btnGenerate.textContent = 'Generate Excel Report';
    }
  });
});
