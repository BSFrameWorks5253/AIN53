/* ==============================================================================
   AIN53 Data Management — View Partial Loader Component (view_loader.js)
   ============================================================================== */

window.loadViewPartials = async function () {
  const includeElements = document.querySelectorAll('[data-include]');
  const promises = Array.from(includeElements).map(async (el) => {
    const file = el.getAttribute('data-include');
    if (!file) return;
    try {
      const resp = await fetch(file);
      if (resp.ok) {
        const html = await resp.text();
        el.outerHTML = html;
      }
    } catch (err) {
      console.warn(`View partial fetch notice for ${file}:`, err);
    }
  });
  await Promise.all(promises);
};
