// Source de donnees candidat externe (generee depuis lqa-textes-i18n.xlsx via
// build_data.py, voir l18n/lqa-data.json sur GitHub). index.html ne contient plus
// aucune valeur de texte candidat en dur : uniquement les cles utilisees ci-dessous
// comme références (lookups EN_COMMON et LQA_LANGUAGES ci-dessous).
// TODO: remplacer par l'URL raw GitHub definitive du fichier l18n/lqa-data.json.
const LQA_DATA_URL = 'https://raw.githubusercontent.com/<org>/<repo>/main/l18n/lqa-data.json';

let EN_COMMON = {};
let BUG_TYPES = [];
let GLOSSARY_TERMS_EN = [];
let LANG_GRID_ORDER = [];
let LQA_LANGUAGES = {};

// Message de secours en dur : seul cas ou le texte ne peut pas venir de la data
// layer externe, puisque c'est justement son chargement qui a echoue.
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

// Converts literal "\n" markers (as typed in a spreadsheet cell) into real
// line breaks, so multi-line EN_Common strings (e.g. the bug report template)
// stay editable as a single plain-text cell rather than needing a real
// newline embedded in the source.
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

// Column header is the language code itself — never a translated label.
function buildGlossaryColumnCode(langCode) {
    return (langCode || '').toUpperCase();
}

let timerRunningEngine;
let isTestActive = false;
let uniqueTabWindowId = sessionStorage.getItem('lqa_tab_window_id') || Math.random().toString(36).substring(2, 15);
sessionStorage.setItem('lqa_tab_window_id', uniqueTabWindowId);

let lqaBroadcastChannel = new BroadcastChannel('lqa_session_channel');
let sessionKeepAliveInterval;
let testEndTime;

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

function changePageView(targetPageId) {
    document.querySelectorAll('.page-view').forEach(view => view.classList.remove('active'));
    document.getElementById(`page${targetPageId}`).classList.add('active');
    window.scrollTo(0, 0);
}

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

    document.getElementById('confirmationModal').classList.add('show');
}

function confirmSubmission(isConfirmed) {
    document.getElementById('confirmationModal').classList.remove('show');
    if (isConfirmed) {
        clearInterval(timerRunningEngine);
        if (sessionKeepAliveInterval) clearInterval(sessionKeepAliveInterval);
        lqaBroadcastChannel.close();
        displaySummaryDashboard(false);
    }
}

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
    clearInterval(timerRunningEngine);
    if (sessionKeepAliveInterval) clearInterval(sessionKeepAliveInterval);
    document.getElementById('mainApplicationWrapper').style.display = 'none';
    document.getElementById('securityHardlockTitle').innerText = titleText;
    document.getElementById('securityHardlockReason').innerText = reasonText;
    document.getElementById('securityHardlockScreen').style.display = 'flex';
}

function resetQASession() {
    if (confirm(EN_COMMON['qaReset.confirmPrompt'])) {
        clearInterval(timerRunningEngine);
        if (sessionKeepAliveInterval) clearInterval(sessionKeepAliveInterval);
        localStorage.clear();
        sessionStorage.clear();
        window.location.reload();
    }
}

// Screen-shield anti-screenshot/anti-blur protections
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

function getWordCount(textValue, langCode) {
    const cleanText = textValue.trim();
    if (cleanText === "") return 0;
    const fallbackLang = langCode || localStorage.getItem('lqa_candidate_lang') || "en-US";

    // Chinese & Japanese: Intl.Segmenter for real word-like segmentation (same approach as Thai
    // below); the rough "character count / 1.6" approximation is kept only as a fallback for
    // browsers without Intl.Segmenter support.
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

    // Korean intentionally keeps the space-based heuristic rather than Intl.Segmenter: Korean text
    // is already segmented at the eojeol (word-ish unit) level by whitespace, so splitting on
    // spaces is already a reasonable proxy. The ×1.2 factor compensates for eojeols often bundling
    // a stem + grammatical particles, which English would usually count as more than one word.
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

    changePageView(2);
    document.getElementById('timerDisplay').style.display = 'block';
    isTestActive = true;

    engageInterTabCommunicationBroadcast();

    const existingEndTimeCheck = localStorage.getItem('lqa_test_end_time');
    if (existingEndTimeCheck) {
        testEndTime = parseInt(existingEndTimeCheck, 10);
    } else {
        const totalDurationMilliseconds = 2 * 60 * 60 * 1000;
        testEndTime = Date.now() + totalDurationMilliseconds;
        localStorage.setItem('lqa_test_end_time', testEndTime);
        localStorage.setItem('lqa_test_start_anchor', Date.now());
    }

    if (timerRunningEngine) clearInterval(timerRunningEngine);

    timerRunningEngine = setInterval(() => {
        const now = Date.now();
        const timeRemainingMilliseconds = testEndTime - now;

        if (timeRemainingMilliseconds <= 0) {
            clearInterval(timerRunningEngine);
            document.getElementById('confirmationModal').classList.remove('show');
            alert(EN_COMMON['timer.expiredAlert']);
            displaySummaryDashboard(true);
            return;
        }

        const totalSecondsRemaining = Math.floor(timeRemainingMilliseconds / 1000);
        const hours = Math.floor(totalSecondsRemaining / 3600);
        const minutes = Math.floor((totalSecondsRemaining % 3600) / 60);
        const seconds = totalSecondsRemaining % 60;

        document.getElementById('timerDisplay').innerHTML = `${EN_COMMON['timer.label']}${hours}:${minutes < 10 ? '0' + minutes : minutes}:${seconds < 10 ? '0' + seconds : seconds}`;
    }, 1000);
}

