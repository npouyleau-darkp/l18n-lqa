// External data source (generated from lqa-textes-i18n.xlsx via build_data.py).
const LQA_DATA_URL = 'https://raw.githubusercontent.com/npouyleau-darkp/l18n-lqa/master/l18n/lqa-data.json';

let EN_COMMON = {};
let BUG_TYPES = [];
let GLOSSARY_TERMS_EN = [];
let LANG_GRID_ORDER = [];
let LQA_LANGUAGES = {};

const lqaDataReady = fetch(LQA_DATA_URL)
    .then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
    .then(data => {
        EN_COMMON = data.EN_COMMON;
        BUG_TYPES = data.BUG_TYPES;
        GLOSSARY_TERMS_EN = data.GLOSSARY_TERMS_EN;
        LANG_GRID_ORDER = data.LANG_GRID_ORDER;
        LQA_LANGUAGES = data.LQA_LANGUAGES;
    })
    .catch(err => {
        document.body.innerHTML = '<div style="padding:60px;text-align:center;font-family:sans-serif;color:#b91c1c;">Unable to load the assessment content. Please reload the page or contact support.</div>';
        throw err;
    });

// Converts literal "\n" markers (spreadsheet cells) into real line breaks.
function expandLineBreaks(text) {
    return String(text).replace(/\\n/g, "\n");
}

function injectEnCommonTexts() {
    if (EN_COMMON['global.pageTitle']) document.title = EN_COMMON['global.pageTitle'];

    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (Object.prototype.hasOwnProperty.call(EN_COMMON, key)) el.textContent = EN_COMMON[key];
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        if (Object.prototype.hasOwnProperty.call(EN_COMMON, key)) el.setAttribute('placeholder', EN_COMMON[key]);
    });
    document.querySelectorAll('[data-i18n-alt]').forEach(el => {
        const key = el.getAttribute('data-i18n-alt');
        if (Object.prototype.hasOwnProperty.call(EN_COMMON, key)) el.setAttribute('alt', EN_COMMON[key]);
    });

    renderBugTypesList();
    renderReportTemplate();
}

function renderBugTypesList() {
    const el = document.getElementById('bugTypesBody');
    if (!el || !Array.isArray(BUG_TYPES)) return;
    el.textContent = BUG_TYPES.map(entry => `• ${entry.text}`).join('\n');
}

function renderReportTemplate() {
    const el = document.getElementById('reportTemplate');
    if (!el) return;
    el.textContent = expandLineBreaks(EN_COMMON['page2.sidebar.reportTemplate'] || '');
}

function renderLanguageGrid() {
    const container = document.getElementById('langGridContainer');
    if (!container) return;
    container.innerHTML = LANG_GRID_ORDER.map(code => {
        const d = LQA_LANGUAGES[code];
        if (!d) return '';
        return `<div class="language-card" data-lang="${code}" onclick="selectGridLanguage(this)">
                    <span class="language-flag">${d.flag}</span>
                    <div class="language-info"><span class="language-name">${d.nativeName}</span><span class="language-region">${d.region}</span></div>
                </div>`;
    }).join('');
}

function buildGlossaryColumnCode(langCode) {
    return (langCode || '').toUpperCase();
}

// === Section timer config ===
const SECTION_DURATIONS = { A: 30 * 60 * 1000, B: 45 * 60 * 1000, C: 45 * 60 * 1000 };
const PAGE_SECTION = { 2: 'A', 3: 'B', 4: 'C' };
const SECTION_QUESTIONS = { A: [1, 2, 3, 4], B: [5, 6, 7], C: [8, 9] };

// === State ===
let sectionTimerInterval = null;
let isTestActive = false;
let uniqueTabWindowId = sessionStorage.getItem('lqa_tab_window_id') || Math.random().toString(36).substring(2, 15);
sessionStorage.setItem('lqa_tab_window_id', uniqueTabWindowId);

let lqaBroadcastChannel = new BroadcastChannel('lqa_session_channel');
let sessionKeepAliveInterval;
let pendingModalAction = null;
let activeEditQuestion = null;
let stringIdsVisible = false;

// flood-guard: track previous lengths to detect large sudden insertions
let previousTextLengthsStore = {};

function selectGridLanguage(cardElement) {
    if (!cardElement) return;
    document.querySelectorAll('.language-card').forEach(card => card.classList.remove('active'));
    cardElement.classList.add('active');
    const chosenLangCode = cardElement.getAttribute('data-lang');
    const hiddenInput = document.getElementById('candidateLanguage');
    if (hiddenInput) hiddenInput.value = chosenLangCode;
}

function toggleDarkMode() {
    const body = document.body;
    const btn = document.getElementById('themeToggle');
    body.classList.toggle('dark-mode');
    const mode = body.classList.contains('dark-mode') ? 'dark' : 'light';
    if (btn) btn.innerHTML = mode === 'dark' ? EN_COMMON['buttons.lightMode'] : EN_COMMON['buttons.darkMode'];
    localStorage.setItem('lqa_theme', mode);
}

