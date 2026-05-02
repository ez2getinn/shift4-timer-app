const API_URL = 'https://script.google.com/macros/s/AKfycbzOChrnwwBw6qQjgxXyZks6aTJOsv_80SmL41EeMoO0J1fDwz-xDqJYpKdR0-ce86hp/exec';

const state = {
  sessionId: createSessionId(),
  appData: {},
  sections: [],
  currentStep: null,
  timerStatus: 'idle',
  startTime: null,
  endTime: null,
  activeStartedAt: null,
  accumulatedMs: 0,
  pausedStartedAt: null,
  pausedSeconds: 0,
  timerInterval: null,
  savedSteps: []
};

const els = {};

document.addEventListener('DOMContentLoaded', initApp);

async function initApp() {
  cacheElements();
  bindEvents();
  registerServiceWorker();
  updateTimerDisplay(0);
  setBusy(true, 'Loading');

  try {
    const result = await apiCall('getAppData');

    if (!result || !result.success) {
      throw new Error(result && result.message ? result.message : 'Unable to load app data.');
    }

    state.appData = result.data || {};
    state.sections = state.appData.sections || [];

    applyConfig();
    populateSections();

    setBusy(false, 'Ready');
    setMessage('Select section and step to begin.', 'info');
    revealApp();

  } catch (error) {
    setBusy(false, 'Error');
    setMessage(error.message || 'Unable to load app.', 'error');
    revealApp();
  }
}

function cacheElements() {
  els.splashScreen = document.getElementById('splashScreen');
  els.appShell = document.getElementById('appShell');

  els.appTitle = document.getElementById('appTitle');
  els.connectionStatus = document.getElementById('connectionStatus');

  els.deviceLabelInput = document.getElementById('deviceLabelInput');
  els.sectionSelect = document.getElementById('sectionSelect');
  els.stepSelect = document.getElementById('stepSelect');
  els.stepNote = document.getElementById('stepNote');

  els.activeStepName = document.getElementById('activeStepName');
  els.timerDisplay = document.getElementById('timerDisplay');
  els.timerMeta = document.getElementById('timerMeta');

  els.startBtn = document.getElementById('startBtn');
  els.pauseBtn = document.getElementById('pauseBtn');
  els.finishBtn = document.getElementById('finishBtn');
  els.saveBtn = document.getElementById('saveBtn');

  els.notesInput = document.getElementById('notesInput');
  els.saveMessage = document.getElementById('saveMessage');

  els.completedCount = document.getElementById('completedCount');
  els.grandTotal = document.getElementById('grandTotal');
  els.sectionTotals = document.getElementById('sectionTotals');
  els.savedList = document.getElementById('savedList');
}

