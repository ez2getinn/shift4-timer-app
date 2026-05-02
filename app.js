const API_URL = 'https://script.google.com/macros/s/AKfycbzOChrnwwBw6qQjgxXyZks6aTJOsv_80SmL41EeMoO0J1fDwz-xDqJYpKdR0-ce86hp/exec';

const state = {
  sessionId: createSessionId(),
  appData: {},
  sections: [],
  expandedSections: {},
  activeStepKey: '',
  timerStatus: 'idle',
  startedAt: null,
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
  bindEvents();
  registerServiceWorker();
  updateTimerDisplay(0);
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
    renderSections();
    renderSummary();

    setBusy('Ready');
    setTimerMeta('Select a step below to begin timing.');
    revealApp();

  } catch (error) {
    setBusy('Error');
    setTimerMeta(error.message || 'Unable to load app.');
    revealApp();
  }
}

function cacheElements() {
  els.splashScreen = document.getElementById('splashScreen');
  els.appShell = document.getElementById('appShell');

  els.appTitle = document.getElementById('appTitle');
  els.connectionStatus = document.getElementById('connectionStatus');

  els.deviceLabelInput = document.getElementById('deviceLabelInput');

  els.completedCount = document.getElementById('completedCount');
  els.grandTotal = document.getElementById('grandTotal');

  els.activeStepName = document.getElementById('activeStepName');
  els.timerDisplay = document.getElementById('timerDisplay');
  els.timerMeta = document.getElementById('timerMeta');

  els.startBtn = document.getElementById('startBtn');
  els.pauseBtn = document.getElementById('pauseBtn');
  els.completeBtn = document.getElementById('completeBtn');

  els.notesInput = document.getElementById('notesInput');
  els.sectionsList = document.getElementById('sectionsList');
}

function bindEvents() {
  els.startBtn.addEventListener('click', startActiveStep);
  els.pauseBtn.addEventListener('click', togglePauseResume);
  els.completeBtn.addEventListener('click', completeActiveStep);
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

      if (!state.stepRecords[stepKey]) {
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
          notes: '',
          stepStartedAt: '',
          stepCompletedAt: ''
        };
      }
    });
  });
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
        <span class="section-pill">${formatDuration(sectionTotalSeconds)}</span>
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
  const isActive = state.activeStepKey === stepKey;
  const isCompleted = record.status === 'COMPLETED';

  const row = document.createElement('div');
  row.className = 'step-row';

  if (isActive) row.classList.add('active');
  if (isCompleted) row.classList.add('completed');

  row.innerHTML = `
    <div class="step-check">${isCompleted ? '✓' : ''}</div>
    <div class="step-info">
      <div class="step-name">${escapeHtml(step.stepName)}</div>
      <div class="step-notes">${escapeHtml(step.stepNotes || '')}</div>
    </div>
    <div class="step-time">${escapeHtml(record.durationDisplay || '00:00:00')}</div>
  `;

  row.addEventListener('click', function() {
    selectStep(step);
  });

  return row;
}

function selectStep(step) {
  const stepKey = getStepKey(step);

  if ((state.timerStatus === 'running' || state.timerStatus === 'paused') && state.activeStepKey !== stepKey) {
    setTimerMeta('Pause or complete the current step before selecting another step.');
    return;
  }

  state.activeStepKey = stepKey;

  const record = state.stepRecords[stepKey];

  els.activeStepName.textContent = `${step.sectionName} — ${step.stepName}`;
  els.notesInput.value = record.notes || '';
  updateTimerDisplay(record.durationSeconds || 0);

  if (record.status === 'COMPLETED') {
    setTimerMeta(`Completed: ${record.durationDisplay}`);
    els.startBtn.disabled = true;
    els.pauseBtn.disabled = true;
    els.completeBtn.disabled = true;
  } else {
    setTimerMeta(record.status === 'PAUSED' ? 'Paused.' : 'Ready to start.');
    els.startBtn.disabled = false;
    els.pauseBtn.disabled = true;
    els.completeBtn.disabled = true;
  }

  renderSections();
}

function startActiveStep() {
  const step = getActiveStep();

  if (!step) {
    setTimerMeta('Select a step first.');
    return;
  }

  const record = state.stepRecords[state.activeStepKey];

  if (record.status === 'COMPLETED') {
    setTimerMeta('This step is already completed.');
    return;
  }

  state.timerStatus = 'running';
  state.startedAt = new Date();
  state.completedAt = null;
  state.activeStartedAt = Date.now();
  state.pausedStartedAt = null;
  state.accumulatedMs = 0;
  state.pausedSeconds = 0;

  record.status = 'RUNNING';
  record.stepStartedAt = formatDateTime(state.startedAt);
  record.stepCompletedAt = '';
  record.durationSeconds = 0;
  record.durationDisplay = '00:00:00';
  record.pausedSeconds = 0;
  record.notes = els.notesInput.value.trim();

  els.startBtn.disabled = true;
  els.pauseBtn.disabled = false;
  els.completeBtn.disabled = false;
  els.pauseBtn.textContent = 'Pause';

  setTimerMeta(`Started at ${formatDateTime(state.startedAt)}`);

  clearTimerInterval();
  state.timerInterval = setInterval(updateRunningTimer, 300);
  renderSections();
}