// === Page navigation ===
function changePageView(targetPageId) {
    document.querySelectorAll('.page-view').forEach(view => view.classList.remove('active'));
    document.getElementById(`page${targetPageId}`).classList.add('active');
    window.scrollTo(0, 0);

    if (targetPageId >= 2 && targetPageId <= 4) {
        localStorage.setItem('lqa_active_page', targetPageId);
        const section = PAGE_SECTION[targetPageId];
        if (section && isTestActive) startSectionTimer(section);
        refreshQuestionLockStates();
    }
}

// === Section timers ===
function startSectionTimer(section) {
    if (sectionTimerInterval) clearInterval(sectionTimerInterval);

    const storageKey = `lqa_section_end_${section}`;
    let endTime = parseInt(localStorage.getItem(storageKey), 10);
    if (!endTime || isNaN(endTime)) {
        endTime = Date.now() + SECTION_DURATIONS[section];
        localStorage.setItem(storageKey, endTime);
        if (!localStorage.getItem(`lqa_section_start_${section}`)) {
            localStorage.setItem(`lqa_section_start_${section}`, Date.now());
        }
    }

    const display = document.getElementById('timerDisplay');
    display.style.display = 'block';

    const tick = () => {
        const remaining = endTime - Date.now();
        if (remaining <= 0) {
            clearInterval(sectionTimerInterval);
            handleSectionExpiry(section);
            return;
        }
        const mins = Math.floor(remaining / 60000);
        const secs = Math.floor((remaining % 60000) / 1000);
        display.textContent = `Section ${section} — ${mins}:${secs < 10 ? '0' + secs : secs}`;
    };
    tick();
    sectionTimerInterval = setInterval(tick, 1000);
}

function handleSectionExpiry(section) {
    document.getElementById('confirmationModal').classList.remove('show');

    if (activeEditQuestion) {
        finishEditSession(activeEditQuestion);
        setQState(activeEditQuestion, 'done');
        const ta = document.getElementById(activeEditQuestion);
        if (ta) ta.disabled = true;
        activeEditQuestion = null;
        localStorage.removeItem('lqa_active_edit_q');
    }

    recordSectionElapsed(section);
    alert(EN_COMMON['timer.sectionExpiredAlert']
        ? EN_COMMON['timer.sectionExpiredAlert'].replace('{s}', section)
        : `Section ${section} time has expired. Moving to the next section.`);

    const nextPage = { A: 3, B: 4, C: 5 }[section];
    if (nextPage === 5) {
        if (sessionKeepAliveInterval) clearInterval(sessionKeepAliveInterval);
        lqaBroadcastChannel.close();
        displaySummaryDashboard(true);
    } else {
        changePageView(nextPage);
    }
}

function recordSectionElapsed(section) {
    const startKey = `lqa_section_start_${section}`;
    const elapsedKey = `lqa_section_elapsed_${section}`;
    if (localStorage.getItem(elapsedKey)) return; // already recorded
    const start = parseInt(localStorage.getItem(startKey), 10);
    if (start) {
        const elapsed = Math.round((Date.now() - start) / 60000);
        localStorage.setItem(elapsedKey, elapsed);
    }
}

// === Modal / submission ===
function openConfirmationModal() {
    const missingQuestions = [];
    for (let i = 1; i <= 9; i++) {
        const field = document.getElementById(`q${i}`);
        if (!field || !field.value.trim()) missingQuestions.push(`Q${i}`);
    }

    const textField = document.getElementById('modalConfirmationText');
    if (missingQuestions.length > 0) {
        textField.innerHTML = `<span class="modal-warning-highlight">${EN_COMMON['modal.warningPrefix']}</span>\n\n${EN_COMMON['modal.warningBody']}<span class="modal-warning-highlight">${missingQuestions.join(', ')}</span>.\n\n${EN_COMMON['modal.warningConfirm']}`;
    } else {
        textField.innerHTML = EN_COMMON['modal.defaultText'];
    }

    pendingModalAction = 'fullSubmit';
    document.getElementById('confirmationModal').classList.add('show');
}

function submitSection(fromPage) {
    const section = PAGE_SECTION[fromPage];
    const questions = SECTION_QUESTIONS[section] || [];
    const missing = questions.filter(i => {
        const f = document.getElementById(`q${i}`);
        return !f || !f.value.trim();
    });

    const textField = document.getElementById('modalConfirmationText');
    if (missing.length > 0) {
        textField.innerHTML = `<span class="modal-warning-highlight">${EN_COMMON['modal.warningPrefix']}</span>\n\n${EN_COMMON['modal.warningBody']}<span class="modal-warning-highlight">${missing.map(i => 'Q' + i).join(', ')}</span>.\n\n${EN_COMMON['modal.warningConfirm']}`;
    } else {
        textField.innerHTML = EN_COMMON['modal.defaultText'];
    }

    pendingModalAction = { type: 'sectionAdvance', fromPage };
    document.getElementById('confirmationModal').classList.add('show');
}