function bindEvents() {
  els.sectionSelect.addEventListener('change', handleSectionChange);
  els.stepSelect.addEventListener('change', handleStepChange);

  els.startBtn.addEventListener('click', startTimer);
  els.pauseBtn.addEventListener('click', togglePauseResume);
  els.finishBtn.addEventListener('click', finishTimer);
  els.saveBtn.addEventListener('click', saveCurrentStep);
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

function populateSections() {
  els.sectionSelect.innerHTML = '<option value="">Select section</option>';

  state.sections.forEach(section => {
    const option = document.createElement('option');
    option.value = section.sectionName;
    option.textContent = section.sectionName;
    els.sectionSelect.appendChild(option);
  });

  els.stepSelect.innerHTML = '<option value="">Select section first</option>';
  els.stepSelect.disabled = true;
}

function handleSectionChange() {
  const sectionName = els.sectionSelect.value;
  const section = getSelectedSection();

  resetUnsavedTimer();

  if (!sectionName || !section) {
    els.stepSelect.innerHTML = '<option value="">Select section first</option>';
    els.stepSelect.disabled = true;
    els.stepNote.textContent = 'Select a section and step to begin.';
    els.activeStepName.textContent = 'No step selected';
    return;
  }

  els.stepSelect.disabled = false;
  els.stepSelect.innerHTML = '<option value="">Select step</option>';

  section.steps.forEach(step => {
    const option = document.createElement('option');
    option.value = step.stepName;
    option.textContent = step.stepName;
    els.stepSelect.appendChild(option);
  });

  els.stepNote.textContent = 'Select a step to start timing.';
  els.activeStepName.textContent = 'No step selected';
}

function handleStepChange() {
  resetUnsavedTimer();

  const step = getSelectedStep();

  if (!step) {
    state.currentStep = null;
    els.stepNote.textContent = 'Select a step to start timing.';
    els.activeStepName.textContent = 'No step selected';
    els.startBtn.disabled = true;
    return;
  }

  state.currentStep = step;
  els.stepNote.textContent = step.notes || 'No notes for this step.';
  els.activeStepName.textContent = step.stepName;
  els.startBtn.disabled = false;
  setMessage('Ready to start timer.', 'info');
}

function getSelectedSection() {
  const sectionName = els.sectionSelect.value;
  return state.sections.find(section => section.sectionName === sectionName) || null;
}

function getSelectedStep() {
  const section = getSelectedSection();
  const stepName = els.stepSelect.value;

  if (!section || !stepName) {
    return null;
  }

  return section.steps.find(step => step.stepName === stepName) || null;
}

function startTimer() {
  if (!state.currentStep) {
    setMessage('Please select a section and step first.', 'error');
    return;
  }

  state.timerStatus = 'running';
  state.startTime = new Date();
  state.endTime = null;
  state.activeStartedAt = Date.now();
  state.accumulatedMs = 0;
  state.pausedStartedAt = null;
  state.pausedSeconds = 0;

  els.startBtn.disabled = true;
  els.pauseBtn.disabled = false;
  els.finishBtn.disabled = false;
  els.saveBtn.disabled = true;
  els.sectionSelect.disabled = true;
  els.stepSelect.disabled = true;

  els.timerMeta.textContent = `Started at ${formatDateTime(state.startTime)}`;
  setMessage('Timer running.', 'info');

  state.timerInterval = setInterval(updateRunningTimer, 300);
}

function togglePauseResume() {
  if (state.timerStatus === 'running') {
    pauseTimer();
    return;
  }

  if (state.timerStatus === 'paused') {
    resumeTimer();
  }
}

function pauseTimer() {
  const now = Date.now();

  state.accumulatedMs += now - state.activeStartedAt;
  state.activeStartedAt = null;
  state.pausedStartedAt = now;
  state.timerStatus = 'paused';

  clearTimerInterval();

  els.pauseBtn.textContent = 'Resume';
  els.timerMeta.textContent = `Paused at ${formatDuration(getElapsedSeconds())}`;
  setMessage('Timer paused. Resume or finish when ready.', 'info');
}

function resumeTimer() {
  const now = Date.now();

  if (state.pausedStartedAt) {
    state.pausedSeconds += Math.floor((now - state.pausedStartedAt) / 1000);
  }

  state.timerStatus = 'running';
  state.activeStartedAt = now;
  state.pausedStartedAt = null;

  els.pauseBtn.textContent = 'Pause';
  els.timerMeta.textContent = 'Timer resumed.';
  setMessage('Timer running.', 'info');

  state.timerInterval = setInterval(updateRunningTimer, 300);
}

function finishTimer() {
  const now = Date.now();

  if (state.timerStatus === 'running') {
    state.accumulatedMs += now - state.activeStartedAt;
  }

  if (state.timerStatus === 'paused' && state.pausedStartedAt) {
    state.pausedSeconds += Math.floor((now - state.pausedStartedAt) / 1000);
  }

  state.timerStatus = 'finished';
  state.endTime = new Date();

  state.activeStartedAt = null;
  state.pausedStartedAt = null;

  clearTimerInterval();

  const elapsedSeconds = getElapsedSeconds();
  updateTimerDisplay(elapsedSeconds);

  els.pauseBtn.disabled = true;
  els.finishBtn.disabled = true;
  els.saveBtn.disabled = false;
  els.pauseBtn.textContent = 'Pause';

  els.timerMeta.textContent = `Finished at ${formatDateTime(state.endTime)}`;
  setMessage('Timer finished. Save step time to record it.', 'info');
}

async function saveCurrentStep() {
  if (!state.currentStep || state.timerStatus !== 'finished') {
    setMessage('Please finish the timer before saving.', 'error');
    return;
  }

  const elapsedSeconds = getElapsedSeconds();

  const payload = {
    sessionId: state.sessionId,
    deviceLabel: els.deviceLabelInput.value.trim(),
    section: state.currentStep.sectionName,
    stepName: state.currentStep.stepName,
    startTime: formatDateTime(state.startTime),
    endTime: formatDateTime(state.endTime),
    durationSeconds: elapsedSeconds,
    durationDisplay: formatDuration(elapsedSeconds),
    pausedSeconds: state.pausedSeconds,
    status: 'COMPLETED',
    notes: els.notesInput.value.trim(),
    userAgent: navigator.userAgent
  };

  els.saveBtn.disabled = true;
  setBusy(true, 'Saving');
  setMessage('Saving step time...', 'info');

  try {
    const result = await apiCall('saveStepTime', {
      payload: JSON.stringify(payload)
    });

    setBusy(false, 'Ready');

    if (!result || !result.success) {
      setMessage(result && result.message ? result.message : 'Unable to save step time.', 'error');
      els.saveBtn.disabled = false;
      return;
    }

    state.savedSteps.push(payload);
    renderSummary();
    renderSavedSteps();

    setMessage('Saved successfully to Google Sheet.', 'success');
    prepareNextStep();

  } catch (error) {
    setBusy(false, 'Error');
    setMessage(error.message || 'Unable to save step time.', 'error');
    els.saveBtn.disabled = false;
  }
}

function prepareNextStep() {
  state.timerStatus = 'idle';
  state.startTime = null;
  state.endTime = null;
  state.activeStartedAt = null;
  state.accumulatedMs = 0;
  state.pausedStartedAt = null;
  state.pausedSeconds = 0;

  els.sectionSelect.disabled = false;
  els.stepSelect.disabled = false;
  els.startBtn.disabled = !state.currentStep;
  els.pauseBtn.disabled = true;
  els.finishBtn.disabled = true;
  els.saveBtn.disabled = true;
  els.pauseBtn.textContent = 'Pause';
  els.notesInput.value = '';

  updateTimerDisplay(0);
  els.timerMeta.textContent = 'Ready for next timing.';
}

function resetUnsavedTimer() {
  clearTimerInterval();

  state.timerStatus = 'idle';
  state.startTime = null;
  state.endTime = null;
  state.activeStartedAt = null;
  state.accumulatedMs = 0;
  state.pausedStartedAt = null;
  state.pausedSeconds = 0;

  els.startBtn.disabled = true;
  els.pauseBtn.disabled = true;
  els.finishBtn.disabled = true;
  els.saveBtn.disabled = true;
  els.pauseBtn.textContent = 'Pause';

  updateTimerDisplay(0);
  els.timerMeta.textContent = 'Ready';
}

function updateRunningTimer() {
  updateTimerDisplay(getElapsedSeconds());
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
  const completed = state.savedSteps.length;
  const grandSeconds = state.savedSteps.reduce((sum, item) => {
    return sum + Number(item.durationSeconds || 0);
  }, 0);

  els.completedCount.textContent = completed;
  els.grandTotal.textContent = formatDuration(grandSeconds);

  const totals = {};

  state.savedSteps.forEach(item => {
    if (!totals[item.section]) {
      totals[item.section] = 0;
    }

    totals[item.section] += Number(item.durationSeconds || 0);
  });

  els.sectionTotals.innerHTML = '';

  Object.keys(totals).forEach(section => {
    const row = document.createElement('div');
    row.className = 'section-total-row';

    const name = document.createElement('div');
    name.textContent = section;

    const total = document.createElement('div');
    total.textContent = formatDuration(totals[section]);

    row.appendChild(name);
    row.appendChild(total);
    els.sectionTotals.appendChild(row);
  });
}

function renderSavedSteps() {
  if (!state.savedSteps.length) {
    els.savedList.innerHTML = '<div class="empty-state">No steps saved yet.</div>';
    return;
  }

  els.savedList.innerHTML = '';

  [...state.savedSteps].reverse().forEach(item => {
    const wrapper = document.createElement('div');
    wrapper.className = 'saved-item';

    const top = document.createElement('div');
    top.className = 'saved-item-top';

    const left = document.createElement('div');

    const step = document.createElement('div');
    step.className = 'saved-step';
    step.textContent = item.stepName;

    const section = document.createElement('div');
    section.className = 'saved-section';
    section.textContent = item.section;

    left.appendChild(step);
    left.appendChild(section);

    const duration = document.createElement('div');
    duration.className = 'saved-duration';
    duration.textContent = item.durationDisplay;

    top.appendChild(left);
    top.appendChild(duration);

    wrapper.appendChild(top);

    if (item.notes) {
      const notes = document.createElement('div');
      notes.className = 'saved-notes';
      notes.textContent = item.notes;
      wrapper.appendChild(notes);
    }

    els.savedList.appendChild(wrapper);
  });
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

function setMessage(message, type) {
  els.saveMessage.textContent = message || '';
  els.saveMessage.className = `message ${type || ''}`;
}

function setBusy(isBusy, label) {
  els.connectionStatus.textContent = label || (isBusy ? 'Working' : 'Ready');
}

function revealApp() {
  const minSplashTime = 1000;

  setTimeout(function() {
    if (els.appShell) {
      els.appShell.classList.remove('app-shell-hidden');
    }

    if (els.splashScreen) {
      els.splashScreen.classList.add('hidden');
    }
  }, minSplashTime);
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
