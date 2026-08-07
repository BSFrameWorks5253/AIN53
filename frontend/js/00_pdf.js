// ── PDF to CSV Logic ──

const pdfCsvColumns = ["Seq", "Event", "Sticker", "Name", "ITS", "Location", "Mobile", "Mauze", "Sub Event"];

document.addEventListener('DOMContentLoaded', () => {
  const btnPick = document.getElementById('btn-pick-pdf');
  const btnPreview = document.getElementById('btn-pdf-preview');
  const btnDownload = document.getElementById('btn-pdf-download');
  
  let currentPdfHeaders = [];
  
  async function loadPdf(path = null) {
    btnPick.disabled = true;
    btnPick.textContent = 'Loading...';
    try {
      const resp = await window.pywebview.api.pdf_pick_pdf(path);
      const data = JSON.parse(resp);
      if (data.error) {
        window.showToast(data.error, true);
        return;
      }
      
      document.getElementById('pdf-file-info').innerHTML = `<div class="dot"></div> Selected: <strong>${data.filename}</strong> (${data.row_count} rows detected)`;
      document.getElementById('pdf-settings').classList.remove('hidden');
      
      currentPdfHeaders = data.pdf_headers;
      buildMappingGrid(currentPdfHeaders, data.auto_mapping);
      
      if (data.sr_min !== null) document.getElementById('pdf-sr-start').value = data.sr_min;
      if (data.sr_max !== null) document.getElementById('pdf-sr-end').value = data.sr_max;
      
    } catch (e) {
      window.showToast("Error loading PDF", true);
    } finally {
      btnPick.disabled = false;
      btnPick.textContent = 'Browse PDF';
    }
  }

  btnPick.addEventListener('click', () => loadPdf(null));
  
  // Register Drag & Drop
  window.makeDropZone('pdf-dropzone', paths => {
    if (paths && paths.length > 0) {
      const file = paths[0];
      if (file.toLowerCase().endsWith('.pdf')) {
        loadPdf(file);
      } else {
        window.showToast("Please drop a valid PDF file (.pdf)", true);
      }
    }
  });
  
  btnPreview.addEventListener('click', async () => {
    const mapping = getMapping();
    const mauze = document.getElementById('pdf-mauze').value;
    const srStart = document.getElementById('pdf-sr-start').value;
    const srEnd = document.getElementById('pdf-sr-end').value;
    
    btnPreview.disabled = true;
    try {
      const resp = await window.pywebview.api.pdf_process(JSON.stringify(mapping), mauze, srStart, srEnd);
      const data = JSON.parse(resp);
      
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
    const srStart = document.getElementById('pdf-sr-start').value;
    const srEnd = document.getElementById('pdf-sr-end').value;
    
    btnDownload.disabled = true;
    try {
      const resp = await window.pywebview.api.pdf_download(JSON.stringify(mapping), mauze, srStart, srEnd);
      const data = JSON.parse(resp);
      if (data.error) {
        window.showToast(data.error, true);
      } else {
        window.showToast(`Saved ${data.total_rows} rows to ${data.saved}`);
        const statusEl = document.getElementById('pdf-status');
        const escPath = (data.saved || '').replace(/\\/g, '\\\\');
        if (statusEl) {
          statusEl.innerHTML = `<div class="flex align-center justify-between w-full"><span>Saved ${data.total_rows} rows to CSV</span><button class="btn btn-select btn-sm" style="padding:0.4rem 0.85rem; font-size:0.88rem;" onclick="window.pywebview.api.open_in_explorer('${escPath}')">📁 Open Output Folder</button></div>`;
        }
      }
    } finally {
      btnDownload.disabled = false;
    }
  });
  
  function buildMappingGrid(pdfHeaders, autoMapping) {
    const grid = document.getElementById('pdf-mapping-grid');
    grid.innerHTML = '';
    
    pdfCsvColumns.forEach(csvCol => {
      if (['Seq', 'Mauze', 'Sub Event'].includes(csvCol)) return;
      
      const row = document.createElement('div');
      row.className = 'mapping-row';
      
      const lbl = document.createElement('span');
      lbl.textContent = csvCol;
      row.appendChild(lbl);
      
      const sel = document.createElement('select');
      sel.setAttribute('data-csv', csvCol);
      
      const optNone = document.createElement('option');
      optNone.value = '';
      optNone.textContent = '-- Ignore --';
      sel.appendChild(optNone);
      
      pdfHeaders.forEach(h => {
        const opt = document.createElement('option');
        opt.value = h;
        opt.textContent = h;
        if (autoMapping[csvCol] === h) opt.selected = true;
        sel.appendChild(opt);
      });
      row.appendChild(sel);
      grid.appendChild(row);
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
    rows.slice(0, 100).forEach(r => {
      const tr = document.createElement('tr');
      pdfCsvColumns.forEach(c => {
        const td = document.createElement('td');
        td.textContent = r[c] || '';
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
  }
});