function confirmSubmission(isConfirmed) {
    document.getElementById('confirmationModal').classList.remove('show');
    if (!isConfirmed) { pendingModalAction = null; return; }

    if (pendingModalAction === 'fullSubmit') {
        clearInterval(sectionTimerInterval);
        if (sessionKeepAliveInterval) clearInterval(sessionKeepAliveInterval);
        lqaBroadcastChannel.close();
        recordSectionElapsed('C');
        if (activeEditQuestion) finishEditSession(activeEditQuestion);
        displaySummaryDashboard(false);
    } else if (pendingModalAction && pendingModalAction.type === 'sectionAdvance') {
        const section = PAGE_SECTION[pendingModalAction.fromPage];
        recordSectionElapsed(section);
        if (activeEditQuestion) {
            finishEditSession(activeEditQuestion);
            setQState(activeEditQuestion, 'done');
            const ta = document.getElementById(activeEditQuestion);
            if (ta) ta.disabled = true;
            activeEditQuestion = null;
            localStorage.removeItem('lqa_active_edit_q');
        }
        changePageView(pendingModalAction.fromPage + 1);
    }
    pendingModalAction = null;
}

// === Question Start / Edit / Finish ===
function getQState(qid) {
    return localStorage.getItem(`lqa_q_state_${qid}`) || 'idle';
}

function setQState(qid, state) {
    localStorage.setItem(`lqa_q_state_${qid}`, state);
}

function startEditQuestion(qid) {
    if (activeEditQuestion && activeEditQuestion !== qid) return;
    const state = getQState(qid);
    if (state === 'editing') return;

    activeEditQuestion = qid;
    localStorage.setItem('lqa_active_edit_q', qid);
    setQState(qid, 'editing');
    localStorage.setItem(`lqa_edit_session_start_${qid}`, Date.now());

    const ta = document.getElementById(qid);
    if (ta) {
        ta.disabled = false;
        previousTextLengthsStore[qid] = ta.value.length;
        autoGrowTextarea(ta);
        ta.focus();
    }

    refreshQuestionLockStates();
}

function finishEditQuestion(qid) {
    if (getQState(qid) !== 'editing') return;
    finishEditSession(qid);
    setQState(qid, 'done');
    activeEditQuestion = null;
    localStorage.removeItem('lqa_active_edit_q');

    const ta = document.getElementById(qid);
    if (ta) ta.disabled = true;

    refreshQuestionLockStates();
}

// Accumulates elapsed edit time for qid without changing its state.
function finishEditSession(qid) {
    const sessionStart = parseInt(localStorage.getItem(`lqa_edit_session_start_${qid}`), 10);
    if (sessionStart) {
        const elapsed = Date.now() - sessionStart;
        const prev = parseInt(localStorage.getItem(`lqa_edit_time_${qid}`), 10) || 0;
        localStorage.setItem(`lqa_edit_time_${qid}`, prev + elapsed);
        localStorage.removeItem(`lqa_edit_session_start_${qid}`);
    }
}

function refreshQuestionLockStates() {
    for (let i = 1; i <= 9; i++) {
        const qid = `q${i}`;
        const state = getQState(qid);
        const startBtn = document.getElementById(`btn_start_${qid}`);
        const finishBtn = document.getElementById(`btn_finish_${qid}`);
        const ta = document.getElementById(qid);
        if (!startBtn || !finishBtn || !ta) continue;

        const otherActive = activeEditQuestion && activeEditQuestion !== qid;

        if (state === 'editing') {
            ta.disabled = false;
            startBtn.textContent = 'Start';
            startBtn.disabled = true;
            finishBtn.disabled = false;
        } else if (state === 'done') {
            ta.disabled = true;
            startBtn.textContent = 'Edit';
            startBtn.disabled = !!otherActive;
            finishBtn.disabled = true;
        } else {
            ta.disabled = true;
            startBtn.textContent = 'Start';
            startBtn.disabled = !!otherActive;
            finishBtn.disabled = true;
        }
    }
}

// === Auto-grow textarea ===
function autoGrowTextarea(ta) {
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 500) + 'px';
}

// === Word count ===
function getWordCount(textValue, langCode) {
    const cleanText = textValue.trim();
    if (cleanText === "") return 0;
    const fallbackLang = langCode || localStorage.getItem('lqa_candidate_lang') || "en-US";

    // Chinese & Japanese: Intl.Segmenter for real word-like segmentation.
    if (/^zh/i.test(fallbackLang)) {
        const strippedText = cleanText.replace(/\[.*?\]/g, "");
        if (typeof Intl.Segmenter === "function") {
            const segmenter = new Intl.Segmenter('zh', { granularity: 'word' });
            return Array.from(segmenter.segment(strippedText)).filter(s => s.isWordLike).length;
        }
        return Math.ceil(strippedText.length / 1.6);
    }

    if (/^ja/i.test(fallbackLang)) {
        const strippedText = cleanText.replace(/\[.*?\]/g, "");
        if (typeof Intl.Segmenter === "function") {
            const segmenter = new Intl.Segmenter('ja', { granularity: 'word' });
            return Array.from(segmenter.segment(strippedText)).filter(s => s.isWordLike).length;
        }
        return Math.ceil(strippedText.length / 1.6);
    }

    // Korean: space-based heuristic with ×1.2 factor for eojeol bundling.
    if (/^ko/i.test(fallbackLang)) {
        const spaceSplitCount = cleanText.split(/\s+/).length;
        return Math.ceil(spaceSplitCount * 1.2);
    }

    if (/^th/i.test(fallbackLang) && typeof Intl.Segmenter === "function") {
        const segmenter = new Intl.Segmenter('th', { granularity: 'word' });
        const segments = segmenter.segment(cleanText);
        return Array.from(segments).filter(s => s.isWordLike).length;
    }

    return cleanText.split(/\s+/).length;
}

