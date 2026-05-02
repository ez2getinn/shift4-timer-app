const API_URL = 'https://script.google.com/macros/s/AKfycbzOChrnwwBw6qQjgxXyZks6aTJOsv_80SmL41EeMoO0J1fDwz-xDqJYpKdR0-ce86hp/exec';

const state = {
  sessionId: createSessionId(),
  appData: {},
  sections: [],
  expandedSections: {},
  activeStepKey: '',
  timerStatus: 'idle',
  startedAt: null,
  stoppedAt: null,
  completedAt: null,
  activeStartedAt: null,
  pausedStartedAt: null,
  accumulatedMs: 0,
  pausedSeconds: 0,
  timerInterval: null,
  stepRecords: {}
};

const els = {};

document.addEventListener('DOMContentLoaded', initApp);

async function initApp() {
  cacheElements();
  registerServiceWorker();
  setBusy('Loading');

  try {
    const result = await apiCall('getAppData');

    if (!result || !result.success) {
      throw new Error(result && result.message ? result.message : 'Unable to load app data.');
    }

    state.appData = result.data || {};
    state.sections = state.appData.sections || [];

    applyConfig();
    initializeSections();
    renderSummary();
    renderSections();

    setBusy('Ready');
    revealApp();

  } catch (error) {
    setBusy('Error');
    renderLoadError(error.message || 'Unable to load app.');
    revealApp();
  }
}

function cacheElements() {
  els.splashScreen = document.getElementById('splashScreen');
  els.appShell = document.getElementById('appShell');
  els.appTitle = document.getElementById('appTitle');
  els.connectionStatus = document.getElementById('connectionStatus');
  els.completedCount = document.getElementById('completedCount');
  els.grandTotal = document.getElementById('grandTotal');
  els.sectionsList = document.getElementById('sectionsList');
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  }
}

function applyConfig() {
  const appTitle = state.appData.appName || 'Shift4 Step Timer';
  document.title = appTitle;
  els.appTitle.textContent = appTitle;
}

function initializeSections() {
  state.sections.forEach((section, index) => {
    const sectionKey = getSectionKey(section);
    state.expandedSections[sectionKey] = index === 0;

    section.steps.forEach(step => {
      const stepKey = getStepKey(step);

      state.stepRecords[stepKey] = {
        sectionOrder: step.sectionOrder,
        section: step.sectionName,
        stepOrder: step.stepOrder,
        stepName: step.stepName,
        stepNotes: step.stepNotes || '',
        durationSeconds: 0,
        durationDisplay: '00:00:00',
        pausedSeconds: 0,
        status: 'NOT_STARTED',
        stepStartedAt: '',
        stepStoppedAt: '',
        stepCompletedAt: ''
      };
    });
  });
}

function renderLoadError(message) {
  els.sectionsList.innerHTML = `
    <div class="card">
      <div class="section-title">Unable to load checklist</div>
      <p class="muted">${escapeHtml(message)}</p>
    </div>
  `;
}

function renderSections() {
  if (!state.sections.length) {
    els.sectionsList.innerHTML = `
      <div class="card">
        <div class="section-title">No checklist found</div>
        <p class="muted">No active steps were found in StepsConfig.</p>
      </div>
    `;
    return;
  }

  els.sectionsList.innerHTML = '';

  state.sections.forEach(section => {
    const sectionKey = getSectionKey(section);
    const isExpanded = Boolean(state.expandedSections[sectionKey]);
    const sectionTotalSeconds = getSectionTotalSeconds(section);
    const completedCount = getSectionCompletedCount(section);
    const totalCount = section.steps.length;

    const sectionCard = document.createElement('div');
    sectionCard.className = 'section-card';

    const headerButton = document.createElement('button');
    headerButton.type = 'button';
    headerButton.className = 'section-header-button';

    headerButton.innerHTML = `
      <div class="section-header-top">
        <div class="section-name">${escapeHtml(section.sectionName)}</div>
        <div class="section-chevron">${isExpanded ? '−' : '+'}</div>
      </div>
      <div class="section-meta">
        <span class="section-pill">Section Total: ${formatDuration(sectionTotalSeconds)}</span>
        <span class="section-pill ${completedCount === totalCount ? 'done' : ''}">
          ${completedCount}/${totalCount} done
        </span>
      </div>
    `;

    headerButton.addEventListener('click', function() {
      state.expandedSections[sectionKey] = !state.expandedSections[sectionKey];
      renderSections();
    });

    const body = document.createElement('div');
    body.className = isExpanded ? 'section-body' : 'section-body collapsed';

    section.steps.forEach(step => {
      body.appendChild(createStepRow(step));
    });

    sectionCard.appendChild(headerButton);
    sectionCard.appendChild(body);
    els.sectionsList.appendChild(sectionCard);
  });
}

