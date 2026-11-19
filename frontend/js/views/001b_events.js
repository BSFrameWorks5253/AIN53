/**
 * AIN53 Data Management — Event Architecture & Creation Controller (001b_events.js)
 * ==============================================================================
 * Implements the full React 18 / Vanilla JS state engine and views for:
 * 1. Multi-Event Creation Pipeline & useCreateEventForm
 * 2. Standard Unified Engine (Waaz, Majlis, Namaz, Ziyarat, Isteqbal, Wada)
 * 3. QMZ Unified Engine (Round-robin rotation, TSV paste, coverage exceptions)
 * 4. Bethak Unified Engine (Segment counts, buildBethakDatabaseRows, dual-angle Misaq)
 * 5. Offline Folder Generation & CSV Export
 * 6. City & Contributor Crew Management
 */

(function () {
  'use strict';

  // ── Tabular Hijri Calendar Converter (Ported from hijriDate.ts) ──
  const KABISA_YEAR_REMAINDERS = [2, 5, 8, 10, 13, 16, 19, 21, 24, 27, 29];
  const DAYS_IN_YEAR = [30, 59, 89, 118, 148, 177, 207, 236, 266, 295, 325];
  const DAYS_IN_30_YEARS = [
    354, 708, 1063, 1417, 1771, 2126, 2480, 2834, 3189, 3543,
    3898, 4252, 4606, 4961, 5315, 5669, 6024, 6378, 6732, 7087,
    7441, 7796, 8150, 8504, 8859, 9213, 9567, 9922, 10276, 10631,
  ];

  function gregorianToAJD(date) {
    let year = date.getFullYear();
    let month = date.getMonth() + 1;
    const day = date.getDate();
    if (month < 3) {
      year--;
      month += 12;
    }
    let b;
    if (year < 1582 || (year === 1582 && month < 10) || (year === 1582 && month === 10 && day < 15)) {
      b = 0;
    } else {
      const a = Math.floor(year / 100);
      b = 2 - a + Math.floor(a / 4);
    }
    return Math.floor(365.25 * (year + 4716)) + Math.floor(30.6001 * (month + 1)) + day + b - 1524.5;
  }

  function hijriFromGregorian(date = new Date()) {
    const ajd = gregorianToAJD(date);
    let left = Math.floor(ajd - 1948083.5);
    const y30 = Math.floor(left / 10631.0);
    left -= y30 * 10631;
    let i = 0;
    while (i < DAYS_IN_30_YEARS.length && left > DAYS_IN_30_YEARS[i]) {
      i++;
    }
    const year = Math.round(y30 * 30.0 + i);
    if (i > 0) left -= DAYS_IN_30_YEARS[i - 1];
    i = 0;
    while (i < DAYS_IN_YEAR.length && left > DAYS_IN_YEAR[i]) {
      i++;
    }
    const month = Math.round(i);
    const day = i > 0 ? Math.round(left - DAYS_IN_YEAR[i - 1]) : Math.round(left);
    return { year, month, day };
  }

  function getTodayHijriFormatted(date = new Date()) {
    const h = hijriFromGregorian(date);
    const yStr = String(h.year);
    const mStr = String(h.month + 1).padStart(2, '0');
    const dStr = String(h.day).padStart(2, '0');
    return `${yStr}-${mStr}-${dStr}`;
  }

  function isValidHijriDateFormat(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') return false;
    const match = dateStr.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return false;
    const y = parseInt(match[1], 10);
    const m = parseInt(match[2], 10);
    const d = parseInt(match[3], 10);
    if (y < 1300 || y > 1600) return false;
    if (m < 1 || m > 12) return false;
    if (d < 1 || d > 30) return false;
    return true;
  }

  // ── Types & Constants ──
  const STANDARD_EVENT_TYPES = ['Ziyafat', 'Majlis', 'Namaz', 'Waaz', 'Isteqbal', 'Wada', 'Ziyarat', 'Tahmeeq'];
  const TEAM_EVENT_TYPES = ['QMZ', 'Bethak'];
  const ALL_EVENT_TYPES = ['Waaz', 'Majlis', 'Namaz', 'Ziyarat', 'Isteqbal', 'Wada', 'QMZ', 'Bethak', 'Ziyafat', 'Tahmeeq'];
  const BETHAK_SEGMENT_TYPES = [
    'Nikah',
    'Aqiqa',
    'Bethak Majlis',
    'Bethak Qadam',
    'Bethak Ziyafat',
    'Bethak QMZ',
    'Bethak Sharaf',
    'FMB',
    'Haddiyat',
    'Idaraat',
    'Iftettah',
    'Iftettah Sharaf',
    'Isteqbal',
    'Kg Sharaf',
    'Majlis',
    'Mafsuhiyat',
    'Misbah',
    'Mokib',
    'Madrasa',
    'Misaq',
    'Mulaqaat',
    'Miyana',
    'Majmui Ziyafat',
    'Namaz',
    'Online',
    'Qadam',
    'Qadam Majlis Ziyafat',
    'Sharaf',
    'Shifa Qadam',
    'Tijarat',
    'Talaqqi',
    'Tahneeq',
    'Waaz',
    'Wada',
    'Ziyafat',
    'Zafaf Olda',
    'Other'
  ];

  const BETHAK_ABR_MAP = {
    'Aqiqa': 'AQ',
    'Aqeeqa': 'AQ',
    'Bethak Majlis': 'BM',
    'Bethak Qadam': 'BQ',
    'Bethak Ziyafat': 'BZ',
    'Bethak QMZ': 'BQMZ',
    'Bethak Sharaf': 'SH',
    'FMB': 'FMB',
    'Haddiyat': 'H',
    'Idaraat': 'ID',
    'Iftettah': 'IF',
    'Iftetah': 'IF',
    'Iftettah Sharaf': 'IFS',
    'Isteqbal': 'IST',
    'Kg Sharaf': 'KGS',
    'Majlis': 'M',
    'Mafsuhiyat': 'MF',
    'Misbah': 'Misbah',
    'Mokib': 'MKB',
    'Madrasa': 'MO',
    'Misaq': 'MQ',
    'Mulaqaat': 'MUL',
    'Miyana': 'MYN',
    'Majmui Ziyafat': 'MZ',
    'Nikah': 'N',
    'Namaz': 'Namaz',
    'Online': 'Online',
    'Qadam': 'Q',
    'Qadam Majlis Ziyafat': 'QMZ',
    'Sharaf': 'SH',
    'Shifa Qadam': 'SQ',
    'Tijarat': 'TJR',
    'Talaqqi': 'TQ',
    'Tahneeq': 'TQN',
    'Tahmeeq': 'TQN',
    'Waaz': 'Waaz',
    'Wada': 'WD',
    'Ziyafat': 'Z',
    'Zafaf Olda': 'ZO',
    'Other': 'Other'
  };

  function getSharafCategory(name) {
    if (!name) return '';
    const s = String(name).toLowerCase().replace(/[^a-z0-9]/g, '');
    if (s.includes('nikah') || s.includes('nikaah')) return 'nikah';
    if (s.includes('misaq') || s.includes('meesaq')) return 'misaq';
    if (s.includes('ziyafat') || s.includes('ziyaaf') || s.includes('ziyfat')) return 'ziyafat';
    if (s.includes('qadam')) return 'qadam';
    if (s.includes('majlis')) return 'majlis';
    if (s.includes('haddiyat') || s.includes('hadiya')) return 'haddiyat';
    if (s.includes('mafsuhiyat')) return 'mafsuhiyat';
    if (s.includes('mulaqaat') || s.includes('mulaqat')) return 'mulaqaat';
    if (s.includes('aqiqa') || s.includes('aqeeqa') || s.includes('akika')) return 'aqiqa';
    if (s.includes('tahneeq') || s.includes('tahmeeq')) return 'tahneeq';
    if (s.includes('qmz')) return 'qmz';
    return s;
  }

  function isSharafMatching(type1, type2) {
    if (!type1 || !type2) return false;
    const c1 = getSharafCategory(type1);
    const c2 = getSharafCategory(type2);
    if (c1 && c2 && c1 === c2) return true;
    if (c1 === 'qmz' || c2 === 'qmz') {
      const other = c1 === 'qmz' ? c2 : c1;
      if (['ziyafat', 'qadam', 'majlis', 'qmz'].includes(other)) return true;
    }
    return String(type1).trim().toLowerCase() === String(type2).trim().toLowerCase();
  }

  const EVENT_LIST_DEFINITIONS = [
    { name: "Aqiqa", abr: "AQ" },
    { name: "Bethak Majlis", abr: "BM" },
    { name: "Bethak Qadam", abr: "BQ" },
    { name: "Bethak Ziyafat", abr: "BZ" },
    { name: "FMB", abr: "FMB" },
    { name: "Haddiyat", abr: "H" },
    { name: "Idaraat", abr: "ID" },
    { name: "Iftettah", abr: "IF" },
    { name: "Iftettah Sharaf", abr: "IFS" },
    { name: "Isteqbal", abr: "IST" },
    { name: "Kg Sharaf", abr: "KGS" },
    { name: "Majlis", abr: "M" },
    { name: "Mafsuhiyat", abr: "MF" },
    { name: "Misbah", abr: "Misbah" },
    { name: "Mokib", abr: "MKB" },
    { name: "Madrasa", abr: "MO" },
    { name: "Misaq", abr: "MQ" },
    { name: "Mulaqaat", abr: "MUL" },
    { name: "Miyana", abr: "MYN" },
    { name: "Majmui Ziyafat", abr: "MZ" },
    { name: "Nikah", abr: "N" },
    { name: "Namaz", abr: "Namaz" },
    { name: "Online", abr: "Online" },
    { name: "Qadam", abr: "Q" },
    { name: "Qadam Majlis Ziyafat", abr: "QMZ" },
    { name: "Sharaf", abr: "SH" },
    { name: "Shifa Qadam", abr: "SQ" },
    { name: "Tijarat", abr: "TJR" },
    { name: "Talaqqi", abr: "TQ" },
    { name: "Tahneeq", abr: "TQN" },
    { name: "Waaz", abr: "Waaz" },
    { name: "Wada", abr: "WD" },
    { name: "Ziyafat", abr: "Z" },
    { name: "Zafaf Olda", abr: "ZO" },
  ];

  const EVENT_ABR_TO_NAME = {};
  EVENT_LIST_DEFINITIONS.forEach(item => {
    EVENT_ABR_TO_NAME[item.abr.toUpperCase()] = item.name;
    EVENT_ABR_TO_NAME[item.name.toUpperCase()] = item.name;
  });
  // Canonical aliases
  EVENT_ABR_TO_NAME['Z'] = 'Ziyafat';
  EVENT_ABR_TO_NAME['ZIYAFAT'] = 'Ziyafat';
  EVENT_ABR_TO_NAME['Q'] = 'Qadam';
  EVENT_ABR_TO_NAME['QADAM'] = 'Qadam';
  EVENT_ABR_TO_NAME['M'] = 'Majlis';
  EVENT_ABR_TO_NAME['MAJLIS'] = 'Majlis';
  EVENT_ABR_TO_NAME['OLDA'] = 'Zafaf Olda';
  EVENT_ABR_TO_NAME['ZO'] = 'Zafaf Olda';
  EVENT_ABR_TO_NAME['ZAFAF OLDA'] = 'Zafaf Olda';
  EVENT_ABR_TO_NAME['ZIYARAT'] = 'Ziyarat';
  EVENT_ABR_TO_NAME['AQEEQA'] = 'Aqiqa';
  EVENT_ABR_TO_NAME['IFTETAH'] = 'Iftettah';
  EVENT_ABR_TO_NAME['TAHMEEQ'] = 'Tahneeq';

  function normalizeEventAbr(raw) {
    const s = (raw || '').trim();
    if (!s) return 'Qadam';
    const upper = s.toUpperCase();
    if (EVENT_ABR_TO_NAME[upper]) {
      return EVENT_ABR_TO_NAME[upper];
    }
    if (upper === 'Z' || upper.endsWith(' Z') || upper.includes('ZIYAFAT')) return 'Ziyafat';
    if (upper === 'Q' || upper.endsWith(' Q') || upper.includes('QADAM')) return 'Qadam';
    if (upper === 'M' || upper.endsWith(' M') || upper.includes('MAJLIS')) return 'Majlis';
    if (upper.includes('OLDA')) return 'Zafaf Olda';
    if (upper.includes('ZIYARAT')) return 'Ziyarat';
    return s || 'Qadam';
  }

  // ── Engine Resolver (Spec 4.2) ──
  function getEventEngine(type) {
    if (type === 'QMZ' || type === 'QMZ-New') return 'qmz';
    if (type === 'Bethak') return 'bethak';
    return 'standard';
  }

  // ── Official Event Code Generator (Spec 4.2) ──
  function generateEventCode(date, slot, seq, type, cityName) {
    const slotCode = slot === 'Morning' ? '01M' : '02E';
    const seqStr = String(seq).padStart(2, '0');
    return `${date} _ ${slotCode}-${seqStr}-${type}-${cityName}`;
  }

  // ── Default Teams Builder (Spec 4.2) ──
  function buildDefaultTeams(targetCity, eventType = 'Bethak') {
    const isQMZ = (eventType === 'QMZ' || (typeof eventType === 'string' && eventType.toUpperCase().includes('QMZ')));
    const defaultCount = isQMZ ? 2 : 1;
    const coreTeams = (targetCity && targetCity.core_teams) ? targetCity.core_teams : [];
    const seeded = coreTeams.slice(0, defaultCount).map((ct, idx) => ({
      id: `team-${Date.now()}-${idx}-${Math.floor(Math.random() * 999)}`,
      name: `Team ${idx + 1}`,
      photographer_id: ct.photographer_id ?? null,
      videographer_id: ct.videographer_id ?? null,
      save_for_reuse: false,
    }));

    if (seeded.length >= defaultCount) return seeded;

    const result = [...seeded];
    while (result.length < defaultCount) {
      const idx = result.length;
      result.push({
        id: `team-${Date.now()}-${idx + 1}`,
        name: `Team ${idx + 1}`,
        photographer_id: null,
        videographer_id: null,
        save_for_reuse: false
      });
    }
    return result;
  }

  // ── QMZ Initial Rows Builder (Spec 4.2) ──
  function buildQMZNewRows(count, teams) {
    if (count <= 0 || !teams || teams.length === 0) return [];
    return Array.from({ length: count }, (_, i) => {
      const team = teams[i % teams.length];
      return {
        sequence: String(i + 1),
        event_abr: 'Qadam',
        sticker_name: '',
        name: '',
        its: '',
        location: '',
        mobile: '',
        team_id: team.id,
        photographer_id: team.photographer_id,
        videographer_id: team.videographer_id,
        photo_not_covered: false,
        video_not_covered: false,
      };
    });
  }

  // ── Bethak Database Rows Transformation Algorithm (Spec 5.3) ──
  function buildBethakDatabaseRows(counts, teams, existingDbRows) {
    const segments = counts || [];
    const teamList = teams || [];
    const rows = [];
    let globalSequence = 1;

    const findExistingRow = (seq, segType, teamId, slotIdx = 0) => {
      if (!existingDbRows || existingDbRows.length === 0) return undefined;
      if (teamId) {
        const match = existingDbRows.find(r => String(r.sequence) === String(seq) && r.event_abr === segType && String(r.team_id || '') === String(teamId));
        if (match) return match;
      }
      const matches = existingDbRows.filter(r => String(r.sequence) === String(seq) && r.event_abr === segType);
      return matches[slotIdx] || matches[0];
    };

    const findPersonDetails = (seq, segType) => {
      if (!existingDbRows || existingDbRows.length === 0) return { its: '', name: '', sticker_name: '', mobile: '', location: '' };
      const existing = existingDbRows.find(r => String(r.sequence) === String(seq) && r.event_abr === segType);
      return {
        its: existing?.its ?? '',
        name: existing?.name ?? '',
        sticker_name: existing?.sticker_name ?? '',
        mobile: existing?.mobile ?? '',
        location: existing?.location ?? '',
      };
    };

    segments.forEach((seg) => {
      const segCount = Math.max(parseInt(seg.count, 10) || 1, 1);
      for (let i = 0; i < segCount; i++) {
        const seqStr = String(globalSequence);
        const ceremonyType = (seg.type === 'Bethak QMZ' && seg.subTypes?.[i]) ? seg.subTypes[i] : seg.type;
        const person = findPersonDetails(seqStr, ceremonyType);

        if (seg.type === 'Misaq') {
          // Misaq requires 2 photographers (no videographer) for dual-angle coverage
          const misaqSlots = (teamList.length >= 2)
            ? [teamList[0], teamList[1]]
            : (teamList.length === 1 ? [teamList[0], null] : [null, null]);

          misaqSlots.forEach((team, slotIdx) => {
            const teamId = team?.id ?? '';
            const existing = findExistingRow(seqStr, ceremonyType, teamId, slotIdx);
            rows.push({
              sequence: seqStr,
              event_abr: ceremonyType,
              sticker_name: person.sticker_name,
              name: person.name,
              its: person.its,
              location: person.location,
              mobile: person.mobile,
              team_id: teamId || null,
              photographer_id: existing?.photographer_id ?? team?.photographer_id ?? null,
              videographer_id: null,
              photo_not_covered: existing?.photo_not_covered ?? false,
              video_not_covered: false,
            });
          });
        } else {
          // All other ceremonies: exactly ONE row per sequence, distributed round-robin across teams
          const isPhotoOnly = ['Haddiyat', 'Mafsuhiyat'].includes(seg.type);
          const assignedTeam = (teamList.length > 0) ? teamList[(globalSequence - 1) % teamList.length] : null;
          const assignedTeamId = assignedTeam?.id ?? null;
          const existing = findExistingRow(seqStr, ceremonyType, assignedTeamId, 0);

          rows.push({
            sequence: seqStr,
            event_abr: ceremonyType,
            sticker_name: person.sticker_name,
            name: person.name,
            its: person.its,
            location: person.location,
            mobile: person.mobile,
            team_id: existing?.team_id ?? assignedTeamId,
            photographer_id: existing?.photographer_id ?? assignedTeam?.photographer_id ?? null,
            videographer_id: isPhotoOnly ? null : (existing?.videographer_id ?? assignedTeam?.videographer_id ?? null),
            photo_not_covered: existing?.photo_not_covered ?? false,
            video_not_covered: isPhotoOnly ? false : (existing?.video_not_covered ?? false),
          });
        }
        globalSequence++;
      }
    });

    return rows;
  }

  // ============================================================================
  // APP STATE & CONTROLLER
  // ============================================================================
  const state = {
    cities: [],
    contributors: [],
    safars: [],
    activeSafar: localStorage.getItem('ain53_active_safar') || null,
    events: [],
    selectedEventId: null,
    activeEvent: null,
    filterDate: '',
    filterSlot: 'All',
    filterCityId: 'All',
    isSaving: false,
  };

  // ── Helper: Safe API call bridge ──
  async function callApi(method, ...args) {
    // 1. Try PyWebView API if available
    try {
      if (window.pywebview && window.pywebview.api && typeof window.pywebview.api[method] === 'function') {
        const resp = await window.pywebview.api[method](...args);
        const parsed = typeof resp === 'string' ? JSON.parse(resp) : resp;
        if (!parsed || parsed.error !== 'Failed to fetch') {
          return parsed;
        }
      }
    } catch (e) {
      console.warn(`[EventsApi] Native pywebview call failed for ${method}:`, e);
    }

    // 2. Fallback to HTTP server bridge (supports file:/// and browser mode)
    try {
      const endpoint = (window.location.protocol === 'http:' || window.location.protocol === 'https:')
        ? `/api/${String(method)}`
        : `http://127.0.0.1:${window.AIN53_SERVER_PORT || 5353}/api/${String(method)}`;

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ args: args })
      });
      const data = await res.json();
      return typeof data === 'string' ? JSON.parse(data) : data;
    } catch (e) {
      console.error(`[EventsApi] HTTP fallback failed for ${method}:`, e);
      return { error: e.message };
    }
  }

  // ── Helper: Safe HTML escape ──
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // ── Helper: Attach Writable City Combobox (Local + Google / Global suggestions) ──
  function attachCityCombobox(inputEl, dropdownEl, indicatorEl, onSelect) {
    if (!inputEl || !dropdownEl) return;

    let debounceTimer = null;
    let activeIndex = -1;
    let currentResults = [];
    const wrapperEl = inputEl.closest('.city-combobox-wrapper');

    function renderDropdown(items) {
      currentResults = items || [];
      activeIndex = -1;

      if (!items || items.length === 0) {
        dropdownEl.innerHTML = `<div class="city-suggestion-empty">No cities found</div>`;
        dropdownEl.classList.remove('hidden');
        if (wrapperEl) wrapperEl.style.zIndex = '100';
        return;
      }

      dropdownEl.innerHTML = items.map((item, idx) => {
        const badgeClass = item.is_local ? 'city-badge-registered' : 'city-badge-google';
        const badgeText = item.is_local ? 'Saved' : (item.source === 'google_maps' ? 'Global' : 'Google');
        const subText = item.description || (item.is_local ? 'Registered City in AIN53' : 'Global Geocoder');
        return `
          <div class="city-suggestion-item" data-idx="${idx}">
            <div class="city-suggestion-main">
              <span class="city-suggestion-title">${escapeHtml(item.name)}</span>
              <span class="city-suggestion-sub">${escapeHtml(subText)}</span>
            </div>
            <span class="city-badge ${badgeClass}">${badgeText}</span>
          </div>
        `;
      }).join('');

      dropdownEl.querySelectorAll('.city-suggestion-item').forEach(el => {
        el.addEventListener('mousedown', (e) => {
          e.preventDefault();
          const idx = parseInt(el.getAttribute('data-idx'), 10);
          selectIndex(idx);
        });
      });

      dropdownEl.classList.remove('hidden');
      if (wrapperEl) wrapperEl.style.zIndex = '100';
    }

    function selectIndex(idx) {
      if (idx >= 0 && idx < currentResults.length) {
        const selected = currentResults[idx];
        inputEl.value = selected.name;
        hideDropdown();
        if (typeof onSelect === 'function') {
          onSelect(selected);
        }
      }
    }

    function hideDropdown() {
      dropdownEl.classList.add('hidden');
      if (wrapperEl) wrapperEl.style.zIndex = '';
    }

    function setActiveItem(newIndex) {
      const items = dropdownEl.querySelectorAll('.city-suggestion-item');
      if (items.length === 0) return;

      items.forEach(el => el.classList.remove('active'));
      if (newIndex >= items.length) newIndex = 0;
      if (newIndex < 0) newIndex = items.length - 1;

      activeIndex = newIndex;
      const activeEl = items[activeIndex];
      if (activeEl) {
        activeEl.classList.add('active');
        activeEl.scrollIntoView({ block: 'nearest' });
      }
    }

    function getLocalMatches(query) {
      const q = (query || '').trim().toLowerCase();
      const local = (state.cities || []).map(c => ({
        id: c.id,
        name: c.name,
        description: `${c.teams_required || 2} teams req • Local Database`,
        is_local: true,
        source: 'local'
      }));

      if (!q) return local;
      return local.filter(c => c.name.toLowerCase().includes(q));
    }

    async function performSearch(query) {
      const trimmed = (query || '').trim();
      const localMatches = getLocalMatches(trimmed);
      renderDropdown(localMatches);

      if (trimmed.length < 2) {
        if (indicatorEl) indicatorEl.innerHTML = '<span class="city-indicator-icon">📍</span>';
        return;
      }

      if (indicatorEl) {
        indicatorEl.innerHTML = '<div class="city-combobox-spinner"></div>';
      }

      try {
        const res = await callApi('events_search_cities', trimmed);
        let combined = [];
        if (res && res.cities && Array.isArray(res.cities)) {
          combined = res.cities;
        } else {
          combined = localMatches;
        }

        if (inputEl.value.trim().toLowerCase().startsWith(trimmed.slice(0, 2).toLowerCase())) {
          renderDropdown(combined);
        }
      } catch (err) {
        console.warn('[CityCombobox] Search error:', err);
      } finally {
        if (indicatorEl) {
          indicatorEl.innerHTML = '<span class="city-indicator-icon">📍</span>';
        }
      }
    }

    inputEl.addEventListener('input', (e) => {
      const val = e.target.value;
      const match = (state.cities || []).find(c => c.name.toLowerCase() === val.trim().toLowerCase());
      if (typeof onSelect === 'function') {
        onSelect({
          name: val.trim(),
          id: match ? match.id : null,
          is_local: !!match
        });
      }

      clearTimeout(debounceTimer);
      const local = getLocalMatches(val);
      renderDropdown(local);

      if (val.trim().length >= 2) {
        debounceTimer = setTimeout(() => {
          performSearch(val);
        }, 220);
      }
    });

    inputEl.addEventListener('focus', () => {
      performSearch(inputEl.value);
    });

    inputEl.addEventListener('keydown', (e) => {
      if (dropdownEl.classList.contains('hidden')) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          performSearch(inputEl.value);
          e.preventDefault();
        }
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveItem(activeIndex + 1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveItem(activeIndex - 1);
      } else if (e.key === 'Enter') {
        if (activeIndex >= 0 && activeIndex < currentResults.length) {
          e.preventDefault();
          selectIndex(activeIndex);
        }
      } else if (e.key === 'Escape') {
        hideDropdown();
      }
    });

    const onDocClick = (e) => {
      if (!inputEl.contains(e.target) && !dropdownEl.contains(e.target)) {
        hideDropdown();
      }
    };
    document.addEventListener('click', onDocClick);
  }

  // ── Load Initial Master Data ──
  async function loadMasterData() {
    try {
      const [cityRes, safarRes] = await Promise.all([
        callApi('events_get_cities'),
        callApi('events_get_safars')
      ]);

      if (cityRes && cityRes.cities && cityRes.cities.length > 0) {
        state.cities = cityRes.cities;
        populateCityFilter();
      }
      if (safarRes && safarRes.safars && safarRes.safars.length > 0) {
        state.safars = safarRes.safars;
        if (!state.activeSafar || !state.safars.some(s => s.name.toLowerCase() === state.activeSafar.toLowerCase())) {
          state.activeSafar = state.safars[0].name;
          localStorage.setItem('ain53_active_safar', state.activeSafar);
        }
        try {
          await callApi('events_set_active_safar', state.activeSafar);
        } catch (e) {}
      } else {
        state.safars = [];
        state.activeSafar = '';
        localStorage.removeItem('ain53_active_safar');
      }

      // Load contributors prioritized for active Safar
      try {
        const contribRes = await callApi('events_get_contributors', state.activeSafar || '');
        if (contribRes && contribRes.contributors && contribRes.contributors.length > 0) {
          state.contributors = contribRes.contributors;
        }
      } catch (cErr) {
        console.warn('[Events] Contributor fetch warning:', cErr);
      }

      renderSafarBar();
    } catch (err) {
      console.warn('[Events] Failed to load master data:', err);
    }
  }

  // ── Render Safar Navigator Bar & Dropdown matching Video ──
  function renderSafarBar() {
    const safarLabel = document.getElementById('active-safar-label');
    const menuItems = document.getElementById('safar-menu-items');
    const pillBtn = document.getElementById('btn-safar-selector-pill');
    const floatingMenu = document.getElementById('safar-floating-menu');
    const addSafarBtn = document.getElementById('safar-menu-add-btn');
    const clearAllBtn = document.getElementById('safar-menu-clear-all-btn');
    const folderPickerBtn = document.getElementById('btn-safar-folder-picker');

    if (safarLabel) {
      const activeObj = (state.safars || []).find(s => (s.name || '').toLowerCase() === (state.activeSafar || '').toLowerCase());
      if (activeObj && activeObj.status === 'completed') {
        safarLabel.innerHTML = `${escapeHtml(state.activeSafar || 'Select Safar')} <span style="font-size: 0.72rem; color: #059669; font-weight: 700; margin-left: 5px;">(Completed)</span>`;
      } else {
        safarLabel.textContent = state.activeSafar || 'Select Safar';
      }
    }

    if (menuItems) {
      menuItems.innerHTML = '';
      if (!state.safars || state.safars.length === 0) {
        const emptyMsg = document.createElement('div');
        emptyMsg.style.cssText = 'padding: 14px 16px; text-align: center; color: var(--text-muted); font-size: 0.85rem;';
        emptyMsg.innerHTML = 'No Safars registered.<br><span style="font-size: 0.78rem; opacity: 0.8;">Click below to create a Safar</span>';
        menuItems.appendChild(emptyMsg);
      } else {
        state.safars.forEach(s => {
          const isActive = (state.activeSafar || '').toLowerCase() === (s.name || '').toLowerCase();
          const isCompleted = s.status === 'completed';
          const hasDates = (s.date_count || 0) > 0;
          const item = document.createElement('div');
          item.className = `safar-menu-item ${isActive ? 'active' : ''}`;
          item.setAttribute('data-safar-name', s.name);
          item.style.display = 'flex';
          item.style.alignItems = 'center';
          item.style.justifyContent = 'space-between';
          item.innerHTML = `
            <span class="safar-item-name" style="flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
              ${escapeHtml(s.name)}
              ${isCompleted ? '<span style="margin-left: 6px; font-size: 0.68rem; font-weight: 700; color: #059669; background: rgba(16, 185, 129, 0.12); padding: 1px 6px; border-radius: 999px;">✓ Completed</span>' : ''}
            </span>
            <div style="display: flex; align-items: center; gap: 4px; margin-left: 8px;">
              ${hasDates ? `
              <button type="button" class="safar-download-btn" title="Download .AIN53 for ${escapeHtml(s.name)}" style="background: none; border: none; padding: 4px; color: #3b82f6; border-radius: 6px; cursor: pointer; display: flex; align-items: center; justify-content: center; opacity: 0.75; transition: all 0.15s ease;">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                  <polyline points="7 10 12 15 17 10"></polyline>
                  <line x1="12" y1="15" x2="12" y2="3"></line>
                </svg>
              </button>
              ` : ''}
              <button type="button" class="safar-delete-btn" title="Delete Safar" style="background: none; border: none; padding: 4px; color: var(--text-muted); border-radius: 6px; cursor: pointer; display: flex; align-items: center; justify-content: center; opacity: 0.6; transition: all 0.15s ease;">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
              </button>
            </div>
          `;

          const dlBtn = item.querySelector('.safar-download-btn');
          if (dlBtn) {
            dlBtn.addEventListener('click', async (e) => {
              e.stopPropagation();
              const oldActive = state.activeSafar;
              state.activeSafar = s.name;
              try {
                await downloadFullSafarAin53();
              } finally {
                state.activeSafar = oldActive;
              }
            });
          }

          item.addEventListener('click', async (e) => {
            if (e.target.closest('.safar-delete-btn') || e.target.closest('.safar-download-btn')) return;
            if ((state.activeSafar || '').toLowerCase() !== (s.name || '').toLowerCase()) {
              state.activeSafar = s.name;
              localStorage.setItem('ain53_active_safar', s.name);
              renderSafarBar();
              try {
                await callApi('events_set_active_safar', state.activeSafar);
              } catch (e) {}
              try {
                const cRes = await callApi('events_get_contributors', state.activeSafar);
                if (cRes && cRes.contributors) state.contributors = cRes.contributors;
              } catch (e) {}
              loadEventsList();
            }
            if (floatingMenu) floatingMenu.classList.add('hidden');
            if (pillBtn) pillBtn.classList.remove('open');
          });

          const delBtn = item.querySelector('.safar-delete-btn');
          if (delBtn) {
            delBtn.addEventListener('mouseenter', () => { delBtn.style.opacity = '1'; delBtn.style.color = '#ef4444'; });
            delBtn.addEventListener('mouseleave', () => { delBtn.style.opacity = '0.6'; delBtn.style.color = 'var(--text-muted)'; });
            delBtn.addEventListener('click', async (e) => {
              e.stopPropagation();
              if (confirm(`Delete Safar "${s.name}" and all its associated events?`)) {
                await callApi('events_delete_safar', s.name);
                if (window.showToast) window.showToast(`Deleted Safar "${s.name}"`, 'info');
                if ((state.activeSafar || '').toLowerCase() === (s.name || '').toLowerCase()) {
                  state.activeSafar = '';
                  localStorage.removeItem('ain53_active_safar');
                }
                await loadMasterData();
                loadEventsList();
              }
            });
          }

          menuItems.appendChild(item);
        });
      }
    }

    if (clearAllBtn) {
      if (state.safars && state.safars.length > 0) {
        clearAllBtn.style.display = 'block';
      } else {
        clearAllBtn.style.display = 'none';
      }
      if (!clearAllBtn._wired) {
        clearAllBtn._wired = true;
        clearAllBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (confirm('Are you sure you want to clear ALL Safars and all their events? This cannot be undone.')) {
            await callApi('events_clear_all_safars');
            if (window.showToast) window.showToast('All Safars and events cleared', 'info');
            state.safars = [];
            state.activeSafar = '';
            localStorage.removeItem('ain53_active_safar');
            await loadMasterData();
            loadEventsList();
            if (floatingMenu) floatingMenu.classList.add('hidden');
            if (pillBtn) pillBtn.classList.remove('open');
          }
        });
      }
    }

    if (pillBtn && floatingMenu && !pillBtn._wired) {
      pillBtn._wired = true;
      pillBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isHidden = floatingMenu.classList.contains('hidden');
        if (isHidden) {
          floatingMenu.classList.remove('hidden');
          pillBtn.classList.add('open');
        } else {
          floatingMenu.classList.add('hidden');
          pillBtn.classList.remove('open');
        }
      });

      document.addEventListener('click', (e) => {
        if (!floatingMenu.contains(e.target) && !pillBtn.contains(e.target)) {
          floatingMenu.classList.add('hidden');
          pillBtn.classList.remove('open');
        }
      });
    }

    if (addSafarBtn && !addSafarBtn._wired) {
      addSafarBtn._wired = true;
      addSafarBtn.addEventListener('click', () => {
        if (floatingMenu) floatingMenu.classList.add('hidden');
        if (pillBtn) pillBtn.classList.remove('open');
        promptCreateNewSafar();
      });
    }

    if (folderPickerBtn) {
      const curS = (state.safars || []).find(s => (s.name || '').toLowerCase() === (state.activeSafar || '').toLowerCase());
      if (curS && curS.path) {
        folderPickerBtn.title = `Safar Folder: ${curS.path}`;
      } else {
        folderPickerBtn.title = 'Select Safar Folder';
      }

      if (!folderPickerBtn._wired) {
        folderPickerBtn._wired = true;
        folderPickerBtn.addEventListener('click', async () => {
          try {
            const res = await callApi('events_select_export_dir');
            if (res && res.path) {
              localStorage.setItem('ain53_safar_folder_' + (state.activeSafar || 'default'), res.path);
              folderPickerBtn.title = `Safar Folder: ${res.path}`;
              if (state.activeSafar) {
                await callApi('events_update_safar_path', state.activeSafar, res.path);
                const cur = (state.safars || []).find(s => (s.name || '').toLowerCase() === (state.activeSafar || '').toLowerCase());
                if (cur) cur.path = res.path;
              }
              window.showToast(`Safar Folder configured: ${res.path}`, 'success');
            }
          } catch (err) {
            console.warn('Folder picker error:', err);
          }
        });
      }
    }

    const importCrewBtn = document.getElementById('btn-import-safar-crew');
    if (importCrewBtn) {
      const count = (state.contributors || []).length;
      const countLabel = count > 0 ? ` (${count})` : '';
      const textSpan = importCrewBtn.querySelector('span');
      if (textSpan) textSpan.textContent = `Crew & Series${countLabel}`;
      if (!importCrewBtn._wired) {
        importCrewBtn._wired = true;
        importCrewBtn.addEventListener('click', () => {
          openSafarCrewModal(state.activeSafar);
        });
      }
    }

    const activeSafarObj = (state.safars || []).find(s => (s.name || '').toLowerCase() === (state.activeSafar || '').toLowerCase());
    const hasDates = activeSafarObj ? ((activeSafarObj.date_count || 0) > 0) : false;

    const exportAin53Btn = document.getElementById('btn-export-safar-ain53');
    if (exportAin53Btn) {
      if (!hasDates || state.currentPage === 'safars-grid') {
        exportAin53Btn.style.display = 'none';
      } else {
        exportAin53Btn.style.display = 'inline-flex';
      }
      if (!exportAin53Btn._wired) {
        exportAin53Btn._wired = true;
        exportAin53Btn.addEventListener('click', () => {
          downloadFullSafarAin53();
        });
      }
    }

    const topDownloadBtn = document.getElementById('btn-top-download-safar');
    if (topDownloadBtn) {
      if (!hasDates || state.currentPage === 'safars-grid') {
        topDownloadBtn.style.display = 'none';
      } else {
        topDownloadBtn.style.display = 'inline-flex';
      }
      if (!topDownloadBtn._wired) {
        topDownloadBtn._wired = true;
        topDownloadBtn.addEventListener('click', () => {
          downloadFullSafarAin53();
        });
      }
    }

    const pillDownloadBtn = document.getElementById('btn-pill-download-safar');
    if (pillDownloadBtn) {
      if (!hasDates) {
        pillDownloadBtn.style.display = 'none';
      } else {
        pillDownloadBtn.style.display = 'inline-flex';
      }
      if (!pillDownloadBtn._wired) {
        pillDownloadBtn._wired = true;
        pillDownloadBtn.addEventListener('click', () => {
          downloadFullSafarAin53();
        });
      }
    }


    // Trigger on "AIN53 Coordinator" to toggle full-page All Safars Grid
    const hiddenSafarsGridBtn = document.getElementById('btn-hidden-safars-grid');
    if (hiddenSafarsGridBtn) {
      hiddenSafarsGridBtn.onclick = (e) => window.toggleSafarsGridPage(e);
    }

    const safarsGridPillBtn = document.getElementById('btn-open-safars-grid-pill');
    if (safarsGridPillBtn) {
      safarsGridPillBtn.onclick = (e) => window.toggleSafarsGridPage(e);
    }
  }

  // ── Show All Safars Full-Page Grid (Not a Popup) ──
  async function showSafarsGridPage() {
    removeAllModalBackdrops();
    state.currentPage = 'safars-grid';

    const pageContainer = document.querySelector('.events-page-container');
    if (pageContainer) pageContainer.classList.add('safars-grid-active');
    const viewEvents = document.getElementById('view-events');
    if (viewEvents) viewEvents.classList.add('safars-grid-active');

    const schedulePage = document.getElementById('coordinator-schedule-page');
    const gridPage = document.getElementById('coordinator-safars-grid-page');
    if (schedulePage) {
      schedulePage.classList.add('hidden');
      schedulePage.style.display = 'none';
    }
    if (gridPage) {
      gridPage.classList.remove('hidden');
      gridPage.style.display = 'flex';
    }

    // Hide top-right Download Safar and Viewer buttons on All Safars page
    const headerRightActions = document.querySelector('.coordinator-header-right-actions');
    if (headerRightActions) {
      headerRightActions.style.display = 'none';
    }

    const pillBtn = document.getElementById('btn-open-safars-grid-pill');
    if (pillBtn) {
      pillBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
        <span>Events Schedule</span>
      `;
      pillBtn.title = "Return to Events Schedule view";
    }

    // Render immediately from state for instant responsiveness
    renderSafarsPageCards();

    try {
      const sRes = await callApi('events_get_safars');
      if (sRes && sRes.safars) {
        state.safars = sRes.safars;
        renderSafarsPageCards();
      }
    } catch (e) {
      console.warn('Error refreshing safars:', e);
    }
  }

  // ── Show Events Schedule Full Page ──
  function showEventsSchedulePage() {
    state.currentPage = 'schedule';

    const pageContainer = document.querySelector('.events-page-container');
    if (pageContainer) pageContainer.classList.remove('safars-grid-active');
    const viewEvents = document.getElementById('view-events');
    if (viewEvents) viewEvents.classList.remove('safars-grid-active');

    const schedulePage = document.getElementById('coordinator-schedule-page');
    const gridPage = document.getElementById('coordinator-safars-grid-page');
    if (gridPage) {
      gridPage.classList.add('hidden');
      gridPage.style.display = 'none';
    }
    if (schedulePage) {
      schedulePage.classList.remove('hidden');
      schedulePage.style.display = 'flex';
    }

    // Restore top-right Download Safar and Viewer buttons on Schedule page
    const headerRightActions = document.querySelector('.coordinator-header-right-actions');
    if (headerRightActions) {
      headerRightActions.style.display = 'flex';
    }

    const pillBtn = document.getElementById('btn-open-safars-grid-pill');
    if (pillBtn) {
      pillBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
        <span>All Safars (Grid)</span>
      `;
      pillBtn.title = "View all Safars in Grid Table";
    }

    renderSafarBar();
    loadEventsList();
  }

  // Canonical toggle function exposed to window
  window.toggleSafarsGridPage = function(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (e && e.stopPropagation) e.stopPropagation();
    if (state.currentPage === 'safars-grid') {
      showEventsSchedulePage();
    } else {
      showSafarsGridPage();
    }
  };
  window.showSafarsGridPage = showSafarsGridPage;
  window.showEventsSchedulePage = showEventsSchedulePage;

  // Backwards compatibility alias
  function openSafarsGridModal() {
    showSafarsGridPage();
  }

  // ── Render Cards in the Full-Page Safars Grid ──
  function renderSafarsPageCards(filterText = '') {
    const cardsContainer = document.getElementById('safars-page-cards-container');
    const countPill = document.getElementById('safars-page-count-pill');
    const countLabel = document.getElementById('safars-page-count-label');
    const searchInp = document.getElementById('safars-page-search-input');
    const backBtn = document.getElementById('btn-back-to-schedule');
    const newSafarBtn = document.getElementById('btn-grid-page-new-safar');

    if (!cardsContainer) return;

    const count = (state.safars || []).length;
    if (countPill) countPill.textContent = `${count} Safar${count === 1 ? '' : 's'}`;
    if (countLabel) countLabel.textContent = `${count} Safar${count === 1 ? '' : 's'} registered`;

    if (backBtn && !backBtn._wired) {
      backBtn._wired = true;
      backBtn.onclick = () => showEventsSchedulePage();
    }

    if (newSafarBtn && !newSafarBtn._wired) {
      newSafarBtn._wired = true;
      newSafarBtn.onclick = () => {
        promptCreateNewSafar();
      };
    }

    if (searchInp && !searchInp._wired) {
      searchInp._wired = true;
      searchInp.oninput = (e) => {
        renderSafarsPageCards(e.target.value);
      };
    }

    const q = (filterText || (searchInp ? searchInp.value : '')).toLowerCase().trim();
    const list = (state.safars || []).filter(s => {
      if (!q) return true;
      return (s.name || '').toLowerCase().includes(q) || (s.path || '').toLowerCase().includes(q);
    });

    if (list.length === 0) {
      cardsContainer.innerHTML = `
        <div style="grid-column: 1 / -1; padding: 48px 24px; text-align: center; color: var(--text-muted); background: rgba(0,0,0,0.02); border: 1px dashed var(--border-subtle, #cbd5e1); border-radius: 14px;">
          <div style="font-size: 2.5rem; margin-bottom: 8px;">🧭</div>
          <div style="font-size: 1.15rem; font-weight: 700; color: var(--text-primary);">No Safars Found</div>
          <div style="font-size: 0.85rem; margin-top: 4px;">No matching Safar tour workspaces registered.</div>
        </div>
      `;
      return;
    }

    cardsContainer.innerHTML = list.map(s => {
      const isActive = (state.activeSafar || '').toLowerCase() === (s.name || '').toLowerCase();
      return `
        <div class="safar-grid-card ${isActive ? 'active-safar-card' : ''}" data-safar-name="${escapeHtml(s.name)}">
          <!-- Card Header -->
          <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; margin-bottom: 8px;">
            <div style="min-width: 0; flex: 1;">
              <div class="safar-card-title">${escapeHtml(s.name)}</div>
              <div style="font-size: 0.76rem; color: var(--text-muted); margin-top: 2px;">
                Created: ${s.created_at ? s.created_at.split(' ')[0] : '—'}
              </div>
            </div>
            ${s.status === 'completed' ? `
              <div style="display: flex; align-items: center; gap: 5px;">
                ${isActive ? `
                  <span class="badge-safar-active-status" title="Currently Selected Safar">
                    <span class="active-pulse-dot"></span>
                    <span>Active</span>
                  </span>
                ` : ''}
                <span class="badge-safar-completed-status" title="Safar package downloaded and synchronized">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"></polyline></svg>
                  <span>Completed</span>
                </span>
              </div>
            ` : isActive ? `
              <span class="badge-safar-active-status">
                <span class="active-pulse-dot"></span>
                <span>Active</span>
              </span>
            ` : `
              <span class="badge-safar-idle-status">Standby</span>
            `}
          </div>

          <!-- Stats Chips -->
          <div style="display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap;">
            <span class="safar-metric-chip">
              <span>📅</span>
              <strong>${s.date_count || 0}</strong>
              <span style="color: var(--text-muted);">Dates</span>
            </span>
            <span class="safar-metric-chip">
              <span>📋</span>
              <strong>${s.event_count || 0}</strong>
              <span style="color: var(--text-muted);">Events</span>
            </span>
          </div>

          <!-- Directory / Path section -->
          <div class="safar-card-path-box">
            <div style="font-size: 0.72rem; text-transform: uppercase; font-weight: 800; color: var(--text-muted); letter-spacing: 0.04em;">Root Directory</div>
            <div class="safar-path-string" title="${escapeHtml(s.path || 'No directory assigned')}">
              ${s.path ? escapeHtml(s.path) : '<span style="color: #f59e0b;">⚠️ No folder linked</span>'}
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 5px; font-size: 0.74rem; color: var(--text-muted);">
              <span>AIN_Temp Subfolder:</span>
              <span style="font-family: monospace; font-weight: 600; color: ${s.temp_path ? '#059669' : 'inherit'};">
                ${s.temp_path ? '✓ Ready' : '—'}
              </span>
            </div>
          </div>

          <!-- Card Actions -->
          <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-top: 14px; padding-top: 10px; border-top: 1px solid rgba(0,0,0,0.06);">
            ${isActive ? `
              <button type="button" class="btn-safar-card-action active-btn btn-view-active-schedule">
                ✓ Current Safar (View)
              </button>
            ` : `
              <button type="button" class="btn-safar-card-action btn-switch-safar" data-name="${escapeHtml(s.name)}">
                Switch to Safar
              </button>
            `}
            <div style="display: flex; align-items: center; gap: 4px;">
              ${(s.date_count || 0) > 0 ? `
              <button type="button" class="btn-safar-card-icon btn-download-safar-card" data-name="${escapeHtml(s.name)}" title="Download Whole Safar Sync Package (.AIN53)" style="color: #3b82f6; display: flex; align-items: center; justify-content: center; padding: 4px;">
                <img src="ICON.png" alt="AIN53" style="width: 14px; height: 14px; object-fit: contain;">
              </button>
              ` : ''}
              <button type="button" class="btn-safar-card-icon btn-folder-safar" data-name="${escapeHtml(s.name)}" data-path="${escapeHtml(s.path || '')}" title="Change Safar Directory">
                📁
              </button>
              <button type="button" class="btn-safar-card-icon btn-del-safar" data-name="${escapeHtml(s.name)}" title="Delete Safar" style="color: #ef4444;">
                🗑️
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Wire Card actions
    cardsContainer.querySelectorAll('.btn-download-safar-card').forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const sName = btn.getAttribute('data-name');
        if (sName) {
          const oldActive = state.activeSafar;
          state.activeSafar = sName;
          try {
            await downloadFullSafarAin53();
          } finally {
            state.activeSafar = oldActive;
            renderSafarsPageCards(searchInp ? searchInp.value : '');
            renderSafarBar();
          }
        }
      };
    });

    cardsContainer.querySelectorAll('.btn-view-active-schedule').forEach(btn => {
      btn.onclick = () => showEventsSchedulePage();
    });

    cardsContainer.querySelectorAll('.btn-switch-safar').forEach(btn => {
      btn.onclick = async () => {
        const sName = btn.getAttribute('data-name');
        if (!sName) return;
        state.activeSafar = sName;
        localStorage.setItem('ain53_active_safar', sName);
        renderSafarBar();
        try {
          await callApi('events_set_active_safar', sName);
        } catch (e) {}
        try {
          const cRes = await callApi('events_get_contributors', sName);
          if (cRes && cRes.contributors) state.contributors = cRes.contributors;
        } catch (e) {}
        showEventsSchedulePage();
        window.showToast(`Switched active Safar to "${sName}"`, 'success');
      };
    });

    cardsContainer.querySelectorAll('.btn-folder-safar').forEach(btn => {
      btn.onclick = async () => {
        const sName = btn.getAttribute('data-name');
        try {
          const res = await callApi('events_select_export_dir');
          if (res && res.path) {
            await callApi('events_update_safar_path', sName, res.path);
            const cur = (state.safars || []).find(s => (s.name || '').toLowerCase() === sName.toLowerCase());
            if (cur) {
              cur.path = res.path;
              cur.temp_path = res.path + '\\AIN_Temp';
            }
            renderSafarsPageCards(searchInp ? searchInp.value : '');
            window.showToast(`Updated Safar folder for "${sName}"`, 'success');
          }
        } catch (err) {
          console.warn('Folder error:', err);
        }
      };
    });

    cardsContainer.querySelectorAll('.btn-del-safar').forEach(btn => {
      btn.onclick = async () => {
        const sName = btn.getAttribute('data-name');
        if (confirm(`Delete Safar "${sName}" and all its associated events?`)) {
          await callApi('events_delete_safar', sName);
          state.safars = (state.safars || []).filter(s => (s.name || '').toLowerCase() !== sName.toLowerCase());
          if ((state.activeSafar || '').toLowerCase() === sName.toLowerCase()) {
            state.activeSafar = state.safars.length > 0 ? state.safars[0].name : '';
            if (state.activeSafar) {
              localStorage.setItem('ain53_active_safar', state.activeSafar);
              await callApi('events_set_active_safar', state.activeSafar);
            } else {
              localStorage.removeItem('ain53_active_safar');
            }
            renderSafarBar();
            await loadEventsList();
          }
          renderSafarsPageCards(searchInp ? searchInp.value : '');
          window.showToast(`Deleted Safar "${sName}"`, 'info');
        }
      };
    });
  }

  // ── Open New Safar Premium Bottom Drawer ──
  function openNewSafarDrawer() {
    // Remove any existing drawer first
    const existingOverlay = document.getElementById('new-safar-drawer-overlay');
    if (existingOverlay) existingOverlay.remove();
    const existingDrawer = document.getElementById('new-safar-drawer');
    if (existingDrawer) existingDrawer.remove();

    let selectedPath = '';

    const overlayEl = document.createElement('div');
    overlayEl.id = 'new-safar-drawer-overlay';

    const drawerEl = document.createElement('div');
    drawerEl.id = 'new-safar-drawer';
    drawerEl.innerHTML = `
      <!-- Drag Handle -->
      <div class="nsd-drag-handle" id="nsd-drag-handle">
        <div class="nsd-drag-handle-pill"></div>
      </div>

      <!-- Header -->
      <div class="nsd-header">
        <div class="nsd-header-icon">🧭</div>
        <div class="nsd-header-text">
          <h2>New Safar</h2>
          <p>Create a new Safar tour workspace</p>
        </div>
        <button type="button" class="nsd-close-btn" id="nsd-close-btn" title="Close">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>

      <!-- Scrollable Body -->
      <div class="nsd-body">

        <!-- Section 1: Name of the Safar -->
        <div>
          <div class="nsd-section-label">Safar Details</div>
          <div class="nsd-field">
            <input type="text" class="nsd-field-input" id="nsd-safar-name" placeholder="Name of the Safar" autocomplete="off">
            <label class="nsd-field-label">Name of the Safar *</label>
          </div>
        </div>

        <!-- Section 2: Working Directory -->
        <div>
          <div class="nsd-section-label">Working Directory</div>
          <div class="nsd-dir-row">
            <div class="nsd-field">
              <input type="text" class="nsd-field-input" id="nsd-safar-path" placeholder="Select folder path" readonly>
              <label class="nsd-field-label">Root Folder Path</label>
            </div>
            <button type="button" class="nsd-browse-btn" id="nsd-browse-btn">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
              </svg>
              Browse
            </button>
          </div>
          <div class="nsd-dir-hint">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="8" x2="12" y2="12"></line>
              <line x1="12" y1="16" x2="12.01" y2="16"></line>
            </svg>
            A folder named after this Safar and an <code>AIN_Temp</code> subfolder will be created inside.
          </div>
        </div>

        <!-- Section 3: Live Preview -->
        <div class="nsd-preview-wrap">
          <div class="nsd-preview-label">Live Preview</div>
          <div class="nsd-preview-card">
            <div class="nsd-preview-card-icon" id="nsd-preview-icon">🧭</div>
            <div class="nsd-preview-card-info">
              <div class="nsd-preview-card-name placeholder" id="nsd-preview-name">Enter Safar name above…</div>
              <div class="nsd-preview-card-type" id="nsd-preview-type">Active Workspace</div>
            </div>
            <span class="nsd-preview-badge" id="nsd-preview-badge">🆕 New</span>
          </div>
        </div>

      </div><!-- end nsd-body -->

      <!-- Footer -->
      <div class="nsd-footer">
        <button type="button" class="nsd-btn-cancel" id="nsd-cancel-btn">Cancel</button>
        <button type="button" class="nsd-btn-create" id="nsd-create-btn">
          <span class="nsd-btn-spinner"></span>
          <span class="nsd-btn-create-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
          </span>
          Create Safar
        </button>
      </div>
    `;

    document.body.appendChild(overlayEl);
    document.body.appendChild(drawerEl);

    // ── Refs ──
    const nameInput    = drawerEl.querySelector('#nsd-safar-name');
    const pathInput    = drawerEl.querySelector('#nsd-safar-path');
    const browseBtn    = drawerEl.querySelector('#nsd-browse-btn');
    const cancelBtn    = drawerEl.querySelector('#nsd-cancel-btn');
    const createBtn    = drawerEl.querySelector('#nsd-create-btn');
    const closeBtn     = drawerEl.querySelector('#nsd-close-btn');
    const previewName  = drawerEl.querySelector('#nsd-preview-name');
    const previewType  = drawerEl.querySelector('#nsd-preview-type');

    // ── Close with animation ──
    function closeDrawer() {
      overlayEl.classList.add('closing');
      drawerEl.classList.add('closing');
      document.removeEventListener('keydown', onKeyDown);
      setTimeout(() => {
        overlayEl.remove();
        drawerEl.remove();
      }, 310);
    }

    // ── Update live preview ──
    function updatePreview() {
      const rawName = nameInput.value.trim();
      if (rawName) {
        previewName.textContent = rawName;
        previewName.classList.remove('placeholder');
      } else {
        previewName.textContent = 'Enter Safar name above…';
        previewName.classList.add('placeholder');
      }
      if (selectedPath) {
        previewType.textContent = selectedPath;
      } else {
        previewType.textContent = 'Active Workspace';
      }
    }

    // ── Wire name input → live preview ──
    nameInput.addEventListener('input', updatePreview);

    // ── Wire browse ──
    const pickPath = async () => {
      try {
        const res = await callApi('events_select_export_dir');
        if (res && res.path) {
          selectedPath = res.path;
          pathInput.value = res.path;
          updatePreview();
        }
      } catch (err) {
        console.warn('Folder select error:', err);
      }
    };
    browseBtn.addEventListener('click', pickPath);
    pathInput.addEventListener('click', pickPath);

    // ── Wire close / cancel ──
    closeBtn.addEventListener('click', closeDrawer);
    cancelBtn.addEventListener('click', closeDrawer);
    overlayEl.addEventListener('click', closeDrawer);

    // ── Esc key ──
    const onKeyDown = (e) => {
      if (e.key === 'Escape') closeDrawer();
    };
    document.addEventListener('keydown', onKeyDown);

    // ── Wire create ──
    createBtn.addEventListener('click', async () => {
      const name = nameInput.value.trim();
      const path = pathInput.value.trim();
      if (!name) {
        nameInput.focus();
        nameInput.style.borderColor = '#ef4444';
        nameInput.style.boxShadow = '0 0 0 3px rgba(239, 68, 68, 0.14)';
        setTimeout(() => {
          nameInput.style.borderColor = '';
          nameInput.style.boxShadow = '';
        }, 2000);
        window.showToast('Please enter a Safar name', 'warning');
        return;
      }

      createBtn.classList.add('loading');
      createBtn.disabled = true;

      closeDrawer();

      setTimeout(async () => {
        window.showToast('Creating Safar...', 'info');
        const res = await callApi('events_add_safar', name, path);
        if (res && res.success) {
          state.activeSafar = name;
          localStorage.setItem('ain53_active_safar', name);
          if (path) {
            localStorage.setItem('ain53_safar_folder_' + name, path);
          }
          window.showToast(`Safar "${name}" created and set as active!`, 'success');
          await loadMasterData();
          if (state.currentPage === 'safars-grid') {
            // Refresh the grid
            try {
              const sRes = await callApi('events_get_safars');
              if (sRes && sRes.safars) state.safars = sRes.safars;
            } catch (e) {}
            renderSafarsPageCards();
          } else {
            await loadEventsList();
          }
        } else {
          window.showToast(res?.error || 'Failed to create Safar', 'error');
        }
      }, 320);
    });

    // ── Focus name input ──
    setTimeout(() => nameInput.focus(), 80);

    // ── Initialize preview ──
    updatePreview();
  }

  // Backwards compat alias — old callers still work
  function promptCreateNewSafar() {
    openNewSafarDrawer();
  }

  function populateCityFilter() {
    const cityFilter = document.getElementById('filter-event-city');
    if (!cityFilter) return;
    const curr = cityFilter.value;
    cityFilter.innerHTML = '<option value="All">All Cities</option>';
    state.cities.forEach(c => {
      const opt = document.createElement('option');
      opt.value = String(c.id);
      opt.textContent = c.name;
      cityFilter.appendChild(opt);
    });
    cityFilter.value = curr || 'All';
    const activeLabel = document.getElementById('coordinator-active-city-label');
    if (activeLabel && state.cities.length > 0) {
      activeLabel.textContent = `${state.cities[0].name} Atraaf`;
    }
  }

  let _definitionsLoaded = false;
  async function initEventDefinitions() {
    if (_definitionsLoaded) return;
    try {
      const resp = await callApi('events_get_event_definitions');
      if (resp && resp.definitions && resp.definitions.list) {
        resp.definitions.list.forEach(item => {
          EVENT_ABR_TO_NAME[item.abr.toUpperCase()] = item.name;
          EVENT_ABR_TO_NAME[item.name.toUpperCase()] = item.name;
        });
        _definitionsLoaded = true;
      }
    } catch (e) {}
  }

  // ── Load Events List ──
  async function loadEventsList() {
    try {
      await initEventDefinitions();
      const resp = await callApi(
        'events_list_events',
        state.filterDate,
        state.filterSlot,
        state.filterCityId,
        state.activeSafar
      );

      if (resp && resp.events) {
        state.events = resp.events;
        renderEventsList();
        // Auto-select first event if none selected or if selected is deleted
        if (state.events.length > 0) {
          if (!state.selectedEventId || !state.events.some(e => e.id === state.selectedEventId)) {
            selectEvent(state.events[0].id);
          }
        } else {
          state.selectedEventId = null;
          state.activeEvent = null;
          renderWorkspaceEmpty();
        }
      } else {
        console.warn('[Events] events_list_events returned unexpected response:', resp);
        state.events = [];
        renderEventsList();
        renderWorkspaceEmpty();
      }
    } catch (e) {
      console.error('[Events] loadEventsList error:', e);
      state.events = [];
      renderEventsList();
      renderWorkspaceEmpty();
    }
  }

  // ── Select and Load Active Event Details ──
  async function selectEvent(eventId) {
    if (!eventId) return;
    state.selectedEventId = eventId;
    try {
      const resp = await callApi('events_get_event', eventId);
      if (resp && resp.event) {
        state.activeEvent = resp.event;
        // If an inline tray for this event exists and is open, refresh its content
        const wrapper = document.querySelector(`.subevent-item-wrapper[data-sub-id="${eventId}"]`);
        if (wrapper && wrapper.classList.contains('is-open')) {
          const tray = wrapper.querySelector(`#subevent-tray-${eventId}`);
          if (tray) {
            const engine = getEventEngine(state.activeEvent.type);
            const engineContent = tray.querySelector('#engine-view-content');
            if (engineContent) {
              if (engine === 'standard') engineContent.innerHTML = renderStandardEngineHtml(state.activeEvent);
              else if (engine === 'qmz') engineContent.innerHTML = renderQMZEngineHtml(state.activeEvent);
              else if (engine === 'bethak') engineContent.innerHTML = renderBethakEngineHtml(state.activeEvent);
              bindWorkspaceEvents(state.activeEvent, engine, tray);
            }
          }
        }
      }
    } catch (err) {
      console.warn('[Events] selectEvent error:', err);
    }
  }

  // ── Helper: Debounce utility ──
  function debounce(fn, delay) {
    let timer = null;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  // ── Density switcher state & initialization ──
  function initDensitySwitcher() {
    const switcher = document.getElementById('events-density-switcher');
    const container = document.getElementById('events-accordion-container');
    const savedDensity = localStorage.getItem('ain53_events_density') || 'cozy';

    if (container) {
      container.setAttribute('data-density', savedDensity);
    }

    if (switcher) {
      const btns = switcher.querySelectorAll('.density-btn');
      btns.forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-density') === savedDensity);
        btn.addEventListener('click', () => {
          const density = btn.getAttribute('data-density');
          btns.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          if (container) container.setAttribute('data-density', density);
          localStorage.setItem('ain53_events_density', density);
        });
      });
    }
  }

  // ── Render Events Accordion List (matching Images 1, 2, 3) ──
  function renderEventsList() {
    const container = document.getElementById('events-accordion-container') || document.getElementById('events-list-container');
    const summaryStats = document.getElementById('events-summary-stats');
    if (!container) return;

    if (!state.events || state.events.length === 0) {
      const safarName = state.activeSafar || 'Current Safar';
      const activeObj = (state.safars || []).find(s => (s.name || '').toLowerCase() === (state.activeSafar || '').toLowerCase());
      const completedTag = (activeObj && activeObj.status === 'completed') ? ' <span style="display:inline-block; font-size:0.72rem; font-weight:700; color:#059669; background:rgba(16,185,129,0.12); padding:1px 7px; border-radius:999px; margin-left:6px;">✓ Completed</span>' : '';
      if (summaryStats) {
        summaryStats.innerHTML = `Safar: <strong style="color:var(--accent-green);">${escapeHtml(safarName)}</strong> · 0 events across 0 cities${completedTag}`;
      }
      // Hide download buttons on empty safar with no dates or events
      const pillDownloadBtn = document.getElementById('btn-pill-download-safar');
      if (pillDownloadBtn) pillDownloadBtn.style.display = 'none';
      const exportAin53Btn = document.getElementById('btn-export-safar-ain53');
      if (exportAin53Btn) exportAin53Btn.style.display = 'none';
      const topDownloadBtn = document.getElementById('btn-top-download-safar');
      if (topDownloadBtn) topDownloadBtn.style.display = 'none';

      container.innerHTML = `
        <div style="padding: 3rem 1rem; text-align: center; color: var(--text-muted); font-size: 0.9rem;">
          <div style="font-size: 2.2rem; margin-bottom: 0.75rem;">📅</div>
          <div style="font-weight: 700; font-size: 1.1rem; color: var(--text-primary); margin-bottom: 0.35rem;">No Events in ${escapeHtml(safarName)}</div>
          <div>Create a new event batch for this Safar or adjust your filters above.</div>
        </div>
      `;
      return;
    }

    // Show download buttons on schedule page when events exist
    const pillDownloadBtn = document.getElementById('btn-pill-download-safar');
    if (pillDownloadBtn) pillDownloadBtn.style.display = 'inline-flex';
    const exportAin53Btn = document.getElementById('btn-export-safar-ain53');
    if (exportAin53Btn && state.currentPage !== 'safars-grid') exportAin53Btn.style.display = 'inline-flex';
    const topDownloadBtn = document.getElementById('btn-top-download-safar');
    if (topDownloadBtn && state.currentPage !== 'safars-grid') topDownloadBtn.style.display = 'inline-flex';

    // 1. Group events by Date + Slot (e.g. "1448-03-07___Morning")
    const groupMap = new Map();
    const citySet = new Set();

    state.events.forEach(evt => {
      if (evt.city_name) citySet.add(evt.city_name);
      const slot = evt.event_time_slot || 'Morning';
      const key = `${evt.date || 'Unknown'}___${slot}`;
      if (!groupMap.has(key)) {
        groupMap.set(key, {
          key: key,
          date: evt.date || 'YYYY-MM-DD',
          slot: slot,
          slotCode: slot === 'Morning' ? '01M' : '02E',
          subEvents: [],
          teams: new Set(),
          isEnded: true,
          startTime: evt.start_time || '',
          endTime: evt.event_end_time || evt.report_time || '',
          hasReport: false,
          inventoryReport: null,
          statusCounts: { completed: 0, in_progress: 0, created: 0 }
        });
      }
      const g = groupMap.get(key);
      g.subEvents.push(evt);
      if (evt.report_path) g.hasReport = true;
      if (evt.inventory_report && !g.inventoryReport) g.inventoryReport = evt.inventory_report;
      if (!evt.event_ended && (evt.status || '').toUpperCase() !== 'COMPLETED') g.isEnded = false;
      if (evt.start_time && !g.startTime) g.startTime = evt.start_time;
      if ((evt.event_end_time || evt.report_time) && !g.endTime) g.endTime = evt.event_end_time || evt.report_time;

      // Status count
      const st = (evt.status || 'CREATED').toUpperCase();
      if (st === 'COMPLETED') g.statusCounts.completed++;
      else if (st === 'IN_PROGRESS' || evt.assignment_count > 0) g.statusCounts.in_progress++;
      else g.statusCounts.created++;
    });

    // Update Header stats subtitle matching video (e.g. "4 events across 1 city")
    const totalGroups = groupMap.size;
    const totalCities = citySet.size;
    if (summaryStats) {
      const activeObj = (state.safars || []).find(s => (s.name || '').toLowerCase() === (state.activeSafar || '').toLowerCase());
      const completedTag = (activeObj && activeObj.status === 'completed') ? ' <span style="display:inline-block; font-size:0.72rem; font-weight:700; color:#059669; background:rgba(16,185,129,0.12); padding:1px 7px; border-radius:999px; margin-left:6px;">✓ Completed</span>' : '';
      summaryStats.innerHTML = `${totalGroups} events across ${totalCities} ${totalCities === 1 ? 'city' : 'cities'}${completedTag}`;
    }

    // Convert map to sorted array
    const groups = Array.from(groupMap.values());
    groups.sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      return a.slot.localeCompare(b.slot);
    });

    // Determine active expanded group (only on initial undefined state)
    if (state.expandedGroupId === undefined && groups.length > 0) {
      state.expandedGroupId = groups[0].key;
    }

    container.innerHTML = '';

    groups.forEach(g => {
      // Sort sub-events by sequence number
      g.subEvents.sort((a, b) => (a.sequence_number || 0) - (b.sequence_number || 0));

      // Calculate uncovered sequences across the sub-events in this group (sec_208)
      let totalUncovered = 0;
      const uncoveredSeqs = [];
      const uncoveredItems = [];
      g.subEvents.forEach(sub => {
        let uncov = sub.uncovered_sequences || [];
        if (uncov.length > 0 && sub.qmz_teams && Array.isArray(sub.qmz_teams) && sub.qmz_teams.length > 0) {
          const coveredTeamIds = new Set(sub.qmz_teams.filter(t => t.photographer_id || t.videographer_id).map(t => t.id));
          const allTeamsCovered = sub.qmz_teams.every(t => t.photographer_id || t.videographer_id);
          if (allTeamsCovered || (sub.qmz_teams.length === 1 && coveredTeamIds.size > 0)) {
            uncov = [];
          } else {
            uncov = uncov.filter(u => !u.team_id || !coveredTeamIds.has(u.team_id));
          }
        }
        if (uncov.length > 0) {
          totalUncovered += uncov.length;
          uncov.forEach(u => {
            const sStr = String(u.sequence || sub.sequence_number || 1).padStart(2, '0');
            if (!uncoveredSeqs.includes(sStr)) uncoveredSeqs.push(sStr);
            uncoveredItems.push({
              seq: sStr,
              type: sub.type || 'QMZ',
              mauze: sub.city_name || 'Mumbai',
              abr: u.event_abr || 'Qadam',
              sticker: u.sticker_name || ''
            });
          });
        }
      });
      g.hasUncovered = totalUncovered > 0;
      g.uncoveredCount = totalUncovered;
      g.uncoveredSeqs = uncoveredSeqs;
      g.uncoveredItems = uncoveredItems;

      const isExpanded = state.expandedGroupId === g.key;
      const card = document.createElement('div');
      card.className = `event-accordion-card ${isExpanded ? 'expanded' : ''} ${g.hasUncovered ? 'has-uncovered-warning' : ''}`;
      card.setAttribute('data-group-key', g.key);

      // Submission status dot matching video legend
      let dotColor = 'gray';
      let dotTitle = 'Event Not Ended';
      if (g.isEnded) {
        if (g.statusCounts.completed === g.subEvents.length) {
          dotColor = 'green';
          dotTitle = 'All Submitted';
        } else if (g.statusCounts.completed > 0 || g.statusCounts.in_progress > 0) {
          dotColor = 'yellow';
          dotTitle = 'Partial';
        } else {
          dotColor = 'red';
          dotTitle = 'No Submission';
        }
      }

      // Timing line
      const timingStr = (g.startTime && g.endTime)
        ? `${g.startTime} - ${g.endTime}`
        : 'Timings not yet set';

      // Teams list (e.g. T1, T2)
      const teamsStr = g.teams.size > 0 ? Array.from(g.teams).join(', ') : 'T1';

      // Calculate slot group status
      const allCompleted = g.subEvents.length > 0 && g.subEvents.every(s => s.status === 'COMPLETED');
      const anyInProgress = g.subEvents.some(s => s.status === 'IN_PROGRESS');
      const groupStatus = allCompleted ? 'COMPLETED' : (anyInProgress ? 'IN_PROGRESS' : (g.subEvents[0]?.status || 'CREATED'));
      const statusLabel = groupStatus === 'COMPLETED' ? '🟢 Completed' : (groupStatus === 'IN_PROGRESS' ? '🔵 In Progress' : '🟡 Created');

      card.innerHTML = `
        <div class="accordion-card-header">
          <div class="accordion-title-wrap">
            <div class="accordion-title-top">
              <span class="legend-dot ${dotColor}" title="${dotTitle}"></span>
              <span class="accordion-event-name">${escapeHtml(g.date)} ${escapeHtml(g.slot)} ${escapeHtml(g.slotCode)}</span>
              ${g.hasUncovered ? `<span class="badge-uncovered-warning">⚠️ ${g.uncoveredCount} NO CONTRIBUTORS</span>` : ''}
              ${g.isEnded ? '<span class="accordion-badge-ended">ENDED</span>' : '<span class="accordion-badge-active">ACTIVE</span>'}
            </div>
            <div class="accordion-meta-line">
              <span>${escapeHtml(timingStr)}</span>
              <span>•</span>
              <span>${g.subEvents.length} Sub-Event${g.subEvents.length > 1 ? 's' : ''}</span>
              ${g.hasUncovered ? `
                <span>•</span>
                <span class="uncovered-seq-alert-text">Seq ${g.uncoveredSeqs.join(', ')}</span>
              ` : `
                <span>•</span>
                <span>Teams: ${escapeHtml(teamsStr)}</span>
              `}
            </div>
          </div>
          <div class="accordion-header-right">
            <span class="slot-status-badge ${groupStatus.toLowerCase()}">${statusLabel}</span>
            <div class="accordion-chevron-wrap">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
            </div>
          </div>
        </div>

        <div class="accordion-card-body">
          <!-- ⚡ Slot-Level Actions Bar (Only visible when card is expanded) -->
          <div class="slot-expanded-hero-bar" onclick="event.stopPropagation()">
            <div class="slot-hero-left">
              <span class="slot-hero-title">Slot Status</span>
              <div class="status-select-pill-wrap">
                <select class="status-pill-select slot-status-select" data-group-key="${g.key}" title="Change status for all sub-events in this slot">
                  <option value="CREATED" ${groupStatus === 'CREATED' ? 'selected' : ''}>🟡 CREATED</option>
                  <option value="IN_PROGRESS" ${groupStatus === 'IN_PROGRESS' ? 'selected' : ''}>🔵 IN PROGRESS</option>
                  <option value="COMPLETED" ${groupStatus === 'COMPLETED' ? 'selected' : ''}>🟢 COMPLETED</option>
                </select>
              </div>
            </div>
            <div class="slot-hero-right">
              <button type="button" class="btn-subevent-pill btn-slot-import" data-group-key="${g.key}" title="Import Schedule or Sharaf Data for this slot">
                📥 Import
              </button>
              <button type="button" class="btn-subevent-pill btn-slot-export-csv" data-group-key="${g.key}" title="Export CSV for this slot">
                📄 Export CSV
              </button>
              <button type="button" class="btn-subevent-pill btn-slot-export-ain53" data-group-key="${g.key}" data-tooltip="For syncing with the website" data-tooltip-pos="left" style="color: #60a5fa; border-color: rgba(59, 130, 246, 0.35); display: inline-flex; align-items: center; gap: 4px;">
                <img src="ICON.png" alt="AIN53" style="width: 12px; height: 12px; object-fit: contain; border-radius: 2px;">
                <span>Sync</span>
              </button>
              <button type="button" class="btn-subevent-pill-danger btn-slot-delete" data-group-key="${g.key}" title="Delete entire slot event">
                🗑
              </button>
            </div>
          </div>

          <!-- 🕒 EVENT TIMING Section -->
          <div class="accordion-section-header">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"></circle>
              <polyline points="12 6 12 12 16 14"></polyline>
            </svg>
            <span>EVENT TIMING</span>
          </div>

          <div class="timing-inputs-row">
            <div class="timing-box">
              <span class="timing-label">Start Time</span>
              <div class="timing-input-container">
                <input type="text" class="timing-input-val group-start-time" placeholder="--:-- --" value="${escapeHtml(g.startTime || '')}">
                <span class="timing-clock-icon" title="Clock icon">🕒</span>
              </div>
            </div>

            <div class="timing-box">
              <span class="timing-label">End Time</span>
              <div class="timing-input-container">
                <input type="text" class="timing-input-val group-end-time" placeholder="--:-- --" value="${escapeHtml(g.endTime || '')}">
                <span class="timing-clock-icon" title="Clock icon">🕒</span>
              </div>
            </div>
          </div>

          <!-- SAFAR SHARAF'S COVERAGE Section -->
          <div class="accordion-section-header">
            <span>SAFAR SHARAF'S COVERAGE</span>
          </div>

          <div class="coverage-list">
            ${g.subEvents.map((sub, sIdx) => {
              const seqStr = String(sub.sequence_number || 1).padStart(2, '0');
              const codeStr = sub.event_code || `${g.date} _ ${g.slotCode}-${seqStr}-${sub.type}-${sub.city_name || ''}`;
              let subUncovered = sub.uncovered_sequences || [];
              if (subUncovered.length > 0 && sub.qmz_teams && Array.isArray(sub.qmz_teams) && sub.qmz_teams.length > 0) {
                const coveredTeamIds = new Set(sub.qmz_teams.filter(t => t.photographer_id || t.videographer_id).map(t => t.id));
                const allTeamsCovered = sub.qmz_teams.every(t => t.photographer_id || t.videographer_id);
                if (allTeamsCovered || (sub.qmz_teams.length === 1 && coveredTeamIds.size > 0)) {
                  subUncovered = [];
                } else {
                  subUncovered = subUncovered.filter(u => !u.team_id || !coveredTeamIds.has(u.team_id));
                }
              }
              return `
                <div class="subevent-item-wrapper" data-sub-id="${sub.id}" data-idx="${sIdx}">
                  <div class="subevent-coverage-row" data-sub-id="${sub.id}">
                    <div class="subevent-info-left">
                      <div class="subevent-reorder-group">
                        <button type="button" class="btn-sub-reorder btn-sub-up" data-sub-id="${sub.id}" data-idx="${sIdx}" title="Move Sub-Event Up" ${sIdx === 0 ? 'disabled' : ''}>
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg>
                        </button>
                        <button type="button" class="btn-sub-reorder btn-sub-down" data-sub-id="${sub.id}" data-idx="${sIdx}" title="Move Sub-Event Down" ${sIdx === g.subEvents.length - 1 ? 'disabled' : ''}>
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                        </button>
                      </div>
                      <span class="subevent-seq-badge">${seqStr}</span>
                      <span class="subevent-type-name">${escapeHtml(sub.type || 'BETHAK').toUpperCase()}</span>
                      <span class="subevent-dash">—</span>
                      <span class="subevent-city-text">${escapeHtml(sub.city_name || 'City')}</span>
                      <span class="subevent-code-pill">${escapeHtml(codeStr)}</span>
                      ${subUncovered.length > 0 ? `
                        <span class="badge-subevent-uncovered">⚠️ No contributors: seq ${subUncovered.map(u => String(u.sequence).padStart(2, '0')).join(', ')}</span>
                      ` : ''}
                    </div>

                    <div class="subevent-actions">
                      <button type="button" class="btn-subevent-edit-pill" data-sub-id="${sub.id}" title="Toggle Operations">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                        <span class="toggle-label">Edit</span>
                        <span class="toggle-chevron">▼</span>
                      </button>
                    </div>
                  </div>

                  <!-- Inline Dropdown Workstation Drawer -->
                  <div class="subevent-inline-tray" id="subevent-tray-${sub.id}" style="display: none;"></div>
                </div>
              `;
            }).join('')}
          </div>



          <!-- Event Notes & Instructions -->
          <div class="event-notes-section">
            <div class="event-notes-header">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
              <span>Event Notes &amp; Special Instructions</span>
            </div>
            <textarea class="event-notes-textarea" placeholder="Add any specific instructions, notes, or comments for this event...">${escapeHtml(g.subEvents[0]?.notes || '')}</textarea>
          </div>

          <!-- Coordinator Review Box -->
          <div class="coordinator-review-box">
            <div class="coordinator-review-title">Coordinator Review</div>
            <div class="coordinator-review-content">No coordinator review submitted yet.</div>
          </div>

          <!-- File Actions Rows -->
          <div class="event-actions-file-rows">
            <!-- Row 1: Export CSV for Folder -->
            <div class="event-file-row">
              <div class="event-file-row-left">
                <div class="file-row-badge badge-green">
                  <span class="badge-dot"></span>
                </div>
                <div class="file-row-text">
                  <div class="file-row-main-title">Export CSV for Folder</div>
                  <div class="file-row-sub-title">Export all assignments in this time slot as a CSV file ready for the folder generator.</div>
                </div>
              </div>
              <div class="event-file-row-right">
                <button type="button" class="btn-file-download btn-group-download" data-group-key="${g.key}">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                  <span>Download CSV</span>
                </button>
              </div>
            </div>

            <!-- Row 2: Export Date Sync (CSV) -->
            <div class="event-file-row">
              <div class="event-file-row-left">
                <div class="file-row-badge badge-blue">
                  <span class="badge-dot"></span>
                </div>
                <div class="file-row-text">
                  <div class="file-row-main-title">Export Date Sync (CSV)</div>
                  <div class="file-row-sub-title">Download CSV for manual sync and date synchronization with the website.</div>
                </div>
              </div>
              <div class="event-file-row-right">
                <button type="button" class="btn-file-download-sync-csv btn-group-download-sync-csv" data-group-key="${g.key}" data-tooltip="Download CSV for website manual sync / date sync" data-tooltip-pos="left">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                  <span>Date Sync (CSV)</span>
                </button>
              </div>
            </div>
          </div>

          <!-- Bottom Action Bar / Card Footer -->
          <div class="event-card-bottom-bar">
            <div class="event-card-bottom-bar-left">
              <span class="event-card-footer-badge">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
                <span>Slot Actions</span>
              </span>
              <span class="event-card-footer-meta">${escapeHtml(g.date)} • ${escapeHtml(g.slot)} ${escapeHtml(g.slotCode || '')}</span>
            </div>
            <div class="event-card-bottom-bar-right">
              <button type="button" class="btn-finalize-event-primary btn-group-finalize" data-group-key="${g.key}">
                Finalize Event Data
              </button>
              ${g.isEnded ? `
                <button type="button" class="btn-end-event-completed" disabled title="This event slot has ended.">
                  ✓ Event Ended
                </button>
              ` : `
                <button type="button" class="btn-end-event-active btn-group-end-event" data-group-key="${g.key}" title="Click to end this event and finalize slot">
                  🏁 End the Event
                </button>
              `}
            </div>
          </div>
        </div>
      `;

      // Wire Header click for Accordion toggle
      const header = card.querySelector('.accordion-card-header');
      header.addEventListener('click', () => {
        const isCurrentlyExpanded = card.classList.contains('expanded');
        if (isCurrentlyExpanded) {
          card.classList.remove('expanded');
          state.expandedGroupId = null;
        } else {
          // Close other cards in the container
          container.querySelectorAll('.event-accordion-card.expanded').forEach(c => c.classList.remove('expanded'));
          card.classList.add('expanded');
          state.expandedGroupId = g.key;
        }
      });

      // Wire Sub-Event row click to toggle inline dropdown drawer
      card.querySelectorAll('.subevent-coverage-row').forEach(row => {
        row.addEventListener('click', (e) => {
          e.stopPropagation();
          const subId = row.getAttribute('data-sub-id');
          if (subId) toggleSubEventInline(subId);
        });
      });

      // Wire Download CSV (never blocked)
      const btnDownload = card.querySelector('.btn-group-download');
      if (btnDownload) {
        btnDownload.addEventListener('click', (e) => {
          e.stopPropagation();
          downloadGroupCsv(g);
        });
      }

      // Wire Download Date Sync CSV (never blocked)
      const btnDownloadSyncCsv = card.querySelector('.btn-group-download-sync-csv');
      if (btnDownloadSyncCsv) {
        btnDownloadSyncCsv.addEventListener('click', (e) => {
          e.stopPropagation();
          downloadGroupSyncCsv(g);
        });
      }


      // ── Slot-Level Actions (Header Toolbar) ──
      const slotStatusSelect = card.querySelector('.slot-status-select');
      if (slotStatusSelect) {
        slotStatusSelect.addEventListener('click', (e) => e.stopPropagation());
        slotStatusSelect.addEventListener('change', async (e) => {
          e.stopPropagation();
          const newStatus = slotStatusSelect.value;
          for (const sub of g.subEvents) {
            sub.status = newStatus;
            try {
              await callApi('events_update_event', sub.id, { status: newStatus });
            } catch (err) {
              console.warn('Error updating subevent status:', err);
            }
          }
          window.showToast(`Updated slot status to ${newStatus}`);
          loadEventsList();
        });
      }

      const btnSlotImport = card.querySelector('.btn-slot-import');
      if (btnSlotImport) {
        btnSlotImport.addEventListener('click', async (e) => {
          e.stopPropagation();
          const bethakSub = g.subEvents.find(s => (s.type || '').toLowerCase() === 'bethak');
          const qmzSub = g.subEvents.find(s => (s.type || '').toLowerCase() === 'qmz');

          if (bethakSub && qmzSub) {
            if (window.confirmModal) {
              const choice = await window.confirmModal({
                title: 'Import for Slot',
                message: `This slot contains both <strong>Bethak</strong> and <strong>QMZ</strong>.<br>Which sub-event would you like to import data for?`,
                confirmText: 'Import Bethak (Sharaf)',
                cancelText: 'Import QMZ (Schedule)',
                type: 'primary',
                icon: 'folder'
              });
              if (choice) {
                openBethakImportSharafModal(bethakSub, card);
              } else {
                importCsvForSubEvent(qmzSub, card);
              }
            } else {
              openBethakImportSharafModal(bethakSub, card);
            }
          } else if (bethakSub) {
            openBethakImportSharafModal(bethakSub, card);
          } else if (g.subEvents.length > 0) {
            importCsvForSubEvent(g.subEvents[0], card);
          }
        });
      }

      const btnSlotExportFolders = card.querySelector('.btn-slot-export-folders');
      if (btnSlotExportFolders) {
        btnSlotExportFolders.addEventListener('click', (e) => {
          e.stopPropagation();
          const firstEvt = g.subEvents[0];
          if (firstEvt) openExportFoldersModal(firstEvt);
        });
      }

      const btnSlotExportCsv = card.querySelector('.btn-slot-export-csv');
      if (btnSlotExportCsv) {
        btnSlotExportCsv.addEventListener('click', (e) => {
          e.stopPropagation();
          downloadGroupCsv(g);
        });
      }

      const btnSlotExportAin53 = card.querySelector('.btn-slot-export-ain53');
      if (btnSlotExportAin53) {
        btnSlotExportAin53.addEventListener('click', (e) => {
          e.stopPropagation();
          downloadGroupAin53(g);
        });
      }

      const btnSlotDelete = card.querySelector('.btn-slot-delete');
      if (btnSlotDelete) {
        btnSlotDelete.addEventListener('click', async (e) => {
          e.stopPropagation();
          const titleStr = `${g.date} ${g.slot} (${g.slotCode})`;
          const confirmed = window.confirmModal ? await window.confirmModal({
            title: 'Delete Full Slot Event?',
            message: `Are you sure you want to delete the entire slot event for <strong>${escapeHtml(titleStr)}</strong>?`,
            details: `This will permanently remove ${g.subEvents.length} sub-event(s) (${g.subEvents.map(s => s.type).join(', ')}). This action cannot be undone.`,
            confirmText: 'Delete Slot',
            cancelText: 'Cancel',
            type: 'danger',
            icon: 'trash'
          }) : confirm(`Are you sure you want to delete the entire slot event for ${titleStr}?`);

          if (!confirmed) return;

          for (const sub of g.subEvents) {
            try {
              await callApi('events_delete_event', sub.id);
            } catch (err) {
              console.warn('Error deleting sub-event:', err);
            }
          }
          window.showToast(`Deleted slot event ${titleStr}`);
          loadEventsList();
        });
      }

      // Wire Export Folders Group
      const btnExportFolders = card.querySelector('.btn-group-export-folders');
      if (btnExportFolders) {
        btnExportFolders.addEventListener('click', (e) => {
          e.stopPropagation();
          const firstEvt = g.subEvents[0];
          if (firstEvt) openExportFoldersModal(firstEvt);
        });
      }

      // Wire Finalize Event Data
      const btnFinalize = card.querySelector('.btn-group-finalize');
      if (btnFinalize) {
        btnFinalize.addEventListener('click', (e) => {
          e.stopPropagation();
          finalizeGroupData(g);
        });
      }

      // Wire End the Event (strictly requires verified inventory report)
      const btnEndEvent = card.querySelector('.btn-group-end-event');
      if (btnEndEvent) {
        btnEndEvent.addEventListener('click', (e) => {
          e.stopPropagation();
          endGroupEvents(g);
        });
      }


      // Wire Event Notes change
      const notesArea = card.querySelector('.event-notes-textarea');
      if (notesArea) {
        notesArea.addEventListener('change', async () => {
          const newNotes = notesArea.value.trim();
          for (const sub of g.subEvents) {
            sub.notes = newNotes;
            try {
              await callApi('events_save_event', sub, sub.city_id);
            } catch (err) {
              console.warn('Auto-save notes error:', err);
            }
          }
          window.showToast('Notes saved');
        });
      }

      // Wire Timing Inputs
      const startTimeInput = card.querySelector('.group-start-time');
      const endTimeInput = card.querySelector('.group-end-time');
      const saveTimingDebounced = debounce(() => {
        const sTime = startTimeInput?.value.trim() || '';
        const eTime = endTimeInput?.value.trim() || '';
        g.subEvents.forEach(sub => {
          sub.start_time = sTime;
          sub.event_end_time = eTime;
          sub.report_time = eTime;
          callApi('events_save_event', sub, sub.city_id);
        });
        window.showToast('Event timings saved');
      }, 600);

      // Wire Sub-Event Reorder (Up / Down) with Smooth Slide Animation
      card.querySelectorAll('.btn-sub-reorder').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const fromIdx = parseInt(btn.getAttribute('data-idx'), 10);
          const isUp = btn.classList.contains('btn-sub-up');
          const toIdx = isUp ? fromIdx - 1 : fromIdx + 1;
          if (toIdx >= 0 && toIdx < g.subEvents.length) {
            animateAndSwapSubEvents(g, card, fromIdx, toIdx);
          }
        });
      });

      if (startTimeInput) startTimeInput.addEventListener('input', saveTimingDebounced);
      if (endTimeInput) endTimeInput.addEventListener('input', saveTimingDebounced);

      container.appendChild(card);
    });
  }

  // ── Smooth FLIP Reordering Animation for Sub-Events ──
  async function animateAndSwapSubEvents(g, card, fromIdx, toIdx) {
    const wrappers = Array.from(card.querySelectorAll('.subevent-item-wrapper'));
    const wrapA = wrappers[fromIdx];
    const wrapB = wrappers[toIdx];
    if (!wrapA || !wrapB) return;

    // Capture bounding rects
    const rectA = wrapA.getBoundingClientRect();
    const rectB = wrapB.getBoundingClientRect();
    const diffA = rectB.top - rectA.top;
    const diffB = rectA.top - rectB.top;

    wrapA.classList.add('is-animating-move', 'moved-highlight');
    wrapB.classList.add('is-animating-move');

    wrapA.offsetHeight; // force reflow

    wrapA.style.transition = 'transform 0.32s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.32s ease';
    wrapB.style.transition = 'transform 0.32s cubic-bezier(0.22, 1, 0.36, 1)';
    wrapA.style.transform = `translateY(${diffA}px)`;
    wrapB.style.transform = `translateY(${diffB}px)`;

    setTimeout(async () => {
      wrapA.style.transition = '';
      wrapB.style.transition = '';
      wrapA.style.transform = '';
      wrapB.style.transform = '';
      wrapA.classList.remove('is-animating-move');
      wrapB.classList.remove('is-animating-move');

      // Swap sequence_numbers and recompute event_codes
      const subA = g.subEvents[fromIdx];
      const subB = g.subEvents[toIdx];
      const seqA = subA.sequence_number || (fromIdx + 1);
      const seqB = subB.sequence_number || (toIdx + 1);

      subA.sequence_number = seqB;
      subB.sequence_number = seqA;

      subA.event_code = generateEventCode(subA.date, subA.event_time_slot, seqB, subA.type, subA.city_name);
      subB.event_code = generateEventCode(subB.date, subB.event_time_slot, seqA, subB.type, subB.city_name);

      await callApi('events_save_event', subA, subA.city_id);
      await callApi('events_save_event', subB, subB.city_id);

      await loadEventsList();

      // Highlight target in refreshed DOM so user sees where it landed
      setTimeout(() => {
        const movedEl = document.querySelector(`.subevent-item-wrapper[data-sub-id="${subA.id}"]`);
        if (movedEl) {
          movedEl.classList.add('moved-highlight');
          movedEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          setTimeout(() => movedEl.classList.remove('moved-highlight'), 1400);
        }
      }, 50);
    }, 320);
  }

  // ── Download Group CSV ──
  async function downloadGroupCsv(group) {
    if (!group || !group.subEvents || group.subEvents.length === 0) return;
    try {
      const firstSub = group.subEvents[0];
      const res = await callApi('events_export_csv', firstSub.id);
      if (res && res.success) {
        const escPath = (res.path || '').replace(/\\/g, '\\\\');

        // Trigger direct browser download so the file lands in the user's Downloads folder
        if (res.csv_content) {
          try {
            const blob = new Blob([res.csv_content], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = res.filename || `${group.date} _${group.slot === 'Morning' ? '01M' : '02E'}.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
          } catch (dlErr) {
            console.warn('[CSV Download] Blob trigger notice:', dlErr);
          }
        }

        window.showToast(`CSV exported (${res.total_rows} rows)`, 'success', 6000, [
          { text: '📁 Open', onClick: () => window.pywebview.api.open_in_explorer(escPath) },
          { text: '⚡ Go to CSV to Folders', primary: true, onClick: () => {
              if (window.setCsvInputPath) window.setCsvInputPath(escPath, true);
              if (window.switchNavToView) window.switchNavToView('view-csv');
          }}
        ]);
      } else if (res && res.error) {
        window.showToast(res.error, 'error');
      }
    } catch (err) {
      console.error('downloadGroupCsv error:', err);
      window.showToast('Failed to export CSV: ' + err.message, 'error');
    }
  }

  // ── Helper: Client-Side Fallback Date Sync CSV Builder ──
  function buildClientDateSyncCsv(group) {
    const lines = [];
    const esc = (v) => {
      const s = String(v ?? '').replace(/"/g, '""');
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s}"` : s;
    };
    const row = (...cols) => lines.push(cols.map(esc).join(','));

    const slotCode = (group.slot === 'Morning' || group.slot === '01M') ? '01M' : '02E';
    row('# SLOT / DATE SYNC REPORT', `${group.date} (${group.slot} - ${slotCode})`);
    row('Date', group.date);
    row('Time Slot', `${group.slot} (${slotCode})`);
    row('Total Sub-Events', group.subEvents.length);
    lines.push('');

    const contribMap = new Map();
    (state.contributors || []).forEach(c => {
      contribMap.set(c.id, c);
      contribMap.set(String(c.id), c);
    });

    group.subEvents.forEach((se, seIdx) => {
      const seSeq = se.sequence_number || (seIdx + 1);
      const seType = se.type || 'Event';
      const seCity = se.city_name || '';
      const seCode = se.event_code || `${String(seSeq).padStart(2, '0')} ${seType}`;
      const seStatus = se.status || 'CREATED';
      const seNotes = se.special_instructions || se.notes || '';
      const seLoc = se.location || '';
      const engine = getEventEngine(seType);

      const headingTitle = `${String(seSeq).padStart(2, '0')} ${seType}`;
      row('='.repeat(80));
      row(headingTitle);
      row('='.repeat(80));

      row('Event Name', headingTitle);
      row('Event Type', seType);
      row('Event Code', seCode);
      row('Date', group.date);
      row('Time Slot', `${group.slot} (${slotCode})`);
      row('City', seCity);
      if (seLoc) row('Location', seLoc);
      row('Status', seStatus);

      const indAssign = se.individual_assignment || {};
      const droneUid = indAssign.drone?.user_id;
      if (droneUid && contribMap.has(droneUid)) {
        const dc = contribMap.get(droneUid);
        row('Drone Operator', dc.series ? `${dc.name} (${dc.series})` : dc.name);
      }

      if (seNotes) row('Special Instructions / Notes', seNotes);

      if (engine === 'standard') {
        const pUid = indAssign.photographer?.user_id;
        if (pUid && contribMap.has(pUid)) {
          const pc = contribMap.get(pUid);
          row('Photographer', pc.series ? `${pc.name} (${pc.series})` : pc.name);
          if (indAssign.photographer?.location) row('Photographer Location', indAssign.photographer.location);
        }
        const vUid = indAssign.videographer?.user_id;
        if (vUid && contribMap.has(vUid)) {
          const vc = contribMap.get(vUid);
          row('Videographer', vc.series ? `${vc.name} (${vc.series})` : vc.name);
          if (indAssign.videographer?.location) row('Videographer Location', indAssign.videographer.location);
        }
        const rec = se.recording_details || {};
        if (rec.fixed_cameras_count) row('Fixed Cameras', rec.fixed_cameras_count);
        if (rec.external_recorder) row('External Audio Recorder', rec.external_recorder);
        if (rec.audio_operator) row('Audio Operator', rec.audio_operator);

        const multi = se.individual_multi_assignments || [];
        if (multi.length > 0) {
          lines.push('');
          row('# ADDITIONAL CREW ASSIGNMENTS');
          row('Role', 'Crew Name', 'Series', 'Location');
          multi.forEach(m => {
            const mc = contribMap.get(m.user_id);
            row((m.role || 'Crew').toUpperCase(), mc?.name || '', mc?.series || '', m.location || '');
          });
        }

        const assignments = se.city_event_assignments || [];
        if (assignments.length > 0) {
          lines.push('');
          row('# INLINE CEREMONY SEGMENTS');
          row('Seq', 'Event / Type', 'Host Name', 'Phone', 'ITS', 'Address', 'Photographer', 'Videographer');
          assignments.forEach(a => {
            const ap = contribMap.get(a.photographer_id)?.name || '';
            const av = contribMap.get(a.videographer_id)?.name || '';
            row(a.sequence || '', a.event_abr || 'Nikah', a.name || '', a.mobile || '', a.its || '', a.location || '', ap, av);
          });
        }
      } else if (engine === 'qmz') {
        const teams = se.qmz_teams || [];
        if (teams.length > 0) {
          row('Total Teams', teams.length);
          lines.push('');
          row('# TEAMS ROTATION SETUP');
          row('Team Number', 'Team Name', 'Photographer', 'Videographer');
          teams.forEach((t, tIdx) => {
            const p = contribMap.get(t.photographer_id);
            const v = contribMap.get(t.videographer_id);
            const pDisp = p ? (p.series ? `${p.name} (${p.series})` : p.name) : '';
            const vDisp = v ? (v.series ? `${v.name} (${v.series})` : v.name) : '';
            row(`Team ${tIdx + 1}`, t.name || `Team ${tIdx + 1}`, pDisp, vDisp);
          });
        }

        const assignments = se.city_event_assignments || [];
        lines.push('');
        row('# QMZ SEQUENCES');
        row('Seq', 'Event / Type', 'Sticker', 'Host Name', 'Phone', 'ITS', 'Address', 'Team', 'Photographer', 'Videographer');
        assignments.forEach(a => {
          let tName = a.team_id || '';
          const matchT = teams.find(t => t.id === tName || t.name === tName);
          if (matchT) tName = matchT.name || tName;
          const pName = a.photo_not_covered ? 'Not Covered' : (contribMap.get(a.photographer_id)?.name || '');
          const vName = a.video_not_covered ? 'Not Covered' : (contribMap.get(a.videographer_id)?.name || '');
          row(a.sequence || '', a.event_abr || 'Qadam', a.sticker_name || '', a.name || '', a.mobile || '', a.its || '', a.location || '', tName, pName, vName);
        });
      } else if (engine === 'bethak') {
        const teams = se.qmz_teams || [];
        if (teams.length > 0) {
          row('Total Teams', teams.length);
          lines.push('');
          row('# TEAMS ROTATION SETUP');
          row('Team Number', 'Team Name', 'Photographer', 'Videographer');
          teams.forEach((t, tIdx) => {
            const p = contribMap.get(t.photographer_id);
            const v = contribMap.get(t.videographer_id);
            const pDisp = p ? (p.series ? `${p.name} (${p.series})` : p.name) : '';
            const vDisp = v ? (v.series ? `${v.name} (${v.series})` : v.name) : '';
            row(`Team ${tIdx + 1}`, t.name || `Team ${tIdx + 1}`, pDisp, vDisp);
          });
        }

        const assignments = se.city_event_assignments || [];
        lines.push('');
        row('# BETHAK SEQUENCES');
        row('Seq', 'Segment / Type', 'Sticker', 'Host Name', 'Phone', 'ITS', 'Address', 'Team', 'Photographer', 'Videographer');
        assignments.forEach(a => {
          let tName = a.team_id || '';
          const matchT = teams.find(t => t.id === tName || t.name === tName);
          if (matchT) tName = matchT.name || tName;
          const pName = a.photo_not_covered ? 'Not Covered' : (contribMap.get(a.photographer_id)?.name || '');
          const vName = a.video_not_covered ? 'Not Covered' : (contribMap.get(a.videographer_id)?.name || '');
          row(a.sequence || '', a.event_abr || 'Bethak', a.sticker_name || '', a.name || '', a.mobile || '', a.its || '', a.location || '', tName, pName, vName);
        });
      }

      lines.push('');
      lines.push('');
    });

    return lines.join('\n');
  }

  // ── Download Group / Slot Date Sync CSV for Website Manual Sync ──
  async function downloadGroupSyncCsv(group) {
    if (!group || !group.subEvents || group.subEvents.length === 0) return;
    try {
      const firstSub = group.subEvents[0];
      const slotCode = (group.slot === 'Morning' || group.slot === '01M') ? '01M' : '02E';
      const syncFilename = `${group.date} _${slotCode}_Date_Sync.csv`;
      let res = null;
      try {
        res = await callApi('events_export_date_sync_csv', firstSub.id, syncFilename);
      } catch (callErr) {
        console.warn('events_export_date_sync_csv call error:', callErr);
      }

      if (res && (res.cancelled || res.canceled)) {
        return;
      }

      let csvText = res?.csv_content;
      let finalPath = res?.path;

      // Fallback to client-side builder if backend did not produce content
      if (!csvText) {
        csvText = buildClientDateSyncCsv(group);
      }

      if (csvText) {
        try {
          const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = res?.filename || syncFilename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        } catch (dlErr) {
          console.warn('[Sync CSV Download] Blob trigger notice:', dlErr);
        }
      }

      const escPath = (finalPath || '').replace(/\\/g, '\\\\');
      const actions = [];
      if (escPath && window.pywebview?.api?.open_in_explorer) {
        actions.push({ text: '📁 Open File', primary: false, onClick: () => window.pywebview.api.open_in_explorer(escPath) });
      }
      window.showToast(`✓ Date Sync CSV exported for ${group.date} (${group.subEvents.length} events). Ready for website manual sync.`, 'success', 7000, actions);
    } catch (err) {
      console.error('downloadGroupSyncCsv error:', err);
      window.showToast('Failed to export Date Sync CSV: ' + err.message, 'error');
    }
  }

  // ── Helper: Client-Side Fallback AIN53 Package Builder ──
  async function buildClientAin53Package(safarName, targetDate = '', targetSlot = '') {
    const safar = safarName || state.activeSafar || 'Safar';
    const crew = (state.contributors || []).map(c => ({
      id: c.id,
      name: c.name,
      role: c.role || 'Photographer',
      series: c.series || '',
      phone: c.phone || '',
      its: c.its || '',
      active: true
    }));

    const cities = (state.cities || []).map(ci => ({
      id: ci.id,
      name: ci.name,
      teams_required: ci.teams_required || 1
    }));

    // Find matching events from state or query
    let evts = state.events || [];
    if (safar && safar !== 'All') {
      evts = evts.filter(e => !e.safar_name || e.safar_name.toLowerCase() === safar.toLowerCase());
    }
    if (targetDate) {
      evts = evts.filter(e => e.date === targetDate);
    }
    if (targetSlot) {
      evts = evts.filter(e => {
        const s = (e.event_time_slot || '').toLowerCase();
        if (targetSlot.toLowerCase().includes('morn') || targetSlot === '01M') return s.includes('morn') || s === '01m';
        return s.includes('even') || s === '02e';
      });
    }

    // Build schedule map
    const scheduleMap = {};
    let totalSequences = 0;
    let coveredSequences = 0;

    for (const evt of evts) {
      let fullEvt = evt;
      if (!Array.isArray(evt.assignments)) {
        try {
          const detailRes = await callApi('events_get_event', evt.id);
          if (detailRes && detailRes.event) {
            fullEvt = Object.assign({}, evt, detailRes.event, {
              inventory_report: evt.inventory_report || detailRes.event.inventory_report || null
            });
          }
        } catch (e) {
          console.warn('Failed to load event details for', evt.id, e);
        }
      }

      const d = fullEvt.date || 'Unknown';
      const slotCode = (fullEvt.event_time_slot || '').toLowerCase().includes('even') || fullEvt.event_time_slot === '02E' ? '02E' : '01M';
      const slotName = slotCode === '01M' ? 'Morning' : 'Evening';

      const asgns = (fullEvt.assignments || []).map(a => {
        totalSequences++;
        const isUncovered = a.photo_not_covered || a.video_not_covered || (!a.photographer_name && !a.videographer_name && !a.photographer_id && !a.videographer_id);
        if (!isUncovered) coveredSequences++;

        const photoUser = crew.find(c => c.id === a.photographer_id) || {};
        const videoUser = crew.find(c => c.id === a.videographer_id) || {};

        return {
          id: a.id,
          sequence: String(a.sequence || ''),
          event_abr: a.event_abr || '',
          sticker_name: a.sticker_name || '',
          name: a.name || '',
          its: String(a.its || ''),
          location: a.location || '',
          mobile: a.mobile || '',
          team_id: a.team_id || '',
          photographer_id: a.photographer_id,
          photographer_name: a.photographer_name || photoUser.name || '',
          photographer_series: a.photographer_series || photoUser.series || '',
          videographer_id: a.videographer_id,
          videographer_name: a.videographer_name || videoUser.name || '',
          videographer_series: a.videographer_series || videoUser.series || '',
          photo_not_covered: !!a.photo_not_covered,
          video_not_covered: !!a.video_not_covered,
          is_inline: !!a.is_inline
        };
      });

      const formattedEvt = {
        id: fullEvt.id,
        sequence_number: fullEvt.sequence_number || 1,
        event_code: fullEvt.event_code || '',
        name: fullEvt.name || fullEvt.type,
        type: fullEvt.type,
        engine: fullEvt.type === 'QMZ' ? 'QMZ' : (fullEvt.type === 'Bethak' ? 'Bethak' : 'Standard'),
        city_id: fullEvt.city_id,
        city_name: fullEvt.city_name || '',
        status: fullEvt.status || 'CREATED',
        start_time: fullEvt.start_time || '',
        report_time: fullEvt.report_time || '',
        assignment_mode: fullEvt.assignment_mode || 'individual',
        qmz_count: fullEvt.qmz_count || 1,
        qmz_teams: fullEvt.qmz_teams || [],
        bethak_counts: fullEvt.bethak_counts || [],
        individual_assignment: fullEvt.individual_assignment || {},
        recording_details: fullEvt.recording_details || {},
        notes: fullEvt.notes || '',
        event_ended: !!fullEvt.event_ended,
        event_end_time: fullEvt.event_end_time || '',
        inventory_report: fullEvt.inventory_report || null,
        assignments: asgns
      };

      if (!scheduleMap[d]) scheduleMap[d] = {};
      if (!scheduleMap[d][slotCode]) {
        scheduleMap[d][slotCode] = {
          slot_code: slotCode,
          slot_name: slotName,
          start_time: fullEvt.start_time || '',
          end_time: fullEvt.event_end_time || '',
          status: fullEvt.status || 'CREATED',
          event_ended: !!fullEvt.event_ended,
          event_end_time: fullEvt.event_end_time || '',
          inventory_report: fullEvt.inventory_report || null,
          events: []
        };
      }
      scheduleMap[d][slotCode].events.push(formattedEvt);
    }

    const scheduleList = [];
    Object.keys(scheduleMap).sort().forEach(dKey => {
      const slots = scheduleMap[dKey];
      const slotsArr = [];
      Object.keys(slots).sort().forEach(sCode => {
        const sData = slots[sCode];
        sData.events_count = sData.events.length;
        sData.sequences_count = sData.events.reduce((sum, e) => sum + (e.assignments ? e.assignments.length : 0), 0);
        const anyEnded = sData.events.some(e => e.event_ended);
        const invRep = sData.events.find(e => e.inventory_report)?.inventory_report || null;
        sData.event_ended = anyEnded;
        sData.event_end_time = sData.events.find(e => e.event_end_time)?.event_end_time || sData.end_time || '';
        sData.inventory_report = invRep;
        // Ensure all events in slot carry the inventory_report reference
        if (invRep) {
          sData.events.forEach(e => { if (!e.inventory_report) e.inventory_report = invRep; });
        }
        slotsArr.push(sData);
      });
      scheduleList.push({
        date: dKey,
        slots: slotsArr
      });
    });

    const allInventoryReports = [];
    const allInventoryFiles = {};
    scheduleList.forEach(d => {
      (d.slots || []).forEach(s => {
        if (s.inventory_report && s.inventory_report.uploaded) {
          allInventoryReports.push(s.inventory_report);
          const fn = s.inventory_report.filename || 'Inventory_Report.xlsx';
          allInventoryFiles[fn] = s.inventory_report;
        }
      });
    });

    return {
      "$schema": "https://ain53.org/schemas/safar-sync-v1.json",
      "format": "AIN53_SAFAR_SYNC_PACKAGE",
      "version": "1.0.0",
      "generator": {
        "app": "AIN53 Data Management",
        "version": "1.5.0",
        "exported_at": new Date().toISOString()
      },
      "safar": {
        "name": safar,
        "scope": (targetDate && targetSlot) ? "DATE_SLOT" : (targetDate ? "SINGLE_DAY" : "FULL_SAFAR"),
        "target_date": targetDate || null,
        "target_slot": targetSlot || null
      },
      "cities": cities,
      "crew": crew,
      "schedule": scheduleList,
      "inventory_reports": allInventoryReports,
      "inventory_files": allInventoryFiles,
      "metrics": {
        "total_days": scheduleList.length,
        "total_events": evts.length,
        "total_sequences": totalSequences,
        "total_crew": crew.length,
        "total_inventory_reports": allInventoryReports.length,
        "covered_sequences": coveredSequences,
        "uncovered_sequences": totalSequences - coveredSequences
      }
    };
  }

  // ── Download Group / Slot .AIN53 Sync Package ──
  async function downloadGroupAin53(group) {
    if (!group) return;
    try {
      const activeSafar = state.activeSafar || '';
      const dateVal = group.date;
      const slotVal = group.slot;
      let filename = `${dateVal}.AIN53`;
      let fileContent = '';
      let totalSequences = 0;
      let escPath = '';

      let res = null;
      try {
        res = await callApi('events_export_ain53', activeSafar, dateVal, slotVal);
      } catch (callErr) {
        console.warn('events_export_ain53 call error:', callErr);
      }

      if (res && (res.cancelled || res.canceled)) {
        console.log('[downloadGroupAin53] Export cancelled by user.');
        return;
      }
      if (res && res.error) {
        window.showToast(res.error, 'warning');
        return;
      }

      if (res && res.success) {
        filename = `${dateVal}.AIN53`;
        totalSequences = res.total_sequences || 0;
        escPath = (res.path || '').replace(/\\/g, '\\\\');
      } else if (!window.pywebview) {
        // Fallback: build directly from client data only in pure browser without Python
        console.log('[AIN53] Backend RPC unavailable, using browser client-side download fallback...');
        const pkg = await buildClientAin53Package(activeSafar, dateVal, slotVal);
        fileContent = JSON.stringify(pkg, null, 2);
        totalSequences = pkg.metrics.total_sequences;
        try {
          const blob = new Blob([fileContent], { type: 'application/json;charset=utf-8;' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        } catch (dlErr) {
          console.warn('[AIN53 Download] Trigger note:', dlErr);
        }
      } else {
        return;
      }

      const actions = [];
      if (escPath) {
        actions.push({ text: '📁 Open File', primary: false, onClick: () => window.pywebview.api.open_in_explorer(escPath) });
      }

      const seqText = `${totalSequences} ${totalSequences === 1 ? 'sequence' : 'sequences'}`;
      window.showToast(`Sync Package (.AIN53) downloaded (${seqText})`, 'success', 7000, actions);
    } catch (err) {
      console.error('downloadGroupAin53 error:', err);
      window.showToast('Failed to export .AIN53: ' + err.message, 'error');
    }
  }

  // ── Download Full Safar .AIN53 Sync Package ──
  async function downloadFullSafarAin53() {
    try {
      const activeSafar = state.activeSafar || '';
      if (!activeSafar) {
        window.showToast('No active Safar selected', 'warning');
        return;
      }
      const safarObj = (state.safars || []).find(s => (s.name || '').toLowerCase() === activeSafar.toLowerCase());
      if (safarObj && (safarObj.date_count || 0) === 0 && (safarObj.event_count || 0) === 0) {
        window.showToast(`Cannot download "${activeSafar}" because it is empty with no dates or events`, 'warning');
        return;
      }
      let filename = `${activeSafar}.AIN53`;
      let fileContent = '';
      let totalEvents = 0;
      let totalSequences = 0;
      let escPath = '';

      let res = null;
      try {
        res = await callApi('events_export_ain53', activeSafar, '', '');
      } catch (callErr) {
        console.warn('events_export_ain53 full call error:', callErr);
      }

      if (res && (res.cancelled || res.canceled)) {
        console.log('[downloadFullSafarAin53] Export cancelled by user.');
        return;
      }

      if (res && res.error) {
        window.showToast(res.error, 'warning');
        return;
      }

      if (res && res.success) {
        filename = `${activeSafar}.AIN53`;
        totalEvents = res.total_events || 0;
        totalSequences = res.total_sequences || 0;
        escPath = (res.path || '').replace(/\\/g, '\\\\');
      } else if (!window.pywebview) {
        // Fallback: build directly from client data only in pure browser without Python
        console.log('[AIN53] Backend RPC unavailable, using browser client-side download fallback...');
        const pkg = await buildClientAin53Package(activeSafar, '', '');
        fileContent = JSON.stringify(pkg, null, 2);
        totalEvents = pkg.metrics.total_events;
        totalSequences = pkg.metrics.total_sequences;

        if (!fileContent || (totalEvents === 0 && totalSequences === 0)) {
          window.showToast(`Cannot download "${activeSafar}" because it has no dates or events`, 'warning');
          return;
        }

        try {
          const blob = new Blob([fileContent], { type: 'application/json;charset=utf-8;' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        } catch (dlErr) {
          console.warn('[AIN53 Full Download] Trigger note:', dlErr);
        }
      } else {
        return;
      }

      // Mark Safar as completed
      try {
        await callApi('events_update_safar_status', activeSafar, 'completed');
      } catch (stErr) {
        console.warn('Could not update safar status on backend:', stErr);
      }
      if (safarObj) {
        safarObj.status = 'completed';
      }
      // Re-render safar bar and grid cards to display "Completed"
      renderSafarBar();
      if (state.currentPage === 'safars-grid') {
        const searchInp = document.getElementById('safars-page-search-input');
        renderSafarsPageCards(searchInp ? searchInp.value : '');
      }

      const actions = [];
      if (escPath) {
        actions.push({ text: '📁 Open File', primary: false, onClick: () => window.pywebview.api.open_in_explorer(escPath) });
      }

      const evText = `${totalEvents} ${totalEvents === 1 ? 'event' : 'events'}`;
      const seqText = `${totalSequences} ${totalSequences === 1 ? 'sequence' : 'sequences'}`;
      window.showToast(`Full Safar .AIN53 downloaded (${evText}, ${seqText}) — Marked Completed`, 'success', 8000, actions);
    } catch (err) {
      console.error('downloadFullSafarAin53 error:', err);
      window.showToast('Failed to export full Safar .AIN53: ' + err.message, 'error');
    }
  }

  // ── Helper: Parse CSV text into distinct parts with event types and rows ──
  function parseCsvParts(rawText) {
    if (!rawText || !rawText.trim()) return [];
    const lines = rawText.split(/\r?\n/).filter(l => l.trim().length > 0);
    if (lines.length === 0) return [];

    function parseLine(line) {
      if (line.includes('\t')) return line.split('\t').map(s => s.trim().replace(/^["']|["']$/g, ''));
      const re = /(?:^|,)(?:"([^"]*(?:""[^"]*)*)"|([^,]*))/g;
      const result = [];
      let match;
      while ((match = re.exec(line)) !== null) {
        let val = match[1] !== undefined ? match[1].replace(/""/g, '"') : match[2];
        result.push(val !== undefined ? val.trim() : '');
        if (match.index + match[0].length >= line.length) break;
      }
      return result;
    }

    const normalizeAbr = normalizeEventAbr;

    let headerIdx = -1;
    let headerMap = {};
    for (let i = 0; i < lines.length; i++) {
      const cols = parseLine(lines[i]).map(c => c.toLowerCase());
      if (cols.some(c => c.includes('seq') || c.includes('its') || c.includes('sticker') || c.includes('event'))) {
        headerIdx = i;
        cols.forEach((c, idx) => {
          if (c.includes('seq')) headerMap.seq = idx;
          else if (c.includes('event') && !c.includes('sub')) headerMap.event = idx;
          else if (c.includes('sticker')) headerMap.sticker = idx;
          else if (c.includes('name')) headerMap.name = idx;
          else if (c.includes('its')) headerMap.its = idx;
          else if (c.includes('loc') || c.includes('address')) headerMap.location = idx;
          else if (c.includes('mob') || c.includes('phone')) headerMap.mobile = idx;
          else if (c.includes('mauze') || c.includes('city')) headerMap.mauze = idx;
          else if (c.includes('sub')) headerMap.sub_event = idx;
        });
        break;
      }
    }

    if (headerIdx === -1) {
      headerIdx = 0;
      headerMap = { seq: 0, event: 1, sticker: 2, name: 3, its: 4, location: 5, mobile: 6, mauze: 7, sub_event: 8 };
    }

    const parts = [];
    let currentPart = {
      name: 'Part 1',
      event_type: null,
      rows: []
    };

    for (let i = headerIdx + 1; i < lines.length; i++) {
      const r = parseLine(lines[i]);
      if (r.length === 0 || r.every(cell => !cell)) continue;
      const first = (r[0] || '').trim();
      const firstLower = first.toLowerCase();

      if (firstLower.startsWith('part ') || firstLower === 'part') {
        if (currentPart.rows.length > 0) {
          parts.push(currentPart);
        }
        const partEvt = r[1] ? r[1].trim() : '';
        currentPart = {
          name: first,
          event_type: partEvt || null,
          rows: []
        };
        continue;
      }

      const getCell = (key) => {
        const idx = headerMap[key];
        return (idx !== undefined && idx < r.length) ? r[idx] : '';
      };

      const seqVal = getCell('seq');
      const evVal = getCell('event');
      const stkVal = getCell('sticker');
      const nameVal = getCell('name');
      const itsVal = getCell('its');
      const locVal = getCell('location');
      const mobVal = getCell('mobile');
      const mauzeVal = getCell('mauze');
      const subVal = getCell('sub_event');

      if (!seqVal && !nameVal && !itsVal) continue;

      const hasChildSeq = Boolean(seqVal && /^\d+[a-zA-Z]+$/.test(seqVal));
      const hasSubCol = Boolean(subVal && subVal.trim());
      const isSubEvent = hasSubCol || hasChildSeq;

      const targetEvRaw = (hasSubCol && !evVal) ? subVal : evVal;

      currentPart.rows.push({
        sequence: seqVal || String(currentPart.rows.length + 1),
        event_abr: normalizeAbr(targetEvRaw),
        sticker_name: stkVal || seqVal || '',
        name: nameVal || '',
        its: itsVal || '',
        location: locVal || '',
        mobile: mobVal || '',
        mauze: mauzeVal || '',
        sub_event: subVal || '',
        is_inline: isSubEvent,
        team_id: null,
        photographer_id: null,
        videographer_id: null,
        photo_not_covered: false,
        video_not_covered: false
      });
    }

    if (currentPart.rows.length > 0) {
      parts.push(currentPart);
    }

    // Resolve event types for parts
    parts.forEach(p => {
      if (!p.event_type) {
        const types = p.rows.map(row => (row.event_abr || '').toLowerCase());
        const hasQ = types.some(t => t.includes('qadam') || t === 'q');
        const hasM = types.some(t => t.includes('majlis') || t === 'm');
        const hasZ = types.some(t => t.includes('ziyafat') || t === 'z');
        if (hasQ || hasM || hasZ || types.some(t => t.includes('qmz'))) {
          p.event_type = 'QMZ';
        } else if (types.some(t => t.includes('waaz'))) {
          p.event_type = 'Waaz';
        } else if (types.some(t => t.includes('namaz'))) {
          p.event_type = 'Namaz';
        } else if (types.some(t => t.includes('bethak') || t.includes('nikah') || t.includes('misaq'))) {
          p.event_type = 'Bethak';
        } else if (types.some(t => t.includes('ziyarat'))) {
          p.event_type = 'Ziyarat';
        } else {
          p.event_type = 'QMZ';
        }
      } else {
        const et = p.event_type.toLowerCase();
        if (et.includes('waaz') || et === 'w') p.event_type = 'Waaz';
        else if (et.includes('namaz') || et === 'n') p.event_type = 'Namaz';
        else if (et.includes('bethak') || et === 'b') p.event_type = 'Bethak';
        else if (et.includes('ziyarat')) p.event_type = 'Ziyarat';
        else if (et.includes('majlis')) p.event_type = 'Majlis';
        else if (et.includes('ziyafat') || et.includes('qadam') || et.includes('qmz') || et === 'q' || et === 'z') p.event_type = 'QMZ';
        else p.event_type = 'QMZ';
      }
    });

    return parts;
  }

  // ── Helper: Parse CSV text into flat row list (legacy compatibility) ──
  function parseCsvRows(rawText) {
    const parts = parseCsvParts(rawText);
    const flat = [];
    parts.forEach(p => flat.push(...p.rows));
    return flat;
  }

  // ── Universal CSV Import Handler (backend-compatible with strict date & part isolation) ──
  async function processCsvImport(targetEventId, group, fileName, csvText) {
    const safar = state.activeSafar || (group && group.subEvents && group.subEvents[0]?.safar_name) || null;
    
    // 1. Try native backend method with full part-awareness & date isolation
    try {
      const res = await callApi('events_import_csv', targetEventId, group ? group.date : null, group ? group.slot : null, fileName, csvText, safar);
      if (res && res.success) {
        return res;
      }
      if (res && res.error && !res.error.toLowerCase().includes('not found')) {
        return res;
      }
    } catch (e) {
      // Continue to client-side fallback
    }

    // 2. Client-side parse & sync fallback with exact same single-QMZ and multi-part rules
    const parts = parseCsvParts(csvText);
    if (!parts || parts.length === 0) {
      return { error: 'Could not parse any valid sequence rows from CSV file.' };
    }

    let targetEvents = [];
    if (targetEventId) {
      const match = state.events.find(e => e.id === targetEventId);
      if (match) targetEvents.push(match);
      else targetEvents.push({ id: targetEventId });
    } else if (group && group.subEvents && group.subEvents.length > 0) {
      targetEvents = group.subEvents;
    }

    if (targetEvents.length === 0) {
      return { error: 'No sub-event found to attach CSV assignments to.' };
    }

    const isSingleQmz = (parts.length === 1 && parts[0].event_type === 'QMZ');
    let totalImported = 0;

    if (isSingleQmz) {
      // If only ONE QMZ part: data added ONLY for QMZ sub-event! Other sub-events are untouched.
      const qmzSub = targetEvents.find(s => s.type === 'QMZ');
      if (qmzSub) {
        const teams = qmzSub.qmz_teams || [];
        let mainIdx = 0;
        let lastTeam = teams[0] || null;
        const rowsWithTeams = parts[0].rows.map(r => {
          if (teams.length > 0) {
            if (!r.is_inline) {
              const t = teams[mainIdx % teams.length];
              mainIdx++;
              lastTeam = t;
              return {
                ...r,
                team_id: t.id || t.name,
                photographer_id: t.photographer_id || null,
                videographer_id: t.videographer_id || null
              };
            } else {
              const t = lastTeam || teams[0];
              return {
                ...r,
                team_id: t.id || t.name,
                photographer_id: t.photographer_id || null,
                videographer_id: t.videographer_id || null
              };
            }
          }
          return r;
        });

        await callApi('events_sync_assignments', qmzSub.id, rowsWithTeams);
        await callApi('events_update_event', qmzSub.id, { report_path: fileName, status: 'COMPLETED', qmz_count: rowsWithTeams.length });
        qmzSub.report_path = fileName;
        qmzSub.status = 'COMPLETED';
        qmzSub.qmz_count = rowsWithTeams.length;
        totalImported = rowsWithTeams.length;
      } else {
        // Fall back to first sub-event if no QMZ found
        const first = targetEvents[0];
        await callApi('events_sync_assignments', first.id, parts[0].rows);
        await callApi('events_update_event', first.id, { report_path: fileName, status: 'COMPLETED' });
        first.report_path = fileName;
        first.status = 'COMPLETED';
        totalImported = parts[0].rows.length;
      }
    } else {
      // Multi-part mode: each part is assigned strictly to its matching sub-event
      for (const p of parts) {
        const matched = targetEvents.find(s => (s.type || '').toLowerCase() === (p.event_type || '').toLowerCase());
        if (matched) {
          await callApi('events_sync_assignments', matched.id, p.rows);
          await callApi('events_update_event', matched.id, { report_path: fileName, status: 'COMPLETED' });
          matched.report_path = fileName;
          matched.status = 'COMPLETED';
          totalImported += p.rows.length;
        }
      }
    }

    return { success: true, filename: fileName, imported_count: totalImported };
  }

  // ── Upload Group Report / Import Schedule CSV ──
  async function uploadGroupReport(group) {
    if (!group) return;
    try {
      try {
        const pickRes = await callApi('events_select_import_file');
        if (pickRes && pickRes.success && pickRes.file_path) {
          window.showToast("Reading schedule file...", "info");
          const readRes = await callApi('events_read_table_as_csv', pickRes.file_path);
          if (readRes && readRes.success && readRes.csv_text) {
            window.showToast("Importing schedule assignments...", "info");
            const res = await processCsvImport(null, group, readRes.file_name, readRes.csv_text);
            if (res && res.success) {
              window.showToast(`Schedule imported! ${res.imported_count || 0} assignments loaded across sub-events.`, 'success');
              await loadEventsList();
            } else {
              window.showToast(res?.error || 'Failed to import file', 'error');
            }
          } else {
            window.showToast(readRes?.error || 'Failed to read file content', 'error');
          }
          return;
        } else if (pickRes && pickRes.cancelled) {
          return;
        }
      } catch (e) {
        console.warn('Native picker unavailable, falling back to browser input:', e);
      }

      // Fallback
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.csv, .txt, .xlsx, .xls';
      input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        if (file.path) {
          const readRes = await callApi('events_read_table_as_csv', file.path);
          if (readRes && readRes.success && readRes.csv_text) {
            const res = await processCsvImport(null, group, readRes.file_name, readRes.csv_text);
            if (res && res.success) {
              window.showToast(`Schedule imported! ${res.imported_count || 0} assignments loaded across sub-events.`, 'success');
              await loadEventsList();
              return;
            }
          }
        }

        const reader = new FileReader();
        reader.onload = async (re) => {
          const csvText = re.target.result;
          try {
            window.showToast("Importing CSV schedule data...", "info");
            const res = await processCsvImport(null, group, file.name, csvText);
            if (res && res.success) {
              window.showToast(`Schedule CSV imported! ${res.imported_count || 0} assignments loaded across sub-events.`, 'success');
              await loadEventsList();
            } else {
              window.showToast(res?.error || 'Failed to import CSV', 'error');
            }
          } catch (err) {
            console.error('CSV import API error:', err);
            window.showToast('Error importing CSV: ' + err.message, 'error');
          }
        };
        reader.onerror = () => {
          window.showToast('Could not read selected file', 'error');
        };
        reader.readAsText(file);
      };
      input.click();
    } catch (err) {
      console.error('uploadGroupReport error:', err);
      window.showToast('Failed to select file: ' + err.message, 'error');
    }
  }

  // ── Finalize Group Data ──
  async function finalizeGroupData(group) {
    if (!group) return;
    try {
      for (const sub of group.subEvents) {
        sub.finalized = true;
        await callApi('events_save_event', sub, sub.city_id);
      }
      window.showToast(`Slot data for ${group.date} ${group.slot} finalized and saved.`, 'success');
      await loadEventsList();
    } catch (err) {
      console.error('finalizeGroupData error:', err);
      window.showToast('Failed to finalize data: ' + err.message, 'error');
    }
  }


  // ── End Group Events (Slot Completion) ──
  async function endGroupEvents(group) {
    if (!group) return;

    const confirmEnd = window.confirmModal ? await window.confirmModal({
      title: 'End Event Slot?',
      message: `Are you sure you want to end event <strong>${escapeHtml(group.date || '')} ${escapeHtml(group.slot || '')}</strong>?`,
      details: `Ending this event will mark all sub-events in this slot as COMPLETED and record the event completion timestamp.`,
      confirmText: 'End Event Now',
      cancelText: 'Keep Active',
      type: 'warning',
      icon: 'flag'
    }) : window.confirm(`Are you sure you want to end event ${group.date} ${group.slot}?`);

    if (!confirmEnd) return;

    try {
      const activeSafar = state.activeSafar || (group.subEvents[0] && group.subEvents[0].safar_name) || '';
      let res = null;
      if (window.pywebview && window.pywebview.api && window.pywebview.api.events_end_event_slot) {
        res = await window.pywebview.api.events_end_event_slot(activeSafar, group.date, group.slot);
      } else {
        res = await callApi('events_end_event_slot', activeSafar, group.date, group.slot);
      }
      const data = typeof res === 'string' ? JSON.parse(res) : res;
      if (data && data.error) {
        window.showToast(data.error, 'error', 6000);
        return;
      }
      window.showToast(`✓ Event ${group.date} ${group.slot} ended! Status updated to COMPLETED.`, 'success');
      await loadEventsList();
    } catch (err) {
      console.error('endGroupEvents error:', err);
      window.showToast('Failed to end event: ' + err.message, 'error');
    }
  }

  // ── Sub-Event Operations Inline Dropdown Tray (NO POPUPS) ──
  async function toggleSubEventInline(subEventId) {
    // Ensure any stale modal backdrop is cleaned up
    document.querySelectorAll('.events-modal-backdrop#subevent-engine-modal-backdrop').forEach(m => m.remove());

    const wrapper = document.querySelector(`.subevent-item-wrapper[data-sub-id="${subEventId}"]`);
    if (!wrapper) return;
    const tray = wrapper.querySelector(`#subevent-tray-${subEventId}`);
    if (!tray) return;

    const isOpen = wrapper.classList.contains('is-open');

    if (isOpen) {
      // Flush any pending autosaves for this sub-event before clearing DOM
      const currentEvt = state.events.find(e => e.id === subEventId) || state.activeEvent;
      if (currentEvt) {
        if (currentEvt._qmzAutosaveTimer) {
          clearTimeout(currentEvt._qmzAutosaveTimer);
          currentEvt._qmzAutosaveTimer = null;
          if (typeof saveQMZStateImmediate === 'function') saveQMZStateImmediate(currentEvt, tray);
        }
        if (currentEvt._stdAutosaveTimer) {
          clearTimeout(currentEvt._stdAutosaveTimer);
          currentEvt._stdAutosaveTimer = null;
          if (typeof saveStandardStateImmediate === 'function') saveStandardStateImmediate(currentEvt, tray);
        }
        if (currentEvt._bethakState?.autosaveTimer) {
          clearTimeout(currentEvt._bethakState.autosaveTimer);
          currentEvt._bethakState.autosaveTimer = null;
          if (typeof saveBethakState === 'function') saveBethakState(currentEvt, tray);
        }
      }
      // Collapse
      wrapper.classList.remove('is-open');
      tray.style.display = 'none';
      tray.innerHTML = '';
      const chevron = wrapper.querySelector('.toggle-chevron');
      if (chevron) chevron.textContent = '▼';
      const label = wrapper.querySelector('.toggle-label');
      if (label) label.textContent = 'Edit';
      return;
    }

    // Expand
    wrapper.classList.add('is-open');
    const chevron = wrapper.querySelector('.toggle-chevron');
    if (chevron) chevron.textContent = '▲';
    const label = wrapper.querySelector('.toggle-label');
    if (label) label.textContent = 'Close Operations';

    tray.style.display = 'block';
    tray.innerHTML = `
      <div style="text-align: center; padding: 2rem; color: var(--text-secondary); font-size: 0.88rem;">
        <span>Loading event sequences...</span>
      </div>
    `;

    let evt = state.events.find(e => e.id === subEventId);
    try {
      const resp = await callApi('events_get_event', subEventId);
      if (resp && resp.event) {
        evt = resp.event;
        state.activeEvent = evt;
      }
    } catch (err) {
      console.warn('Could not fetch full event:', err);
    }

    if (!evt) {
      tray.innerHTML = '<div style="color:var(--accent-red); padding:1rem;">Could not load event data.</div>';
      return;
    }

    state.selectedEventId = subEventId;
    state.activeEvent = evt;
    const engine = getEventEngine(evt.type);
    let engineContentHtml = '';
    if (engine === 'standard') {
      engineContentHtml = renderStandardEngineHtml(evt);
    } else if (engine === 'qmz') {
      engineContentHtml = renderQMZEngineHtml(evt);
    } else if (engine === 'bethak') {
      engineContentHtml = renderBethakEngineHtml(evt);
    }

    const officialCode = evt.event_code || generateEventCode(evt.date, evt.event_time_slot || 'Morning', evt.sequence_number || 1, evt.type || 'Event', evt.city_name || '');
    const typeLower = (evt.type || 'event').toLowerCase();

    tray.innerHTML = `
      <div class="subevent-tray-inner">
        <!-- Sub-Event Hero Header & Meta Bar matching official AIN53 layout -->
        <div class="subevent-hero-banner">
          <div class="subevent-hero-top">
            <span class="subevent-type-badge-lg badge-type-${typeLower}">${escapeHtml(evt.type || 'EVENT')}</span>
            <h3 class="subevent-hero-code">${escapeHtml(officialCode)}</h3>
          </div>
          <div class="subevent-hero-bottom">
            <div class="subevent-meta-specs">
              <span><strong>Date:</strong> ${escapeHtml(evt.date || '—')}</span>
              <span class="meta-dot">•</span>
              <span><strong>Slot:</strong> ${escapeHtml(evt.event_time_slot || 'Morning')}</span>
              <span class="meta-dot">•</span>
              <span><strong>Seq:</strong> #${evt.sequence_number || 1}</span>
              <span class="meta-dot">•</span>
              <span><strong>City:</strong> ${escapeHtml(evt.city_name || '—')}</span>
            </div>
            <div class="subevent-hero-actions">
              <div class="status-select-pill-wrap">
                <select class="status-pill-select event-status-select-inline" data-event-id="${evt.id}">
                  <option value="CREATED" ${evt.status === 'CREATED' ? 'selected' : ''}>🟡 CREATED</option>
                  <option value="IN_PROGRESS" ${evt.status === 'IN_PROGRESS' ? 'selected' : ''}>🔵 IN PROGRESS</option>
                  <option value="COMPLETED" ${evt.status === 'COMPLETED' ? 'selected' : ''}>🟢 COMPLETED</option>
                </select>
              </div>

              <button type="button" class="btn-subevent-pill btn-import-subevent-csv-inline" data-event-id="${evt.id}" title="Import Schedule or Sharaf Data (.csv, .xlsx, .xls)">
                📥 Import
              </button>
              <button type="button" class="btn-subevent-pill btn-export-csv-inline" data-event-id="${evt.id}" title="Export CSV">
                📄 Export CSV
              </button>
              <button type="button" class="btn-subevent-pill-danger btn-delete-event-inline" data-event-id="${evt.id}" title="Delete Sub-Event">
                🗑
              </button>
            </div>
          </div>
        </div>

        <div id="engine-view-content" class="engine-view-content-inline">
          ${engineContentHtml}
        </div>

        <div class="event-workspace-save-bar">
          <div class="event-autosave-indicator flex align-center gap-1" style="font-size: 0.82rem; font-weight: 700; color: #10b981; margin-right: auto;">
            <span class="autosave-dot" style="width: 8px; height: 8px; border-radius: 50%; background: #10b981; display: inline-block;"></span>
            <span class="autosave-text">All changes auto-saved</span>
          </div>
          <button type="button" class="btn btn-secondary btn-collapse-tray" data-sub-id="${evt.id}">
            ▲ Collapse
          </button>
          <button type="button" class="btn btn-primary btn-emerald-action btn-save-event-changes-inline flex align-center gap-1" data-event-id="${evt.id}">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
              <polyline points="17 21 17 13 7 13 7 21"></polyline>
              <polyline points="7 3 7 8 15 8"></polyline>
            </svg>
            <span>Save Event Operations</span>
          </button>
        </div>
      </div>
    `;

    bindWorkspaceEvents(evt, engine, tray);
  }

  function openSubEventEngineModal(subEventId) {
    toggleSubEventInline(subEventId);
  }

  // ============================================================================
  // ENGINE VIEWS RENDERING
  // ============================================================================
  function renderActiveEventWorkspace() {
    const evt = state.activeEvent;
    const root = document.getElementById('event-workspace-root');
    if (!evt || !root) return;

    const engine = getEventEngine(evt.type);
    const engineClass = `badge-engine-${engine}`;
    const statusClass = `status-badge-${(evt.status || 'CREATED').toLowerCase()}`;

    let engineContentHtml = '';
    if (engine === 'standard') {
      engineContentHtml = renderStandardEngineHtml(evt);
    } else if (engine === 'qmz') {
      engineContentHtml = renderQMZEngineHtml(evt);
    } else if (engine === 'bethak') {
      engineContentHtml = renderBethakEngineHtml(evt);
    }

    root.innerHTML = `
      <div class="event-workspace-card">
        <!-- Event Header Banner -->
        <div class="event-details-header">
          <div class="event-title-meta">
            <div class="event-main-title">
              <span class="badge-engine ${engineClass}" style="font-size: 0.8rem; padding: 4px 10px;">${evt.type}</span>
              <span>${evt.name || evt.event_code}</span>
            </div>
            <div class="event-sub-meta">
              <span><strong>Code:</strong> <code>${evt.event_code}</code></span>
              <span><strong>Slot:</strong> ${evt.event_time_slot} (${evt.event_time_slot === 'Morning' ? '01M' : '02E'})</span>
              <span><strong>City:</strong> ${evt.city_name}</span>
              <span><strong>Seq:</strong> #${evt.sequence_number}</span>
              <span><strong>Date:</strong> ${evt.date}</span>
            </div>
          </div>

          <div class="event-actions-toolbar">
            <!-- Status Pill Selector -->
            <select id="event-status-select" class="input-glass" style="font-size: 0.82rem; padding: 0.4rem 0.75rem; font-weight: 700;">
              <option value="CREATED" ${evt.status === 'CREATED' ? 'selected' : ''}>🟡 CREATED</option>
              <option value="ONGOING" ${evt.status === 'ONGOING' ? 'selected' : ''}>🔵 ONGOING</option>
              <option value="COMPLETED" ${evt.status === 'COMPLETED' ? 'selected' : ''}>🟢 COMPLETED</option>
            </select>

            <button id="btn-import-subevent-csv" class="btn btn-secondary flex align-center gap-1" style="font-size: 0.82rem; padding: 0.4rem 0.85rem;" title="Import Schedule or Sharaf Data (.csv, .xlsx, .xls)">
              📥 Import
            </button>

            <button id="btn-export-csv" class="btn btn-secondary flex align-center gap-1" style="font-size: 0.82rem; padding: 0.4rem 0.85rem;" title="Export CSV for downstream processing">
              📄 Export CSV
            </button>

            <button id="btn-delete-event" class="btn btn-secondary" style="color: var(--accent-red); padding: 0.4rem 0.65rem;" title="Delete Event">
              🗑
            </button>
          </div>
        </div>

        <!-- Engine-specific interactive container -->
        <div id="engine-view-content">
          ${engineContentHtml}
        </div>

        <!-- Save Button Bar -->
        <div class="event-workspace-save-bar">
          <div class="event-autosave-indicator flex align-center gap-1" style="font-size: 0.82rem; font-weight: 700; color: #10b981; margin-right: auto;">
            <span class="autosave-dot" style="width: 8px; height: 8px; border-radius: 50%; background: #10b981; display: inline-block;"></span>
            <span class="autosave-text">All changes auto-saved</span>
          </div>
          <button id="btn-save-event-changes" class="btn btn-primary flex align-center gap-1">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
              <polyline points="17 21 17 13 7 13 7 21"></polyline>
              <polyline points="7 3 7 8 15 8"></polyline>
            </svg>
            <span>Save Event Operations</span>
          </button>
        </div>
      </div>
    `;

    bindWorkspaceEvents(evt, engine);
  }

  // ── Helper: Contributor Select Options ──
  function buildContributorOptions(selectedId, roleFilter = null, noneLabel = '— None —') {
    let html = `<option value="">${noneLabel}</option>`;
    const list = state.contributors || [];
    if (!roleFilter) {
      list.forEach(c => {
        const isSel = String(c.id) === String(selectedId) ? 'selected' : '';
        html += `<option value="${c.id}" ${isSel}>${escapeHtml(c.name)}</option>`;
      });
      return html;
    }

    const filterLower = roleFilter.toLowerCase();
    const isPhoto = filterLower.includes('photo');
    const isVideo = filterLower.includes('video');
    const isDrone = filterLower.includes('drone');

    const primaryList = [];
    const secondaryList = [];

    list.forEach(c => {
      const r = (c.role || '').toLowerCase();
      if (isPhoto && r.includes('photo')) {
        primaryList.push(c);
      } else if (isVideo && r.includes('video')) {
        primaryList.push(c);
      } else if (isDrone && r.includes('drone')) {
        primaryList.push(c);
      } else {
        secondaryList.push(c);
      }
    });

    primaryList.forEach(c => {
      const isSel = String(c.id) === String(selectedId) ? 'selected' : '';
      html += `<option value="${c.id}" ${isSel}>${escapeHtml(c.name)}</option>`;
    });

    if (secondaryList.length > 0) {
      const sepLabel = isPhoto ? 'Videographers' : (isVideo ? 'Photographers' : 'Other Contributors');
      html += `<option disabled style="color: #94a3b8; font-style: italic;">────────── ${sepLabel} ──────────</option>`;
      secondaryList.forEach(c => {
        const isSel = String(c.id) === String(selectedId) ? 'selected' : '';
        html += `<option value="${c.id}" ${isSel}>${escapeHtml(c.name)}</option>`;
      });
    }

    return html;
  }

  // ============================================================================
  // 1. STANDARD ENGINE VIEW (Spec 5.1)
  // ============================================================================
  function renderStandardEngineHtml(evt) {
    const ind = evt.individual_assignment || {};
    const photo = ind.photographer || { user_id: null, location: '' };
    const video = ind.videographer || { user_id: null, location: '' };
    const drone = ind.drone || { user_id: null, location: '' };

    const multis = evt.individual_multi_assignments || [];
    const inlines = evt.city_event_assignments || [];
    const rec = evt.recording_details || { fixed_cameras_count: 0, camera_operators: {}, external_recorder: '', audio_operator: '' };

    return `
      <div class="flex flex-col gap-3">
        <!-- Primary Contributor Selection -->
        <div class="engine-section">
          <div class="engine-section-title">
            <span>Primary Contributor Crew</span>
            <button type="button" id="btn-load-core-teams" class="btn-outline-accent" style="font-size: 0.75rem; padding: 3px 8px;">
              ⚡ Load from City Core Teams
            </button>
          </div>

          <div class="contributor-grid">
            <div class="contributor-card">
              <span class="contributor-role-tag">📷 Primary Photographer</span>
              <select id="std-photo-user" class="input-glass mt-1" style="font-size: 0.85rem;">
                ${buildContributorOptions(photo.user_id, 'Photographer')}
              </select>
              <input type="text" id="std-photo-loc" class="input-glass mt-1" placeholder="Stage / Section location" value="${photo.location || ''}">
            </div>

            <div class="contributor-card">
              <span class="contributor-role-tag">🎥 Primary Videographer</span>
              <select id="std-video-user" class="input-glass mt-1" style="font-size: 0.85rem;">
                ${buildContributorOptions(video.user_id, 'Videographer')}
              </select>
              <input type="text" id="std-video-loc" class="input-glass mt-1" placeholder="Main Camera location" value="${video.location || ''}">
            </div>

            <div class="contributor-card">
              <span class="contributor-role-tag">🚁 Drone Operator</span>
              <select id="std-drone-user" class="input-glass mt-1" style="font-size: 0.85rem;">
                ${buildContributorOptions(drone.user_id, 'Drone')}
              </select>
              <input type="text" id="std-drone-loc" class="input-glass mt-1" placeholder="Aerial zone / Rooftop" value="${drone.location || ''}">
            </div>
          </div>
        </div>

        <!-- Multi-Individual Crew Assignments -->
        <div class="engine-section">
          <div class="engine-section-title">
            <span>Additional Crew Assignments</span>
            <button type="button" id="btn-add-multi-contrib" class="btn-outline-accent" style="font-size: 0.75rem; padding: 3px 8px;">
              + Add Crew Member
            </button>
          </div>
          <div id="std-multi-list" class="flex flex-col gap-2">
            ${multis.length === 0 ? '<div class="text-muted multi-empty-placeholder" style="font-size: 0.82rem;">No additional individual crew assigned.</div>' : ''}
            ${multis.map((m, idx) => `
              <div class="multi-contrib-row" data-id="${m.id || idx}">
                <select class="input-glass multi-role-select">
                  <option value="photographer" ${m.role === 'photographer' ? 'selected' : ''}>Photographer</option>
                  <option value="videographer" ${m.role === 'videographer' ? 'selected' : ''}>Videographer</option>
                  <option value="drone" ${m.role === 'drone' ? 'selected' : ''}>Drone</option>
                </select>
                <select class="input-glass multi-user-select">
                  ${buildContributorOptions(m.user_id)}
                </select>
                <input type="text" class="input-glass multi-loc-input" placeholder="Location" value="${m.location || ''}">
                <button type="button" class="btn-part-action btn-remove-multi" style="display:flex;">✕</button>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- Waaz Camera Recording Configuration Panel -->
        <div class="engine-section">
          <div class="engine-section-title">
            <span>Waaz Recording &amp; Camera Configuration</span>
          </div>
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 0.75rem;">
            <div>
              <label style="font-size:0.75rem; font-weight:700; color:var(--text-secondary);">Fixed Cameras Count</label>
              <input type="number" id="rec-fixed-count" class="input-glass mt-1" min="0" max="10" value="${rec.fixed_cameras_count || 0}">
            </div>
            <div>
              <label style="font-size:0.75rem; font-weight:700; color:var(--text-secondary);">External Recorder Model</label>
              <input type="text" id="rec-ext-recorder" class="input-glass mt-1" placeholder="e.g. Blackmagic HyperDeck / Atomos" value="${rec.external_recorder || ''}">
            </div>
            <div>
              <label style="font-size:0.75rem; font-weight:700; color:var(--text-secondary);">Audio System Operator</label>
              <input type="text" id="rec-audio-op" class="input-glass mt-1" placeholder="Operator Name or ITS" value="${rec.audio_operator || ''}">
            </div>
          </div>
        </div>

        <!-- Inline Sub-segments (Nikah, Ziyafat during Waaz with 1a, 1b sequences) -->
        <div class="engine-section">
          <div class="engine-section-title">
            <span>Inline Ceremony Segments (e.g. 1a, 1b)</span>
            <button type="button" id="btn-add-inline-seg" class="btn-outline-accent" style="font-size: 0.75rem; padding: 3px 8px;">
              + Add Inline Segment
            </button>
          </div>
          <div class="sequence-table-container">
            <table class="table-glass-sequences" id="std-inline-table">
              <thead>
                <tr>
                  <th style="width: 60px;">Seq</th>
                  <th style="width: 110px;">Ceremony</th>
                  <th style="min-width: 160px;">Host / Mumineen Name</th>
                  <th style="width: 100px;">ITS</th>
                  <th style="min-width: 130px;">Location</th>
                  <th style="width: 110px;">Mobile</th>
                  <th style="min-width: 140px;">Photo Operator</th>
                  <th style="min-width: 140px;">Video Operator</th>
                  <th style="width: 44px; text-align: center;"></th>
                </tr>
              </thead>
              <tbody>
                ${inlines.length === 0 ? `
                  <tr class="inline-empty-placeholder">
                    <td colspan="9" style="text-align:center; color:var(--text-muted); padding: 1.5rem;">
                      No inline segments. Click "+ Add Inline Segment" if ceremonies occur during this event.
                    </td>
                  </tr>
                ` : inlines.map((row, idx) => `
                  <tr class="inline-seg-row" data-idx="${idx}">
                    <td><input type="text" class="table-input-inline inl-seq" value="${row.sequence || `1${String.fromCharCode(97 + idx)}`}"></td>
                    <td>
                      <select class="table-input-inline inl-abr">
                        <option value="Nikah" ${row.event_abr === 'Nikah' ? 'selected' : ''}>Nikah</option>
                        <option value="Misaq" ${row.event_abr === 'Misaq' ? 'selected' : ''}>Misaq</option>
                        <option value="Ziyafat" ${row.event_abr === 'Ziyafat' ? 'selected' : ''}>Ziyafat</option>
                        <option value="Majlis" ${row.event_abr === 'Majlis' ? 'selected' : ''}>Majlis</option>
                        <option value="Other" ${row.event_abr === 'Other' ? 'selected' : ''}>Other</option>
                      </select>
                    </td>
                    <td><input type="text" class="table-input-inline inl-name" placeholder="Host Name" value="${row.name || ''}"></td>
                    <td><input type="text" class="table-input-inline inl-its" placeholder="ITS" value="${row.its || ''}"></td>
                    <td><input type="text" class="table-input-inline inl-loc" placeholder="Location" value="${row.location || ''}"></td>
                    <td><input type="text" class="table-input-inline inl-mob" placeholder="Mobile" value="${row.mobile || ''}"></td>
                    <td>
                      <select class="table-input-inline inl-photo">
                        ${buildContributorOptions(row.photographer_id, 'Photographer')}
                      </select>
                    </td>
                    <td>
                      <select class="table-input-inline inl-video">
                        ${buildContributorOptions(row.videographer_id, 'Videographer')}
                      </select>
                    </td>
                    <td><button type="button" class="btn-part-action btn-remove-inline">✕</button></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  }

  // ============================================================================
  // 2. QMZ ENGINE VIEW (Spec 5.2)
  // ============================================================================
  function renderQMZEngineHtml(evt) {
    if (!evt.qmz_teams || !Array.isArray(evt.qmz_teams) || evt.qmz_teams.length === 0) {
      evt.qmz_teams = [
        { id: `team-${Date.now()}-1`, name: 'Team 1', photographer_id: null, videographer_id: null },
        { id: `team-${Date.now()}-2`, name: 'Team 2', photographer_id: null, videographer_id: null }
      ];
    }
    const teams = evt.qmz_teams;
    const rows = evt.city_event_assignments || [];
    const ind = evt.individual_assignment || {};
    const droneUserId = ind.drone?.user_id || null;

    // Locate preceding sub-event in the same date & time slot
    let prevSubEvent = null;
    if (state.events && Array.isArray(state.events)) {
      const currentSlot = evt.event_time_slot || evt.slot || '';
      const siblings = state.events.filter(e => 
        e.date === evt.date && 
        (e.event_time_slot || e.slot || '') === currentSlot
      ).sort((a, b) => (a.sequence_number || 0) - (b.sequence_number || 0));

      prevSubEvent = siblings.filter(e => (e.sequence_number || 0) < (evt.sequence_number || 0)).pop();
    }

    const prevSubTitle = prevSubEvent ? (prevSubEvent.type ? (prevSubEvent.type.charAt(0).toUpperCase() + prevSubEvent.type.slice(1).toLowerCase()) : 'Previous') : '';
    const prevSubSeq = prevSubEvent ? (prevSubEvent.sequence_number || 1) : 1;

    return `
      <div class="flex flex-col gap-3">
        ${prevSubEvent ? `
          <div class="flex justify-end" style="margin-bottom: -2px;">
            <button type="button" id="btn-copy-teams-drone" class="btn-copy-teams-drone" data-prev-id="${prevSubEvent.id}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>
              <span>Copy Teams &amp; Drone from ${escapeHtml(prevSubTitle)} (Seq ${prevSubSeq})</span>
            </button>
          </div>
        ` : ''}

        <!-- Teams Configuration Card with Drone Operator -->
        <div class="qmz-teams-section-card">
          <div class="flex justify-between align-center" style="margin-bottom: 12px;">
            <div class="flex align-center gap-2">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              <span style="font-weight: 700; font-size: 0.95rem; color: #1e293b;">Teams</span>
            </div>
            <button type="button" id="btn-add-qmz-team" class="btn-add-team-dashed">
              + Add Team
            </button>
          </div>

          <div class="qmz-teams-grid" id="qmz-team-cards-container" style="display: flex; flex-direction: column; gap: 10px;">
            ${teams.length === 0 ? `
              <div class="qmz-teams-empty-placeholder" style="padding: 1.1rem; text-align: center; border: 1px dashed #cbd5e1; border-radius: 8px; color: #64748b; font-size: 0.85rem; background: #ffffff;">
                No rotation teams configured yet. Click <strong style="color: #d97706;">+ Add Team</strong> above to configure photographers &amp; videographers for rotation.
              </div>
            ` : teams.map((t, idx) => `
              <div class="team-card team-card-row" data-team-id="${t.id || `team-${idx + 1}`}">
                <div class="flex justify-between align-center" style="margin-bottom: 8px;">
                  <div class="flex align-center gap-2">
                    <span class="team-num-badge">${idx + 1}</span>
                    <span style="font-weight: 700; font-size: 0.9rem; color: #1e293b; user-select: none;">Team ${idx + 1}</span>
                    <input type="hidden" class="qmz-team-name-input" value="Team ${idx + 1}">
                  </div>
                  ${teams.length > 1 ? `<button type="button" class="btn-remove-team-outline btn-remove-team">Remove</button>` : ''}
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px;">
                  <div>
                    <label style="display: block; font-size: 0.72rem; color: #64748b; font-weight: 700; margin-bottom: 3px;">Photographer</label>
                    <select class="form-input qmz-team-photo-select" style="width: 100%; font-size: 0.82rem; height: 34px; padding: 4px 8px; background: #ffffff; border: 1px solid #cbd5e1; border-radius: 6px;">
                      ${buildContributorOptions(t.photographer_id, 'Photographer')}
                    </select>
                  </div>
                  <div>
                    <label style="display: block; font-size: 0.72rem; color: #64748b; font-weight: 700; margin-bottom: 3px;">Videographer</label>
                    <select class="form-input qmz-team-video-select" style="width: 100%; font-size: 0.82rem; height: 34px; padding: 4px 8px; background: #ffffff; border: 1px solid #cbd5e1; border-radius: 6px;">
                      ${buildContributorOptions(t.videographer_id, 'Videographer')}
                    </select>
                  </div>
                </div>
              </div>
            `).join('')}
          </div>

          <!-- Drone Operator Section -->
          <div class="qmz-drone-section">
            <div class="flex align-center gap-2" style="margin-bottom: 4px;">
              <span style="font-size: 1rem;">🛸</span>
              <span style="font-weight: 700; font-size: 0.88rem; color: #1e293b;">Drone Operator</span>
            </div>
            <label style="display: block; font-size: 0.7rem; color: #64748b; font-weight: 700; margin-bottom: 3px; letter-spacing: 0.5px;">OPERATOR</label>
            <select id="qmz-drone-operator-select" class="form-input" style="width: 100%; font-size: 0.82rem; height: 34px; padding: 4px 8px; background: #ffffff; border: 1px solid #cbd5e1; border-radius: 6px;">
              ${buildContributorOptions(droneUserId, 'Drone', '— None —')}
            </select>
          </div>
        </div>

        <!-- Granular Sequences Table -->
        <div class="engine-section" style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
          <!-- Row 1: Header Bar -->
          <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 18px; border-bottom: 1px solid #f1f5f9; flex-wrap: wrap; gap: 10px;">
            <span style="font-weight: 700; font-size: 0.95rem; color: #1e293b;">QMZ Sequence Assignments</span>
            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
              <button type="button" id="btn-import-qmz-csv" class="btn-qmz-action-outline" title="Import Schedule (.csv, .xlsx, .xls)">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                <span>Import</span>
              </button>
              <button type="button" id="btn-qmz-pdf-sequential" class="btn-qmz-action-outline">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
                <span>PDF (Sequential)</span>
              </button>
              <button type="button" id="btn-qmz-team-images" class="btn-qmz-action-rose">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                <span>Team Images</span>
              </button>
              <span class="qmz-save-status" style="font-size: 0.8rem; color: #10b981; font-weight: 700; margin: 0 4px;">● All changes saved</span>
              <button type="button" id="btn-insert-inline-sharaf" class="btn-pill-emerald-solid" style="padding: 6px 14px; font-size: 0.82rem;">
                + Add additional Sharafs
              </button>
            </div>
          </div>

          <!-- Row 2: Auto Assign Bar -->
          <div class="qmz-auto-assign-bar">
            <span style="font-size: 0.82rem; font-weight: 700; color: #475569;">Auto Assign:</span>
            <select id="qmz-auto-assign-start-team" class="form-input form-input-sm" style="width: 200px; height: 32px; padding: 4px 8px; font-size: 0.8rem; border-radius: 6px; background: #ffffff; border: 1px solid #cbd5e1;">
              <option value="">— Select starting team —</option>
              ${teams.map((t, idx) => `<option value="${idx}">${t.name || `Team ${idx + 1}`}</option>`).join('')}
            </select>
            <button type="button" id="btn-qmz-auto-assign-teams" class="btn btn-outline-accent btn-sm flex align-center gap-1" style="height: 32px; font-size: 0.8rem; padding: 4px 12px; border-radius: 6px; font-weight: 600;">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/></svg>
              <span>Auto Assign Teams</span>
            </button>
          </div>

          <div class="sequence-table-container">
            <table class="table-glass-sequences" id="qmz-sequence-table">
              <thead>
                <tr>
                  <th style="width: 85px; min-width: 85px; text-align: center;"></th>
                  <th style="width: 45px; min-width: 45px; text-align: center;">#</th>
                  <th style="width: 70px; min-width: 70px; text-align: center;">Seq</th>
                  <th style="width: 140px; min-width: 140px;">Event</th>
                  <th style="width: 90px; min-width: 90px;">Sticker</th>
                  <th style="width: 200px; min-width: 200px;">Name</th>
                  <th style="width: 110px; min-width: 110px;">ITS</th>
                  <th style="width: 180px; min-width: 180px;">Location</th>
                  <th style="width: 125px; min-width: 125px;">Mobile</th>
                  <th style="width: 240px; min-width: 240px;">Assigned Team</th>
                  <th style="width: 45px; min-width: 45px; text-align: center;"></th>
                </tr>
              </thead>
              <tbody id="qmz-sequences-body">
                ${(() => {
                  if (rows.length === 0) {
                    return '<tr class="qmz-empty-placeholder"><td colspan="11" style="text-align:center; color:#64748b; font-style:italic; padding: 2.5rem 1rem;">No rows yet. Import a CSV or add rows manually.</td></tr>';
                  }
                  let renderedHtml = '';
                  let currentBannerKey = null;

                  rows.forEach((r, idx) => {
                    const isInline = Boolean(r.is_inline || (r.sequence && /^\d+[a-zA-Z]+$/.test(r.sequence)));
                    const segType = r.event_abr || 'Majmui Ziyafat';

                    if (isInline) {
                      const parentSeq = r.sequence ? r.sequence.replace(/[a-zA-Z]+$/, '') : '';
                      const bannerKey = `${parentSeq}_${segType}`;
                      const bannerId = 'banner-' + (parentSeq || idx) + '-' + segType.toLowerCase().replace(/[^a-z0-9]/g, '');

                      if (currentBannerKey !== bannerKey) {
                        currentBannerKey = bannerKey;
                        let groupCount = 0;
                        for (let j = idx; j < rows.length; j++) {
                          const nextInline = Boolean(rows[j].is_inline || (rows[j].sequence && /^\d+[a-zA-Z]+$/.test(rows[j].sequence)));
                          const nextType = rows[j].event_abr || 'Majmui Ziyafat';
                          const nextParentSeq = rows[j].sequence ? rows[j].sequence.replace(/[a-zA-Z]+$/, '') : '';
                          if (nextInline && `${nextParentSeq}_${nextType}` === bannerKey) {
                            groupCount++;
                          } else {
                            break;
                          }
                        }
                        renderedHtml += `
                          <tr class="inline-sharaf-banner-row" data-banner-id="${bannerId}" data-collapsed="false" data-segment-type="${escapeHtml(segType)}">
                            <td colspan="11">
                              <div class="inline-banner-bar">
                                <span class="inline-banner-arrow">▼</span>
                                <span class="inline-banner-text">${escapeHtml(segType.toUpperCase())} (${groupCount} TOTAL)</span>
                              </div>
                            </td>
                          </tr>
                        `;
                      }
                      renderedHtml += renderSingleQMZRowHtml(r, idx, teams, true, bannerId);
                    } else {
                      currentBannerKey = null;
                      renderedHtml += renderSingleQMZRowHtml(r, idx, teams, false, null);
                    }
                  });
                  return renderedHtml;
                })()}
              </tbody>
            </table>
          </div>
          <div class="qmz-table-footer-bar mt-2 flex justify-between align-center" style="color: var(--text-secondary); font-size: 0.8rem; padding: 0.5rem 0.25rem;">
            <span class="qmz-rows-summary">${rows.length} rows • 0 assigned</span>
          </div>
        </div>
      </div>
    `;
  }

  // ============================================================================
  // 3. BETHAK ENGINE VIEW (Spec 5.3)
  // ============================================================================
  // ============================================================================
  // 3. BETHAK ENGINE VIEW (Accordion & Stepper Architecture from Screen Recording)
  // ============================================================================
  function renderBethakEngineHtml(evt) {
    const teams = evt.qmz_teams || [];

    return `
      <div class="flex flex-col gap-4">
        <!-- Bethak Teams Configuration -->
        <div class="engine-section">
          <div class="engine-section-title">
            <span>Teams</span>
            <button type="button" id="btn-add-bethak-team" class="btn-outline-accent" style="font-size: 0.75rem; padding: 3px 8px;">
              + Add Team
            </button>
          </div>

          <div class="team-builder-list" id="bethak-team-cards-container">
            ${teams.length === 0 ? `
              <div style="grid-column: 1/-1; padding: 1.1rem; text-align: center; border: 1px dashed var(--border-glass); border-radius: var(--radius-sm); color: var(--text-secondary); font-size: 0.85rem;">
                No Bethak teams configured yet. Click <strong style="color: var(--accent-green);">+ Add Team</strong> above to set up ceremony crew.
              </div>
            ` : teams.map((t, idx) => `
              <div class="team-card" data-team-id="${t.id}">
                <div class="team-card-top" style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
                  <span class="team-card-title-text" style="font-weight: 700; font-size: 0.95rem; color: #1e293b; user-select: none;">Team ${idx + 1}</span>
                  <input type="hidden" class="table-input-inline bethak-team-name-input" value="Team ${idx + 1}">
                  ${teams.length > 1 ? `<button type="button" class="btn-part-action btn-remove-bethak-team" title="Remove Team">✕</button>` : ''}
                </div>
                <div>
                  <label style="font-size: 0.72rem; color: var(--text-secondary); font-weight: 700;">Photographer</label>
                  <select class="input-glass mt-1 bethak-team-photo-select" style="font-size: 0.82rem;">
                    ${buildContributorOptions(t.photographer_id, 'Photographer')}
                  </select>
                </div>
                <div>
                  <label style="font-size: 0.72rem; color: var(--text-secondary); font-weight: 700;">Videographer</label>
                  <select class="input-glass mt-1 bethak-team-video-select" style="font-size: 0.82rem;">
                    ${buildContributorOptions(t.videographer_id, 'Videographer')}
                  </select>
                </div>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- Segment Assignments (Accordion per Segment from Video) -->
        <div class="engine-section">
          <div class="engine-section-title flex justify-between align-center">
            <div class="flex align-center gap-2">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="8" y1="6" x2="21" y2="6"></line>
                <line x1="8" y1="12" x2="21" y2="12"></line>
                <line x1="8" y1="18" x2="21" y2="18"></line>
                <line x1="3" y1="6" x2="3.01" y2="6"></line>
                <line x1="3" y1="12" x2="3.01" y2="12"></line>
                <line x1="3" y1="18" x2="3.01" y2="18"></line>
              </svg>
              <span style="font-weight:700; font-size:1.02rem;">Segment Assignments</span>
            </div>
            <div class="flex align-center gap-2">
              <span class="bethak-badge-pill-outline" id="bethak-total-badge">Total: 0</span>
              <span class="bethak-badge-pill-solid" id="bethak-assigned-badge">Assigned: 0</span>
              <button type="button" id="btn-bethak-import-sharaf" class="btn-outline-accent" style="font-size: 0.75rem; padding: 4px 10px; font-weight: 600;">
                📥 Import Sharaf Data
              </button>
              <button type="button" id="btn-bethak-toggle-all" class="btn-outline-secondary" style="font-size: 0.75rem; padding: 4px 10px;">
                Expand All
              </button>
              <span class="bethak-save-status" id="bethak-save-status">✓ Saved</span>
            </div>
          </div>

          <!-- Accordion Segments List -->
          <div id="bethak-segments-list" class="flex flex-col gap-2 mt-2">
            <!-- Populated reactively by renderBethakSegmentsContainer -->
          </div>

          <!-- Add Segment Bar at Bottom -->
          <div class="flex align-center gap-2 mt-3 pt-2" style="border-top: 1px solid var(--border-glass);">
            <select id="bethak-add-seg-select" class="input-glass" style="max-width: 260px; font-weight: 700; font-size: 0.88rem;">
              ${BETHAK_SEGMENT_TYPES.map(st => `<option value="${st}">${st}</option>`).join('')}
            </select>
            <button type="button" id="btn-add-bethak-segment" class="btn-primary" style="font-weight: 700; font-size: 0.82rem; padding: 6px 14px;">
              + Add Segment
            </button>
          </div>
        </div>

        <!-- Event Notes & Special Instructions Section -->
        <div class="engine-section">
          <div class="engine-section-title">
            <div class="flex align-center gap-2">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
                <line x1="16" y1="13" x2="8" y2="13"></line>
                <line x1="16" y1="17" x2="8" y2="17"></line>
                <polyline points="10 9 9 9 8 9"></polyline>
              </svg>
              <span>Event Notes & Special Instructions</span>
            </div>
          </div>
          <textarea id="bethak-notes-input" class="input-glass mt-1" rows="3" placeholder="Add any specific instructions, notes, or comments for this Bethak..." style="width: 100%; box-sizing: border-box; font-size: 0.88rem; resize: vertical;">${escapeHtml(evt.special_instructions || evt.notes || '')}</textarea>
        </div>
      </div>
    `;
  }

  // ── Helper: Refresh inline tray or active workspace for event ──
  async function refreshEventWorkspace(evt) {
    if (!evt || !evt.id) return;
    try {
      const freshResp = await callApi('events_get_event', evt.id);
      if (freshResp && freshResp.event) {
        Object.assign(evt, freshResp.event);
        state.activeEvent = evt;
        const wrapper = document.querySelector(`.subevent-item-wrapper[data-sub-id="${evt.id}"]`);
        const tray = wrapper ? wrapper.querySelector(`#subevent-tray-${evt.id}`) : null;
        if (tray) {
          const eng = getEventEngine(evt.type);
          const engineRoot = tray.querySelector('#engine-view-content') || tray;
          if (eng === 'qmz') engineRoot.innerHTML = renderQMZEngineHtml(evt);
          else if (eng === 'standard') engineRoot.innerHTML = renderStandardEngineHtml(evt);
          else if (eng === 'bethak') engineRoot.innerHTML = renderBethakEngineHtml(evt);
          bindWorkspaceEvents(evt, eng, tray);
        }
      }
    } catch (err) {
      console.warn('Error refreshing event workspace:', err);
    }
  }

  // ── Unified Import (CSV / XLSX) for Sub-Event ──
  async function importCsvForSubEvent(evt, root = document) {
    if (!evt) return;

    // 1. If this is a Bethak event, launch the Bethak / Sharaf Import Modal directly!
    const engine = getEventEngine(evt.type);
    if (engine === 'bethak' || (evt.type || '').toLowerCase() === 'bethak') {
      openBethakImportSharafModal(evt, root);
      return;
    }

    // 2. For QMZ and Standard events: support both XLSX/XLS and CSV!
    try {
      const pickRes = await callApi('events_select_import_file');
      if (pickRes && pickRes.success && pickRes.file_path) {
        window.showToast("Reading schedule file...", "info");
        const readRes = await callApi('events_read_table_as_csv', pickRes.file_path);
        if (readRes && readRes.success && readRes.csv_text) {
          window.showToast("Importing schedule data...", "info");
          const res = await processCsvImport(evt.id, null, readRes.file_name, readRes.csv_text);
          if (res && res.success) {
            window.showToast(`Imported ${res.imported_count || 0} assignments successfully!`, "success");
            await refreshEventWorkspace(evt);
            loadEventsList();
          } else {
            window.showToast(res?.error || 'Failed to import file', 'error');
          }
        } else {
          window.showToast(readRes?.error || 'Failed to read file content', 'error');
        }
        return;
      } else if (pickRes && pickRes.cancelled) {
        return;
      }
    } catch (err) {
      console.warn('Native import picker failed, falling back to browser input:', err);
    }

    // Fallback file input element
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv, .txt, .xlsx, .xls';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const isExcel = file.name.toLowerCase().endsWith('.xlsx') || file.name.toLowerCase().endsWith('.xls');
      if (file.path) {
        try {
          window.showToast("Reading file...", "info");
          const readRes = await callApi('events_read_table_as_csv', file.path);
          if (readRes && readRes.success && readRes.csv_text) {
            const res = await processCsvImport(evt.id, null, readRes.file_name, readRes.csv_text);
            if (res && res.success) {
              window.showToast(`Imported ${res.imported_count || 0} assignments successfully!`, "success");
              await refreshEventWorkspace(evt);
              loadEventsList();
              return;
            } else {
              window.showToast(res?.error || 'Failed to import file', 'error');
              return;
            }
          }
        } catch (err) {
          console.warn('Backend read_table_as_csv error:', err);
        }
      }

      if (isExcel) {
        window.showToast('Could not access Excel file path. Please try again.', 'warning');
        return;
      }

      const reader = new FileReader();
      reader.onload = async (re) => {
        const csvText = re.target.result;
        try {
          window.showToast("Importing CSV schedule data...", "info");
          const res = await processCsvImport(evt.id, null, file.name, csvText);
          if (res && res.success) {
            window.showToast(`Imported ${res.imported_count || 0} assignments successfully!`, "success");
            await refreshEventWorkspace(evt);
            loadEventsList();
          } else {
            window.showToast(res?.error || 'Failed to import CSV', 'error');
          }
        } catch (err) {
          console.error('importCsvForSubEvent error:', err);
          window.showToast('Error importing CSV: ' + err.message, 'error');
        }
      };
      reader.onerror = () => {
        window.showToast('Could not read selected file', 'error');
      };
      reader.readAsText(file);
    };
    input.click();
  }

  // ============================================================================
  // WORKSPACE EVENT LISTENERS & SAVE LOGIC
  // ============================================================================
  function bindWorkspaceEvents(evt, engine, root = document) {
    // Status Change
    const statusSelect = root.querySelector('.event-status-select-inline') || root.querySelector('#event-status-select');
    if (statusSelect) {
      statusSelect.addEventListener('change', async () => {
        const newStatus = statusSelect.value;
        const res = await callApi('events_update_event', evt.id, { status: newStatus });
        if (res && res.success) {
          evt.status = newStatus;
          window.showToast(`Status updated to ${newStatus}`);
          const statusPill = document.querySelector(`.subevent-item-wrapper[data-sub-id="${evt.id}"] .subevent-status-pill`);
          if (statusPill) {
            statusPill.textContent = newStatus;
            statusPill.className = `subevent-status-pill badge-status-${newStatus.toLowerCase()}`;
          }
        }
      });
    }

    // Delete Event
    const btnDelete = root.querySelector('.btn-delete-event-inline') || root.querySelector('#btn-delete-event');
    if (btnDelete) {
      btnDelete.addEventListener('click', async () => {
        const confirmed = window.confirmModal ? await window.confirmModal({
          title: 'Delete Event Permanently?',
          message: `Are you sure you want to delete event <strong>"${evt.name || evt.event_code}"</strong>?`,
          details: 'All associated sequences and team assignments will be permanently removed. This action cannot be undone.',
          confirmText: 'Delete Event',
          cancelText: 'Cancel',
          type: 'danger',
          icon: 'trash'
        }) : confirm(`Are you sure you want to delete event "${evt.name || evt.event_code}"?`);

        if (!confirmed) return;
        const res = await callApi('events_delete_event', evt.id);
        if (res && res.success) {
          window.showToast('Event deleted successfully');
          state.selectedEventId = null;
          state.activeEvent = null;
          loadEventsList();
        } else {
          window.showToast(res?.error || 'Failed to delete event', 'error');
        }
      });
    }

    // Export Folders Dialog
    const btnExportFolders = root.querySelector('.btn-export-folders-dialog-inline') || root.querySelector('#btn-export-folders-dialog');
    if (btnExportFolders) {
      btnExportFolders.addEventListener('click', () => openExportFoldersModal(evt));
    }

    // Export CSV
    const btnExportCsv = root.querySelector('.btn-export-csv-inline') || root.querySelector('#btn-export-csv');
    if (btnExportCsv) {
      btnExportCsv.addEventListener('click', async () => {
        const res = await callApi('events_export_csv', evt.id);
        if (res && res.success) {
          const escPath = (res.path || '').replace(/\\/g, '\\\\');
          window.showToast(`Exported ${res.total_rows} rows to CSV!`);
          const toastEl = document.getElementById('toast');
          if (toastEl) {
            toastEl.innerHTML = `
              <div style="display:flex; align-items:center; justify-content:space-between; width:100%; gap:0.5rem; flex-wrap:wrap;">
                <span>CSV Exported: ${res.total_rows} rows</span>
                <div style="display:flex; gap:0.4rem;">
                  <button class="btn btn-select btn-sm" onclick="window.pywebview.api.open_in_explorer('${escPath}')">📁 Open</button>
                  <button class="btn btn-primary btn-sm" onclick="if(window.setCsvInputPath) window.setCsvInputPath('${escPath}', true); if(window.switchNavToView) window.switchNavToView('view-csv');">⚡ Go to CSV to Folders</button>
                </div>
              </div>
            `;
          }
        } else if (res && res.error) {
          window.showToast(res.error, 'error');
        }
      });
    }

    // Import CSV Button Bindings
    const btnImportSubCsv = root.querySelector('.btn-import-subevent-csv-inline') || root.querySelector('#btn-import-subevent-csv');
    if (btnImportSubCsv) {
      btnImportSubCsv.addEventListener('click', () => importCsvForSubEvent(evt));
    }

    const btnImportQmzCsv = root.querySelector('#btn-import-qmz-csv');
    if (btnImportQmzCsv) {
      btnImportQmzCsv.addEventListener('click', () => importCsvForSubEvent(evt));
    }

    // Collapse Tray Button
    const btnCollapse = root.querySelector('.btn-collapse-tray');
    if (btnCollapse) {
      btnCollapse.addEventListener('click', () => toggleSubEventInline(evt.id));
    }

    // Global / Inline Save Button
    const btnSave = root.querySelector('.btn-save-event-changes-inline') || root.querySelector('#btn-save-event-changes');
    if (btnSave) {
      btnSave.addEventListener('click', () => saveActiveEventChanges(evt, engine, root));
    }

    // ── Standard Engine Bindings ──
    if (engine === 'standard') {
      // Auto-save on core assignment selects & text inputs
      root.querySelectorAll('#std-photo-user, #std-video-user, #std-drone-user').forEach(el => {
        el.addEventListener('change', () => scheduleStandardAutosave(evt, root));
      });
      root.querySelectorAll('#std-photo-loc, #std-video-loc, #std-drone-loc, #rec-fixed-count, #rec-ext-recorder, #rec-audio-op').forEach(el => {
        el.addEventListener('input', () => scheduleStandardAutosave(evt, root));
      });

      const btnLoadCore = root.querySelector('#btn-load-core-teams') || document.getElementById('btn-load-core-teams');
      if (btnLoadCore) {
        btnLoadCore.addEventListener('click', () => {
          const cityTeams = evt.city_core_teams || [];
          if (cityTeams.length > 0) {
            const first = cityTeams[0];
            const pSel = root.querySelector('#std-photo-user') || document.getElementById('std-photo-user');
            const vSel = root.querySelector('#std-video-user') || document.getElementById('std-video-user');
            if (pSel && first.photographer_id) pSel.value = String(first.photographer_id);
            if (vSel && first.videographer_id) vSel.value = String(first.videographer_id);
            scheduleStandardAutosave(evt, root);
            window.showToast('Loaded contributors from City Core Team 1');
          } else {
            window.showToast('No core teams configured for this city.', 'warning');
          }
        });
      }

      // Add Multi Contributor
      const btnAddMulti = root.querySelector('#btn-add-multi-contrib') || document.getElementById('btn-add-multi-contrib');
      const multiList = root.querySelector('#std-multi-list') || document.getElementById('std-multi-list');
      if (btnAddMulti && multiList) {
        btnAddMulti.addEventListener('click', () => {
          const row = document.createElement('div');
          const emptyPlaceholder = multiList.querySelector('.multi-empty-placeholder');
          if (emptyPlaceholder) emptyPlaceholder.remove();

          row.className = 'multi-contrib-row';
          row.innerHTML = `
            <select class="input-glass multi-role-select">
              <option value="photographer">Photographer</option>
              <option value="videographer">Videographer</option>
              <option value="drone">Drone</option>
            </select>
            <select class="input-glass multi-user-select">
              ${buildContributorOptions(null)}
            </select>
            <input type="text" class="input-glass multi-loc-input" placeholder="Location">
            <button type="button" class="btn-part-action btn-remove-multi" style="display:flex;">✕</button>
          `;
          row.querySelectorAll('.multi-role-select, .multi-user-select').forEach(s => {
            s.addEventListener('change', () => scheduleStandardAutosave(evt, root));
          });
          row.querySelectorAll('.multi-loc-input').forEach(i => {
            i.addEventListener('input', () => scheduleStandardAutosave(evt, root));
          });
          row.querySelector('.btn-remove-multi').addEventListener('click', () => {
            row.remove();
            if (multiList.querySelectorAll('.multi-contrib-row').length === 0) {
              multiList.innerHTML = '<div class="text-muted multi-empty-placeholder" style="font-size: 0.82rem;">No additional individual crew assigned.</div>';
            }
            scheduleStandardAutosave(evt, root);
          });
          multiList.appendChild(row);
          scheduleStandardAutosave(evt, root);
        });
      }

      // Existing multi row listeners
      root.querySelectorAll('.multi-contrib-row').forEach(row => {
        row.querySelectorAll('.multi-role-select, .multi-user-select').forEach(s => {
          s.addEventListener('change', () => scheduleStandardAutosave(evt, root));
        });
        row.querySelectorAll('.multi-loc-input').forEach(i => {
          i.addEventListener('input', () => scheduleStandardAutosave(evt, root));
        });
      });
      root.querySelectorAll('.btn-remove-multi').forEach(b => {
        b.addEventListener('click', (e) => {
          e.target.closest('.multi-contrib-row')?.remove();
          if (multiList && multiList.querySelectorAll('.multi-contrib-row').length === 0) {
            multiList.innerHTML = '<div class="text-muted multi-empty-placeholder" style="font-size: 0.82rem;">No additional individual crew assigned.</div>';
          }
          scheduleStandardAutosave(evt, root);
        });
      });

      // Add Inline Segment
      const btnAddInline = root.querySelector('#btn-add-inline-seg') || document.getElementById('btn-add-inline-seg');
      const inlineTableBody = root.querySelector('#std-inline-table tbody') || document.querySelector('#std-inline-table tbody');
      if (btnAddInline && inlineTableBody) {
        btnAddInline.addEventListener('click', () => {
          const placeholder = inlineTableBody.querySelector('.inline-empty-placeholder');
          if (placeholder) placeholder.remove();

          const count = inlineTableBody.querySelectorAll('.inline-seg-row').length;
          const letter = String.fromCharCode(97 + (count % 26));
          const row = document.createElement('tr');
          row.className = 'inline-seg-row';
          row.innerHTML = `
            <td><input type="text" class="table-input-inline inl-seq" value="1${letter}"></td>
            <td>
              <select class="table-input-inline inl-abr">
                <option value="Nikah">Nikah</option>
                <option value="Misaq">Misaq</option>
                <option value="Ziyafat">Ziyafat</option>
                <option value="Majlis">Majlis</option>
                <option value="Other">Other</option>
              </select>
            </td>
            <td><input type="text" class="table-input-inline inl-name" placeholder="Host Name"></td>
            <td><input type="text" class="table-input-inline inl-its" placeholder="ITS"></td>
            <td><input type="text" class="table-input-inline inl-loc" placeholder="Location"></td>
            <td><input type="text" class="table-input-inline inl-mob" placeholder="Mobile"></td>
            <td>
              <select class="table-input-inline inl-photo">
                ${buildContributorOptions(null, 'Photographer')}
              </select>
            </td>
            <td>
              <select class="table-input-inline inl-video">
                ${buildContributorOptions(null, 'Videographer')}
              </select>
            </td>
            <td><button type="button" class="btn-part-action btn-remove-inline">✕</button></td>
          `;
          row.querySelectorAll('.inl-abr, .inl-photo, .inl-video').forEach(s => {
            s.addEventListener('change', () => scheduleStandardAutosave(evt, root));
          });
          row.querySelectorAll('.inl-seq, .inl-name, .inl-its, .inl-loc, .inl-mob').forEach(i => {
            i.addEventListener('input', () => scheduleStandardAutosave(evt, root));
          });
          row.querySelector('.btn-remove-inline').addEventListener('click', () => {
            row.remove();
            if (inlineTableBody.querySelectorAll('.inline-seg-row').length === 0) {
              inlineTableBody.innerHTML = `
                <tr class="inline-empty-placeholder">
                  <td colspan="9" style="text-align:center; color:var(--text-muted); padding: 1.5rem;">
                    No inline segments. Click "+ Add Inline Segment" if ceremonies occur during this event.
                  </td>
                </tr>
              `;
            }
            scheduleStandardAutosave(evt, root);
          });
          inlineTableBody.appendChild(row);
          scheduleStandardAutosave(evt, root);
        });
      }

      // Existing inline row listeners
      root.querySelectorAll('.inline-seg-row').forEach(row => {
        row.querySelectorAll('.inl-abr, .inl-photo, .inl-video').forEach(s => {
          s.addEventListener('change', () => scheduleStandardAutosave(evt, root));
        });
        row.querySelectorAll('.inl-seq, .inl-name, .inl-its, .inl-loc, .inl-mob').forEach(i => {
          i.addEventListener('input', () => scheduleStandardAutosave(evt, root));
        });
      });
      root.querySelectorAll('.btn-remove-inline').forEach(b => {
        b.addEventListener('click', (e) => {
          e.target.closest('.inline-seg-row')?.remove();
          if (inlineTableBody && inlineTableBody.querySelectorAll('.inline-seg-row').length === 0) {
            inlineTableBody.innerHTML = `
              <tr class="inline-empty-placeholder">
                <td colspan="9" style="text-align:center; color:var(--text-muted); padding: 1.5rem;">
                  No inline segments. Click "+ Add Inline Segment" if ceremonies occur during this event.
                </td>
              </tr>
            `;
          }
          scheduleStandardAutosave(evt, root);
        });
      });
    }

    // ── QMZ Engine Bindings ──
    if (engine === 'qmz') {
      // Helper to render and wire team cards
      function wireTeamCardHandlers(targetRoot, targetEvt) {
        targetRoot.querySelectorAll('.btn-remove-team').forEach(b => {
          b.onclick = (e) => {
            e.target.closest('.team-card')?.remove();
            targetRoot.querySelectorAll('#qmz-team-cards-container .team-card').forEach((c, i) => {
              const badge = c.querySelector('.team-num-badge');
              if (badge) badge.textContent = String(i + 1);
            });
            refreshQMZTeamDropdowns(targetRoot);
            refreshQMZAutoAssignDropdown(targetRoot);
            scheduleQMZAutosave(targetEvt, targetRoot);
          };
        });

        targetRoot.querySelectorAll('.qmz-team-name-input, .qmz-team-photo-select, .qmz-team-video-select').forEach(el => {
          el.onchange = () => {
            const card = el.closest('.team-card');
            const teamId = card?.getAttribute('data-team-id');
            const teamName = card?.querySelector('.qmz-team-name-input')?.value?.trim();
            const photoId = card?.querySelector('.qmz-team-photo-select')?.value;
            const videoId = card?.querySelector('.qmz-team-video-select')?.value;

            // Live-sync updated crew selection to all rows assigned to this team
            if (teamId || teamName) {
              const rows = targetRoot.querySelectorAll('#qmz-sequences-body tr.qmz-row');
              rows.forEach(r => {
                const rowTeamSel = r.querySelector('.row-team');
                const currTeamVal = rowTeamSel?.value;
                if (currTeamVal && (currTeamVal === teamId || currTeamVal === teamName)) {
                  const photoSel = r.querySelector('.row-photo');
                  const videoSel = r.querySelector('.row-video');
                  if (photoSel) photoSel.value = photoId ? String(photoId) : '';
                  if (videoSel) videoSel.value = videoId ? String(videoId) : '';
                }
              });
            }

            refreshQMZTeamDropdowns(targetRoot);
            refreshQMZAutoAssignDropdown(targetRoot);
            recheckActiveUncoveredInDom(targetRoot);
            scheduleQMZAutosave(targetEvt, targetRoot);
          };
        });
      }

      function renderQMZTeamCardsInDom(targetRoot, teamsList, targetEvt) {
        const container = targetRoot.querySelector('#qmz-team-cards-container');
        if (!container) return;
        if (!teamsList || teamsList.length === 0) {
          container.innerHTML = `
            <div class="qmz-teams-empty-placeholder" style="padding: 1.1rem; text-align: center; border: 1px dashed #cbd5e1; border-radius: 8px; color: #64748b; font-size: 0.85rem; background: #ffffff;">
              No rotation teams configured yet. Click <strong style="color: #d97706;">+ Add Team</strong> above to configure photographers &amp; videographers for rotation.
            </div>
          `;
          return;
        }

        container.innerHTML = teamsList.map((t, idx) => `
          <div class="team-card team-card-row" data-team-id="${t.id || `team-${idx + 1}`}">
            <div class="flex justify-between align-center" style="margin-bottom: 8px;">
              <div class="flex align-center gap-2">
                <span class="team-num-badge">${idx + 1}</span>
                <span style="font-weight: 700; font-size: 0.9rem; color: #1e293b; user-select: none;">Team ${idx + 1}</span>
                <input type="hidden" class="qmz-team-name-input" value="Team ${idx + 1}">
              </div>
              ${teamsList.length > 1 ? `<button type="button" class="btn-remove-team-outline btn-remove-team">Remove</button>` : ''}
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px;">
              <div>
                <label style="display: block; font-size: 0.72rem; color: #64748b; font-weight: 700; margin-bottom: 3px;">Photographer</label>
                <select class="form-input qmz-team-photo-select" style="width: 100%; font-size: 0.82rem; height: 34px; padding: 4px 8px; background: #ffffff; border: 1px solid #cbd5e1; border-radius: 6px;">
                  ${buildContributorOptions(t.photographer_id, 'Photographer')}
                </select>
              </div>
              <div>
                <label style="display: block; font-size: 0.72rem; color: #64748b; font-weight: 700; margin-bottom: 3px;">Videographer</label>
                <select class="form-input qmz-team-video-select" style="width: 100%; font-size: 0.82rem; height: 34px; padding: 4px 8px; background: #ffffff; border: 1px solid #cbd5e1; border-radius: 6px;">
                  ${buildContributorOptions(t.videographer_id, 'Videographer')}
                </select>
              </div>
            </div>
          </div>
        `).join('');

        wireTeamCardHandlers(targetRoot, targetEvt);
      }

      wireTeamCardHandlers(root, evt);

      // Copy Teams & Drone from Previous Sub-Event
      const btnCopyTeamsDrone = root.querySelector('#btn-copy-teams-drone');
      if (btnCopyTeamsDrone) {
        btnCopyTeamsDrone.addEventListener('click', async () => {
          const prevId = btnCopyTeamsDrone.getAttribute('data-prev-id');
          if (!prevId) return;

          btnCopyTeamsDrone.disabled = true;
          const originalText = btnCopyTeamsDrone.innerHTML;
          btnCopyTeamsDrone.innerHTML = '<span>Copying teams &amp; drone...</span>';

          try {
            let prevEvt = state.events.find(e => e.id === prevId);
            const res = await callApi('events_get_event', prevId);
            if (res && res.event) {
              prevEvt = res.event;
            }
            if (!prevEvt) {
              window.showToast("Could not locate previous event data", true);
              return;
            }

            // 1. Copy Teams
            let newTeams = [];
            if (prevEvt.qmz_teams && prevEvt.qmz_teams.length > 0) {
              newTeams = JSON.parse(JSON.stringify(prevEvt.qmz_teams));
            } else if (prevEvt.individual_assignment) {
              const photoId = prevEvt.individual_assignment.photographer?.user_id || null;
              const videoId = prevEvt.individual_assignment.videographer?.user_id || null;
              if (photoId || videoId) {
                newTeams.push({
                  id: `team-${Date.now()}-1`,
                  name: 'Team 1',
                  photographer_id: photoId,
                  videographer_id: videoId
                });
              }
            }

            // 2. Copy Drone
            const prevDroneId = prevEvt.individual_assignment?.drone?.user_id || prevEvt.drone_operator_id || null;
            evt.individual_assignment = evt.individual_assignment || {};
            evt.individual_assignment.drone = { user_id: prevDroneId, location: '' };

            const droneSel = root.querySelector('#qmz-drone-operator-select');
            if (droneSel) {
              droneSel.value = prevDroneId ? String(prevDroneId) : '';
            }

            if (newTeams.length > 0) {
              evt.qmz_teams = newTeams;
              renderQMZTeamCardsInDom(root, newTeams, evt);
              refreshQMZTeamDropdowns(root);
              refreshQMZAutoAssignDropdown(root);
            }

            scheduleQMZAutosave(evt, root);
            const prevTitle = prevEvt.type ? (prevEvt.type.charAt(0).toUpperCase() + prevEvt.type.slice(1).toLowerCase()) : 'Previous event';
            window.showToast(`✔ Copied teams & drone from ${prevTitle} (Seq ${prevEvt.sequence_number || 1})`);
          } catch (err) {
            console.error("Error copying teams & drone:", err);
            window.showToast("Failed to copy teams and drone", true);
          } finally {
            btnCopyTeamsDrone.disabled = false;
            btnCopyTeamsDrone.innerHTML = originalText;
          }
        });
      }

      // Add QMZ Team
      const btnAddTeam = root.querySelector('#btn-add-qmz-team');
      const teamCardsContainer = root.querySelector('#qmz-team-cards-container');
      if (btnAddTeam && teamCardsContainer) {
        btnAddTeam.addEventListener('click', () => {
          const placeholder = teamCardsContainer.querySelector('.qmz-teams-empty-placeholder');
          if (placeholder) placeholder.remove();

          const currentCount = teamCardsContainer.querySelectorAll('.team-card').length;
          const teamId = `team-${Date.now()}-${currentCount + 1}`;
          const temp = document.createElement('div');
          temp.innerHTML = `
            <div class="team-card team-card-row" data-team-id="${teamId}">
              <div class="flex justify-between align-center" style="margin-bottom: 8px;">
                <div class="flex align-center gap-2">
                  <span class="team-num-badge">${currentCount + 1}</span>
                  <span style="font-weight: 700; font-size: 0.9rem; color: #1e293b; user-select: none;">Team ${currentCount + 1}</span>
                  <input type="hidden" class="qmz-team-name-input" value="Team ${currentCount + 1}">
                </div>
                <button type="button" class="btn-remove-team-outline btn-remove-team">Remove</button>
              </div>
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px;">
                <div>
                  <label style="display: block; font-size: 0.72rem; color: #64748b; font-weight: 700; margin-bottom: 3px;">Photographer</label>
                  <select class="form-input qmz-team-photo-select" style="width: 100%; font-size: 0.82rem; height: 34px; padding: 4px 8px; background: #ffffff; border: 1px solid #cbd5e1; border-radius: 6px;">
                    ${buildContributorOptions(null, 'Photographer')}
                  </select>
                </div>
                <div>
                  <label style="display: block; font-size: 0.72rem; color: #64748b; font-weight: 700; margin-bottom: 3px;">Videographer</label>
                  <select class="form-input qmz-team-video-select" style="width: 100%; font-size: 0.82rem; height: 34px; padding: 4px 8px; background: #ffffff; border: 1px solid #cbd5e1; border-radius: 6px;">
                    ${buildContributorOptions(null, 'Videographer')}
                  </select>
                </div>
              </div>
            </div>
          `;
          const newCard = temp.firstElementChild;
          teamCardsContainer.appendChild(newCard);
          wireTeamCardHandlers(root, evt);
          refreshQMZTeamDropdowns(root);
          refreshQMZAutoAssignDropdown(root);
          scheduleQMZAutosave(evt, root);
        });
      }

      // Drone Operator change wiring
      const droneSel = root.querySelector('#qmz-drone-operator-select');
      if (droneSel) {
        droneSel.onchange = () => {
          scheduleQMZAutosave(evt, root);
        };
      }

      // Auto-Distribute Round-Robin
      const btnRebalance = root.querySelector('#btn-rebalance-qmz-teams');
      if (btnRebalance) {
        btnRebalance.addEventListener('click', () => {
          const teamCards = Array.from(root.querySelectorAll('.team-card'));
          if (teamCards.length === 0) {
            window.showToast('Please create at least one team first', 'warning');
            return;
          }
          const teamsData = teamCards.map(c => ({
            id: c.getAttribute('data-team-id'),
            name: c.querySelector('.qmz-team-name-input')?.value || 'Team',
            photographer_id: c.querySelector('.qmz-team-photo-select')?.value || null,
            videographer_id: c.querySelector('.qmz-team-video-select')?.value || null,
          }));

          const rows = root.querySelectorAll('#qmz-sequences-body tr.qmz-row');
          rows.forEach((r, idx) => {
            const team = teamsData[idx % teamsData.length];
            const teamSel = r.querySelector('.row-team');
            const photoSel = r.querySelector('.row-photo');
            const videoSel = r.querySelector('.row-video');
            if (teamSel) teamSel.value = team.id;
            if (photoSel && team.photographer_id) photoSel.value = String(team.photographer_id);
            if (videoSel && team.videographer_id) videoSel.value = String(team.videographer_id);
          });
          if (typeof recheckActiveUncoveredInDom === 'function') {
            recheckActiveUncoveredInDom(root);
          }
          scheduleQMZAutosave(evt, root);
          window.showToast(`Round-robin redistributed across ${teamsData.length} teams!`);
        });
      }

      // Wire Auto Assign Dropdown & Button
      wireQMZAutoAssign(root, evt);

      // Wire Team Images Modal Button
      const btnTeamImages = root.querySelector('#btn-qmz-team-images');
      if (btnTeamImages) {
        btnTeamImages.addEventListener('click', () => openTeamImagesModal(evt, root));
      }

      // Wire PDF (Sequential) Button
      const btnPdfSeq = root.querySelector('#btn-qmz-pdf-sequential');
      if (btnPdfSeq) {
        btnPdfSeq.addEventListener('click', () => exportQMZSequentialPdf(evt, root));
      }

      // Add QMZ Sequence
      const btnAddSeq = root.querySelector('#btn-add-qmz-sequence');
      const seqBody = root.querySelector('#qmz-sequences-body');
      if (btnAddSeq && seqBody) {
        btnAddSeq.addEventListener('click', () => {
          insertQMZRow(seqBody.querySelectorAll('.qmz-row').length, root);
          scheduleQMZAutosave(evt, root);
        });
      }

      // Insert Inline Sharaf Modal Trigger
      const btnInsertSharaf = root.querySelector('#btn-insert-inline-sharaf');
      if (btnInsertSharaf) {
        btnInsertSharaf.addEventListener('click', () => openInsertInlineSharafModal(evt, null, root));
      }

      // Bulk Paste Modal Trigger
      const btnBulkPaste = root.querySelector('#btn-open-bulk-paste');
      if (btnBulkPaste) {
        btnBulkPaste.addEventListener('click', () => openBulkPasteModal(evt));
      }

      // Renumber rows and wire row actions
      renumberQMZRows(root);
      bindQMZRowActions(root);
    }

    // ── Bethak Engine Bindings (Accordion Architecture from Screen Recording) ──
    if (engine === 'bethak') {
      const bState = getOrCreateBethakState(evt);

      // Render initial teams and segments
      renderBethakTeamsContainer(evt, root);
      renderBethakSegmentsContainer(evt, root);

      // Add Bethak Team
      const btnAddTeam = root.querySelector('#btn-add-bethak-team');
      btnAddTeam?.addEventListener('click', () => {
        const currentCount = bState.teams.length;
        bState.teams.push({
          id: `team-${Date.now()}-${currentCount + 1}`,
          name: `Team ${currentCount + 1}`,
          photographer_id: null,
          videographer_id: null
        });
        renderBethakTeamsContainer(evt, root);
        refreshBethakTeamDropdownsInRows(evt, root);
        scheduleBethakAutosave(evt, root);
      });

      // Add Segment Button
      const btnAddSeg = root.querySelector('#btn-add-bethak-segment');
      const addSegSelect = root.querySelector('#bethak-add-seg-select');
      btnAddSeg?.addEventListener('click', () => {
        const segType = addSegSelect?.value || 'Nikah';
        bState.segments.push({
          id: `seg-${Date.now()}-${bState.segments.length + 1}-${Math.floor(Math.random() * 999)}`,
          type: segType,
          count: 1,
          isOpen: true,
          rows: [
            {
              localIdx: 1,
              seq: '',
              its: '',
              sticker: '',
              name: '',
              mobile: '',
              location: '',
              team_id: null,
              photographer_id: null,
              videographer_id: null,
              sharaf: '',
              photo_not_covered: false,
              video_not_covered: false
            }
          ]
        });
        recalculateBethakSequences(bState.segments, bState.teams);
        renderBethakSegmentsContainer(evt, root);
        scheduleBethakAutosave(evt, root);
      });

      // Toggle All (Expand All / Collapse All)
      const btnToggleAll = root.querySelector('#btn-bethak-toggle-all');
      btnToggleAll?.addEventListener('click', () => {
        const allOpen = bState.segments.every(s => s.isOpen);
        const newTarget = !allOpen;
        bState.segments.forEach(s => { s.isOpen = newTarget; });
        btnToggleAll.textContent = newTarget ? 'Collapse All' : 'Expand All';
        root.querySelectorAll('#bethak-segments-list .bethak-segment-card').forEach(c => {
          c.classList.toggle('is-open', newTarget);
        });
      });

      // Import Sharaf Data Modal Trigger
      const btnImportSharaf = root.querySelector('#btn-bethak-import-sharaf');
      btnImportSharaf?.addEventListener('click', () => {
        openBethakImportSharafModal(evt, root);
      });

      // Notes textarea
      const notesInput = root.querySelector('#bethak-notes-input');
      notesInput?.addEventListener('input', () => {
        bState.notes = notesInput.value;
        scheduleBethakAutosave(evt, root);
      });
    }
  }

  // ── QMZ Row Rendering Helper ──
  function renderSingleQMZRowHtml(r, idx, teams, isInline = false, bannerId = null) {
    const seqVal = r.sequence || (isInline ? '' : String(idx + 1).padStart(2, '0'));
    const eventVal = r.event_abr || r.type || 'Qadam';
    const stickerVal = escapeHtml(r.sticker_name || '');
    const nameVal = escapeHtml(r.name || '');
    const itsVal = escapeHtml(r.its || '');
    const locVal = escapeHtml(r.location || '');
    const mobVal = escapeHtml(r.mobile || '');
    const teamId = r.team_id || '';
    const matchedTeam = (teams || []).find((t, tIdx) => {
      const tid = t.id || `team-${tIdx + 1}`;
      return tid === teamId || t.name === teamId;
    });
    const photoId = r.photographer_id || matchedTeam?.photographer_id || null;
    const videoId = r.videographer_id || matchedTeam?.videographer_id || null;

    return `
      <tr class="qmz-row ${isInline ? 'is-inline-row' : ''}" 
          data-team-id="${teamId}"
          ${isInline ? `data-banner-id="${bannerId || ''}" data-event-type="${escapeHtml(eventVal)}"` : ''}>
        <td>
          <div class="qmz-row-controls">
            ${!isInline ? `
              <span class="btn-qmz-drag-handle" title="Drag to reorder">⋮⋮</span>
              <button type="button" class="btn-qmz-arrow btn-qmz-up" title="Move up">⌃</button>
              <button type="button" class="btn-qmz-arrow btn-qmz-down" title="Move down">⌄</button>
              <button type="button" class="btn-qmz-plus btn-insert-inline-sharaf-row" title="Insert Inline Sharaf after this row">+</button>
            ` : ''}
          </div>
        </td>
        <td style="text-align: center;">
          <span class="qmz-row-idx">${idx + 1}</span>
        </td>
        <td style="text-align: center;">
          <input type="text" class="table-input-inline row-seq" value="${seqVal}" style="text-align: center; font-weight: 700; width: 65px;">
        </td>
        <td>
          ${isInline ? `
            <div class="badge-inline-sharaf-type">${escapeHtml(eventVal.toUpperCase())}</div>
            <input type="hidden" class="row-abr" value="${escapeHtml(eventVal)}">
          ` : `
            <select class="table-input-inline row-abr" style="font-weight: 600;">
              ${(() => {
                const standardOptions = [
                  'Qadam', 'Majlis', 'Ziyafat', 'Zafaf Olda', 'Nikah',
                  'Bethak Majlis', 'Bethak Qadam', 'Bethak Ziyafat', 'Majmui Ziyafat',
                  'Sharaf', 'Aqiqa', 'Misaq', 'Haddiyat', 'Mafsuhiyat', 'Waaz',
                  'Namaz', 'Wada', 'Isteqbal'
                ];
                let opts = [...standardOptions];
                if (eventVal && !opts.some(o => o.toLowerCase() === eventVal.toLowerCase())) {
                  opts.push(eventVal);
                }
                return opts.map(opt => {
                  const isSel = (opt.toLowerCase() === eventVal.toLowerCase()) ||
                                (opt === 'Qadam' && (eventVal === 'Q' || eventVal === 'Qadam')) ||
                                (opt === 'Majlis' && (eventVal === 'M' || eventVal === 'Majlis')) ||
                                (opt === 'Ziyafat' && (eventVal === 'Z' || eventVal === 'Ziyafat')) ||
                                (opt === 'Zafaf Olda' && (eventVal === 'ZO' || eventVal === 'OLDA' || eventVal === 'Zafaf Olda'));
                  return `<option value="${escapeHtml(opt)}" ${isSel ? 'selected' : ''}>${escapeHtml(opt)}</option>`;
                }).join('');
              })()}
            </select>
          `}
        </td>
        <td><input type="text" class="table-input-inline row-sticker" placeholder="Sticker" value="${stickerVal}"></td>
        <td><input type="text" class="table-input-inline row-name" placeholder="Host Name" value="${nameVal}" style="font-weight: 600;"></td>
        <td><input type="text" class="table-input-inline row-its" placeholder="ITS" value="${itsVal}" style="font-family: var(--font-mono, monospace);"></td>
        <td><input type="text" class="table-input-inline row-loc" placeholder="Location / Address" value="${locVal}"></td>
        <td><input type="text" class="table-input-inline row-mob" placeholder="Phone" value="${mobVal}" style="font-family: var(--font-mono, monospace);"></td>
        <td>
          <select class="table-input-inline row-team" style="font-size: 0.8rem; margin-bottom: 4px;">
            <option value="">— Custom —</option>
            ${(teams || []).map((t, tIdx) => {
              const tid = t.id || `team-${tIdx + 1}`;
              const tname = t.name || `Team ${tIdx + 1}`;
              const isSel = (tid === teamId || tname === teamId);
              return `<option value="${tid}" ${isSel ? 'selected' : ''}>${escapeHtml(tname)}</option>`;
            }).join('')}
          </select>
          <div class="flex gap-1">
            <select class="table-input-inline row-photo" style="font-size: 0.75rem; height: 26px; padding: 2px 4px;">
              ${buildContributorOptions(photoId, 'Photographer', '— Photog —')}
            </select>
            <select class="table-input-inline row-video" style="font-size: 0.75rem; height: 26px; padding: 2px 4px;">
              ${buildContributorOptions(videoId, 'Videographer', '— Videog —')}
            </select>
          </div>
        </td>
        <td style="text-align: center;">
          <button type="button" class="btn-qmz-trash btn-delete-row" title="Delete row">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
          </button>
        </td>
      </tr>
    `;
  }

  // ── QMZ Row Insertion & Re-numbering Helpers ──
  function insertQMZRow(targetIndex, root = document) {
    const seqBody = root.querySelector('#qmz-sequences-body');
    if (!seqBody) return;

    const teamCards = Array.from(root.querySelectorAll('.team-card'));
    const teams = teamCards.map(c => ({
      id: c.getAttribute('data-team-id'),
      name: c.querySelector('.qmz-team-name-input')?.value || 'Team',
      photographer_id: c.querySelector('.qmz-team-photo-select')?.value || null,
      videographer_id: c.querySelector('.qmz-team-video-select')?.value || null,
    }));

    const assignedTeam = teams.length > 0 ? teams[targetIndex % teams.length] : null;

    const rowData = {
      sequence: String(targetIndex + 1).padStart(2, '0'),
      event_abr: 'Qadam',
      sticker_name: '',
      name: '',
      its: '',
      location: '',
      mobile: '',
      team_id: assignedTeam?.id || '',
      photographer_id: assignedTeam?.photographer_id || null,
      videographer_id: assignedTeam?.videographer_id || null,
    };

    const tempDiv = document.createElement('tbody');
    tempDiv.innerHTML = renderSingleQMZRowHtml(rowData, targetIndex, teams, false, null);
    const tr = tempDiv.firstElementChild;

    const existingRows = seqBody.querySelectorAll('.qmz-row');
    const placeholder = seqBody.querySelector('.qmz-empty-placeholder');
    if (placeholder) placeholder.remove();

    if (targetIndex >= existingRows.length) {
      seqBody.appendChild(tr);
    } else {
      seqBody.insertBefore(tr, existingRows[targetIndex]);
    }

    renumberQMZRows(root);
    bindQMZRowActions(root);
  }

  function renumberQMZRows(root = document) {
    const seqBody = root.querySelector('#qmz-sequences-body');
    if (!seqBody) return;

    const allRows = Array.from(seqBody.children);
    let globalRowIdx = 1;
    let currentParentSeqStr = '1';
    let currentInlineLetterIdx = 0;
    let normalCounter = 1;

    // Detect if sequences use zero-padding like "01", "02"
    const firstNormalSeq = allRows.find(r => r.classList.contains('qmz-row') && !r.classList.contains('is-inline-row'))
      ?.querySelector('.row-seq')?.value?.trim() || '';
    const usePad = firstNormalSeq.length >= 2 && firstNormalSeq.startsWith('0');
    if (usePad) {
      currentParentSeqStr = '01';
    }

    allRows.forEach(tr => {
      if (tr.classList.contains('inline-sharaf-banner-row')) {
        return;
      }
      if (!tr.classList.contains('qmz-row')) return;

      // Update sequential row index (#)
      const idxBadge = tr.querySelector('.qmz-row-idx');
      if (idxBadge) idxBadge.textContent = String(globalRowIdx);
      globalRowIdx++;

      const isInline = tr.hasAttribute('data-banner-id') || tr.classList.contains('is-inline-row');
      const seqInput = tr.querySelector('.row-seq');

      if (!isInline) {
        currentInlineLetterIdx = 0; // Reset letter counter for new parent sequence block
        const newSeq = usePad ? String(normalCounter).padStart(2, '0') : String(normalCounter);
        currentParentSeqStr = newSeq;
        normalCounter++;
        if (seqInput) {
          seqInput.value = newSeq;
        }
      } else {
        // Child inline row under current parent sequence
        const letter = (currentInlineLetterIdx < 26)
          ? String.fromCharCode(97 + currentInlineLetterIdx)
          : `${String.fromCharCode(97 + Math.floor(currentInlineLetterIdx / 26) - 1)}${String.fromCharCode(97 + (currentInlineLetterIdx % 26))}`;
        currentInlineLetterIdx++;

        if (seqInput) {
          seqInput.value = `${currentParentSeqStr}${letter}`;
        }
      }
    });

    // Update banner headers and counts
    seqBody.querySelectorAll('.inline-sharaf-banner-row').forEach(banner => {
      const bannerId = banner.getAttribute('data-banner-id');
      const children = Array.from(seqBody.querySelectorAll(`tr.qmz-row[data-banner-id="${bannerId}"]`));
      const segType = banner.getAttribute('data-segment-type') || 'Inline Sharaf';
      const isCollapsed = banner.getAttribute('data-collapsed') === 'true';
      const arrow = isCollapsed ? '▶' : '▼';
      if (children.length === 0) {
        banner.remove();
      } else {
        const textSpan = banner.querySelector('.inline-banner-text');
        if (textSpan) {
          textSpan.textContent = `${segType.toUpperCase()} (${children.length} TOTAL)`;
        }
        const arrowSpan = banner.querySelector('.inline-banner-arrow');
        if (arrowSpan) {
          arrowSpan.textContent = arrow;
        }
        children.forEach(c => {
          c.style.display = isCollapsed ? 'none' : '';
        });
      }
    });

    updateQMZSummaryBar(root);
  }

  function updateQMZSummaryBar(root = document) {
    const seqBody = root.querySelector('#qmz-sequences-body');
    if (!seqBody) return;
    const rows = Array.from(seqBody.querySelectorAll('tr.qmz-row'));
    let assignedCount = 0;
    rows.forEach(r => {
      const hasName = Boolean(r.querySelector('.row-name')?.value?.trim());
      const hasTeam = Boolean(r.querySelector('.row-team')?.value?.trim());
      if (hasName || hasTeam) assignedCount++;
    });
    const summarySpan = root.querySelector('.qmz-rows-summary');
    if (summarySpan) {
      summarySpan.textContent = `${rows.length} rows • ${assignedCount} assigned`;
    }
  }

  // ── Helper: Live Recheck Uncovered Sequences in DOM ──
  function recheckActiveUncoveredInDom(root = document) {
    const activeSubId = (root && root.closest && root.closest('.subevent-item-wrapper')?.getAttribute('data-sub-id')) || (state.activeEvent && state.activeEvent.id);
    const card = (root && root.closest && root.closest('.event-accordion-card')) || (state.activeEvent ? document.querySelector(`.event-accordion-card[data-group-key="${state.activeEvent.date}_${state.activeEvent.event_time_slot}"]`) : null);
    if (!card) return;

    // Check all sequence rows in current active table (QMZ or Bethak)
    const qmzRows = Array.from(root.querySelectorAll ? root.querySelectorAll('#qmz-sequences-body tr.qmz-row') : []);
    const bethakRows = Array.from(root.querySelectorAll ? root.querySelectorAll('#bethak-segments-list .bethak-row-item') : []);
    const rows = qmzRows.length > 0 ? qmzRows : bethakRows;

    let activeUncoveredCount = 0;
    if (rows.length > 0) {
      rows.forEach(r => {
        const isNoPhoto = r.querySelector('.row-photo-not-covered')?.checked;
        const isNoVideo = r.querySelector('.row-video-not-covered')?.checked;
        const photoId = r.querySelector('.row-photo')?.value || r.querySelector('.b-row-photo')?.value;
        const videoId = r.querySelector('.row-video')?.value || r.querySelector('.b-row-video')?.value;

        const photoCovered = isNoPhoto || Boolean(photoId && photoId !== '');
        const videoCovered = isNoVideo || Boolean(videoId && videoId !== '');
        if (!photoCovered && !videoCovered) {
          activeUncoveredCount++;
        }
      });
    }

    const subWrapper = (root && root.closest && root.closest('.subevent-item-wrapper')) || document.querySelector(`.subevent-item-wrapper[data-sub-id="${activeSubId}"]`);

    // Update subevent badge on subevent coverage row
    if (subWrapper) {
      const subBadge = subWrapper.querySelector('.badge-subevent-uncovered');
      if (subBadge) {
        subBadge.style.display = activeUncoveredCount === 0 ? 'none' : 'inline-block';
        if (activeUncoveredCount > 0) {
          subBadge.textContent = `⚠️ No contributors: ${activeUncoveredCount} sequence(s)`;
        }
      }
    }

    // Check all sub-events in this group card
    const allSubWrappers = Array.from(card.querySelectorAll('.subevent-item-wrapper'));
    let totalUncoveredInGroup = 0;
    allSubWrappers.forEach(sw => {
      const sId = sw.getAttribute('data-sub-id');
      if (sId === activeSubId) {
        totalUncoveredInGroup += activeUncoveredCount;
      } else {
        const sEvt = (state.events || []).find(e => e.id === sId);
        if (sEvt && sEvt.uncovered_sequences) {
          totalUncoveredInGroup += sEvt.uncovered_sequences.length;
        }
      }
    });

    const alertBox = card.querySelector('.uncovered-contributors-alert-box');
    const titleBadge = card.querySelector('.badge-uncovered-warning');
    const subtitleAlert = card.querySelector('.uncovered-seq-alert-text');

    if (totalUncoveredInGroup === 0) {
      card.classList.remove('has-uncovered-warning');
      if (alertBox) alertBox.style.display = 'none';
      if (titleBadge) titleBadge.style.display = 'none';
      if (subtitleAlert) subtitleAlert.style.display = 'none';
      card._hasUncovered = false;
      card._uncoveredCount = 0;
    } else {
      card.classList.add('has-uncovered-warning');
      if (titleBadge) {
        titleBadge.style.display = 'inline-block';
        titleBadge.textContent = `⚠️ ${totalUncoveredInGroup} NO CONTRIBUTORS`;
      }
      card._hasUncovered = true;
      card._uncoveredCount = totalUncoveredInGroup;
    }

    // Update main event header uncovered badge
    const headerBadge = card.querySelector('.badge-uncovered-count');
    if (headerBadge) {
      const totalUncovered = card.querySelectorAll('.badge-subevent-uncovered:not([style*="display: none"])').length;
      headerBadge.style.display = totalUncovered === 0 ? 'none' : 'inline-flex';
      if (totalUncovered > 0) {
        headerBadge.innerHTML = `
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
          <span>${totalUncovered} Sub-event(s) have uncovered slots</span>
        `;
      }
    }
  }

  // ── Universal Event Resolver from DOM Container ──
  function resolveEventFromRoot(root) {
    if (!root) return state.activeEvent;
    const subId = root.getAttribute?.('data-sub-id') || 
                  root.closest?.('.subevent-inline-tray')?.getAttribute('data-sub-id') ||
                  root.querySelector?.('[data-event-id]')?.getAttribute('data-event-id') ||
                  root.querySelector?.('[data-sub-id]')?.getAttribute('data-sub-id') ||
                  root.closest?.('.subevent-item-wrapper')?.getAttribute('data-sub-id');
    if (subId) {
      const found = (state.events || []).find(e => String(e.id) === String(subId));
      if (found) return found;
    }
    return (state.selectedEventId ? state.events.find(ev => ev.id === state.selectedEventId) : null) || state.activeEvent;
  }

  function bindQMZRowActions(root = document) {
    const seqBody = root.querySelector('#qmz-sequences-body');
    if (!seqBody) return;

    // Team dropdown change: auto-populate row photographer & videographer and cascade to sub-events
    seqBody.querySelectorAll('.row-team').forEach(sel => {
      sel.onchange = (e) => {
        const tr = e.target.closest('tr');
        const teamId = e.target.value;
        let pVal = null;
        let vVal = null;

        if (teamId) {
          const teamCards = Array.from(root.querySelectorAll('.team-card'));
          const teamCard = teamCards.find(c => 
            c.getAttribute('data-team-id') === teamId ||
            c.querySelector('.qmz-team-name-input')?.value?.trim() === teamId
          );
          pVal = teamCard?.querySelector('.qmz-team-photo-select')?.value;
          vVal = teamCard?.querySelector('.qmz-team-video-select')?.value;

          if (!pVal || !vVal) {
            const activeEvt = resolveEventFromRoot(root);
            const tObj = (activeEvt?.qmz_teams || []).find((t, tIdx) => 
              t.id === teamId || 
              `team-${tIdx + 1}` === teamId ||
              t.name === teamId
            );
            if (tObj) {
              pVal = pVal || tObj.photographer_id;
              vVal = vVal || tObj.videographer_id;
            }
          }

          const photoSel = tr?.querySelector('.row-photo');
          const videoSel = tr?.querySelector('.row-video');
          if (photoSel && pVal) photoSel.value = String(pVal);
          if (videoSel && vVal) videoSel.value = String(vVal);
        }

        // If tr is a parent event row, cascade the exact same team and crew to all its sub-events
        const isInline = tr?.hasAttribute('data-banner-id') || tr?.classList.contains('is-inline-row');
        if (tr && !isInline) {
          let next = tr.nextElementSibling;
          while (next) {
            if (next.classList.contains('inline-sharaf-banner-row')) {
              next = next.nextElementSibling;
              continue;
            }
            if (!next.classList.contains('qmz-row')) break;
            if (!next.classList.contains('is-inline-row') && !next.hasAttribute('data-banner-id')) {
              break; // reached next parent row
            }
            const subTeamSel = next.querySelector('.row-team');
            const subPhotoSel = next.querySelector('.row-photo');
            const subVideoSel = next.querySelector('.row-video');
            if (subTeamSel) subTeamSel.value = teamId || '';
            if (subPhotoSel && pVal) subPhotoSel.value = String(pVal);
            if (subVideoSel && vVal) subVideoSel.value = String(vVal);
            next = next.nextElementSibling;
          }
        }

        updateQMZSummaryBar(root);
        recheckActiveUncoveredInDom(root);
        const activeEvt = resolveEventFromRoot(root);
        scheduleQMZAutosave(activeEvt, root);
      };
    });

    // Contributor dropdown changes: cascade to sub-events if on parent row
    seqBody.querySelectorAll('.row-photo, .row-video').forEach(sel => {
      sel.onchange = () => {
        const tr = sel.closest('tr');
        const isInline = tr?.hasAttribute('data-banner-id') || tr?.classList.contains('is-inline-row');
        if (tr && !isInline) {
          const isPhoto = sel.classList.contains('row-photo');
          const val = sel.value;
          let next = tr.nextElementSibling;
          while (next) {
            if (next.classList.contains('inline-sharaf-banner-row')) {
              next = next.nextElementSibling;
              continue;
            }
            if (!next.classList.contains('qmz-row')) break;
            if (!next.classList.contains('is-inline-row') && !next.hasAttribute('data-banner-id')) {
              break; // reached next parent row
            }
            const subSel = next.querySelector(isPhoto ? '.row-photo' : '.row-video');
            if (subSel) subSel.value = val ? String(val) : '';
            next = next.nextElementSibling;
          }
        }
        recheckActiveUncoveredInDom(root);
        const activeEvt = resolveEventFromRoot(root);
        scheduleQMZAutosave(activeEvt, root);
      };
    });

    // Live autosave on text typing or dropdown changes
    seqBody.querySelectorAll('.row-name, .row-sticker, .row-its, .row-loc, .row-mob, .row-seq').forEach(inp => {
      inp.oninput = () => {
        updateQMZSummaryBar(root);
        const activeEvt = resolveEventFromRoot(root);
        scheduleQMZAutosave(activeEvt, root);
      };
    });

    seqBody.querySelectorAll('select.row-abr').forEach(sel => {
      sel.onchange = () => {
        const activeEvt = resolveEventFromRoot(root);
        scheduleQMZAutosave(activeEvt, root);
      };
    });

    // Live autosave on Not-Covered checkboxes
    seqBody.querySelectorAll('.row-photo-not-covered, .row-video-not-covered').forEach(cb => {
      cb.onchange = () => {
        updateQMZSummaryBar(root);
        recheckActiveUncoveredInDom(root);
        const activeEvt = resolveEventFromRoot(root);
        scheduleQMZAutosave(activeEvt, root);
      };
    });

    // Insert Inline Sharaf (+) button on a row
    seqBody.querySelectorAll('.btn-insert-inline-sharaf-row').forEach(b => {
      b.onclick = (e) => {
        e.stopPropagation();
        const tr = e.target.closest('tr.qmz-row');
        const activeEvt = resolveEventFromRoot(root);
        openInsertInlineSharafModal(activeEvt, tr, root);
      };
    });

    // ── Smooth FLIP Animation for QMZ Table Rows & Banner Groups ──
    function animateQMZTableFLIP(seqBody, mutateDomFn, highlightEl = null) {
      if (!seqBody) {
        if (typeof mutateDomFn === 'function') mutateDomFn();
        return;
      }

      // 1. FIRST: Record initial top coordinate of every row in the table body
      const initialChildren = Array.from(seqBody.children);
      const firstPositions = new Map();
      initialChildren.forEach(el => {
        firstPositions.set(el, el.getBoundingClientRect().top);
      });

      // 2. Perform DOM mutation
      if (typeof mutateDomFn === 'function') {
        mutateDomFn();
      }

      // 3. LAST: Record new positions and compute deltaY
      const movedElements = [];
      const newChildren = Array.from(seqBody.children);
      newChildren.forEach(el => {
        const firstTop = firstPositions.get(el);
        if (firstTop !== undefined) {
          const lastTop = el.getBoundingClientRect().top;
          const deltaY = firstTop - lastTop;
          if (Math.abs(deltaY) > 0.5) {
            movedElements.push({ el, deltaY });
          }
        }
      });

      if (movedElements.length === 0) return;

      // 4. INVERT: instantly shift elements back to their starting positions without animation
      movedElements.forEach(({ el, deltaY }) => {
        el.classList.add('is-animating-qmz-row');
        el.style.transition = 'none';
        el.style.transform = `translateY(${deltaY}px)`;
      });

      const highlightList = Array.isArray(highlightEl) ? highlightEl : (highlightEl ? [highlightEl] : []);
      highlightList.forEach(el => {
        if (el && el.classList) el.classList.add('qmz-row-moved-highlight');
      });

      // Force synchronous browser layout reflow
      void seqBody.offsetHeight;

      // 5. PLAY: smoothly animate each row to its new resting position
      requestAnimationFrame(() => {
        movedElements.forEach(({ el }) => {
          el.style.transition = 'transform 0.3s cubic-bezier(0.2, 0.9, 0.3, 1)';
          el.style.transform = 'translateY(0px)';
        });
      });

      // 6. CLEANUP after transition finishes
      setTimeout(() => {
        movedElements.forEach(({ el }) => {
          el.style.transition = '';
          el.style.transform = '';
          el.classList.remove('is-animating-qmz-row');
        });
        setTimeout(() => {
          highlightList.forEach(el => {
            if (el && el.classList) el.classList.remove('qmz-row-moved-highlight');
          });
        }, 350);
      }, 320);
    }

    // ── Helper to find the parent normal row for any row (or itself if normal) ──
    function getParentNormalRow(el) {
      let curr = el;
      while (curr) {
        if (curr.classList.contains('qmz-row') && !curr.classList.contains('is-inline-row')) {
          return curr;
        }
        curr = curr.previousElementSibling;
      }
      return null;
    }

    // ── Helper to get all DOM rows belonging to an event block (parent + all tagged inline banners & rows) ──
    function getFullEventBlock(parentNormal) {
      if (!parentNormal) return [];
      const block = [parentNormal];
      let next = parentNormal.nextElementSibling;
      while (next && (next.classList.contains('is-inline-row') || next.classList.contains('inline-sharaf-banner-row'))) {
        block.push(next);
        next = next.nextElementSibling;
      }
      return block;
    }

    // Reorder: Move Up (^) with Smooth FLIP Animation
    seqBody.querySelectorAll('.btn-qmz-up').forEach(b => {
      b.onclick = (e) => {
        e.stopPropagation();
        const tr = e.target.closest('tr.qmz-row');
        if (!tr) return;

        const isInline = tr.classList.contains('is-inline-row');
        const prev = tr.previousElementSibling;
        if (!prev || prev.classList.contains('qmz-empty-placeholder')) return;

        // If this is an inline row and has a previous sibling in the SAME banner group, swap within parent event
        if (isInline) {
          const bannerId = tr.getAttribute('data-banner-id');
          if (prev.classList.contains('is-inline-row') && prev.getAttribute('data-banner-id') === bannerId) {
            animateQMZTableFLIP(seqBody, () => {
              seqBody.insertBefore(tr, prev);
              renumberQMZRows(root);
            }, tr);
            const activeEvt = resolveEventFromRoot(root);
            scheduleQMZAutosave(activeEvt, root);
            return;
          }
        }

        // Sub-events only move WITH the event they are tagged to!
        // Moving up moves the current parent event AND all its tagged sub-events together above the preceding event!
        const currentParent = getParentNormalRow(tr);
        if (!currentParent) return;

        const prevItem = currentParent.previousElementSibling;
        if (!prevItem || prevItem.classList.contains('qmz-empty-placeholder')) return;

        const prevParent = getParentNormalRow(prevItem);
        if (!prevParent) return;

        const currentBlock = getFullEventBlock(currentParent);

        animateQMZTableFLIP(seqBody, () => {
          currentBlock.forEach(el => seqBody.insertBefore(el, prevParent));
          renumberQMZRows(root);
        }, currentBlock);

        const activeEvt = resolveEventFromRoot(root);
        scheduleQMZAutosave(activeEvt, root);
      };
    });

    // Reorder: Move Down (v) with Smooth FLIP Animation
    seqBody.querySelectorAll('.btn-qmz-down').forEach(b => {
      b.onclick = (e) => {
        e.stopPropagation();
        const tr = e.target.closest('tr.qmz-row');
        if (!tr) return;

        const isInline = tr.classList.contains('is-inline-row');
        const next = tr.nextElementSibling;
        if (!next) return;

        // If this is an inline row and has a next sibling in the SAME banner group, swap within parent event
        if (isInline) {
          const bannerId = tr.getAttribute('data-banner-id');
          if (next.classList.contains('is-inline-row') && next.getAttribute('data-banner-id') === bannerId) {
            animateQMZTableFLIP(seqBody, () => {
              seqBody.insertBefore(next, tr);
              renumberQMZRows(root);
            }, tr);
            const activeEvt = resolveEventFromRoot(root);
            scheduleQMZAutosave(activeEvt, root);
            return;
          }
        }

        // Sub-events only move WITH the event they are tagged to!
        // Moving down moves the current parent event AND all its tagged sub-events together below the next event!
        const currentParent = getParentNormalRow(tr);
        if (!currentParent) return;

        const currentBlock = getFullEventBlock(currentParent);
        const lastInCurrent = currentBlock[currentBlock.length - 1];
        const nextItem = lastInCurrent.nextElementSibling;
        if (!nextItem) return; // Already at bottom of table

        // Find next parent event
        const nextParent = (nextItem.classList.contains('qmz-row') && !nextItem.classList.contains('is-inline-row'))
          ? nextItem
          : getParentNormalRow(nextItem);
        if (!nextParent) return;

        const nextBlock = getFullEventBlock(nextParent);
        const lastInNext = nextBlock[nextBlock.length - 1];
        const refNode = lastInNext.nextSibling;

        animateQMZTableFLIP(seqBody, () => {
          currentBlock.forEach(el => seqBody.insertBefore(el, refNode));
          renumberQMZRows(root);
        }, currentBlock);

        const activeEvt = resolveEventFromRoot(root);
        scheduleQMZAutosave(activeEvt, root);
      };
    });

    // Delete Row (🗑) with Smooth FLIP Animation
    seqBody.querySelectorAll('.btn-delete-row').forEach(b => {
      b.onclick = (e) => {
        e.stopPropagation();
        const tr = e.target.closest('tr.qmz-row');
        if (!tr) return;

        const isInline = tr.classList.contains('is-inline-row');

        if (isInline) {
          // Deleting a single inline sub-event
          const bannerId = tr.getAttribute('data-banner-id');

          animateQMZTableFLIP(seqBody, () => {
            tr.remove();

            if (bannerId) {
              const remaining = Array.from(seqBody.querySelectorAll(`tr.qmz-row[data-banner-id="${bannerId}"]`));
              const banner = seqBody.querySelector(`.inline-sharaf-banner-row[data-banner-id="${bannerId}"]`);
              if (remaining.length === 0) {
                if (banner) banner.remove();
              } else if (banner) {
                const segType = banner.getAttribute('data-segment-type') || 'Inline Sharaf';
                const isCollapsed = banner.getAttribute('data-collapsed') === 'true';
                const arrowText = isCollapsed ? '▶' : '▼';
                banner.innerHTML = `
                  <td colspan="11">
                    <div class="inline-banner-bar">
                      <span class="inline-banner-arrow">${arrowText}</span>
                      <span class="inline-banner-text">${segType.toUpperCase()} (${remaining.length} TOTAL)</span>
                    </div>
                  </td>
                `;
              }
            }

            renumberQMZRows(root);

            if (seqBody.querySelectorAll('.qmz-row').length === 0) {
              seqBody.innerHTML = '<tr class="qmz-empty-placeholder"><td colspan="11" style="text-align:center; color:var(--text-muted); padding: 2rem;">No sequences. Add a sequence or click "Import CSV File".</td></tr>';
            }
          });
        } else {
          // Deleting a parent normal row: delete it AND all its tagged sub-events and banners together
          const block = getFullEventBlock(tr);

          animateQMZTableFLIP(seqBody, () => {
            block.forEach(el => el.remove());
            renumberQMZRows(root);

            if (seqBody.querySelectorAll('.qmz-row').length === 0) {
              seqBody.innerHTML = '<tr class="qmz-empty-placeholder"><td colspan="11" style="text-align:center; color:var(--text-muted); padding: 2rem;">No sequences. Add a sequence or click "Import CSV File".</td></tr>';
            }
          });
        }

        recheckActiveUncoveredInDom(root);
        const activeEvt = resolveEventFromRoot(root);
        scheduleQMZAutosave(activeEvt, root);
      };
    });

    // Accordion Banner Toggle with Smooth FLIP Animation
    seqBody.querySelectorAll('.inline-sharaf-banner-row').forEach(banner => {
      banner.onclick = () => {
        const bannerId = banner.getAttribute('data-banner-id');
        const isCollapsed = banner.getAttribute('data-collapsed') === 'true';
        const newCollapsed = !isCollapsed;
        banner.setAttribute('data-collapsed', String(newCollapsed));

        const arrow = banner.querySelector('.inline-banner-arrow');
        if (arrow) arrow.textContent = newCollapsed ? '▶' : '▼';

        const childRows = Array.from(seqBody.querySelectorAll(`tr.qmz-row[data-banner-id="${bannerId}"]`));
        animateQMZTableFLIP(seqBody, () => {
          childRows.forEach(r => {
            r.style.display = newCollapsed ? 'none' : '';
          });
        });
      };
    });

    // Uncovered check & summary bar
    recheckActiveUncoveredInDom(root);
    updateQMZSummaryBar(root);
  }

  // ── QMZ Autosave Engine ──
  function scheduleQMZAutosave(evt, root = document) {
    if (!evt || !evt.id) return;
    const statusEl = root.querySelector('.qmz-save-status') || root.querySelector('.event-autosave-indicator');
    if (statusEl) {
      const textSpan = statusEl.querySelector('.autosave-text') || statusEl;
      textSpan.textContent = '● Autosaving...';
      statusEl.style.color = '#f59e0b';
      const dot = statusEl.querySelector('.autosave-dot');
      if (dot) dot.style.background = '#f59e0b';
    }

    if (evt._qmzAutosaveTimer) clearTimeout(evt._qmzAutosaveTimer);

    evt._qmzAutosaveTimer = setTimeout(async () => {
      await saveQMZStateImmediate(evt, root);
    }, 600);
  }

  async function saveQMZStateImmediate(evt, root = document) {
    if (!evt || !evt.id) return;
    const statusEl = root.querySelector('.qmz-save-status') || root.querySelector('.event-autosave-indicator');
    const saveBtn = root.querySelector('.btn-save-event-changes-inline') || root.querySelector('#btn-save-event-changes');

    try {
      const teamCards = Array.from(root.querySelectorAll('.team-card'));
      const qmz_teams = teamCards.map(c => ({
        id: c.getAttribute('data-team-id'),
        name: c.querySelector('.qmz-team-name-input')?.value || 'Team',
        photographer_id: c.querySelector('.qmz-team-photo-select')?.value ? parseInt(c.querySelector('.qmz-team-photo-select').value, 10) : null,
        videographer_id: c.querySelector('.qmz-team-video-select')?.value ? parseInt(c.querySelector('.qmz-team-video-select').value, 10) : null,
        save_for_reuse: false,
      }));

      let currentParentTeamId = null;
      let currentParentPhotoId = null;
      let currentParentVideoId = null;

      const rows = Array.from(root.querySelectorAll('#qmz-sequences-body tr.qmz-row')).map(r => {
        const isInline = r.hasAttribute('data-banner-id') || r.classList.contains('is-inline-row');
        const isNoPhoto = r.querySelector('.row-photo-not-covered')?.checked || false;
        const isNoVideo = r.querySelector('.row-video-not-covered')?.checked || false;
        let teamId = r.querySelector('.row-team')?.value || null;
        let photoId = isNoPhoto ? null : (r.querySelector('.row-photo')?.value ? parseInt(r.querySelector('.row-photo').value, 10) : null);
        let videoId = isNoVideo ? null : (r.querySelector('.row-video')?.value ? parseInt(r.querySelector('.row-video').value, 10) : null);

        if (!isInline) {
          currentParentTeamId = teamId;
          currentParentPhotoId = photoId;
          currentParentVideoId = videoId;
        } else {
          // Sub-event inherits parent's team and crew if not explicitly different
          if (!teamId && currentParentTeamId) teamId = currentParentTeamId;
          if (!photoId && currentParentPhotoId) photoId = currentParentPhotoId;
          if (!videoId && currentParentVideoId) videoId = currentParentVideoId;
        }

        // Auto-resolve photographer and videographer from team if team is assigned
        if (teamId && (!photoId || !videoId)) {
          const matchedTeam = qmz_teams.find(t => t.id === teamId || t.name === teamId);
          if (matchedTeam) {
            if (!photoId && matchedTeam.photographer_id) photoId = matchedTeam.photographer_id;
            if (!videoId && matchedTeam.videographer_id) videoId = matchedTeam.videographer_id;
          }
        }

        return {
          sequence: r.querySelector('.row-seq')?.value || '1',
          event_abr: r.querySelector('.row-abr')?.value || 'Qadam',
          sticker_name: r.querySelector('.row-sticker')?.value || '',
          name: r.querySelector('.row-name')?.value || '',
          its: r.querySelector('.row-its')?.value || '',
          location: r.querySelector('.row-loc')?.value || '',
          mobile: r.querySelector('.row-mob')?.value || '',
          team_id: teamId,
          photographer_id: photoId,
          videographer_id: videoId,
          photo_not_covered: isNoPhoto,
          video_not_covered: isNoVideo,
          is_inline: isInline,
        };
      });

      const droneSelect = root.querySelector('#qmz-drone-operator-select');
      const droneUserId = droneSelect && droneSelect.value ? parseInt(droneSelect.value, 10) : null;
      evt.individual_assignment = evt.individual_assignment || {};
      evt.individual_assignment.drone = { user_id: droneUserId, location: '' };

      await callApi('events_update_event', evt.id, { 
        qmz_teams, 
        individual_assignment: evt.individual_assignment,
        qmz_count: rows.length 
      });
      await callApi('events_sync_assignments', evt.id, rows);
      evt.qmz_teams = qmz_teams;
      evt.city_event_assignments = rows;

      // Update in-memory uncovered status so warning badges clear immediately
      const uncoveredRows = rows.filter(r => !r.photographer_id && !r.videographer_id && !r.photo_not_covered && !r.video_not_covered);
      evt.uncovered_sequences = uncoveredRows;
      evt.uncovered_count = uncoveredRows.length;
      const matchingEvt = (state.events || []).find(e => e.id === evt.id);
      if (matchingEvt) {
        matchingEvt.uncovered_sequences = uncoveredRows;
        matchingEvt.uncovered_count = uncoveredRows.length;
      }

      recheckActiveUncoveredInDom(root);

      if (statusEl) {
        const textSpan = statusEl.querySelector('.autosave-text') || statusEl;
        textSpan.textContent = '● All changes saved';
        statusEl.style.color = '#10b981';
        const dot = statusEl.querySelector('.autosave-dot');
        if (dot) dot.style.background = '#10b981';
      }
      if (saveBtn && saveBtn.querySelector('span')) {
        saveBtn.querySelector('span').textContent = '✓ Saved';
        setTimeout(() => {
          if (saveBtn.querySelector('span') && saveBtn.querySelector('span').textContent === '✓ Saved') {
            saveBtn.querySelector('span').textContent = 'Save Event Operations';
          }
        }, 1800);
      }
    } catch (err) {
      console.error("QMZ autosave error:", err);
      if (statusEl) {
        const textSpan = statusEl.querySelector('.autosave-text') || statusEl;
        textSpan.textContent = '⚠️ Unsaved changes';
        statusEl.style.color = '#ef4444';
        const dot = statusEl.querySelector('.autosave-dot');
        if (dot) dot.style.background = '#ef4444';
      }
    }
  }

  // ── Standard Engine Autosave Engine ──
  function scheduleStandardAutosave(evt, root = document) {
    if (!evt || !evt.id) return;
    const statusEl = root.querySelector('.event-autosave-indicator') || root.querySelector('.qmz-save-status');
    const saveBtn = root.querySelector('.btn-save-event-changes-inline') || root.querySelector('#btn-save-event-changes');
    if (statusEl) {
      const textSpan = statusEl.querySelector('.autosave-text') || statusEl;
      textSpan.textContent = '● Autosaving...';
      statusEl.style.color = '#f59e0b';
      const dot = statusEl.querySelector('.autosave-dot');
      if (dot) dot.style.background = '#f59e0b';
    } else if (saveBtn && saveBtn.querySelector('span')) {
      saveBtn.querySelector('span').textContent = 'Autosaving...';
    }

    if (evt._stdAutosaveTimer) clearTimeout(evt._stdAutosaveTimer);

    evt._stdAutosaveTimer = setTimeout(async () => {
      await saveStandardStateImmediate(evt, root);
    }, 600);
  }

  async function saveStandardStateImmediate(evt, root = document) {
    if (!evt || !evt.id) return;
    const statusEl = root.querySelector('.event-autosave-indicator') || root.querySelector('.qmz-save-status');
    const saveBtn = root.querySelector('.btn-save-event-changes-inline') || root.querySelector('#btn-save-event-changes');

    try {
      const patch = {
        individual_assignment: {
          photographer: {
            user_id: root.querySelector('#std-photo-user')?.value ? parseInt(root.querySelector('#std-photo-user').value, 10) : null,
            location: root.querySelector('#std-photo-loc')?.value || ''
          },
          videographer: {
            user_id: root.querySelector('#std-video-user')?.value ? parseInt(root.querySelector('#std-video-user').value, 10) : null,
            location: root.querySelector('#std-video-loc')?.value || ''
          },
          drone: {
            user_id: root.querySelector('#std-drone-user')?.value ? parseInt(root.querySelector('#std-drone-user').value, 10) : null,
            location: root.querySelector('#std-drone-loc')?.value || ''
          }
        },
        individual_multi_assignments: Array.from(root.querySelectorAll('.multi-contrib-row')).map((r, i) => ({
          id: `multi-${i}`,
          role: r.querySelector('.multi-role-select')?.value || 'photographer',
          user_id: r.querySelector('.multi-user-select')?.value ? parseInt(r.querySelector('.multi-user-select').value, 10) : null,
          location: r.querySelector('.multi-loc-input')?.value || ''
        })),
        recording_details: {
          fixed_cameras_count: parseInt(root.querySelector('#rec-fixed-count')?.value || '0', 10),
          external_recorder: root.querySelector('#rec-ext-recorder')?.value || '',
          audio_operator: root.querySelector('#rec-audio-op')?.value || ''
        }
      };

      const syncRows = Array.from(root.querySelectorAll('.inline-seg-row')).map(r => ({
        sequence: r.querySelector('.inl-seq')?.value || '1a',
        event_abr: r.querySelector('.inl-abr')?.value || 'Nikah',
        sticker_name: '',
        name: r.querySelector('.inl-name')?.value || '',
        its: r.querySelector('.inl-its')?.value || '',
        location: r.querySelector('.inl-loc')?.value || '',
        mobile: r.querySelector('.inl-mob')?.value || '',
        team_id: null,
        photographer_id: r.querySelector('.inl-photo')?.value ? parseInt(r.querySelector('.inl-photo').value, 10) : null,
        videographer_id: r.querySelector('.inl-video')?.value ? parseInt(r.querySelector('.inl-video').value, 10) : null,
        photo_not_covered: false,
        video_not_covered: false,
      }));

      await callApi('events_update_event', evt.id, patch);
      await callApi('events_sync_assignments', evt.id, syncRows);

      Object.assign(evt, patch);
      evt.city_event_assignments = syncRows;

      const matchingEvt = (state.events || []).find(e => e.id === evt.id);
      if (matchingEvt) {
        Object.assign(matchingEvt, patch);
        matchingEvt.city_event_assignments = syncRows;
      }

      if (statusEl) {
        const textSpan = statusEl.querySelector('.autosave-text') || statusEl;
        textSpan.textContent = '● All changes saved';
        statusEl.style.color = '#10b981';
        const dot = statusEl.querySelector('.autosave-dot');
        if (dot) dot.style.background = '#10b981';
      }
      if (saveBtn && saveBtn.querySelector('span')) {
        saveBtn.querySelector('span').textContent = '✓ Saved';
        setTimeout(() => {
          if (saveBtn.querySelector('span') && saveBtn.querySelector('span').textContent === '✓ Saved') {
            saveBtn.querySelector('span').textContent = 'Save Event Operations';
          }
        }, 1800);
      }
    } catch (err) {
      console.error('Standard event autosave error:', err);
      if (statusEl) {
        const textSpan = statusEl.querySelector('.autosave-text') || statusEl;
        textSpan.textContent = '⚠️ Unsaved changes';
        statusEl.style.color = '#ef4444';
        const dot = statusEl.querySelector('.autosave-dot');
        if (dot) dot.style.background = '#ef4444';
      }
    }
  }

  // ── QMZ Auto Assign Dropdown & Logic (Video sec 26) ──
  function refreshQMZAutoAssignDropdown(root) {
    const sel = root.querySelector('#qmz-auto-assign-start-team');
    if (!sel) return;
    const currentVal = sel.value;
    const teamCards = Array.from(root.querySelectorAll('.team-card'));
    const teams = teamCards.map((c, i) => ({
      index: i,
      id: c.getAttribute('data-team-id'),
      name: c.querySelector('.qmz-team-name-input')?.value || `Team ${i + 1}`
    }));
    sel.innerHTML = '<option value="">— Select starting team —</option>' + teams.map(t => `<option value="${t.index}" ${String(t.index) === String(currentVal) ? 'selected' : ''}>${t.name}</option>`).join('');
  }

  function wireQMZAutoAssign(root, evt) {
    const btn = root.querySelector('#btn-qmz-auto-assign-teams');
    const startSelect = root.querySelector('#qmz-auto-assign-start-team');
    if (!btn || !startSelect) return;

    btn.onclick = () => {
      const teamCards = Array.from(root.querySelectorAll('.team-card'));
      if (teamCards.length === 0) {
        if (window.showToast) window.showToast("Please add at least one team first.", true);
        return;
      }
      const teams = teamCards.map((c, i) => ({
        index: i,
        id: c.getAttribute('data-team-id'),
        name: c.querySelector('.qmz-team-name-input')?.value || `Team ${i + 1}`,
        photographer_id: c.querySelector('.qmz-team-photo-select')?.value || null,
        videographer_id: c.querySelector('.qmz-team-video-select')?.value || null,
      }));

      const startIdxVal = startSelect.value;
      const startIdx = (startIdxVal !== "" && !isNaN(parseInt(startIdxVal, 10))) ? parseInt(startIdxVal, 10) : 0;
      
      const rows = Array.from(root.querySelectorAll('#qmz-sequences-body tr.qmz-row'));
      if (rows.length === 0) {
        if (window.showToast) window.showToast("No sequence assignments to assign.", true);
        return;
      }

      let parentTeamIndex = startIdx;
      let currentParentTeam = teams[parentTeamIndex % teams.length];

      rows.forEach(r => {
        const isInline = r.hasAttribute('data-banner-id') || r.classList.contains('is-inline-row');
        if (!isInline) {
          currentParentTeam = teams[parentTeamIndex % teams.length];
          parentTeamIndex++;
        }
        const team = currentParentTeam;
        const teamSel = r.querySelector('.row-team');
        const photoSel = r.querySelector('.row-photo');
        const videoSel = r.querySelector('.row-video');
        if (teamSel) {
          teamSel.value = team.id;
          if (!teamSel.value) teamSel.value = team.name;
        }
        if (photoSel) photoSel.value = team.photographer_id ? String(team.photographer_id) : '';
        if (videoSel) videoSel.value = team.videographer_id ? String(team.videographer_id) : '';
      });

      if (typeof recheckActiveUncoveredInDom === 'function') {
        recheckActiveUncoveredInDom(root);
      }
      scheduleQMZAutosave(evt, root);
      if (window.showToast) {
        window.showToast(`Auto-assigned ${rows.length} rows starting from ${teams[startIdx].name}.`);
      }
    };
  }

  // ── Insert Inline Sharaf Modal (Screen Recording Specification) ──
  function openInsertInlineSharafModal(evt, targetRowOrIndex = null, rootElement = null) {
    const existingModal = document.getElementById('modal-insert-sharaf-root');
    if (existingModal) existingModal.remove();

    // Robust container resolution
    let tray = rootElement || (targetRowOrIndex instanceof HTMLElement ? (targetRowOrIndex.closest('.subevent-inline-tray') || targetRowOrIndex.closest('.event-detail-container') || targetRowOrIndex.closest('#view-events')) : null);
    if (!tray && evt && evt.id) {
      tray = document.querySelector(`.subevent-item-wrapper[data-sub-id="${evt.id}"] .subevent-inline-tray`) ||
             document.querySelector(`.subevent-item-wrapper[data-sub-id="${evt.id}"]`) ||
             document.querySelector('.event-detail-container') ||
             document;
    }
    if (!tray) tray = document;

    const seqBody = (targetRowOrIndex instanceof HTMLElement ? targetRowOrIndex.closest('tbody') : null) ||
                    tray.querySelector('#qmz-sequences-body') ||
                    document.querySelector('#qmz-sequences-body');

    if (!seqBody) {
      if (window.showToast) window.showToast("Could not locate sequence table. Please ensure the event is opened.", true);
      return;
    }

    const existingRows = Array.from(seqBody.querySelectorAll('tr.qmz-row'));

    let targetRow = null;
    if (targetRowOrIndex instanceof HTMLElement) {
      targetRow = targetRowOrIndex;
    } else if (typeof targetRowOrIndex === 'number' && existingRows[targetRowOrIndex]) {
      targetRow = existingRows[targetRowOrIndex];
    } else if (existingRows.length > 0) {
      targetRow = existingRows[existingRows.length - 1];
    }

    const teams = Array.from(tray.querySelectorAll('.team-card')).map(c => ({
      id: c.getAttribute('data-team-id'),
      name: c.querySelector('.qmz-team-name-input')?.value || 'Team',
      photographer_id: c.querySelector('.qmz-team-photo-select')?.value || null,
      videographer_id: c.querySelector('.qmz-team-video-select')?.value || null,
    }));

    const backdrop = document.createElement('div');
    backdrop.id = 'modal-insert-sharaf-root';
    backdrop.className = 'events-modal-backdrop';

    // 14 segment types arranged to form 2 balanced columns matching video
    const sharafSegments = [
      'Nikah', 'Misaq',
      'Haddiyat', 'Mafsuhiyat',
      'Majmui Ziyafat', 'Aqeeqa',
      'Bethak-QMZ', 'Online',
      'Isteqbal', 'Namaz',
      'Mokib', 'Idaraat',
      'Tahneeq', 'Zafaf Olda'
    ];

    let selectedType = sharafSegments[0];

    backdrop.innerHTML = `
      <div class="insert-sharaf-modal-card">
        <div class="insert-sharaf-modal-header">
          <h3 class="insert-sharaf-modal-title">Insert Inline Sharaf</h3>
          <button type="button" class="insert-sharaf-modal-close" id="btn-close-insert-sharaf" title="Close">×</button>
        </div>

        <div class="modal-field-section-label">SEGMENT TYPE</div>
        <div class="segment-type-pill-grid" id="insert-sharaf-pill-grid">
          ${sharafSegments.map((st, i) => `
            <button type="button" class="btn-segment-type-pill ${i === 0 ? 'active' : ''}" data-type="${st}">
              ${st}
            </button>
          `).join('')}
        </div>

        <div class="modal-field-section-label">NUMBER OF SEGMENTS</div>
        <div class="segment-stepper-wrap">
          <input type="number" id="inline-sharaf-count-input" class="segment-count-input" value="1" min="1" max="100">
        </div>

        <div class="insert-sharaf-modal-footer">
          <button type="button" id="btn-cancel-insert-sharaf" class="btn-pill-cancel">Cancel</button>
          <button type="button" id="btn-confirm-insert-sharaf" class="btn-pill-insert-confirm">Insert Segment(s)</button>
        </div>
      </div>
    `;

    document.body.appendChild(backdrop);

    // Segment pill selection
    const pillButtons = backdrop.querySelectorAll('.btn-segment-type-pill');
    pillButtons.forEach(btn => {
      btn.onclick = () => {
        pillButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        selectedType = btn.getAttribute('data-type') || 'Nikah';
      };
    });

    // Close logic
    const closeModal = () => {
      document.removeEventListener('keydown', onEsc);
      backdrop.remove();
    };
    const onEsc = (e) => {
      if (e.key === 'Escape') closeModal();
    };
    document.addEventListener('keydown', onEsc);

    backdrop.querySelector('#btn-close-insert-sharaf')?.addEventListener('click', closeModal);
    backdrop.querySelector('#btn-cancel-insert-sharaf')?.addEventListener('click', closeModal);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closeModal();
    });

    // Confirm insertion
    backdrop.querySelector('#btn-confirm-insert-sharaf')?.addEventListener('click', () => {
      const countInput = backdrop.querySelector('#inline-sharaf-count-input');
      const count = Math.max(1, parseInt(countInput.value, 10) || 1);

      const placeholder = seqBody.querySelector('.qmz-empty-placeholder');
      if (placeholder) placeholder.remove();

      let insertAfter = targetRow;
      if (!insertAfter && seqBody.children.length > 0) {
        const existingQRows = Array.from(seqBody.querySelectorAll('tr.qmz-row'));
        if (existingQRows.length > 0) insertAfter = existingQRows[existingQRows.length - 1];
      }

      let parentSeq = '01';
      if (insertAfter) {
        const pInput = insertAfter.querySelector('.row-seq');
        if (pInput && pInput.value.trim()) {
          parentSeq = pInput.value.trim();
        }
      }

      // If insertAfter is itself an inline row, find the parent sequence of its banner
      if (insertAfter && insertAfter.classList.contains('is-inline-row')) {
        const bannerId = insertAfter.getAttribute('data-banner-id');
        const banner = bannerId ? seqBody.querySelector(`.inline-sharaf-banner-row[data-banner-id="${bannerId}"]`) : null;
        if (banner) {
          let prev = banner.previousElementSibling;
          while (prev) {
            if (prev.classList.contains('qmz-row') && !prev.classList.contains('is-inline-row')) {
              const pVal = prev.querySelector('.row-seq')?.value?.trim();
              if (pVal) { parentSeq = pVal; break; }
            }
            prev = prev.previousElementSibling;
          }
        }
      }

      // If insertAfter is a normal row with existing inline rows directly below it, skip to the end of those
      if (insertAfter && !insertAfter.classList.contains('is-inline-row')) {
        let next = insertAfter.nextElementSibling;
        while (next && (next.classList.contains('is-inline-row') || next.classList.contains('inline-sharaf-banner-row'))) {
          insertAfter = next;
          next = next.nextElementSibling;
        }
      }

      parentSeq = (parentSeq || '01').replace(/[a-zA-Z]+$/, '');

      // Generate unique banner ID
      const bannerId = 'banner-' + parentSeq.replace(/[^a-zA-Z0-9]/g, '') + '-' + selectedType.toLowerCase().replace(/[^a-z0-9]/g, '') + '-' + Date.now();

      // Create Banner Row
      const bannerTr = document.createElement('tr');
      bannerTr.className = 'inline-sharaf-banner-row';
      bannerTr.setAttribute('data-banner-id', bannerId);
      bannerTr.setAttribute('data-collapsed', 'false');
      bannerTr.setAttribute('data-segment-type', selectedType);
      bannerTr.innerHTML = `
        <td colspan="11">
          <div class="inline-banner-bar">
            <span class="inline-banner-arrow">▼</span>
            <span class="inline-banner-text">${escapeHtml(selectedType.toUpperCase())} (${count} TOTAL)</span>
          </div>
        </td>
      `;

      // Find parent row to inherit team and crew
      let parentTeamId = '';
      let parentPhotoId = null;
      let parentVideoId = null;

      let scanRow = insertAfter;
      while (scanRow) {
        if (scanRow.classList.contains('qmz-row') && !scanRow.classList.contains('is-inline-row') && !scanRow.hasAttribute('data-banner-id')) {
          parentTeamId = scanRow.querySelector('.row-team')?.value || '';
          parentPhotoId = scanRow.querySelector('.row-photo')?.value || null;
          parentVideoId = scanRow.querySelector('.row-video')?.value || null;
          break;
        }
        scanRow = scanRow.previousElementSibling;
      }

      if (parentTeamId && (!parentPhotoId || !parentVideoId)) {
        const tObj = teams.find(t => t.id === parentTeamId || t.name === parentTeamId);
        if (tObj) {
          parentPhotoId = parentPhotoId || tObj.photographer_id;
          parentVideoId = parentVideoId || tObj.videographer_id;
        }
      }

      // Create Inline Child Rows Fragment inheriting parent team and crew
      const fragment = document.createDocumentFragment();
      for (let i = 0; i < count; i++) {
        const rowData = {
          sequence: parentSeq,
          event_abr: selectedType,
          sticker_name: '',
          name: '',
          its: '',
          location: '',
          mobile: '',
          team_id: parentTeamId || (teams[0]?.id || ''),
          photographer_id: parentPhotoId || (teams[0]?.photographer_id || null),
          videographer_id: parentVideoId || (teams[0]?.videographer_id || null),
          is_inline: true,
        };

        const tempDiv = document.createElement('tbody');
        tempDiv.innerHTML = renderSingleQMZRowHtml(rowData, 0, teams, true, bannerId);
        const rowTr = tempDiv.firstElementChild;
        fragment.appendChild(rowTr);
      }

      // Insert into DOM
      if (insertAfter && insertAfter.parentNode === seqBody) {
        seqBody.insertBefore(bannerTr, insertAfter.nextSibling);
        seqBody.insertBefore(fragment, bannerTr.nextSibling);
      } else {
        seqBody.appendChild(bannerTr);
        seqBody.appendChild(fragment);
      }

      const activeTray = seqBody.closest('.subevent-inline-tray') || seqBody.closest('.event-workspace-card') || tray || document;
      renumberQMZRows(activeTray);
      bindQMZRowActions(activeTray);
      scheduleQMZAutosave(evt, activeTray);
      closeModal();

      if (window.showToast) {
        window.showToast(`✔ Inserted ${count} inline ${selectedType} segment(s).`);
      }
    });
  }

  // ── Team Colors Palette ──
  const TEAM_COLORS_PALETTE = [
    { color: '#e11d48', border: '#f43f5e', bg: '#fff1f2', text: '#be123c', darkBg: 'rgba(225, 29, 72, 0.2)' },
    { color: '#2563eb', border: '#3b82f6', bg: '#eff6ff', text: '#1d4ed8', darkBg: 'rgba(37, 99, 235, 0.2)' },
    { color: '#059669', border: '#10b981', bg: '#ecfdf5', text: '#047857', darkBg: 'rgba(5, 150, 105, 0.2)' },
    { color: '#7c3aed', border: '#8b5cf6', bg: '#f5f3ff', text: '#6d28d9', darkBg: 'rgba(124, 58, 237, 0.2)' },
    { color: '#d97706', border: '#f59e0b', bg: '#fffbeb', text: '#b45309', darkBg: 'rgba(217, 119, 6, 0.2)' },
    { color: '#0891b2', border: '#06b6d4', bg: '#ecfeff', text: '#0e7490', darkBg: 'rgba(8, 145, 178, 0.2)' },
  ];

  // Helper: Render HTML5 Canvas snapshot for a team's card
  // Helper: Render HTML5 Canvas snapshot for a team's card (1600x500 layout matching video)
  function renderTeamCanvas(team, teamRows, evt, theme) {
    const canvas = document.createElement('canvas');
    const baseW = 1600;
    const headerH = 75;
    const teamBarH = 65;
    const thH = 46;
    const rowH = 48;
    const rowsCount = Math.max(teamRows.length, 1);
    const tableH = thH + (rowsCount * rowH);
    const baseH = Math.max(headerH + teamBarH + tableH + 40, 500);

    canvas.width = baseW;
    canvas.height = baseH;
    const ctx = canvas.getContext('2d');

    // Card background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, baseW, baseH);

    // Card border
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, baseW - 2, baseH - 2);

    // 1. Header Bar (Date & Slot)
    ctx.fillStyle = '#1e293b';
    ctx.font = '600 20px system-ui, -apple-system, sans-serif';
    ctx.fillText(`Date: `, 32, 46);
    ctx.font = '800 22px system-ui, -apple-system, sans-serif';
    ctx.fillText(`${evt.date || '1449-03-02'}`, 95, 46);

    const slotText = `Slot: ${evt.event_time_slot || evt.slot || 'Morning'}`;
    ctx.font = '800 22px system-ui, -apple-system, sans-serif';
    const slotW = ctx.measureText(slotText).width;
    ctx.fillText(slotText, baseW - 32 - slotW, 46);

    // Top dividing line
    ctx.strokeStyle = theme.color;
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(24, headerH);
    ctx.lineTo(baseW - 24, headerH);
    ctx.stroke();

    // 2. Team Banner
    ctx.fillStyle = theme.color;
    ctx.font = '900 24px system-ui, -apple-system, sans-serif';
    ctx.fillText(team.name.toUpperCase(), 32, headerH + 40);

    ctx.fillStyle = theme.color;
    ctx.font = '700 18px system-ui, -apple-system, sans-serif';
    const photoText = `📷 ${team.photographer || '—'}`;
    const videoText = `🎥 ${team.videographer || '—'}`;
    ctx.fillText(photoText, 320, headerH + 40);

    ctx.fillStyle = '#94a3b8';
    ctx.fillText('|', 320 + ctx.measureText(photoText).width + 16, headerH + 40);

    ctx.fillStyle = theme.color;
    ctx.fillText(videoText, 320 + ctx.measureText(photoText).width + 36, headerH + 40);

    // 3. Table Header
    const tTop = headerH + teamBarH;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(24, tTop, baseW - 48, thH);
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(24, tTop, baseW - 48, thH);

    ctx.fillStyle = '#64748b';
    ctx.font = '800 15px system-ui, -apple-system, sans-serif';
    const cols = [
      { label: '#', x: 55, align: 'center' },
      { label: 'SEQ', x: 130, align: 'center' },
      { label: 'EVENT', x: 230, align: 'left' },
      { label: 'STICKER', x: 420, align: 'left' },
      { label: 'NAME', x: 620, align: 'left' },
      { label: 'LOCATION', x: 1100, align: 'left' },
    ];

    cols.forEach(c => {
      ctx.textAlign = c.align || 'left';
      ctx.fillText(c.label, c.x, tTop + 29);
    });

    // 4. Table Rows
    let curY = tTop + thH;
    teamRows.forEach((r, idx) => {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(24, curY, baseW - 48, rowH);
      ctx.strokeStyle = '#f1f5f9';
      ctx.lineWidth = 1;
      ctx.strokeRect(24, curY, baseW - 48, rowH);

      ctx.fillStyle = '#1e293b';
      ctx.font = '600 16px system-ui, -apple-system, sans-serif';

      ctx.textAlign = 'center';
      ctx.fillText(String(idx + 1), 55, curY + 30);

      ctx.font = '800 17px system-ui, -apple-system, sans-serif';
      ctx.fillStyle = theme.color;
      ctx.fillText(r.seq || '—', 130, curY + 30);

      // Event Badge Pill
      ctx.textAlign = 'left';
      const eventName = (r.event || 'Majlis').toUpperCase();
      ctx.font = '800 13px system-ui, -apple-system, sans-serif';
      const badgeW = ctx.measureText(eventName).width + 20;
      const badgeH = 26;
      ctx.fillStyle = theme.bg;
      ctx.strokeStyle = theme.border;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(220, curY + 11, badgeW, badgeH, 4);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = theme.color;
      ctx.fillText(eventName, 230, curY + 29);

      ctx.fillStyle = '#475569';
      ctx.font = '500 16px system-ui, -apple-system, sans-serif';
      ctx.fillText(r.sticker || '—', 420, curY + 30);
      ctx.fillText(r.name || '—', 620, curY + 30);
      ctx.fillText(r.location || '—', 1100, curY + 30);

      curY += rowH;
    });

    if (teamRows.length === 0) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(24, curY, baseW - 48, rowH);
      ctx.fillStyle = '#94a3b8';
      ctx.textAlign = 'center';
      ctx.font = 'italic 16px system-ui, -apple-system, sans-serif';
      ctx.fillText('No assignments assigned to this team', baseW / 2, curY + 30);
    }

    return canvas;
  }

  // ── Team Images Modal (Screen Recording 0451-48 frame 80s Specification) ──
  function openTeamImagesModal(evt, root = document) {
    const existingModal = document.getElementById('modal-team-images-root');
    if (existingModal) existingModal.remove();

    const teamCards = Array.from(root.querySelectorAll('.team-card'));
    if (teamCards.length === 0) {
      if (window.showToast) window.showToast("Please create teams first to generate team images.", true);
      return;
    }

    const teams = teamCards.map((c, idx) => {
      const photoSel = c.querySelector('.qmz-team-photo-select');
      const videoSel = c.querySelector('.qmz-team-video-select');
      const photoName = photoSel && photoSel.selectedIndex > 0 ? photoSel.options[photoSel.selectedIndex].text : '—';
      const videoName = videoSel && videoSel.selectedIndex > 0 ? videoSel.options[videoSel.selectedIndex].text : '—';
      return {
        id: c.getAttribute('data-team-id'),
        index: idx,
        name: c.querySelector('.qmz-team-name-input')?.value || `Team ${idx + 1}`,
        photographer: photoName,
        videographer: videoName,
        theme: TEAM_COLORS_PALETTE[idx % TEAM_COLORS_PALETTE.length]
      };
    });

    // Extract sequence assignments from table
    const allRows = Array.from(root.querySelectorAll('#qmz-sequences-body tr.qmz-row')).map((r, i) => {
      return {
        idx: i + 1,
        seq: r.querySelector('.row-seq')?.value || String(i + 1),
        event: (r.querySelector('.row-abr')?.value || 'Majlis').toUpperCase(),
        sticker: r.querySelector('.row-sticker')?.value || '—',
        name: r.querySelector('.row-name')?.value || '—',
        location: r.querySelector('.row-loc')?.value || '—',
        team_id: r.querySelector('.row-team')?.value || ''
      };
    });

    let activeTeamIndex = 0;

    const backdrop = document.createElement('div');
    backdrop.id = 'modal-team-images-root';
    backdrop.className = 'events-modal-backdrop';

    const renderModalContent = () => {
      const activeTeam = teams[activeTeamIndex] || teams[0];
      const activeRows = allRows.filter(r => r.team_id === activeTeam.id);
      const theme = activeTeam.theme;

      backdrop.innerHTML = `
        <div class="team-images-modal-card">
          <div class="insert-sharaf-modal-header flex justify-between align-center" style="margin-bottom: 6px;">
            <div class="flex align-center gap-2">
              <span style="font-size: 1.3rem;">📷</span>
              <h3 class="insert-sharaf-modal-title" style="margin: 0; font-size: 1.18rem; font-weight: 800;">
                Team Images <span style="font-size: 0.85rem; font-weight: 600; color: var(--text-secondary);">(${teams.length} teams)</span>
              </h3>
            </div>
            <button type="button" class="insert-sharaf-modal-close" id="btn-close-team-images" title="Close">×</button>
          </div>
          <p style="margin: 0 0 16px 0; font-size: 0.82rem; color: var(--text-secondary);">
            Each team is rendered in a distinct color. Preview, download PNG, copy, or download all in ZIP.
          </p>

          <!-- Team Selector Pills -->
          <div class="flex gap-2 mb-3 flex-wrap" id="team-images-pill-list">
            ${teams.map((t, idx) => {
              const count = allRows.filter(r => r.team_id === t.id).length;
              const isActive = idx === activeTeamIndex;
              return `
                <button type="button" class="team-pill-tab ${isActive ? 'active' : ''}" data-idx="${idx}"
                  style="${isActive ? `background: ${t.theme.color}; border-color: ${t.theme.border};` : `border-color: ${t.theme.border}; color: ${t.theme.text};`}">
                  <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:${isActive ? '#fff' : t.theme.color};"></span>
                  <span>${t.name} (${count})</span>
                </button>
              `;
            }).join('')}
          </div>

          <!-- Preview Card Container -->
          <div class="team-image-card-frame" style="flex: 1; overflow-y: auto; max-height: 440px; margin-bottom: 20px; background: #ffffff;">
            <div style="padding: 14px 20px 8px 20px; display: flex; justify-content: space-between; align-items: center;">
              <span style="font-size: 0.88rem; font-weight: 700; color: #0f172a;">Date: <strong>${evt.date || '1449-03-02'}</strong></span>
              <span style="font-size: 0.88rem; font-weight: 700; color: #0f172a;">Slot: <strong>${evt.event_time_slot || 'Morning'}</strong></span>
            </div>
            <div style="border-top: 2.5px solid ${theme.color}; padding: 10px 20px; display: flex; align-items: center; gap: 14px; background: #ffffff;">
              <span style="font-size: 0.95rem; font-weight: 800; color: ${theme.color};">${activeTeam.name.toUpperCase()}</span>
              <span style="font-size: 0.84rem; font-weight: 600; color: #334155;">📷 ${activeTeam.photographer}</span>
              <span style="color: #cbd5e1;">|</span>
              <span style="font-size: 0.84rem; font-weight: 600; color: #334155;">🎥 ${activeTeam.videographer}</span>
            </div>
            <table style="width: 100%; border-collapse: collapse; font-size: 0.82rem; text-align: left;">
              <thead>
                <tr style="background: #f8fafc; border-top: 1px solid #e2e8f0; border-bottom: 1px solid #e2e8f0;">
                  <th style="padding: 8px 12px; width: 45px; text-align: center; color: #64748b; font-weight: 700;">#</th>
                  <th style="padding: 8px 12px; width: 60px; text-align: center; color: #64748b; font-weight: 700;">SEQ</th>
                  <th style="padding: 8px 12px; width: 90px; color: #64748b; font-weight: 700;">EVENT</th>
                  <th style="padding: 8px 12px; width: 90px; color: #64748b; font-weight: 700;">STICKER</th>
                  <th style="padding: 8px 12px; color: #64748b; font-weight: 700;">NAME</th>
                  <th style="padding: 8px 12px; color: #64748b; font-weight: 700;">LOCATION</th>
                </tr>
              </thead>
              <tbody>
                ${activeRows.length > 0 ? activeRows.map((r, i) => `
                  <tr style="border-bottom: 1px solid #f1f5f9; background: ${i % 2 === 0 ? '#ffffff' : '#f8fafc'};">
                    <td style="padding: 8px 12px; text-align: center; color: #64748b;">${i + 1}</td>
                    <td style="padding: 8px 12px; text-align: center; font-weight: 800; color: ${theme.color};">${r.seq}</td>
                    <td style="padding: 8px 12px;"><span style="display:inline-block; padding: 2px 7px; border-radius: 4px; font-weight: 700; font-size: 0.75rem; background: ${theme.bg}; color: ${theme.color}; border: 1px solid ${theme.border};">${r.event}</span></td>
                    <td style="padding: 8px 12px; color: #475569;">${r.sticker}</td>
                    <td style="padding: 8px 12px; color: #0f172a; font-weight: 600;">${r.name}</td>
                    <td style="padding: 8px 12px; color: #64748b;">${r.location}</td>
                  </tr>
                `).join('') : `
                  <tr><td colspan="6" style="padding: 24px; text-align: center; color: #94a3b8; font-style: italic;">No sequence assignments assigned to ${activeTeam.name}</td></tr>
                `}
              </tbody>
            </table>
          </div>

          <!-- Actions Footer -->
          <div class="flex justify-between align-center flex-wrap gap-2">
            <div class="flex align-center gap-2">
              <button type="button" id="btn-download-single-png" class="btn" style="background: ${theme.color}; color: #ffffff; border-radius: 8px; font-weight: 700; font-size: 0.85rem; padding: 7px 18px; border: none; cursor: pointer; box-shadow: 0 4px 10px ${theme.darkBg};">
                ⬇ Download PNG (${activeTeam.name})
              </button>
              <button type="button" id="btn-copy-clipboard-png" class="btn btn-secondary flex align-center gap-1" style="border-radius: 8px; font-size: 0.85rem; padding: 7px 16px;">
                📋 Copy to Clipboard
              </button>
            </div>
            <button type="button" id="btn-download-all-zip" class="btn btn-secondary flex align-center gap-1" style="border-radius: 8px; font-size: 0.85rem; padding: 7px 18px; font-weight: 600;">
              ⭳ Download All as ZIP
            </button>
          </div>
        </div>
      `;

      // Wire Tab Clicks
      backdrop.querySelectorAll('.team-pill-tab').forEach(b => {
        b.onclick = () => {
          activeTeamIndex = parseInt(b.getAttribute('data-idx'), 10);
          renderModalContent();
        };
      });

      // Close handlers
      backdrop.querySelector('#btn-close-team-images')?.addEventListener('click', closeModal);

      // 1. Download Single PNG
      backdrop.querySelector('#btn-download-single-png')?.addEventListener('click', () => {
        const canvas = renderTeamCanvas(activeTeam, activeRows, evt, theme);
        canvas.toBlob(blob => {
          if (!blob) return;
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          const cleanTeam = activeTeam.name.replace(/[^a-zA-Z0-9_-]/g, '_');
          a.download = `${evt.date || 'Event'}_${cleanTeam}.png`;
          a.href = url;
          a.click();
          URL.revokeObjectURL(url);
          if (window.showToast) window.showToast(`✓ Downloaded ${cleanTeam}.png`);
        }, 'image/png');
      });

      // 2. Copy to Clipboard
      backdrop.querySelector('#btn-copy-clipboard-png')?.addEventListener('click', async () => {
        const canvas = renderTeamCanvas(activeTeam, activeRows, evt, theme);
        canvas.toBlob(async blob => {
          if (!blob) return;
          try {
            if (navigator.clipboard && navigator.clipboard.write) {
              await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
              if (window.showToast) window.showToast(`✓ Image for ${activeTeam.name} copied! Paste directly into WhatsApp.`);
            } else {
              window.showToast("Clipboard API not supported in this browser window.", true);
            }
          } catch (clipErr) {
            console.error("Clipboard copy error:", clipErr);
            window.showToast("Failed to copy image to clipboard", true);
          }
        }, 'image/png');
      });

      // 3. Download All as ZIP
      backdrop.querySelector('#btn-download-all-zip')?.addEventListener('click', async () => {
        const btnZip = backdrop.querySelector('#btn-download-all-zip');
        if (btnZip) {
          btnZip.disabled = true;
          btnZip.textContent = 'Generating ZIP...';
        }

        try {
          const imagesData = teams.map(t => {
            const tRows = allRows.filter(r => r.team_id === t.id);
            const canvas = renderTeamCanvas(t, tRows, evt, t.theme);
            const cleanName = t.name.replace(/[^a-zA-Z0-9_-]/g, '_');
            return {
              name: `${cleanName}.png`,
              base64: canvas.toDataURL('image/png')
            };
          });

          const zipFilename = `${evt.date || 'Event'}_${evt.event_time_slot || 'Slot'}_Teams.zip`;
          const resp = await callApi('events_export_team_images_zip', zipFilename, JSON.stringify(imagesData));
          if (resp && resp.error) {
            window.showToast(resp.error, true);
          } else {
            const savedPath = resp.path || zipFilename;
            window.showToast(`✓ Exported ${imagesData.length} team images to ZIP successfully!`);
          }
        } catch (zipErr) {
          console.error("Export ZIP error:", zipErr);
          window.showToast("Failed to export ZIP archive", true);
        } finally {
          if (btnZip) {
            btnZip.disabled = false;
            btnZip.textContent = '⭳ Download All as ZIP';
          }
        }
      });
    };

    const closeModal = () => {
      document.removeEventListener('keydown', onEsc);
      backdrop.remove();
    };
    const onEsc = (e) => {
      if (e.key === 'Escape') closeModal();
    };
    document.addEventListener('keydown', onEsc);

    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closeModal();
    });

    renderModalContent();
    document.body.appendChild(backdrop);
  }

  // ── Sequential PDF Printing (Screen Recording 0451-48 frame 154s Specification) ──
  function exportQMZSequentialPdf(evt, root = document) {
    const rows = Array.from(root.querySelectorAll('#qmz-sequences-body tr.qmz-row')).map((r, i) => {
      const teamId = r.querySelector('.row-team')?.value || '';
      const teamCard = root.querySelector(`.team-card[data-team-id="${teamId}"]`);
      const teamName = teamCard ? (teamCard.querySelector('.qmz-team-name-input')?.value || 'Team') : (r.querySelector('.row-team option:checked')?.text || '—');
      const photoSel = r.querySelector('.row-photo');
      const videoSel = r.querySelector('.row-video');
      const photoName = photoSel && photoSel.selectedIndex > 0 ? photoSel.options[photoSel.selectedIndex].text : '—';
      const videoName = videoSel && videoSel.selectedIndex > 0 ? videoSel.options[videoSel.selectedIndex].text : '—';
      return {
        idx: i + 1,
        seq: r.querySelector('.row-seq')?.value || String(i + 1),
        event: (r.querySelector('.row-abr')?.value || 'Majlis').toUpperCase(),
        sticker: r.querySelector('.row-sticker')?.value || '—',
        name: r.querySelector('.row-name')?.value || '—',
        location: r.querySelector('.row-loc')?.value || '—',
        teamName: teamName,
        photographer: photoName,
        videographer: videoName
      };
    });

    if (rows.length === 0) {
      if (window.showToast) window.showToast("No sequence rows to print.", true);
      return;
    }

    const title = evt.title || `${evt.date || ''} _${evt.event_time_slot === 'Morning' ? '01M' : '02E'}-QMZ`;
    const cityName = evt.city_name || (document.getElementById('active-safar-label')?.textContent) || 'Mumbai';
    const printHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>${title} (Sequential List)</title>
        <style>
          @page { size: A4 landscape; margin: 10mm 12mm; }
          body { font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; color: #0f172a; margin: 0; padding: 20px; background: #fff; }
          .header-meta { font-size: 11px; font-weight: 700; color: #059669; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 2px; }
          .header-title-bar { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2.5px solid #059669; padding-bottom: 8px; margin-bottom: 14px; }
          .header-title { font-size: 20px; font-weight: 800; color: #0f172a; margin: 0; }
          .header-sub { font-size: 12px; color: #64748b; margin-top: 4px; font-weight: 600; }
          .header-counts { font-size: 12px; font-weight: 700; color: #059669; text-align: right; }
          table { width: 100%; border-collapse: collapse; font-size: 12px; }
          th { background: #f0fdf4; color: #065f46; font-weight: 700; text-align: left; padding: 7px 8px; border-bottom: 1.5px solid #059669; }
          td { padding: 7px 8px; border-bottom: 1px solid #e2e8f0; }
          tr:nth-child(even) td { background: #f8fafc; }
          .badge-ev { display: inline-block; padding: 2px 7px; border-radius: 4px; font-size: 11px; font-weight: 700; background: #ecfdf5; color: #059669; border: 1px solid #a7f3d0; }
          .footer { margin-top: 20px; text-align: center; font-size: 10px; color: #94a3b8; letter-spacing: 0.05em; }
        </style>
      </head>
      <body>
        <div class="header-meta">AIN53 SAFAR MANAGEMENT • ${evt.safar_name || 'SAFAR'}</div>
        <div class="header-title-bar">
          <div>
            <h1 class="header-title">${title} (Sequential List)</h1>
            <div class="header-sub">City: <strong>${cityName}</strong> • Date: <strong>${evt.date || '—'}</strong> • Slot: <strong>${evt.event_time_slot || 'Morning'}</strong></div>
          </div>
          <div class="header-counts">
            <div>Total Sequences: <strong>${rows.length}</strong></div>
            <div style="font-weight: 500; font-size: 10px; color: #64748b;">Generated: ${new Date().toLocaleDateString()}</div>
          </div>
        </div>
        <table>
          <thead>
            <tr>
              <th style="width: 35px; text-align: center;">#</th>
              <th style="width: 50px; text-align: center;">SEQ</th>
              <th style="width: 85px;">EVENT</th>
              <th style="width: 75px;">STICKER</th>
              <th>NAME</th>
              <th>LOCATION</th>
              <th style="width: 100px;">ASSIGNED TEAM</th>
              <th>PHOTOGRAPHER</th>
              <th>VIDEOGRAPHER</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(r => `
              <tr>
                <td style="text-align: center; font-weight: 600;">${r.idx}</td>
                <td style="text-align: center; font-weight: 700; color: #059669;">${r.seq}</td>
                <td><span class="badge-ev">${r.event}</span></td>
                <td>${r.sticker}</td>
                <td style="font-weight: 600;">${r.name}</td>
                <td>${r.location}</td>
                <td style="font-weight: 600;">${r.teamName}</td>
                <td>${r.photographer}</td>
                <td>${r.videographer}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        <div class="footer">Confidential &amp; Internal Use Only</div>
      </body>
      </html>
    `;

    let iframe = document.getElementById('print-seq-iframe');
    if (!iframe) {
      iframe = document.createElement('iframe');
      iframe.id = 'print-seq-iframe';
      iframe.style.position = 'fixed';
      iframe.style.top = '-9999px';
      iframe.style.left = '-9999px';
      iframe.style.width = '0';
      iframe.style.height = '0';
      document.body.appendChild(iframe);
    }

    const doc = iframe.contentWindow.document;
    doc.open();
    doc.write(printHtml);
    doc.close();

    setTimeout(() => {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    }, 250);
  }

  function refreshQMZTeamDropdowns(root = document) {
    const teamCards = Array.from(root.querySelectorAll('.team-card'));
    const teams = teamCards.map((c, i) => ({
      id: c.getAttribute('data-team-id') || `team-${i + 1}`,
      name: c.querySelector('.qmz-team-name-input')?.value || `Team ${i + 1}`
    }));

    root.querySelectorAll('.row-team').forEach(sel => {
      const curr = sel.value;
      sel.innerHTML = '<option value="">— Custom —</option>' + teams.map(t => `<option value="${t.id}" ${t.id === curr || t.name === curr ? 'selected' : ''}>${escapeHtml(t.name)}</option>`).join('');
    });
  }

  // ── Bethak State Engine & Reactive Accordion Architecture (Screen Recording Spec) ──
  function getOrCreateBethakState(evt) {
    if (!evt._bethakState) {
      evt._bethakState = initBethakStateFromEvent(evt);
    }
    return evt._bethakState;
  }

  function initBethakStateFromEvent(evt) {
    const isQMZ = (evt?.event_type === 'QMZ' || evt?.type === 'QMZ' || evt?.title?.toUpperCase?.().includes('QMZ') || evt?.event_type_name?.toUpperCase?.().includes('QMZ'));
    const defaultTeamCount = isQMZ ? 2 : 1;
    let teams = (evt.qmz_teams && Array.isArray(evt.qmz_teams) && evt.qmz_teams.length > 0)
      ? JSON.parse(JSON.stringify(evt.qmz_teams))
      : [];

    if (teams.length === 0) {
      for (let i = 0; i < defaultTeamCount; i++) {
        teams.push({
          id: `team-${Date.now()}-${i + 1}`,
          name: `Team ${i + 1}`,
          photographer_id: null,
          videographer_id: null
        });
      }
    }

    const rawCounts = (evt.bethak_counts && Array.isArray(evt.bethak_counts))
      ? evt.bethak_counts
      : [];

    const existingAssignments = (evt.city_event_assignments && Array.isArray(evt.city_event_assignments))
      ? [...evt.city_event_assignments]
      : [];

    let segments = [];
    if (rawCounts.length > 0) {
      let assignIdx = 0;
      segments = rawCounts.map((bc, sIdx) => {
        const segType = bc.type || 'Nikah';
        const segCount = Math.max(parseInt(bc.count, 10) || 1, 1);
        const rows = [];
        for (let i = 0; i < segCount; i++) {
          const matched = existingAssignments[assignIdx++];
          const isQMZ = segType === 'Bethak QMZ';
          const subType = isQMZ ? (matched?.event_abr && matched.event_abr !== 'Bethak QMZ' ? matched.event_abr : (bc.subTypes?.[i] || '')) : '';
          rows.push({
            localIdx: i + 1,
            seq: matched?.sequence || '',
            its: matched?.its || '',
            sticker: matched?.sticker_name || '',
            name: matched?.name || '',
            mobile: matched?.mobile || '',
            location: matched?.location || '',
            team_id: matched?.team_id || null,
            photographer_id: matched?.photographer_id ?? null,
            videographer_id: matched?.videographer_id ?? null,
            sharaf: subType,
            photo_not_covered: !!matched?.photo_not_covered,
            video_not_covered: !!matched?.video_not_covered
          });
        }
        return {
          id: `seg-${Date.now()}-${sIdx}-${Math.floor(Math.random() * 999)}`,
          type: segType,
          count: segCount,
          isOpen: true,
          rows
        };
      });
    } else if (existingAssignments.length > 0) {
      // Group contiguous assignments of same event_abr
      let currentSeg = null;
      existingAssignments.forEach((asg) => {
        const isBQMZ = ['Bethak QMZ', 'Bethak Qadam', 'Bethak Majlis', 'Bethak Ziyafat'].includes(asg.event_abr);
        const segType = isBQMZ ? 'Bethak QMZ' : (asg.event_abr || 'Nikah');
        if (!currentSeg || currentSeg.type !== segType) {
          currentSeg = {
            id: `seg-${Date.now()}-${segments.length}-${Math.floor(Math.random() * 999)}`,
            type: segType,
            count: 0,
            isOpen: true,
            rows: []
          };
          segments.push(currentSeg);
        }
        currentSeg.count++;
        currentSeg.rows.push({
          localIdx: currentSeg.rows.length + 1,
          seq: asg.sequence || '',
          its: asg.its || '',
          sticker: asg.sticker_name || '',
          name: asg.name || '',
          mobile: asg.mobile || '',
          location: asg.location || '',
          team_id: asg.team_id || null,
          photographer_id: asg.photographer_id ?? null,
          videographer_id: asg.videographer_id ?? null,
          sharaf: isBQMZ ? asg.event_abr : '',
          photo_not_covered: !!asg.photo_not_covered,
          video_not_covered: !!asg.video_not_covered
        });
      });
    }

    recalculateBethakSequences(segments, teams);

    const bState = {
      segments,
      teams,
      notes: evt.special_instructions || evt.notes || '',
      autosaveTimer: null
    };
    evt._bethakState = bState;
    return bState;
  }

  function recalculateBethakSequences(segments, teams = []) {
    let globalSeq = 1;
    segments.forEach((seg) => {
      const targetCount = Math.max(parseInt(seg.count, 10) || 1, 1);
      seg.count = targetCount;

      while (seg.rows.length < targetCount) {
        seg.rows.push({
          localIdx: seg.rows.length + 1,
          seq: '',
          its: '',
          sticker: '',
          name: '',
          mobile: '',
          location: '',
          team_id: null,
          photographer_id: null,
          videographer_id: null,
          sharaf: '',
          photo_not_covered: false,
          video_not_covered: false
        });
      }
      if (seg.rows.length > targetCount) {
        seg.rows = seg.rows.slice(0, targetCount);
      }

      seg.rows.forEach((r, idx) => {
        r.localIdx = idx + 1;
        r.seq = String(globalSeq++);

        if (!r.team_id && teams.length > 0) {
          const autoTeam = teams[(parseInt(r.seq, 10) - 1) % teams.length];
          r.team_id = autoTeam.id;
          if (!r.photographer_id) r.photographer_id = autoTeam.photographer_id;
          if (!r.videographer_id) r.videographer_id = autoTeam.videographer_id;
        }

        if (r.team_id && teams.length > 0) {
          const assignedTeam = teams.find(t => t.id === r.team_id);
          if (assignedTeam) {
            if (!r.photographer_id && assignedTeam.photographer_id) {
              r.photographer_id = assignedTeam.photographer_id;
            }
            if (!r.videographer_id && assignedTeam.videographer_id) {
              r.videographer_id = assignedTeam.videographer_id;
            }
          }
        }
      });
    });
  }

  function renderBethakTeamsContainer(evt, root = document) {
    const container = root.querySelector('#bethak-team-cards-container');
    if (!container) return;

    const bState = getOrCreateBethakState(evt);
    if (bState.teams.length === 0) {
      container.innerHTML = `
        <div style="grid-column: 1/-1; padding: 1.1rem; text-align: center; border: 1px dashed var(--border-glass); border-radius: var(--radius-sm); color: var(--text-secondary); font-size: 0.85rem;">
          No Bethak teams configured yet. Click <strong style="color: var(--accent-green);">+ Add Team</strong> above to set up ceremony crew.
        </div>
      `;
      return;
    }

    container.innerHTML = bState.teams.map((t, idx) => `
      <div class="team-card" data-team-id="${t.id}" data-team-idx="${idx}">
        <div class="team-card-top" style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
          <span class="team-card-title-text" style="font-weight: 700; font-size: 0.95rem; color: #1e293b; user-select: none;">Team ${idx + 1}</span>
          <input type="hidden" class="table-input-inline bethak-team-name-input" value="Team ${idx + 1}">
          ${bState.teams.length > 1 ? `<button type="button" class="btn-part-action btn-remove-bethak-team" title="Remove Team">✕</button>` : ''}
        </div>
        <div>
          <label style="font-size: 0.72rem; color: var(--text-secondary); font-weight: 700;">Photographer</label>
          <select class="input-glass mt-1 bethak-team-photo-select" style="font-size: 0.82rem;">
            ${buildContributorOptions(t.photographer_id, 'Photographer')}
          </select>
        </div>
        <div>
          <label style="font-size: 0.72rem; color: var(--text-secondary); font-weight: 700;">Videographer</label>
          <select class="input-glass mt-1 bethak-team-video-select" style="font-size: 0.82rem;">
            ${buildContributorOptions(t.videographer_id, 'Videographer')}
          </select>
        </div>
      </div>
    `).join('');

    container.querySelectorAll('.team-card').forEach(card => {
      const tIdx = parseInt(card.getAttribute('data-team-idx'), 10);
      const team = bState.teams[tIdx];
      if (!team) return;

      const photoSel = card.querySelector('.bethak-team-photo-select');
      const videoSel = card.querySelector('.bethak-team-video-select');
      const removeBtn = card.querySelector('.btn-remove-bethak-team');

      photoSel?.addEventListener('change', () => {
        const newPhotoId = photoSel.value ? parseInt(photoSel.value, 10) : null;
        team.photographer_id = newPhotoId;

        // Propagate to all rows in state
        bState.segments.forEach(seg => {
          seg.rows.forEach(r => {
            if (r.team_id === team.id || (!r.team_id && bState.teams.length === 1)) {
              if (!r.team_id) r.team_id = team.id;
              r.photographer_id = newPhotoId;
            }
          });
        });

        // Live-update DOM selects for all matching rows
        root.querySelectorAll('#bethak-segments-list .bethak-segment-card').forEach(cardEl => {
          const sIdx = parseInt(cardEl.getAttribute('data-seg-idx'), 10);
          const seg = bState.segments[sIdx];
          if (!seg) return;

          cardEl.querySelectorAll('.bethak-row-item').forEach(tr => {
            const rIdx = parseInt(tr.getAttribute('data-row-idx'), 10);
            const r = seg.rows[rIdx];
            if (r && (r.team_id === team.id || (!r.team_id && bState.teams.length === 1))) {
              const rPhotoSel = tr.querySelector('.b-row-photo');
              if (rPhotoSel) {
                rPhotoSel.value = newPhotoId ? String(newPhotoId) : '';
              }
              const rTeamSel = tr.querySelector('.b-row-team');
              if (rTeamSel && !rTeamSel.value && team.id) {
                rTeamSel.value = team.id;
              }
            }
          });

          const assignedCount = seg.rows.filter(r => r.photographer_id || r.team_id).length;
          const assignedBadgeEl = cardEl.querySelector('.bethak-seg-assigned-badge');
          if (assignedBadgeEl && (seg.type !== 'Bethak QMZ' || seg.rows.every(r => r.sharaf))) {
            assignedBadgeEl.textContent = `${assignedCount}/${seg.count} assigned`;
          }
        });

        const totalAssignedSeqs = bState.segments.reduce((acc, s) => acc + s.rows.filter(r => r.photographer_id || r.team_id).length, 0);
        const topAssignedBadge = root.querySelector('#bethak-assigned-badge');
        if (topAssignedBadge) topAssignedBadge.textContent = `Assigned: ${totalAssignedSeqs}`;

        recheckActiveUncoveredInDom(root);
        scheduleBethakAutosave(evt, root);
      });

      videoSel?.addEventListener('change', () => {
        const newVideoId = videoSel.value ? parseInt(videoSel.value, 10) : null;
        team.videographer_id = newVideoId;

        bState.segments.forEach(seg => {
          seg.rows.forEach(r => {
            if (r.team_id === team.id || (!r.team_id && bState.teams.length === 1)) {
              if (!r.team_id) r.team_id = team.id;
              r.videographer_id = newVideoId;
            }
          });
        });

        root.querySelectorAll('#bethak-segments-list .bethak-segment-card').forEach(cardEl => {
          const sIdx = parseInt(cardEl.getAttribute('data-seg-idx'), 10);
          const seg = bState.segments[sIdx];
          if (!seg) return;

          cardEl.querySelectorAll('.bethak-row-item').forEach(tr => {
            const rIdx = parseInt(tr.getAttribute('data-row-idx'), 10);
            const r = seg.rows[rIdx];
            if (r && (r.team_id === team.id || (!r.team_id && bState.teams.length === 1))) {
              const rVideoSel = tr.querySelector('.b-row-video');
              if (rVideoSel) {
                rVideoSel.value = newVideoId ? String(newVideoId) : '';
              }
              const rTeamSel = tr.querySelector('.b-row-team');
              if (rTeamSel && !rTeamSel.value && team.id) {
                rTeamSel.value = team.id;
              }
            }
          });
        });

        recheckActiveUncoveredInDom(root);
        scheduleBethakAutosave(evt, root);
      });

      removeBtn?.addEventListener('click', () => {
        bState.teams.splice(tIdx, 1);
        bState.teams.forEach((t, i) => {
          t.name = `Team ${i + 1}`;
        });
        renderBethakTeamsContainer(evt, root);
        refreshBethakTeamDropdownsInRows(evt, root);
        scheduleBethakAutosave(evt, root);
      });
    });
  }

  function refreshBethakTeamDropdownsInRows(evt, root = document) {
    const bState = getOrCreateBethakState(evt);
    root.querySelectorAll('#bethak-segments-list .b-row-team').forEach(sel => {
      const curr = sel.value;
      sel.innerHTML = '<option value="">Unassigned</option>' + bState.teams.map(t => `<option value="${t.id}" ${t.id === curr ? 'selected' : ''}>${escapeHtml(t.name)}</option>`).join('');
    });
  }

  function syncDomRowsToState(card, seg) {
    if (!card || !seg) return;
    card.querySelectorAll('.bethak-row-item').forEach(tr => {
      const idx = parseInt(tr.getAttribute('data-row-idx'), 10);
      const r = seg.rows[idx];
      if (!r) return;
      const itsInp = tr.querySelector('.b-row-its');
      const stickerInp = tr.querySelector('.b-row-sticker');
      const nameInp = tr.querySelector('.b-row-name');
      const mobInp = tr.querySelector('.b-row-mob');
      const locInp = tr.querySelector('.b-row-loc');
      const teamSel = tr.querySelector('.b-row-team');
      const photoSel = tr.querySelector('.b-row-photo');
      const videoSel = tr.querySelector('.b-row-video');
      const sharafSel = tr.querySelector('.bethak-sharaf-select');

      if (itsInp) r.its = itsInp.value;
      if (stickerInp) r.sticker = stickerInp.value;
      if (nameInp) r.name = nameInp.value;
      if (mobInp) r.mobile = mobInp.value;
      if (locInp) r.location = locInp.value;
      if (teamSel) r.team_id = teamSel.value || null;
      if (photoSel) r.photographer_id = photoSel.value ? parseInt(photoSel.value, 10) : null;
      if (videoSel) r.videographer_id = videoSel.value ? parseInt(videoSel.value, 10) : null;
      if (sharafSel) r.sharaf = sharafSel.value;
    });
  }

  // ── Swap Bethak / Segment Rows (Up / Down) ──
  function swapBethakRows(evt, root, segIdx, fromRowIdx, toRowIdx) {
    const bState = getOrCreateBethakState(evt);
    const seg = bState.segments[segIdx];
    if (!seg || fromRowIdx < 0 || toRowIdx < 0 || fromRowIdx >= seg.rows.length || toRowIdx >= seg.rows.length) return;

    const card = root.querySelector(`.bethak-segment-card[data-seg-idx="${segIdx}"]`);
    if (card) {
      syncDomRowsToState(card, seg);
    }

    const temp = seg.rows[fromRowIdx];
    seg.rows[fromRowIdx] = seg.rows[toRowIdx];
    seg.rows[toRowIdx] = temp;

    recalculateBethakSequences(bState.segments, bState.teams);
    renderBethakSegmentsContainer(evt, root);

    setTimeout(() => {
      const refreshedCard = root.querySelector(`.bethak-segment-card[data-seg-idx="${segIdx}"]`);
      if (refreshedCard) {
        const movedTr = refreshedCard.querySelector(`.bethak-row-item[data-row-idx="${toRowIdx}"]`);
        if (movedTr) {
          movedTr.classList.add('row-moved-highlight');
          movedTr.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          setTimeout(() => movedTr.classList.remove('row-moved-highlight'), 1200);
        }
      }
    }, 40);

    scheduleBethakAutosave(evt, root);
  }

  // ── Smooth FLIP Reordering Animation for Bethak Segments ──
  function animateAndSwapBethakSegments(evt, root, fromIdx, toIdx) {
    const listContainer = root.querySelector('#bethak-segments-list');
    if (!listContainer) return;

    const cards = Array.from(listContainer.querySelectorAll('.bethak-segment-card'));
    const cardA = cards[fromIdx];
    const cardB = cards[toIdx];
    if (!cardA || !cardB) return;

    // 1. Capture exact bounding coordinates
    const rectA = cardA.getBoundingClientRect();
    const rectB = cardB.getBoundingClientRect();
    const diffA = rectB.top - rectA.top;
    const diffB = rectA.top - rectB.top;

    // 2. Set animating state and highlight
    cardA.classList.add('is-animating-move', 'moved-highlight');
    cardB.classList.add('is-animating-move');

    // Force layout reflow
    cardA.offsetHeight;

    // 3. Smooth spring slide
    cardA.style.transition = 'transform 0.32s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.32s ease';
    cardB.style.transition = 'transform 0.32s cubic-bezier(0.22, 1, 0.36, 1)';
    cardA.style.transform = `translateY(${diffA}px)`;
    cardB.style.transform = `translateY(${diffB}px)`;

    setTimeout(() => {
      // Clear inline styles
      cardA.style.transition = '';
      cardB.style.transition = '';
      cardA.style.transform = '';
      cardB.style.transform = '';
      cardA.classList.remove('is-animating-move');
      cardB.classList.remove('is-animating-move');

      // Swap in state
      const bState = getOrCreateBethakState(evt);
      const temp = bState.segments[fromIdx];
      bState.segments[fromIdx] = bState.segments[toIdx];
      bState.segments[toIdx] = temp;

      // Recalculate sequences and re-render
      recalculateBethakSequences(bState.segments, bState.teams);
      renderBethakSegmentsContainer(evt, root);

      // Highlight target card in its new position so the user's eye follows it
      const newCards = listContainer.querySelectorAll('.bethak-segment-card');
      const targetCard = newCards[toIdx];
      if (targetCard) {
        targetCard.classList.add('moved-highlight');
        targetCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        setTimeout(() => {
          targetCard.classList.remove('moved-highlight');
        }, 1400);
      }

      scheduleBethakAutosave(evt, root);
    }, 320);
  }

  function renderBethakSegmentsContainer(evt, root = document) {
    const listContainer = root.querySelector('#bethak-segments-list');
    if (!listContainer) return;

    const bState = getOrCreateBethakState(evt);

    // Update summary badges
    const totalSeqs = bState.segments.reduce((acc, s) => acc + s.count, 0);
    const assignedSeqs = bState.segments.reduce((acc, s) => acc + s.rows.filter(r => r.photographer_id || r.team_id).length, 0);

    const totalBadge = root.querySelector('#bethak-total-badge');
    if (totalBadge) totalBadge.textContent = `Total: ${totalSeqs}`;

    const assignedBadge = root.querySelector('#bethak-assigned-badge');
    if (assignedBadge) assignedBadge.textContent = `Assigned: ${assignedSeqs}`;

    if (bState.segments.length === 0) {
      listContainer.innerHTML = `
        <div style="padding: 2rem; text-align: center; border: 1px dashed var(--border-glass); border-radius: 10px; color: var(--text-muted); font-size: 0.9rem;">
          No ceremony segments added yet. Choose a ceremony type below and click <strong>+ Add Segment</strong>.
        </div>
      `;
      return;
    }

    listContainer.innerHTML = bState.segments.map((seg, sIdx) => {
      const assignedCount = seg.rows.filter(r => r.photographer_id || r.team_id).length;
      const isQMZ = seg.type === 'Bethak QMZ';
      const unpickedCount = isQMZ ? seg.rows.filter(r => !r.sharaf).length : 0;

      return `
        <div class="bethak-segment-card ${seg.isOpen ? 'is-open' : ''}" data-seg-id="${seg.id}" data-seg-idx="${sIdx}">
          <div class="bethak-segment-header">
            <div class="bethak-seg-left">
              <div class="bethak-reorder-group">
                <button type="button" class="btn-seg-reorder btn-seg-up" title="Move Segment Up" ${sIdx === 0 ? 'disabled' : ''}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg>
                </button>
                <button type="button" class="btn-seg-reorder btn-seg-down" title="Move Segment Down" ${sIdx === bState.segments.length - 1 ? 'disabled' : ''}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                </button>
              </div>
              <span class="bethak-seg-idx-badge">${sIdx + 1}</span>
              <span class="bethak-seg-title">${escapeHtml(seg.type)}</span>
              ${isQMZ && unpickedCount > 0 ? `
                <span class="bethak-seg-warning-badge">${unpickedCount} NEED SHARAF</span>
              ` : `
                <span class="bethak-seg-assigned-badge">${assignedCount}/${seg.count} assigned</span>
              `}
            </div>
            <div class="bethak-seg-right">
              <div class="bethak-stepper">
                <button type="button" class="btn-bethak-step btn-step-minus" title="Decrease count" ${seg.count <= 1 ? 'disabled' : ''}>−</button>
                <span class="bethak-stepper-val">${seg.count}</span>
                <button type="button" class="btn-bethak-step btn-step-plus" title="Increase count">+</button>
              </div>
              <button type="button" class="btn-bethak-delete-seg" title="Delete Segment">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
              </button>
              <button type="button" class="btn-bethak-toggle-chevron" title="Expand/Collapse">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
              </button>
            </div>
          </div>

          <div class="bethak-segment-body">
            <div class="bethak-nested-table-wrap">
              <table class="bethak-nested-table">
                <thead>
                  <tr>
                    <th style="width: 52px; text-align: center;">MOVE</th>
                    <th style="width: 32px; text-align: center;">#</th>
                    <th style="width: 46px; text-align: center;">SEQ</th>
                    ${isQMZ ? '<th style="min-width: 140px;">SHARAF</th>' : ''}
                    <th style="min-width: 100px;">ITS</th>
                    <th style="min-width: 100px;">STICKER</th>
                    <th style="min-width: 140px;">NAME</th>
                    <th style="min-width: 110px;">MOBILE</th>
                    <th style="min-width: 150px;">LOCATION</th>
                    <th style="min-width: 140px;">ASSIGNED TEAM</th>
                    <th style="min-width: 140px;">PHOTO</th>
                    <th style="min-width: 140px;">VIDEO</th>
                  </tr>
                </thead>
                <tbody>
                  ${seg.rows.map((r, rIdx) => {
                    const isMisaq = seg.type === 'Misaq';
                    const isPhotoOnly = ['Haddiyat', 'Mafsuhiyat'].includes(seg.type) || isMisaq;
                    const assignedTeam = bState.teams.find(t => t.id === r.team_id) || (bState.teams.length === 1 ? bState.teams[0] : null);
                    if (!r.team_id && assignedTeam) r.team_id = assignedTeam.id;
                    if (!r.photographer_id && assignedTeam?.photographer_id) r.photographer_id = assignedTeam.photographer_id;
                    if (!r.videographer_id && assignedTeam?.videographer_id) r.videographer_id = assignedTeam.videographer_id;

                    const effectivePhotoId = r.photographer_id ?? assignedTeam?.photographer_id ?? null;
                    const effectiveVideoId = r.videographer_id ?? assignedTeam?.videographer_id ?? null;
                    return `
                      <tr class="bethak-row-item" data-row-idx="${rIdx}">
                        <td style="text-align: center; vertical-align: middle; white-space: nowrap;">
                          <div class="row-reorder-group">
                            <button type="button" class="btn-row-reorder btn-row-up" data-seg-idx="${sIdx}" data-row-idx="${rIdx}" title="Move Row Up" ${rIdx === 0 ? 'disabled' : ''}>
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg>
                            </button>
                            <button type="button" class="btn-row-reorder btn-row-down" data-seg-idx="${sIdx}" data-row-idx="${rIdx}" title="Move Row Down" ${rIdx === seg.rows.length - 1 ? 'disabled' : ''}>
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                            </button>
                          </div>
                        </td>
                        <td style="text-align: center; font-size: 0.76rem; color: var(--text-muted);">${rIdx + 1}</td>
                        <td style="text-align: center;">
                          <span style="font-family: var(--font-mono, monospace); font-weight: 700; color: var(--text-primary); font-size: 0.85rem;">${escapeHtml(String(r.seq || ''))}</span>
                        </td>
                        ${isQMZ ? `
                          <td>
                            <select class="table-input-inline bethak-sharaf-select ${!r.sharaf ? 'unpicked' : ''}" data-row-idx="${rIdx}">
                              <option value="">Pick sharaf!</option>
                              <option value="Bethak Qadam" ${r.sharaf === 'Bethak Qadam' ? 'selected' : ''}>Bethak Qadam</option>
                              <option value="Bethak Majlis" ${r.sharaf === 'Bethak Majlis' ? 'selected' : ''}>Bethak Majlis</option>
                              <option value="Bethak Ziyafat" ${r.sharaf === 'Bethak Ziyafat' ? 'selected' : ''}>Bethak Ziyafat</option>
                            </select>
                          </td>
                        ` : ''}
                        <td><input type="text" class="table-input-inline b-row-its" placeholder="ITS" value="${escapeHtml(r.its || '')}" data-row-idx="${rIdx}"></td>
                        <td><input type="text" class="table-input-inline b-row-sticker" placeholder="Sticker" value="${escapeHtml(r.sticker || '')}" data-row-idx="${rIdx}"></td>
                        <td><input type="text" class="table-input-inline b-row-name" placeholder="Host / Mumineen Name" value="${escapeHtml(r.name || '')}" style="font-weight: 600;" data-row-idx="${rIdx}"></td>
                        <td><input type="text" class="table-input-inline b-row-mob" placeholder="Phone" value="${escapeHtml(r.mobile || '')}" data-row-idx="${rIdx}"></td>
                        <td><input type="text" class="table-input-inline b-row-loc" placeholder="Location / Address" value="${escapeHtml(r.location || '')}" data-row-idx="${rIdx}"></td>
                        <td>
                          <select class="table-input-inline b-row-team" data-row-idx="${rIdx}">
                            <option value="">Unassigned</option>
                            ${bState.teams.map(t => `<option value="${t.id}" ${t.id === r.team_id ? 'selected' : ''}>${escapeHtml(t.name)}</option>`).join('')}
                          </select>
                        </td>
                        <td>
                          <select class="table-input-inline b-row-photo" data-row-idx="${rIdx}">
                            ${buildContributorOptions(effectivePhotoId, 'Photographer')}
                          </select>
                        </td>
                        <td>
                          ${isPhotoOnly ? `
                            <span style="font-size:0.75rem; color:var(--text-muted); font-style:italic;">None (Photo Only)</span>
                          ` : `
                            <select class="table-input-inline b-row-video" data-row-idx="${rIdx}">
                              ${buildContributorOptions(effectiveVideoId, 'Videographer')}
                            </select>
                          `}
                        </td>
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Bind segment card events
    listContainer.querySelectorAll('.bethak-segment-card').forEach(card => {
      const sIdx = parseInt(card.getAttribute('data-seg-idx'), 10);
      const seg = bState.segments[sIdx];
      if (!seg) return;

      // Row reordering buttons (Up / Down)
      card.querySelectorAll('.btn-row-up').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const rIdx = parseInt(btn.getAttribute('data-row-idx'), 10);
          if (rIdx > 0) {
            swapBethakRows(evt, root, sIdx, rIdx, rIdx - 1);
          }
        });
      });

      card.querySelectorAll('.btn-row-down').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const rIdx = parseInt(btn.getAttribute('data-row-idx'), 10);
          if (rIdx < seg.rows.length - 1) {
            swapBethakRows(evt, root, sIdx, rIdx, rIdx + 1);
          }
        });
      });

      // Reorder buttons with smooth animation
      const upBtn = card.querySelector('.btn-seg-up');
      const downBtn = card.querySelector('.btn-seg-down');

      upBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (sIdx > 0) {
          animateAndSwapBethakSegments(evt, root, sIdx, sIdx - 1);
        }
      });

      downBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (sIdx < bState.segments.length - 1) {
          animateAndSwapBethakSegments(evt, root, sIdx, sIdx + 1);
        }
      });

      // Stepper buttons
      const minusBtn = card.querySelector('.btn-step-minus');
      const plusBtn = card.querySelector('.btn-step-plus');

      minusBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (seg.count > 1) {
          seg.count -= 1;
          recalculateBethakSequences(bState.segments, bState.teams);
          renderBethakSegmentsContainer(evt, root);
          scheduleBethakAutosave(evt, root);
        }
      });

      plusBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        seg.count += 1;
        recalculateBethakSequences(bState.segments, bState.teams);
        renderBethakSegmentsContainer(evt, root);
        scheduleBethakAutosave(evt, root);
      });

      // Delete button
      const deleteBtn = card.querySelector('.btn-bethak-delete-seg');
      deleteBtn?.addEventListener('click', async (e) => {
        e.stopPropagation();
        const confirmed = window.confirmModal ? await window.confirmModal({
          title: 'Remove Bethak Segment?',
          message: `Are you sure you want to remove segment <strong>"${seg.type}"</strong> (${seg.count} sequences)?`,
          details: 'The remaining segments in this Bethak session will be automatically re-sequenced.',
          confirmText: 'Remove Segment',
          cancelText: 'Cancel',
          type: 'danger',
          icon: 'trash'
        }) : confirm(`Remove segment "${seg.type}" (${seg.count} sequences)?`);

        if (confirmed) {
          bState.segments.splice(sIdx, 1);
          recalculateBethakSequences(bState.segments, bState.teams);
          renderBethakSegmentsContainer(evt, root);
          scheduleBethakAutosave(evt, root);
        }
      });

      // Expand / Collapse Chevron & Header click
      const header = card.querySelector('.bethak-segment-header');
      const toggleOpen = () => {
        seg.isOpen = !seg.isOpen;
        card.classList.toggle('is-open', seg.isOpen);
      };

      header?.addEventListener('click', (e) => {
        if (e.target.closest('.bethak-stepper') || e.target.closest('.btn-bethak-delete-seg') || e.target.closest('.bethak-reorder-group')) {
          return;
        }
        toggleOpen();
      });

      // Bind row inputs
      card.querySelectorAll('.bethak-row-item').forEach(tr => {
        const rIdx = parseInt(tr.getAttribute('data-row-idx'), 10);
        const row = seg.rows[rIdx];
        if (!row) return;

        tr.querySelector('.b-row-its')?.addEventListener('input', (e) => {
          row.its = e.target.value;
          scheduleBethakAutosave(evt, root);
        });

        tr.querySelector('.b-row-sticker')?.addEventListener('input', (e) => {
          row.sticker = e.target.value;
          scheduleBethakAutosave(evt, root);
        });

        tr.querySelector('.b-row-name')?.addEventListener('input', (e) => {
          row.name = e.target.value;
          scheduleBethakAutosave(evt, root);
        });

        tr.querySelector('.b-row-mob')?.addEventListener('input', (e) => {
          row.mobile = e.target.value;
          scheduleBethakAutosave(evt, root);
        });

        tr.querySelector('.b-row-loc')?.addEventListener('input', (e) => {
          row.location = e.target.value;
          scheduleBethakAutosave(evt, root);
        });

        tr.querySelector('.bethak-sharaf-select')?.addEventListener('change', (e) => {
          row.sharaf = e.target.value;
          e.target.classList.toggle('unpicked', !row.sharaf);
          const unpicked = seg.rows.filter(r => !r.sharaf).length;
          const assigned = seg.rows.filter(r => r.photographer_id || r.team_id).length;
          const leftBadge = card.querySelector('.bethak-seg-warning-badge, .bethak-seg-assigned-badge');
          if (leftBadge) {
            if (unpicked > 0) {
              leftBadge.className = 'bethak-seg-warning-badge';
              leftBadge.textContent = `${unpicked} NEED SHARAF`;
            } else {
              leftBadge.className = 'bethak-seg-assigned-badge';
              leftBadge.textContent = `${assigned}/${seg.count} assigned`;
            }
          }
          scheduleBethakAutosave(evt, root);
        });

        const teamSel = tr.querySelector('.b-row-team');
        const photoSel = tr.querySelector('.b-row-photo');
        const videoSel = tr.querySelector('.b-row-video');

        teamSel?.addEventListener('change', () => {
          row.team_id = teamSel.value || null;
          const matchedTeam = bState.teams.find(t => t.id === row.team_id);
          if (matchedTeam) {
            if (matchedTeam.photographer_id && photoSel) {
              row.photographer_id = matchedTeam.photographer_id;
              photoSel.value = String(matchedTeam.photographer_id);
            }
            if (matchedTeam.videographer_id && videoSel) {
              row.videographer_id = matchedTeam.videographer_id;
              videoSel.value = String(matchedTeam.videographer_id);
            }
          }
          const assignedCount = seg.rows.filter(r => r.photographer_id || r.team_id).length;
          const assignedBadgeEl = card.querySelector('.bethak-seg-assigned-badge');
          if (assignedBadgeEl && (seg.type !== 'Bethak QMZ' || seg.rows.every(r => r.sharaf))) {
            assignedBadgeEl.textContent = `${assignedCount}/${seg.count} assigned`;
          }
          const totalAssignedSeqs = bState.segments.reduce((acc, s) => acc + s.rows.filter(r => r.photographer_id || r.team_id).length, 0);
          const topAssignedBadge = root.querySelector('#bethak-assigned-badge');
          if (topAssignedBadge) topAssignedBadge.textContent = `Assigned: ${totalAssignedSeqs}`;

          scheduleBethakAutosave(evt, root);
        });

        photoSel?.addEventListener('change', () => {
          row.photographer_id = photoSel.value ? parseInt(photoSel.value, 10) : null;
          const assignedCount = seg.rows.filter(r => r.photographer_id || r.team_id).length;
          const assignedBadgeEl = card.querySelector('.bethak-seg-assigned-badge');
          if (assignedBadgeEl && (seg.type !== 'Bethak QMZ' || seg.rows.every(r => r.sharaf))) {
            assignedBadgeEl.textContent = `${assignedCount}/${seg.count} assigned`;
          }
          const totalAssignedSeqs = bState.segments.reduce((acc, s) => acc + s.rows.filter(r => r.photographer_id || r.team_id).length, 0);
          const topAssignedBadge = root.querySelector('#bethak-assigned-badge');
          if (topAssignedBadge) topAssignedBadge.textContent = `Assigned: ${totalAssignedSeqs}`;

          scheduleBethakAutosave(evt, root);
        });

        videoSel?.addEventListener('change', () => {
          row.videographer_id = videoSel.value ? parseInt(videoSel.value, 10) : null;
          scheduleBethakAutosave(evt, root);
        });
      });
    });
  }

  function openBethakImportSharafModal(evt, root = document) {
    const existingModal = document.getElementById('modal-bethak-import-root');
    if (existingModal) existingModal.remove();

    const bState = getOrCreateBethakState(evt);

    const backdrop = document.createElement('div');
    backdrop.id = 'modal-bethak-import-root';
    backdrop.className = 'events-modal-backdrop';

    let parsedExcelData = null;
    let selectedSlotKey = evt.event_time_slot || 'Evening';

    backdrop.innerHTML = `
      <div class="events-modal-card" style="max-width: 720px; width: 95%;">
        <div class="events-modal-header">
          <div class="events-modal-title">
            <span class="modal-title-icon">📊</span>
            <span>Import Sharaf Data (Excel / CSV)</span>
          </div>
          <button type="button" class="events-modal-close-btn" id="btn-close-bethak-import" title="Close (Esc)">✕</button>
        </div>

        <p class="modal-helper-text" style="margin: -0.25rem 0 0.75rem 0;">
          Upload a Sharaf Excel workbook (e.g. <code>Sharaf_Data_*.xlsx</code>) to automatically generate Bethak ceremony segments (Misaq, Qadam, Ziyafat, etc.) and map attendee records.
        </p>

        <!-- Dropzone / File Picker Area -->
        <div id="sharaf-file-dropzone" style="border: 2px dashed rgba(16, 185, 129, 0.4); background: rgba(16, 185, 129, 0.04); border-radius: 12px; padding: 1.25rem 1rem; text-align: center; cursor: pointer; transition: all 0.2s ease;">
          <div style="font-size: 1.8rem; margin-bottom: 0.35rem;">📂</div>
          <div style="font-weight: 700; font-size: 0.95rem; color: var(--text-primary); margin-bottom: 0.25rem;">
            Click to Browse or Drag &amp; Drop Sharaf Excel File
          </div>
          <div style="font-size: 0.78rem; color: var(--text-muted); margin-bottom: 0.75rem;">
            Supports .xlsx, .xls, and .csv formats
          </div>
          <button type="button" id="btn-browse-sharaf-file" class="btn btn-primary btn-sm" style="font-weight: 700; padding: 0.5rem 1.4rem;">
            📁 Select Sharaf File
          </button>
          <input type="file" id="bethak-sharaf-dom-picker" accept=".xlsx,.xls,.csv" style="display: none;">
        </div>

        <!-- Excel Preview Card (Hidden until file selected) -->
        <div id="sharaf-excel-preview-card" class="hidden" style="margin-top: 1rem; background: var(--bg-glass-card); border: 1.5px solid rgba(16, 185, 129, 0.35); border-radius: 12px; padding: 1rem;">
          <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--border-glass); padding-bottom: 0.65rem; margin-bottom: 0.75rem;">
            <div>
              <div id="sharaf-preview-filename" style="font-weight: 800; font-size: 0.92rem; color: var(--accent-green);">File Loaded</div>
              <div id="sharaf-preview-meta" style="font-size: 0.78rem; color: var(--text-muted); margin-top: 2px;"></div>
            </div>
            <button type="button" id="btn-change-sharaf-file" class="btn btn-secondary btn-sm" style="font-size: 0.76rem; padding: 3px 8px;">Change File</button>
          </div>

          <!-- Time Slot Selection Pills -->
          <div style="margin-bottom: 0.85rem;">
            <label class="modal-form-label" style="margin-bottom: 0.35rem; display: block;">Select Ceremony Time Slot to Import:</label>
            <div id="sharaf-slot-pills" style="display: flex; gap: 8px; flex-wrap: wrap;"></div>
            <div style="font-size: 0.76rem; color: #64748b; margin-top: 6px; line-height: 1.3;">
              ℹ️ Current event is in the <strong>${escapeHtml(evt.event_time_slot || 'Morning')}</strong> slot. To import records from other times, click <strong>Evening</strong> or <strong>All Records</strong> above.
            </div>
          </div>

          <!-- Segment Breakdown List -->
          <div>
            <label class="modal-form-label" style="margin-bottom: 0.35rem; display: block;">Detected Ceremony Segments:</label>
            <div id="sharaf-segments-summary" style="display: flex; flex-direction: column; gap: 6px; max-height: 180px; overflow-y: auto; padding-right: 4px;"></div>
          </div>
        </div>

        <!-- Alternative: Collapsible TSV Paste Area -->
        <details style="margin-top: 1rem; border: 1px solid var(--border-glass); border-radius: 10px; padding: 0.6rem 0.85rem;">
          <summary style="font-size: 0.82rem; font-weight: 700; color: var(--text-secondary); cursor: pointer;">
            📋 Or paste manual Excel / TSV rows directly
          </summary>
          <div class="flex flex-col gap-2 mt-2">
            <div style="font-size: 0.74rem; color: var(--text-muted);">
              Expected columns: <strong>ITS, Sticker, Name, Mobile, Location</strong>
            </div>
            <textarea id="bethak-import-tsv-text" class="modal-input modal-textarea" rows="4" placeholder="ITS\tSticker\tName\tMobile\tLocation" style="width: 100%; box-sizing: border-box; font-family: 'JetBrains Mono', monospace; font-size: 0.80rem;"></textarea>
          </div>
        </details>

        <div class="modal-footer-actions" style="margin-top: 1.25rem;">
          <button type="button" id="btn-cancel-bethak-import" class="btn btn-secondary">Cancel</button>
          <button type="button" id="btn-apply-bethak-import" class="btn btn-primary flex align-center gap-1" style="font-weight: 700; padding: 0.7rem 1.6rem;">
            <span>Apply Sharaf Data</span>
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(backdrop);

    const closeBtn = backdrop.querySelector('#btn-close-bethak-import');
    const cancelBtn = backdrop.querySelector('#btn-cancel-bethak-import');
    const applyBtn = backdrop.querySelector('#btn-apply-bethak-import');
    const dropzone = backdrop.querySelector('#sharaf-file-dropzone');
    const browseBtn = backdrop.querySelector('#btn-browse-sharaf-file');
    const domPicker = backdrop.querySelector('#bethak-sharaf-dom-picker');
    const previewCard = backdrop.querySelector('#sharaf-excel-preview-card');
    const filenameEl = backdrop.querySelector('#sharaf-preview-filename');
    const metaEl = backdrop.querySelector('#sharaf-preview-meta');
    const slotPillsEl = backdrop.querySelector('#sharaf-slot-pills');
    const segsSummaryEl = backdrop.querySelector('#sharaf-segments-summary');
    const changeFileBtn = backdrop.querySelector('#btn-change-sharaf-file');
    const tsvText = backdrop.querySelector('#bethak-import-tsv-text');

    const closeModal = () => {
      document.removeEventListener('keydown', onEsc);
      backdrop.remove();
    };
    const onEsc = (e) => {
      if (e.key === 'Escape') closeModal();
    };
    document.addEventListener('keydown', onEsc);

    closeBtn?.addEventListener('click', closeModal);
    cancelBtn?.addEventListener('click', closeModal);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closeModal();
    });

    // Helper: Render preview when Excel data is parsed
    function renderParsedPreview(parsed) {
      parsedExcelData = parsed;
      dropzone.classList.add('hidden');
      previewCard.classList.remove('hidden');

      filenameEl.textContent = `📄 ${parsed.file_name || 'Sharaf File'}`;
      const gDateStr = parsed.gregorian_date ? `Gregorian: ${parsed.gregorian_date}` : '';
      const hDateStr = parsed.hdate ? `Hijri: ${parsed.hdate}${parsed.hdate_display ? ` (${parsed.hdate_display})` : ''}` : (parsed.date ? `Date: ${parsed.date}` : '');
      metaEl.textContent = [gDateStr, hDateStr].filter(Boolean).join(' | ');

      const slots = parsed.slots || {};
      const slotKeys = Object.keys(slots);

      // Default selected slot key
      if (evt.event_time_slot && slots[evt.event_time_slot]) {
        selectedSlotKey = evt.event_time_slot;
      } else if (slotKeys.length > 0) {
        selectedSlotKey = slotKeys[0];
      }

      function updateSlotDisplay() {
        slotPillsEl.innerHTML = slotKeys.map(sk => {
          const isSel = sk === selectedSlotKey;
          const count = slots[sk].total_rows;
          return `
            <button type="button" class="btn btn-sm ${isSel ? 'btn-primary' : 'btn-secondary'}" data-slot-key="${sk}" style="font-weight: 700; border-radius: 8px;">
              ${sk} (${count} record${count !== 1 ? 's' : ''})
            </button>
          `;
        }).join('');

        slotPillsEl.querySelectorAll('button').forEach(btn => {
          btn.addEventListener('click', () => {
            selectedSlotKey = btn.getAttribute('data-slot-key');
            updateSlotDisplay();
          });
        });

        // Render segment breakdown for selected slot
        const activeSlotData = slots[selectedSlotKey] || { segments: [] };
        if (activeSlotData.segments.length === 0) {
          segsSummaryEl.innerHTML = '<div style="color: var(--text-muted); font-size: 0.82rem;">No segments in this slot</div>';
        } else {
          segsSummaryEl.innerHTML = activeSlotData.segments.map((sg, sIdx) => `
            <div style="display: flex; align-items: center; justify-content: space-between; background: rgba(0,0,0,0.03); border: 1px solid var(--border-glass); border-radius: 6px; padding: 6px 10px; font-size: 0.82rem;">
              <span style="font-weight: 700; color: var(--text-primary);">${sIdx + 1}. ${escapeHtml(sg.type)}</span>
              <span class="badge" style="font-weight: 800; background: rgba(16, 185, 129, 0.15); color: #059669; padding: 2px 8px; border-radius: 6px;">${sg.count} row${sg.count !== 1 ? 's' : ''}</span>
            </div>
          `).join('');
        }
      }

      updateSlotDisplay();
    }

    async function handleFileSelected(file) {
      if (!file) return;
      const filePath = file.path || '';
      if (filePath) {
        window.showToast('Reading and grouping Sharaf data...', 'info');
        const parseRes = await callApi('events_parse_sharaf_file', filePath);
        if (parseRes && parseRes.success) {
          renderParsedPreview(parseRes);
        } else {
          window.showToast(parseRes?.error || 'Failed parsing Sharaf file', 'error');
        }
      } else {
        window.showToast('Reading and grouping Sharaf data...', 'info');
        const reader = new FileReader();
        reader.onload = async (ev) => {
          try {
            const base64Data = ev.target.result;
            const parseRes = await callApi('events_parse_sharaf_file', '', base64Data, file.name);
            if (parseRes && parseRes.success) {
              renderParsedPreview(parseRes);
            } else {
              window.showToast(parseRes?.error || 'Failed parsing Sharaf file', 'error');
            }
          } catch (err) {
            window.showToast('Error processing file: ' + err.message, 'error');
          }
        };
        reader.onerror = () => {
          window.showToast('Failed to read file from browser', 'error');
        };
        reader.readAsDataURL(file);
      }
    }

    async function handlePickSharafFile(e) {
      if (e) {
        e.stopPropagation();
      }
      try {
        const filePickRes = await callApi('events_select_sharaf_file');
        if (filePickRes && filePickRes.cancelled) {
          return;
        }
        if (filePickRes && filePickRes.success && filePickRes.file_path) {
          window.showToast('Reading and grouping Sharaf data...', 'info');
          const parseRes = await callApi('events_parse_sharaf_file', filePickRes.file_path);
          if (parseRes && parseRes.success) {
            renderParsedPreview(parseRes);
            return;
          } else {
            window.showToast(parseRes?.error || 'Failed parsing Sharaf file', 'error');
            return;
          }
        }
      } catch (err) {
        console.warn('Native dialog failed, falling back to browser picker:', err);
      }

      // Fallback: browser DOM file input
      if (domPicker) {
        domPicker.value = '';
        domPicker.click();
      }
    }

    browseBtn?.addEventListener('click', handlePickSharafFile);
    dropzone?.addEventListener('click', (e) => {
      if (e.target === browseBtn || browseBtn?.contains(e.target)) return;
      handlePickSharafFile(e);
    });
    domPicker?.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) handleFileSelected(file);
    });
    changeFileBtn?.addEventListener('click', () => {
      parsedExcelData = null;
      if (domPicker) domPicker.value = '';
      previewCard.classList.add('hidden');
      dropzone.classList.remove('hidden');
    });

    // Wire Drag and Drop on dropzone
    dropzone?.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.style.borderColor = 'var(--accent-green)';
      dropzone.style.background = 'rgba(16, 185, 129, 0.1)';
    });
    dropzone?.addEventListener('dragleave', (e) => {
      e.preventDefault();
      dropzone.style.borderColor = 'rgba(16, 185, 129, 0.4)';
      dropzone.style.background = 'rgba(16, 185, 129, 0.04)';
    });
    dropzone?.addEventListener('drop', async (e) => {
      e.preventDefault();
      dropzone.style.borderColor = 'rgba(16, 185, 129, 0.4)';
      dropzone.style.background = 'rgba(16, 185, 129, 0.04)';
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        const file = e.dataTransfer.files[0];
        handleFileSelected(file);
      }
    });

    // Wire Apply Button
    applyBtn?.addEventListener('click', () => {
      // 1. If parsed Excel data exists, apply Excel records
      if (parsedExcelData && parsedExcelData.slots && parsedExcelData.slots[selectedSlotKey]) {
        const slotData = parsedExcelData.slots[selectedSlotKey];
        const excelSegments = slotData.segments || [];
        const allSlotRows = slotData.all_rows && slotData.all_rows.length > 0
          ? slotData.all_rows
          : excelSegments.flatMap(s => s.rows || []);

        if (allSlotRows.length === 0 && excelSegments.length === 0) {
          window.showToast(`No segments found in ${selectedSlotKey} slot`, 'warning');
          return;
        }

        // Case A: The user ALREADY defined segments in the app (e.g. 10 Majmui Ziyafat, 2 Nikah, 10 Majmui Ziyafat)
        // Strictly PRESERVE the user's defined sequence and structure, distributing Excel rows into them sequentially.
        if (bState.segments && bState.segments.length > 0) {
          const claimed = new Array(allSlotRows.length).fill(false);

          bState.segments.forEach(seg => {
            const targetCount = Math.max(parseInt(seg.count, 10) || (seg.rows ? seg.rows.length : 1), 1);
            const matchedRows = [];

            // Find matching unclaimed rows in Excel sequence
            for (let i = 0; i < allSlotRows.length; i++) {
              if (claimed[i]) continue;
              const r = allSlotRows[i];
              if (isSharafMatching(r.sharaf, seg.type) || isSharafMatching(r.raw_sharaf, seg.type) || isSharafMatching(seg.type, 'Bethak QMZ')) {
                claimed[i] = true;
                matchedRows.push(r);
                if (matchedRows.length >= targetCount) break;
              }
            }

            // Fill or update rows in this segment up to targetCount
            const newRows = [];
            for (let idx = 0; idx < targetCount; idx++) {
              const r = matchedRows[idx];
              const existingRow = seg.rows && seg.rows[idx] ? seg.rows[idx] : null;
              if (r) {
                newRows.push({
                  localIdx: idx + 1,
                  seq: '',
                  its: r.its || '',
                  sticker: r.sticker || r.tarteeb || '',
                  name: r.name || '',
                  mobile: r.mobile || '',
                  location: r.location || '',
                  team_id: existingRow?.team_id || null,
                  photographer_id: existingRow?.photographer_id || null,
                  videographer_id: existingRow?.videographer_id || null,
                  sharaf: (seg.type === 'Bethak QMZ' && r.sharaf) ? r.sharaf : (existingRow?.sharaf || seg.type),
                  tarteeb: r.tarteeb || r.sticker || '',
                  token: r.token || '',
                  gender: r.gender || '',
                  age: r.age || '',
                  photo_not_covered: false,
                  video_not_covered: false
                });
              } else if (existingRow) {
                newRows.push(existingRow);
              } else {
                newRows.push({
                  localIdx: idx + 1,
                  seq: '',
                  its: '',
                  sticker: '',
                  name: '',
                  mobile: '',
                  location: '',
                  team_id: null,
                  photographer_id: null,
                  videographer_id: null,
                  sharaf: seg.type,
                  tarteeb: '',
                  token: '',
                  gender: '',
                  age: '',
                  photo_not_covered: false,
                  video_not_covered: false
                });
              }
            }
            seg.count = newRows.length;
            seg.rows = newRows;
          });

          // If there are leftover unclaimed rows from Excel that were not accommodated:
          const unclaimedRows = allSlotRows.filter((_, idx) => !claimed[idx]);
          if (unclaimedRows.length > 0) {
            // Group contiguous unclaimed rows by ceremony type
            let currentGroup = null;
            const unclaimedGroups = [];
            unclaimedRows.forEach(r => {
              const rType = r.sharaf || 'Bethak Sharaf';
              if (!currentGroup || !isSharafMatching(currentGroup.type, rType)) {
                currentGroup = { type: rType, rows: [r] };
                unclaimedGroups.push(currentGroup);
              } else {
                currentGroup.rows.push(r);
              }
            });

            // Append each unclaimed group as a distinct new segment at the end, so the user's existing segment counts NEVER change!
            unclaimedGroups.forEach(group => {
              bState.segments.push({
                  id: `seg-${Date.now()}-${bState.segments.length}-${Math.floor(Math.random() * 999)}`,
                  type: group.type,
                  count: group.rows.length,
                  isOpen: true,
                  rows: group.rows.map((r, rIdx) => ({
                    localIdx: rIdx + 1,
                    seq: '',
                    its: r.its || '',
                    sticker: r.sticker || r.tarteeb || '',
                    name: r.name || '',
                    mobile: r.mobile || '',
                    location: r.location || '',
                    team_id: null,
                    photographer_id: null,
                    videographer_id: null,
                    sharaf: group.type,
                    tarteeb: r.tarteeb || r.sticker || '',
                    token: r.token || '',
                    gender: r.gender || '',
                    age: r.age || '',
                    photo_not_covered: false,
                    video_not_covered: false
                  }))
                });
            });
          }
        } else {
          // Case B: No segments exist yet in this Bethak event: create directly from Excel segments
          bState.segments = excelSegments.map((sg, idx) => {
            const rows = (sg.rows || []).map((r, rIdx) => ({
              localIdx: rIdx + 1,
              seq: '',
              its: r.its || '',
              sticker: r.sticker || r.tarteeb || '',
              name: r.name || '',
              mobile: r.mobile || '',
              location: r.location || '',
              team_id: null,
              photographer_id: null,
              videographer_id: null,
              sharaf: sg.type,
              tarteeb: r.tarteeb || r.sticker || '',
              token: r.token || '',
              gender: r.gender || '',
              age: r.age || '',
              photo_not_covered: false,
              video_not_covered: false
            }));

            return {
              id: `seg-${Date.now()}-${idx}-${Math.floor(Math.random() * 999)}`,
              type: sg.type,
              count: rows.length,
              isOpen: true,
              rows
            };
          });
        }

        // Recalculate sequences and team allocations across all segments
        recalculateBethakSequences(bState.segments, bState.teams);
        renderBethakSegmentsContainer(evt, root);
        scheduleBethakAutosave(evt, root);
        closeModal();
        window.showToast(`✅ Successfully applied ${allSlotRows.length} Sharaf records preserving event segment sequence!`);
        return;
      }

      // 2. Fallback: Manual TSV paste
      const raw = (tsvText?.value || '').trim();
      if (!raw) {
        window.showToast('Please select a Sharaf Excel file or paste data to import', 'warning');
        return;
      }

      const lines = raw.split(/\\r?\\n/).filter(l => l.trim().length > 0);
      if (lines.length === 0) return;

      const firstLine = lines[0];
      const delim = firstLine.includes('\\t') ? '\\t' : (firstLine.includes(',') ? ',' : '\\t');
      const parsedRows = lines.map(line => line.split(delim).map(c => c.trim().replace(/^["']|["']$/g, '')));

      let startIdx = 0;
      let colMap = { its: 0, sticker: 1, name: 2, mobile: 3, location: 4 };
      const headerCandidates = parsedRows[0].map(h => h.toLowerCase());
      const hasHeader = headerCandidates.some(h => ['its', 'sticker', 'name', 'mobile', 'location', 'phone', 'host'].some(k => h.includes(k)));
      if (hasHeader) {
        startIdx = 1;
        headerCandidates.forEach((h, cIdx) => {
          if (h.includes('its')) colMap.its = cIdx;
          else if (h.includes('sticker')) colMap.sticker = cIdx;
          else if (h.includes('name') || h.includes('host')) colMap.name = cIdx;
          else if (h.includes('mobile') || h.includes('phone')) colMap.mobile = cIdx;
          else if (h.includes('location') || h.includes('address')) colMap.location = cIdx;
        });
      }

      const dataRows = parsedRows.slice(startIdx);
      if (dataRows.length === 0) {
        window.showToast('No data rows found in pasted text', 'warning');
        return;
      }

      let dataIdx = 0;
      bState.segments.forEach(seg => {
        seg.rows.forEach(r => {
          if (dataIdx < dataRows.length) {
            const d = dataRows[dataIdx++];
            if (colMap.its !== undefined && d[colMap.its]) r.its = d[colMap.its];
            if (colMap.sticker !== undefined && d[colMap.sticker]) r.sticker = d[colMap.sticker];
            if (colMap.name !== undefined && d[colMap.name]) r.name = d[colMap.name];
            if (colMap.mobile !== undefined && d[colMap.mobile]) r.mobile = d[colMap.mobile];
            if (colMap.location !== undefined && d[colMap.location]) r.location = d[colMap.location];
          }
        });
      });

      recalculateBethakSequences(bState.segments, bState.teams);
      renderBethakSegmentsContainer(evt, root);
      scheduleBethakAutosave(evt, root);
      closeModal();
      window.showToast(`Imported ${dataIdx} rows of Sharaf data successfully!`);
    });
  }

  function openSharafDirectUploadModal() {
    const existing = document.getElementById('modal-sharaf-direct-upload');
    if (existing) existing.remove();

    const backdrop = document.createElement('div');
    backdrop.id = 'modal-sharaf-direct-upload';
    backdrop.className = 'events-modal-backdrop';
    backdrop.style.zIndex = '9999';

    let parsedExcelData = null;
    let selectedSlotKey = 'Evening';

    const defaultCity = (state.cities && state.cities.length > 0) ? state.cities[0] : null;
    const defaultCityId = defaultCity ? defaultCity.id : 1;
    const defaultCityName = defaultCity ? defaultCity.name : 'Mumbai';

    backdrop.innerHTML = `
      <div class="events-modal-card" style="max-width: 740px; width: 95%;">
        <div class="events-modal-header">
          <div class="events-modal-title" style="display: flex; align-items: center; gap: 8px;">
            <span class="modal-title-icon" style="font-size: 1.4rem;">📊</span>
            <span>Upload Sharaf Excel for Bethak</span>
          </div>
          <button type="button" class="events-modal-close-btn" id="btn-close-sharaf-direct" title="Close (Esc)">✕</button>
        </div>

        <p class="modal-helper-text" style="margin: -0.25rem 0 0.85rem 0;">
          Select a Sharaf Excel workbook (<code>Sharaf_Data_*.xlsx</code>) to automatically create or populate a Bethak event with all ceremony segments, attendees, and sequences.
        </p>

        <!-- Dropzone / File Picker Area -->
        <div id="sharaf-direct-dropzone" style="border: 2px dashed rgba(16, 185, 129, 0.4); background: rgba(16, 185, 129, 0.04); border-radius: 12px; padding: 1.4rem 1rem; text-align: center; cursor: pointer; transition: all 0.2s ease;">
          <div style="font-size: 2rem; margin-bottom: 0.35rem;">📂</div>
          <div style="font-weight: 700; font-size: 0.98rem; color: var(--text-primary); margin-bottom: 0.25rem;">
            Click to Browse or Drag &amp; Drop Sharaf Excel File
          </div>
          <div style="font-size: 0.78rem; color: var(--text-muted); margin-bottom: 0.85rem;">
            Supports .xlsx, .xls, and .csv formats
          </div>
          <button type="button" id="btn-browse-sharaf-direct" class="btn btn-primary btn-sm" style="font-weight: 700; padding: 0.55rem 1.5rem;">
            📁 Select Sharaf File
          </button>
          <input type="file" id="sharaf-direct-dom-picker" accept=".xlsx,.xls,.csv" style="display: none;">
        </div>

        <!-- Excel Preview Card (Hidden until file selected) -->
        <div id="sharaf-direct-preview-card" class="hidden" style="margin-top: 1rem; background: var(--bg-glass-card); border: 1.5px solid rgba(16, 185, 129, 0.35); border-radius: 12px; padding: 1.1rem;">
          <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--border-glass); padding-bottom: 0.65rem; margin-bottom: 0.85rem;">
            <div>
              <div id="sharaf-direct-filename" style="font-weight: 800; font-size: 0.95rem; color: var(--accent-green);">File Loaded</div>
              <div id="sharaf-direct-meta" style="font-size: 0.80rem; color: var(--text-muted); margin-top: 2px;"></div>
            </div>
            <button type="button" id="btn-change-sharaf-direct" class="btn btn-secondary btn-sm" style="font-size: 0.76rem; padding: 3px 9px;">Change File</button>
          </div>

          <!-- Target Slot Choice -->
          <div style="margin-bottom: 0.95rem;">
            <label class="modal-form-label" style="margin-bottom: 0.4rem; display: block;">Select Ceremony Time Slot to Create / Import:</label>
            <div id="sharaf-direct-slot-pills" style="display: flex; gap: 8px; flex-wrap: wrap;"></div>
          </div>

          <!-- City / Mauze Selector -->
          <div style="margin-bottom: 0.95rem;">
            <label class="modal-form-label" style="margin-bottom: 0.4rem; display: block;">Target City / Mauze:</label>
            <select id="sharaf-direct-city-select" class="modal-input modal-select" style="width: 100%; font-weight: 600;">
              ${(state.cities || []).map(c => `<option value="${c.id}" data-name="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`).join('')}
            </select>
          </div>

          <!-- Segment Breakdown List -->
          <div>
            <label class="modal-form-label" style="margin-bottom: 0.4rem; display: block;">Detected Ceremony Segments:</label>
            <div id="sharaf-direct-segments-summary" style="display: flex; flex-direction: column; gap: 6px; max-height: 180px; overflow-y: auto; padding-right: 4px;"></div>
          </div>
        </div>

        <div class="modal-footer-actions" style="margin-top: 1.25rem;">
          <button type="button" id="btn-cancel-sharaf-direct" class="btn btn-secondary">Cancel</button>
          <button type="button" id="btn-apply-sharaf-direct" class="btn btn-primary flex align-center gap-1" style="font-weight: 700; padding: 0.7rem 1.6rem;">
            <span>✨ Create Bethak Event</span>
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(backdrop);

    const closeBtn = backdrop.querySelector('#btn-close-sharaf-direct');
    const cancelBtn = backdrop.querySelector('#btn-cancel-sharaf-direct');
    const applyBtn = backdrop.querySelector('#btn-apply-sharaf-direct');
    const dropzone = backdrop.querySelector('#sharaf-direct-dropzone');
    const browseBtn = backdrop.querySelector('#btn-browse-sharaf-direct');
    const domPicker = backdrop.querySelector('#sharaf-direct-dom-picker');
    const previewCard = backdrop.querySelector('#sharaf-direct-preview-card');
    const filenameEl = backdrop.querySelector('#sharaf-direct-filename');
    const metaEl = backdrop.querySelector('#sharaf-direct-meta');
    const slotPillsEl = backdrop.querySelector('#sharaf-direct-slot-pills');
    const segsSummaryEl = backdrop.querySelector('#sharaf-direct-segments-summary');
    const changeFileBtn = backdrop.querySelector('#btn-change-sharaf-direct');
    const citySelect = backdrop.querySelector('#sharaf-direct-city-select');

    const closeModal = () => {
      document.removeEventListener('keydown', onEsc);
      backdrop.remove();
    };
    const onEsc = (e) => {
      if (e.key === 'Escape') closeModal();
    };
    document.addEventListener('keydown', onEsc);

    closeBtn?.addEventListener('click', closeModal);
    cancelBtn?.addEventListener('click', closeModal);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closeModal();
    });

    function renderDirectParsedPreview(parsed) {
      parsedExcelData = parsed;
      dropzone.classList.add('hidden');
      previewCard.classList.remove('hidden');

      filenameEl.textContent = `📄 ${parsed.file_name || 'Sharaf File'}`;
      const gDateStr = parsed.gregorian_date ? `Gregorian: ${parsed.gregorian_date}` : '';
      const hDateStr = parsed.hdate ? `Hijri: ${parsed.hdate}${parsed.hdate_display ? ` (${parsed.hdate_display})` : ''}` : (parsed.date ? `Date: ${parsed.date}` : '');
      metaEl.textContent = [gDateStr, hDateStr].filter(Boolean).join(' | ');

      const slots = parsed.slots || {};
      const slotKeys = Object.keys(slots);

      if (slotKeys.includes('Evening')) selectedSlotKey = 'Evening';
      else if (slotKeys.length > 0) selectedSlotKey = slotKeys[0];

      function updateSlotDisplay() {
        slotPillsEl.innerHTML = slotKeys.map(sk => {
          const isSel = sk === selectedSlotKey;
          const count = slots[sk].total_rows;
          return `
            <button type="button" class="btn btn-sm ${isSel ? 'btn-primary' : 'btn-secondary'}" data-slot-key="${sk}" style="font-weight: 700; border-radius: 8px;">
              ${sk} (${count} record${count !== 1 ? 's' : ''})
            </button>
          `;
        }).join('');

        slotPillsEl.querySelectorAll('button').forEach(btn => {
          btn.addEventListener('click', () => {
            selectedSlotKey = btn.getAttribute('data-slot-key');
            updateSlotDisplay();
          });
        });

        const activeSlotData = slots[selectedSlotKey] || { segments: [] };
        if (activeSlotData.segments.length === 0) {
          segsSummaryEl.innerHTML = '<div style="color: var(--text-muted); font-size: 0.82rem;">No segments in this slot</div>';
        } else {
          segsSummaryEl.innerHTML = activeSlotData.segments.map((sg, sIdx) => `
            <div style="display: flex; align-items: center; justify-content: space-between; background: rgba(0,0,0,0.03); border: 1px solid var(--border-glass); border-radius: 6px; padding: 6px 10px; font-size: 0.82rem;">
              <span style="font-weight: 700; color: var(--text-primary);">${sIdx + 1}. ${escapeHtml(sg.type)}</span>
              <span class="badge" style="font-weight: 800; background: rgba(16, 185, 129, 0.15); color: #059669; padding: 2px 8px; border-radius: 6px;">${sg.count} row${sg.count !== 1 ? 's' : ''}</span>
            </div>
          `).join('');
        }
      }

      updateSlotDisplay();
    }

    async function handleFileSelected(file) {
      if (!file) return;
      const filePath = file.path || '';
      if (filePath) {
        window.showToast('Parsing Sharaf workbook...', 'info');
        const parseRes = await callApi('events_parse_sharaf_file', filePath);
        if (parseRes && parseRes.success) {
          renderDirectParsedPreview(parseRes);
        } else {
          window.showToast(parseRes?.error || 'Failed parsing Sharaf file', 'error');
        }
      } else {
        window.showToast('Parsing Sharaf workbook...', 'info');
        const reader = new FileReader();
        reader.onload = async (ev) => {
          try {
            const base64Data = ev.target.result;
            const parseRes = await callApi('events_parse_sharaf_file', '', base64Data, file.name);
            if (parseRes && parseRes.success) {
              renderDirectParsedPreview(parseRes);
            } else {
              window.showToast(parseRes?.error || 'Failed parsing Sharaf file', 'error');
            }
          } catch (err) {
            window.showToast('Error parsing file: ' + err.message, 'error');
          }
        };
        reader.onerror = () => {
          window.showToast('Error reading file from browser', 'error');
        };
        reader.readAsDataURL(file);
      }
    }

    async function handlePickFile(e) {
      if (e) {
        e.stopPropagation();
      }
      try {
        const filePickRes = await callApi('events_select_sharaf_file');
        if (filePickRes && filePickRes.cancelled) return;
        if (filePickRes && filePickRes.success && filePickRes.file_path) {
          window.showToast('Parsing Sharaf workbook...', 'info');
          const parseRes = await callApi('events_parse_sharaf_file', filePickRes.file_path);
          if (parseRes && parseRes.success) {
            renderDirectParsedPreview(parseRes);
            return;
          } else {
            window.showToast(parseRes?.error || 'Failed parsing Sharaf file', 'error');
            return;
          }
        }
      } catch (err) {
        console.warn('Native dialog failed, falling back to browser picker:', err);
      }

      // Fallback: DOM file picker
      if (domPicker) {
        domPicker.value = '';
        domPicker.click();
      }
    }

    browseBtn?.addEventListener('click', handlePickFile);
    dropzone?.addEventListener('click', (e) => {
      if (e.target === browseBtn || browseBtn?.contains(e.target)) return;
      handlePickFile(e);
    });
    domPicker?.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) handleFileSelected(file);
    });
    changeFileBtn?.addEventListener('click', () => {
      parsedExcelData = null;
      if (domPicker) domPicker.value = '';
      previewCard.classList.add('hidden');
      dropzone.classList.remove('hidden');
    });

    dropzone?.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.style.borderColor = 'var(--accent-green)';
      dropzone.style.background = 'rgba(16, 185, 129, 0.1)';
    });
    dropzone?.addEventListener('dragleave', (e) => {
      e.preventDefault();
      dropzone.style.borderColor = 'rgba(16, 185, 129, 0.4)';
      dropzone.style.background = 'rgba(16, 185, 129, 0.04)';
    });
    dropzone?.addEventListener('drop', async (e) => {
      e.preventDefault();
      dropzone.style.borderColor = 'rgba(16, 185, 129, 0.4)';
      dropzone.style.background = 'rgba(16, 185, 129, 0.04)';
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        const file = e.dataTransfer.files[0];
        handleFileSelected(file);
      }
    });

    applyBtn?.addEventListener('click', async () => {
      if (!parsedExcelData || !parsedExcelData.slots || !parsedExcelData.slots[selectedSlotKey]) {
        window.showToast('Please select a valid Sharaf Excel file first', 'warning');
        return;
      }

      const slotData = parsedExcelData.slots[selectedSlotKey];
      const excelSegments = slotData.segments || [];
      if (excelSegments.length === 0) {
        window.showToast(`No segments found in ${selectedSlotKey} slot`, 'warning');
        return;
      }

      applyBtn.disabled = true;
      applyBtn.textContent = 'Creating Bethak Event...';

      try {
        const dateVal = parsedExcelData.hdate || parsedExcelData.date || '1448-03-26';
        const activeSafar = state.activeSafar || (state.cities && state.cities.length > 0 ? `${state.cities[0].name} Atraaf` : 'Mumbai');
        
        let resolvedCityId = citySelect ? parseInt(citySelect.value, 10) : defaultCityId;
        const matchedCity = state.cities.find(c => c.id === resolvedCityId);
        const cityName = matchedCity ? matchedCity.name : defaultCityName;

        // Check if an existing event exists for this date and slot
        const existingInGroup = (state.events || []).filter(e =>
          e.date === dateVal &&
          e.event_time_slot === selectedSlotKey &&
          (e.safar_name ? e.safar_name === activeSafar : true)
        ).sort((a, b) => (a.sequence_number || 0) - (b.sequence_number || 0));

        let targetEvent = existingInGroup.find(e => e.type === 'Bethak') || existingInGroup[0];
        let eventId = targetEvent ? targetEvent.id : `evt-${Date.now()}-${Math.floor(Math.random() * 9999)}`;
        let seqNum = targetEvent ? targetEvent.sequence_number : (existingInGroup.length > 0 ? Math.max(...existingInGroup.map(e => e.sequence_number || 1)) + 1 : 1);
        const eventCode = `${String(seqNum).padStart(2, '0')}-${cityName}-Bethak`;

        const teams = [
          { id: `team-${Date.now()}-1`, name: 'Team 1', photographer_id: null, videographer_id: null }
        ];

        // Format segments
        const blocks = excelSegments.map(s => ({
          type: s.type,
          count: s.count
        }));

        let globalSeq = 1;
        const rows = [];
        excelSegments.forEach(seg => {
          (seg.rows || []).forEach(r => {
            const isMisaq = seg.type === 'Misaq';
            const isPhotoOnly = ['Haddiyat', 'Mafsuhiyat'].includes(seg.type) || isMisaq;
            const assignedTeam = teams[(globalSeq - 1) % teams.length];

            rows.push({
              sequence: String(globalSeq++),
              event_abr: seg.type,
              sticker_name: r.sticker || '',
              name: r.name || '',
              its: r.its || '',
              location: r.location || '',
              mobile: r.mobile || '',
              team_id: assignedTeam ? assignedTeam.id : null,
              photographer_id: null,
              videographer_id: isPhotoOnly ? null : null,
              photo_not_covered: false,
              video_not_covered: false
            });
          });
        });

        const eventPayload = {
          id: eventId,
          city_id: resolvedCityId,
          name: eventCode,
          date: dateVal,
          type: 'Bethak',
          event_time_slot: selectedSlotKey,
          status: 'CREATED',
          sequence_number: seqNum,
          event_code: eventCode,
          assignment_mode: 'team',
          safar_name: activeSafar,
          bethak_counts: blocks,
          qmz_teams: teams,
          bethak_individual: {
            photographer: { user_id: null, location: '' },
            videographer: { user_id: null, location: '' },
            drone: { user_id: null, location: '' }
          },
          bethak_multi_assignments: [],
          individual_assignment: {
            photographer: { user_id: null, location: '' },
            videographer: { user_id: null, location: '' },
            drone: { user_id: null, location: '' }
          },
          individual_multi_assignments: []
        };

        const saveRes = await callApi('events_save_event', eventPayload, resolvedCityId);
        if (saveRes && saveRes.error) {
          throw new Error(saveRes.error);
        }

        await callApi('events_sync_assignments', eventId, rows);

        closeModal();
        window.showToast(`✅ Created Bethak event for ${dateVal} (${selectedSlotKey}) with ${slotData.total_rows} attendees!`, 'success');

        state.expandedGroupId = `${dateVal}___${selectedSlotKey}`;
        await loadEventsList();
        await selectEvent(eventId);
      } catch (err) {
        console.error('Error creating Bethak from Sharaf Excel:', err);
        window.showToast('Error creating Bethak event: ' + err.message, 'error');
        applyBtn.disabled = false;
        applyBtn.textContent = '✨ Create Bethak Event';
      }
    });
  }

  function scheduleBethakAutosave(evt, root = document) {
    const statusEl = root.querySelector('#bethak-save-status');
    if (statusEl) {
      statusEl.textContent = 'Autosaving...';
      statusEl.className = 'bethak-save-status saving';
    }

    const bState = getOrCreateBethakState(evt);
    if (bState.autosaveTimer) clearTimeout(bState.autosaveTimer);

    bState.autosaveTimer = setTimeout(async () => {
      await saveBethakState(evt, root);
    }, 700);
  }

  async function saveBethakState(evt, root = document) {
    const bState = getOrCreateBethakState(evt);
    const statusEl = root.querySelector('#bethak-save-status');

    try {
      const notesInput = root.querySelector('#bethak-notes-input');
      const notesVal = notesInput ? notesInput.value : (evt.special_instructions || evt.notes || '');
      evt.special_instructions = notesVal;
      evt.notes = notesVal;

      const blocks = bState.segments.map(s => ({
        type: s.type,
        count: s.count,
        subTypes: s.type === 'Bethak QMZ' ? s.rows.map(r => r.sharaf || 'Bethak QMZ') : undefined
      }));

      const rows = [];
      bState.segments.forEach(seg => {
        seg.rows.forEach(r => {
          const isMisaq = seg.type === 'Misaq';
          const isPhotoOnly = ['Haddiyat', 'Mafsuhiyat'].includes(seg.type) || isMisaq;
          const assignedTeam = bState.teams.find(t => t.id === r.team_id) || (bState.teams.length === 1 ? bState.teams[0] : null);
          const effectivePhoto = r.photographer_id || assignedTeam?.photographer_id || null;
          const effectiveVideo = r.videographer_id || assignedTeam?.videographer_id || null;
          const effectiveTeamId = r.team_id || assignedTeam?.id || null;

          if (!r.team_id && effectiveTeamId) r.team_id = effectiveTeamId;
          if (!r.photographer_id && effectivePhoto) r.photographer_id = effectivePhoto;
          if (!r.videographer_id && effectiveVideo) r.videographer_id = effectiveVideo;

          rows.push({
            sequence: String(r.seq || '1'),
            event_abr: (seg.type === 'Bethak QMZ' && r.sharaf) ? r.sharaf : seg.type,
            sticker_name: r.sticker || '',
            name: r.name || '',
            its: r.its || '',
            location: r.location || '',
            mobile: r.mobile || '',
            team_id: effectiveTeamId,
            photographer_id: effectivePhoto ? parseInt(effectivePhoto, 10) : null,
            videographer_id: isPhotoOnly ? null : (effectiveVideo ? parseInt(effectiveVideo, 10) : null),
            photo_not_covered: !!r.photo_not_covered,
            video_not_covered: isPhotoOnly ? false : (!!r.video_not_covered),
          });
        });
      });

      evt.bethak_counts = blocks;
      evt.city_event_assignments = rows;
      evt.qmz_teams = bState.teams;

      const patch = {
        bethak_counts: blocks,
        qmz_teams: bState.teams,
        notes: notesVal
      };

      await callApi('events_update_event', evt.id, patch);
      await callApi('events_sync_assignments', evt.id, rows);

      const uncoveredRows = rows.filter(r => !r.photographer_id && !r.videographer_id && !r.photo_not_covered && !r.video_not_covered);
      evt.uncovered_sequences = uncoveredRows;
      evt.uncovered_count = uncoveredRows.length;

      const matchingEvt = (state.events || []).find(e => e.id === evt.id);
      if (matchingEvt) {
        matchingEvt.uncovered_sequences = uncoveredRows;
        matchingEvt.uncovered_count = uncoveredRows.length;
        matchingEvt.qmz_teams = bState.teams;
      }

      recheckActiveUncoveredInDom(root);

      if (statusEl) {
        statusEl.textContent = '✓ Saved';
        statusEl.className = 'bethak-save-status saved';
      }
    } catch (err) {
      console.error('saveBethakState error:', err);
      if (statusEl) {
        statusEl.textContent = 'Save error';
        statusEl.className = 'bethak-save-status error';
      }
    }
  }

  function collectBethakRowsFromDom(root = document, evt = null) {
    const activeEvt = evt || state.events.find(ev => ev.id === state.selectedEventId) || state.activeEvent;
    if (activeEvt) {
      const bState = getOrCreateBethakState(activeEvt);
      if (bState && bState.segments) {
        // Live-sync any un-synced DOM inputs if available
        const listEl = root?.querySelector ? (root.querySelector('#bethak-segments-list') || document.querySelector('#bethak-segments-list')) : null;
        if (listEl) {
          listEl.querySelectorAll('.bethak-segment-card').forEach(card => {
            const sIdx = parseInt(card.getAttribute('data-seg-idx'), 10);
            const seg = bState.segments[sIdx];
            if (seg) syncDomRowsToState(card, seg);
          });
        }
        recalculateBethakSequences(bState.segments, bState.teams);

        const rows = [];
        bState.segments.forEach(seg => {
          seg.rows.forEach(r => {
            const isMisaq = seg.type === 'Misaq';
            const isPhotoOnly = ['Haddiyat', 'Mafsuhiyat'].includes(seg.type) || isMisaq;
            const assignedTeam = bState.teams.find(t => t.id === r.team_id) || (bState.teams.length === 1 ? bState.teams[0] : null);
            const effectivePhoto = r.photographer_id || assignedTeam?.photographer_id || null;
            const effectiveVideo = r.videographer_id || assignedTeam?.videographer_id || null;
            const effectiveTeamId = r.team_id || assignedTeam?.id || null;

            rows.push({
              sequence: String(r.seq || '1'),
              event_abr: (seg.type === 'Bethak QMZ' && r.sharaf) ? r.sharaf : seg.type,
              sticker_name: r.sticker || '',
              name: r.name || '',
              its: r.its || '',
              location: r.location || '',
              mobile: r.mobile || '',
              team_id: effectiveTeamId,
              photographer_id: effectivePhoto ? parseInt(effectivePhoto, 10) : null,
              videographer_id: isPhotoOnly ? null : (effectiveVideo ? parseInt(effectiveVideo, 10) : null),
              photo_not_covered: !!r.photo_not_covered,
              video_not_covered: isPhotoOnly ? false : (!!r.video_not_covered),
            });
          });
        });
        return rows;
      }
    }
    return [];
  }

  // ============================================================================
  // SAVE ACTIVE EVENT CHANGES
  // ============================================================================
  async function saveActiveEventChanges(evt, engine, root = document) {
    if (state.isSaving) return;
    state.isSaving = true;
    const btnSave = root.querySelector('.btn-save-event-changes-inline') || root.querySelector('#btn-save-event-changes') || document.getElementById('btn-save-event-changes');
    if (btnSave) {
      btnSave.disabled = true;
      btnSave.textContent = 'Saving...';
    }

    try {
      const patch = {};
      let syncRows = [];

      if (engine === 'standard') {
        patch.individual_assignment = {
          photographer: {
            user_id: root.querySelector('#std-photo-user')?.value ? parseInt(root.querySelector('#std-photo-user').value, 10) : null,
            location: root.querySelector('#std-photo-loc')?.value || ''
          },
          videographer: {
            user_id: root.querySelector('#std-video-user')?.value ? parseInt(root.querySelector('#std-video-user').value, 10) : null,
            location: root.querySelector('#std-video-loc')?.value || ''
          },
          drone: {
            user_id: root.querySelector('#std-drone-user')?.value ? parseInt(root.querySelector('#std-drone-user').value, 10) : null,
            location: root.querySelector('#std-drone-loc')?.value || ''
          }
        };

        patch.individual_multi_assignments = Array.from(root.querySelectorAll('.multi-contrib-row')).map((r, i) => ({
          id: `multi-${i}`,
          role: r.querySelector('.multi-role-select')?.value || 'photographer',
          user_id: r.querySelector('.multi-user-select')?.value ? parseInt(r.querySelector('.multi-user-select').value, 10) : null,
          location: r.querySelector('.multi-loc-input')?.value || ''
        }));

        patch.recording_details = {
          fixed_cameras_count: parseInt(root.querySelector('#rec-fixed-count')?.value || '0', 10),
          external_recorder: root.querySelector('#rec-ext-recorder')?.value || '',
          audio_operator: root.querySelector('#rec-audio-op')?.value || ''
        };

        syncRows = Array.from(root.querySelectorAll('.inline-seg-row')).map(r => ({
          sequence: r.querySelector('.inl-seq')?.value || '1a',
          event_abr: r.querySelector('.inl-abr')?.value || 'Nikah',
          sticker_name: '',
          name: r.querySelector('.inl-name')?.value || '',
          its: r.querySelector('.inl-its')?.value || '',
          location: r.querySelector('.inl-loc')?.value || '',
          mobile: r.querySelector('.inl-mob')?.value || '',
          team_id: null,
          photographer_id: r.querySelector('.inl-photo')?.value ? parseInt(r.querySelector('.inl-photo').value, 10) : null,
          videographer_id: r.querySelector('.inl-video')?.value ? parseInt(r.querySelector('.inl-video').value, 10) : null,
          photo_not_covered: false,
          video_not_covered: false,
        }));
      } else if (engine === 'qmz') {
        const teamCards = Array.from(root.querySelectorAll('.team-card'));
        patch.qmz_teams = teamCards.map(c => ({
          id: c.getAttribute('data-team-id'),
          name: c.querySelector('.qmz-team-name-input')?.value || 'Team',
          photographer_id: c.querySelector('.qmz-team-photo-select')?.value ? parseInt(c.querySelector('.qmz-team-photo-select').value, 10) : null,
          videographer_id: c.querySelector('.qmz-team-video-select')?.value ? parseInt(c.querySelector('.qmz-team-video-select').value, 10) : null,
          save_for_reuse: false,
        }));

        syncRows = Array.from(root.querySelectorAll('#qmz-sequences-body tr.qmz-row')).map(r => {
          const isNoPhoto = r.querySelector('.row-photo-not-covered')?.checked || false;
          const isNoVideo = r.querySelector('.row-video-not-covered')?.checked || false;
          return {
            sequence: r.querySelector('.row-seq')?.value || '1',
            event_abr: r.querySelector('.row-abr')?.value || 'Qadam',
            sticker_name: r.querySelector('.row-sticker')?.value || '',
            name: r.querySelector('.row-name')?.value || '',
            its: r.querySelector('.row-its')?.value || '',
            location: r.querySelector('.row-loc')?.value || '',
            mobile: r.querySelector('.row-mob')?.value || '',
            team_id: r.querySelector('.row-team')?.value || null,
            photographer_id: isNoPhoto ? null : (r.querySelector('.row-photo')?.value ? parseInt(r.querySelector('.row-photo').value, 10) : null),
            videographer_id: isNoVideo ? null : (r.querySelector('.row-video')?.value ? parseInt(r.querySelector('.row-video').value, 10) : null),
            photo_not_covered: isNoPhoto,
            video_not_covered: isNoVideo,
          };
        });
        patch.qmz_count = syncRows.length;
      } else if (engine === 'bethak') {
        const bState = getOrCreateBethakState(evt);
        const blocks = bState.segments.map(s => ({
          type: s.type,
          count: s.count,
          subTypes: s.type === 'Bethak QMZ' ? s.rows.map(r => r.sharaf || 'Bethak QMZ') : undefined
        }));
        patch.bethak_counts = blocks;
        patch.qmz_teams = bState.teams;
        const notesInput = root.querySelector('#bethak-notes-input');
        if (notesInput) {
          patch.notes = notesInput.value;
          evt.special_instructions = notesInput.value;
          evt.notes = notesInput.value;
        }

        syncRows = collectBethakRowsFromDom(root, evt);
      }

      // 1. Update event details
      const updateRes = await callApi('events_update_event', evt.id, patch);
      if (updateRes && updateRes.error) {
        throw new Error(updateRes.error);
      }

      // 2. Sync child assignments
      if (syncRows && syncRows.length > 0) {
        const syncRes = await callApi('events_sync_assignments', evt.id, syncRows);
        if (syncRes && syncRes.error) {
          throw new Error(syncRes.error);
        }
      } else if (engine !== 'bethak') {
        const syncRes = await callApi('events_sync_assignments', evt.id, syncRows);
        if (syncRes && syncRes.error) {
          throw new Error(syncRes.error);
        }
      }

      // Update status badge on subevent row if present
      const statusPill = document.querySelector(`.subevent-item-wrapper[data-sub-id="${evt.id}"] .subevent-status-pill`);
      if (statusPill) {
        statusPill.textContent = evt.status || 'CREATED';
        statusPill.className = `subevent-status-pill badge-status-${(evt.status || 'CREATED').toLowerCase()}`;
      }

      // Refresh active event in place and reload events list to update uncovered warnings
      const savedEvtId = evt.id;
      await selectEvent(evt.id);
      await loadEventsList();

      // Ensure the saved sub-event drawer remains open
      if (savedEvtId) {
        setTimeout(async () => {
          const wrapper = document.querySelector(`.subevent-item-wrapper[data-sub-id="${savedEvtId}"]`);
          if (wrapper && !wrapper.classList.contains('is-open')) {
            await toggleSubEventInline(savedEvtId);
          }
        }, 60);
      }

      window.showToast('Event operations saved successfully!');
    } catch (e) {
      console.error('[Events] Save error:', e);
      window.showToast('Failed to save changes: ' + e.message, 'error');
    } finally {
      state.isSaving = false;
      if (btnSave) {
        btnSave.disabled = false;
        btnSave.innerHTML = `
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
            <polyline points="17 21 17 13 7 13 7 21"></polyline>
            <polyline points="7 3 7 8 15 8"></polyline>
          </svg>
          <span>Save Event Operations</span>
        `;
      }
    }
  }

  // ============================================================================
  // BULK IMPORT / TSV PASTE MODAL (Spec 5.2)
  // ============================================================================
  function openBulkPasteModal(evt) {
    const backdrop = document.createElement('div');
    backdrop.className = 'events-modal-backdrop';
    backdrop.innerHTML = `
      <div class="events-modal-card" style="max-width: 680px;">
        <div class="events-modal-header">
          <div class="events-modal-title">
            <span class="modal-title-icon">📋</span>
            <span>Bulk Paste / Import Sequences</span>
          </div>
          <button type="button" class="events-modal-close-btn" id="btn-close-bulk-modal" title="Close modal">✕</button>
        </div>

        <p class="modal-helper-text">
          Paste tabular data copied directly from Excel, Google Sheets, or CSV.<br>
          Expected column order: <strong>Seq, Type, Sticker, Name, ITS, Location, Mobile</strong>.<br>
          <span style="color: var(--accent-green); font-weight: 600;">✓ Note: Current team assignments will be preserved while Mumineen recipient data is updated!</span>
        </p>

        <textarea id="bulk-paste-textarea" class="input-glass modal-input" style="height: 220px; font-family: 'JetBrains Mono', monospace; font-size: 0.84rem; resize: vertical;" placeholder="1\tQadam\t101\tMulla Aliasgar\t30493950\tRaipur\t9893184122\n2\tMajlis\t102\tShabbir bhai\t20347145\tBilaspur\t9131326353"></textarea>

        <div class="modal-footer-actions">
          <button type="button" class="btn btn-secondary" id="btn-cancel-bulk">Cancel</button>
          <button type="button" class="btn btn-primary" id="btn-apply-bulk" style="font-weight: 700;">Apply Parsed Sequences</button>
        </div>
      </div>
    `;

    document.body.appendChild(backdrop);

    const closeBulkModal = () => {
      document.removeEventListener('keydown', onEscBulk);
      backdrop.remove();
    };
    const onEscBulk = (e) => {
      if (e.key === 'Escape') closeBulkModal();
    };
    document.addEventListener('keydown', onEscBulk);

    backdrop.querySelector('#btn-close-bulk-modal').onclick = closeBulkModal;
    backdrop.querySelector('#btn-cancel-bulk').onclick = closeBulkModal;
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closeBulkModal();
    });

    backdrop.querySelector('#btn-apply-bulk').onclick = () => {
      const rawText = backdrop.querySelector('#bulk-paste-textarea')?.value || '';
      if (!rawText.trim()) {
        window.showToast('Please paste some text first', 'warning');
        return;
      }

      const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      const rows = [];

      function parseTabOrCsvLine(line) {
        if (line.includes('\t')) return line.split('\t').map(s => s.trim().replace(/^["']|["']$/g, ''));
        const re = /(?:^|,)(?:"([^"]*(?:""[^"]*)*)"|([^,]*))/g;
        const result = [];
        let match;
        while ((match = re.exec(line)) !== null) {
          let val = match[1] !== undefined ? match[1].replace(/""/g, '"') : match[2];
          result.push(val !== undefined ? val.trim() : '');
          if (match.index + match[0].length >= line.length) break;
        }
        return result;
      }

      const normalizeAbr = normalizeEventAbr;

      lines.forEach((line, idx) => {
        const clean = parseTabOrCsvLine(line);
        if (clean.length < 2) return;

        // Headers check
        if (idx === 0 && clean[0].toLowerCase().startsWith('seq')) return;

        rows.push({
          sequence: clean[0] || String(rows.length + 1),
          event_abr: normalizeAbr(clean[1]),
          sticker_name: clean[2] || '',
          name: clean[3] || '',
          its: clean[4] || '',
          location: clean[5] || '',
          mobile: clean[6] || '',
        });
      });

      if (rows.length === 0) {
        window.showToast('Could not parse any valid rows from text', 'error');
        return;
      }

      // Preserve existing teams while mapping parsed data
      const tray = (evt && evt.id) ? (document.querySelector(`.subevent-item-wrapper[data-sub-id="${evt.id}"] .subevent-inline-tray`) || document) : document;
      const seqBody = tray.querySelector('#qmz-sequences-body');
      if (!seqBody) {
        backdrop.remove();
        return;
      }
      const existingRows = Array.from(tray.querySelectorAll('#qmz-sequences-body tr.qmz-row'));
      const teamCards = Array.from(tray.querySelectorAll('.team-card'));
      const teams = teamCards.map(c => ({
        id: c.getAttribute('data-team-id'),
        name: c.querySelector('.qmz-team-name-input')?.value || 'Team',
        photographer_id: c.querySelector('.qmz-team-photo-select')?.value || null,
        videographer_id: c.querySelector('.qmz-team-video-select')?.value || null,
      }));

      seqBody.innerHTML = '';
      rows.forEach((r, idx) => {
        const existing = existingRows[idx];
        const prevTeamId = existing?.getAttribute('data-team-id') || (teams.length > 0 ? teams[idx % teams.length].id : null);
        const prevPhoto = existing?.querySelector('.row-photo')?.value || teams.find(t => t.id === prevTeamId)?.photographer_id || null;
        const prevVideo = existing?.querySelector('.row-video')?.value || teams.find(t => t.id === prevTeamId)?.videographer_id || null;

        const rowData = {
          sequence: r.sequence || String(idx + 1).padStart(2, '0'),
          event_abr: r.event_abr || 'Qadam',
          sticker_name: r.sticker_name || '',
          name: r.name || '',
          its: r.its || '',
          location: r.location || '',
          mobile: r.mobile || '',
          team_id: prevTeamId || '',
          photographer_id: prevPhoto || null,
          videographer_id: prevVideo || null,
        };

        const tempDiv = document.createElement('tbody');
        tempDiv.innerHTML = renderSingleQMZRowHtml(rowData, idx, teams, false, null);
        const tr = tempDiv.firstElementChild;
        seqBody.appendChild(tr);
      });

      bindQMZRowActions(tray);
      renumberQMZRows(tray);
      scheduleQMZAutosave(evt, tray);
      backdrop.remove();
      window.showToast(`Imported ${rows.length} sequences successfully and auto-saved!`);
    };
  }

  // ============================================================================
  // OFFLINE FOLDER EXPORT MODAL (Spec 6.4)
  // ============================================================================
  function openExportFoldersModal(evt) {
    const backdrop = document.createElement('div');
    backdrop.className = 'events-modal-backdrop';

    const defaultSafar = evt.safar_name || state.activeSafar || '1448-08-Raipur Atraaf';

    // Find all sibling sub-events (same date + slot) from state.events
    const siblingEvents = (state.events || []).filter(e =>
      e.date === evt.date && e.event_time_slot === evt.event_time_slot
    ).sort((a, b) => (a.sequence_number || 0) - (b.sequence_number || 0));

    // Fall back to just this event if no siblings found
    const allEvents = siblingEvents.length > 0 ? siblingEvents : [evt];
    const allIds = allEvents.map(e => e.id).join(',');

    const subEventListHtml = allEvents.map(e => `
      <div style="display:flex; align-items:center; gap:8px; padding:4px 0; border-bottom:1px solid rgba(0,0,0,0.05);">
        <span style="font-size:0.72rem; font-weight:700; font-family:monospace; background:#1e293b; color:#fff; padding:2px 6px; border-radius:4px;">#${String(e.sequence_number||1).padStart(2,'0')}</span>
        <span style="font-size:0.78rem; font-weight:700; color:var(--accent-green);">${escapeHtml(e.type)}</span>
        <span style="font-size:0.78rem; color:var(--text-secondary);">${escapeHtml(e.event_code || e.id)}</span>
      </div>
    `).join('');

    const slotCode = (evt.event_time_slot === 'Morning') ? '01M' : '02E';
    const masterName = `${evt.date} _${slotCode}`;

    backdrop.innerHTML = `
      <div class="events-modal-card" style="max-width: 620px;">
        <div class="events-modal-header">
          <div class="events-modal-title">
            <span class="modal-title-icon">📁</span>
            <span>Export Folder Structure — Full Event Group</span>
          </div>
          <button type="button" class="events-modal-close-btn" id="btn-close-export-modal" title="Close modal">✕</button>
        </div>

        <p class="modal-helper-text" style="margin-bottom:0.75rem;">
          Creates direct Media Sorting folder structure:&nbsp;
          <code class="folder-spec-code">{TargetDir} / ${masterName} /</code>
        </p>

        <div style="background:rgba(0,0,0,0.03); border:1px solid rgba(0,0,0,0.07); border-radius:8px; padding:0.65rem 0.9rem; margin-bottom:1rem;">
          <div style="font-size:0.72rem; font-weight:700; text-transform:uppercase; letter-spacing:0.06em; color:var(--text-secondary); margin-bottom:6px;">
            ${allEvents.length} Sub-Event${allEvents.length !== 1 ? 's' : ''} · ${escapeHtml(evt.date)} ${escapeHtml(evt.event_time_slot)}
          </div>
          ${subEventListHtml}
        </div>

        <div class="input-group" style="margin-bottom:1rem;">
          <label class="modal-form-label">Target Root Folder</label>
          <div class="flex gap-2">
            <input type="text" id="export-target-dir" class="input-glass modal-input flex-1" readonly placeholder="Click Browse to select folder">
            <button type="button" class="btn btn-select" id="btn-browse-export-dir" style="padding: 0.7rem 1.2rem; font-weight: 600;">Browse</button>
          </div>
        </div>

        <div class="preview-codes-card" style="margin-bottom:1rem;">
          <div class="preview-codes-title"><span>Target Master Directory</span></div>
          <div id="export-preview-path" style="font-family:'JetBrains Mono',monospace; font-size:0.82rem; font-weight:700; color:var(--accent-green); word-break:break-all;">
            {TargetDir} / ${escapeHtml(masterName)} /
          </div>
        </div>

        <div class="modal-footer-actions">
          <button type="button" class="btn btn-secondary" id="btn-cancel-export">Cancel</button>
          <button type="button" class="btn btn-primary" id="btn-run-export" style="font-weight:700; padding:0.7rem 1.6rem;" disabled>
            📁 Generate ${allEvents.length} Event Folder${allEvents.length !== 1 ? 's' : ''}
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(backdrop);

    const curSafar = (state.safars || []).find(s => (s.name || '').toLowerCase() === ((evt.safar_name || state.activeSafar || '')).toLowerCase());
    let chosenDir = (curSafar && curSafar.path) ? curSafar.path : (localStorage.getItem('ain53_safar_folder_' + (state.activeSafar || 'default')) || '');
    const previewEl = backdrop.querySelector('#export-preview-path');
    const runBtn = backdrop.querySelector('#btn-run-export');

    function updatePreview() {
      const base = chosenDir || '{TargetDir}';
      previewEl.textContent = `${base} / ${masterName} /`;
      if (runBtn) runBtn.disabled = !chosenDir;
    }

    if (chosenDir) {
      const dirInput = backdrop.querySelector('#export-target-dir');
      if (dirInput) dirInput.value = chosenDir;
      updatePreview();
    }

    backdrop.querySelector('#btn-browse-export-dir').onclick = async () => {
      const res = await callApi('events_select_export_dir');
      if (res && res.path) {
        chosenDir = res.path;
        backdrop.querySelector('#export-target-dir').value = chosenDir;
        updatePreview();
      }
    };

    const closeExportModal = () => {
      document.removeEventListener('keydown', onEscExport);
      backdrop.remove();
    };
    const onEscExport = (e) => {
      if (e.key === 'Escape') closeExportModal();
    };
    document.addEventListener('keydown', onEscExport);

    backdrop.querySelector('#btn-close-export-modal').onclick = closeExportModal;
    backdrop.querySelector('#btn-cancel-export').onclick = closeExportModal;
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closeExportModal();
    });

    backdrop.querySelector('#btn-run-export').onclick = async () => {
      runBtn.disabled = true;
      runBtn.textContent = 'Generating...';

      const res = await callApi(
        'events_generate_folder_structure',
        allIds,          // comma-separated list of ALL sub-event IDs in the group
        defaultSafar,
        chosenDir
      );

      if (res && res.success) {
        closeExportModal();
        const escPath = (res.base_dir || '').replace(/\\/g, '\\\\');
        window.showToast(`✅ Created ${res.created_count} folders in ${masterName}!`);
        const toastEl = document.getElementById('toast');
        if (toastEl) {
          toastEl.innerHTML = `
            <div style="display:flex; align-items:center; justify-content:space-between; width:100%; gap:0.5rem; flex-wrap:wrap;">
              <span>Created ${res.created_count} folders in <strong>${escapeHtml(masterName)}</strong></span>
              <button class="btn btn-select btn-sm" onclick="window.pywebview.api.open_in_explorer('${escPath}')">📁 Open in Explorer</button>
            </div>
          `;
        }
      } else {
        window.showToast(res?.error || 'Failed to create folders', 'error');
        runBtn.disabled = false;
        runBtn.textContent = `📁 Generate ${allEvents.length} Event Folder${allEvents.length !== 1 ? 's' : ''}`;
      }
    };
  }

  // ============================================================================
  // DUPLICATE DATE & SLOT WARNING DIALOG
  // ============================================================================
  function showDuplicateDateWarning(date, slot, count, maxSeq, safar) {
    return new Promise((resolve) => {
      const warnBackdrop = document.createElement('div');
      warnBackdrop.className = 'events-modal-backdrop';
      warnBackdrop.style.zIndex = '10000';

      warnBackdrop.innerHTML = `
        <div class="events-modal-card" style="max-width: 500px; border-left: 4px solid #f59e0b; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7);">
          <div class="events-modal-header" style="padding-bottom: 0.5rem;">
            <div class="events-modal-title" style="font-size: 1.15rem; color: #f59e0b; display:flex; align-items:center; gap:8px;">
              <span>⚠️</span>
              <span>Event Group Already Exists</span>
            </div>
            <button type="button" class="events-modal-close-btn" id="btn-close-warn">✕</button>
          </div>
          <div style="font-size: 0.9rem; color: var(--text-primary); line-height: 1.55; margin-bottom: 1.25rem;">
            An event group for <strong>Date: ${escapeHtml(date)}</strong> and <strong>Slot: ${escapeHtml(slot)}</strong> is already present in <em>${escapeHtml(safar)}</em> (${count} sub-event${count > 1 ? 's' : ''}, current sequences up to #${String(maxSeq).padStart(2, '0')}).
            <br><br>
            <div style="font-size: 0.95rem; font-weight:600; color:var(--text-primary);">
              Do you want to add this in that date only?
            </div>
            <div style="font-size: 0.78rem; color: var(--text-secondary); margin-top: 0.75rem; background: rgba(245, 158, 11, 0.08); padding: 8px 12px; border-radius: 6px; border: 1px solid rgba(245, 158, 11, 0.2);">
              ℹ️ If you choose Yes, the new sub-events will be appended to this existing date starting at sequence <strong>#${String(maxSeq + 1).padStart(2, '0')}</strong>.
            </div>
          </div>
          <div class="modal-footer-actions" style="display: flex; justify-content: flex-end; gap: 10px;">
            <button type="button" class="btn btn-secondary" id="btn-warn-cancel">Cancel</button>
            <button type="button" class="btn btn-primary" id="btn-warn-proceed" style="background: #10b981; border-color: #10b981; font-weight: 700;">
              Yes, Add to This Date
            </button>
          </div>
        </div>
      `;

      document.body.appendChild(warnBackdrop);

      const closeWarn = (result) => {
        document.removeEventListener('keydown', onEscWarn);
        warnBackdrop.remove();
        resolve(result);
      };
      const onEscWarn = (e) => {
        if (e.key === 'Escape') closeWarn(false);
      };
      document.addEventListener('keydown', onEscWarn);

      warnBackdrop.querySelector('#btn-close-warn').onclick = () => closeWarn(false);
      warnBackdrop.querySelector('#btn-warn-cancel').onclick = () => closeWarn(false);
      warnBackdrop.querySelector('#btn-warn-proceed').onclick = () => closeWarn(true);
      warnBackdrop.addEventListener('click', (e) => {
        if (e.target === warnBackdrop) closeWarn(false);
      });
    });
  }

  // ============================================================================
  // INLINE EVENT CREATION WORKFLOW (Matching Video sec_112 to sec_192)
  // ============================================================================
  function toggleCreateEventInline() {
    const card = document.getElementById('create-event-inline-card');
    if (!card) return;
    if (!card.classList.contains('hidden')) {
      card.classList.add('hidden');
      card.innerHTML = '';
      return;
    }
    openCreateEventInline();
  }

  async function openCreateEventInline() {
    const card = document.getElementById('create-event-inline-card');
    if (!card) return;

    if (!state.cities || state.cities.length === 0) {
      await loadMasterData();
    }
    const defaultCity = (state.cities && state.cities.length > 0) ? state.cities[0] : null;
    const defaultCityId = defaultCity ? defaultCity.id : null;
    const defaultCityName = defaultCity ? defaultCity.name : 'Mumbai';

    // Default Hijri date for new events (matching sec_112) - formatted strictly as YYYY-MM-DD
    const todayHijri = (state.filterDate && isValidHijriDateFormat(state.filterDate)) ? state.filterDate : getTodayHijriFormatted();
    const activeSafarName = state.activeSafar || (state.cities && state.cities.length > 0 ? `${state.cities[0].name} Atraaf` : 'Mumbai');

    // Sub-events state (starts with 1 row)
    let subEvents = [
      {
        id: `sub-${Date.now()}-1`,
        type: 'Namaz',
        cityName: defaultCityName,
        cityId: defaultCityId,
        isNewCity: false,
        newCityName: '',
        csvRows: null
      }
    ];

    card.classList.remove('hidden');
    card.innerHTML = `
      <div class="create-inline-header">
        <div class="create-inline-header-left">
          <div class="create-inline-icon-badge">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
              <line x1="16" y1="2" x2="16" y2="6"></line>
              <line x1="8" y1="2" x2="8" y2="6"></line>
              <line x1="3" y1="10" x2="21" y2="10"></line>
            </svg>
          </div>
          <div>
            <h3 class="create-inline-title">Create New Event(s)</h3>
            <p class="create-inline-subtitle">Configure date, slot, and sub-events for the official schedule</p>
          </div>
        </div>
        <button type="button" class="btn-create-inline-close" id="btn-close-inline-create" title="Close">✕</button>
      </div>

      <!-- Top Form Row: 3 Columns -->
      <div class="create-events-top-grid">
        <div class="create-field-group">
          <div class="create-field-label-row">
            <label class="create-field-label" for="inline-create-date">Hijri Date <span class="text-danger">*</span></label>
            <span class="field-today-badge">Today</span>
          </div>
          <div class="create-input-icon-wrap">
            <span class="input-left-icon">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                <line x1="16" y1="2" x2="16" y2="6"></line>
                <line x1="8" y1="2" x2="8" y2="6"></line>
                <line x1="3" y1="10" x2="21" y2="10"></line>
              </svg>
            </span>
            <input type="text" id="inline-create-date" class="create-field-input font-mono has-left-icon" placeholder="YYYY-MM-DD" maxlength="10" value="${escapeHtml(todayHijri)}">
          </div>
          <div class="create-field-hint">Format: YYYY-MM-DD (e.g. ${escapeHtml(getTodayHijriFormatted())})</div>
        </div>

        <div class="create-field-group">
          <div class="create-field-label-row">
            <label class="create-field-label" for="inline-create-slot">Slot <span class="text-danger">*</span></label>
          </div>
          <select id="inline-create-slot" class="create-field-input">
            <option value="Morning" selected>Morning (01M)</option>
            <option value="Evening">Evening (02E)</option>
          </select>
          <div class="create-field-hint">Time slot for all sub-events</div>
        </div>

        <div class="create-field-group">
          <div class="create-field-label-row">
            <label class="create-field-label" for="inline-create-starting-seq">Starting Sequence</label>
          </div>
          <select id="inline-create-starting-seq" class="create-field-input">
            <option value="1" selected>01 (auto)</option>
            <option value="2">02</option>
            <option value="3">03</option>
            <option value="4">04</option>
            <option value="5">05</option>
            <option value="6">06</option>
            <option value="7">07</option>
            <option value="8">08</option>
            <option value="9">09</option>
            <option value="10">10</option>
          </select>
          <div class="create-field-hint">Sequence of first sub-event</div>
        </div>
      </div>

      <!-- Sub-Events Section Header with Add Sub-Event Button -->
      <div class="sub-events-section-header">
        <div class="sub-events-header-left">
          <div class="sub-events-title">Sub-Events &amp; Mauze (Cities)</div>
          <span class="sub-events-count-chip" id="sub-events-count-badge">1 Sub-Event</span>
        </div>
        <button type="button" class="btn-add-row" id="btn-inline-add-row">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
          <span>Add Sub-Event</span>
        </button>
      </div>

      <!-- Dynamic Sub-Events List -->
      <div id="inline-sub-events-list" class="flex flex-col gap-2"></div>

      <!-- Dynamic Number of QMZ Sequences Input (sec_144.jpg) -->
      <div id="inline-qmz-count-wrapper" class="qmz-count-wrapper hidden">
        <label class="create-field-label">Number of QMZ Sequences</label>
        <input type="number" id="inline-qmz-count-input" class="create-field-input" min="1" max="100" value="5">
      </div>

      <!-- Live Preview Section (sec_144.jpg) -->
      <div class="create-events-preview-box">
        <div class="create-preview-header">
          <span class="live-indicator-dot"></span>
          <span>SCHEDULE PREVIEW</span>
        </div>
        <div class="create-preview-title" id="inline-preview-title">${escapeHtml(todayHijri)} Morning</div>
        <div class="create-preview-list" id="inline-preview-list"></div>
      </div>

      <!-- Bottom Action Buttons (Right-aligned, balanced) -->
      <div class="create-inline-footer">
        <button type="button" class="btn-create-events-cancel" id="btn-inline-cancel-create">
          Cancel
        </button>
        <button type="button" class="btn-create-events-main" id="btn-inline-submit-create">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
          <span>Create Event</span>
        </button>
      </div>
    `;

    // Elements
    const dateInput = card.querySelector('#inline-create-date');
    const slotSelect = card.querySelector('#inline-create-slot');
    const startingSeqSelect = card.querySelector('#inline-create-starting-seq');
    const subEventsWrap = card.querySelector('#inline-sub-events-list');
    const qmzCountWrapper = card.querySelector('#inline-qmz-count-wrapper');
    const qmzCountInput = card.querySelector('#inline-qmz-count-input');
    const previewTitle = card.querySelector('#inline-preview-title');
    const previewList = card.querySelector('#inline-preview-list');
    const executeBtn = card.querySelector('#btn-inline-submit-create');
    const closeBtn = card.querySelector('#btn-close-inline-create');
    const cancelBtn = card.querySelector('#btn-inline-cancel-create');
    const addRowBtn = card.querySelector('#btn-inline-add-row');

    const onDocClickCloseDropdowns = (e) => {
      if (!e.target.closest('.custom-combobox-wrap') && !e.target.closest('.custom-dropdown-wrap')) {
        card.querySelectorAll('.combobox-input-wrapper.open').forEach(t => t.classList.remove('open'));
        card.querySelectorAll('.combobox-menu:not(.hidden)').forEach(m => m.classList.add('hidden'));
        card.querySelectorAll('.custom-dropdown-trigger.open').forEach(t => t.classList.remove('open'));
        card.querySelectorAll('.custom-dropdown-menu:not(.hidden)').forEach(m => m.classList.add('hidden'));
      }
    };
    document.addEventListener('click', onDocClickCloseDropdowns);

    function closeInlineForm() {
      document.removeEventListener('click', onDocClickCloseDropdowns);
      card.classList.add('hidden');
      card.innerHTML = '';
    }

    closeBtn.onclick = closeInlineForm;
    cancelBtn.onclick = closeInlineForm;

    function getSortedCities() {
      const cities = [...(state.cities || [])];
      cities.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      return cities;
    }

    function updatePreview() {
      const dateVal = dateInput.value.trim() || 'YYYY-MM-DD';
      const slotVal = slotSelect.value || 'Morning';
      const slotCode = slotVal === 'Evening' ? '02E' : '01M';
      const startSeqNum = parseInt(startingSeqSelect.value || '1', 10);

      previewTitle.textContent = `${dateVal} · ${slotVal} (${slotCode})`;
      previewList.innerHTML = '';

      let hasQMZ = false;
      subEvents.forEach((sub, idx) => {
        if (sub.type === 'QMZ') hasQMZ = true;
        const seq = String(startSeqNum + idx).padStart(2, '0');
        const typeStr = sub.type || 'Type';
        const cityStr = sub.isNewCity ? (sub.newCityName.trim() || 'New City') : (sub.cityName || 'City');
        const fullCode = `${dateVal} _ ${slotCode}-${seq}-${typeStr}-${cityStr}`;

        const item = document.createElement('div');
        item.className = 'create-preview-item';
        item.innerHTML = `
          <div class="preview-item-left">
            <span class="preview-item-seq">SEQ ${seq}</span>
            <span class="preview-item-type">${escapeHtml(typeStr)}</span>
            <span class="preview-item-city">· ${escapeHtml(cityStr)}</span>
          </div>
          <div class="preview-item-code">${escapeHtml(fullCode)}</div>
        `;
        previewList.appendChild(item);
      });

      const countBadge = card.querySelector('#sub-events-count-badge');
      if (countBadge) {
        countBadge.textContent = `${subEvents.length} Sub-Event${subEvents.length > 1 ? 's' : ''}`;
      }

      // Toggle QMZ sequences count input matching sec_144
      if (hasQMZ) {
        qmzCountWrapper.classList.remove('hidden');
      } else {
        qmzCountWrapper.classList.add('hidden');
      }

      // Update button text: Create Event vs Create Events
      const btnLabel = subEvents.length > 1 ? `Create ${subEvents.length} Events` : 'Create Event';
      executeBtn.innerHTML = `
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
        <span>${btnLabel}</span>
      `;
    }

    function renderSubEventsRows() {
      const startSeqNum = parseInt(startingSeqSelect.value || '1', 10);
      const citiesList = getSortedCities();
      subEventsWrap.innerHTML = '';

      subEvents.forEach((sub, idx) => {
        const currentSeqNum = startSeqNum + idx;
        const seqStr = String(currentSeqNum).padStart(2, '0');

        const row = document.createElement('div');
        row.className = 'sub-event-row-card';
        row.innerHTML = `
          <div class="sub-event-row-top">
            <div class="sub-event-seq-badge">
              <span class="seq-number-pill">SEQ ${seqStr}</span>
              <span class="seq-sub-label">Sub-Event #${idx + 1}</span>
            </div>
            ${subEvents.length > 1 ? `
              <button type="button" class="btn-remove-row" data-sub-id="${sub.id}" title="Remove sub-event">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
                <span>Remove</span>
              </button>
            ` : ''}
          </div>

          <div class="sub-event-inputs-grid">
            <div class="create-field-group">
              <label class="create-field-sub-label">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path>
                  <line x1="7" y1="7" x2="7.01" y2="7"></line>
                </svg>
                EVENT TYPE
              </label>
              <div class="custom-combobox-wrap type-combobox-wrap">
                <div class="combobox-input-wrapper">
                  <input type="text" class="create-field-input combobox-input type-combobox-input" placeholder="Type or select type..." value="${escapeHtml(sub.type || '')}" autocomplete="off" spellcheck="false">
                  <button type="button" class="combobox-toggle-btn" tabindex="-1" title="Show event types">
                    <svg class="combobox-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="6 9 12 15 18 9"></polyline>
                    </svg>
                  </button>
                </div>
                <div class="custom-dropdown-menu combobox-menu type-suggestions-menu hidden"></div>
              </div>
            </div>

            <div class="create-field-group">
              <label class="create-field-sub-label">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                  <circle cx="12" cy="10" r="3"></circle>
                </svg>
                MAUZE (CITY)
              </label>
              <div class="custom-combobox-wrap city-combobox-wrap">
                <div class="combobox-input-wrapper">
                  <input type="text" class="create-field-input combobox-input city-combobox-input" placeholder="Type or select city..." value="${escapeHtml(sub.isNewCity ? sub.newCityName : (sub.cityName || ''))}" autocomplete="off" spellcheck="false">
                  <button type="button" class="combobox-toggle-btn" tabindex="-1" title="Show all cities">
                    <svg class="combobox-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="6 9 12 15 18 9"></polyline>
                    </svg>
                  </button>
                </div>
                <div class="custom-dropdown-menu combobox-menu city-suggestions-menu hidden"></div>
              </div>
            </div>
          </div>
        `;

        // ── Wire Event Type Searchable Combobox ──
        const typeWrap = row.querySelector('.type-combobox-wrap');
        const typeInput = typeWrap.querySelector('.type-combobox-input');
        const typeToggleBtn = typeWrap.querySelector('.combobox-toggle-btn');
        const typeMenu = typeWrap.querySelector('.type-suggestions-menu');
        const typeInputWrap = typeWrap.querySelector('.combobox-input-wrapper');

        function renderTypeMenu(query = '') {
          const q = (query || '').trim().toLowerCase();
          const matches = q
            ? ALL_EVENT_TYPES.filter(t => t.toLowerCase().includes(q))
            : ALL_EVENT_TYPES;

          let html = '';
          if (matches.length > 0) {
            matches.forEach(t => {
              const isSelected = (sub.type || '').toLowerCase() === t.toLowerCase();
              let displayLabel = escapeHtml(t);
              if (q && t.toLowerCase().includes(q)) {
                const idxMatch = t.toLowerCase().indexOf(q);
                const before = escapeHtml(t.substring(0, idxMatch));
                const matchText = escapeHtml(t.substring(idxMatch, idxMatch + q.length));
                const after = escapeHtml(t.substring(idxMatch + q.length));
                displayLabel = `${before}<span class="combobox-highlight">${matchText}</span>${after}`;
              }
              html += `
                <div class="custom-dropdown-item ${isSelected ? 'active' : ''}" data-val="${escapeHtml(t)}">
                  <span>${displayLabel}</span>
                  ${isSelected ? `
                    <svg class="custom-dropdown-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                  ` : ''}
                </div>
              `;
            });
          } else {
            html += `<div style="padding: 8px 12px; font-size: 0.82rem; color: var(--text-muted); text-align: center;">No matching event types</div>`;
          }

          typeMenu.innerHTML = html;

          typeMenu.querySelectorAll('.custom-dropdown-item').forEach(item => {
            item.addEventListener('click', (e) => {
              e.stopPropagation();
              const val = item.getAttribute('data-val');
              if (val) {
                sub.type = val;
                typeInput.value = val;
                closeTypeMenu();
                updatePreview();
              }
            });
          });
        }

        function openTypeMenu(filterQuery = '') {
          card.querySelectorAll('.combobox-menu:not(.hidden)').forEach(m => m.classList.add('hidden'));
          card.querySelectorAll('.combobox-input-wrapper.open').forEach(w => w.classList.remove('open'));

          renderTypeMenu(filterQuery);
          typeMenu.classList.remove('hidden');
          typeInputWrap.classList.add('open');
        }

        function closeTypeMenu() {
          typeMenu.classList.add('hidden');
          typeInputWrap.classList.remove('open');
        }

        typeInput.addEventListener('focus', () => {
          openTypeMenu('');
          typeInput.select();
        });

        typeInput.addEventListener('click', () => {
          if (typeMenu.classList.contains('hidden')) {
            openTypeMenu('');
            typeInput.select();
          }
        });

        typeInput.addEventListener('input', (e) => {
          const val = e.target.value;
          sub.type = val.trim();
          renderTypeMenu(val.trim());
          typeMenu.classList.remove('hidden');
          typeInputWrap.classList.add('open');
          updatePreview();
        });

        typeToggleBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (typeMenu.classList.contains('hidden')) {
            openTypeMenu('');
            typeInput.focus();
            typeInput.select();
          } else {
            closeTypeMenu();
          }
        });

        // ── Wire City Searchable Combobox ──
        const cityWrap = row.querySelector('.city-combobox-wrap');
        const cityInput = cityWrap.querySelector('.city-combobox-input');
        const cityToggleBtn = cityWrap.querySelector('.combobox-toggle-btn');
        const cityMenu = cityWrap.querySelector('.city-suggestions-menu');
        const cityInputWrap = cityWrap.querySelector('.combobox-input-wrapper');

        function renderCityMenu(query = '') {
          const q = (query || '').trim().toLowerCase();
          const matches = q
            ? citiesList.filter(c => c.name.toLowerCase().includes(q))
            : citiesList;
          const exactMatch = citiesList.some(c => c.name.toLowerCase() === q);

          let html = '';
          if (q && !exactMatch) {
            html += `
              <div class="custom-dropdown-item custom-dropdown-action-item" data-val="__add_typed__">
                <span>➕ Add "<strong>${escapeHtml(query.trim())}</strong>" as new city</span>
              </div>
            `;
          } else if (!q) {
            html += `
              <div class="custom-dropdown-item custom-dropdown-action-item" data-val="__prompt_new__">
                <span>➕ Add New City</span>
              </div>
            `;
          }

          if (matches.length > 0) {
            matches.forEach(c => {
              const isSelected = !sub.isNewCity && (sub.cityName || '').toLowerCase() === c.name.toLowerCase();
              let displayLabel = escapeHtml(c.name);
              if (q && c.name.toLowerCase().includes(q)) {
                const idxMatch = c.name.toLowerCase().indexOf(q);
                const before = escapeHtml(c.name.substring(0, idxMatch));
                const matchText = escapeHtml(c.name.substring(idxMatch, idxMatch + q.length));
                const after = escapeHtml(c.name.substring(idxMatch + q.length));
                displayLabel = `${before}<span class="combobox-highlight">${matchText}</span>${after}`;
              }
              html += `
                <div class="custom-dropdown-item ${isSelected ? 'active' : ''}" data-val="${escapeHtml(c.name)}">
                  <span>${displayLabel}</span>
                  ${isSelected ? `
                    <svg class="custom-dropdown-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                  ` : ''}
                </div>
              `;
            });
          } else if (!q || exactMatch) {
            html += `<div style="padding: 8px 12px; font-size: 0.82rem; color: var(--text-muted); text-align: center;">No cities found</div>`;
          }

          cityMenu.innerHTML = html;

          cityMenu.querySelectorAll('.custom-dropdown-item').forEach(item => {
            item.addEventListener('click', (e) => {
              e.stopPropagation();
              const val = item.getAttribute('data-val');
              if (val === '__add_typed__') {
                const newName = query.trim();
                sub.isNewCity = true;
                sub.newCityName = newName;
                sub.cityName = newName;
                sub.cityId = null;
                cityInput.value = newName;
              } else if (val === '__prompt_new__') {
                sub.isNewCity = true;
                cityInput.value = '';
                cityInput.focus();
                return;
              } else {
                sub.isNewCity = false;
                sub.cityName = val;
                sub.newCityName = '';
                const matched = citiesList.find(c => c.name.toLowerCase() === val.toLowerCase());
                sub.cityId = matched ? matched.id : null;
                cityInput.value = val;
              }
              closeCityMenu();
              updatePreview();
            });
          });
        }

        function openCityMenu(filterQuery = '') {
          card.querySelectorAll('.combobox-menu:not(.hidden)').forEach(m => m.classList.add('hidden'));
          card.querySelectorAll('.combobox-input-wrapper.open').forEach(w => w.classList.remove('open'));

          renderCityMenu(filterQuery);
          cityMenu.classList.remove('hidden');
          cityInputWrap.classList.add('open');
        }

        function closeCityMenu() {
          cityMenu.classList.add('hidden');
          cityInputWrap.classList.remove('open');
        }

        cityInput.addEventListener('focus', () => {
          openCityMenu('');
          cityInput.select();
        });

        cityInput.addEventListener('click', () => {
          if (cityMenu.classList.contains('hidden')) {
            openCityMenu('');
            cityInput.select();
          }
        });

        cityInput.addEventListener('input', (e) => {
          const val = e.target.value;
          const matched = citiesList.find(c => c.name.toLowerCase() === val.trim().toLowerCase());
          if (matched) {
            sub.cityName = matched.name;
            sub.cityId = matched.id;
            sub.isNewCity = false;
            sub.newCityName = '';
          } else {
            sub.cityName = val.trim();
            sub.newCityName = val.trim();
            sub.isNewCity = val.trim().length > 0;
            sub.cityId = null;
          }
          renderCityMenu(val.trim());
          cityMenu.classList.remove('hidden');
          cityInputWrap.classList.add('open');
          updatePreview();
        });

        cityToggleBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (cityMenu.classList.contains('hidden')) {
            openCityMenu('');
            cityInput.focus();
            cityInput.select();
          } else {
            closeCityMenu();
          }
        });

        // Wire Remove button
        const removeBtn = row.querySelector('.btn-remove-row');
        if (removeBtn) {
          removeBtn.addEventListener('click', () => {
            subEvents = subEvents.filter(s => s.id !== sub.id);
            renderSubEventsRows();
            updatePreview();
          });
        }

        subEventsWrap.appendChild(row);
      });

      updatePreview();
    }

    dateInput.addEventListener('input', (e) => {
      let val = e.target.value.replace(/[^\d-]/g, '');
      const digitsOnly = val.replace(/-/g, '');
      if (digitsOnly.length > 4 && digitsOnly.length <= 6 && !val.includes('-')) {
        val = digitsOnly.slice(0, 4) + '-' + digitsOnly.slice(4);
      } else if (digitsOnly.length > 6 && (val.match(/-/g) || []).length < 2) {
        val = digitsOnly.slice(0, 4) + '-' + digitsOnly.slice(4, 6) + '-' + digitsOnly.slice(6, 8);
      }
      if (val.length > 10) val = val.slice(0, 10);
      if (e.target.value !== val) {
        e.target.value = val;
      }
      updatePreview();
    });
    slotSelect.addEventListener('change', updatePreview);
    startingSeqSelect.addEventListener('change', () => {
      renderSubEventsRows();
    });

    addRowBtn.addEventListener('click', () => {
      const last = subEvents[subEvents.length - 1];
      subEvents.push({
        id: `sub-${Date.now()}-${Math.floor(Math.random() * 9999)}`,
        type: last ? (last.type === 'QMZ' ? 'Bethak' : last.type) : 'Namaz',
        cityName: last ? (last.isNewCity ? last.newCityName : last.cityName) : defaultCityName,
        cityId: last ? last.cityId : defaultCityId,
        isNewCity: last ? last.isNewCity : false,
        newCityName: last ? last.newCityName : '',
        csvRows: null
      });
      renderSubEventsRows();
    });

    // Wire Execute Button
    executeBtn.addEventListener('click', async () => {
      const date = dateInput.value?.trim();
      if (!date) {
        window.showToast('Please enter Hijri date (YYYY-MM-DD)', 'warning');
        dateInput.focus();
        return;
      }
      if (!isValidHijriDateFormat(date)) {
        window.showToast(`Invalid Hijri date! Please enter format YYYY-MM-DD (e.g. ${getTodayHijriFormatted()})`, 'warning');
        dateInput.focus();
        return;
      }

      const slot = slotSelect.value;
      const activeSafar = state.activeSafar || (state.cities && state.cities.length > 0 ? `${state.cities[0].name} Atraaf` : 'Mumbai');

      const existingInGroup = (state.events || []).filter(e =>
        e.date === date &&
        e.event_time_slot === slot &&
        (e.safar_name ? e.safar_name === activeSafar : true)
      ).sort((a, b) => (a.sequence_number || 0) - (b.sequence_number || 0));

      let effectiveStartSeq = parseInt(startingSeqSelect.value || '1', 10);

      if (existingInGroup.length > 0) {
        const maxSeq = Math.max(...existingInGroup.map(e => e.sequence_number || 1));
        const proceed = await showDuplicateDateWarning(date, slot, existingInGroup.length, maxSeq, activeSafar);
        if (!proceed) return;
        effectiveStartSeq = maxSeq + 1;
        startingSeqSelect.value = String(effectiveStartSeq);
        renderSubEventsRows();
      }

      const validSubs = subEvents.filter(s => s.type);
      if (validSubs.length === 0) {
        window.showToast('Please add at least one sub-event', 'warning');
        return;
      }

      for (const sub of validSubs) {
        const finalCity = sub.isNewCity ? sub.newCityName.trim() : (sub.cityName || '').trim();
        if (!finalCity) {
          window.showToast('Please specify a city for all sub-events', 'warning');
          return;
        }
      }

      const customQmzCount = parseInt(qmzCountInput?.value || '5', 10) || 5;

      executeBtn.disabled = true;
      executeBtn.textContent = 'Creating Events...';

      try {
        let currentSeq = effectiveStartSeq;
        let createdCount = 0;
        let lastCreatedId = null;

        for (const sub of validSubs) {
          const finalCityName = (sub.isNewCity ? sub.newCityName.trim() : (sub.cityName || '').trim());
          let resolvedCity = null;
          let resolvedCityId = sub.cityId;

          if (resolvedCityId) {
            resolvedCity = state.cities.find(c => String(c.id) === String(resolvedCityId));
          }
          if (!resolvedCity) {
            resolvedCity = state.cities.find(c => c.name.toLowerCase() === finalCityName.toLowerCase());
            if (resolvedCity) resolvedCityId = resolvedCity.id;
          }

          if (!resolvedCityId) {
            const addCityRes = await callApi('events_add_city', finalCityName, 2);
            if (addCityRes && addCityRes.city) {
              resolvedCity = addCityRes.city;
              resolvedCityId = addCityRes.city.id;
              if (!state.cities.some(c => c.id === resolvedCityId)) {
                state.cities.push(resolvedCity);
                populateCityFilter();
              }
            } else {
              throw new Error(addCityRes?.error || `Failed to register city "${finalCityName}"`);
            }
          }

          const type = sub.type;
          const engine = getEventEngine(type);
          const assignmentMode = engine === 'standard' ? 'individual' : 'team';
          const cityName = resolvedCity?.name || finalCityName;
          const eventCode = generateEventCode(date, slot, currentSeq, type, cityName);

          let qmzTeams = undefined;
          if (engine === 'qmz' || engine === 'bethak') {
            qmzTeams = buildDefaultTeams(resolvedCity, type);
          }

          const initialAssignments = engine === 'qmz' ? buildQMZNewRows(customQmzCount, qmzTeams || []) : [];

          const newEvent = {
            id: `evt-${Date.now()}-${Math.floor(Math.random() * 9999)}`,
            name: eventCode,
            date: date,
            type: type,
            event_time_slot: slot,
            status: 'CREATED',
            assignment_mode: assignmentMode,
            event_ended: false,
            finalized: false,
            sequence_number: currentSeq,
            event_code: eventCode,
            safar_name: activeSafar,
            ...(engine === 'qmz' && {
              qmz_teams: qmzTeams,
              qmz_count: customQmzCount,
            }),
            ...(engine === 'bethak' && {
              bethak_counts: [],
              qmz_teams: qmzTeams,
              bethak_individual: {
                photographer: { user_id: null, location: '' },
                videographer: { user_id: null, location: '' },
                drone: { user_id: null, location: '' },
              },
              bethak_multi_assignments: [],
            }),
            individual_assignment: {
              photographer: { user_id: null, location: '' },
              videographer: { user_id: null, location: '' },
              drone: { user_id: null, location: '' },
            },
            individual_multi_assignments: [],
          };

          const saveRes = await callApi('events_save_event', newEvent, resolvedCityId);
          if (saveRes && saveRes.error) {
            throw new Error(saveRes.error);
          }

          if (initialAssignments.length > 0) {
            await callApi('events_sync_assignments', newEvent.id, initialAssignments);
          }

          createdCount++;
          lastCreatedId = newEvent.id;
          currentSeq++;
        }

        closeInlineForm();
        window.showToast(`Successfully created ${createdCount} event${createdCount > 1 ? 's' : ''} for ${date} (${slot})!`, 'success');

        // Automatically expand the newly created group matching sec_208!
        state.expandedGroupId = `${date}___${slot}`;
        await loadEventsList();

        // Smooth scroll to the newly created group card
        const targetCard = document.querySelector(`.event-accordion-card[data-group-key="${date}___${slot}"]`);
        if (targetCard) {
          targetCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      } catch (e) {
        console.error('[Events] Inline Creation error:', e);
        window.showToast('Event creation failed: ' + e.message, 'error');
        executeBtn.disabled = false;
        updatePreview();
      }
    });

    renderSubEventsRows();
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Backward compatibility alias
  const openCreateEventModal = toggleCreateEventInline;

  // ============================================================================
  // UNIVERSAL MODAL CLEANUP HELPER
  // ============================================================================
  function removeAllModalBackdrops() {
    document.querySelectorAll('.events-modal-backdrop').forEach(el => el.remove());
  }

  // ============================================================================
  // SAFAR CREW ROSTER & CAMERA SERIES MODAL
  // ============================================================================
  // ============================================================================
  // SAFAR CREW ROSTER & CAMERA SERIES MODAL
  // ============================================================================
  function openSafarCrewModal(safarName) {
    removeAllModalBackdrops();

    const currentSafar = safarName || state.activeSafar || '1448-08-Raipur Atraaf';
    let selectedFilePath = '';
    let selectedFileContent = '';
    let parsedPreviewList = [];

    const backdrop = document.createElement('div');
    backdrop.className = 'events-modal-backdrop';

    function getRoleBadge(role) {
      const r = (role || 'Photographer').toLowerCase();
      if (r.includes('video')) return `<span class="badge-role-video">🎥 Videographer</span>`;
      if (r.includes('drone')) return `<span class="badge-role-drone">🛸 Drone</span>`;
      if (r.includes('coord')) return `<span class="badge-role-coord">📋 Coordinator</span>`;
      return `<span class="badge-role-photo">📷 Photographer</span>`;
    }

    backdrop.innerHTML = `
      <div class="events-modal-card" style="max-width: 860px; width: 95%; max-height: 90vh;">
        <!-- Header -->
        <div class="events-modal-header" style="padding-bottom: 0.85rem; border-bottom: 1px solid var(--border-subtle, #e2e8f0);">
          <div class="events-modal-title" style="font-size: 1.25rem;">
            <span class="modal-title-icon">👥</span>
            <span>Crew &amp; Camera Series Roster</span>
          </div>
          <button type="button" class="events-modal-close-btn" id="btn-close-crew-modal" title="Close (Esc)">✕</button>
        </div>

        <!-- Target Safar Banner -->
        <div style="background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.25); border-radius: 10px; padding: 0.75rem 1rem; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem;">
          <div>
            <div style="font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--color-emerald-light, #10b981); font-weight: 800;">Target Safar</div>
            <div style="font-size: 1.05rem; font-weight: 800; color: var(--text-primary); display: flex; align-items: center; gap: 0.45rem;">
              <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #10b981; box-shadow: 0 0 8px #10b981;"></span>
              <span>${escapeHtml(currentSafar)}</span>
            </div>
          </div>
          <span style="font-size: 0.76rem; color: var(--text-muted); background: var(--bg-surface-elevated, #fff); padding: 0.3rem 0.65rem; border-radius: 6px; border: 1px solid var(--border-subtle, #e5e7eb); font-weight: 600;">
            Linked to 9-Col CSV Exports &amp; Media Sorting
          </span>
        </div>

        <!-- Segmented Tab Navigation -->
        <div class="crew-modal-nav-tabs">
          <button type="button" class="crew-modal-tab-btn active" id="tab-btn-roster" data-tab="roster">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
            <span id="tab-label-roster">Crew Roster (${state.contributors.length})</span>
          </button>
          <button type="button" class="crew-modal-tab-btn" id="tab-btn-add" data-tab="add">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            <span>+ Add Contributor</span>
          </button>
          <button type="button" class="crew-modal-tab-btn" id="tab-btn-import" data-tab="import">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
            <span>📥 Import File / Paste</span>
          </button>
        </div>

        <!-- Tab 1: Crew Roster List -->
        <div id="crew-tab-content-roster" class="flex flex-col gap-2" style="flex: 1; min-height: 240px; overflow: hidden;">
          <div style="position: relative;">
            <input type="text" id="crew-search-input" class="modal-input" placeholder="🔍 Search crew by name, series (e.g. ADN, MR_A), or role..." style="font-size: 0.86rem; padding: 0.55rem 0.95rem; border-radius: 8px;">
          </div>

          <div class="crew-table-wrap" style="flex: 1; max-height: 320px; overflow-y: auto;">
            <table class="crew-table">
              <thead style="position: sticky; top: 0; z-index: 2;">
                <tr>
                  <th style="width: 40px;">#</th>
                  <th>Name</th>
                  <th>Camera Series</th>
                  <th>Role</th>
                  <th>Contact</th>
                  <th style="text-align: right; width: 120px;">Actions</th>
                </tr>
              </thead>
              <tbody id="safar-crew-table-body">
                ${(state.contributors || []).map((u, idx) => `
                  <tr class="crew-table-row" data-name="${escapeHtml(u.name.toLowerCase())}" data-series="${escapeHtml((u.series || '').toLowerCase())}">
                    <td style="color: var(--text-muted); font-size: 0.78rem;">${idx + 1}</td>
                    <td style="font-weight: 700; color: var(--text-primary); font-size: 0.92rem;">${escapeHtml(u.name)}</td>
                    <td>
                      ${u.series ? `
                        <span class="badge-series">
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>
                          <span>${escapeHtml(u.series)}</span>
                        </span>
                      ` : `
                        <span class="badge-series-empty">Not set</span>
                      `}
                    </td>
                    <td>${getRoleBadge(u.role)}</td>
                    <td style="font-size: 0.8rem; color: var(--text-muted);">${escapeHtml(u.phone || u.its || '—')}</td>
                    <td style="text-align: right;">
                      <button type="button" class="btn-edit-series-inline btn-edit-series-prompt" data-id="${u.id}" data-name="${escapeHtml(u.name)}" data-series="${escapeHtml(u.series || '')}" title="Edit Camera Series Code">
                        ✏️ Edit Series
                      </button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <!-- Tab 2: Add Contributor Manually -->
        <div id="crew-tab-content-add" class="hidden flex flex-col gap-3" style="padding: 0.5rem 0;">
          <div style="background: var(--bg-surface-elevated, #fff); border: 1px solid var(--border-subtle, #e2e8f0); border-radius: 12px; padding: 1.4rem; box-shadow: 0 4px 14px rgba(0,0,0,0.03);">
            <div style="font-family: 'Outfit', sans-serif; font-size: 1.05rem; font-weight: 800; color: var(--text-primary); margin-bottom: 0.35rem;">
              Register Contributor &amp; Camera Series
            </div>
            <div style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 1.25rem;">
              Add a photographer, videographer, or crew member with their exact camera series code for ${escapeHtml(currentSafar)}.
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
              <div>
                <label class="modal-form-label">Contributor Full Name <span class="required-star">*</span></label>
                <input type="text" id="tab-add-name" class="modal-input" placeholder="e.g. Adnan, Aliasgar, Murtaza...">
              </div>
              <div>
                <label class="modal-form-label">Camera Series Code</label>
                <input type="text" id="tab-add-series" class="modal-input" placeholder="e.g. ADN, MR_A, MUR, TAHA" style="font-family: 'JetBrains Mono', monospace; text-transform: uppercase;">
                <span style="font-size: 0.72rem; color: var(--text-muted); margin-top: 3px; display: block;">Used as filename prefix during media sorting</span>
              </div>
              <div>
                <label class="modal-form-label">Role / Category</label>
                <select id="tab-add-role" class="modal-input modal-select">
                  <option value="Photographer">📷 Photographer</option>
                  <option value="Videographer">🎥 Videographer</option>
                  <option value="Drone">🛸 Drone</option>
                  <option value="Coordinator">📋 Coordinator</option>
                </select>
              </div>
              <div>
                <label class="modal-form-label">ITS / Contact Number (Optional)</label>
                <input type="text" id="tab-add-contact" class="modal-input" placeholder="e.g. 30336407 or +91 98197...">
              </div>
            </div>

            <div style="display: flex; justify-content: flex-end; gap: 0.75rem; margin-top: 1.25rem;">
              <button type="button" class="btn btn-secondary btn-sm" id="btn-cancel-tab-add">Cancel</button>
              <button type="button" class="btn btn-primary btn-emerald-action" id="btn-save-tab-add" style="padding: 0.6rem 1.6rem; font-weight: 800;">
                + Save Contributor to Safar
              </button>
            </div>
          </div>
        </div>

        <!-- Tab 3: Import File / Paste -->
        <div id="crew-tab-content-import" class="hidden flex flex-col gap-3" style="padding: 0.5rem 0;">
          <div style="background: var(--bg-surface-elevated, #fff); border: 1px solid var(--border-subtle, #e2e8f0); border-radius: 12px; padding: 1.2rem; display: flex; flex-direction: column; gap: 1rem;">
            <!-- Dropzone -->
            <div id="crew-drop-card" style="border: 2px dashed rgba(16, 185, 129, 0.4); background: rgba(16, 185, 129, 0.03); border-radius: 10px; padding: 1.5rem; text-align: center; transition: all 0.2s ease;">
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" style="margin: 0 auto 0.45rem auto; color: #10b981; display: block;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
              <div style="font-weight: 800; font-size: 0.96rem; color: var(--text-primary); margin-bottom: 0.2rem;" id="crew-import-status-text">
                Select or drag &amp; drop a crew roster file
              </div>
              <div style="display: flex; justify-content: center; gap: 0.35rem; margin-bottom: 0.85rem;">
                <span class="format-pill">.CSV</span>
                <span class="format-pill">.XLSX</span>
                <span class="format-pill">.XLS</span>
                <span class="format-pill">.TSV</span>
                <span class="format-pill">.TXT</span>
              </div>
              <div style="display: flex; gap: 0.6rem; justify-content: center; flex-wrap: wrap;">
                <button type="button" class="btn btn-primary btn-sm" id="btn-roster-browse" style="padding: 0.45rem 1.1rem; font-weight: 700;">
                  📁 Browse File
                </button>
                <button type="button" class="btn btn-secondary btn-sm" id="btn-toggle-roster-paste" style="padding: 0.45rem 1rem;">
                  📋 Paste Text
                </button>
                <button type="button" class="btn btn-secondary btn-sm" id="btn-download-roster-template" style="padding: 0.45rem 1rem; border-color: rgba(16, 185, 129, 0.4); color: #059669; font-weight: 700;" title="Download sample CSV template with standard columns">
                  📥 Download Template
                </button>
              </div>
              <div style="font-size: 0.74rem; color: var(--text-muted); margin-top: 0.65rem;">
                Columns: <code>Name</code>, <code>Camera Series</code>, <code>Role</code> (Photographer / Videographer / Drone), <code>ITS</code>, <code>Phone</code>
              </div>
              <input type="file" id="crew-dom-file-picker" accept=".csv,.xlsx,.xls,.tsv,.txt" style="display: none;">
            </div>

            <!-- Paste Box -->
            <div id="crew-paste-drawer" class="hidden flex flex-col gap-1">
              <label class="modal-form-label">Paste Roster Lines (Comma or Tab separated):</label>
              <textarea id="crew-paste-input" class="modal-input" rows="4" style="font-family: monospace; font-size: 0.8rem;" placeholder="Name, Camera Series, Role, ITS, Phone&#10;Adnan, ADN, Photographer&#10;Aliasgar, MR_A, Videographer&#10;Murtaza, MUR, Photographer&#10;Taha, TAHA, Videographer"></textarea>
              <button type="button" class="btn btn-secondary btn-sm align-self-start" id="btn-parse-pasted-action" style="margin-top: 0.25rem;">
                Parse Pasted Rows
              </button>
            </div>

            <!-- Preview Table -->
            <div id="crew-import-preview-box" class="hidden flex flex-col gap-1">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <span style="font-size: 0.86rem; font-weight: 800; color: var(--text-primary);" id="crew-preview-badge">Detected Rows (0)</span>
                <span style="font-size: 0.74rem; color: var(--text-muted);">Review before saving</span>
              </div>
              <div class="crew-table-wrap" style="max-height: 180px; overflow-y: auto;">
                <table class="crew-table" style="font-size: 0.8rem;">
                  <thead>
                    <tr>
                      <th style="width: 35px;">#</th>
                      <th>Name</th>
                      <th>Camera Series</th>
                      <th>Role</th>
                    </tr>
                  </thead>
                  <tbody id="crew-preview-table-body"></tbody>
                </table>
              </div>
              <div style="display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 0.5rem;">
                <button type="button" class="btn btn-primary btn-emerald-action btn-sm" id="btn-save-imported-roster" style="padding: 0.5rem 1.4rem; font-weight: 800;">
                  ✓ Save to ${escapeHtml(currentSafar)}
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div class="modal-footer-actions" style="margin-top: 0.75rem; display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 0.76rem; color: var(--text-muted);">
            Camera Series are automatically synced into CSV exports and Media Sorting.
          </span>
          <button type="button" class="btn btn-secondary" id="btn-done-crew-modal" style="padding: 0.55rem 1.8rem; font-weight: 800;">
            Done
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(backdrop);

    const closeBtn = backdrop.querySelector('#btn-close-crew-modal');
    const doneBtn = backdrop.querySelector('#btn-done-crew-modal');
    const searchInp = backdrop.querySelector('#crew-search-input');

    // Tabs
    const tabBtnRoster = backdrop.querySelector('#tab-btn-roster');
    const tabBtnAdd = backdrop.querySelector('#tab-btn-add');
    const tabBtnImport = backdrop.querySelector('#tab-btn-import');
    const contentRoster = backdrop.querySelector('#crew-tab-content-roster');
    const contentAdd = backdrop.querySelector('#crew-tab-content-add');
    const contentImport = backdrop.querySelector('#crew-tab-content-import');

    function switchTab(tabId) {
      [tabBtnRoster, tabBtnAdd, tabBtnImport].forEach(b => b.classList.remove('active'));
      [contentRoster, contentAdd, contentImport].forEach(c => c.classList.add('hidden'));

      if (tabId === 'add') {
        tabBtnAdd.classList.add('active');
        contentAdd.classList.remove('hidden');
        backdrop.querySelector('#tab-add-name')?.focus();
      } else if (tabId === 'import') {
        tabBtnImport.classList.add('active');
        contentImport.classList.remove('hidden');
      } else {
        tabBtnRoster.classList.add('active');
        contentRoster.classList.remove('hidden');
        searchInp?.focus();
      }
    }

    tabBtnRoster.onclick = () => switchTab('roster');
    tabBtnAdd.onclick = () => switchTab('add');
    tabBtnImport.onclick = () => switchTab('import');
    backdrop.querySelector('#btn-cancel-tab-add').onclick = () => switchTab('roster');

    // ── Reliable Modal Closing ──
    const closeModal = () => {
      document.removeEventListener('keydown', onEscKey);
      backdrop.remove();
    };

    const onEscKey = (e) => {
      if (e.key === 'Escape') closeModal();
    };
    document.addEventListener('keydown', onEscKey);

    closeBtn.onclick = closeModal;
    doneBtn.onclick = closeModal;

    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closeModal();
    });

    // ── Search Filtering ──
    if (searchInp) {
      searchInp.oninput = () => {
        const q = searchInp.value.trim().toLowerCase();
        const rows = backdrop.querySelectorAll('.crew-table-row');
        rows.forEach(tr => {
          const name = tr.getAttribute('data-name') || '';
          const ser = tr.getAttribute('data-series') || '';
          tr.style.display = (!q || name.includes(q) || ser.includes(q)) ? '' : 'none';
        });
      };
    }

    // ── Manual Add Contributor ──
    const saveTabAddBtn = backdrop.querySelector('#btn-save-tab-add');
    saveTabAddBtn.onclick = async () => {
      const name = backdrop.querySelector('#tab-add-name')?.value?.trim();
      const series = backdrop.querySelector('#tab-add-series')?.value?.trim().toUpperCase();
      const role = backdrop.querySelector('#tab-add-role')?.value || 'Photographer';
      const contact = backdrop.querySelector('#tab-add-contact')?.value?.trim();

      if (!name) {
        window.showToast('Please enter contributor full name', 'warning');
        backdrop.querySelector('#tab-add-name')?.focus();
        return;
      }

      saveTabAddBtn.disabled = true;
      try {
        const res = await callApi('events_add_contributor', name, contact, contact, role, series, currentSafar);
        if (res && res.contributor) {
          backdrop.querySelector('#tab-add-name').value = '';
          backdrop.querySelector('#tab-add-series').value = '';
          backdrop.querySelector('#tab-add-contact').value = '';
          window.showToast(`Contributor "${name}" registered with Series "${series || 'AUTO'}"`);
          await refreshCrewList();
          switchTab('roster');
        } else {
          window.showToast(res?.error || 'Failed to add contributor', 'error');
        }
      } catch (err) {
        window.showToast('Add contributor error: ' + err.message, 'error');
      } finally {
        saveTabAddBtn.disabled = false;
      }
    };

    // ── Import / Paste Section Logic ──
    const browseBtn = backdrop.querySelector('#btn-roster-browse');
    const domFileInput = backdrop.querySelector('#crew-dom-file-picker');
    const togglePasteBtn = backdrop.querySelector('#btn-toggle-roster-paste');
    const pasteDrawer = backdrop.querySelector('#crew-paste-drawer');
    const pasteInput = backdrop.querySelector('#crew-paste-input');
    const parsePastedBtn = backdrop.querySelector('#btn-parse-pasted-action');
    const previewBox = backdrop.querySelector('#crew-import-preview-box');
    const previewBadge = backdrop.querySelector('#crew-preview-badge');
    const previewTbody = backdrop.querySelector('#crew-preview-table-body');
    const saveImportedBtn = backdrop.querySelector('#btn-save-imported-roster');
    const dropCard = backdrop.querySelector('#crew-drop-card');
    const statusText = backdrop.querySelector('#crew-import-status-text');

    const downloadTemplateBtn = backdrop.querySelector('#btn-download-roster-template');
    if (downloadTemplateBtn) {
      downloadTemplateBtn.onclick = async () => {
        const csvContent = `Name,Camera Series,Role,ITS,Phone
Adnan Bhai,ADN,Photographer,20384721,+919876543210
Aliasgar Bhai,MR_A,Videographer,20492834,+919876543211
Murtaza Bhai,MUR,Photographer,30182745,+919876543212
Taha Bhai,TAHA,Videographer,40291837,+919876543213
Husain Bhai,DRN_1,Drone,50192837,+919876543214
Mustafa Bhai,COORD,Coordinator,60281948,+919876543215
Burhanuddin Bhai,BUR,Photographer,70192834,+919876543216
Abdeali Bhai,ABD_V,Videographer,80392817,+919876543217
`;
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'Crew_Camera_Series_Roster_Template.csv';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        try {
          const res = await callApi('events_download_crew_template', currentSafar || '');
          if (res && res.saved_paths && res.saved_paths.length > 0) {
            const locs = res.saved_paths.join('\n• ');
            window.showToast(`Template saved to:\n• ${locs}`, 'success');
            return;
          }
        } catch (err) {
          console.warn('Backend template save err:', err);
        }
        window.showToast('Downloaded to your Downloads folder: Crew_Camera_Series_Roster_Template.csv', 'success');
      };
    }

    togglePasteBtn.onclick = () => {
      pasteDrawer.classList.toggle('hidden');
      if (!pasteDrawer.classList.contains('hidden')) pasteInput.focus();
    };

    parsePastedBtn.onclick = () => {
      const txt = pasteInput.value.trim();
      if (!txt) {
        window.showToast('Please paste roster rows first', 'warning');
        return;
      }
      selectedFileContent = txt;
      selectedFilePath = '';
      const items = parseRosterText(txt);
      showPreview(items);
    };

    function parseRosterText(text) {
      if (!text || !text.trim()) return [];
      const lines = text.trim().split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      if (!lines.length) return [];
      const delimiter = lines[0].includes('\t') ? '\t' : (lines[0].includes(';') && !lines[0].includes(',') ? ';' : ',');
      const rows = lines.map(line => line.split(delimiter).map(c => c.trim().replace(/^["']|["']$/g, '')));
      if (!rows.length) return [];

      let headers = rows[0].map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ''));
      let startIndex = 0;
      const hasHeader = headers.some(h => ['name','contributor','contributors','series','cameraseries','code'].includes(h));
      if (hasHeader) {
        startIndex = 1;
      } else {
        headers = ['name', 'series', 'role', 'its', 'phone'];
      }

      const results = [];
      for (let i = startIndex; i < rows.length; i++) {
        const r = rows[i];
        if (!r || !r.length || !r[0]) continue;
        let name = '', series = '', role = '', its = '', phone = '';

        if (hasHeader) {
          headers.forEach((h, colIdx) => {
            const val = r[colIdx] || '';
            if (['name','contributor','contributors','contributorname','contributorsname','photographer','crew'].includes(h)) name = val;
            else if (['series','cameraseries','contributorseries','code','cam'].includes(h)) series = val;
            else if (['role','designation','category','type'].includes(h)) role = val;
            else if (['its','id'].includes(h)) its = val;
            else if (['phone','mobile','contact'].includes(h)) phone = val;
          });
        } else {
          name = r[0] || '';
          series = r[1] || '';
          role = r[2] || '';
          its = r[3] || '';
          phone = r[4] || '';
        }

        if (name && !['name','contributor','contributorsname'].includes(name.toLowerCase().replace(/[^a-z0-9]/g, ''))) {
          results.push({
            name: name,
            series: series.toUpperCase(),
            role: role || (series.toLowerCase().includes('vid') ? 'Videographer' : 'Photographer'),
            its: its,
            phone: phone
          });
        }
      }
      return results;
    }

    function showPreview(items) {
      parsedPreviewList = items || [];
      if (!parsedPreviewList.length) {
        previewBox.classList.add('hidden');
        return;
      }
      previewBox.classList.remove('hidden');
      previewBadge.textContent = `Detected Rows (${parsedPreviewList.length})`;
      previewTbody.innerHTML = parsedPreviewList.map((item, idx) => `
        <tr>
          <td style="color: var(--text-muted);">${idx + 1}</td>
          <td style="font-weight: 700;">${escapeHtml(item.name)}</td>
          <td>
            <span class="badge-series">
              ${escapeHtml(item.series || 'AUTO')}
            </span>
          </td>
          <td>${getRoleBadge(item.role)}</td>
        </tr>
      `).join('');
    }

    // Browse file
    browseBtn.onclick = async () => {
      try {
        const dialogRes = await callApi('events_select_crew_file');
        if (dialogRes && dialogRes.cancelled) return;
        if (dialogRes && dialogRes.file_path) {
          handleFile(dialogRes.file_path);
          return;
        }
      } catch (err) {}
      domFileInput.click();
    };

    domFileInput.onchange = (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      handleDomFile(file);
    };

    // Drag & Drop
    dropCard.ondragover = (e) => {
      e.preventDefault();
      dropCard.style.borderColor = '#10b981';
      dropCard.style.background = 'rgba(16, 185, 129, 0.08)';
    };
    dropCard.ondragleave = () => {
      dropCard.style.borderColor = 'rgba(16, 185, 129, 0.4)';
      dropCard.style.background = 'rgba(16, 185, 129, 0.03)';
    };
    dropCard.ondrop = (e) => {
      e.preventDefault();
      dropCard.style.borderColor = 'rgba(16, 185, 129, 0.4)';
      dropCard.style.background = 'rgba(16, 185, 129, 0.03)';
      const file = e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) handleDomFile(file);
    };

    async function handleFile(fpath) {
      selectedFilePath = fpath;
      selectedFileContent = '';
      const fname = fpath.split(/[/\\]/).pop();
      statusText.textContent = `Selected: ${fname}`;

      try {
        const res = await callApi('events_import_crew_file', currentSafar, selectedFilePath, '');
        if (res && res.contributors && res.contributors.length > 0) {
          showPreview(res.contributors);
          saveImportedBtn.textContent = `✓ Save (${res.contributors.length}) to Safar`;
        } else if (res && res.error) {
          window.showToast(res.error, 'error');
        }
      } catch (err) {
        console.warn('Import error:', err);
      }
    }

    function handleDomFile(file) {
      statusText.textContent = `Selected: ${file.name}`;
      selectedFilePath = '';
      const reader = new FileReader();
      reader.onload = (event) => {
        selectedFileContent = event.target.result;
        const items = parseRosterText(selectedFileContent);
        showPreview(items);
      };
      reader.readAsText(file);
    }

    saveImportedBtn.onclick = async () => {
      saveImportedBtn.disabled = true;
      saveImportedBtn.textContent = 'Saving...';
      try {
        const res = await callApi('events_import_crew_file', currentSafar, selectedFilePath, selectedFileContent);
        if (res && res.success) {
          window.showToast(`Imported ${res.imported_count || res.contributors?.length || 0} crew members!`);
          await refreshCrewList();
          switchTab('roster');
        } else {
          window.showToast(res?.error || 'Import failed', 'error');
        }
      } catch (e) {
        window.showToast('Import error: ' + e.message, 'error');
      } finally {
        saveImportedBtn.disabled = false;
        saveImportedBtn.textContent = `✓ Save to ${escapeHtml(currentSafar)}`;
      }
    };

    // ── Quick Edit Camera Series on Row ──
    function bindEditSeriesButtons() {
      backdrop.querySelectorAll('.btn-edit-series-prompt').forEach(btn => {
        btn.onclick = async () => {
          const uid = btn.getAttribute('data-id');
          const uName = btn.getAttribute('data-name');
          const currSeries = btn.getAttribute('data-series') || '';
          const newSeries = window.promptModal ? await window.promptModal({
            title: 'Edit Camera Series Code',
            message: `Enter camera series code for <strong>"${uName}"</strong>:`,
            defaultValue: currSeries,
            placeholder: 'e.g. ADN, MR_A, MUR, TAHA',
            confirmText: 'Save Series'
          }) : prompt(`Enter Camera Series code for "${uName}" (e.g. ADN, MR_A, MUR, TAHA):`, currSeries);

          if (newSeries !== null) {
            const updRes = await callApi('events_update_contributor', uid, null, null, null, null, newSeries.trim().toUpperCase(), currentSafar);
            if (updRes && updRes.contributor) {
              window.showToast(`Updated "${uName}" series to "${updRes.contributor.series}"`);
              await refreshCrewList();
            }
          }
        };
      });
    }

    bindEditSeriesButtons();

    async function refreshCrewList() {
      try {
        const cRes = await callApi('events_get_contributors', currentSafar);
        if (cRes && cRes.contributors) {
          state.contributors = cRes.contributors;

          const tabCount = backdrop.querySelector('#tab-label-roster');
          if (tabCount) tabCount.textContent = `Crew Roster (${state.contributors.length})`;

          const tbody = backdrop.querySelector('#safar-crew-table-body');
          if (tbody) {
            tbody.innerHTML = state.contributors.map((u, idx) => `
              <tr class="crew-table-row" data-name="${escapeHtml(u.name.toLowerCase())}" data-series="${escapeHtml((u.series || '').toLowerCase())}">
                <td style="color: var(--text-muted); font-size: 0.78rem;">${idx + 1}</td>
                <td style="font-weight: 700; color: var(--text-primary); font-size: 0.92rem;">${escapeHtml(u.name)}</td>
                <td>
                  ${u.series ? `
                    <span class="badge-series">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>
                      <span>${escapeHtml(u.series)}</span>
                    </span>
                  ` : `
                    <span class="badge-series-empty">Not set</span>
                  `}
                </td>
                <td>${getRoleBadge(u.role)}</td>
                <td style="font-size: 0.8rem; color: var(--text-muted);">${escapeHtml(u.phone || u.its || '—')}</td>
                <td style="text-align: right;">
                  <button type="button" class="btn-edit-series-inline btn-edit-series-prompt" data-id="${u.id}" data-name="${escapeHtml(u.name)}" data-series="${escapeHtml(u.series || '')}" title="Edit Camera Series Code">
                    ✏️ Edit Series
                  </button>
                </td>
              </tr>
            `).join('');
            bindEditSeriesButtons();
          }

          // Also update top toolbar button counter
          const topCrewBtn = document.getElementById('btn-import-safar-crew');
          if (topCrewBtn) {
            const span = topCrewBtn.querySelector('span');
            if (span) span.textContent = `Crew & Series (${state.contributors.length})`;
          }

          loadEventsList();
        }
      } catch (err) {
        console.warn('Refresh crew error:', err);
      }
    }
  }

  // Backward compatibility alias
  const openImportCrewModal = openSafarCrewModal;

  // ============================================================================
  // MANAGE CITIES & CREW CONTRIBUTORS MODAL
  // ============================================================================
  function openManageCitiesModal() {
    removeAllModalBackdrops();

    const backdrop = document.createElement('div');
    backdrop.className = 'events-modal-backdrop';

    function getRoleBadge(role) {
      const r = (role || 'Photographer').toLowerCase();
      if (r.includes('video')) return `<span class="badge-role-video" style="padding: 2px 7px; border-radius: 4px; font-size: 0.74rem;">🎥 Videographer</span>`;
      if (r.includes('drone')) return `<span class="badge-role-drone" style="padding: 2px 7px; border-radius: 4px; font-size: 0.74rem;">🛸 Drone</span>`;
      if (r.includes('coord')) return `<span class="badge-role-coord" style="padding: 2px 7px; border-radius: 4px; font-size: 0.74rem;">📋 Coordinator</span>`;
      return `<span class="badge-role-photo" style="padding: 2px 7px; border-radius: 4px; font-size: 0.74rem;">📷 Photographer</span>`;
    }

    backdrop.innerHTML = `
      <div class="events-modal-card cities-crew-modal-card">
        <!-- Header -->
        <div class="events-modal-header" style="padding-bottom: 0.9rem; border-bottom: 1px solid var(--border-subtle, #e2e8f0);">
          <div>
            <div class="events-modal-title" style="font-size: 1.22rem;">
              <span class="modal-title-icon" style="background: rgba(16, 185, 129, 0.12); color: #059669; font-size: 1.1rem; border-radius: 8px; width: 32px; height: 32px; display: inline-flex; align-items: center; justify-content: center;">⚙️</span>
              <span>Manage Cities &amp; Contributor Crew</span>
            </div>
            <div class="cities-crew-header-sub">
              Target Safar: <strong style="color: var(--text-primary);">${escapeHtml(state.activeSafar || 'Current Safar')}</strong> • Manage destinations &amp; camera series roster
            </div>
          </div>
          <button type="button" class="events-modal-close-btn" id="btn-close-manage-modal" title="Close (Esc)">✕</button>
        </div>

        <!-- 2-Column Balanced Grid -->
        <div class="cities-crew-columns-grid">
          <!-- Left: Cities Management -->
          <div class="manage-col-panel" style="overflow: visible;">
            <div class="manage-col-header">
              <span class="manage-col-title">
                <span>Cities List</span>
                <span class="manage-count-badge" id="manage-cities-count">${state.cities.length}</span>
              </span>
              <span style="font-size: 0.72rem; color: var(--text-muted);">1 Team per City</span>
            </div>

            <!-- Scrollable Cities List -->
            <div class="manage-scroll-list" id="manage-cities-list">
              ${state.cities.map(c => `
                <div class="manage-list-item-card">
                  <div style="display: flex; align-items: center; gap: 8px;">
                    <span style="font-size: 0.9rem;">📍</span>
                    <span style="font-weight: 700; color: var(--text-primary); font-size: 0.88rem;">${escapeHtml(c.name)}</span>
                  </div>
                  <span class="city-quota-pill">${c.teams_required || 1} team req</span>
                </div>
              `).join('')}
            </div>

            <!-- Add City Bar with Combobox -->
            <div style="display: flex; gap: 8px; align-items: center; margin-top: 4px; position: relative;">
              <div class="city-combobox-wrapper" style="flex: 1;">
                <div class="city-combobox-input-wrap">
                  <input type="text" id="new-city-name-input" class="crew-input-control city-combobox-input" placeholder="Type city (e.g. Mumbai, Mumbra)..." autocomplete="off" spellcheck="false" style="width: 100%;">
                  <div class="city-combobox-indicator"><span class="city-indicator-icon">📍</span></div>
                </div>
                <div class="city-suggestions-dropdown hidden" id="manage-city-dropdown"></div>
              </div>
              <button type="button" class="btn-crew-action btn-crew-primary" id="btn-add-new-city-save">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                <span>Add</span>
              </button>
            </div>
          </div>

          <!-- Right: Contributor Crew Management -->
          <div class="manage-col-panel">
            <div class="manage-col-header">
              <span class="manage-col-title">
                <span>Contributors</span>
                <span class="manage-count-badge" id="manage-contribs-title-count">${state.contributors.length}</span>
              </span>
              <div style="display: flex; align-items: center; gap: 6px;">
                <button type="button" class="btn-subtab-template" id="btn-contrib-quick-template" style="font-size: 0.74rem; color: #059669; background: transparent; border: none; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 4px;" title="Download sample CSV roster template">
                  <span>📄 CSV Template</span>
                </button>
              </div>
            </div>

            <!-- Scrollable Contributors List -->
            <div class="manage-scroll-list" id="manage-contribs-list">
              ${state.contributors.map(u => `
                <div class="manage-list-item-card">
                  <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                    <span style="font-weight: 700; color: var(--text-primary); font-size: 0.88rem;">${escapeHtml(u.name)}</span>
                    ${u.series ? `<span class="contributor-series-chip">${escapeHtml(u.series)}</span>` : `<span class="contributor-series-empty">No series</span>`}
                    ${getRoleBadge(u.role)}
                  </div>
                  <div style="display: flex; align-items: center; gap: 8px;">
                    <span style="font-size: 0.74rem; color: var(--text-muted); font-family: 'JetBrains Mono', monospace;">${escapeHtml(u.phone || u.its || '')}</span>
                    <button type="button" class="btn-edit-series-inline btn-edit-contrib-prompt" data-id="${u.id}" data-name="${escapeHtml(u.name)}" data-series="${escapeHtml(u.series || '')}" title="Edit Camera Series" style="padding: 2px 6px; border-radius: 5px; cursor: pointer; border: 1px solid var(--border-subtle, #cbd5e1); background: transparent; font-size: 0.76rem;">✏️</button>
                  </div>
                </div>
              `).join('')}
            </div>

            <!-- Contributor Quick Add & Direct Import Section -->
            <div class="manage-crew-form-box">
              <!-- Switcher Tabs -->
              <div class="manage-crew-tabs-row">
                <div style="display: flex; gap: 6px;">
                  <button type="button" class="manage-crew-tab-pill active" id="btn-subtab-single">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                    <span>Quick Add</span>
                  </button>
                  <button type="button" class="manage-crew-tab-pill" id="btn-subtab-import">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
                    <span>Import Crew File</span>
                  </button>
                </div>
              </div>

              <!-- Pane 1: Add Single Contributor -->
              <div id="pane-contrib-single" style="display: flex; flex-direction: column; gap: 8px;">
                <div style="display: flex; gap: 8px; align-items: center;">
                  <input type="text" id="new-contrib-name" class="crew-input-control" placeholder="Full Name *" style="flex: 1.4;">
                  <input type="text" id="new-contrib-series" class="crew-input-control" placeholder="Series (e.g. ADN)" style="flex: 0.95; font-family: 'JetBrains Mono', monospace; text-transform: uppercase;">
                  <select id="new-contrib-role" class="crew-input-control" style="flex: 1.25; cursor: pointer;">
                    <option value="Photographer">📷 Photographer</option>
                    <option value="Videographer">🎥 Videographer</option>
                    <option value="Drone">🛸 Drone</option>
                    <option value="Coordinator">📋 Coordinator</option>
                  </select>
                </div>
                <div style="display: flex; gap: 8px; align-items: center;">
                  <input type="text" id="new-contrib-its" class="crew-input-control" placeholder="ITS ID (Optional)" style="flex: 1;">
                  <input type="text" id="new-contrib-phone" class="crew-input-control" placeholder="Phone (Optional)" style="flex: 1;">
                  <button type="button" class="btn-crew-action btn-crew-primary" id="btn-add-contrib-save">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                    <span>Add</span>
                  </button>
                  <button type="button" class="btn-crew-action btn-crew-secondary" id="btn-quick-import-trigger" title="Directly select and import .csv or .xlsx file">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
                    <span>Import File</span>
                  </button>
                </div>
              </div>

              <!-- Pane 2: Import Crew File directly right here -->
              <div id="pane-contrib-import" class="hidden" style="display: flex; flex-direction: column; gap: 10px;">
                <div style="font-size: 0.8rem; color: var(--text-muted);">
                  Import crew list (.csv, .xlsx, .xls) for <strong style="color: var(--text-primary);">${escapeHtml(state.activeSafar || 'Current Safar')}</strong>:
                </div>
                <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
                  <button type="button" class="btn-crew-action btn-crew-primary" id="btn-contrib-direct-browse">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
                    <span>Browse Excel / CSV</span>
                  </button>
                  <button type="button" class="btn-crew-action btn-crew-secondary" id="btn-contrib-toggle-paste">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect></svg>
                    <span>Paste Roster</span>
                  </button>
                  <button type="button" class="btn-crew-action btn-crew-secondary" id="btn-contrib-direct-template" title="Download CSV template">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
                    <span>Template</span>
                  </button>
                  <input type="file" id="contrib-direct-dom-picker" accept=".csv,.xlsx,.xls,.tsv,.txt" style="display: none;">
                </div>

                <div id="contrib-direct-paste-box" class="hidden" style="display: flex; flex-direction: column; gap: 8px; margin-top: 4px;">
                  <textarea id="contrib-direct-paste-input" class="crew-input-control" rows="3" style="font-family: 'JetBrains Mono', monospace; font-size: 0.78rem; height: auto; padding: 8px;" placeholder="Adnan, ADN, Photographer&#10;Aliasgar, MR_A, Videographer&#10;Murtaza, MUR, Photographer"></textarea>
                  <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span style="font-size: 0.74rem; color: var(--text-muted);">Columns: Name, Series, Role, ITS, Phone</span>
                    <button type="button" class="btn-crew-action btn-crew-primary" id="btn-contrib-parse-paste-action">
                      Import Pasted Rows
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div style="display: flex; justify-content: space-between; align-items: center; padding-top: 0.85rem; border-top: 1px solid var(--border-subtle, #e2e8f0); margin-top: 4px;">
          <div style="font-size: 0.78rem; color: var(--text-muted);">
            Changes to cities &amp; camera series apply instantly to all event exports and media sorting.
          </div>
          <button type="button" class="btn-crew-action btn-crew-primary" id="btn-close-manage-bottom" style="padding: 0 24px;">Done</button>
        </div>
      </div>
    `;

    document.body.appendChild(backdrop);

    // Reliable modal closing
    const closeManageModal = () => {
      document.removeEventListener('keydown', onEscManage);
      backdrop.remove();
    };

    const onEscManage = (e) => {
      if (e.key === 'Escape') closeManageModal();
    };
    document.addEventListener('keydown', onEscManage);

    backdrop.querySelector('#btn-close-manage-modal').onclick = closeManageModal;
    backdrop.querySelector('#btn-close-manage-bottom').onclick = closeManageModal;

    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closeManageModal();
    });

    // Attach combobox to manage city input
    const manageCityInp = backdrop.querySelector('#new-city-name-input');
    const manageCityDropdown = backdrop.querySelector('#manage-city-dropdown');
    const manageCityIndicator = backdrop.querySelector('.manage-col-panel .city-combobox-indicator');
    if (manageCityInp && manageCityDropdown) {
      attachCityCombobox(manageCityInp, manageCityDropdown, manageCityIndicator, (item) => {
        manageCityInp.value = item.name;
      });
    }

    // Dynamic Contributor List Refresh without modal re-opening
    async function refreshManageContribsList() {
      const cList = backdrop.querySelector('#manage-contribs-list');
      const cTitle = backdrop.querySelector('#manage-contribs-title-count');
      if (!cList) return;
      try {
        const freshRes = await callApi('events_get_contributors', state.activeSafar || '');
        if (freshRes && Array.isArray(freshRes)) {
          state.contributors = freshRes;
        } else if (freshRes && Array.isArray(freshRes.contributors)) {
          state.contributors = freshRes.contributors;
        }
      } catch (err) {
        console.warn('Error refreshing contributors:', err);
      }
      if (cTitle) cTitle.textContent = `${state.contributors.length}`;
      cList.innerHTML = state.contributors.map(u => `
        <div class="manage-list-item-card">
          <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
            <span style="font-weight: 700; color: var(--text-primary); font-size: 0.88rem;">${escapeHtml(u.name)}</span>
            ${u.series ? `<span class="contributor-series-chip">${escapeHtml(u.series)}</span>` : `<span class="contributor-series-empty">No series</span>`}
            ${getRoleBadge(u.role)}
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 0.74rem; color: var(--text-muted); font-family: 'JetBrains Mono', monospace;">${escapeHtml(u.phone || u.its || '')}</span>
            <button type="button" class="btn-edit-series-inline btn-edit-contrib-prompt" data-id="${u.id}" data-name="${escapeHtml(u.name)}" data-series="${escapeHtml(u.series || '')}" title="Edit Camera Series" style="padding: 2px 6px; border-radius: 5px; cursor: pointer; border: 1px solid var(--border-subtle, #cbd5e1); background: transparent; font-size: 0.76rem;">✏️</button>
          </div>
        </div>
      `).join('');
      bindEditContribButtons();
    }

    // Direct Import Functionality
    async function doDirectImport(filePath, fileContent) {
      try {
        window.showToast('Importing crew roster...', 'info');
        const res = await callApi('events_import_crew_file', state.activeSafar || '', filePath || '', fileContent || '');
        if (res && res.success) {
          const count = res.imported_count || res.contributors?.length || 0;
          window.showToast(`Imported ${count} crew member${count === 1 ? '' : 's'} successfully!`, 'success');
          await refreshManageContribsList();
        } else {
          window.showToast(res?.error || 'Failed to import crew file', 'error');
        }
      } catch (err) {
        console.error('doDirectImport error:', err);
        window.showToast('Import error: ' + err.message, 'error');
      }
    }

    // Subtab switching
    const btnSubtabSingle = backdrop.querySelector('#btn-subtab-single');
    const btnSubtabImport = backdrop.querySelector('#btn-subtab-import');
    const paneSingle = backdrop.querySelector('#pane-contrib-single');
    const paneImport = backdrop.querySelector('#pane-contrib-import');

    if (btnSubtabSingle && btnSubtabImport) {
      btnSubtabSingle.onclick = () => {
        btnSubtabSingle.classList.add('active');
        btnSubtabImport.classList.remove('active');
        if (paneSingle) paneSingle.style.display = 'flex';
        if (paneImport) {
          paneImport.classList.add('hidden');
          paneImport.style.display = 'none';
        }
      };
      btnSubtabImport.onclick = () => {
        btnSubtabImport.classList.add('active');
        btnSubtabSingle.classList.remove('active');
        if (paneImport) {
          paneImport.classList.remove('hidden');
          paneImport.style.display = 'flex';
        }
        if (paneSingle) paneSingle.style.display = 'none';
      };
    }

    // Quick Import trigger from Single pane
    const quickImportBtn = backdrop.querySelector('#btn-quick-import-trigger');
    const directBrowseBtn = backdrop.querySelector('#btn-contrib-direct-browse');
    const directDomPicker = backdrop.querySelector('#contrib-direct-dom-picker');

    const triggerBrowse = async () => {
      try {
        const dialogRes = await callApi('events_select_crew_file');
        if (dialogRes && dialogRes.cancelled) return;
        if (dialogRes && dialogRes.file_path) {
          await doDirectImport(dialogRes.file_path, '');
          return;
        }
      } catch (e) {}
      if (directDomPicker) directDomPicker.click();
    };

    if (quickImportBtn) quickImportBtn.onclick = triggerBrowse;
    if (directBrowseBtn) directBrowseBtn.onclick = triggerBrowse;

    if (directDomPicker) {
      directDomPicker.onchange = (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (evt) => {
          await doDirectImport('', evt.target.result);
        };
        reader.readAsText(file);
      };
    }

    // Paste handling
    const togglePasteBtn = backdrop.querySelector('#btn-contrib-toggle-paste');
    const pasteBox = backdrop.querySelector('#contrib-direct-paste-box');
    const parsePasteBtn = backdrop.querySelector('#btn-contrib-parse-paste-action');

    if (togglePasteBtn && pasteBox) {
      togglePasteBtn.onclick = () => {
        pasteBox.classList.toggle('hidden');
        if (!pasteBox.classList.contains('hidden')) {
          backdrop.querySelector('#contrib-direct-paste-input')?.focus();
        }
      };
    }

    if (parsePasteBtn) {
      parsePasteBtn.onclick = async () => {
        const txt = backdrop.querySelector('#contrib-direct-paste-input')?.value?.trim();
        if (!txt) {
          window.showToast('Please paste roster rows first', 'warning');
          return;
        }
        await doDirectImport('', txt);
      };
    }

    // Template download handlers
    const downloadTemplateAction = async () => {
      const csvContent = `Name,Camera Series,Role,ITS,Phone\nAdnan Bhai,ADN,Photographer,20384721,+919876543210\nAliasgar Bhai,MR_A,Videographer,20492834,+919876543211\nMurtaza Bhai,MUR,Photographer,30182745,+919876543212\nTaha Bhai,TAHA,Videographer,40291837,+919876543213\nHusain Bhai,DRN_1,Drone,50192837,+919876543214\n`;
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'Crew_Camera_Series_Roster_Template.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      try {
        const res = await callApi('events_download_crew_template', state.activeSafar || '');
        if (res && res.saved_paths && res.saved_paths.length > 0) {
          const locs = res.saved_paths.join('\n• ');
          window.showToast(`Template saved to:\n• ${locs}`, 'success');
          return;
        }
      } catch (err) {
        console.warn('Backend template save err:', err);
      }
      window.showToast('Downloaded to your Downloads folder: Crew_Camera_Series_Roster_Template.csv', 'success');
    };

    const quickTmplBtn = backdrop.querySelector('#btn-contrib-quick-template');
    const directTmplBtn = backdrop.querySelector('#btn-contrib-direct-template');
    if (quickTmplBtn) quickTmplBtn.onclick = downloadTemplateAction;
    if (directTmplBtn) directTmplBtn.onclick = downloadTemplateAction;

    // Edit series on individual rows
    function bindEditContribButtons() {
      backdrop.querySelectorAll('.btn-edit-contrib-prompt').forEach(btn => {
        btn.onclick = async () => {
          const uid = btn.getAttribute('data-id');
          const uName = btn.getAttribute('data-name');
          const currSeries = btn.getAttribute('data-series') || '';
          const newSeries = window.promptModal ? await window.promptModal({
            title: 'Edit Camera Series Code',
            message: `Enter camera series code for <strong>"${uName}"</strong>:`,
            defaultValue: currSeries,
            placeholder: 'e.g. ADN, MR_A, MUR, TAHA',
            confirmText: 'Save Series'
          }) : prompt(`Enter Camera Series code for "${uName}" (e.g. ADN, MR_A, MUR, TAHA):`, currSeries);

          if (newSeries !== null) {
            const updRes = await callApi('events_update_contributor', uid, null, null, null, null, newSeries.trim().toUpperCase(), state.activeSafar || '');
            if (updRes && updRes.contributor) {
              const cObj = state.contributors.find(c => String(c.id) === String(uid));
              if (cObj) cObj.series = updRes.contributor.series;
              await refreshManageContribsList();
              window.showToast(`Updated "${uName}" camera series to "${updRes.contributor.series}"`);
            }
          }
        };
      });
    }
    bindEditContribButtons();

    // Add City
    backdrop.querySelector('#btn-add-new-city-save').onclick = async () => {
      const name = backdrop.querySelector('#new-city-name-input')?.value?.trim();
      if (!name) return;
      const res = await callApi('events_add_city', name, 1);
      if (res && res.city) {
        if (!state.cities.some(c => c.id === res.city.id)) {
          state.cities.push(res.city);
          populateCityFilter();
        }
        closeManageModal();
        openManageCitiesModal();
        window.showToast(`City "${name}" added!`);
      }
    };

    // Add Single Contributor
    backdrop.querySelector('#btn-add-contrib-save').onclick = async () => {
      const name = backdrop.querySelector('#new-contrib-name')?.value?.trim();
      const role = backdrop.querySelector('#new-contrib-role')?.value || 'Photographer';
      const series = backdrop.querySelector('#new-contrib-series')?.value?.trim().toUpperCase() || '';
      const its = backdrop.querySelector('#new-contrib-its')?.value?.trim() || '';
      const phone = backdrop.querySelector('#new-contrib-phone')?.value?.trim() || '';

      if (!name) {
        window.showToast('Please enter contributor name', 'warning');
        return;
      }

      const res = await callApi('events_add_contributor', name, its, phone, role, series, state.activeSafar || '');
      if (res && res.contributor) {
        state.contributors.push(res.contributor);
        backdrop.querySelector('#new-contrib-name').value = '';
        backdrop.querySelector('#new-contrib-series').value = '';
        backdrop.querySelector('#new-contrib-its').value = '';
        backdrop.querySelector('#new-contrib-phone').value = '';
        await refreshManageContribsList();
        window.showToast(`Contributor "${name}" registered!`);
      }
    };
  }

  // ============================================================================
  // UNIFIED MODULE INITIALIZER & BOOTLOADER
  // ============================================================================
  let _eventsModuleBooted = false;

  function bootEventsModule() {
    // Wire the AIN53 Coordinator brand click every boot (not behind _eventsModuleBooted guard)
    const btnHiddenSafarsGridBoot = document.getElementById('btn-hidden-safars-grid');
    if (btnHiddenSafarsGridBoot) {
      btnHiddenSafarsGridBoot.onclick = (e) => window.toggleSafarsGridPage(e);
    }

    wireEventsPageListeners();
    initDensitySwitcher();
    loadMasterData().then(() => {
      return loadEventsList();
    }).catch(err => {
      console.error('[Events] Boot error:', err);
      state.events = [];
      renderEventsList();
    });
  }

  function wireEventsPageListeners() {
    if (_eventsModuleBooted) return;
    _eventsModuleBooted = true;

    // Wire top buttons
    const btnCreateEvent = document.getElementById('btn-open-create-event');
    if (btnCreateEvent) {
      btnCreateEvent.onclick = toggleCreateEventInline;
    }

    const btnManageCities = document.getElementById('btn-open-manage-cities');
    if (btnManageCities) {
      btnManageCities.onclick = openManageCitiesModal;
    }

    const btnHiddenSafarsGrid = document.getElementById('btn-hidden-safars-grid');
    if (btnHiddenSafarsGrid) {
      btnHiddenSafarsGrid.onclick = (e) => window.toggleSafarsGridPage(e);
    }

    const btnRefresh = document.getElementById('btn-refresh-events');
    if (btnRefresh) {
      btnRefresh.onclick = async () => {
        await loadMasterData();
        await loadEventsList();
        window.showToast('Events reloaded');
      };
    }

    // Wire filter changes
    const filterDate = document.getElementById('filter-event-date');
    if (filterDate) {
      filterDate.oninput = () => {
        state.filterDate = filterDate.value.trim();
        loadEventsList();
      };
    }

    const filterSlot = document.getElementById('filter-event-slot');
    if (filterSlot) {
      filterSlot.onchange = () => {
        state.filterSlot = filterSlot.value;
        loadEventsList();
      };
    }

    const filterCity = document.getElementById('filter-event-city');
    if (filterCity) {
      filterCity.onchange = () => {
        state.filterCityId = filterCity.value;
        loadEventsList();
      };
    }
  }

  // Handle immediate execution if DOM is already ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootEventsModule);
  } else {
    bootEventsModule();
  }

  // PyWebView event listener
  window.addEventListener('pywebviewready', () => {
    bootEventsModule();
  });

  // Global refresh hook for view switching
  window.refreshEventsView = function() {
    bootEventsModule();
  };

})();