function refreshWordCounterMetric(elementId) {
    const textarea = document.getElementById(elementId);
    const badge = document.getElementById(`counter_${elementId}`);
    if (textarea && badge) {
        const activeLang = localStorage.getItem('lqa_candidate_lang') || "en-US";
        badge.innerHTML = `${EN_COMMON['common.wordCountBadge']}${getWordCount(textarea.value, activeLang)}`;
    }
}

// === Test start ===
async function startTestTimer(isRestoring) {
    const first = document.getElementById('firstName').value.trim();
    const last = document.getElementById('lastName').value.trim();
    const email = document.getElementById('candidateEmail').value.trim();
    const lang = document.getElementById('candidateLanguage').value;

    if (!isRestoring) {
        if (!first || !last || !email || !lang) {
            alert(EN_COMMON['page1.alert.missingFields']);
            return;
        }

        localStorage.setItem('lqa_candidate_first', first);
        localStorage.setItem('lqa_candidate_last', last);
        localStorage.setItem('lqa_candidate_email', email);
        localStorage.setItem('lqa_candidate_lang', lang);
    }

    if (typeof triggerDynamicLocalContentHydration === "function") {
        triggerDynamicLocalContentHydration(lang || localStorage.getItem('lqa_candidate_lang'));
    }

    document.getElementById('firstName').disabled = true;
    document.getElementById('lastName').disabled = true;
    document.getElementById('candidateEmail').disabled = true;

    isTestActive = true;
    engageInterTabCommunicationBroadcast();
    changePageView(2); // triggers startSectionTimer('A')
}

function triggerCandidatePdfDownload() {
    window.print();
}

function clearSubmissionErrorBanner() {
    const existing = document.getElementById('submissionErrorBanner');
    if (existing) existing.remove();
}