function triggerCandidatePdfDownload() {
    window.print();
}

function clearSubmissionErrorBanner() {
    const existing = document.getElementById('submissionErrorBanner');
    if (existing) existing.remove();
}

function downloadAnswersLocally(snapshot) {
    const blobContent = `${EN_COMMON['download.candidateLabel']} ${snapshot.last} ${snapshot.first}\n${EN_COMMON['payload.emailLabel']} ${snapshot.email}\n${EN_COMMON['download.languageLabel']} ${snapshot.lang}\n${EN_COMMON['payload.durationLabel']} ${snapshot.elapsedMinutes} ${EN_COMMON['payload.durationUnit']}\n\n${snapshot.teamsBodyText}`;
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
    banner.style.background = '#fef2f2';
    banner.style.border = '2px solid #fca5a5';
    banner.style.borderRadius = '10px';
    banner.style.padding = '20px';
    banner.style.marginBottom = '30px';
    banner.style.color = '#7f1d1d';

    const message = document.createElement('p');
    message.style.margin = '0 0 15px 0';
    message.style.fontWeight = '700';
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

// Static client-side token: NOT real security (readable from page source), it only filters out
// the most casual accidental/automated POSTs. Genuine authentication must happen server-side.
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

function displaySummaryDashboard(isTriggeredByTimeout) {
    isTestActive = false;
    document.getElementById('timerDisplay').style.display = 'none';
    document.getElementById('assessmentForm').style.display = 'none';
    clearSubmissionErrorBanner();

    const first = localStorage.getItem('lqa_candidate_first') || "Candidate";
    const last = localStorage.getItem('lqa_candidate_last') || "User";
    const email = localStorage.getItem('lqa_candidate_email') || "unknown@session.com";
    const lang = localStorage.getItem('lqa_candidate_lang') || "Unknown";

    const startAnchor = parseInt(localStorage.getItem('lqa_test_start_anchor') || Date.now(), 10);
    const elapsedMinutes = Math.round((Date.now() - startAnchor) / 60000);

    document.getElementById('summaryMetaLanguageBox').innerHTML = `${EN_COMMON['page5.languageMetaPrefix']}${lang}`;
    const contentContainer = document.getElementById('summaryContent');
    contentContainer.innerHTML = '';

    let teamsBodyText = `**${EN_COMMON['payload.emailLabel']}** ${email}\n\n**${EN_COMMON['payload.durationLabel']}** ${elapsedMinutes} ${EN_COMMON['payload.durationUnit']}\n\n`;
    if (isTriggeredByTimeout) {
        teamsBodyText += `⚠️ **${EN_COMMON['payload.timeoutWarning']}** ⚠️\n\n`;
    }

    for (let i = 1; i <= 9; i++) {
        const labelNode = document.getElementById(`lbl_q${i}`);
        let origLabel = "Question " + i;
        if (labelNode) {
            const clone = labelNode.cloneNode(true);
            const embeddedSpan = clone.querySelector('.print-strip');
            origLabel = embeddedSpan ? embeddedSpan.innerText : clone.innerText;
        }

        const field = document.getElementById(`q${i}`);
        const targetVal = field ? field.value.trim() : EN_COMMON['payload.noResponseFallback'];

        const elementBlock = document.createElement('div');
        elementBlock.className = 'summary-item';

        // Built with createElement + textContent (not innerHTML) so candidate-supplied answer text
        // is always treated as plain text and can never be interpreted/executed as HTML (fixes
        // stored XSS).
        const qLine = document.createElement('div');
        qLine.className = 'summary-q';
        qLine.textContent = `${EN_COMMON['page5.responseLabelPrefix']}${i}`;

        const aLine = document.createElement('div');
        aLine.className = 'summary-a';
        aLine.textContent = targetVal || EN_COMMON['payload.noResponseFallback'];

        elementBlock.appendChild(qLine);
        elementBlock.appendChild(aLine);
        contentContainer.appendChild(elementBlock);

        teamsBodyText += `**${origLabel}**\n${targetVal}\n`;
        if (i === 8 || i === 9) {
            teamsBodyText += `*(${EN_COMMON['payload.wordCountSuffix'].replace('{n}', getWordCount(targetVal, lang))})*\n`;
        }
        teamsBodyText += `\n`;
    }

    const answersSnapshot = { first, last, email, lang, elapsedMinutes, teamsBodyText };
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

// Applies right-to-left text direction for Arabic (ar-AA): the glossary panel, both
// side-windows, the target-language column of the Q5/Q6/Q7 comparison sheets (the
// English reference column intentionally stays LTR), and the candidate's own
// free-text answer fields for Q5, Q6, Q7 and Q9. Resets to ltr/auto otherwise.
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

// Anti-cheat interceptors, feedback submission, lightbox runtime.
//
// SECURITY NOTE: everything in this block — and the single-tab BroadcastChannel
// check above, and the client-side timer above — runs entirely in the candidate's
// browser. A candidate with basic DevTools knowledge can disable any of it:
// override navigator.clipboard, delete these event listeners, edit isTestActive /
// testEndTime in the console, spoof sessionStorage/BroadcastChannel messages, or
// open the page source and resubmit a forged payload directly to the webhook
// endpoint. None of this is real proctoring. If test integrity genuinely matters,
// the fix has to move server-side: a short-lived signed session token validated
// server-side on every POST, timestamped answer snapshots logged as the candidate
// types, server-side enforcement of the time limit, or a dedicated proctoring
// SDK/service for true lockdown (clipboard, dev tools, tab focus).
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

// 1. Clipboard restrictions (copy/cut/paste)
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

// 2. Paste/rapid-input flood guard (blocks paste and large sudden insertions)
let previousTextLengthsStore = {};

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
        }
    }
});

