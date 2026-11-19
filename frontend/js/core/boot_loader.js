/* ==============================================================================
   AIN53 Data Management — Startup Boot Loader Screen Script (boot_loader.js)
   ============================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  const bootSteps = [
    { progress: 0,  text: "Initializing core system..." },
    { progress: 12, text: "Verifying secure protocols & environment..." },
    { progress: 26, text: "Loading modules and libraries..." },
    { progress: 42, text: "Establishing local database handshake..." },
    { progress: 60, text: "Optimizing sorting indexes & caches..." },
    { progress: 78, text: "Preparing media orchestration engine..." },
    { progress: 90, text: "Mounting user interfaces..." },
    { progress: 100, text: "System ready — Launching suite" }
  ];

  const progressBar = document.getElementById('splash-progress-bar');
  const circle = document.getElementById('progress-circle');
  const pctVal = document.getElementById('pct-val');
  const logMsg = document.getElementById('log-msg');
  const loaderScreen = document.getElementById('loading-screen');

  // Subsystem indicator pills
  const subsysPills = {
    core: document.getElementById('subsys-core'),
    db: document.getElementById('subsys-db'),
    media: document.getElementById('subsys-media'),
    ready: document.getElementById('subsys-ready')
  };

  const strokeDash = 276.46;

  function updateSubsystems(percent) {
    // CORE: active at 5%, complete at 28%
    if (subsysPills.core) {
      if (percent >= 28) {
        subsysPills.core.className = 'subsystem-pill complete';
      } else if (percent >= 5) {
        subsysPills.core.className = 'subsystem-pill active';
      }
    }
    // DB: active at 28%, complete at 58%
    if (subsysPills.db) {
      if (percent >= 58) {
        subsysPills.db.className = 'subsystem-pill complete';
      } else if (percent >= 28) {
        subsysPills.db.className = 'subsystem-pill active';
      }
    }
    // MEDIA: active at 58%, complete at 84%
    if (subsysPills.media) {
      if (percent >= 84) {
        subsysPills.media.className = 'subsystem-pill complete';
      } else if (percent >= 58) {
        subsysPills.media.className = 'subsystem-pill active';
      }
    }
    // READY/RUNTIME: active at 84%, complete at 100%
    if (subsysPills.ready) {
      if (percent >= 100) {
        subsysPills.ready.className = 'subsystem-pill complete';
      } else if (percent >= 84) {
        subsysPills.ready.className = 'subsystem-pill active';
      }
    }
  }

  function setProgress(percent) {
    const clamped = Math.min(100, Math.max(0, percent));
    
    // Linear bar update
    if (progressBar) {
      progressBar.style.width = clamped + '%';
    }

    // Circular ring update (for backward compatibility)
    if (circle) {
      const offset = strokeDash - (clamped / 100) * strokeDash;
      circle.style.strokeDashoffset = offset;
    }

    // Number text update
    if (pctVal) {
      pctVal.textContent = Math.round(clamped);
    }

    // Update telemetry subsystem status pills
    updateSubsystems(clamped);
  }

  let stepIndex = 0;
  let targetPercent = 0;
  let currentPercent = 0;
  let animFrameId = null;

  // Smooth 60fps interpolation loop
  function animateProgress() {
    if (currentPercent < targetPercent) {
      const diff = targetPercent - currentPercent;
      const step = Math.max(0.18, diff * 0.1);
      currentPercent = Math.min(targetPercent, currentPercent + step);
      setProgress(currentPercent);
    }

    if (currentPercent < 100 || targetPercent < 100) {
      animFrameId = requestAnimationFrame(animateProgress);
    } else {
      // Completed 100%
      setProgress(100);
      if (logMsg) {
        logMsg.textContent = "System ready — Launching suite";
      }
      setTimeout(() => {
        if (loaderScreen) {
          loaderScreen.classList.add('fade-out');
          setTimeout(() => {
            loaderScreen.style.display = 'none';
            if (animFrameId) cancelAnimationFrame(animFrameId);
          }, 600);
        }
      }, 550);
    }
  }

  function advanceStep() {
    if (targetPercent >= 100) return;

    // Measured pacing increments (~3% to 6% per tick)
    targetPercent += Math.floor(Math.random() * 4) + 3;
    if (targetPercent > 100) targetPercent = 100;

    // Find corresponding boot step message
    while (
      stepIndex < bootSteps.length - 1 &&
      targetPercent >= bootSteps[stepIndex + 1].progress
    ) {
      stepIndex++;
    }

    if (logMsg) {
      logMsg.textContent = bootSteps[stepIndex].text;
    }

    if (targetPercent < 100) {
      // Step delay between 90ms and 155ms
      const nextDelay = Math.floor(Math.random() * 65) + 90;
      setTimeout(advanceStep, nextDelay);
    }
  }

  // Kick off smooth render loop and step simulation
  animFrameId = requestAnimationFrame(animateProgress);
  setTimeout(advanceStep, 250);
});