function togglePauseResume() {
  if (state.timerStatus === 'running') {
    pauseActiveStep();
    return;
  }

  if (state.timerStatus === 'paused') {
    resumeActiveStep();
  }
}

function pauseActiveStep() {
  const record = getActiveRecord();

  if (!record) return;

  const now = Date.now();

  state.accumulatedMs += now - state.activeStartedAt;
  state.activeStartedAt = null;
  state.pausedStartedAt = now;
  state.timerStatus = 'paused';

  record.status = 'PAUSED';
  record.durationSeconds = getElapsedSeconds();
  record.durationDisplay = formatDuration(record.durationSeconds);
  record.notes = els.notesInput.value.trim();

  clearTimerInterval();

  els.pauseBtn.textContent = 'Resume';
  setTimerMeta(`Paused at ${record.durationDisplay}`);

  renderSections();
}

function resumeActiveStep() {
  const record = getActiveRecord();

  if (!record) return;

  const now = Date.now();

  if (state.pausedStartedAt) {
    state.pausedSeconds += Math.floor((now - state.pausedStartedAt) / 1000);
  }

  state.timerStatus = 'running';
  state.activeStartedAt = now;
  state.pausedStartedAt = null;

  record.status = 'RUNNING';
  record.pausedSeconds = state.pausedSeconds;

  els.pauseBtn.textContent = 'Pause';
  setTimerMeta('Timer resumed.');

  clearTimerInterval();
  state.timerInterval = setInterval(updateRunningTimer, 300);
  renderSections();
}

async function completeActiveStep() {
  const step = getActiveStep();
  const record = getActiveRecord();

  if (!step || !record) {
    setTimerMeta('Select a step first.');
    return;
  }

  const now = Date.now();

  if (state.timerStatus === 'running') {
    state.accumulatedMs += now - state.activeStartedAt;
  }

  if (state.timerStatus === 'paused' && state.pausedStartedAt) {
    state.pausedSeconds += Math.floor((now - state.pausedStartedAt) / 1000);
  }

  state.timerStatus = 'completed';
  state.completedAt = new Date();

  clearTimerInterval();

  record.status = 'COMPLETED';
  record.stepCompletedAt = formatDateTime(state.completedAt);
  record.durationSeconds = getElapsedSeconds();
  record.durationDisplay = formatDuration(record.durationSeconds);
  record.pausedSeconds = state.pausedSeconds;
  record.notes = els.notesInput.value.trim();

  updateTimerDisplay(record.durationSeconds);

  els.startBtn.disabled = true;
  els.pauseBtn.disabled = true;
  els.completeBtn.disabled = true;
  els.pauseBtn.textContent = 'Pause';

  setTimerMeta(`Completed at ${record.stepCompletedAt}`);

  await saveCompletedStep(step, record);

  state.timerStatus = 'idle';
  state.startedAt = null;
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
    deviceLabel: els.deviceLabelInput.value.trim(),
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
    notes: record.notes,
    sectionTotalSeconds,
    sectionTotalDisplay: formatDuration(sectionTotalSeconds),
    grandTotalSeconds,
    grandTotalDisplay: formatDuration(grandTotalSeconds),
    userAgent: navigator.userAgent
  };

  setBusy('Saving');
  setTimerMeta('Saving completed step...');

  try {
    const result = await apiCall('saveStepTime', {
      payload: JSON.stringify(payload)
    });

    setBusy('Ready');

    if (!result || !result.success) {
      record.status = 'SAVE_FAILED';
      setTimerMeta(result && result.message ? result.message : 'Unable to save step time.');
      return;
    }

    setTimerMeta('Step completed and saved.');

  } catch (error) {
    setBusy('Error');
    record.status = 'SAVE_FAILED';
    setTimerMeta(error.message || 'Unable to save step time.');
  }
}

function updateRunningTimer() {
  const record = getActiveRecord();

  if (!record) return;

  const elapsedSeconds = getElapsedSeconds();

  record.durationSeconds = elapsedSeconds;
  record.durationDisplay = formatDuration(elapsedSeconds);
  record.notes = els.notesInput.value.trim();

  updateTimerDisplay(elapsedSeconds);
  renderSummary();
  renderSections();
}

function getActiveStep() {
  if (!state.activeStepKey) return null;

  for (const section of state.sections) {
    for (const step of section.steps) {
      if (getStepKey(step) === state.activeStepKey) {
        return step;
      }
    }
  }

  return null;
}

function getActiveRecord() {
  if (!state.activeStepKey) return null;
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
    if (record.status === 'COMPLETED' || record.status === 'RUNNING' || record.status === 'PAUSED') {
      return sum + Number(record.durationSeconds || 0);
    }

    return sum;
  }, 0);
}

function getSectionTotalSeconds(section) {
  return section.steps.reduce((sum, step) => {
    const record = state.stepRecords[getStepKey(step)];

    if (!record) return sum;

    if (record.status === 'COMPLETED' || record.status === 'RUNNING' || record.status === 'PAUSED') {
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

function updateTimerDisplay(totalSeconds) {
  els.timerDisplay.textContent = formatDuration(totalSeconds);
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
  if (!date) return '';

  return new Intl.DateTimeFormat('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(date);
}

function setTimerMeta(message) {
  els.timerMeta.textContent = message || '';
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