function createStepRow(step) {
  const stepKey = getStepKey(step);
  const record = state.stepRecords[stepKey];

  const row = document.createElement('div');
  row.className = 'step-row';

  if (state.activeStepKey === stepKey) {
    row.classList.add('active');
  }

  if (record.status === 'COMPLETED') {
    row.classList.add('completed');
  }

  const hasActiveDifferentStep =
    state.activeStepKey &&
    state.activeStepKey !== stepKey &&
    ['running', 'paused', 'stopped'].includes(state.timerStatus);

  const canStart =
    !hasActiveDifferentStep &&
    (record.status === 'NOT_STARTED' || record.status === 'SAVE_FAILED');

  const canPause =
    state.activeStepKey === stepKey &&
    state.timerStatus === 'running';

  const canStop =
    state.activeStepKey === stepKey &&
    (state.timerStatus === 'running' || state.timerStatus === 'paused');

  const canComplete =
    state.activeStepKey === stepKey &&
    state.timerStatus === 'stopped';

  row.innerHTML = `
    <div class="step-check">${record.status === 'COMPLETED' ? '✓' : ''}</div>

    <div class="step-info">
      <div class="step-name">${escapeHtml(step.stepName)}</div>
      <div class="step-notes">${escapeHtml(step.stepNotes || '')}</div>

      <div class="step-actions">
        <button
          class="step-btn start-step"
          type="button"
          data-action="start"
          data-step-key="${escapeHtml(stepKey)}"
          ${canStart ? '' : 'disabled'}
        >
          Start
        </button>

        <button
          class="step-btn pause-step"
          type="button"
          data-action="pause"
          data-step-key="${escapeHtml(stepKey)}"
          ${canPause ? '' : 'disabled'}
        >
          Pause
        </button>

        <button
          class="step-btn stop-step"
          type="button"
          data-action="stop"
          data-step-key="${escapeHtml(stepKey)}"
          ${canStop ? '' : 'disabled'}
        >
          Stop
        </button>

        <button
          class="step-btn complete-step"
          type="button"
          data-action="complete"
          data-step-key="${escapeHtml(stepKey)}"
          ${canComplete ? '' : 'disabled'}
        >
          Complete
        </button>
      </div>
    </div>

    <div class="step-time">${escapeHtml(record.durationDisplay || '00:00:00')}</div>
  `;

  row.querySelectorAll('button[data-action]').forEach(button => {
    button.addEventListener('click', function(event) {
      event.stopPropagation();

      const action = button.getAttribute('data-action');
      const key = button.getAttribute('data-step-key');

      if (action === 'start') {
        startStepByKey(key);
      }

      if (action === 'pause') {
        pauseActiveStep();
      }

      if (action === 'stop') {
        stopActiveStep();
      }

      if (action === 'complete') {
        completeActiveStep();
      }
    });
  });

  return row;
}

function startStepByKey(stepKey) {
  if (['running', 'paused', 'stopped', 'saving'].includes(state.timerStatus)) {
    return;
  }

  const step = findStepByKey(stepKey);
  const record = state.stepRecords[stepKey];

  if (!step || !record || record.status === 'COMPLETED') {
    return;
  }

  state.activeStepKey = stepKey;
  state.timerStatus = 'running';
  state.startedAt = new Date();
  state.stoppedAt = null;
  state.completedAt = null;
  state.activeStartedAt = Date.now();
  state.pausedStartedAt = null;
  state.accumulatedMs = 0;
  state.pausedSeconds = 0;

  record.status = 'RUNNING';
  record.stepStartedAt = formatDateTime(state.startedAt);
  record.stepStoppedAt = '';
  record.stepCompletedAt = '';
  record.durationSeconds = 0;
  record.durationDisplay = '00:00:00';
  record.pausedSeconds = 0;

  clearTimerInterval();
  state.timerInterval = setInterval(updateRunningTimer, 300);

  renderSummary();
  renderSections();
}

