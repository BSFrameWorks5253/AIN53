// ── AIN53 Data Management ── React 18 Live UI Component Suite ──

const e = React.createElement;

// ==============================================================================
// 1. TOP HEADER & THEME SWITCHER COMPONENT
// ==============================================================================
function ThemeSwitcher({ currentTheme, onThemeChange }) {
  const themes = [
    { id: 'dark', label: 'Dark' },
    { id: 'light', label: 'Light' }
  ];

  return e('div', { className: 'theme-switcher-pill' },
    themes.map(t => e('button', {
      key: t.id,
      className: `theme-btn ${currentTheme === t.id ? 'active' : ''}`,
      onClick: () => {
        onThemeChange(t.id);
        if (window.setAppTheme) window.setAppTheme(t.id);
      }
    }, t.label))
  );
}

function HeaderBar({ activeTitle, currentTheme, onThemeChange, statusMsg }) {
  return e('div', { className: 'top-header-bar' },
    e('div', { className: 'header-tool-info' },
      e('img', {
        src: './ICON.png',
        alt: 'AIN53 Logo',
        style: { width: '28px', height: '28px', objectFit: 'contain', filter: 'drop-shadow(0 2px 6px var(--shadow-glow))' },
        onError: (evt) => { evt.target.src = 'https://cdn-icons-png.flaticon.com/512/9322/9322127.png'; }
      }),
      e('span', { className: 'header-tool-title' }, activeTitle || 'PDF to CSV Extractor'),
      e('div', { className: 'status-indicator-badge' },
        e('div', { className: 'status-dot' }),
        e('span', null, statusMsg || 'System Ready')
      )
    ),
    e('div', { className: 'header-actions-group' },
      e('div', {
        className: 'header-brand-imprint',
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: '0.4rem',
          fontSize: '0.85rem',
          fontWeight: '700',
          color: 'var(--text-muted)',
          paddingRight: '0.8rem',
          marginRight: '0.4rem',
          borderRight: '1px solid var(--border-glass)'
        }
      },
        e('span', { style: { color: 'var(--accent-blue)', fontWeight: '800', fontFamily: 'Outfit, sans-serif' } }, 'AIN53'),
        e('span', { className: 'app-version-tag', style: { fontSize: '0.78rem', opacity: 0.85, fontFamily: 'Outfit, sans-serif' } }, 'v 1.0.26')
      ),
      e(ThemeSwitcher, { currentTheme, onThemeChange })
    )
  );
}

// ==============================================================================
// 2. FLOATING LIVE PROCESS DOCK COMPONENT
// ==============================================================================
function LiveProcessDock({ isProcessing, title, subtitle, current, total, percent, eta }) {
  if (!isProcessing) return null;

  return e('div', { className: 'live-process-dock' },
    e('div', { className: 'dock-header' },
      e('div', { className: 'dock-title' },
        e('span', { style: { color: 'var(--accent-blue)', display: 'inline-block', animation: 'spin 1.5s linear infinite' } }, '⚙'),
        e('span', null, title || 'Processing Task...')
      ),
      e('span', { style: { fontSize: '0.85rem', fontWeight: '700', color: 'var(--accent-blue)' } }, `${percent}%`)
    ),
    e('div', { className: 'dock-progress-bar' },
      e('div', { className: 'dock-progress-fill', style: { width: `${percent}%` } })
    ),
    e('div', { className: 'dock-stats' },
      e('span', null, total > 0 ? `${current} / ${total} items` : subtitle),
      e('span', null, eta || 'Processing...')
    )
  );
}

// ==============================================================================
// 3. INTERACTIVE FOLDER TREE PREVIEW COMPONENT (CSV to Folders)
// ==============================================================================
function FolderTreePreview({ masterFolders }) {
  if (!masterFolders || Object.keys(masterFolders).length === 0) return null;

  return e('div', {
    style: {
      marginTop: '1.2rem',
      padding: '1rem 1.2rem',
      background: 'var(--bg-glass-card)',
      border: '1px solid var(--border-glass)',
      borderRadius: 'var(--radius-sm)',
      maxHeight: '220px',
      overflowY: 'auto'
    }
  },
    e('div', { style: { fontSize: '0.88rem', fontWeight: '700', color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '0.6rem' } },
      '📁 Preview Target Folder Hierarchy'
    ),
    e('div', { style: { fontFamily: 'JetBrains Mono, monospace', fontSize: '0.88rem', color: 'var(--text-primary)' } },
      Object.entries(masterFolders).map(([master, contribs], idx) => 
        e('div', { key: idx, style: { marginBottom: '0.5rem' } },
          e('div', { style: { color: 'var(--accent-blue)', fontWeight: '600' } }, `└── 📂 ${master}`),
          Array.from(contribs).map((c, cIdx) => 
            e('div', { key: cIdx, style: { paddingLeft: '1.4rem', color: 'var(--text-muted)' } }, `    ├── 📁 ${c}`)
          )
        )
      )
    )
  );
}

