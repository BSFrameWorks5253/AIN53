/**
 * AIN53 Standalone Viewer Script
 * Zero-dependency client-side engine to parse, validate, and display .AIN53 Safar sync files.
 */

(function () {
  'use strict';

  // Global Viewer State
  const state = {
    pkg: null,
    filename: '',
    filesize: 0,
    activeDate: 'ALL',
    activeSlot: 'ALL',
    activeType: 'ALL',
    activeCoverage: 'ALL',
    searchQuery: '',
    activeTab: 'tab-schedule'
  };

  // Sample Safar Package for Demo Mode
  const SAMPLE_PACKAGE = {
    "$schema": "https://ain53.org/schemas/safar-sync-v1.json",
    "format": "AIN53_SAFAR_SYNC_PACKAGE",
    "version": "1.0.0",
    "generator": {
      "app": "AIN53 Data Management Desktop",
      "version": "1.5.0",
      "platform": "win32",
      "exported_at": "2026-09-27T16:45:00.000Z"
    },
    "safar": {
      "name": "Khandala Safar 1448",
      "scope": "FULL_SAFAR"
    },
    "cities": [
      { "id": 1, "name": "Khandala", "teams_required": 2 }
    ],
    "crew": [
      { "id": 101, "name": "Murtaza Bhai", "role": "photographer", "series": "A", "active": true, "phone": "+91 98200 11111" },
      { "id": 102, "name": "Hussain Bhai", "role": "videographer", "series": "B", "active": true, "phone": "+91 98200 22222" },
      { "id": 103, "name": "Ali Asghar Bhai", "role": "photographer", "series": "C", "active": true, "phone": "+91 98200 33333" },
      { "id": 104, "name": "Taher Bhai", "role": "videographer", "series": "D", "active": true, "phone": "+91 98200 44444" }
    ],
    "schedule": [
      {
        "date": "1448-04-06",
        "slots": [
          {
            "slot_code": "01M",
            "slot_name": "Morning",
            "start_time": "09:30 AM",
            "end_time": "01:30 PM",
            "status": "COMPLETED",
            "events_count": 2,
            "sequences_count": 4,
            "events": [
              {
                "id": "evt-001",
                "sequence_number": 1,
                "event_code": "1448-04-06 _ 01M-01-Waaz-Khandala",
                "name": "Subah Waaz Mubarak",
                "type": "Waaz",
                "engine": "Standard",
                "city_id": 1,
                "city_name": "Khandala",
                "status": "COMPLETED",
                "start_time": "09:30 AM",
                "report_time": "08:45 AM",
                "assignment_mode": "individual",
                "assignments": [
                  {
                    "sequence": "1",
                    "event_abr": "Waaz",
                    "sticker_name": "WZ-01",
                    "name": "Waaz Mubarak Stage & Setup",
                    "its": "50392817",
                    "location": "Main Masjid Hall",
                    "mobile": "+91 98200 99887",
                    "photographer_id": 101,
                    "photographer_name": "Murtaza Bhai",
                    "photographer_series": "A",
                    "videographer_id": 102,
                    "videographer_name": "Hussain Bhai",
                    "videographer_series": "B",
                    "photo_not_covered": false,
                    "video_not_covered": false
                  }
                ]
              },
              {
                "id": "evt-002",
                "sequence_number": 2,
                "event_code": "1448-04-06 _ 01M-02-QMZ-Khandala",
                "name": "Zohor Majlis & QMZ Visits",
                "type": "QMZ",
                "engine": "QMZ",
                "city_id": 1,
                "city_name": "Khandala",
                "status": "COMPLETED",
                "start_time": "11:30 AM",
                "report_time": "11:00 AM",
                "assignment_mode": "team",
                "qmz_count": 3,
                "assignments": [
                  {
                    "sequence": "1",
                    "event_abr": "Q",
                    "sticker_name": "Q-01",
                    "name": "Shk Shabbir Bhai Lightwala",
                    "its": "30485921",
                    "location": "Bunglow No 7, Hill Road",
                    "mobile": "+91 98210 12345",
                    "team_name": "Team 1",
                    "photographer_id": 101,
                    "photographer_name": "Murtaza Bhai",
                    "photographer_series": "A",
                    "videographer_id": 102,
                    "videographer_name": "Hussain Bhai",
                    "videographer_series": "B",
                    "photo_not_covered": false,
                    "video_not_covered": false
                  },
                  {
                    "sequence": "2",
                    "event_abr": "MZ",
                    "sticker_name": "MZ-01",
                    "name": "Mulla Hatim Bhai Godhrawala",
                    "its": "20394812",
                    "location": "Plot 14, Khandala Heights",
                    "mobile": "+91 98204 55443",
                    "team_name": "Team 1",
                    "photographer_id": 101,
                    "photographer_name": "Murtaza Bhai",
                    "photographer_series": "A",
                    "videographer_id": 102,
                    "videographer_name": "Hussain Bhai",
                    "videographer_series": "B",
                    "photo_not_covered": false,
                    "video_not_covered": false
                  },
                  {
                    "sequence": "3",
                    "event_abr": "Q",
                    "sticker_name": "Q-02",
                    "name": "Ibrahim Bhai Poonawala",
                    "its": "40928172",
                    "location": "Valley View Villa 3",
                    "mobile": "+91 98209 87654",
                    "team_name": "Team 2",
                    "photographer_id": 103,
                    "photographer_name": "Ali Asghar Bhai",
                    "photographer_series": "C",
                    "videographer_id": 104,
                    "videographer_name": "Taher Bhai",
                    "videographer_series": "D",
                    "photo_not_covered": false,
                    "video_not_covered": false
                  }
                ]
              }
            ]
          },
          {
            "slot_code": "02E",
            "slot_name": "Evening",
            "start_time": "05:30 PM",
            "end_time": "10:00 PM",
            "status": "CREATED",
            "events_count": 1,
            "sequences_count": 3,
            "events": [
              {
                "id": "evt-003",
                "sequence_number": 1,
                "event_code": "1448-04-06 _ 02E-01-Bethak-Khandala",
                "name": "Evening Bethak Ceremonies",
                "type": "Bethak",
                "engine": "Bethak",
                "city_id": 1,
                "city_name": "Khandala",
                "status": "CREATED",
                "start_time": "05:30 PM",
                "report_time": "05:00 PM",
                "assignment_mode": "individual",
                "bethak_counts": [
                  { "type": "Nikah", "count": 2 },
                  { "type": "Bethak QMZ", "count": 1, "subTypes": ["BQ"] }
                ],
                "assignments": [
                  {
                    "sequence": "1",
                    "event_abr": "N",
                    "sticker_name": "N-01",
                    "name": "Aliasgar Bhai & Amatullah Ben",
                    "its": "30458921",
                    "location": "Mawaid Hall 1",
                    "mobile": "+91 98200 12345",
                    "photographer_id": 101,
                    "photographer_name": "Murtaza Bhai",
                    "photographer_series": "A",
                    "videographer_id": 102,
                    "videographer_name": "Hussain Bhai",
                    "videographer_series": "B",
                    "photo_not_covered": false,
                    "video_not_covered": false
                  },
                  {
                    "sequence": "2",
                    "event_abr": "N",
                    "sticker_name": "N-02",
                    "name": "Mustafa Bhai & Fatema Ben",
                    "its": "20391482",
                    "location": "Mawaid Hall 2",
                    "mobile": "+91 98211 54321",
                    "photographer_id": 103,
                    "photographer_name": "Ali Asghar Bhai",
                    "photographer_series": "C",
                    "videographer_id": 104,
                    "videographer_name": "Taher Bhai",
                    "videographer_series": "D",
                    "photo_not_covered": false,
                    "video_not_covered": false
                  },
                  {
                    "sequence": "3",
                    "event_abr": "BQ",
                    "sticker_name": "BQ-01",
                    "name": "Shk Saifuddin Bhai Kapasi",
                    "its": "10492817",
                    "location": "Bunglow No 4",
                    "mobile": "+91 98202 99887",
                    "photographer_id": 101,
                    "photographer_name": "Murtaza Bhai",
                    "photographer_series": "A",
                    "videographer_id": 102,
                    "videographer_name": "Hussain Bhai",
                    "videographer_series": "B",
                    "photo_not_covered": false,
                    "video_not_covered": false
                  }
                ]
              }
            ]
          }
        ]
      }
    ],
    "metrics": {
      "total_days": 1,
      "total_events": 3,
      "total_sequences": 7,
      "total_crew": 4,
      "covered_sequences": 7,
      "uncovered_sequences": 0
    }
  };

  // DOM Elements
  const heroDropzone = document.getElementById('hero-dropzone');
  const dropTarget = document.getElementById('drop-target');
  const dashboardView = document.getElementById('dashboard-view');
  const fileInput = document.getElementById('file-input');
  const activeSafarBadge = document.getElementById('active-safar-badge');

  // Initialization
  function init() {
    setupDragAndDrop();
    setupFileInput();
    setupFilters();
    setupTabs();
    setupThemeToggle();
    setupRawModal();

    setupKeyboardShortcuts();

    document.getElementById('btn-open-file').addEventListener('click', () => fileInput.click());
    document.getElementById('btn-load-sample').addEventListener('click', loadSampleData);
    document.getElementById('btn-export-csv').addEventListener('click', exportFilteredToCsv);

    window.viewerLoadSample = loadSampleData;
    window.closeRawModal = closeRawModal;

    // Auto-check for preloaded Safar package
    checkPreloadedPackage();
  }

  // Preload Safar Package on Startup
  function checkPreloadedPackage() {
    const params = new URLSearchParams(window.location.search);
    const isAutoloadRequested = params.get('autoload') === '1' || params.has('autoload');

    // 0. Direct file launch from Windows launcher (written to current_safar_data.js)
    if (window.AIN53_AUTOLOAD_PACKAGE && window.AIN53_AUTOLOAD_PACKAGE.data) {
      const pkg = window.AIN53_AUTOLOAD_PACKAGE.data;
      const fname = window.AIN53_AUTOLOAD_PACKAGE.filename || `${pkg.safar?.name || 'Safar'}.AIN53`;
      const fsize = window.AIN53_AUTOLOAD_PACKAGE.filesize || 0;
      if (pkg && pkg.format === 'AIN53_SAFAR_SYNC_PACKAGE') {
        console.log('[AIN53 Viewer] Preloaded direct file package:', fname);
        loadPackage(pkg, fname, fsize);
        return;
      }
    }

    // If opened cleanly without autoload or sample param, show hero dropzone
    if (!isAutoloadRequested && params.get('sample') !== '1') {
      return;
    }

    // 1. Try localStorage preloaded package (passed directly from AIN53 app)
    try {
      const stored = localStorage.getItem('ain53_preload_package');
      if (stored) {
        const pkg = JSON.parse(stored);
        const filename = localStorage.getItem('ain53_preload_filename') || `${pkg.safar?.name || 'Safar'}.AIN53`;
        if (pkg && pkg.format === 'AIN53_SAFAR_SYNC_PACKAGE') {
          console.log('[AIN53 Viewer] Preloaded active package from localStorage:', filename);
          loadPackage(pkg, filename, 0);
          return;
        }
      }
    } catch (e) {
      console.warn('[AIN53 Viewer] localStorage preload note:', e);
    }

    // 2. Try fetching current_safar.AIN53 written by main app
    fetch('current_safar.AIN53?t=' + Date.now())
      .then(res => {
        if (!res.ok) throw new Error('No current_safar.AIN53');
        return res.json();
      })
      .then(data => {
        if (data && data.format === 'AIN53_SAFAR_SYNC_PACKAGE') {
          const fname = `${data.safar?.name || 'Safar'}.AIN53`;
          console.log('[AIN53 Viewer] Preloaded current_safar.AIN53:', fname);
          loadPackage(data, fname, 0);
        }
      })
      .catch(() => {
        if (params.get('sample') === '1') {
          loadSampleData();
        }
      });
  }

  // Cross-Platform Keyboard Shortcuts (macOS Command key and Windows Ctrl key)
  function setupKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
      const modifier = e.metaKey || e.ctrlKey;
      if (modifier && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        fileInput.click();
      } else if (modifier && e.key.toLowerCase() === 'f') {
        const searchInput = document.getElementById('seq-search-input');
        if (searchInput) {
          e.preventDefault();
          searchInput.focus();
          searchInput.select();
        }
      } else if (e.key === 'Escape') {
        closeRawModal();
      }
    });
  }

  // Setup Drag & Drop
  function setupDragAndDrop() {
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
      document.body.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
    });

    ['dragenter', 'dragover'].forEach(eventName => {
      dropTarget.addEventListener(eventName, () => dropTarget.classList.add('drag-over'));
    });

    ['dragleave', 'drop'].forEach(eventName => {
      dropTarget.addEventListener(eventName, () => dropTarget.classList.remove('drag-over'));
    });

    dropTarget.addEventListener('drop', (e) => {
      const dt = e.dataTransfer;
      const files = dt.files;
      if (files && files.length > 0) {
        handleFile(files[0]);
      }
    });
  }

  // Setup File Input
  function setupFileInput() {
    fileInput.addEventListener('change', (e) => {
      if (fileInput.files && fileInput.files.length > 0) {
        handleFile(fileInput.files[0]);
      }
    });
  }

  // File Handler & Parser
  function handleFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target.result;
        const parsed = JSON.parse(text);
        if (parsed.format !== 'AIN53_SAFAR_SYNC_PACKAGE') {
          alert("Error: Invalid format signature. File is missing 'format: AIN53_SAFAR_SYNC_PACKAGE'");
          return;
        }
        loadPackage(parsed, file.name, file.size);
      } catch (err) {
        alert("Failed to parse file: " + err.message);
      }
    };
    reader.readAsText(file);
  }

  // Load Demo Data
  function loadSampleData() {
    loadPackage(SAMPLE_PACKAGE, 'sample_khandala_safar.AIN53', 4820);
  }

  // Core Package Loader
  function loadPackage(pkg, filename, filesize) {
    state.pkg = pkg;
    state.filename = filename || 'unnamed.AIN53';
    state.filesize = filesize || 0;
    state.activeDate = 'ALL';
    state.activeSlot = 'ALL';
    state.activeType = 'ALL';
    state.activeCoverage = 'ALL';
    state.searchQuery = '';

    // Switch screens
    heroDropzone.classList.add('hidden');
    dashboardView.classList.remove('hidden');

    // Update Header Pill
    activeSafarBadge.classList.remove('hidden');
    activeSafarBadge.textContent = pkg.safar?.name || 'Safar Package';

    // Populate Metadata Strip
    document.getElementById('meta-filename').textContent = state.filename;
    document.getElementById('meta-scope').textContent = pkg.safar?.scope || 'FULL SAFAR';
    document.getElementById('meta-export-time').textContent = `Exported: ${pkg.generator?.exported_at || 'N/A'}`;
    document.getElementById('meta-generator').textContent = `Generated by: ${pkg.generator?.app || 'AIN53 Desktop'}`;

    // Populate Dates & Type Filters
    buildDatePills();
    populateTypeFilter();

    // Compute Metrics & Render All Views
    updateKpis();
    renderSequencesTable();
    renderCrewView();
    renderEventsBreakdown();
    renderInventoryReports();
  }

  // Build Date Selector Pills
  function buildDatePills() {
    const container = document.getElementById('date-pills-container');
    container.innerHTML = '';

    const dates = (state.pkg.schedule || []).map(d => d.date);

    // "All Dates" pill
    const allPill = document.createElement('button');
    allPill.type = 'button';
    allPill.className = `date-pill ${state.activeDate === 'ALL' ? 'active' : ''}`;
    allPill.textContent = `All Dates (${dates.length})`;
    allPill.addEventListener('click', () => {
      state.activeDate = 'ALL';
      updateActiveDatePills();
      renderSequencesTable();
      renderEventsBreakdown();
      renderInventoryReports();
    });
    container.appendChild(allPill);

    dates.forEach(d => {
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = `date-pill ${state.activeDate === d ? 'active' : ''}`;
      pill.dataset.date = d;
      pill.textContent = d;
      pill.addEventListener('click', () => {
        state.activeDate = d;
        updateActiveDatePills();
        renderSequencesTable();
        renderEventsBreakdown();
        renderInventoryReports();
      });
      container.appendChild(pill);
    });
  }

  function updateActiveDatePills() {
    document.querySelectorAll('.date-pill').forEach(pill => {
      if (state.activeDate === 'ALL' && !pill.dataset.date) {
        pill.classList.add('active');
      } else if (pill.dataset.date === state.activeDate) {
        pill.classList.add('active');
      } else {
        pill.classList.remove('active');
      }
    });
  }

  // Populate Event Type Filter Dropdown
  function populateTypeFilter() {
    const select = document.getElementById('filter-type');
    select.innerHTML = '<option value="ALL">All Event Types</option>';

    const typesSet = new Set();
    (state.pkg.schedule || []).forEach(day => {
      (day.slots || []).forEach(slot => {
        (slot.events || []).forEach(evt => {
          if (evt.type) typesSet.add(evt.type);
        });
      });
    });

    typesSet.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t;
      opt.textContent = t;
      select.appendChild(opt);
    });
  }

  // Extract Flat List of Sequences matching Active Filters
  function getFilteredSequences() {
    if (!state.pkg || !state.pkg.schedule) return [];

    const list = [];
    const q = state.searchQuery.toLowerCase().trim();

    state.pkg.schedule.forEach(day => {
      if (state.activeDate !== 'ALL' && day.date !== state.activeDate) return;

      (day.slots || []).forEach(slot => {
        if (state.activeSlot !== 'ALL' && slot.slot_code !== state.activeSlot) return;

        (slot.events || []).forEach(evt => {
          if (state.activeType !== 'ALL' && evt.type !== state.activeType) return;

          (evt.assignments || []).forEach(asgn => {
            const isUncovered = asgn.photo_not_covered || asgn.video_not_covered ||
              (!asgn.photographer_name && !asgn.videographer_name && !asgn.photographer_id && !asgn.videographer_id);

            if (state.activeCoverage === 'COVERED' && isUncovered) return;
            if (state.activeCoverage === 'UNCOVERED' && !isUncovered) return;

            // Search Keyword Filter
            if (q) {
              const searchable = [
                asgn.sequence, asgn.event_abr, asgn.sticker_name, asgn.name,
                asgn.its, asgn.location, asgn.mobile,
                asgn.photographer_name, asgn.photographer_series,
                asgn.videographer_name, asgn.videographer_series,
                evt.name, evt.event_code, day.date
              ].filter(Boolean).join(' ').toLowerCase();

              if (!searchable.includes(q)) return;
            }

            list.push({
              date: day.date,
              slot_code: slot.slot_code,
              slot_name: slot.slot_name,
              event_name: evt.name,
              event_type: evt.type,
              event_code: evt.event_code,
              ...asgn
            });
          });
        });
      });
    });

    return list;
  }

  // Render Table
  function renderSequencesTable() {
    const tbody = document.getElementById('sequences-tbody');
    tbody.innerHTML = '';

    const sequences = getFilteredSequences();
    document.getElementById('filtered-count-label').textContent = `Showing ${sequences.length} sequence${sequences.length === 1 ? '' : 's'}`;

    if (sequences.length === 0) {
      tbody.innerHTML = `<tr><td colspan="10" style="text-align: center; padding: 3rem; color: var(--text-dim);">No sequences match current filters.</td></tr>`;
      return;
    }

    sequences.forEach(item => {
      const tr = document.createElement('tr');

      const isUncovered = item.photo_not_covered || item.video_not_covered ||
        (!item.photographer_name && !item.videographer_name && !item.photographer_id && !item.videographer_id);

      const typeClass = (item.event_type || '').toLowerCase();
      let badgeClass = 'type-default';
      if (typeClass.includes('waaz')) badgeClass = 'type-waaz';
      else if (typeClass.includes('bethak')) badgeClass = 'type-bethak';
      else if (typeClass.includes('qmz')) badgeClass = 'type-qmz';
      else if (typeClass.includes('majlis')) badgeClass = 'type-majlis';

      tr.innerHTML = `
        <td><span class="seq-badge">${escapeHtml(item.sequence || '')}</span></td>
        <td><span style="font-size: 0.78rem; font-weight: 600; color: var(--text-dim);">${escapeHtml(item.date)} [${item.slot_code}]</span></td>
        <td><span class="type-pill ${badgeClass}">${escapeHtml(item.event_abr || item.event_type || '')}</span></td>
        <td><strong>${escapeHtml(item.sticker_name || '-')}</strong></td>
        <td>
          <div style="font-weight: 600;">${escapeHtml(item.name || '-')}</div>
          ${item.mobile ? `<div style="font-size: 0.75rem; color: var(--text-dim);">${escapeHtml(item.mobile)}</div>` : ''}
        </td>
        <td><code style="font-family: var(--font-mono); font-size: 0.8rem;">${escapeHtml(item.its || '-')}</code></td>
        <td style="font-size: 0.82rem; color: var(--text-muted);">${escapeHtml(item.location || '-')}</td>
        <td>
          ${item.photographer_name ? `<span>${escapeHtml(item.photographer_name)}</span>` : '<span style="color: var(--color-red);">Unassigned</span>'}
          ${item.photographer_series ? `<span class="series-badge">${escapeHtml(item.photographer_series)}</span>` : ''}
        </td>
        <td>
          ${item.videographer_name ? `<span>${escapeHtml(item.videographer_name)}</span>` : '<span style="color: var(--color-red);">Unassigned</span>'}
          ${item.videographer_series ? `<span class="series-badge">${escapeHtml(item.videographer_series)}</span>` : ''}
        </td>
        <td class="status-dot-cell">
          ${isUncovered ? '<span class="badge-uncovered">Uncovered</span>' : '<span class="badge-covered">Covered</span>'}
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  // Update KPIs
  function updateKpis() {
    let totalDays = (state.pkg.schedule || []).length;
    let totalEvents = 0;
    let totalSequences = 0;
    let coveredSequences = 0;

    (state.pkg.schedule || []).forEach(day => {
      (day.slots || []).forEach(slot => {
        totalEvents += (slot.events || []).length;
        (slot.events || []).forEach(evt => {
          (evt.assignments || []).forEach(asgn => {
            totalSequences++;
            const isUncovered = asgn.photo_not_covered || asgn.video_not_covered ||
              (!asgn.photographer_name && !asgn.videographer_name && !asgn.photographer_id && !asgn.videographer_id);
            if (!isUncovered) coveredSequences++;
          });
        });
      });
    });

    const crewCount = (state.pkg.crew || []).length;
    const rate = totalSequences > 0 ? Math.round((coveredSequences / totalSequences) * 100) : 100;
    const uncoveredCount = totalSequences - coveredSequences;

    document.getElementById('kpi-days').textContent = totalDays;
    document.getElementById('kpi-events').textContent = totalEvents;
    document.getElementById('kpi-sequences').textContent = totalSequences;
    document.getElementById('kpi-crew').textContent = crewCount;
    document.getElementById('kpi-coverage').textContent = `${rate}%`;
    document.getElementById('kpi-cov-sub').textContent = `${uncoveredCount} uncovered`;
  }

  // Render Crew Roster
  function renderCrewView() {
    const grid = document.getElementById('crew-grid');
    grid.innerHTML = '';

    const crewList = state.pkg.crew || [];
    if (crewList.length === 0) {
      grid.innerHTML = '<div style="color: var(--text-dim); padding: 2rem;">No crew records found in this package.</div>';
      return;
    }

    // Count sequence assignments per crew member
    const counts = {};
    (state.pkg.schedule || []).forEach(d => {
      (d.slots || []).forEach(s => {
        (s.events || []).forEach(e => {
          (e.assignments || []).forEach(a => {
            if (a.photographer_name) counts[a.photographer_name] = (counts[a.photographer_name] || 0) + 1;
            if (a.videographer_name) counts[a.videographer_name] = (counts[a.videographer_name] || 0) + 1;
          });
        });
      });
    });

    crewList.forEach(c => {
      const card = document.createElement('div');
      card.className = 'crew-card';
      const seqAssigned = counts[c.name] || 0;

      card.innerHTML = `
        <div class="crew-card-hdr">
          <div class="crew-card-name">${escapeHtml(c.name)}</div>
          ${c.series ? `<span class="series-badge" style="font-size: 0.85rem;">Series ${escapeHtml(c.series)}</span>` : ''}
        </div>
        <div class="crew-card-role">${escapeHtml(c.role || 'Crew Member')}</div>
        <div class="crew-card-stats">
          <span>🎯 Assigned: <strong>${seqAssigned}</strong> sequences</span>
          ${c.phone ? `<span>📞 ${escapeHtml(c.phone)}</span>` : ''}
        </div>
      `;
      grid.appendChild(card);
    });
  }

  // Render Events Breakdown Tab
  function renderEventsBreakdown() {
    const list = document.getElementById('events-breakdown-list');
    list.innerHTML = '';

    (state.pkg.schedule || []).forEach(day => {
      if (state.activeDate !== 'ALL' && day.date !== state.activeDate) return;

      (day.slots || []).forEach(slot => {
        (slot.events || []).forEach(evt => {
          const card = document.createElement('div');
          card.className = 'event-summary-card';

          const seqCount = (evt.assignments || []).length;

          card.innerHTML = `
            <div class="event-card-header-line">
              <span class="event-card-title">${escapeHtml(evt.name || evt.type)}</span>
              <span class="type-pill type-default">${escapeHtml(evt.type)}</span>
            </div>
            <div class="event-card-details">
              <span>📅 Date: <strong>${escapeHtml(day.date)}</strong> (${slot.slot_name})</span>
              <span>🏷️ Code: <code>${escapeHtml(evt.event_code || '-')}</code></span>
              <span>📍 City: <strong>${escapeHtml(evt.city_name || '-')}</strong></span>
              <span>🕒 Timing: <strong>${escapeHtml(evt.start_time || '--:--')}</strong></span>
              <span>🔢 Sequences: <strong>${seqCount}</strong></span>
              <span>⚙️ Engine: <strong>${escapeHtml(evt.engine || 'Standard')}</strong></span>
            </div>
          `;
          list.appendChild(card);
        });
      });
    });
  }

  // Render Inventory Reports Tab
  function renderInventoryReports() {
    const list = document.getElementById('inventory-breakdown-list');
    if (!list) return;
    list.innerHTML = '';

    let totalSlots = 0;

    (state.pkg.schedule || []).forEach(day => {
      // Filter by activeDate if a specific date pill is selected
      if (state.activeDate !== 'ALL' && day.date !== state.activeDate) return;

      (day.slots || []).forEach(slot => {
        totalSlots++;
        let inv = slot.inventory_report;
        if (!inv && Array.isArray(state.pkg.inventory_reports) && state.pkg.inventory_reports.length > 0) {
          inv = state.pkg.inventory_reports.find(r => {
            const matchDate = !r.date || r.date === day.date;
            const matchSlot = !r.slot || r.slot === slot.slot_code || r.slot === slot.slot_name || (r.filename && r.filename.includes(slot.slot_code));
            return matchDate && matchSlot;
          }) || null;
        }
        const isEnded = Boolean(slot.event_ended || slot.status === 'ENDED' || slot.status === 'COMPLETED');

        const card = document.createElement('div');
        card.className = 'event-summary-card';
        card.style.borderLeft = inv ? '4px solid #10b981' : '4px solid #f59e0b';

        let invHtml = '';
        if (inv) {
          const missingCount = (inv.missing_files || []).length || inv.total_missing || 0;
          const issuesCount = (inv.issues || []).length || 0;
          const foldersCount = (inv.folder_structure || []).length || 0;
          const camerasCount = (inv.cameras || []).length || 0;
          const contribCount = (inv.contributors || []).length || 0;

          invHtml = `
            <div style="margin-top: 10px; padding: 14px 16px; background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.25); border-radius: 10px;">
              <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px;">
                <span style="font-weight: 700; color: #059669; font-size: 0.92rem;">
                  ✓ Verified Inventory Report: <code>${escapeHtml(inv.filename || 'Verified')}</code>
                </span>
                <div style="display: flex; align-items: center; gap: 8px;">
                  <span style="font-size: 0.78rem; color: #64748b;">Uploaded: ${escapeHtml(inv.uploaded_at || '')}</span>
                  ${inv.file_base64 ? `
                    <button type="button" class="feat-pill" style="background: #10b981; color: white; border: none; cursor: pointer; font-weight: 700; padding: 4px 10px;" onclick="window.downloadInventoryReportFile('${escapeHtml(inv.filename || 'Inventory_Report.xlsx')}', '${inv.file_base64}')">
                      📥 Download Excel (.xlsx)
                    </button>
                  ` : ''}
                </div>
              </div>

              <!-- High-level Metric Pills -->
              <div style="display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap;">
                <span class="feat-pill" style="background:#ecfdf5; color:#047857; font-weight:700;">Found: ${inv.total_found ?? 0}</span>
                <span class="feat-pill" style="background:${missingCount > 0 ? '#fef2f2; color:#b91c1c;' : '#ecfdf5; color:#047857;'} font-weight:700;">Missing: ${inv.total_missing ?? missingCount}</span>
                <span class="feat-pill" style="background:#eff6ff; color:#1d4ed8; font-weight:700;">Cameras: ${camerasCount}</span>
                <span class="feat-pill" style="background:#f5f3ff; color:#6d28d9; font-weight:700;">Folders: ${foldersCount}</span>
                <span class="feat-pill" style="background:#f0fdfa; color:#0f766e; font-weight:700;">Contributors: ${contribCount}</span>
                ${issuesCount > 0 ? `<span class="feat-pill" style="background:#fffbeb; color:#b45309; font-weight:700;">Issues: ${issuesCount}</span>` : ''}
              </div>

              <!-- Detailed Sheet Tabs / Accordions (Exact Replica) -->
              <div style="margin-top: 12px; display: flex; flex-direction: column; gap: 6px;">
                ${foldersCount > 0 ? `
                  <details style="font-size: 0.82rem; background: rgba(255,255,255,0.7); border: 1px solid rgba(0,0,0,0.06); border-radius: 6px; padding: 6px 10px;">
                    <summary style="cursor: pointer; font-weight: 700; color: #1e293b;">📂 Sheet 2: Folder Structure (${foldersCount} Folders)</summary>
                    <div style="margin-top: 8px; display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 8px;">
                      ${(inv.folder_structure || []).map(f => `
                        <div style="padding: 8px; background: white; border: 1px solid #e2e8f0; border-radius: 6px;">
                          <div style="font-weight: 700; font-size: 0.78rem; color: #0f172a; word-break: break-all;">📁 ${escapeHtml(f.folder_path || '')}</div>
                          ${f.contributor ? `<div style="font-size: 0.74rem; color: #059669; margin-top: 2px;">👤 ${escapeHtml(f.contributor)}</div>` : ''}
                          <div style="font-size: 0.72rem; color: #64748b; margin-top: 4px;">Files: <strong>${f.total_files || (f.files || []).length}</strong></div>
                          ${f.extension_counts ? `<div style="font-size: 0.7rem; color: #94a3b8;">${Object.entries(f.extension_counts).map(([ext, cnt]) => `${ext}: ${cnt}`).join(', ')}</div>` : ''}
                        </div>
                      `).join('')}
                    </div>
                  </details>
                ` : ''}

                ${camerasCount > 0 ? `
                  <details style="font-size: 0.82rem; background: rgba(255,255,255,0.7); border: 1px solid rgba(0,0,0,0.06); border-radius: 6px; padding: 6px 10px;">
                    <summary style="cursor: pointer; font-weight: 700; color: #1e293b;">📷 Sheet 3: Camera Summary (${camerasCount} Cameras)</summary>
                    <div style="margin-top: 8px; display: flex; flex-direction: column; gap: 6px;">
                      ${(inv.cameras || []).map(c => `
                        <div style="padding: 8px 10px; background: white; border: 1px solid #e2e8f0; border-radius: 6px; display: flex; justify-content: space-between; align-items: center;">
                          <span style="font-weight: 700; color: #0f172a;">${escapeHtml(c.camera || '')}</span>
                          <span style="font-size: 0.76rem; color: #64748b;">
                            Found: <strong style="color: #059669;">${c.total_found ?? c.found ?? 0}</strong> | 
                            Missing: <strong style="color: ${(c.total_missing || c.missing) > 0 ? '#dc2626' : '#64748b'};">${c.total_missing ?? c.missing ?? 0}</strong>
                          </span>
                        </div>
                      `).join('')}
                    </div>
                  </details>
                ` : ''}

                ${contribCount > 0 ? `
                  <details style="font-size: 0.82rem; background: rgba(255,255,255,0.7); border: 1px solid rgba(0,0,0,0.06); border-radius: 6px; padding: 6px 10px;">
                    <summary style="cursor: pointer; font-weight: 700; color: #1e293b;">👥 Sheet 4: Contributor Submissions (${contribCount} Files)</summary>
                    <ul style="margin: 6px 0 0 16px; padding: 0; max-height: 140px; overflow-y: auto; font-family: monospace; font-size: 0.76rem;">
                      ${(inv.contributors || []).map(cb => `<li>${escapeHtml(cb.folder_path || '')} ➔ <strong>${escapeHtml(cb.file_name || '')}</strong></li>`).join('')}
                    </ul>
                  </details>
                ` : ''}

                ${issuesCount > 0 ? `
                  <details style="font-size: 0.82rem; background: rgba(255,255,255,0.7); border: 1px solid rgba(0,0,0,0.06); border-radius: 6px; padding: 6px 10px;">
                    <summary style="cursor: pointer; font-weight: 700; color: #b45309;">⚠️ Sheet 5: Issues Log (${issuesCount} Issues)</summary>
                    <ul style="margin: 6px 0 0 16px; padding: 0; max-height: 140px; overflow-y: auto; font-size: 0.78rem;">
                      ${(inv.issues || []).map(iss => `<li><span style="color:#b45309; font-weight:700;">[${escapeHtml(iss.type || '')}]</span> ${escapeHtml(iss.path || '')} — <em>${escapeHtml(iss.description || '')}</em></li>`).join('')}
                    </ul>
                  </details>
                ` : ''}

                ${missingCount > 0 ? `
                  <details style="font-size: 0.82rem; background: #fef2f2; border: 1px solid #fecaca; border-radius: 6px; padding: 6px 10px;">
                    <summary style="cursor: pointer; font-weight: 700; color: #b91c1c;">❌ Sheet 1: Missing Files (${missingCount})</summary>
                    <ul style="margin: 6px 0 0 16px; padding: 0; max-height: 150px; overflow-y: auto; font-family: monospace; font-size: 0.78rem;">
                      ${(inv.missing_files || []).map(m => `<li>${escapeHtml(m.folder_path || m.folder || '')} ➔ <strong>${escapeHtml(m.file_name || m.file || m.filename || '')}</strong> ${m.camera_type ? `<span style="color:#64748b;">(${escapeHtml(m.camera_type)})</span>` : ''}</li>`).join('')}
                    </ul>
                  </details>
                ` : ''}
              </div>
            </div>
          `;
        } else {
          invHtml = `
            <div style="margin-top: 10px; padding: 10px 12px; background: rgba(245, 158, 11, 0.08); border: 1px dashed rgba(245, 158, 11, 0.35); border-radius: 8px; color: #b45309; font-size: 0.82rem;">
              ⏳ No verified inventory report uploaded yet for this slot. (Event cannot be marked Ended without an inventory report).
            </div>
          `;
        }

        card.innerHTML = `
          <div class="event-card-header-line">
            <span class="event-card-title">${escapeHtml(day.date)} — ${escapeHtml(slot.slot_name || slot.slot_code)}</span>
            <span class="type-pill ${isEnded ? 'type-waaz' : 'type-default'}" style="${isEnded ? 'background: #059669; color: white;' : ''}">${isEnded ? '🏁 EVENT ENDED' : (slot.status || 'CREATED')}</span>
          </div>
          <div class="event-card-details">
            <span>🕒 Slot: <strong>${escapeHtml(slot.slot_code)}</strong> (${slot.slot_name})</span>
            <span>📑 Events in Slot: <strong>${(slot.events || []).length}</strong></span>
            <span>🔢 Sequences: <strong>${slot.sequences_count || 0}</strong></span>
            <span>🏁 End Time: <strong>${escapeHtml(slot.event_end_time || (isEnded ? 'Ended' : 'Active'))}</strong></span>
          </div>
          ${invHtml}
        `;
        list.appendChild(card);
      });
    });

    if (totalSlots === 0) {
      list.innerHTML = `<div style="text-align:center; padding:30px; color:#94a3b8;">No schedule slots found in package.</div>`;
    }
  }

  // Setup Filter Listeners
  function setupFilters() {
    const searchInput = document.getElementById('seq-search-input');
    const clearBtn = document.getElementById('btn-clear-search');

    searchInput.addEventListener('input', (e) => {
      state.searchQuery = e.target.value;
      if (state.searchQuery) {
        clearBtn.classList.remove('hidden');
      } else {
        clearBtn.classList.add('hidden');
      }
      renderSequencesTable();
    });

    clearBtn.addEventListener('click', () => {
      searchInput.value = '';
      state.searchQuery = '';
      clearBtn.classList.add('hidden');
      renderSequencesTable();
    });

    document.getElementById('filter-slot').addEventListener('change', (e) => {
      state.activeSlot = e.target.value;
      renderSequencesTable();
    });

    document.getElementById('filter-type').addEventListener('change', (e) => {
      state.activeType = e.target.value;
      renderSequencesTable();
    });

    document.getElementById('filter-coverage').addEventListener('change', (e) => {
      state.activeCoverage = e.target.value;
      renderSequencesTable();
    });
  }

  // Setup Tabs
  function setupTabs() {
    const tabBtns = document.querySelectorAll('.view-tab-btn');
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const targetTab = btn.dataset.tab;
        document.querySelectorAll('.tab-pane').forEach(p => p.classList.add('hidden'));
        document.getElementById(targetTab).classList.remove('hidden');
        state.activeTab = targetTab;
      });
    });
  }

  // Raw JSON Modal
  function setupRawModal() {
    const modal = document.getElementById('modal-raw-json');
    const codeBlock = document.getElementById('raw-json-code');

    document.getElementById('btn-view-raw').addEventListener('click', () => {
      if (!state.pkg) return;
      codeBlock.textContent = JSON.stringify(state.pkg, null, 2);
      modal.classList.remove('hidden');
    });

    document.getElementById('btn-copy-json').addEventListener('click', () => {
      navigator.clipboard.writeText(codeBlock.textContent).then(() => {
        alert("Copied raw JSON to clipboard!");
      });
    });

    document.getElementById('btn-download-json').addEventListener('click', () => {
      if (!state.pkg) return;
      const blob = new Blob([JSON.stringify(state.pkg, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const defaultName = (state.pkg && state.pkg.safar && state.pkg.safar.name)
        ? `${state.pkg.safar.name}.AIN53`
        : 'Safar.AIN53';
      a.download = state.filename || defaultName;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  function closeRawModal() {
    document.getElementById('modal-raw-json').classList.add('hidden');
  }

  // Export to CSV
  function exportFilteredToCsv() {
    const sequences = getFilteredSequences();
    if (sequences.length === 0) {
      alert("No sequences to export.");
      return;
    }

    const headers = [
      "Date", "Slot", "Event Code", "Event Type", "Sequence",
      "Event Abbreviation", "Sticker Name", "Host Name", "ITS",
      "Location", "Mobile", "Photographer", "Photographer Series",
      "Videographer", "Videographer Series", "Status"
    ];

    const rows = [headers];

    sequences.forEach(s => {
      const isUncovered = s.photo_not_covered || s.video_not_covered ||
        (!s.photographer_name && !s.videographer_name && !s.photographer_id && !s.videographer_id);

      rows.push([
        s.date || '',
        s.slot_code || '',
        s.event_code || '',
        s.event_type || '',
        s.sequence || '',
        s.event_abr || '',
        s.sticker_name || '',
        s.name || '',
        s.its || '',
        s.location || '',
        s.mobile || '',
        s.photographer_name || '',
        s.photographer_series || '',
        s.videographer_name || '',
        s.videographer_series || '',
        isUncovered ? 'Uncovered' : 'Covered'
      ]);
    });

    const csvContent = rows.map(r => r.map(val => `"${String(val).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(state.pkg.safar?.name || 'safar').replace(/\s+/g, '_')}_sequences.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Theme Toggle
  function setupThemeToggle() {
    const btn = document.getElementById('btn-theme-toggle');
    btn.addEventListener('click', () => {
      if (document.body.classList.contains('theme-dark')) {
        document.body.classList.remove('theme-dark');
        document.body.classList.add('theme-light');
        btn.textContent = '☀️';
      } else {
        document.body.classList.remove('theme-light');
        document.body.classList.add('theme-dark');
        btn.textContent = '🌙';
      }
    });
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Download Inventory Report Helper
  window.downloadInventoryReportFile = function(filename, base64Data) {
    if (!base64Data) {
      alert('No binary file data attached to this report.');
      return;
    }
    try {
      const byteCharacters = atob(base64Data);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const isXlsx = (filename || '').toLowerCase().endsWith('.xlsx');
      const mime = isXlsx 
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' 
        : 'text/csv;charset=utf-8;';
      const blob = new Blob([byteArray], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename || 'Inventory_Report.xlsx';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Download error:', e);
      alert('Failed to download file: ' + e.message);
    }
  };

  // Boot
  document.addEventListener('DOMContentLoaded', init);
})();