function pauseActiveStep() {
  const record = getActiveRecord();

  if (!record || state.timerStatus !== 'running') {
    return;
  }

  const now = Date.now();

  state.accumulatedMs += now - state.activeStartedAt;
  state.activeStartedAt = null;
  state.pausedStartedAt = now;
  state.timerStatus = 'paused';

  record.status = 'PAUSED';
  record.durationSeconds = getElapsedSeconds();
  record.durationDisplay = formatDuration(record.durationSeconds);

  clearTimerInterval();
  renderSummary();
  renderSections();
}

function stopActiveStep() {
  const record = getActiveRecord();

  if (!record || !['running', 'paused'].includes(state.timerStatus)) {
    return;
  }

  const now = Date.now();

  if (state.timerStatus === 'running') {
    state.accumulatedMs += now - state.activeStartedAt;
  }

  if (state.timerStatus === 'paused' && state.pausedStartedAt) {
    state.pausedSeconds += Math.floor((now - state.pausedStartedAt) / 1000);
  }

  state.stoppedAt = new Date();
  state.timerStatus = 'stopped';
  state.activeStartedAt = null;
  state.pausedStartedAt = null;

  record.status = 'STOPPED';
  record.stepStoppedAt = formatDateTime(state.stoppedAt);
  record.durationSeconds = getElapsedSeconds();
  record.durationDisplay = formatDuration(record.durationSeconds);
  record.pausedSeconds = state.pausedSeconds;

  clearTimerInterval();
  renderSummary();
  renderSections();
}

async function completeActiveStep() {
  const step = getActiveStep();
  const record = getActiveRecord();

  if (!step || !record || state.timerStatus !== 'stopped') {
    return;
  }

  state.completedAt = new Date();
  state.timerStatus = 'saving';

  record.status = 'COMPLETED';
  record.stepCompletedAt = formatDateTime(state.completedAt);

  renderSummary();
  renderSections();

  await saveCompletedStep(step, record);

  state.timerStatus = 'idle';
  state.activeStepKey = '';
  state.startedAt = null;
  state.stoppedAt = null;
  state.completedAt = null;
  state.activeStartedAt = null;
  state.pausedStartedAt = null;
  state.accumulatedMs = 0;
  state.pausedSeconds = 0;

  renderSummary();
  renderSections();
}

async function saveCompletedStep(step, record) {
  const sectionTotalSeconds = getSectionTotalSecondsByName(step.sectionName);
  const grandTotalSeconds = getGrandTotalSeconds();

  const payload = {
    sessionId: state.sessionId,
    deviceLabel: '',
    sectionOrder: step.sectionOrder,
    section: step.sectionName,
    stepOrder: step.stepOrder,
    stepName: step.stepName,
    stepStartedAt: record.stepStartedAt,
    stepCompletedAt: record.stepCompletedAt,
    durationSeconds: record.durationSeconds,
    durationDisplay: record.durationDisplay,
    pausedSeconds: record.pausedSeconds,
    status: 'COMPLETED',
    notes: '',
    sectionTotalSeconds,
    sectionTotalDisplay: formatDuration(sectionTotalSeconds),
    grandTotalSeconds,
    grandTotalDisplay: formatDuration(grandTotalSeconds),
    userAgent: navigator.userAgent
  };

  setBusy('Saving');

  try {
    const result = await apiCall('saveStepTime', {
      payload: JSON.stringify(payload)
    });

    if (!result || !result.success) {
      record.status = 'SAVE_FAILED';
      setBusy('Save Failed');
      return;
    }

    setBusy('Ready');

  } catch (error) {
    record.status = 'SAVE_FAILED';
    setBusy('Save Failed');
  }
}

function updateRunningTimer() {
  const record = getActiveRecord();

  if (!record) {
    return;
  }

  const elapsedSeconds = getElapsedSeconds();

  record.durationSeconds = elapsedSeconds;
  record.durationDisplay = formatDuration(elapsedSeconds);

  renderSummary();
  renderSections();
}