// ==============================================================================
// 4. COLOR GRADE PRESET VISUALIZER COMPONENT (Media Sorting)
// ==============================================================================
function ColorGradeVisualizer({ activePreset, onSelectPreset }) {
  const presets = [
    { id: 'rec709', name: 'Standard Rec709', desc: 'Natural color mapping', color: '#10b981' },
    { id: 'vivid_event', name: 'Vivid Event', desc: 'Punchy saturation & contrast', color: '#3b82f6' },
    { id: 'cinema_gold', name: 'Warm Cinema', desc: 'Warm shadows & golden highlights', color: '#f59e0b' },
    { id: 'cool_noir', name: 'Cold Noir', desc: 'Deep blue contrast', color: '#8b5cf6' }
  ];

  return e('div', {
    style: {
      padding: '1rem',
      background: 'var(--bg-glass-card)',
      border: '1px solid var(--border-glass)',
      borderRadius: 'var(--radius-sm)',
      marginBottom: '1rem'
    }
  },
    e('div', { style: { fontSize: '0.88rem', fontWeight: '700', color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '0.6rem' } },
      '🎨 Auto Color Grading & LUT Profiles'
    ),
    e('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.6rem' } },
      presets.map(p => 
        e('div', {
          key: p.id,
          onClick: () => onSelectPreset(p.id),
          style: {
            padding: '0.6rem',
            borderRadius: '8px',
            border: activePreset === p.id ? `1.5px solid ${p.color}` : '1px solid var(--border-glass)',
            background: activePreset === p.id ? 'var(--bg-glass-hover)' : 'transparent',
            cursor: 'pointer',
            transition: 'all 0.2s ease'
          }
        },
          e('div', { style: { fontSize: '0.88rem', fontWeight: '700', color: p.color } }, p.name),
          e('div', { style: { fontSize: '0.78rem', color: 'var(--text-muted)' } }, p.desc)
        )
      )
    )
  );
}

// Global React Controller Window Binding
window.ReactController = {
  headerState: { activeTitle: 'PDF to CSV Extractor', theme: localStorage.getItem('ain53_theme') || 'dark', status: 'System Ready' },
  dockState: { isProcessing: false, title: '', subtitle: '', current: 0, total: 0, percent: 0, eta: '' },
  activeColorPreset: 'rec709',

  setTheme(themeId) {
    this.headerState.theme = themeId;
    document.documentElement.setAttribute('data-theme', themeId);
    localStorage.setItem('ain53_theme', themeId);
    this.renderHeader();
  },

  setActiveTitle(title) {
    this.headerState.activeTitle = title;
    this.renderHeader();
  },

  setStatus(msg) {
    this.headerState.status = msg;
    this.renderHeader();
  },

  updateDock(dockData) {
    this.dockState = { ...this.dockState, ...dockData };
    this.renderDock();
  },

  renderHeader() {
    const rootEl = document.getElementById('react-header-root');
    if (rootEl && window.ReactDOM) {
      if (!this._headerRoot) {
        this._headerRoot = ReactDOM.createRoot(rootEl);
      }
      this._headerRoot.render(e(HeaderBar, {
        activeTitle: this.headerState.activeTitle,
        currentTheme: this.headerState.theme,
        onThemeChange: (t) => this.setTheme(t),
        statusMsg: this.headerState.status
      }));
    }
  },

  renderDock() {
    const rootEl = document.getElementById('react-live-dock-root');
    if (rootEl && window.ReactDOM) {
      if (!this._dockRoot) {
        this._dockRoot = ReactDOM.createRoot(rootEl);
      }
      this._dockRoot.render(e(LiveProcessDock, this.dockState));
    }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  // Apply saved theme immediately
  const savedTheme = localStorage.getItem('ain53_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);
  
  // Render header & dock
  setTimeout(() => {
    if (window.ReactController) {
      window.ReactController.renderHeader();
      window.ReactController.renderDock();
    }
  }, 100);
});
