/* ==============================================================================
   AIN53 Data Management — User Guide Modal Controller (guide_modal.js)
   ============================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  const guideBtn = document.getElementById('btn-more-info');
  const guideModal = document.getElementById('guide-modal');
  const guideCloseBtn = document.getElementById('btn-guide-close');
  const guideModalContent = document.getElementById('guide-modal-content');

  if (guideBtn && guideModal && guideCloseBtn) {
    guideBtn.addEventListener('click', () => {
      guideModal.style.display = 'flex';
    });

    guideCloseBtn.addEventListener('click', () => {
      guideModal.style.display = 'none';
    });

    guideModal.addEventListener('click', (e) => {
      if (e.target === guideModal) {
        guideModal.style.display = 'none';
      }
    });

    const guideLinks = document.querySelectorAll('.guide-nav-links a');
    guideLinks.forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const targetId = link.getAttribute('href').substring(1);
        const targetEl = document.getElementById(targetId);
        if (targetEl && guideModalContent) {
          const containerTop = guideModalContent.getBoundingClientRect().top;
          const targetTop = targetEl.getBoundingClientRect().top;
          const scrollOffset = targetTop - containerTop + guideModalContent.scrollTop - 20;

          guideModalContent.scrollTo({
            top: scrollOffset,
            behavior: 'smooth'
          });
        }
      });
    });

    const guideNavBtns = document.querySelectorAll('.btn-guide-nav');
    guideNavBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const targetView = btn.getAttribute('data-target-view');
        guideModal.style.display = 'none';
        const sidebarBtn = document.querySelector(`.sidebar-nav .nav-btn[data-view="${targetView}"]`);
        if (sidebarBtn) {
          sidebarBtn.click();
        }
      });
    });
  }
});