function downloadAnswersLocally(snapshot) {
    const secLines = `Section A: ${snapshot.secAMin} min | Section B: ${snapshot.secBMin} min | Section C: ${snapshot.secCMin} min`;
    const blobContent = `Candidate: ${snapshot.last} ${snapshot.first}\nEmail: ${snapshot.email}\nLanguage: ${snapshot.lang}\n${secLines}\n\n${snapshot.teamsBodyText}`;
    const blob = new Blob([blobContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `lqa-responses-${(snapshot.last || 'candidate').replace(/\s+/g, '_')}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

function showSubmissionErrorBanner(snapshot, retryFn) {
    clearSubmissionErrorBanner();

    const banner = document.createElement('div');
    banner.id = 'submissionErrorBanner';
    banner.style.cssText = 'background:#fef2f2;border:2px solid #fca5a5;border-radius:10px;padding:20px;margin-bottom:30px;color:#7f1d1d;';

    const message = document.createElement('p');
    message.style.cssText = 'margin:0 0 15px 0;font-weight:700;';
    message.textContent = EN_COMMON['submission.error.message'];
    banner.appendChild(message);

    const retryBtn = document.createElement('button');
    retryBtn.type = 'button';
    retryBtn.textContent = EN_COMMON['submission.error.retryButton'];
    retryBtn.className = 'btn-nav';
    retryBtn.style.marginRight = '10px';
    retryBtn.addEventListener('click', retryFn);
    banner.appendChild(retryBtn);

    const downloadBtn = document.createElement('button');
    downloadBtn.type = 'button';
    downloadBtn.textContent = EN_COMMON['submission.error.downloadButton'];
    downloadBtn.className = 'btn-download';
    downloadBtn.style.marginTop = '0';
    downloadBtn.addEventListener('click', () => downloadAnswersLocally(snapshot));
    banner.appendChild(downloadBtn);

    const summaryHeader = document.querySelector('#page5 .summary-header');
    if (summaryHeader) summaryHeader.insertAdjacentElement('afterend', banner);
}

// Static client-side token: NOT real security (readable from page source), filters only casual POSTs.
function postResultsPayload(payload) {
    return fetch('https://votre-serveur.com', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-LQA-Client-Token': 'lqa-static-client-token-2026'
        },
        body: JSON.stringify(payload)
    }).then(response => {
        if (!response.ok) throw new Error(`Server responded with HTTP ${response.status}`);
        return response;
    });
}

function buildTeamsBodyText(isTriggeredByTimeout, lang) {
    const email = localStorage.getItem('lqa_candidate_email') || '';
    const secAMin = localStorage.getItem('lqa_section_elapsed_A') || '?';
    const secBMin = localStorage.getItem('lqa_section_elapsed_B') || '?';
    const secCMin = localStorage.getItem('lqa_section_elapsed_C') || '?';

    let text = `**${EN_COMMON['payload.emailLabel']}** ${email}\n\n`;
    text += `**Section A:** ${secAMin} min  |  **Section B:** ${secBMin} min  |  **Section C:** ${secCMin} min\n\n`;

    if (isTriggeredByTimeout) {
        text += `⚠️ **${EN_COMMON['payload.timeoutWarning']}** ⚠️\n\n`;
    }

    for (let i = 1; i <= 9; i++) {
        const labelNode = document.getElementById(`lbl_q${i}`);
        let origLabel = 'Question ' + i;
        if (labelNode) {
            const clone = labelNode.cloneNode(true);
            const embeddedSpan = clone.querySelector('.print-strip');
            origLabel = embeddedSpan ? embeddedSpan.innerText : clone.innerText;
        }

        const field = document.getElementById(`q${i}`);
        const targetVal = field ? field.value.trim() : EN_COMMON['payload.noResponseFallback'];
        const editMs = parseInt(localStorage.getItem(`lqa_edit_time_q${i}`), 10) || 0;
        const editMin = Math.round(editMs / 60000);

        text += `**${origLabel}** *(edit: ${editMin} min)*\n${targetVal || EN_COMMON['payload.noResponseFallback']}\n`;
        if (i === 8 || i === 9) {
            text += `*(${EN_COMMON['payload.wordCountSuffix'].replace('{n}', getWordCount(targetVal, lang))})*\n`;
        }
        text += '\n';
    }

    return text;
}

function displaySummaryDashboard(isTriggeredByTimeout) {
    isTestActive = false;
    clearInterval(sectionTimerInterval);
    document.getElementById('timerDisplay').style.display = 'none';
    document.getElementById('assessmentForm').style.display = 'none';
    clearSubmissionErrorBanner();

    const first = localStorage.getItem('lqa_candidate_first') || 'Candidate';
    const last = localStorage.getItem('lqa_candidate_last') || 'User';
    const email = localStorage.getItem('lqa_candidate_email') || 'unknown@session.com';
    const lang = localStorage.getItem('lqa_candidate_lang') || 'Unknown';
    const secAMin = localStorage.getItem('lqa_section_elapsed_A') || '?';
    const secBMin = localStorage.getItem('lqa_section_elapsed_B') || '?';
    const secCMin = localStorage.getItem('lqa_section_elapsed_C') || '?';

    document.getElementById('summaryMetaLanguageBox').innerHTML = `${EN_COMMON['page5.languageMetaPrefix']}${lang}`;
    const contentContainer = document.getElementById('summaryContent');
    contentContainer.innerHTML = '';

    const teamsBodyText = buildTeamsBodyText(isTriggeredByTimeout, lang);

    for (let i = 1; i <= 9; i++) {
        const field = document.getElementById(`q${i}`);
        const targetVal = field ? field.value.trim() : EN_COMMON['payload.noResponseFallback'];

        const elementBlock = document.createElement('div');
        elementBlock.className = 'summary-item';

        const qLine = document.createElement('div');
        qLine.className = 'summary-q';
        qLine.textContent = `${EN_COMMON['page5.responseLabelPrefix']}${i}`;

        const aLine = document.createElement('div');
        aLine.className = 'summary-a';
        aLine.textContent = targetVal || EN_COMMON['payload.noResponseFallback'];

        elementBlock.appendChild(qLine);
        elementBlock.appendChild(aLine);
        contentContainer.appendChild(elementBlock);
    }

    const answersSnapshot = { first, last, email, lang, secAMin, secBMin, secCMin, teamsBodyText };
    const submissionPayload = {
        title: `${last} ${first} - ${EN_COMMON['page5.languageMetaPrefix']}${lang}`,
        text: teamsBodyText
    };

    const attemptSubmission = () => {
        clearSubmissionErrorBanner();
        postResultsPayload(submissionPayload)
            .then(() => {
                const cachedTheme = localStorage.getItem('lqa_theme');
                localStorage.clear();
                if (cachedTheme) localStorage.setItem('lqa_theme', cachedTheme);
            })
            .catch(error => {
                console.error("Results submission failed, candidate data preserved:", error);
                showSubmissionErrorBanner(answersSnapshot, attemptSubmission);
            });
    };

    attemptSubmission();
    changePageView(5);
}

// === QA: Display string IDs toggle ===
function toggleStringIds() {
    stringIdsVisible = !stringIdsVisible;
    const btn = document.getElementById('stringIdsToggle');

    if (stringIdsVisible) {
        document.querySelectorAll('[data-i18n]').forEach(el => {
            el.textContent = el.getAttribute('data-i18n');
        });
        document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
            el.setAttribute('placeholder', el.getAttribute('data-i18n-placeholder'));
        });
        if (btn) btn.style.background = '#dc2626';
    } else {
        injectEnCommonTexts();
        const lang = localStorage.getItem('lqa_candidate_lang');
        if (lang && LQA_LANGUAGES[lang]) triggerDynamicLocalContentHydration(lang);
        if (btn) btn.style.background = '#0369a1';
    }
}

// === QA: Simulate recruiter payload ===
function simulateRecruiterPayload() {
    const first = localStorage.getItem('lqa_candidate_first') || '';
    const last = localStorage.getItem('lqa_candidate_last') || '';
    const lang = localStorage.getItem('lqa_candidate_lang') || '';

    // Use '(pending)' for sections not yet submitted
    const originalA = localStorage.getItem('lqa_section_elapsed_A');
    const originalB = localStorage.getItem('lqa_section_elapsed_B');
    const originalC = localStorage.getItem('lqa_section_elapsed_C');
    if (!originalA) localStorage.setItem('lqa_section_elapsed_A', '(pending)');
    if (!originalB) localStorage.setItem('lqa_section_elapsed_B', '(pending)');
    if (!originalC) localStorage.setItem('lqa_section_elapsed_C', '(pending)');

    const text = buildTeamsBodyText(false, lang);

    if (!originalA) localStorage.removeItem('lqa_section_elapsed_A');
    if (!originalB) localStorage.removeItem('lqa_section_elapsed_B');
    if (!originalC) localStorage.removeItem('lqa_section_elapsed_C');

    const title = `${last} ${first} - ${EN_COMMON['page5.languageMetaPrefix'] || 'Language: '}${lang}`;
    document.getElementById('payloadPreviewContent').textContent = `TITLE: ${title}\n\nBODY:\n${text}`;
    document.getElementById('payloadPreviewModal').classList.add('show');
}

function triggerDynamicLocalContentHydration(langCode) {
    const targetCode = langCode || LANG_GRID_ORDER[0];
    localStorage.setItem('lqa_candidate_lang', targetCode);

    const dataPack = LQA_LANGUAGES[targetCode];
    if (!dataPack) return;

    const personalizedTitle = `LQA ${dataPack.demonym} Tester Assessment`;
    const headingEl = document.getElementById('mainHeadingTitle');
    if (headingEl) headingEl.textContent = personalizedTitle;
    document.title = personalizedTitle;

    const targetHeader = document.getElementById('glossaryTargetHeader');
    if (targetHeader) targetHeader.textContent = buildGlossaryColumnCode(targetCode);

    const glossaryBody = document.getElementById('glossaryBodyContainer');
    if (glossaryBody && Array.isArray(dataPack.glossary)) {
        glossaryBody.innerHTML = "";
        dataPack.glossary.forEach(entry => {
            const row = document.createElement('tr');
            row.dataset.entryId = entry.id;
            const enCell = document.createElement('td');
            enCell.textContent = entry.en;
            const targetCell = document.createElement('td');
            targetCell.textContent = entry.target;
            row.appendChild(enCell);
            row.appendChild(targetCell);
            glossaryBody.appendChild(row);
        });
    }

    ['q5', 'q6', 'q7'].forEach(qid => {
        const leftEl = document.getElementById(`sheet_${qid}_left`);
        const rightEl = document.getElementById(`sheet_${qid}_right`);
        if (leftEl && dataPack.referenceEN && dataPack.referenceEN[qid]) leftEl.textContent = dataPack.referenceEN[qid];
        if (rightEl && dataPack.target && dataPack.target[qid]) rightEl.textContent = dataPack.target[qid];
    });

    const lbl9 = document.getElementById('lbl_q9');
    if (lbl9 && dataPack.q9) {
        const isCharacterDensityLang = /^(zh|ja|ko|th)/i.test(targetCode);
        const suffix = isCharacterDensityLang
            ? EN_COMMON['page4.q9.cjkSuffix']
            : (dataPack.volumeLabel || EN_COMMON['page4.q9.cjkSuffix']);
        lbl9.innerHTML = `9. <span class="print-strip">${dataPack.q9}</span> (${suffix})`;
    }

    applyRtlSupport(targetCode);
}

// Applies right-to-left text direction for Arabic (ar-AA).
function applyRtlSupport(langCode) {
    const isRtl = /^ar/i.test(langCode || "");
    const dirValue = isRtl ? "rtl" : "ltr";

    const glossaryTable = document.querySelector('.glossary-table');
    if (glossaryTable) glossaryTable.setAttribute('dir', dirValue);

    document.querySelectorAll('.side-window').forEach(panel => panel.setAttribute('dir', dirValue));

    ['sheet_q5_right', 'sheet_q6_right', 'sheet_q7_right'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.setAttribute('dir', dirValue);
    });

    ['q5', 'q6', 'q7', 'q9'].forEach(id => {
        const field = document.getElementById(id);
        if (field) field.setAttribute('dir', isRtl ? 'rtl' : 'auto');
    });
}

// === Inter-tab communication ===
function engageInterTabCommunicationBroadcast() {
    sessionKeepAliveInterval = setInterval(() => {
        if (isTestActive) {
            lqaBroadcastChannel.postMessage({
                type: 'LQA_HEARTBEAT',
                tabId: uniqueTabWindowId,
                email: localStorage.getItem('lqa_candidate_email')
            });
        }
    }, 1000);
}

lqaBroadcastChannel.onmessage = (event) => {
    const activeEmail = localStorage.getItem('lqa_candidate_email');
    if (isTestActive && activeEmail && event.data.email === activeEmail && event.data.tabId !== uniqueTabWindowId) {
        triggerSecurityHardlockWipe(EN_COMMON['security.duplicateTitle'], EN_COMMON['security.duplicateReason']);
    }
};

function triggerSecurityHardlockWipe(titleText, reasonText) {
    isTestActive = false;
    clearInterval(sectionTimerInterval);
    if (sessionKeepAliveInterval) clearInterval(sessionKeepAliveInterval);
    document.getElementById('mainApplicationWrapper').style.display = 'none';
    document.getElementById('securityHardlockTitle').innerText = titleText;
    document.getElementById('securityHardlockReason').innerText = reasonText;
    document.getElementById('securityHardlockScreen').style.display = 'flex';
}

function resetQASession() {
    if (confirm(EN_COMMON['qaReset.confirmPrompt'])) {
        clearInterval(sectionTimerInterval);
        if (sessionKeepAliveInterval) clearInterval(sessionKeepAliveInterval);
        localStorage.clear();
        sessionStorage.clear();
        window.location.reload();
    }
}

// === Screen-shield anti-screenshot/anti-blur ===
const shield = document.getElementById('greyShield');

const triggerProtection = () => {
    if (isTestActive) {
        shield.classList.add('active');
        document.body.classList.add('shield-activated');
    }
};
const removeProtection = () => {
    shield.classList.remove('active');
    document.body.classList.remove('shield-activated');
};

document.addEventListener('mouseleave', triggerProtection);
document.addEventListener('mouseenter', removeProtection);
window.addEventListener('blur', triggerProtection);
window.addEventListener('focus', removeProtection);

document.addEventListener('keyup', (event) => {
    if (event.key === 'PrintScreen' || event.key === 'Snapshot') {
        triggerProtection();
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(EN_COMMON['security.screenshotClipboardMsg']);
        }
        alert(EN_COMMON['security.printRestrictedAlert']);
    }
});

// Anti-cheat interceptors, feedback submission, lightbox runtime.
//
// SECURITY NOTE: everything here runs in the candidate's browser and can be
// overridden via DevTools. See original comments for full threat model context.

function submitAnonymousFeedbackForm() {
    const selectedOptions = [];
    const checkboxes = document.querySelectorAll('input[name="fb_opt"]:checked');
    checkboxes.forEach(cb => selectedOptions.push(EN_COMMON[cb.value] || cb.value));

    const feedbackNotes = document.getElementById('feedbackText').value.trim();
    if (selectedOptions.length === 0 && !feedbackNotes) {
        alert(EN_COMMON['page5.feedback.alert.noSelection']);
        return;
    }

    const submitBtn = document.getElementById('feedbackSubmitBtn');
    submitBtn.disabled = true;

    let feedbackBodyString = `**${EN_COMMON['payload.feedback.categoriesLabel']}** ${selectedOptions.length > 0 ? selectedOptions.join(', ') : EN_COMMON['payload.feedback.noneSelected']}\n\n`;
    feedbackBodyString += `**${EN_COMMON['payload.feedback.commentsLabel']}**\n${feedbackNotes || EN_COMMON['payload.feedback.noComments']}`;

    fetch('https://votre-deuxieme-serveur-teams.com', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-LQA-Client-Token': 'lqa-static-client-token-2026'
        },
        body: JSON.stringify({
            title: EN_COMMON['payload.feedbackTitle'],
            text: feedbackBodyString
        })
    }).then(response => {
        if (!response.ok) throw new Error(`Server responded with HTTP ${response.status}`);
        document.getElementById('feedbackFormBlock').style.display = 'none';
        document.getElementById('feedbackSuccessMessage').style.display = 'block';
    }).catch(err => {
        console.error("Anonymized survey tracking routing exception handled gracefully:", err);
        submitBtn.disabled = false;
        alert(EN_COMMON['page5.feedback.alert.sendError']);
    });
}

// 1. Clipboard restrictions
document.addEventListener('copy', (e) => { e.preventDefault(); e.clipboardData.setData('text/plain', EN_COMMON['security.copyRestrictedMsg']); });
document.addEventListener('cut', (e) => { e.preventDefault(); e.clipboardData.setData('text/plain', EN_COMMON['security.copyRestrictedMsg']); });
document.addEventListener('paste', (e) => {
    e.preventDefault();
    const activeElement = document.activeElement;
    if (activeElement && (activeElement.tagName === 'TEXTAREA' || activeElement.tagName === 'INPUT')) {
        const start = activeElement.selectionStart;
        activeElement.value = activeElement.value.substring(0, start) + EN_COMMON['security.pasteRestrictedMsg'] + activeElement.value.substring(activeElement.selectionEnd);
    }
});

// 2. Paste/rapid-input flood guard
document.addEventListener('input', (e) => {
    if (!isTestActive) return;

    const targetField = e.target;
    if (targetField.tagName === 'TEXTAREA' || targetField.tagName === 'INPUT') {
        const currentFieldId = targetField.id;
        const currentStringValue = targetField.value;
        const absolutePreviousLength = previousTextLengthsStore[currentFieldId] || 0;
        const lengthDelta = currentStringValue.length - absolutePreviousLength;

        if (e.inputType === 'insertFromPaste' || lengthDelta > 4) {
            e.preventDefault();
            targetField.value = EN_COMMON['security.pasteRestrictedMsg'];
            previousTextLengthsStore[currentFieldId] = targetField.value.length;
            if (currentFieldId === 'q8' || currentFieldId === 'q9') refreshWordCounterMetric(currentFieldId);
            return;
        }

        previousTextLengthsStore[currentFieldId] = currentStringValue.length;
        if (targetField.tagName === 'TEXTAREA') {
            localStorage.setItem(`lqa_ans_${currentFieldId}`, currentStringValue);
            if (currentFieldId === 'q8' || currentFieldId === 'q9') refreshWordCounterMetric(currentFieldId);
            autoGrowTextarea(targetField);
        }
    }
});

// 3. Collapse text selection (prevents multi-select copy workaround)
document.addEventListener('selectionchange', () => {
    if (!isTestActive) return;
    const activeNode = document.activeElement;
    if (activeNode && (activeNode.tagName === 'TEXTAREA' || activeNode.tagName === 'INPUT')) {
        if (activeNode.selectionStart !== activeNode.selectionEnd) {
            activeNode.selectionEnd = activeNode.selectionStart;
        }
    }
});

// 4. Blocks right-click, middle-click, F12 and common DevTools/print/save shortcuts
document.addEventListener('contextmenu', (event) => event.preventDefault());
document.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });
document.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();
    if (e.key === 'F12' || (e.ctrlKey && e.shiftKey && ['i', 'j', 'c'].includes(key)) || (e.ctrlKey && ['u', 'p', 's'].includes(key))) e.preventDefault();
});

function openFullscreenLightbox(imageSourcePath) {
    const portal = document.getElementById('globalLightboxPortal');
    const imgTarget = document.getElementById('lightboxFullscreenImage');
    if (portal && imgTarget) {
        imgTarget.src = imageSourcePath;
        portal.classList.add('active');
    }
}

function closeFullscreenLightbox() {
    const portal = document.getElementById('globalLightboxPortal');
    const imgTarget = document.getElementById('lightboxFullscreenImage');
    if (portal) {
        portal.classList.remove('active');
        if (imgTarget) imgTarget.src = "";
    }
}

window.addEventListener('load', () => {
    lqaDataReady.then(() => {
        // 1. Hardware detection: block mobile/tablet (3-signal majority vote)
        const uaLooksMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        const viewportLooksMobile = window.matchMedia('(max-width: 768px)').matches;
        const touchCapable = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
        const mobileSignalCount = [uaLooksMobile, viewportLooksMobile, touchCapable].filter(Boolean).length;
        if (mobileSignalCount >= 2) {
            isTestActive = false;
            document.getElementById('mainApplicationWrapper').style.display = 'none';
            document.getElementById('securityHardlockTitle').innerText = EN_COMMON['security.mobileTitle'];
            document.getElementById('securityHardlockReason').innerText = EN_COMMON['security.mobileReason'];
            document.getElementById('securityHardlockScreen').style.display = 'flex';
            return;
        }

        // 2. Restore theme
        if (localStorage.getItem('lqa_theme') === 'dark') {
            document.body.classList.add('dark-mode');
            const btn = document.getElementById('themeToggle');
            if (btn) btn.innerHTML = EN_COMMON['buttons.lightMode'];
        }

        // 3. Restore answers q1-q9 and initialize flood-guard lengths
        for (let i = 1; i <= 9; i++) {
            const storedAnswer = localStorage.getItem(`lqa_ans_q${i}`);
            const field = document.getElementById(`q${i}`);
            if (storedAnswer !== null && field) {
                field.value = storedAnswer;
                previousTextLengthsStore[`q${i}`] = storedAnswer.length;
                if (i === 8 || i === 9) refreshWordCounterMetric(`q${i}`);
                autoGrowTextarea(field);
            }
        }

        // 4. Accessibility hardening for the hidden language input
        const hiddenLangInput = document.getElementById('candidateLanguage');
        if (hiddenLangInput) {
            hiddenLangInput.setAttribute('tabindex', '-1');
            hiddenLangInput.setAttribute('aria-hidden', 'true');
        }

        // 5. Reapply RTL support based on stored language
        const storedLangForRtl = localStorage.getItem('lqa_candidate_lang');
        if (storedLangForRtl && LQA_LANGUAGES[storedLangForRtl]) {
            triggerDynamicLocalContentHydration(storedLangForRtl);
        }

        // 6. Restore active page (F5 / reload recovery)
        const storedPage = parseInt(localStorage.getItem('lqa_active_page'), 10);
        const storedEmail = localStorage.getItem('lqa_candidate_email');
        const storedLang = localStorage.getItem('lqa_candidate_lang');

        if (storedPage >= 2 && storedPage <= 4 && storedEmail && storedLang) {
            const first = localStorage.getItem('lqa_candidate_first') || '';
            const last = localStorage.getItem('lqa_candidate_last') || '';
            if (first) document.getElementById('firstName').value = first;
            if (last) document.getElementById('lastName').value = last;
            document.getElementById('candidateEmail').value = storedEmail;
            document.getElementById('firstName').disabled = true;
            document.getElementById('lastName').disabled = true;
            document.getElementById('candidateEmail').disabled = true;

            document.querySelectorAll('.language-card').forEach(card => {
                if (card.getAttribute('data-lang') === storedLang) card.classList.add('active');
            });
            document.getElementById('candidateLanguage').value = storedLang;

            // Restore active edit question: reset session start so reload time isn't counted
            const savedActiveEdit = localStorage.getItem('lqa_active_edit_q');
            if (savedActiveEdit) {
                activeEditQuestion = savedActiveEdit;
                localStorage.setItem(`lqa_edit_session_start_${savedActiveEdit}`, Date.now());
            }

            isTestActive = true;
            engageInterTabCommunicationBroadcast();
            changePageView(storedPage); // starts the section timer for storedPage
            refreshQuestionLockStates();
        }
    });
});

lqaDataReady.then(() => {
    injectEnCommonTexts();
    renderLanguageGrid();
});