function findStepByKey(stepKey) {
  for (const section of state.sections) {
    for (const step of section.steps) {
      if (getStepKey(step) === stepKey) {
        return step;
      }
    }
  }

  return null;
}

function getActiveStep() {
  if (!state.activeStepKey) {
    return null;
  }

  return findStepByKey(state.activeStepKey);
}

function getActiveRecord() {
  if (!state.activeStepKey) {
    return null;
  }

  return state.stepRecords[state.activeStepKey] || null;
}

function getElapsedSeconds() {
  let totalMs = state.accumulatedMs;

  if (state.timerStatus === 'running' && state.activeStartedAt) {
    totalMs += Date.now() - state.activeStartedAt;
  }

  return Math.floor(totalMs / 1000);
}

function clearTimerInterval() {
  if (state.timerInterval) {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
  }
}

function renderSummary() {
  let completed = 0;

  Object.values(state.stepRecords).forEach(record => {
    if (record.status === 'COMPLETED') {
      completed += 1;
    }
  });

  els.completedCount.textContent = completed;
  els.grandTotal.textContent = formatDuration(getGrandTotalSeconds());
}

function getGrandTotalSeconds() {
  return Object.values(state.stepRecords).reduce((sum, record) => {
    if (['COMPLETED', 'RUNNING', 'PAUSED', 'STOPPED'].includes(record.status)) {
      return sum + Number(record.durationSeconds || 0);
    }

    return sum;
  }, 0);
}

function getSectionTotalSeconds(section) {
  return section.steps.reduce((sum, step) => {
    const record = state.stepRecords[getStepKey(step)];

    if (!record) {
      return sum;
    }

    if (['COMPLETED', 'RUNNING', 'PAUSED', 'STOPPED'].includes(record.status)) {
      return sum + Number(record.durationSeconds || 0);
    }

    return sum;
  }, 0);
}

function getSectionTotalSecondsByName(sectionName) {
  const section = state.sections.find(item => item.sectionName === sectionName);
  return section ? getSectionTotalSeconds(section) : 0;
}

function getSectionCompletedCount(section) {
  return section.steps.filter(step => {
    const record = state.stepRecords[getStepKey(step)];
    return record && record.status === 'COMPLETED';
  }).length;
}

function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Number(totalSeconds || 0));

  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  return [
    String(hrs).padStart(2, '0'),
    String(mins).padStart(2, '0'),
    String(secs).padStart(2, '0')
  ].join(':');
}

function formatDateTime(date) {
  if (!date) {
    return '';
  }

  return new Intl.DateTimeFormat('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(date);
}

function setBusy(label) {
  els.connectionStatus.textContent = label || 'Ready';
}

function revealApp() {
  const minSplashTime = 800;

  setTimeout(function() {
    if (els.appShell) {
      els.appShell.classList.remove('app-shell-hidden');
    }

    if (els.splashScreen) {
      els.splashScreen.classList.add('hidden');
    }
  }, minSplashTime);
}

function getSectionKey(section) {
  return `section-${section.sectionOrder}`;
}

function getStepKey(step) {
  return `section-${step.sectionOrder}__step-${step.stepOrder}`;
}

function createSessionId() {
  return 'session-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
}

function apiCall(action, params = {}) {
  return new Promise((resolve, reject) => {
    const callbackName = 'jsonpCallback_' + Date.now() + '_' + Math.random().toString(36).slice(2);

    const query = new URLSearchParams();
    query.set('action', action);
    query.set('callback', callbackName);

    Object.keys(params).forEach(key => {
      query.set(key, params[key]);
    });

    const script = document.createElement('script');

    window[callbackName] = function(response) {
      cleanup();
      resolve(response);
    };

    script.onerror = function() {
      cleanup();
      reject(new Error('Unable to connect to backend API.'));
    };

    script.src = API_URL + '?' + query.toString();

    document.body.appendChild(script);

    function cleanup() {
      delete window[callbackName];

      if (script && script.parentNode) {
        script.parentNode.removeChild(script);
      }
    }
  });
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