// 3. Collapses text selection (prevents multi-select copy workaround)
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
    // 1. Hardware detection matrix blocking smart devices, tablets, and phones.
    // Combines three independent signals (User-Agent sniffing, viewport width, touch capability)
    // instead of relying on UA alone, requiring at least 2 of 3 to agree before blocking access.
    const uaLooksMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    const viewportLooksMobile = window.matchMedia('(max-width: 768px)').matches;
    const touchCapable = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
    const mobileSignalCount = [uaLooksMobile, viewportLooksMobile, touchCapable].filter(Boolean).length;
    const isMobileDevice = mobileSignalCount >= 2;
    if (isMobileDevice) {
        isTestActive = false;
        document.getElementById('mainApplicationWrapper').style.display = 'none';
        document.getElementById('securityHardlockTitle').innerText = EN_COMMON['security.mobileTitle'];
        document.getElementById('securityHardlockReason').innerText = EN_COMMON['security.mobileReason'];
        document.getElementById('securityHardlockScreen').style.display = 'flex';
        return;
    }

    if (localStorage.getItem('lqa_theme') === 'dark') {
        document.body.classList.add('dark-mode');
        const btn = document.getElementById('themeToggle');
        if (btn) btn.innerHTML = EN_COMMON['buttons.lightMode'];
    }

    // 2. Text Answers State Rehydration Loop (q1 to q9). Refreshes the word-count
    // badges for the two free-text fields that have one (q8, q9).
    for (let i = 1; i <= 9; i++) {
        const storedAnswer = localStorage.getItem(`lqa_ans_q${i}`);
        const field = document.getElementById(`q${i}`);
        if (storedAnswer !== null && field) {
            field.value = storedAnswer;
            if (i === 8 || i === 9) refreshWordCounterMetric(`q${i}`);
        }
    }

    // 3. Accessibility hardening for the hidden language input: kept out of the
    // keyboard tab order and invisible to assistive technologies, since the
    // visible language picker is the language-card grid, not this input.
    const hiddenLangInput = document.getElementById('candidateLanguage');
    if (hiddenLangInput) {
        hiddenLangInput.setAttribute('tabindex', '-1');
        hiddenLangInput.setAttribute('aria-hidden', 'true');
    }

    // 4. Reapply localized content + RTL layout support on reload, based on the
    // previously stored candidate language (registration fields stay disabled by
    // CSS/state already set before reload — this just restores the visible text).
    const storedLangForRtl = localStorage.getItem('lqa_candidate_lang');
    if (storedLangForRtl && LQA_LANGUAGES[storedLangForRtl]) {
        triggerDynamicLocalContentHydration(storedLangForRtl);
    }
    });
});

// Initial render: static EN_Common text + the Page 1 language grid. Deferred until
// the external data layer (lqaDataReady) has resolved; runs immediately afterwards
// since this script sits at the end of body, after every element it targets has
// already been parsed.
lqaDataReady.then(() => {
    injectEnCommonTexts();
    renderLanguageGrid();
});
