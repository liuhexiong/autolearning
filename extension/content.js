(function () {
  if (window.top !== window) {
    installFrameShortcutRelay();
    return;
  }

  if (window.__AUTOLEARNING_CONTENT__) {
    return;
  }

  window.__AUTOLEARNING_CONTENT__ = true;

  const BRIDGE_REQUEST_EVENT = "autolearning:bridge-request";
  const BRIDGE_RESPONSE_EVENT = "autolearning:bridge-response";
  const PANEL_ID = "autolearning-panel";
  const LAUNCHER_ID = "autolearning-launcher";
  const STYLE_ID = "autolearning-style";
  const HOST_ID = "autolearning-host";
  const POSITION_STORAGE_KEY = "autolearningLauncherPosition";
  const FIXED_CAPTURE_STORAGE_KEY = "autolearningFixedCaptureRegions";
  const QUESTION_BANK_STORAGE_KEY = "autolearningQuestionBankV1";
  const LAUNCHER_SIZE = 62;
  const PANEL_GAP = 12;
  const PANEL_MAX_WIDTH = 420;
  const MOBILE_BREAKPOINT = 720;
  const DRAG_THRESHOLD = 6;
  const PANEL_VISIBLE_STRIP = 72;
  const AI_STATUS_ICON_URL = chrome.runtime.getURL("assets/newaistatus.png");
  const CLOSE_CROSS_ICON_URL = chrome.runtime.getURL("assets/close-cross.svg");
  const DEFAULT_CHOICE_PROMPT =
    "当前页面大概率是选择题、判断题、概念题或简答型理论题。请优先输出最终答案，而不是写完整程序。若题目是单选题，code 字段只放最终选项，例如 A、B、C、D；若是多选题，code 字段只放选项组合，例如 AC；若是判断题，code 字段只放“对”或“错”；若是简短填空或概念问答，code 字段只放最终可直接填写的简短答案。不要输出 main 函数，不要伪造代码。approach 用 3 到 5 句简洁说明你的判断依据，重点使用关键词匹配、概念定义和排除法。";
  const DEFAULT_CODE_PROMPT =
    "当前页面大概率是编程题、代码填空题或需要补全模板的题。请优先保留题目指定语言、函数签名、输入输出格式和已有代码骨架，只补上真正缺失的部分。若页面自带代码与题面冲突，优先相信题面和样例。code 字段只放最终可提交或可复制的内容，不要在 code 里混入解释。尽量给出最稳妥、最容易通过样例和评测的做法。";

  const state = {
    mounted: false,
    solving: false,
    fullAutoRunning: false,
    fullAutoStopRequested: false,
    fullAutoRunToken: 0,
    fullAutoRound: 0,
    problem: null,
    result: null,
    history: [],
    lastUrl: location.href,
    launcherPosition: null,
    panelManualPosition: null,
    dragPointerId: null,
    dragStartPointer: null,
    dragStartPosition: null,
    isDraggingLauncher: false,
    suppressLauncherClick: false,
    dragSource: "",
    clipboardSyncInstalled: false,
    clipboardSyncPending: false,
    lastAutoSolveCode: "",
    noticeTimer: 0,
    statusHintTimerShort: 0,
    statusHintTimerLong: 0,
    statusBusy: false,
    statusHint: "准备就绪",
    currentSolveRequestId: "",
    solveCancelRequested: false,
    promptPreview: null,
    screenshotShortcutInstalled: false,
    frameShortcutBridgeInstalled: false,
    fixedCaptureRegion: null,
    questionBank: {},
    questionBankLoaded: false,
    questionBankReviewQueue: [],
    reviewModalOpen: false,
    settings: {
      promptMode: "code",
      extraInstructionsChoice: DEFAULT_CHOICE_PROMPT,
      extraInstructionsCode: DEFAULT_CODE_PROMPT,
      includeScreenshotInSolver: true,
      autoSolveAfterCapture: true,
      screenshotShortcut: "Alt+Shift+S",
      fullPageScreenshotShortcut: "Alt+Shift+F",
      fullAutoShortcut: "Alt+Shift+A",
      autoSubmitAfterFullCapture: false,
      fullAutoNextDelayMs: 1500,
      autoPickNextDelayMs: 600,
      fullAutoMode: "extract",
    },
  };

  const elements = {};

  installBridge();
  bootstrap();
  observePageChanges();

  function bootstrap() {
    if (state.mounted) {
      return;
    }

    state.mounted = true;
    mountUi();
    installAutoClipboardSync();
    installScreenshotShortcut();
    installFrameShortcutBridge();
    void hydrateFixedCaptureRegion();
    void hydrateQuestionBank();
    renderSummary("插件已在当前页面就绪。你可以直接截图、读剪贴板，或先识别当前页面内容。");
    renderGeneratedTitle("");
    renderCurrentClassification(null);
    renderPromptPreview("还没有可预览的内容。");
    renderScreenshotStatus(null);
    renderOcrText("");
    renderHistory([]);
    setStatus("插件已在当前网站启用。");
  }

  function observePageChanges() {
    const observer = new MutationObserver(() => {
      if (location.href !== state.lastUrl) {
        state.lastUrl = location.href;
        state.problem = null;
        state.result = null;
        state.lastAutoSolveCode = "";
        state.promptPreview = null;
        state.panelManualPosition = null;
        markResultReady(false);
        renderGeneratedTitle("");
        renderCurrentClassification(null);
        renderPromptPreview("页面已切换，等待重新提取当前关卡内容。");
        renderScreenshotStatus(null);
        renderOcrText("");
        state.fixedCaptureRegion = null;
        void hydrateFixedCaptureRegion();
      }
      bootstrap();
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });

    window.setInterval(() => {
      if (location.href !== state.lastUrl) {
        state.lastUrl = location.href;
        state.problem = null;
        state.result = null;
        state.lastAutoSolveCode = "";
        state.promptPreview = null;
        state.panelManualPosition = null;
        markResultReady(false);
        renderGeneratedTitle("");
        renderCurrentClassification(null);
        renderPromptPreview("页面已切换，等待重新提取当前关卡内容。");
        renderScreenshotStatus(null);
        renderOcrText("");
        state.fixedCaptureRegion = null;
        void hydrateFixedCaptureRegion();
      }
      bootstrap();
    }, 1200);
  }

  function mountUi() {
    injectStyles();

    const host = document.createElement("div");
    host.id = HOST_ID;
    host.innerHTML = `
      <button id="${LAUNCHER_ID}" type="button" aria-label="打开学习助手"><span class="al-visually-hidden">学习助手</span></button>
      <div id="autolearning-toast" aria-live="polite"></div>
      <aside id="${PANEL_ID}" data-open="false" aria-hidden="true">
        <div class="al-card">
          <header class="al-header">
            <div>
              <p class="al-kicker">学习助手</p>
              <h2>学习助手</h2>
            </div>
            <button class="al-close" type="button" aria-label="关闭面板"><span class="al-visually-hidden">关闭</span></button>
          </header>

          <section class="al-status-card" data-role="status-card" data-busy="false">
            <div class="al-status-icon" aria-hidden="true">
              <span class="al-status-spinner"></span>
            </div>
            <div class="al-status-copy">
              <p class="al-status-label">当前状态</p>
              <p class="al-status" data-role="status">初始化中...</p>
              <p class="al-status-hint" data-role="status-hint">准备就绪</p>
            </div>
            <button class="al-status-action" data-role="status-action" type="button">提交</button>
          </section>

          <div class="al-actions al-actions-primary">
            <button data-role="extract" type="button">提取题面</button>
            <button data-role="solve" type="button" class="al-primary">生成答案</button>
            <button data-role="full-auto" type="button">开启全自动</button>
            <button data-role="edit-question-bank" type="button">编辑题库</button>
          </div>

          <section class="al-section" data-role="choice-answer-wrap" hidden>
            <div class="al-code-head">
              <h3>最终答案</h3>
              <button data-role="copy-choice-answer" type="button" class="al-link">复制</button>
            </div>
            <div data-role="choice-answer" class="al-choice-answer">还没有生成答案。</div>
          </section>

          <section class="al-section">
            <h3>当前识别</h3>
            <div class="al-summary" data-role="summary"></div>
          </section>

          <section class="al-section" data-role="approach-wrap">
            <div class="al-code-head">
              <h3>解题思路</h3>
              <button data-role="copy-approach" type="button" class="al-link">复制</button>
            </div>
            <div class="al-result" data-role="approach">还没有生成内容。</div>
          </section>

          <section class="al-section">
            <div class="al-code-head">
              <h3>答题模式</h3>
              <div class="al-mode-switch" data-role="prompt-mode-switch">
                <button data-role="prompt-mode-choice" type="button" class="al-mode-button">选择题</button>
                <button data-role="prompt-mode-code" type="button" class="al-mode-button">代码题</button>
              </div>
            </div>
            <div class="al-summary">先选题型，再提取题面或生成答案。</div>
          </section>

          <details class="al-section al-details">
            <summary>
              <span>更多操作</span>
              <span class="al-details-summary-hint">点击展开</span>
            </summary>
            <div class="al-actions al-actions-secondary">
              <button data-role="capture" type="button">框选截图</button>
              <button data-role="define-capture-region" type="button">设定区域</button>
              <button data-role="paste-code" type="button">读取剪贴板代码</button>
              <button data-role="settings" type="button">设置</button>
            </div>
            <section class="al-section">
              <div class="al-code-head">
                <h3>全自动模式</h3>
                <div class="al-mode-switch" data-role="full-auto-mode-switch">
                  <button data-role="full-auto-mode-capture" type="button" class="al-mode-button">截图全自动</button>
                  <button data-role="full-auto-mode-extract" type="button" class="al-mode-button">提取题面全自动</button>
                </div>
              </div>
              <div class="al-summary" data-role="full-auto-mode-summary">先选择全自动模式，再点击“开启全自动”。</div>
            </section>
            <section class="al-section">
              <div class="al-code-head">
                <h3>截图辅助</h3>
                <div class="al-inline-actions">
                  <button data-role="clear-screenshot-buffer" type="button" class="al-link-button" hidden>清空缓冲</button>
                  <span data-role="shortcut-tip" class="al-mini-tip">框选 Alt+Shift+S / 固定区 Alt+Shift+F</span>
                </div>
              </div>
              <div data-role="screenshot-status" class="al-summary">还没有附带题面截图。</div>
            </section>
          </details>

          <details class="al-section al-details" data-role="prompt-preview-wrap">
            <summary>
              <span>高级信息</span>
              <span class="al-details-summary-hint">点击展开</span>
            </summary>
            <section class="al-section">
              <div class="al-code-head">
                <h3>发送给 AI 的内容预览</h3>
                <div class="al-inline-actions">
                  <button data-role="refresh-preview" type="button" class="al-link-button">刷新预览</button>
                  <button data-role="copy-preview" type="button" class="al-link-button">复制预览</button>
                </div>
              </div>
              <pre data-role="prompt-preview" class="al-details-content">还没有可预览的内容。</pre>
            </section>

            <section class="al-section">
              <h3>OCR 结果</h3>
              <pre data-role="ocr-text" class="al-details-content">还没有 OCR 结果。</pre>
            </section>

            <section class="al-section">
              <div class="al-code-head">
                <h3>提取管理</h3>
                <div class="al-inline-actions">
                  <button data-role="copy-problem" type="button" class="al-link-button">复制 JSON</button>
                  <button data-role="export-problem" type="button" class="al-link-button">导出 JSON</button>
                  <button data-role="clear-problem" type="button" class="al-link-button">清空提取</button>
                </div>
              </div>
            </section>

            <section class="al-section">
              <h3>AI 标题</h3>
              <div class="al-summary" data-role="generated-title">还没有 AI 标题。</div>
            </section>

            <section class="al-section">
              <h3>题型判断</h3>
              <div class="al-summary" data-role="problem-type">还没有题型分类。</div>
              <div class="al-result" data-role="problem-definition">还没有问题定义。</div>
            </section>

            <section class="al-section">
              <div class="al-code-head">
                <h3>搜题记录</h3>
                <div class="al-inline-actions">
                  <button data-role="export-history" type="button" class="al-link-button">导出 Markdown</button>
                  <button data-role="refresh-history" type="button" class="al-link-button">刷新记录</button>
                  <button data-role="clear-history" type="button" class="al-link-button">清空记录</button>
                </div>
              </div>
              <div data-role="history-list" class="al-history-list">还没有搜题记录。</div>
            </section>

            <section class="al-section">
              <h3>查看提取详情</h3>
              <pre data-role="details" class="al-details-content">还没有提取内容。</pre>
            </section>
          </section>

          <section class="al-section" data-role="code-wrap">
            <div class="al-code-head">
              <h3>生成代码</h3>
              <button data-role="copy" type="button" class="al-link">复制</button>
            </div>
            <textarea
              data-role="code"
              class="al-code"
              spellcheck="false"
              readonly
              placeholder="生成后的代码会显示在这里，可直接复制或填回编辑器。"
            ></textarea>
          </section>
        </div>
      </aside>
    `;

    document.documentElement.appendChild(host);

    elements.host = host;
    elements.launcher = host.querySelector(`#${LAUNCHER_ID}`);
    elements.toast = host.querySelector("#autolearning-toast");
    elements.panel = host.querySelector(`#${PANEL_ID}`);
    elements.statusCard = host.querySelector('[data-role="status-card"]');
    elements.status = host.querySelector('[data-role="status"]');
    elements.statusHint = host.querySelector('[data-role="status-hint"]');
    elements.statusAction = host.querySelector('[data-role="status-action"]');
    elements.summary = host.querySelector('[data-role="summary"]');
    elements.generatedTitle = host.querySelector('[data-role="generated-title"]');
    elements.problemType = host.querySelector('[data-role="problem-type"]');
    elements.problemDefinition = host.querySelector('[data-role="problem-definition"]');
    elements.approachWrap = host.querySelector('[data-role="approach-wrap"]');
    elements.codeWrap = host.querySelector('[data-role="code-wrap"]');
    elements.approach = host.querySelector('[data-role="approach"]');
    elements.code = host.querySelector('[data-role="code"]');
    elements.choiceAnswerWrap = host.querySelector('[data-role="choice-answer-wrap"]');
    elements.choiceAnswer = host.querySelector('[data-role="choice-answer"]');
    elements.promptModeChoice = host.querySelector('[data-role="prompt-mode-choice"]');
    elements.promptModeCode = host.querySelector('[data-role="prompt-mode-code"]');
    elements.fullAutoModeCapture = host.querySelector('[data-role="full-auto-mode-capture"]');
    elements.fullAutoModeExtract = host.querySelector('[data-role="full-auto-mode-extract"]');
    elements.fullAutoModeSummary = host.querySelector('[data-role="full-auto-mode-summary"]');
    elements.details = host.querySelector('[data-role="details"]');
    elements.promptPreview = host.querySelector('[data-role="prompt-preview"]');
    elements.screenshotStatus = host.querySelector('[data-role="screenshot-status"]');
    elements.clearScreenshotBuffer = host.querySelector('[data-role="clear-screenshot-buffer"]');
    elements.shortcutTip = host.querySelector('[data-role="shortcut-tip"]');
    elements.fullAutoButton = host.querySelector('[data-role="full-auto"]');
    elements.header = host.querySelector(".al-header");
    elements.ocrText = host.querySelector('[data-role="ocr-text"]');
    elements.historyList = host.querySelector('[data-role="history-list"]');

    host.querySelector(".al-close").addEventListener("click", closePanel);
    elements.statusAction?.addEventListener("click", () => {
      void handleStatusAction();
    });
    elements.launcher.addEventListener("click", togglePanel);
    host.querySelector('[data-role="extract"]').addEventListener("click", () => {
      void handleExtract();
    });
    host.querySelector('[data-role="solve"]').addEventListener("click", () => {
      void handleSolve();
    });
    host.querySelector('[data-role="capture"]').addEventListener("click", () => {
      void handleCaptureScreenshot();
    });
    host.querySelector('[data-role="define-capture-region"]').addEventListener("click", () => {
      void handleDefineFixedCaptureRegion();
    });
    host.querySelector('[data-role="full-auto"]').addEventListener("click", () => {
      void handleToggleFullAuto();
    });
    host.querySelector('[data-role="settings"]').addEventListener("click", () => {
      void handleOpenSettings();
    });
    host.querySelector('[data-role="edit-question-bank"]').addEventListener("click", () => {
      void handleOpenQuestionBankEditor();
    });
    host.querySelector('[data-role="paste-code"]').addEventListener("click", () => {
      void handlePasteCode();
    });
    elements.promptModeChoice?.addEventListener("click", () => {
      void handlePromptModeSwitch("choice");
    });
    elements.promptModeCode?.addEventListener("click", () => {
      void handlePromptModeSwitch("code");
    });
    elements.fullAutoModeCapture?.addEventListener("click", () => {
      void handleFullAutoModeSwitch("capture");
    });
    elements.fullAutoModeExtract?.addEventListener("click", () => {
      void handleFullAutoModeSwitch("extract");
    });
    host.querySelector('[data-role="refresh-preview"]').addEventListener("click", () => {
      void refreshPromptPreview();
    });
    host.querySelector('[data-role="copy-preview"]').addEventListener("click", () => {
      void handleCopyPromptPreview();
    });
    host.querySelector('[data-role="copy"]').addEventListener("click", () => {
      void handleCopy();
    });
    host.querySelector('[data-role="copy-approach"]').addEventListener("click", () => {
      void handleCopyApproach();
    });
    host.querySelector('[data-role="copy-choice-answer"]').addEventListener("click", () => {
      void handleCopyChoiceAnswer();
    });
    host.querySelector('[data-role="copy-problem"]').addEventListener("click", () => {
      void handleCopyProblem();
    });
    host.querySelector('[data-role="export-problem"]').addEventListener("click", () => {
      void handleExportProblem();
    });
    host.querySelector('[data-role="clear-problem"]').addEventListener("click", () => {
      handleClearProblemState();
    });
    host.querySelector('[data-role="export-history"]').addEventListener("click", () => {
      void handleExportHistoryMarkdown();
    });
    host.querySelector('[data-role="refresh-history"]').addEventListener("click", () => {
      void refreshHistory();
    });
    host.querySelector('[data-role="clear-history"]').addEventListener("click", () => {
      void handleClearHistory();
    });
    host.querySelector('[data-role="clear-screenshot-buffer"]').addEventListener("click", () => {
      void handleClearScreenshotBuffer();
    });

    initFloatingPosition();
    setupLauncherDrag();
    window.addEventListener("resize", handleViewportResize);
    chrome.storage?.onChanged?.addListener(handleStorageChanged);
    renderFullAutoButton();
    renderStatusActionButton();
    void hydrateInlineSettings();
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${HOST_ID} {
        position: fixed;
        top: 0;
        left: 0;
        z-index: 2147483647;
        pointer-events: none;
        font-family: "IBM Plex Sans", "PingFang SC", "Helvetica Neue", sans-serif;
      }

      #${HOST_ID} .al-visually-hidden {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
      }

      #${LAUNCHER_ID} {
        position: fixed;
        right: 18px;
        top: 112px;
        width: 62px;
        height: 62px;
        border: 0;
        border-radius: 999px;
        cursor: pointer;
        pointer-events: auto;
        background:
          url("${AI_STATUS_ICON_URL}") center/78% no-repeat,
          radial-gradient(circle at 30% 24%, rgba(255, 255, 255, 0.84), rgba(255, 255, 255, 0.18) 38%, transparent 39%),
          linear-gradient(180deg, #f4efe7 0%, #d7cec1 100%);
        border: 2px solid rgba(42, 36, 31, 0.14);
        box-shadow:
          0 18px 36px rgba(16, 24, 28, 0.24),
          inset 0 2px 10px rgba(255, 255, 255, 0.65);
        transition:
          transform 160ms ease,
          box-shadow 160ms ease,
          opacity 160ms ease;
      }

      #${LAUNCHER_ID}:hover {
        transform: translateY(-2px);
        box-shadow:
          0 22px 40px rgba(16, 24, 28, 0.28),
          inset 0 2px 10px rgba(255, 255, 255, 0.7);
      }

      #${LAUNCHER_ID}[data-has-result="true"]::after {
        content: "新";
        position: absolute;
        top: -6px;
        right: -6px;
        min-width: 22px;
        height: 22px;
        padding: 0 6px;
        border-radius: 999px;
        display: grid;
        place-items: center;
        font-size: 11px;
        font-weight: 800;
        color: #fff8ef;
        background: linear-gradient(135deg, #ef8f3a 0%, #c83f2f 100%);
        box-shadow: 0 10px 24px rgba(200, 63, 47, 0.32);
      }

      #autolearning-toast {
        position: fixed;
        right: 18px;
        top: 72px;
        max-width: min(340px, calc(100vw - 28px));
        padding: 12px 14px;
        border-radius: 16px;
        color: #fff8ef;
        font-size: 13px;
        line-height: 1.5;
        background:
          radial-gradient(circle at top left, rgba(255, 204, 140, 0.24), transparent 42%),
          linear-gradient(135deg, rgba(219, 122, 48, 0.96) 0%, rgba(191, 79, 41, 0.96) 100%);
        box-shadow: 0 20px 42px rgba(133, 54, 25, 0.28);
        opacity: 0;
        transform: translateY(-8px);
        pointer-events: none;
        transition:
          opacity 180ms ease,
          transform 180ms ease;
      }

      #autolearning-toast[data-show="true"] {
        opacity: 1;
        transform: translateY(0);
      }

      #${PANEL_ID} {
        position: fixed;
        right: 18px;
        top: 176px;
        width: min(420px, calc(100vw - 28px));
        max-height: calc(100vh - 194px);
        overflow: hidden;
        transform: translateX(calc(100% + 18px));
        opacity: 0;
        pointer-events: none;
        transition:
          transform 220ms ease,
          opacity 220ms ease;
      }

      #${PANEL_ID}[data-open="true"] {
        transform: translateX(0);
        opacity: 1;
        pointer-events: auto;
      }

      #${PANEL_ID} .al-card {
        display: grid;
        gap: 14px;
        padding: 18px;
        max-height: calc(100vh - 194px);
        overflow-y: auto;
        overscroll-behavior: contain;
        border: 1px solid rgba(255, 255, 255, 0.18);
        border-radius: 24px;
        color: #f3f2ef;
        background:
          radial-gradient(circle at top right, rgba(219, 122, 48, 0.22), transparent 32%),
          linear-gradient(180deg, rgba(13, 23, 28, 0.96) 0%, rgba(15, 20, 24, 0.94) 100%);
        box-shadow: 0 28px 70px rgba(6, 13, 18, 0.38);
        backdrop-filter: blur(14px);
        scrollbar-width: thin;
        scrollbar-color: rgba(255, 180, 107, 0.45) rgba(255, 255, 255, 0.08);
      }

      #${PANEL_ID} .al-card::-webkit-scrollbar {
        width: 10px;
      }

      #${PANEL_ID} .al-card::-webkit-scrollbar-track {
        background: rgba(255, 255, 255, 0.06);
        border-radius: 999px;
      }

      #${PANEL_ID} .al-card::-webkit-scrollbar-thumb {
        background: rgba(255, 180, 107, 0.4);
        border-radius: 999px;
      }

      #${PANEL_ID} .al-card::-webkit-scrollbar-thumb:hover {
        background: rgba(255, 180, 107, 0.58);
      }

      #${PANEL_ID} .al-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 16px;
        cursor: grab;
        user-select: none;
      }

      #${PANEL_ID} .al-header:active {
        cursor: grabbing;
      }

      #${PANEL_ID} .al-kicker {
        margin: 0 0 6px;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.18em;
        text-transform: uppercase;
        color: #ffb46b;
      }

      #${PANEL_ID} h2,
      #${PANEL_ID} h3 {
        margin: 0;
      }

      #${PANEL_ID} h2 {
        font-size: 22px;
        letter-spacing: -0.03em;
      }

      #${PANEL_ID} h3 {
        font-size: 14px;
        color: #f7f3ea;
      }

      #${PANEL_ID} .al-mini-tip {
        font-size: 11px;
        color: #ffcf9a;
      }

      #${PANEL_ID} .al-close {
        width: 32px;
        height: 32px;
        border: 0;
        border-radius: 999px;
        background:
          url("${CLOSE_CROSS_ICON_URL}") center/78% no-repeat,
          rgba(255, 255, 255, 0.08);
        cursor: pointer;
        flex: 0 0 auto;
      }

      #${PANEL_ID} .al-status-card {
        display: grid;
        grid-template-columns: 36px minmax(0, 1fr) auto;
        gap: 12px;
        align-items: center;
        padding: 12px 14px;
        border-radius: 18px;
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(255, 255, 255, 0.06);
      }

      #${PANEL_ID} .al-status-icon {
        width: 36px;
        height: 36px;
        border-radius: 999px;
        display: grid;
        place-items: center;
        background:
          radial-gradient(circle at 30% 24%, rgba(255, 255, 255, 0.84), rgba(255, 255, 255, 0.18) 38%, transparent 39%),
          linear-gradient(180deg, #f4efe7 0%, #d7cec1 100%);
        border: 1px solid rgba(42, 36, 31, 0.14);
      }

      #${PANEL_ID} .al-status-spinner {
        width: 24px;
        height: 24px;
        opacity: 0.92;
        background: url("${AI_STATUS_ICON_URL}") center/contain no-repeat;
        transform-origin: center;
      }

      #${PANEL_ID} .al-status-card[data-busy="true"] .al-status-spinner {
        opacity: 1;
        animation: al-spin 2200ms linear infinite;
      }

      #${PANEL_ID} .al-status-card[data-busy="false"] .al-status-spinner {
        opacity: 0.92;
        animation: none;
      }

      #${PANEL_ID} .al-status-copy {
        min-width: 0;
      }

      #${PANEL_ID} .al-status-action {
        border: 0;
        border-radius: 999px;
        padding: 8px 14px;
        font: inherit;
        font-size: 12px;
        font-weight: 800;
        color: #20140e;
        cursor: pointer;
        background: linear-gradient(135deg, #ffb56a 0%, #f08a3a 100%);
        box-shadow: 0 10px 20px rgba(240, 138, 58, 0.18);
      }

      #${PANEL_ID} .al-status-action[data-variant="cancel"] {
        color: #fff4ec;
        background: linear-gradient(135deg, #d04b35 0%, #9d2e28 100%);
        box-shadow: 0 10px 20px rgba(157, 46, 40, 0.22);
      }

      #${PANEL_ID} .al-status-label,
      #${PANEL_ID} .al-status,
      #${PANEL_ID} .al-status-hint {
        margin: 0;
      }

      #${PANEL_ID} .al-status-label {
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: #ffb46b;
      }

      #${PANEL_ID} .al-status {
        margin-top: 4px;
        font-size: 14px;
        line-height: 1.5;
        color: #f5efe6;
      }

      #${PANEL_ID} .al-status-hint {
        margin-top: 4px;
        font-size: 12px;
        line-height: 1.5;
        color: #cdbda9;
      }

      #${PANEL_ID} .al-actions {
        display: grid;
        gap: 10px;
      }

      #${PANEL_ID} .al-actions-primary {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      #${PANEL_ID} .al-actions-secondary {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      #${PANEL_ID} .al-actions button,
      #${PANEL_ID} .al-link {
        border: 0;
        border-radius: 14px;
        padding: 11px 12px;
        font: inherit;
        font-size: 13px;
        font-weight: 700;
        color: #f5efe6;
        cursor: pointer;
        background: rgba(255, 255, 255, 0.08);
      }

      #${PANEL_ID} .al-primary {
        color: #fff6eb;
        background: linear-gradient(135deg, #db7a30 0%, #bf4f29 100%);
      }

      #${PANEL_ID} .al-actions button[data-running="true"] {
        color: #fff6eb;
        background: linear-gradient(135deg, #d04b35 0%, #9d2e28 100%);
      }

      #${PANEL_ID} .al-section {
        display: grid;
        gap: 10px;
      }

      #${PANEL_ID} .al-summary,
      #${PANEL_ID} .al-result,
      #${PANEL_ID} .al-details-content {
        margin: 0;
        padding: 12px 14px;
        border-radius: 16px;
        font-size: 13px;
        line-height: 1.68;
        color: #efe7db;
        background: rgba(255, 255, 255, 0.06);
        white-space: pre-wrap;
        word-break: break-word;
      }

      #${PANEL_ID} .al-summary-card {
        display: grid;
        gap: 10px;
      }

      #${PANEL_ID} .al-summary-grid {
        display: grid;
        gap: 8px;
      }

      #${PANEL_ID} .al-summary-row {
        display: flex;
        align-items: baseline;
        gap: 8px;
        flex-wrap: wrap;
      }

      #${PANEL_ID} .al-summary-key {
        flex: 0 0 auto;
        font-size: 12px;
        font-weight: 700;
        color: #ffcf9a;
      }

      #${PANEL_ID} .al-summary-value {
        min-width: 0;
        flex: 1 1 180px;
        color: #f1e7d8;
      }

      #${PANEL_ID} .al-summary-preview {
        display: grid;
        gap: 8px;
      }

      #${PANEL_ID} .al-summary-preview-card {
        display: grid;
        gap: 6px;
        padding: 10px 12px;
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.05);
      }

      #${PANEL_ID} .al-summary-preview-label {
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.04em;
        color: #ffb46b;
      }

      #${PANEL_ID} .al-summary-preview-text {
        font-size: 12px;
        line-height: 1.7;
        color: #efe7db;
      }

      #${PANEL_ID} .al-summary-hint {
        padding: 10px 12px;
        border-radius: 14px;
        font-size: 12px;
        line-height: 1.7;
        color: #eadfce;
        background: rgba(255, 180, 107, 0.08);
        border: 1px solid rgba(255, 180, 107, 0.16);
      }

      #${PANEL_ID} .al-code-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }

      #${PANEL_ID} .al-inline-actions {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
      }

      #${PANEL_ID} .al-link {
        padding: 0;
        color: #ffb46b;
        background: transparent;
      }

      #${PANEL_ID} .al-link-button {
        border: 0;
        padding: 0;
        font: inherit;
        font-size: 12px;
        font-weight: 700;
        color: #ffb46b;
        cursor: pointer;
        background: transparent;
      }

      #${PANEL_ID} .al-code {
        width: 100%;
        min-height: 220px;
        resize: vertical;
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 16px;
        padding: 14px;
        font:
          13px/1.6 "IBM Plex Mono",
          "SFMono-Regular",
          "JetBrains Mono",
          monospace;
        color: #e8e2d8;
        background: rgba(9, 16, 20, 0.72);
      }

      #${PANEL_ID} .al-prompt {
        width: 100%;
        min-height: 96px;
        resize: vertical;
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 16px;
        padding: 14px;
        font:
          13px/1.6 "IBM Plex Sans",
          "PingFang SC",
          "Helvetica Neue",
          sans-serif;
        color: #e8e2d8;
        background: rgba(9, 16, 20, 0.72);
      }

      #${PANEL_ID} .al-code:focus,
      #${PANEL_ID} .al-prompt:focus {
        outline: 1px solid rgba(255, 180, 107, 0.6);
      }

      #${PANEL_ID} .al-choice-answer {
        border-radius: 18px;
        padding: 16px 18px;
        font-size: 28px;
        font-weight: 800;
        line-height: 1.2;
        letter-spacing: 0.04em;
        color: #fff6e8;
        text-align: center;
        background:
          radial-gradient(circle at top left, rgba(255, 208, 149, 0.2), transparent 42%),
          linear-gradient(135deg, rgba(219, 122, 48, 0.26) 0%, rgba(191, 79, 41, 0.2) 100%);
        border: 1px solid rgba(255, 180, 107, 0.18);
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
      }

      #${PANEL_ID} .al-mode-switch {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 4px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.06);
      }

      #${PANEL_ID} .al-mode-button {
        border: 0;
        border-radius: 999px;
        padding: 6px 12px;
        color: rgba(243, 242, 239, 0.76);
        font-size: 12px;
        font-weight: 700;
        background: transparent;
        cursor: pointer;
        transition:
          background 150ms ease,
          color 150ms ease,
          transform 150ms ease;
      }

      #${PANEL_ID} .al-mode-button:hover {
        color: #fff3de;
        transform: translateY(-1px);
      }

      #${PANEL_ID} .al-mode-button[data-active="true"] {
        color: #20140e;
        background: linear-gradient(135deg, #ffb56a 0%, #f08a3a 100%);
        box-shadow: 0 10px 22px rgba(240, 138, 58, 0.2);
      }

      #${PANEL_ID} .al-details summary {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 12px 14px;
        border-radius: 16px;
        cursor: pointer;
        list-style: none;
        color: #ffcf9a;
        font-size: 13px;
        font-weight: 700;
        background: rgba(255, 180, 107, 0.08);
        border: 1px dashed rgba(255, 180, 107, 0.24);
      }

      #${PANEL_ID} .al-details summary::-webkit-details-marker {
        display: none;
      }

      #${PANEL_ID} .al-details summary::after {
        content: ">";
        font-size: 14px;
        color: #ffb46b;
        transform: rotate(90deg);
        transition: transform 160ms ease;
      }

      #${PANEL_ID} .al-details[open] summary::after {
        transform: rotate(270deg);
      }

      #${PANEL_ID} .al-details-summary-hint {
        margin-left: auto;
        font-size: 11px;
        font-weight: 600;
        color: #cdbda9;
      }

      #${PANEL_ID} .al-details[open] summary {
        margin-bottom: 6px;
      }

      #${PANEL_ID} [data-role="prompt-preview-wrap"] {
        gap: 12px;
      }

      #${PANEL_ID} .al-details-content {
        max-height: 220px;
        overflow: auto;
        font:
          12px/1.6 "IBM Plex Mono",
          "SFMono-Regular",
          "JetBrains Mono",
          monospace;
      }

      #${PANEL_ID} .al-history-list {
        display: grid;
        gap: 10px;
        max-height: 240px;
        overflow: auto;
      }

      #${PANEL_ID} .al-history-item {
        display: grid;
        gap: 8px;
        padding: 12px 14px;
        border-radius: 16px;
        background: rgba(255, 255, 255, 0.06);
      }

      #${PANEL_ID} .al-history-meta,
      #${PANEL_ID} .al-history-tags {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
      }

      #${PANEL_ID} .al-history-meta strong {
        color: #fff4e6;
      }

      #${PANEL_ID} .al-history-meta span,
      #${PANEL_ID} .al-history-tags span {
        font-size: 12px;
        color: #ffcf9a;
      }

      #${PANEL_ID} .al-history-tags span {
        padding: 2px 8px;
        border-radius: 999px;
        background: rgba(255, 180, 107, 0.12);
      }

      #${PANEL_ID} .al-history-text {
        margin: 0;
        font-size: 13px;
        line-height: 1.6;
        color: #efe7db;
      }

      #${PANEL_ID} .al-history-link {
        font-size: 12px;
        font-weight: 700;
        color: #ffb46b;
        text-decoration: none;
      }

      .al-bank-modal {
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        display: grid;
        place-items: center;
        padding: 16px;
        background: rgba(6, 11, 14, 0.56);
        pointer-events: auto;
      }

      .al-bank-modal-card {
        width: min(860px, calc(100vw - 24px));
        max-height: min(82vh, 760px);
        overflow: auto;
        display: grid;
        gap: 12px;
        padding: 16px;
        border-radius: 18px;
        border: 1px solid rgba(255, 255, 255, 0.16);
        color: #f7efe1;
        background:
          radial-gradient(circle at top right, rgba(219, 122, 48, 0.18), transparent 40%),
          rgba(15, 20, 24, 0.97);
      }

      .al-bank-modal-head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 10px;
      }

      .al-bank-modal-head h3 {
        margin: 0;
        font-size: 18px;
      }

      .al-bank-modal-head p {
        margin: 6px 0 0;
        font-size: 13px;
        color: #d7c9b3;
      }

      .al-bank-modal-tools {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        flex-wrap: wrap;
      }

      .al-bank-modal-tool-buttons {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }

      .al-bank-modal-tool-buttons button {
        border: 0;
        border-radius: 10px;
        padding: 8px 12px;
        font-size: 12px;
        font-weight: 700;
        color: #fff3df;
        background: rgba(255, 255, 255, 0.1);
        cursor: pointer;
      }

      .al-bank-save-indicator {
        min-height: 20px;
        padding: 3px 10px;
        border-radius: 999px;
        font-size: 12px;
        font-weight: 700;
        color: #f6ead7;
        background: rgba(255, 255, 255, 0.08);
      }

      .al-bank-save-indicator[data-state="saving"] {
        color: #20140e;
        background: linear-gradient(135deg, #ffb56a 0%, #f08a3a 100%);
      }

      .al-bank-save-indicator[data-state="saved"] {
        color: #fff4e8;
        background: rgba(83, 186, 122, 0.2);
      }

      .al-bank-modal-close {
        border: 0;
        border-radius: 999px;
        width: 30px;
        height: 30px;
        font-size: 16px;
        color: #fff3df;
        background: rgba(255, 255, 255, 0.1);
        cursor: pointer;
      }

      .al-bank-list {
        display: grid;
        gap: 10px;
      }

      .al-bank-item {
        display: grid;
        gap: 8px;
        padding: 12px;
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.06);
      }

      .al-bank-item-title {
        margin: 0;
        font-size: 13px;
        line-height: 1.5;
        color: #fff3df;
      }

      .al-bank-item-meta {
        margin: 0;
        font-size: 12px;
        color: #d5c4ad;
      }

      .al-bank-item-answer {
        display: grid;
        gap: 6px;
      }

      .al-bank-item-answer label {
        font-size: 12px;
        color: #ffcf9a;
      }

      .al-bank-item-answer input {
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 10px;
        padding: 8px 10px;
        font-size: 14px;
        color: #fff6e8;
        background: rgba(8, 14, 18, 0.72);
      }

      .al-bank-modal-actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
      }

      .al-bank-modal-actions button {
        border: 0;
        border-radius: 10px;
        padding: 9px 14px;
        font-size: 13px;
        font-weight: 700;
        cursor: pointer;
      }

      .al-bank-modal-cancel {
        color: #ecdcc6;
        background: rgba(255, 255, 255, 0.1);
      }

      .al-bank-modal-save {
        color: #20140e;
        background: linear-gradient(135deg, #ffb56a 0%, #f08a3a 100%);
      }

      @media (max-width: 720px) {
        #${LAUNCHER_ID} {
          top: auto;
          bottom: 18px;
        }

        #autolearning-toast {
          right: 10px;
          top: auto;
          bottom: 148px;
          max-width: calc(100vw - 20px);
        }

        #${PANEL_ID} {
          right: 10px;
          top: auto;
          bottom: 82px;
          width: calc(100vw - 20px);
          max-height: calc(100vh - 108px);
        }

        #${PANEL_ID} .al-card {
          max-height: calc(100vh - 108px);
        }

        #${PANEL_ID} .al-actions-primary,
        #${PANEL_ID} .al-actions-secondary {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }

      @keyframes al-spin {
        from {
          transform: rotate(0deg);
        }
        to {
          transform: rotate(360deg);
        }
      }
    `;

    document.documentElement.appendChild(style);
  }

  function openPanel() {
    syncFloatingUiPosition();
    elements.panel.setAttribute("data-open", "true");
    elements.panel.setAttribute("aria-hidden", "false");
  }

  function closePanel() {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    elements.panel.setAttribute("data-open", "false");
    elements.panel.setAttribute("aria-hidden", "true");
    elements.launcher.focus();
  }

  function togglePanel() {
    if (state.suppressLauncherClick) {
      state.suppressLauncherClick = false;
      return;
    }

    if (elements.panel.getAttribute("data-open") === "true") {
      closePanel();
    } else {
      openPanel();
    }
  }

  async function handleExtract() {
    openPanel();
    startBusyStatus("正在识别题面和当前代码...", "正在读取页面上的题面、选项和代码内容。");

    try {
      const problem = await extractProblem();
      state.problem = problem;
      state.result = null;
      state.lastAutoSolveCode = "";
      markResultReady(false);

      renderProblem(problem);
      renderGeneratedTitle("");
      renderCurrentClassification(null);
      elements.approach.textContent = "还没有生成内容。";
      elements.code.value = "";
      renderChoiceAnswer("");
      await refreshPromptPreview({ silent: true });
      stopBusyStatus("题面已提取，可以直接生成答案。", "题面已识别完成。");
    } catch (error) {
      stopBusyStatus(error instanceof Error ? error.message : String(error), "提取失败，请检查当前页面。");
    }
  }

  function handleClearProblemState() {
    state.problem = null;
    state.result = null;
    state.lastAutoSolveCode = "";
    state.promptPreview = null;
    markResultReady(false);
    renderSummary("还没有提取内容。");
    renderGeneratedTitle("");
    renderCurrentClassification(null);
    renderPromptPreview("还没有可预览的内容。");
    renderScreenshotStatus(null);
    renderOcrText("");
    renderChoiceAnswer("");
    if (elements.approach) {
      elements.approach.textContent = "还没有生成内容。";
    }
    if (elements.code) {
      elements.code.value = "";
    }
    if (elements.details) {
      elements.details.textContent = "还没有提取内容。";
    }
    setStatus("已清空当前提取结果。");
  }

  async function handleSolve(options = {}) {
    const auto = Boolean(options.auto);
    const autoNavigate = options.autoNavigate !== false;
    const sourceCode = typeof options.sourceCode === "string" ? options.sourceCode : "";
    const extraInstructions = getStoredExtraInstructions();
    const mode = getPromptMode();
    const requestId = `solve-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    if (!auto) {
      openPanel();
    }

    if (state.solving) {
      return { ok: false, error: "当前正在生成答案，请稍后再试。" };
    }

    if (!state.problem) {
      if (mode === "choice") {
        setStatus("选择题模式不会自动提取题面，请先点“提取题面”。");
        return { ok: false, error: "选择题模式缺少题面上下文。" };
      }
      await handleExtract();
    }

    state.solving = true;
    state.solveCancelRequested = false;
    state.currentSolveRequestId = requestId;
    renderStatusActionButton();
    startBusyStatus("正在准备答案...", "先检查本地题库，再决定是否调用 AI。");

    try {
      await ensureQuestionBankLoaded();
      const questionBankHit = findQuestionBankAnswer(state.problem, mode);
      const usedQuestionBank = Boolean(questionBankHit?.entry);
      let solveResult = null;

      if (usedQuestionBank) {
        setStatus("题库命中，正在直接使用本地答案...", {
          busy: true,
          hint: "已命中本地题库，本题不会调用 AI。",
        });
        solveResult = buildQuestionBankResult(questionBankHit.entry, state.problem);
      } else {
        setStatus("本地题库未命中，正在请求 AI...", {
          busy: true,
          hint: "已开始调用模型。",
        });
        const response = await sendMessage({
          type: "autolearning:solve-problem",
          requestId,
          problem: state.problem,
          extraInstructions,
        });

        if (!response?.ok) {
          throw new Error(response?.error || "生成失败");
        }
        solveResult = response.result || {};
      }

      state.result = solveResult;
      const choiceAnswerText = String(solveResult.answer || solveResult.code || "").trim();
      renderGeneratedTitle(solveResult.generatedTitle || solveResult.summary || "");
      renderCurrentClassification(solveResult);
      elements.approach.textContent = solveResult.approach || solveResult.summary || "已拿到答案。";
      elements.code.value = solveResult.code || "";
      renderChoiceAnswer(choiceAnswerText);

      if (!usedQuestionBank) {
        await upsertQuestionBankEntry(state.problem, mode, solveResult, { source: "ai" });
      }
      if (mode === "choice" && choiceAnswerText) {
        queueQuestionBankReviewItem(state.problem, mode, choiceAnswerText);
      }

      let autoPickResult = null;
      if (mode === "choice" && choiceAnswerText) {
        autoPickResult = await pickChoiceOptions(choiceAnswerText);
      }
      if (auto && sourceCode) {
        state.lastAutoSolveCode = sourceCode;
      }
      markResultReady(true);
      await refreshHistory({ silent: true });
      blurAssistantEditable();
      const copySource = mode === "choice" ? choiceAnswerText : elements.code.value;
      const copied = await copyTextToClipboard(copySource);
      const autoPickSuffix =
        autoPickResult?.ok && autoPickResult.labels.length > 0
          ? `，并自动选择 ${autoPickResult.labels.join("/")}`
          : "";
      const manualPickSuffix = autoPickResult?.manualRequired
        ? "，检测到多选题，当前不会自动勾选"
        : "";
      let nextQuestionSuffix = "";
      let nextClicked = false;
      if (auto && autoNavigate && mode === "choice" && autoPickResult?.ok) {
        await delay(normalizeAutoPickDelay(state.settings.autoPickNextDelayMs));
        nextClicked = clickNextQuestionButton();
        if (nextClicked) {
          nextQuestionSuffix = "，已自动进入下一题";
        }
      }
      stopBusyStatus(
        copied
          ? `已生成答案${autoPickSuffix}${manualPickSuffix}${nextQuestionSuffix}并自动复制，来源：${usedQuestionBank ? "本地题库" : solveResult.model || "AI"}`
          : `已生成答案${autoPickSuffix}${manualPickSuffix}${nextQuestionSuffix}，来源：${usedQuestionBank ? "本地题库" : solveResult.model || "AI"}`,
        autoPickResult?.manualRequired
          ? "多选题请先随机作答并提交，看完解析后到“编辑题库”里修正答案；之后仍需手动勾选选项。"
          : usedQuestionBank
            ? "答案来自本地题库。"
            : "AI 已返回结果。",
      );
      showToast(
        autoPickResult?.manualRequired
          ? `这是多选题：先随机作答并提交，再到“编辑题库”修正答案；之后也需要按答案 ${choiceAnswerText} 手动勾选。`
          : "答案已经生成好了，点 AL 就能查看。",
      );
      return {
        ok: true,
        result: solveResult,
        choiceAnswerText,
        autoPickResult,
        nextClicked,
        source: usedQuestionBank ? "question-bank" : "ai",
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const cancelled = state.solveCancelRequested || /请求已取消/.test(message);
      stopBusyStatus(
        cancelled ? "已取消本次请求。" : message,
        cancelled ? "你可以继续截图或重新提交。" : "本次请求没有成功完成。",
      );
      return {
        ok: false,
        error: cancelled ? "请求已取消" : message,
      };
    } finally {
      state.solving = false;
      state.solveCancelRequested = false;
      state.currentSolveRequestId = "";
      renderStatusActionButton();
    }
  }

  async function handleToggleFullAuto() {
    openPanel();

    if (state.fullAutoRunning) {
      state.fullAutoStopRequested = true;
      renderFullAutoButton();
      setStatus("已请求停止全自动模式，会在当前这一题结束后停下。");
      return;
    }

    if (getPromptMode() !== "choice") {
      setStatus("全自动模式当前只支持选择题模式，请先切换到“选择题”。");
      return;
    }

    const fullAutoMode = getFullAutoMode();
    if (fullAutoMode === "capture") {
      const rect = await getOrCreateFixedCaptureRect();
      if (!rect) {
        setStatus("截图全自动启动前需要先设定固定截图区域。");
        return;
      }
      state.fixedCaptureRegion = rectToStoredCaptureRegion(rect);
    }

    state.fullAutoRunning = true;
    state.fullAutoStopRequested = false;
    state.fullAutoRound = 0;
    state.fullAutoRunToken += 1;
    const runToken = state.fullAutoRunToken;
    renderFullAutoButton();
    setStatus(
      fullAutoMode === "capture"
        ? "全自动模式已启动，将按截图链路连续答题并跳到下一题。"
        : "全自动模式已启动，将直接提取题面文本、答题并跳到下一题。",
    );
    showToast(
      fullAutoMode === "capture"
        ? "截图全自动已启动。再次点击按钮可停止。"
        : "提取题面全自动已启动，当前不会使用 OCR。再次点击按钮可停止。",
    );

    void runFullAutoLoop(runToken);
  }

  async function runFullAutoLoop(runToken) {
    try {
      while (
        state.fullAutoRunning &&
        !state.fullAutoStopRequested &&
        runToken === state.fullAutoRunToken
      ) {
        const beforeFingerprint = getPageFingerprint();
        state.fullAutoRound += 1;
        setStatus(`全自动模式运行中，正在处理第 ${state.fullAutoRound} 题...`);

        const fullAutoMode = getFullAutoMode();
        const flowResult =
          fullAutoMode === "capture"
            ? await handleCaptureImageFlow({
                mode: "fixedRegion",
                autoSolve: true,
                autoSubmit: false,
                autoNavigate: false,
              })
            : await runTextOnlyFullAutoRound();

        if (runToken !== state.fullAutoRunToken || state.fullAutoStopRequested) {
          break;
        }

        if (!flowResult?.ok) {
          throw new Error(flowResult?.error || "全自动模式执行失败。");
        }

        const solveResult = flowResult.solveResult;
        if (!solveResult?.ok) {
          throw new Error(solveResult?.error || "全自动模式没有拿到有效答案。");
        }

        const choiceAnswerText = String(solveResult.choiceAnswerText || "").trim();
        if (solveResult.autoPickResult?.manualRequired) {
          throw new Error(
            `第 ${state.fullAutoRound} 题是多选题。请先随机作答并提交，看完解析后到“编辑题库”修正答案；之后仍需按答案 ${choiceAnswerText} 手动勾选。`,
          );
        }
        if (!solveResult.autoPickResult?.ok) {
          // Some pages do not expose stable "selected" DOM states. In full-auto mode,
          // prioritize continuity: if we already have an answer, keep going.
          if (!choiceAnswerText) {
            throw new Error(
              fullAutoMode === "capture"
                ? "这一题没有拿到有效答案，请检查截图区域、OCR 结果或答案格式。"
                : "这一题没有拿到有效答案，请检查题面提取结果或答案格式。",
            );
          }
          setStatus(
            `第 ${state.fullAutoRound} 题已拿到答案 ${choiceAnswerText}，未确认选中态，继续尝试下一题...`,
          );
        }

        const navigationResult = await advanceToNextQuestionOrSubmit(beforeFingerprint, runToken);
        if (navigationResult.action === "submit") {
          setStatus(`第 ${state.fullAutoRound} 题已完成，已检测到最后一题并尝试点击“提交作业”。`);
          showToast("已到最后一题并提交。看完解析后，可在面板里点“编辑题库”修正答案。");
          break;
        }
        if (!navigationResult.ok && !state.fullAutoStopRequested && runToken === state.fullAutoRunToken) {
          setStatus(
            `第 ${state.fullAutoRound} 题已完成，但自动跳题失败：${navigationResult.error || "页面没有进入下一题"}。`,
          );
          showToast("自动跳题失败，全自动模式已停止。");
          break;
        }

        resetProblemForNextAutoRound();
        await delay(320);
      }
    } catch (error) {
      if (runToken === state.fullAutoRunToken) {
        const message = error instanceof Error ? error.message : String(error);
        setStatus(`全自动模式已停止：${message}`);
        showToast("全自动模式已停止，请检查当前页面后再继续。");
      }
    } finally {
      if (runToken === state.fullAutoRunToken) {
        const stoppedByUser = state.fullAutoStopRequested;
        state.fullAutoRunning = false;
        state.fullAutoStopRequested = false;
        renderFullAutoButton();
        if (stoppedByUser) {
          setStatus(`全自动模式已停止，共处理 ${state.fullAutoRound} 题。`);
          showToast("全自动模式已停止。");
        }
      }
    }
  }

  async function runTextOnlyFullAutoRound() {
    const problem = await extractProblem();
    problem.screenshotDataUrl = "";
    problem.screenshotRect = null;
    problem.screenshotMode = "";
    problem.ocrText = "";
    problem.ocrModel = "";
    problem.ocrSkipped = true;
    state.problem = problem;
    renderProblem(problem);
    renderScreenshotStatus(problem);
    renderOcrText("");
    await refreshPromptPreview({ silent: true });
    const solveResult = await handleSolve({ auto: true, autoNavigate: false });
    return {
      ok: true,
      problem,
      solveResult,
    };
  }

  async function handleFill() {
    openPanel();
    const code = String(elements.code.value || "");

    if (!hasMeaningfulCode(code)) {
      setStatus("当前没有可填充的代码。");
      return;
    }

    setStatus("正在把代码填回编辑器...");

    const result = await callPageBridge("setEditorValue", { code });
    if (result?.ok) {
      setStatus("代码已经填入编辑器。");
      return;
    }

    setStatus("自动填充失败，请手动复制代码。");
  }

  async function handleCopy() {
    const code = String(elements.code.value || "");
    if (!hasMeaningfulCode(code)) {
      setStatus("还没有可复制的代码。");
      return;
    }

    if (await copyTextToClipboard(code)) {
      setStatus("代码已复制到剪贴板。");
    } else {
      setStatus("复制失败，请手动选择代码。");
    }
  }

  async function handleCopyApproach() {
    const approach = String(elements.approach?.textContent || "").trim();
    if (!approach || approach === "还没有生成内容。") {
      setStatus("还没有可复制的解题思路。");
      return;
    }

    if (await copyTextToClipboard(approach)) {
      setStatus("解题思路已复制到剪贴板。");
    } else {
      setStatus("复制解题思路失败，请手动选择。");
    }
  }

  async function handleCopyChoiceAnswer() {
    const answer = String(elements.choiceAnswer?.textContent || "").trim();
    if (!answer || answer === "还没有生成答案。") {
      setStatus("还没有可复制的答案。");
      return;
    }

    if (await copyTextToClipboard(answer)) {
      setStatus("答案已复制到剪贴板。");
    } else {
      setStatus("复制答案失败，请手动选择。");
    }
  }

  async function pickChoiceOptions(answerText) {
    const labels = extractChoiceLabels(answerText);
    if (labels.length === 0) {
      return { ok: false, labels: [], error: "答案不是 A/B/C/D 或 对/错 格式。" };
    }

    const initialItems = collectChoiceItems();
    if (initialItems.length === 0) {
      return { ok: false, labels: [], error: "页面没有找到可点击的选项列表。" };
    }

    const multiChoiceMode = isMultiChoiceQuestionContext() || labels.length > 1;
    if (multiChoiceMode) {
      return {
        ok: false,
        labels,
        error: "检测到多选题，暂不支持自动勾选，请按最终答案手动选择。",
        manualRequired: true,
      };
    }

    const picked = [];
    for (const label of labels) {
      const items = collectChoiceItems();
      const item =
        items.find((candidate) => matchesChoiceItemByLabel(candidate, label)) ||
        items.find((candidate, index) => matchesChoiceItemBySemanticFallback(candidate, label, index, items));
      if (!item) {
        const selectedMatch =
          items.find((candidate) => isChoiceItemSelected(candidate) && matchesChoiceItemByLabel(candidate, label)) ||
          items.find(
            (candidate, index) =>
              isChoiceItemSelected(candidate) &&
              matchesChoiceItemBySemanticFallback(candidate, label, index, items),
          );
        if (selectedMatch) {
          picked.push(label);
        }
        continue;
      }

      const clicked = multiChoiceMode
        ? await ensureChoiceItemSelected(item)
        : await clickChoiceItem(item, labels.length > 1);
      if (clicked || isChoiceItemSelected(item)) {
        picked.push(label);
      }
    }

    return {
      ok: picked.length > 0,
      labels: picked,
      error: picked.length > 0 ? "" : "没有匹配到可点击的选项。",
    };
  }

  async function pickChoiceOptionsInElementUiCheckboxGroup(labels) {
    if (!Array.isArray(labels) || labels.length === 0) {
      return [];
    }

    const groups = Array.from(
      document.querySelectorAll(".questionContent .el-checkbox-group.checkbox-view, .el-checkbox-group.checkbox-view"),
    ).filter((group) => group instanceof Element && isVisible(group) && !isInsideAssistant(group));
    if (groups.length === 0) {
      return [];
    }

    const picked = [];
    const group = groups[0];
    const optionLabels = Array.from(group.querySelectorAll("label.el-checkbox"));
    if (optionLabels.length === 0) {
      return [];
    }

    for (const targetLabel of labels) {
      const option = optionLabels.find((node) => getChoiceLabelFromItem(node) === targetLabel);
      if (!option) {
        continue;
      }
      const ok = await ensureElementUiCheckboxLabelSelected(option);
      if (ok || isChoiceItemSelected(option)) {
        picked.push(targetLabel);
      }
      await delay(120);
    }

    return picked;
  }

  async function ensureElementUiCheckboxLabelSelected(option) {
    if (!(option instanceof Element)) {
      return false;
    }
    if (isChoiceItemSelected(option)) {
      return true;
    }

    const clickTargets = [
      option.querySelector(".el-checkbox__inner"),
      option.querySelector(".el-checkbox__input"),
      option.querySelector(".el-checkbox__label"),
      option,
    ].filter(Boolean);

    for (const target of clickTargets) {
      if (!(target instanceof Element)) {
        continue;
      }
      if (!simulateDirectUserClick(target, { useNativeClick: true })) {
        continue;
      }
      if (await waitForChoiceItemSelected(option, 240)) {
        return true;
      }
    }

    const input = option.querySelector("input.el-checkbox__original");
    if (input instanceof HTMLInputElement && !input.checked) {
      input.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
      input.focus?.();
      simulateDirectUserClick(input, { useNativeClick: true });
      input.click?.();
      input.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
      input.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
      if (await waitForChoiceItemSelected(option, 240)) {
        return true;
      }
    }

    return isChoiceItemSelected(option);
  }

  function isMultiChoiceQuestionContext() {
    const problemText = normalizeText(
      `${state.problem?.title || ""}\n${state.problem?.statementText || ""}\n${state.problem?.ocrText || ""}`,
    );
    if (/(多选题|多项选择|multiple\s*choice)/i.test(problemText)) {
      return true;
    }

    const visibleQuestionHint = normalizeText(
      firstVisible([
        ".questionTitle",
        ".questionContent .questionTitle",
        ".ques-detail .questionTitle",
        "#task-left-panel .task-header",
      ])?.textContent || "",
    );
    return /(多选题|多项选择|multiple\s*choice)/i.test(visibleQuestionHint);
  }

  function extractChoiceLabels(answerText) {
    const raw = String(answerText || "").trim();
    const normalizedRaw = raw.toLowerCase();
    if (/(^|[^a-z])(true|正确|对)([^a-z]|$)/i.test(raw)) {
      return ["对"];
    }
    if (/(^|[^a-z])(false|错误|错)([^a-z]|$)/i.test(raw)) {
      return ["错"];
    }

    const cleaned = String(raw)
      .replace(/答案\s*[:：]?\s*/gi, " ")
      .replace(/[^A-Da-d]/g, "")
      .toUpperCase();
    const unique = [];
    for (const char of cleaned) {
      if (/^[A-D]$/.test(char) && !unique.includes(char)) {
        unique.push(char);
      }
    }
    return unique;
  }

  function matchesChoiceItemByLabel(item, label) {
    if (!(item instanceof Element)) {
      return false;
    }
    const explicitLetter = getChoiceLabelFromItem(item);
    const text = normalizeText(item.textContent || "")
      .replace(/\s+/g, "")
      .toUpperCase();
    if (label === "对") {
      return text.includes("对") || text.includes("正确") || text.includes("TRUE");
    }
    if (label === "错") {
      return text.includes("错") || text.includes("错误") || text.includes("FALSE");
    }

    if (explicitLetter) {
      return explicitLetter === label;
    }
    return (
      text.startsWith(`${label}.`) ||
      text.startsWith(`${label}、`) ||
      text.startsWith(`${label}`) ||
      text.includes(`${label}.`) ||
      text.includes(`${label}、`)
    );
  }

  function getChoiceLabelFromItem(item) {
    if (!(item instanceof Element)) {
      return "";
    }
    const direct = normalizeText(
      item.querySelector(".letterSort, .option-letter, .el-checkbox__label .letterSort, .el-radio__label .letterSort")
        ?.textContent || "",
    )
      .replace(/[^A-Da-d]/g, "")
      .toUpperCase();
    if (/^[A-D]$/.test(direct)) {
      return direct;
    }

    const text = normalizeText(item.textContent || "")
      .replace(/\s+/g, "")
      .toUpperCase();
    const match = text.match(/^([A-D])(?:[\.、:：\)\）]|$)/);
    return match ? match[1] : "";
  }

  function matchesChoiceItemBySemanticFallback(item, label, index, items = []) {
    if (!(item instanceof Element)) {
      return false;
    }

    const normalized = normalizeText(item.textContent || "")
      .replace(/\s+/g, "")
      .toUpperCase();

    if (label === "对") {
      return (
        normalized.startsWith("A.") ||
        normalized.startsWith("A、") ||
        normalized.startsWith("A对") ||
        normalized === "A" ||
        index === 0
      );
    }

    if (label === "错") {
      return (
        normalized.startsWith("B.") ||
        normalized.startsWith("B、") ||
        normalized.startsWith("B错") ||
        normalized === "B" ||
        index === 1
      );
    }

    if (/^[A-D]$/.test(label)) {
      // For A/B/C/D do not rely on index fallback by default.
      // Some pages render answer cards or navigation lists that also contain numbers/labels,
      // causing index-based fallback to click wrong targets.
      if (!isLikelyReliableChoiceOrder(items)) {
        return false;
      }
      return index === label.charCodeAt(0) - 65;
    }

    return false;
  }

  function isLikelyReliableChoiceOrder(items) {
    if (!Array.isArray(items) || items.length < 2 || items.length > 6) {
      return false;
    }
    const directLabelCount = items.reduce((count, item) => {
      const text = normalizeText(item?.textContent || "")
        .replace(/\s+/g, "")
        .toUpperCase();
      if (/^[A-D][\.\、:：\)\）]/.test(text)) {
        return count + 1;
      }
      return count;
    }, 0);
    return directLabelCount >= Math.max(2, Math.floor(items.length * 0.6));
  }

  async function clickChoiceItem(item, preferCheckbox = false) {
    if (!(item instanceof Element)) {
      return false;
    }

    if (isChoiceItemSelected(item)) {
      return true;
    }
    const beforeSignature = getChoiceGroupSelectionSignature(item);
    let clickTriggered = false;

    const candidates = [
      item.querySelector("input[type='checkbox']"),
      item.querySelector("input[type='radio']"),
      item.querySelector(".checkIcon"),
      item.querySelector("label"),
      item.querySelector(".item-content"),
      item.querySelector(".stem"),
      item.querySelector(".preStyle"),
      item,
    ].filter(Boolean);

    if (preferCheckbox) {
      candidates.sort((a, b) => {
        const aScore = a instanceof Element && a.matches("input[type='checkbox'], .el-checkbox, .ant-checkbox-wrapper") ? 1 : 0;
        const bScore = b instanceof Element && b.matches("input[type='checkbox'], .el-checkbox, .ant-checkbox-wrapper") ? 1 : 0;
        return bScore - aScore;
      });
    }

    for (const candidate of candidates) {
      if (!(candidate instanceof Element)) {
        continue;
      }

      if (!simulateUserClick(candidate, { useNativeClick: true })) {
        continue;
      }
      clickTriggered = true;

      await delay(90);
      if (isChoiceItemSelected(item)) {
        return true;
      }
      if (getChoiceGroupSelectionSignature(item) !== beforeSignature) {
        return true;
      }
    }

    if (clickTriggered && getChoiceGroupSelectionSignature(item) !== beforeSignature) {
      return true;
    }

    return false;
  }

  async function ensureChoiceItemSelected(item) {
    if (!(item instanceof Element)) {
      return false;
    }
    if (isChoiceItemSelected(item)) {
      return true;
    }

    if (isElementUiCheckboxItem(item)) {
      return ensureElementUiCheckboxLabelSelected(resolveElementUiCheckboxLabel(item) || item);
    }

    const checkbox = item.querySelector("input[type='checkbox']");
    if (checkbox instanceof HTMLInputElement) {
      if (!checkbox.checked) {
        // Use click-first for frameworks that rely on native pointer/click event chains.
        // Avoid "checked=true + click()" because it may toggle back to unchecked.
        simulateUserClick(checkbox, { useNativeClick: true });
        await delay(70);
      }
      if (!checkbox.checked) {
        checkbox.focus?.();
        checkbox.checked = true;
        checkbox.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
        checkbox.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
        await delay(60);
      }
      if (isChoiceItemSelected(item)) {
        return true;
      }
    }

    const radio = item.querySelector("input[type='radio']");
    if (radio instanceof HTMLInputElement) {
      // Some sites mislabel multi-choice as radio in DOM wrappers.
      if (!radio.checked) {
        radio.checked = true;
        radio.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
        radio.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
      }
      if (isChoiceItemSelected(item)) {
        return true;
      }
    }

    const clickCandidates = [
      item.querySelector(".el-checkbox__input"),
      item.querySelector(".el-checkbox__label"),
      item.querySelector(".el-checkbox__original"),
      item.querySelector("label"),
      item.querySelector(".checkIcon"),
      item.querySelector(".el-checkbox__inner"),
      item.querySelector(".ant-checkbox-input"),
      item.querySelector(".ant-checkbox-wrapper"),
      item.querySelector(".item-content"),
      item,
    ].filter(Boolean);

    for (const candidate of clickCandidates) {
      if (!(candidate instanceof Element)) {
        continue;
      }
      if (!simulateUserClick(candidate, { useNativeClick: true })) {
        continue;
      }
      await delay(90);
      if (isChoiceItemSelected(item)) {
        return true;
      }
    }

    const checkboxRoot =
      item.closest("label.el-checkbox, .el-checkbox, .checkbox-view label") ||
      item.querySelector("label.el-checkbox, .el-checkbox");
    if (checkboxRoot instanceof HTMLElement) {
      checkboxRoot.click();
      await delay(90);
      if (isChoiceItemSelected(item)) {
        return true;
      }
    }

    const checkboxInputLike =
      item.querySelector("input.el-checkbox__original") ||
      item.querySelector("input[type='checkbox']");
    if (checkboxInputLike instanceof HTMLInputElement) {
      checkboxInputLike.click?.();
      checkboxInputLike.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
      await delay(80);
      if (isChoiceItemSelected(item)) {
        return true;
      }
    }

    return isChoiceItemSelected(item);
  }

  async function waitForChoiceItemSelected(item, timeoutMs = 200) {
    const start = Date.now();
    while (Date.now() - start <= timeoutMs) {
      if (isChoiceItemSelected(item)) {
        return true;
      }
      await delay(30);
    }
    return isChoiceItemSelected(item);
  }

  function isChoiceItemSelected(item) {
    if (!(item instanceof Element)) {
      return false;
    }

    if (isElementUiCheckboxItem(item)) {
      const label = resolveElementUiCheckboxLabel(item);
      const checkboxInput =
        label?.querySelector(".el-checkbox__input") || item.querySelector(".el-checkbox__input");
      if (checkboxInput instanceof Element && checkboxInput.classList.contains("is-checked")) {
        return true;
      }
      const ariaChecked = String(label?.getAttribute("aria-checked") || item.getAttribute("aria-checked") || "").toLowerCase();
      return ariaChecked === "true";
    }

    const input = item.querySelector("input[type='checkbox'], input[type='radio']");
    if (input instanceof HTMLInputElement && input.checked) {
      return true;
    }

    if (item.matches("label.el-checkbox, .el-checkbox")) {
      const checkboxInput = item.querySelector(".el-checkbox__input");
      if (checkboxInput instanceof Element && checkboxInput.classList.contains("is-checked")) {
        return true;
      }
    }

    const explicitSelectedMarker = item.querySelector(
      ".is-checked, .checked, .selected, .active, [aria-checked='true'], [aria-selected='true']",
    );
    if (explicitSelectedMarker instanceof Element) {
      return true;
    }

    const selectedNodes = [
      item,
      item.querySelector(".checkIcon"),
      item.querySelector("label"),
      item.querySelector(".item-content"),
      item.querySelector(".el-radio__input"),
      item.querySelector(".el-checkbox__input"),
      item.querySelector(".ant-radio-wrapper"),
      item.querySelector(".ant-checkbox-wrapper"),
    ].filter(Boolean);

    return selectedNodes.some((node) => {
      if (!(node instanceof HTMLElement)) {
        return false;
      }
      const className = String(node.className || "");
      // Avoid matching partial words like "option" as selected.
      if (/(?:^|\s)(?:checked|selected|active|current|is-checked|is-selected|is-active|on)(?:\s|$)/i.test(className)) {
        return true;
      }
      const ariaChecked = String(node.getAttribute("aria-checked") || "").toLowerCase();
      if (ariaChecked === "true") {
        return true;
      }
      const ariaSelected = String(node.getAttribute("aria-selected") || "").toLowerCase();
      if (ariaSelected === "true") {
        return true;
      }
      const style = window.getComputedStyle(node);
      return /(56, 107, 255|64, 117, 255|82, 102, 255)/.test(style.backgroundColor || "");
    });
  }

  function isElementUiCheckboxItem(item) {
    if (!(item instanceof Element)) {
      return false;
    }
    return Boolean(
      item.matches("label.el-checkbox, .el-checkbox") ||
        item.closest("label.el-checkbox, .el-checkbox") ||
        item.querySelector(".el-checkbox__input, input.el-checkbox__original"),
    );
  }

  function resolveElementUiCheckboxLabel(item) {
    if (!(item instanceof Element)) {
      return null;
    }
    if (item.matches("label.el-checkbox")) {
      return item;
    }
    return item.closest("label.el-checkbox") || item.querySelector("label.el-checkbox");
  }

  function getChoiceGroupSelectionSignature(item) {
    if (!(item instanceof Element)) {
      return "";
    }

    const groupRoot =
      item.closest("ul.radio-view, ul.checkbox-view, .radio-view, .checkbox-view, ul, ol") || item.parentElement;
    const groupItems =
      groupRoot instanceof Element ? Array.from(groupRoot.querySelectorAll("li")) : [item];
    if (groupItems.length === 0) {
      return isChoiceItemSelected(item) ? "self" : "";
    }

    return groupItems
      .map((node, index) => (isChoiceItemSelected(node) ? String(index) : ""))
      .filter(Boolean)
      .join(",");
  }

  function collectChoiceItems() {
    const inputFirst = Array.from(
      document.querySelectorAll("input[type='checkbox'], input[type='radio']"),
    )
      .filter((node) => node instanceof Element && isVisible(node) && !isInsideAssistant(node))
      .map((node) => resolveChoiceItemContainer(node))
      .filter((node) => node instanceof Element && isVisible(node) && !isInsideAssistant(node));
    if (inputFirst.length > 0) {
      const dedupedInput = Array.from(new Set(inputFirst));
      const filteredInput = dedupedInput.filter((node) => looksLikeChoiceItem(node));
      if (filteredInput.length > 0) {
        return filteredInput;
      }
    }

    const preferred = Array.from(
      document.querySelectorAll("ul.radio-view li, ul.checkbox-view li, .radio-view li, .checkbox-view li"),
    ).filter((node) => node instanceof Element && isVisible(node) && !isInsideAssistant(node));
    if (preferred.length > 0) {
      return preferred;
    }

    const candidates = Array.from(
      document.querySelectorAll(
        "li, label, [role='radio'], [role='checkbox'], input[type='radio'], input[type='checkbox'], .option, .option-item, .answer-item, .el-radio, .el-checkbox, .ant-radio-wrapper, .ant-checkbox-wrapper",
      ),
    );

    const mapped = candidates
      .map((node) => resolveChoiceItemContainer(node))
      .filter((node) => node instanceof Element && isVisible(node) && !isInsideAssistant(node));

    const deduped = [];
    const seen = new Set();
    for (const node of mapped) {
      if (!(node instanceof Element)) {
        continue;
      }
      const key = `${node.tagName}:${node.className}:${normalizeText(node.textContent || "").slice(0, 120)}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      deduped.push(node);
    }

    return deduped.filter((node) => looksLikeChoiceItem(node));
  }

  function resolveChoiceItemContainer(node) {
    if (!(node instanceof Element)) {
      return null;
    }

    if (node.matches("input[type='radio'], input[type='checkbox']")) {
      return (
        node.closest(
          "li, label, [role='radio'], [role='checkbox'], .el-radio, .el-checkbox, .ant-radio-wrapper, .ant-checkbox-wrapper, .option-item, .answer-item",
        ) ||
        node.parentElement ||
        node
      );
    }

    return node.closest("li, label, [role='radio'], [role='checkbox'], .option-item, .answer-item") || node;
  }

  function looksLikeChoiceItem(node) {
    if (!(node instanceof Element)) {
      return false;
    }

    const normalizedText = normalizeText(node.textContent || "").replace(/\s+/g, "");
    if (!normalizedText) {
      return false;
    }

    const looksLikeLabelText =
      /^[A-D][\.\、:：\)\）]/i.test(normalizedText) ||
      /^(对|错|正确|错误|TRUE|FALSE)/i.test(normalizedText);
    if (looksLikeLabelText) {
      return true;
    }

    const className = String(node.className || "").toLowerCase();
    const mayBeChoiceClass = /(radio|checkbox|option|answer|choice|select|item)/.test(className);
    if (!mayBeChoiceClass) {
      return false;
    }

    return /[A-D][\.\、:：\)\）]/i.test(normalizedText) || /(对|错|正确|错误|TRUE|FALSE)/i.test(normalizedText);
  }

  function simulateUserClick(element, options = {}) {
    if (!(element instanceof Element)) {
      return false;
    }
    const target = resolveClickableTarget(element);
    if (!(target instanceof HTMLElement)) {
      return false;
    }
    const useNativeClick = Boolean(options.useNativeClick);

    for (const type of ["mouseover", "mousedown", "mouseup", "click"]) {
      target.dispatchEvent(
        new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          view: window,
        }),
      );
    }
    if (useNativeClick) {
      target.click?.();
    }
    return true;
  }

  function simulateDirectUserClick(element, options = {}) {
    if (!(element instanceof Element)) {
      return false;
    }

    const target = element instanceof HTMLElement ? element : element.parentElement;
    if (!(target instanceof HTMLElement)) {
      return false;
    }

    target.scrollIntoView?.({ block: "center", inline: "center", behavior: "instant" });
    const rect = target.getBoundingClientRect();
    const clientX = rect.left + Math.max(1, Math.min(rect.width - 1, rect.width / 2 || 1));
    const clientY = rect.top + Math.max(1, Math.min(rect.height - 1, rect.height / 2 || 1));
    const common = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      clientX,
      clientY,
      button: 0,
    };

    if (typeof PointerEvent === "function") {
      for (const type of ["pointerover", "pointerenter", "pointerdown", "pointerup"]) {
        target.dispatchEvent(
          new PointerEvent(type, {
            ...common,
            pointerId: 1,
            pointerType: "mouse",
            isPrimary: true,
          }),
        );
      }
    }

    for (const type of ["mouseover", "mouseenter", "mousedown", "mouseup", "click"]) {
      target.dispatchEvent(new MouseEvent(type, common));
    }

    if (options.useNativeClick) {
      target.click?.();
    }
    return true;
  }

  function resolveClickableTarget(element) {
    if (!(element instanceof Element)) {
      return null;
    }

    const choiceTarget = element.closest(
      "input[type='checkbox'], input[type='radio'], label, [role='checkbox'], [role='radio'], .el-radio, .el-checkbox, .ant-radio-wrapper, .ant-checkbox-wrapper, .checkIcon",
    );
    if (choiceTarget instanceof Element) {
      return choiceTarget;
    }

    return (
      element.closest(
        ".next-topic, .reviewDone, .ZHIHUISHU_QZMD, button.next-topic, button.reviewDone, [role='button']",
      ) || element
    );
  }

  function clickNextQuestionButton() {
    const nextButton = findNextQuestionButton();
    if (!(nextButton instanceof Element) || isElementDisabledLike(nextButton)) {
      return false;
    }
    return simulateUserClick(nextButton, { useNativeClick: false });
  }

  function findNextQuestionButton() {
    const candidates = [
      ".next-topic.next-t",
      "span.next-topic.next-t",
      ".next-topic",
      "button.next-topic",
      ".pre-next .next-t",
    ];

    for (const selector of candidates) {
      const target = firstVisible([selector]);
      if (!(target instanceof Element)) {
        continue;
      }
      const text = normalizeText(target.textContent || "");
      if (!text || /下一题|下一个|next/i.test(text)) {
        return target;
      }
    }

    const textFallback = Array.from(document.querySelectorAll("span,button,a,div")).find((node) => {
      const text = normalizeText(node.textContent || "");
      return /^(下一题|下一个|Next)$/i.test(text);
    });
    return textFallback instanceof Element ? textFallback : null;
  }

  function findSubmitHomeworkButton() {
    const preferredSelectors = [
      ".reviewDone.ZHIHUISHU_QZMD",
      ".reviewDone",
      "span.reviewDone.ZHIHUISHU_QZMD",
      ".right-H .reviewDone.ZHIHUISHU_QZMD",
      ".header-content .right-H:nth-of-type(2) .reviewDone.ZHIHUISHU_QZMD",
      ".header-content .right-H .reviewDone",
      "[class*='reviewDone']",
    ];

    for (const selector of preferredSelectors) {
      const target = firstVisible([selector]);
      if (target instanceof Element && isVisible(target)) {
        return target;
      }
    }

    const textPatterns = [/提交作业/, /提交考试/, /提交试卷/, /交卷/, /^提交$/];
    const candidates = Array.from(document.querySelectorAll("span,button,a,div"));
    return (
      candidates.find((node) => {
        if (!(node instanceof HTMLElement) || !isVisible(node)) {
          return false;
        }
        const text = normalizeText(node.innerText || node.textContent || "");
        return textPatterns.some((pattern) => pattern.test(text));
      }) || null
    );
  }

  function isElementDisabledLike(element) {
    if (!(element instanceof HTMLElement)) {
      return true;
    }

    if ("disabled" in element && element.disabled) {
      return true;
    }

    const ariaDisabled = String(element.getAttribute("aria-disabled") || "").toLowerCase();
    if (ariaDisabled === "true") {
      return true;
    }

    const className = `${element.className || ""} ${element.parentElement?.className || ""}`;
    if (/(^|\s)(disabled|is-disabled|btn-disabled|forbid|ban)(\s|$)/i.test(className)) {
      return true;
    }

    const style = window.getComputedStyle(element);
    if (style.pointerEvents === "none" || style.visibility === "hidden" || style.display === "none") {
      return true;
    }
    if (style.cursor === "not-allowed") {
      return true;
    }
    if (Number.parseFloat(style.opacity || "1") <= 0.45) {
      return true;
    }
    if (looksLikeGrayDisabledButton(style)) {
      return true;
    }

    return false;
  }

  function looksLikeGrayDisabledButton(style) {
    const backgroundColor = parseCssRgb(style.backgroundColor);
    const color = parseCssRgb(style.color);
    if (!backgroundColor || !color) {
      return false;
    }

    const backgroundIsGray =
      Math.abs(backgroundColor.r - backgroundColor.g) <= 14 &&
      Math.abs(backgroundColor.g - backgroundColor.b) <= 14 &&
      backgroundColor.r >= 190;
    const textIsGray =
      Math.abs(color.r - color.g) <= 18 &&
      Math.abs(color.g - color.b) <= 18 &&
      color.r >= 120;
    return backgroundIsGray && textIsGray;
  }

  function parseCssRgb(value) {
    const match = String(value || "").match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
    if (!match) {
      return null;
    }
    return {
      r: Number(match[1]),
      g: Number(match[2]),
      b: Number(match[3]),
    };
  }

  function hasStrongSubmitHomeworkButton() {
    return Boolean(
      firstVisible([
        ".reviewDone.ZHIHUISHU_QZMD",
        "span.reviewDone.ZHIHUISHU_QZMD",
        ".header-content .right-H:nth-of-type(2) .reviewDone.ZHIHUISHU_QZMD",
      ]),
    );
  }

  function isLikelyLastQuestionState() {
    const nextButton = findNextQuestionButton();
    const submitButton = findSubmitHomeworkButton();
    if (!(submitButton instanceof Element)) {
      return false;
    }
    if (!(nextButton instanceof Element)) {
      return true;
    }
    return isElementDisabledLike(nextButton);
  }

  async function advanceToNextQuestionOrSubmit(previousFingerprint, runToken) {
    const nextButton = findNextQuestionButton();
    const submitButton = findSubmitHomeworkButton();

    if (isLikelyLastQuestionState()) {
      if (!simulateUserClick(submitButton)) {
        return { ok: false, action: "submit-failed", error: "已经到最后一题，但提交作业按钮无法点击。" };
      }
      return { ok: true, action: "submit" };
    }

    if (!(nextButton instanceof Element)) {
      if (submitButton instanceof Element && simulateUserClick(submitButton)) {
        return { ok: true, action: "submit" };
      }
      return { ok: false, action: "missing-next", error: "没有找到“下一题”按钮。" };
    }

    if (!simulateUserClick(nextButton)) {
      return { ok: false, action: "next-click-failed", error: "“下一题”按钮点击失败。" };
    }

    const pageChanged = await waitForNextQuestion(previousFingerprint, runToken);
    if (pageChanged) {
      return { ok: true, action: "next" };
    }

    const afterNextButton = findNextQuestionButton();
    const afterSubmitButton = findSubmitHomeworkButton();
    const nextDisabled = afterNextButton instanceof Element && isElementDisabledLike(afterNextButton);
    if ((nextDisabled || !(afterNextButton instanceof Element)) && afterSubmitButton instanceof Element) {
      if (!simulateUserClick(afterSubmitButton)) {
        return { ok: false, action: "submit-failed", error: "疑似已经到最后一题，但提交作业按钮点击失败。" };
      }
      return { ok: true, action: "submit" };
    }

    if (afterSubmitButton instanceof Element && hasStrongSubmitHomeworkButton()) {
      if (!simulateUserClick(afterSubmitButton)) {
        return { ok: false, action: "submit-failed", error: "检测到提交作业按钮，但点击提交失败。" };
      }
      return { ok: true, action: "submit" };
    }

    return {
      ok: false,
      action: "stalled",
      error: "点击“下一题”后页面没有明显变化，且未满足最后一题提交条件。",
    };
  }

  async function handleOpenSettings() {
    try {
      const response = await sendMessage({ type: "autolearning:open-options" });
      if (!response?.ok) {
        throw new Error(response?.error || "无法打开设置页");
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function hydrateInlineSettings() {
    try {
      const settings = await getCurrentSettings();
      applySettings(settings);
      await refreshPromptPreview({ silent: true });
      await refreshHistory({ silent: true });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function getCurrentSettings() {
    const response = await sendMessage({ type: "autolearning:get-settings" });
    if (!response?.ok) {
      throw new Error(response?.error || "读取设置失败");
    }
    return response.settings || {};
  }

  function applySettings(settings) {
    state.settings = {
      ...state.settings,
      ...settings,
      promptMode: sanitizePromptMode(settings?.promptMode ?? state.settings.promptMode),
      fullAutoMode: sanitizeFullAutoMode(settings?.fullAutoMode ?? state.settings.fullAutoMode),
      extraInstructionsChoice:
        String(settings?.extraInstructionsChoice || state.settings.extraInstructionsChoice || DEFAULT_CHOICE_PROMPT).trim() ||
        DEFAULT_CHOICE_PROMPT,
      extraInstructionsCode:
        String(settings?.extraInstructionsCode || state.settings.extraInstructionsCode || DEFAULT_CODE_PROMPT).trim() ||
        DEFAULT_CODE_PROMPT,
      screenshotShortcut:
        normalizeShortcut(settings?.screenshotShortcut) || state.settings.screenshotShortcut,
      fullPageScreenshotShortcut:
        normalizeShortcut(settings?.fullPageScreenshotShortcut) ||
        state.settings.fullPageScreenshotShortcut,
      fullAutoShortcut:
        normalizeShortcut(settings?.fullAutoShortcut) || state.settings.fullAutoShortcut,
      autoSubmitAfterFullCapture: Boolean(
        settings?.autoSubmitAfterFullCapture ?? state.settings.autoSubmitAfterFullCapture,
      ),
      autoPickNextDelayMs: normalizeAutoPickDelay(
        settings?.autoPickNextDelayMs ?? state.settings.autoPickNextDelayMs,
      ),
      fullAutoNextDelayMs: normalizeFullAutoDelay(
        settings?.fullAutoNextDelayMs ?? state.settings.fullAutoNextDelayMs,
      ),
    };
    renderShortcutTip();
    syncPromptModeUi();
    syncFullAutoModeUi();
  }

  function handleStorageChanged(changes, areaName) {
    if (areaName !== "local") {
      return;
    }

    const nextSettings = {};
    if (changes.promptMode) {
      nextSettings.promptMode = changes.promptMode.newValue;
    }
    if (changes.fullAutoMode) {
      nextSettings.fullAutoMode = changes.fullAutoMode.newValue;
    }
    if (changes.extraInstructionsChoice) {
      nextSettings.extraInstructionsChoice = changes.extraInstructionsChoice.newValue || "";
    }
    if (changes.extraInstructionsCode) {
      nextSettings.extraInstructionsCode = changes.extraInstructionsCode.newValue || "";
    }
    if (changes.extraInstructions && !changes.extraInstructionsCode && !changes.extraInstructionsChoice) {
      nextSettings.extraInstructionsCode = changes.extraInstructions.newValue || "";
    }
    if (changes.includeScreenshotInSolver) {
      nextSettings.includeScreenshotInSolver = Boolean(changes.includeScreenshotInSolver.newValue);
    }
    if (changes.autoSolveAfterCapture) {
      nextSettings.autoSolveAfterCapture = Boolean(changes.autoSolveAfterCapture.newValue);
    }
    if (changes.screenshotShortcut) {
      nextSettings.screenshotShortcut =
        normalizeShortcut(changes.screenshotShortcut.newValue) || state.settings.screenshotShortcut;
    }
    if (changes.fullPageScreenshotShortcut) {
      nextSettings.fullPageScreenshotShortcut =
        normalizeShortcut(changes.fullPageScreenshotShortcut.newValue) ||
        state.settings.fullPageScreenshotShortcut;
    }
    if (changes.fullAutoShortcut) {
      nextSettings.fullAutoShortcut =
        normalizeShortcut(changes.fullAutoShortcut.newValue) || state.settings.fullAutoShortcut;
    }
    if (changes.autoSubmitAfterFullCapture) {
      nextSettings.autoSubmitAfterFullCapture = Boolean(changes.autoSubmitAfterFullCapture.newValue);
    }
    if (changes.autoPickNextDelayMs) {
      nextSettings.autoPickNextDelayMs = normalizeAutoPickDelay(changes.autoPickNextDelayMs.newValue);
    }
    if (changes.fullAutoNextDelayMs) {
      nextSettings.fullAutoNextDelayMs = normalizeFullAutoDelay(changes.fullAutoNextDelayMs.newValue);
    }

    if (Object.keys(nextSettings).length === 0) {
      return;
    }

    applySettings(nextSettings);
    syncPromptModeUi();
    syncFullAutoModeUi();
    void refreshPromptPreview({ silent: true });
  }

  async function refreshHistory(options = {}) {
    const silent = Boolean(options.silent);

    try {
      const response = await sendMessage({ type: "autolearning:get-history" });
      if (!response?.ok) {
        throw new Error(response?.error || "读取记录失败");
      }

      state.history = Array.isArray(response.history) ? response.history : [];
      renderHistory(state.history);
      if (!silent) {
        setStatus("已刷新搜题记录。");
      }
    } catch (error) {
      state.history = [];
      renderHistory([]);
      if (!silent) {
        setStatus(error instanceof Error ? error.message : String(error));
      }
    }
  }

  async function handleClearHistory() {
    try {
      const response = await sendMessage({ type: "autolearning:clear-history" });
      if (!response?.ok) {
        throw new Error(response?.error || "清空记录失败");
      }

      state.history = [];
      renderHistory([]);
      setStatus("搜题记录已清空。");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleExportHistoryMarkdown() {
    const history = Array.isArray(state.history) && state.history.length > 0
      ? state.history
      : await loadHistoryForExport();

    if (!Array.isArray(history) || history.length === 0) {
      setStatus("还没有搜题记录可导出。");
      return;
    }

    const markdown = buildHistoryMarkdown(history);
    const exportedAt = new Date().toISOString().slice(0, 10);
    downloadTextFile(`autolearning-history-${exportedAt}.md`, markdown, "text/markdown;charset=utf-8");
    setStatus("搜题记录已导出为 Markdown。");
  }

  async function loadHistoryForExport() {
    const response = await sendMessage({ type: "autolearning:get-history" });
    if (!response?.ok) {
      throw new Error(response?.error || "读取记录失败");
    }
    const history = Array.isArray(response.history) ? response.history : [];
    state.history = history;
    renderHistory(history);
    return history;
  }

  async function refreshPromptPreview(options = {}) {
    const silent = Boolean(options.silent);
    const mode = getPromptMode();

    try {
      if (!state.problem && mode === "choice") {
        renderPromptPreview("选择题模式不会自动提取题面，请先点击“提取题面”。");
        if (!silent) {
          setStatus("选择题模式不会自动提取题面。");
        }
        return;
      }

      const problem = state.problem || (await extractProblem());
      state.problem = problem;
      renderProblem(problem);

      const response = await sendMessage({
        type: "autolearning:preview-prompt",
        problem,
        extraInstructions: getStoredExtraInstructions(),
      });

      if (!response?.ok) {
        throw new Error(response?.error || "预览生成失败");
      }

      state.promptPreview = response.preview;
      renderPromptPreview(formatPromptPreview(response.preview));

      if (!silent) {
        setStatus("已刷新发送给 AI 的内容预览。");
      }
    } catch (error) {
      renderPromptPreview("预览生成失败。");
      if (!silent) {
        setStatus(error instanceof Error ? error.message : String(error));
      }
    }
  }

  async function handleCopyPromptPreview() {
    const previewText = elements.promptPreview?.textContent || "";
    if (!previewText || previewText === "还没有可预览的内容。") {
      setStatus("还没有可复制的预览内容。");
      return;
    }

    if (await copyTextToClipboard(previewText)) {
      setStatus("预览内容已复制到剪贴板。");
    } else {
      setStatus("复制预览失败，请手动选择。");
    }
  }

  function formatPromptPreview(preview) {
    return [
      `模型：${preview?.model || "未知"}`,
      `提示词模式：${preview?.promptMode === "choice" ? "选择题" : "代码题"}`,
      `温度：${preview?.temperature ?? "未知"}`,
      `额外提示词：${preview?.extraInstructions || "[空]"}`,
      `直接发图：${preview?.hasImage ? "是" : "否"}`,
      `附带 OCR：${preview?.hasOcr ? "是" : "否"}`,
      "",
      "[System Prompt]",
      preview?.system || "[空]",
      "",
      "[User Prompt]",
      preview?.user || "[空]",
    ].join("\n");
  }

  function renderPromptPreview(text) {
    if (elements.promptPreview) {
      elements.promptPreview.textContent = text;
    }
  }

  function renderChoiceAnswer(text) {
    const mode = getPromptMode();
    const value = String(text || "").trim();
    if (elements.choiceAnswerWrap) {
      elements.choiceAnswerWrap.hidden = mode !== "choice";
    }
    if (elements.codeWrap) {
      elements.codeWrap.hidden = mode === "choice";
    }
    if (elements.choiceAnswer) {
      elements.choiceAnswer.textContent = value || "还没有生成答案。";
    }
  }

  function renderGeneratedTitle(text) {
    if (elements.generatedTitle) {
      elements.generatedTitle.textContent = text || "还没有 AI 标题。";
    }
  }

  function renderCurrentClassification(result) {
    if (elements.problemType) {
      elements.problemType.textContent = result?.problemType || "还没有题型分类。";
    }
    if (elements.problemDefinition) {
      elements.problemDefinition.textContent = result?.problemDefinition || "还没有问题定义。";
    }
  }

  function renderHistory(history) {
    if (!elements.historyList) {
      return;
    }

    if (!Array.isArray(history) || history.length === 0) {
      elements.historyList.textContent = "还没有搜题记录。";
      return;
    }

      elements.historyList.innerHTML = history
      .map((item) => {
        const title = escapeHtml(item.generatedTitle || item.title || "未命名题目");
        const sourceTitle = escapeHtml(item.sourceTitle || "");
        const problemType = escapeHtml(item.problemType || "未分类");
        const definition = escapeHtml(item.problemDefinition || "没有问题定义。");
        const approach = escapeHtml(item.approach || "没有保存解题思路。");
        const savedAt = escapeHtml(formatDateTime(item.savedAt));
        const model = escapeHtml(item.model || "未知模型");
        const language = escapeHtml(item.language || "未知语言");
        const pageUrl = String(item.pageUrl || "").trim();

        return `
          <article class="al-history-item">
            <div class="al-history-meta">
              <strong>${title}</strong>
              <span>${savedAt}</span>
            </div>
            ${sourceTitle ? `<p class="al-history-text"><b>页面标题：</b>${sourceTitle}</p>` : ""}
            <div class="al-history-tags">
              <span>${problemType}</span>
              <span>${language}</span>
              <span>${model}</span>
            </div>
            <p class="al-history-text"><b>问题定义：</b>${definition}</p>
            <p class="al-history-text"><b>解题思路：</b>${approach}</p>
            ${
              pageUrl
                ? `<a class="al-history-link" href="${escapeHtml(pageUrl)}" target="_blank" rel="noreferrer">打开原题</a>`
                : ""
            }
          </article>
        `;
      })
      .join("");
  }

  function buildHistoryMarkdown(history) {
    const lines = [
      "# AutoLearning 搜题记录",
      "",
      `导出时间：${formatDateTime(new Date().toISOString())}`,
      `记录数量：${history.length}`,
      "",
      "---",
      "",
    ];

    history.forEach((item, index) => {
      const title = String(item.generatedTitle || item.title || "未命名题目").trim();
      const sourceTitle = String(item.sourceTitle || "").trim();
      const pageUrl = String(item.pageUrl || "").trim();
      const problemType = String(item.problemType || "未分类").trim();
      const problemDefinition = String(item.problemDefinition || "没有问题定义。").trim();
      const approach = String(item.approach || "没有保存解题思路。").trim();
      const summary = String(item.summary || "").trim();
      const model = String(item.model || "未知模型").trim();
      const language = String(item.language || "未知语言").trim();
      const code = String(item.code || "");

      lines.push(`## ${index + 1}. ${title}`);
      lines.push("");
      lines.push(`- 保存时间：${formatDateTime(item.savedAt)}`);
      lines.push(`- 原题链接：${pageUrl || "无"}`);
      if (sourceTitle) {
        lines.push(`- 页面标题：${sourceTitle}`);
      }
      lines.push(`- 题型分类：${problemType}`);
      lines.push(`- 编程语言：${language}`);
      lines.push(`- 使用模型：${model}`);
      if (summary) {
        lines.push(`- 结果总结：${summary}`);
      }
      lines.push("");
      lines.push("### 问题定义");
      lines.push("");
      lines.push(problemDefinition);
      lines.push("");
      lines.push("### 解题思路");
      lines.push("");
      lines.push(approach);
      lines.push("");
      lines.push("### 代码");
      lines.push("");
      lines.push("```");
      lines.push(code);
      lines.push("```");
      lines.push("");
      lines.push("---");
      lines.push("");
    });

    return lines.join("\n");
  }

  function renderShortcutTip() {
    if (elements.shortcutTip) {
      elements.shortcutTip.textContent =
        `框选 ${state.settings.screenshotShortcut} / 固定区 ${state.settings.fullPageScreenshotShortcut} / 全自动 ${state.settings.fullAutoShortcut}${
          state.fixedCaptureRegion ? " 已设定" : " 未设定"
        }`;
    }
  }

  function renderFullAutoButton() {
    if (!(elements.fullAutoButton instanceof HTMLButtonElement)) {
      return;
    }

    elements.fullAutoButton.textContent = state.fullAutoRunning ? "停止全自动" : "开启全自动";
    elements.fullAutoButton.setAttribute("data-running", state.fullAutoRunning ? "true" : "false");
    elements.fullAutoButton.classList.toggle("al-primary", !state.fullAutoRunning);
  }

  function renderScreenshotStatus(problem) {
    if (!elements.screenshotStatus) {
      return;
    }

    const screenshotItems = getProblemScreenshotItems(problem);
    renderScreenshotBufferButton(screenshotItems.length > 0);
    if (screenshotItems.length > 1) {
      const ocrReadyCount = screenshotItems.filter((item) => item.ocrText).length;
      const directImageCount = screenshotItems.filter((item) => item.ocrSkipped).length;
      const modeText = screenshotItems[0]?.mode === "fixedRegion" ? "固定区域截图" : "题面截图";
      if (directImageCount === screenshotItems.length) {
        elements.screenshotStatus.textContent = `已缓冲 ${screenshotItems.length} 张${modeText}，提交时会一并发给 AI，不会自动提交。`;
        return;
      }
      if (ocrReadyCount === screenshotItems.length) {
        elements.screenshotStatus.textContent = `已缓冲 ${screenshotItems.length} 张${modeText}，OCR 文本已准备好，等待你手动提交。`;
        return;
      }
      elements.screenshotStatus.textContent = `已缓冲 ${screenshotItems.length} 张${modeText}，其中 ${ocrReadyCount} 张已完成 OCR。`;
      return;
    }

    if (problem?.screenshotDataUrl) {
      if (problem?.ocrSkipped) {
        elements.screenshotStatus.textContent =
          problem?.screenshotMode === "fixedRegion"
            ? "已截取固定区域截图，生成时将直接发送图片，不再调用 OCR。"
            : "已截取题面截图，生成时将直接发送图片，不再调用 OCR。";
        return;
      }

      elements.screenshotStatus.textContent = problem?.ocrText
        ? problem?.screenshotMode === "fixedRegion"
          ? "已截取固定区域截图，并已转写为 OCR 文本。"
          : "已截取题面截图，并已转写为 OCR 文本。"
        : problem?.screenshotMode === "fixedRegion"
          ? "已截取固定区域截图，等待 OCR 转写。"
          : "已截取题面截图，等待 OCR 转写。";
      return;
    }

    elements.screenshotStatus.textContent = "还没有附带题面截图。";
  }

  function renderScreenshotBufferButton(visible) {
    if (!(elements.clearScreenshotBuffer instanceof HTMLButtonElement)) {
      return;
    }

    elements.clearScreenshotBuffer.hidden = !visible;
  }

  function renderOcrText(text) {
    if (!elements.ocrText) {
      return;
    }

    elements.ocrText.textContent = text || "还没有 OCR 结果。";
  }

  function getProblemScreenshotItems(problem) {
    if (!Array.isArray(problem?.screenshotItems)) {
      return [];
    }

    return problem.screenshotItems.filter(
      (item) => item && typeof item.dataUrl === "string" && item.dataUrl.startsWith("data:image/"),
    );
  }

  function createScreenshotItem({ dataUrl, rect, mode, ocrText = "", ocrModel = "", ocrSkipped = false }) {
    return {
      id: `shot-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      dataUrl,
      rect,
      mode,
      ocrText: String(ocrText || ""),
      ocrModel: String(ocrModel || ""),
      ocrSkipped: Boolean(ocrSkipped),
      capturedAt: new Date().toISOString(),
    };
  }

  function mergeScreenshotData(problem, screenshotItems) {
    const items = Array.isArray(screenshotItems) ? screenshotItems.filter(Boolean) : [];
    const latest = items[items.length - 1] || null;
    const mergedOcrText = items
      .map((item, index) => {
        const text = normalizeText(item?.ocrText || "");
        if (!text) {
          return "";
        }
        return items.length > 1 ? `第 ${index + 1} 张截图 OCR：\n${text}` : text;
      })
      .filter(Boolean)
      .join("\n\n");

    return {
      ...problem,
      screenshotItems: items,
      screenshotDataUrl: latest?.dataUrl || "",
      screenshotRect: latest?.rect || null,
      screenshotMode: latest?.mode || "",
      ocrText: mergedOcrText,
      ocrModel: items.map((item) => item?.ocrModel || "").filter(Boolean).join(", "),
      ocrSkipped: items.length > 0 ? items.every((item) => item?.ocrSkipped) : false,
    };
  }

  function clearScreenshotData(problem) {
    return {
      ...problem,
      screenshotItems: [],
      screenshotDataUrl: "",
      screenshotRect: null,
      screenshotMode: "",
      ocrText: "",
      ocrModel: "",
      ocrSkipped: false,
    };
  }

  function sanitizePromptMode(value) {
    return value === "choice" ? "choice" : "code";
  }

  function sanitizeFullAutoMode(value) {
    return value === "capture" ? "capture" : "extract";
  }

  function getPromptMode() {
    return sanitizePromptMode(state.settings.promptMode);
  }

  function getFullAutoMode() {
    return sanitizeFullAutoMode(state.settings.fullAutoMode);
  }

  function getPromptStorageKey(mode) {
    return sanitizePromptMode(mode) === "choice"
      ? "extraInstructionsChoice"
      : "extraInstructionsCode";
  }

  function getPromptValueByMode(mode) {
    return sanitizePromptMode(mode) === "choice"
      ? String(state.settings.extraInstructionsChoice || DEFAULT_CHOICE_PROMPT).trim()
      : String(state.settings.extraInstructionsCode || DEFAULT_CODE_PROMPT).trim();
  }

  function syncPromptModeUi() {
    const mode = getPromptMode();
    if (elements.promptModeChoice) {
      elements.promptModeChoice.setAttribute("data-active", mode === "choice" ? "true" : "false");
    }
    if (elements.promptModeCode) {
      elements.promptModeCode.setAttribute("data-active", mode === "code" ? "true" : "false");
    }
    renderChoiceAnswer(mode === "choice" ? state.result?.answer || state.result?.code || "" : "");
    renderFullAutoButton();
  }

  function syncFullAutoModeUi() {
    const mode = getFullAutoMode();
    if (elements.fullAutoModeCapture) {
      elements.fullAutoModeCapture.setAttribute("data-active", mode === "capture" ? "true" : "false");
    }
    if (elements.fullAutoModeExtract) {
      elements.fullAutoModeExtract.setAttribute("data-active", mode === "extract" ? "true" : "false");
    }
    if (elements.fullAutoModeSummary) {
      elements.fullAutoModeSummary.textContent =
        mode === "capture"
          ? "截图全自动会使用固定区域截图继续答题，适合页面题面不容易直接提取时使用。"
          : "提取题面全自动会直接读取页面题干和选项文本，不使用 OCR，适合纯文本模型。";
    }
    renderFullAutoButton();
  }

  function getStoredExtraInstructions() {
    return getPromptValueByMode(getPromptMode());
  }

  async function handlePromptModeSwitch(mode) {
    const nextMode = sanitizePromptMode(mode);
    const currentMode = getPromptMode();
    if (nextMode === currentMode) {
      return;
    }

    const currentValue = getPromptValueByMode(currentMode);
    const currentStorageKey = getPromptStorageKey(currentMode);
    const nextStorageKey = getPromptStorageKey(nextMode);

    state.settings[currentStorageKey] = currentValue || getPromptValueByMode(currentMode);
    state.settings.promptMode = nextMode;
    syncPromptModeUi();

    try {
      await storageSet({
        promptMode: nextMode,
        [currentStorageKey]: state.settings[currentStorageKey],
        [nextStorageKey]: getPromptValueByMode(nextMode),
      });
      await refreshPromptPreview({ silent: true });
      setStatus(`已切换到${nextMode === "choice" ? "选择题" : "代码题"}提示词模式。`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleFullAutoModeSwitch(mode) {
    const nextMode = sanitizeFullAutoMode(mode);
    const currentMode = getFullAutoMode();
    if (nextMode === currentMode) {
      return;
    }

    state.settings.fullAutoMode = nextMode;
    syncFullAutoModeUi();

    try {
      await storageSet({
        fullAutoMode: nextMode,
      });
      setStatus(`已切换到${nextMode === "capture" ? "截图全自动" : "提取题面全自动"}。`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleCaptureScreenshot() {
    return handleCaptureImageFlow({
      mode: "selection",
      appendToBuffer: true,
      respectAutoSolveSetting: false,
    });
  }

  async function handleDefineFixedCaptureRegion() {
    openPanel();
    setStatus("请框选一个固定截图区域，后续快捷键会直接使用它。");

    try {
      const rect = await selectScreenshotArea("拖拽设定固定截图区域，松开保存，Esc 取消");
      if (!rect) {
        setStatus("已取消固定区域设定。");
        return;
      }

      await persistFixedCaptureRegion(rect);
      state.fixedCaptureRegion = rectToStoredCaptureRegion(rect);
      renderShortcutTip();
      setStatus("固定截图区域已保存。之后按固定区快捷键会直接截这里。");
      showToast("固定区域已经记住了，之后按快捷键就会直接截图并生成。");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleCaptureFullPageScreenshot() {
    return handleCaptureImageFlow({ mode: "fixedRegion", autoSolve: true, autoSubmit: true });
  }

  async function handleClearScreenshotBuffer() {
    if (!state.problem) {
      renderScreenshotBufferButton(false);
      setStatus("当前没有可清空的截图缓冲。");
      return;
    }

    const screenshotItems = getProblemScreenshotItems(state.problem);
    if (screenshotItems.length === 0) {
      renderScreenshotBufferButton(false);
      setStatus("当前没有可清空的截图缓冲。");
      return;
    }

    state.problem = clearScreenshotData(state.problem);
    renderProblem(state.problem);
    renderScreenshotStatus(state.problem);
    renderOcrText("");
    await refreshPromptPreview({ silent: true });
    setStatus("截图缓冲已清空。");
  }

  async function handleCaptureImageFlow(options = {}) {
    openPanel();
    const mode = options.mode === "fixedRegion" ? "fixedRegion" : "selection";
    const promptMode = getPromptMode();
    const autoSolveRequested = Boolean(options.autoSolve);
    const autoSubmitRequested = Boolean(options.autoSubmit);
    const autoNavigate = options.autoNavigate !== false;
    const appendToBuffer = Boolean(options.appendToBuffer);
    const respectAutoSolveSetting = options.respectAutoSolveSetting !== false;
    startBusyStatus(
      mode === "fixedRegion"
        ? "正在使用固定区域截图..."
        : "请框选题面区域，按 Esc 可以取消。",
      mode === "fixedRegion" ? "正在准备固定区域截图。" : "请拖拽选择题面区域。",
    );

    try {
      let rect = null;
      if (mode === "selection") {
        rect = await selectScreenshotArea();
        if (!rect) {
          stopBusyStatus("已取消截图。", "本次没有执行截图。");
          return;
        }
      } else {
        rect = await getOrCreateFixedCaptureRect();
        if (!rect) {
          stopBusyStatus("还没有设定固定截图区域。", "需要先设定固定区域。");
          return;
        }
      }

      setStatus(mode === "fixedRegion" ? "正在截取固定区域图片..." : "正在截取题面图片...");
      const response = await sendMessage({ type: "autolearning:capture-visible-tab" });
      if (!response?.ok || !response.dataUrl) {
        throw new Error(response?.error || "页面截图失败");
      }

      const screenshotDataUrl = await cropImageDataUrl(response.dataUrl, rect);
      const settings = await getCurrentSettings();
      applySettings(settings);
      const useDirectImage = Boolean(state.settings.includeScreenshotInSolver);
      const autoSolveAfterCapture =
        autoSolveRequested ||
        autoSubmitRequested ||
        (respectAutoSolveSetting && Boolean(state.settings.autoSolveAfterCapture));
      let problem =
        promptMode === "choice"
          ? createEmptyProblemContext()
          : state.problem || (await extractProblem());
      const existingItems = appendToBuffer ? getProblemScreenshotItems(problem) : [];
      const screenshotItem = createScreenshotItem({
        dataUrl: screenshotDataUrl,
        rect,
        mode,
        ocrSkipped: useDirectImage,
      });
      let screenshotItems = [...existingItems, screenshotItem];
      problem = mergeScreenshotData(problem, screenshotItems);
      state.problem = problem;

      renderProblem(problem);
      renderScreenshotStatus(problem);
      renderOcrText("");
      if (useDirectImage) {
        await refreshPromptPreview({ silent: true });
        stopBusyStatus(
          appendToBuffer
            ? `已缓冲第 ${screenshotItems.length} 张截图。当前设置为直接发图，暂未自动提交。`
            : mode === "fixedRegion"
              ? "固定区域截图完成。当前设置为直接发图，已跳过 OCR。"
              : "截图完成。当前设置为直接发图，已跳过 OCR。",
          appendToBuffer ? "你可以继续截图，准备好后再点提交。" : "截图已完成，这次会直接把图片发给 AI。",
        );
        showToast(
          appendToBuffer
            ? `已加入截图缓冲，当前共 ${screenshotItems.length} 张。`
            : autoSolveAfterCapture
              ? "固定区域截图已完成，准备生成答案。"
              : "这次生成会直接附带截图，不再额外做 OCR。",
        );
        let solveResult = null;
        if (autoSolveAfterCapture) {
          solveResult = await handleSolve({ auto: true, autoNavigate });
        }
        if (autoSubmitRequested && state.settings.autoSubmitAfterFullCapture) {
          await handleAutoSubmit();
        }
        return { ok: true, problem, solveResult };
      }

      setStatus(
        mode === "fixedRegion" ? "固定区域截图完成，正在调用 OCR..." : "截图完成，正在调用 OCR...",
      );

      const ocrResponse = await sendMessage({
        type: "autolearning:run-ocr",
        imageDataUrl: screenshotDataUrl,
      });
      if (!ocrResponse?.ok || !ocrResponse.ocr?.text) {
        throw new Error(ocrResponse?.error || "OCR 识别失败");
      }

      problem.ocrText = ocrResponse.ocr.text;
      screenshotItems[screenshotItems.length - 1] = {
        ...screenshotItems[screenshotItems.length - 1],
        ocrText: ocrResponse.ocr.text,
        ocrModel: ocrResponse.ocr.model || "",
        ocrSkipped: false,
      };
      problem = mergeScreenshotData(problem, screenshotItems);
      state.problem = problem;

      renderProblem(problem);
      renderOcrText(problem.ocrText);
      await refreshPromptPreview({ silent: true });
      stopBusyStatus(
        appendToBuffer
          ? `已缓冲第 ${screenshotItems.length} 张截图，OCR 已完成，暂未自动提交。`
          : mode === "fixedRegion"
            ? "固定区域截图已完成 OCR，接下来生成会把 OCR 文本发进提示词。"
            : "题面截图已完成 OCR，接下来生成会把 OCR 文本发进提示词。",
        appendToBuffer ? "你可以继续截图，准备好后再点提交。" : "OCR 已完成，截图文字已经可用于生成。",
      );
      showToast(
        appendToBuffer
          ? `截图已加入缓冲，当前共 ${screenshotItems.length} 张。`
          : autoSolveAfterCapture
            ? "OCR 已完成，准备生成答案。"
            : "OCR 已完成，接下来生成会直接参考转写后的文本。",
      );
      let solveResult = null;
      if (autoSolveAfterCapture) {
        solveResult = await handleSolve({ auto: true, autoNavigate });
      }
      if (autoSubmitRequested && state.settings.autoSubmitAfterFullCapture) {
        await handleAutoSubmit();
      }
      return { ok: true, problem, solveResult };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      stopBusyStatus(message, "截图或 OCR 流程失败。");
      return {
        ok: false,
        error: message,
      };
    }
  }

  async function handleAutoSubmit() {
    const code = String(elements.code?.value || "");
    if (!hasMeaningfulCode(code)) {
      setStatus("自动提交前没有拿到可填写的代码。");
      return;
    }

    setStatus("正在自动填充代码并提交...");
    const fillResult = await callPageBridge("setEditorValue", { code });
    if (!fillResult?.ok) {
      throw new Error(fillResult?.error || "自动填充失败，无法提交。");
    }

    await delay(250);
    const submitResult = await callPageBridge("submitSolution", {});
    if (!submitResult?.ok) {
      throw new Error(submitResult?.error || "没有找到提交按钮。");
    }

    setStatus(`已自动点击${submitResult.label || "提交"}按钮。`);
    showToast("代码已自动填充，并已尝试提交。");
  }

  async function getOrCreateFixedCaptureRect() {
    const resolved = resolveStoredCaptureRegion(state.fixedCaptureRegion);
    if (resolved) {
      return resolved;
    }

    await handleDefineFixedCaptureRegion();
    return resolveStoredCaptureRegion(state.fixedCaptureRegion);
  }

  async function hydrateFixedCaptureRegion() {
    try {
      const items = await storageGet({
        [FIXED_CAPTURE_STORAGE_KEY]: {},
      });
      const regions = items?.[FIXED_CAPTURE_STORAGE_KEY];
      state.fixedCaptureRegion = normalizeStoredCaptureRegion(
        regions?.[getFixedCaptureScopeKey()] || null,
      );
      renderShortcutTip();
    } catch {
      state.fixedCaptureRegion = null;
      renderShortcutTip();
    }
  }

  async function persistFixedCaptureRegion(rect) {
    const items = await storageGet({
      [FIXED_CAPTURE_STORAGE_KEY]: {},
    });
    const regions =
      items?.[FIXED_CAPTURE_STORAGE_KEY] && typeof items[FIXED_CAPTURE_STORAGE_KEY] === "object"
        ? items[FIXED_CAPTURE_STORAGE_KEY]
        : {};
    const nextRegions = {
      ...regions,
      [getFixedCaptureScopeKey()]: rectToStoredCaptureRegion(rect),
    };
    await storageSet({
      [FIXED_CAPTURE_STORAGE_KEY]: nextRegions,
    });
  }

  function getFixedCaptureScopeKey() {
    return `${location.origin}${location.pathname}`;
  }

  function rectToStoredCaptureRegion(rect) {
    return normalizeStoredCaptureRegion({
      leftRatio: rect.left / Math.max(window.innerWidth, 1),
      topRatio: rect.top / Math.max(window.innerHeight, 1),
      widthRatio: rect.width / Math.max(window.innerWidth, 1),
      heightRatio: rect.height / Math.max(window.innerHeight, 1),
    });
  }

  function normalizeStoredCaptureRegion(region) {
    if (!region || typeof region !== "object") {
      return null;
    }

    const leftRatio = Number(region.leftRatio);
    const topRatio = Number(region.topRatio);
    const widthRatio = Number(region.widthRatio);
    const heightRatio = Number(region.heightRatio);
    if (
      !Number.isFinite(leftRatio) ||
      !Number.isFinite(topRatio) ||
      !Number.isFinite(widthRatio) ||
      !Number.isFinite(heightRatio) ||
      widthRatio <= 0 ||
      heightRatio <= 0
    ) {
      return null;
    }

    return {
      leftRatio: Math.min(Math.max(0, leftRatio), 1),
      topRatio: Math.min(Math.max(0, topRatio), 1),
      widthRatio: Math.min(Math.max(0.02, widthRatio), 1),
      heightRatio: Math.min(Math.max(0.02, heightRatio), 1),
    };
  }

  function resolveStoredCaptureRegion(region) {
    const normalized = normalizeStoredCaptureRegion(region);
    if (!normalized) {
      return null;
    }

    return clampViewportRect({
      left: Math.round(normalized.leftRatio * window.innerWidth),
      top: Math.round(normalized.topRatio * window.innerHeight),
      width: Math.round(normalized.widthRatio * window.innerWidth),
      height: Math.round(normalized.heightRatio * window.innerHeight),
    });
  }

  async function selectScreenshotArea(hintText = "拖拽框选题面区域，松开完成，Esc 取消") {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      const shade = document.createElement("div");
      const selection = document.createElement("div");
      const hint = document.createElement("div");

      overlay.style.cssText = [
        "position:fixed",
        "inset:0",
        "z-index:2147483647",
        "cursor:crosshair",
        "pointer-events:auto",
      ].join(";");
      shade.style.cssText = [
        "position:absolute",
        "inset:0",
        "background:rgba(7,12,18,0.35)",
      ].join(";");
      selection.style.cssText = [
        "position:absolute",
        "border:2px solid #ffb46b",
        "background:rgba(255,180,107,0.18)",
        "display:none",
      ].join(";");
      hint.style.cssText = [
        "position:absolute",
        "top:16px",
        "left:50%",
        "transform:translateX(-50%)",
        "padding:10px 14px",
        "border-radius:999px",
        "font:12px/1.4 IBM Plex Sans, PingFang SC, sans-serif",
        "color:#fff8ef",
        "background:rgba(15,20,24,0.88)",
        "box-shadow:0 12px 28px rgba(6,13,18,0.28)",
      ].join(";");
      hint.textContent = hintText;

      overlay.appendChild(shade);
      overlay.appendChild(selection);
      overlay.appendChild(hint);
      document.documentElement.appendChild(overlay);

      let startX = 0;
      let startY = 0;
      let dragging = false;

      const cleanup = (result) => {
        window.removeEventListener("keydown", onKeyDown, true);
        overlay.removeEventListener("mousedown", onMouseDown, true);
        window.removeEventListener("mousemove", onMouseMove, true);
        window.removeEventListener("mouseup", onMouseUp, true);
        overlay.remove();
        resolve(result);
      };

      const onKeyDown = (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          cleanup(null);
        }
      };

      const onMouseDown = (event) => {
        if (event.button !== 0) {
          return;
        }
        dragging = true;
        startX = event.clientX;
        startY = event.clientY;
        selection.style.display = "block";
        updateSelectionRect(selection, startX, startY, startX, startY);
        event.preventDefault();
      };

      const onMouseMove = (event) => {
        if (!dragging) {
          return;
        }
        updateSelectionRect(selection, startX, startY, event.clientX, event.clientY);
      };

      const onMouseUp = (event) => {
        if (!dragging) {
          return;
        }
        dragging = false;
        const rect = normalizeViewportRect(startX, startY, event.clientX, event.clientY);
        if (rect.width < 24 || rect.height < 24) {
          cleanup(null);
          return;
        }
        cleanup(rect);
      };

      window.addEventListener("keydown", onKeyDown, true);
      overlay.addEventListener("mousedown", onMouseDown, true);
      window.addEventListener("mousemove", onMouseMove, true);
      window.addEventListener("mouseup", onMouseUp, true);
    });
  }

  async function cropImageDataUrl(dataUrl, rect) {
    const image = await loadImage(dataUrl);
    const scaleX = image.naturalWidth / window.innerWidth;
    const scaleY = image.naturalHeight / window.innerHeight;
    const cropX = Math.max(0, Math.round(rect.left * scaleX));
    const cropY = Math.max(0, Math.round(rect.top * scaleY));
    const cropWidth = Math.max(1, Math.round(rect.width * scaleX));
    const cropHeight = Math.max(1, Math.round(rect.height * scaleY));

    const canvas = document.createElement("canvas");
    canvas.width = cropWidth;
    canvas.height = cropHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("截图裁剪失败。");
    }

    context.drawImage(
      image,
      cropX,
      cropY,
      cropWidth,
      cropHeight,
      0,
      0,
      cropWidth,
      cropHeight,
    );
    return canvas.toDataURL("image/png");
  }

  function loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("截图图片加载失败。"));
      image.src = dataUrl;
    });
  }

  function updateSelectionRect(node, x1, y1, x2, y2) {
    const rect = normalizeViewportRect(x1, y1, x2, y2);
    node.style.left = `${rect.left}px`;
    node.style.top = `${rect.top}px`;
    node.style.width = `${rect.width}px`;
    node.style.height = `${rect.height}px`;
  }

  function normalizeViewportRect(x1, y1, x2, y2) {
    return clampViewportRect({
      left: Math.min(x1, x2),
      top: Math.min(y1, y2),
      width: Math.abs(x2 - x1),
      height: Math.abs(y2 - y1),
    });
  }

  function clampViewportRect(rect) {
    const left = Math.min(Math.max(0, Number(rect.left) || 0), Math.max(0, window.innerWidth - 1));
    const top = Math.min(Math.max(0, Number(rect.top) || 0), Math.max(0, window.innerHeight - 1));
    const maxWidth = Math.max(1, window.innerWidth - left);
    const maxHeight = Math.max(1, window.innerHeight - top);

    return {
      left,
      top,
      width: Math.min(Math.max(1, Number(rect.width) || 1), maxWidth),
      height: Math.min(Math.max(1, Number(rect.height) || 1), maxHeight),
    };
  }

  async function handlePasteCode(options = {}) {
    const auto = Boolean(options.auto);
    const mode = getPromptMode();
    const source = auto ? "clipboard-auto" : "clipboard-manual";
    const statusPrefix = auto ? "已自动同步" : "已用";

    if (!auto) {
      openPanel();
    }

    try {
      const clipboardText = normalizeCode(await navigator.clipboard.readText());
      if (!hasMeaningfulCode(clipboardText)) {
        if (!auto) {
          setStatus("剪贴板里没有读取到代码。");
        }
        return { updated: false, text: "" };
      }

      if (!state.problem && mode === "choice") {
        if (!auto) {
          setStatus("选择题模式不会自动提取题面，已跳过剪贴板同步。");
        }
        return { updated: false, text: clipboardText };
      }

      const problem = state.problem || (await extractProblem());
      if (problem.currentCode === clipboardText && problem.currentCodeSource === source) {
        if (!auto) {
          setStatus("剪贴板代码和当前记录一致。");
        }
        return { updated: false, text: clipboardText };
      }

      problem.currentCode = clipboardText;
      problem.currentCodeLineCount = clipboardText.split("\n").length;
      problem.currentCodeSource = source;
      problem.currentCodeDebug = {
        source,
      };

      state.problem = problem;
      markResultReady(false);
      renderProblem(problem);
      await refreshPromptPreview({ silent: true });
      setStatus(`${statusPrefix}剪贴板代码。`);
      if (auto) {
        showToast("代码已提交，正在后台生成答案。");
      }
      return { updated: true, text: clipboardText };
    } catch {
      if (!auto) {
        setStatus("读取剪贴板失败，请先在代码框里全选并复制。");
      }
      return { updated: false, text: "" };
    }
  }

  async function copyTextToClipboard(text) {
    try {
      await navigator.clipboard.writeText(String(text || ""));
      return true;
    } catch {
      return false;
    }
  }

  async function handleDebugExport() {
    openPanel();
    setStatus("正在采集真实页面调试信息...");

    try {
      const debugResponse = await callPageBridge("get-editor-debug", {});
      if (!debugResponse?.ok) {
        throw new Error(debugResponse?.error || "调试信息采集失败");
      }

      const payload = {
        exportedAt: new Date().toISOString(),
        pageUrl: location.href,
        problem: state.problem,
        editorDebug: debugResponse.debug,
      };

      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "autolearning-editor-debug.json";
      anchor.style.display = "none";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 1000);

      setStatus("真实页面调试信息已导出。");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleCopyProblem() {
    if (!state.problem) {
      setStatus("请先识别题面，再复制提取结果。");
      return;
    }

    try {
      await navigator.clipboard.writeText(JSON.stringify(buildProblemExportPayload(), null, 2));
      setStatus("提取结果已复制到剪贴板。");
    } catch {
      setStatus("复制提取结果失败，请改用导出 JSON。");
    }
  }

  async function handleExportProblem() {
    if (!state.problem) {
      setStatus("请先识别题面，再导出 JSON。");
      return;
    }

    const payload = buildProblemExportPayload();
    window.__AUTOLEARNING_LAST_EXPORT_PAYLOAD__ = payload;
    downloadTextFile(
      buildExportFileName(),
      JSON.stringify(payload, null, 2),
      "application/json;charset=utf-8",
    );
    setStatus("提取结果已导出为 JSON。");
  }

  async function extractProblem() {
    const editorResult = await readCurrentCode();
    const zhihuishuQuestion = extractZhihuishuQuestionBlock();
    const titleElement = firstVisible([
      "#task-left-panel .task-header h3",
      "#task-left-panel h3",
      "h1",
      ".questionContent .questionTitle",
      "[class*='problem-title']",
      "[class*='question-title']",
      ".title",
    ]);

    const statementElement = firstVisible([
      "#task-left-panel .markdown-body",
      "#task-left-panel [class*='tab-panel-body']",
      "#task-left-panel",
      "[class*='problem-content']",
      "[class*='question-content']",
      "article",
      "main",
    ]);

    const title = normalizeText(
      zhihuishuQuestion?.title || titleElement?.innerText || document.title || "未识别标题",
    );
    const statementText = normalizeText(
      zhihuishuQuestion?.statementText || statementElement?.innerText || "",
    );
    const statementHtml = zhihuishuQuestion?.statementHtml || statementElement?.innerHTML || "";
    const samples = extractSamples();
    const language = detectLanguage();
    const limits = extractLimits();

    return {
      url: location.href,
      title,
      statementText: statementText.slice(0, 24000),
      statementHtml,
      currentCode: editorResult.text,
      currentCodeLineCount: editorResult.text ? editorResult.text.split("\n").length : 0,
      currentCodeSource: editorResult.source,
      currentCodeDebug: editorResult.debug,
      samples,
      limits: {
        language,
        time: limits.time,
        memory: limits.memory,
      },
      screenshotDataUrl: state.problem?.screenshotDataUrl || "",
      screenshotRect: state.problem?.screenshotRect || null,
      screenshotMode: state.problem?.screenshotMode || "",
      screenshotItems: Array.isArray(state.problem?.screenshotItems) ? state.problem.screenshotItems : [],
      ocrText: state.problem?.ocrText || "",
      ocrModel: state.problem?.ocrModel || "",
      ocrSkipped: Boolean(state.problem?.ocrSkipped),
    };
  }

  function extractZhihuishuQuestionBlock() {
    const questionRoot = firstVisible([
      ".questionContent",
      ".ques-detail .questionContent",
      "div[class*='questionContent']",
    ]);
    if (!(questionRoot instanceof Element)) {
      return null;
    }

    const typeText = normalizeText(
      questionRoot.querySelector(".questionTitle .letterSortNum, .questionTitle")?.textContent || "",
    );
    const stemText = normalizeText(
      questionRoot.querySelector(
        ".questionName .centent-pre .preStyle, .questionName pre.preStyle, .questionName .preStyle, .centent-pre .preStyle",
      )?.textContent || "",
    );
    const optionNodes = Array.from(questionRoot.querySelectorAll(".radio-view li, .checkbox-view li"));
    const options = optionNodes
      .map((item) => {
        const label = normalizeText(item.querySelector(".letterSort")?.textContent || "");
        const value = normalizeText(item.querySelector(".stem, .preStyle")?.textContent || "");
        if (label && value) {
          return `${label} ${value}`;
        }
        const wholeLine = normalizeText(item.textContent || "");
        return wholeLine || "";
      })
      .filter(Boolean);

    if (!stemText && options.length === 0) {
      return null;
    }

    const statementParts = [];
    if (typeText) {
      statementParts.push(typeText);
    }
    if (stemText) {
      statementParts.push(stemText);
    }
    if (options.length > 0) {
      statementParts.push(options.join("\n"));
    }

    return {
      title: [typeText, stemText].filter(Boolean).join(" ").slice(0, 120),
      statementText: statementParts.join("\n"),
      statementHtml: questionRoot.innerHTML || "",
    };
  }

  async function readCurrentCode() {
    const bridgeValue = await callPageBridge("getEditorValue", {});
    if (bridgeValue?.ok && hasMeaningfulCode(bridgeValue.value || "")) {
      return {
        text: normalizeCode(bridgeValue.value || ""),
        source: bridgeValue.meta?.source || "bridge",
        debug: bridgeValue.meta || null,
      };
    }

    const selectors = [
      "#task-right-panel .monaco-editor .view-line",
      ".monaco-editor .view-line",
      ".cm-content",
      "pre code",
    ];

    for (const selector of selectors) {
      const nodes = Array.from(document.querySelectorAll(selector));
      const value = normalizeCode(nodes.map((node) => node.textContent || "").join("\n"));
      if (hasMeaningfulCode(value)) {
        return {
          text: value,
          source: "visible-dom-fallback",
          debug: {
            source: "visible-dom-fallback",
            selector,
          },
        };
      }
    }

    const textarea = document.querySelector(
      "#task-right-panel textarea, textarea:not([readonly]):not([disabled])",
    );
    if (textarea instanceof HTMLTextAreaElement) {
      return {
        text: normalizeCode(textarea.value),
        source: "textarea-fallback",
        debug: {
          source: "textarea-fallback",
        },
      };
    }

    return {
      text: "",
      source: "empty",
      debug: {
        source: "empty",
      },
    };
  }

  function extractSamples() {
    const educoderSamples = Array.from(document.querySelectorAll(".test-case-item___E3CU9"));
    if (educoderSamples.length > 0) {
      return educoderSamples
        .map((item) => {
          const blocks = Array.from(item.querySelectorAll(".diff-panel-container___IpXsK"));
          return {
            input: normalizeText(blocks[0]?.textContent || ""),
            output: normalizeText(blocks[1]?.textContent || ""),
          };
        })
        .filter((sample) => sample.input || sample.output);
    }

    const genericSamples = Array.from(document.querySelectorAll(".sample-test, .sample, .example"));
    return genericSamples
      .map((item) => ({
        input: normalizeText(item.querySelector(".input, .sample-input")?.textContent || ""),
        output: normalizeText(item.querySelector(".output, .sample-output")?.textContent || ""),
      }))
      .filter((sample) => sample.input || sample.output);
  }

  function extractLimits() {
    const text = normalizeText(document.body?.innerText || "").slice(0, 6000);
    const timeMatch = text.match(/(?:时间限制|Time Limit)[:：]?\s*([^\n]+)/i);
    const memoryMatch = text.match(/(?:内存限制|Memory Limit)[:：]?\s*([^\n]+)/i);

    return {
      time: normalizeText(timeMatch?.[1] || ""),
      memory: normalizeText(memoryMatch?.[1] || ""),
    };
  }

  function detectLanguage() {
    const selectors = [
      "#env_1215668_1 span",
      ".item___MSfbI.active___Rkf93 span",
      "[class*='language'] [aria-selected='true']",
      "[class*='lang'] [class*='active']",
    ];

    for (const selector of selectors) {
      const node = document.querySelector(selector);
      const text = normalizeText(node?.textContent || "");
      if (text) {
        return text;
      }
    }

    return "";
  }

  function renderProblem(problem) {
    const statementText = normalizeText(problem.statementText || "");
    const statementHead = summarizeEdgeText(statementText, "start", 48);
    const statementTail = summarizeEdgeText(statementText, "end", 36);
    const screenshotText = problem.screenshotDataUrl
      ? problem.screenshotMode === "fixedRegion"
        ? "已附带固定区域截图"
        : "已附带局部截图"
      : "未附带";

    renderSummaryHtml(`
      <div class="al-summary-card">
        <div class="al-summary-grid">
          ${buildSummaryRow("标题", problem.title || "未识别")}
          ${buildSummaryRow("题面长度", `${statementText.length} 字`)}
          ${buildSummaryRow("当前代码", `${problem.currentCodeLineCount} 行`)}
          ${buildSummaryHint(buildCurrentCodeHint(problem))}
          ${buildSummaryRow("样例数量", `${problem.samples.length}`)}
          ${buildSummaryRow("截图", screenshotText)}
        </div>
        <div class="al-summary-preview">
          <div class="al-summary-preview-card">
            <div class="al-summary-preview-label">题面开头</div>
            <div class="al-summary-preview-text">${escapeHtml(statementHead || "未提取到")}</div>
          </div>
          <div class="al-summary-preview-card">
            <div class="al-summary-preview-label">题面结尾</div>
            <div class="al-summary-preview-text">${escapeHtml(statementTail || "未提取到")}</div>
          </div>
        </div>
      </div>
    `);

    elements.details.textContent = JSON.stringify(problem, null, 2);
    renderScreenshotStatus(problem);
    renderOcrText(problem.ocrText || "");
  }

  function buildSummaryRow(label, value) {
    return `
      <div class="al-summary-row">
        <span class="al-summary-key">${escapeHtml(label)}</span>
        <span class="al-summary-value">${escapeHtml(value)}</span>
      </div>
    `;
  }

  function buildSummaryHint(text) {
    if (!text) {
      return "";
    }

    return `<div class="al-summary-hint">${escapeHtml(text)}</div>`;
  }

  function buildCurrentCodeHint(problem) {
    if (Number(problem.currentCodeLineCount) > 0) {
      return "如果当前代码识别不对，请到右侧编辑器里全选代码后复制到剪贴板，插件就能重新识别原有代码模板。";
    }

    return "当前没有识别到代码模板。如果右侧编辑器其实有代码，请先全选后复制到剪贴板，插件就能重新识别题面和原有代码模板。";
  }

  function summarizeEdgeText(text, side = "start", maxLength = 40) {
    const normalized = normalizeText(text);
    if (!normalized) {
      return "";
    }

    if (normalized.length <= maxLength) {
      return normalized;
    }

    if (side === "end") {
      return `...${normalized.slice(-maxLength)}`;
    }

    return `${normalized.slice(0, maxLength)}...`;
  }

  function createEmptyProblemContext() {
    const limits = extractLimits();
    return {
      url: location.href,
      title: normalizeText(document.title || "未识别标题"),
      statementText: "",
      statementHtml: "",
      currentCode: "",
      currentCodeLineCount: 0,
      currentCodeSource: "empty",
      currentCodeDebug: {
        source: "empty",
      },
      samples: [],
      limits: {
        language: detectLanguage(),
        time: limits.time,
        memory: limits.memory,
      },
      screenshotDataUrl: state.problem?.screenshotDataUrl || "",
      screenshotRect: state.problem?.screenshotRect || null,
      screenshotMode: state.problem?.screenshotMode || "",
      screenshotItems: Array.isArray(state.problem?.screenshotItems) ? state.problem.screenshotItems : [],
      ocrText: state.problem?.ocrText || "",
      ocrModel: state.problem?.ocrModel || "",
      ocrSkipped: Boolean(state.problem?.ocrSkipped),
    };
  }

  function buildProblemExportPayload() {
    return {
      exportedAt: new Date().toISOString(),
      pageUrl: location.href,
      problem: state.problem,
      result: state.result,
    };
  }

  function buildExportFileName() {
    const title = String(state.result?.generatedTitle || state.problem?.title || "autolearning-extract")
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, "-")
      .slice(0, 48);
    return `${title || "autolearning-extract"}.json`;
  }

  function downloadTextFile(filename, text, mimeType) {
    const blob = new Blob([text], {
      type: mimeType,
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 1000);
  }

  function renderSummary(text) {
    elements.summary.textContent = text;
  }

  function renderSummaryHtml(html) {
    elements.summary.innerHTML = html;
  }

  function setStatus(text, options = {}) {
    if (elements.status) {
      elements.status.textContent = text;
    }

    if (typeof options.busy === "boolean") {
      state.statusBusy = options.busy;
    }
    if (typeof options.hint === "string") {
      state.statusHint = options.hint;
    }

    syncStatusIndicator();
  }

  function startBusyStatus(text, hint = "正在处理中，请稍候...") {
    clearStatusHintTimers();
    state.statusBusy = true;
    state.statusHint = hint;
    setStatus(text, { busy: true, hint });

    state.statusHintTimerShort = window.setTimeout(() => {
      if (!state.statusBusy) {
        return;
      }
      state.statusHint = "请求已发出，正在等待 AI 或页面返回结果。";
      syncStatusIndicator();
    }, 6000);

    state.statusHintTimerLong = window.setTimeout(() => {
      if (!state.statusBusy) {
        return;
      }
      state.statusHint = "这次等待有点久，可能是网络较慢，或者模型接口正在排队。";
      syncStatusIndicator();
    }, 15000);
  }

  function stopBusyStatus(text, hint = "已完成，可以继续下一步。") {
    clearStatusHintTimers();
    state.statusBusy = false;
    state.statusHint = hint;
    setStatus(text, { busy: false, hint });
  }

  function clearStatusHintTimers() {
    if (state.statusHintTimerShort) {
      window.clearTimeout(state.statusHintTimerShort);
      state.statusHintTimerShort = 0;
    }
    if (state.statusHintTimerLong) {
      window.clearTimeout(state.statusHintTimerLong);
      state.statusHintTimerLong = 0;
    }
  }

  function syncStatusIndicator() {
    if (elements.statusCard instanceof HTMLElement) {
      elements.statusCard.setAttribute("data-busy", state.statusBusy ? "true" : "false");
    }
    if (elements.statusHint) {
      elements.statusHint.textContent = state.statusHint || "准备就绪";
    }
    renderStatusActionButton();
  }

  function renderStatusActionButton() {
    if (!(elements.statusAction instanceof HTMLButtonElement)) {
      return;
    }

    const isCancel = state.solving;
    elements.statusAction.textContent = isCancel ? "取消" : "提交";
    elements.statusAction.setAttribute("data-variant", isCancel ? "cancel" : "submit");
  }

  async function handleStatusAction() {
    if (state.solving) {
      await cancelCurrentSolve();
      return;
    }

    await handleSolve();
  }

  async function cancelCurrentSolve() {
    if (!state.currentSolveRequestId) {
      return;
    }

    state.solveCancelRequested = true;
    setStatus("正在取消请求...", {
      busy: true,
      hint: "已向后台发送取消指令，请稍候。",
    });

    try {
      await sendMessage({
        type: "autolearning:cancel-solve",
        requestId: state.currentSolveRequestId,
      });
    } catch (error) {
      stopBusyStatus(
        error instanceof Error ? error.message : String(error),
        "取消请求失败，请稍后重试。",
      );
      state.solveCancelRequested = false;
    }
  }

  function initFloatingPosition() {
    void chrome.storage.local.get({ [POSITION_STORAGE_KEY]: null }, (items) => {
      if (chrome.runtime.lastError) {
        state.launcherPosition = getDefaultLauncherPosition();
        syncFloatingUiPosition();
        return;
      }

      state.launcherPosition = sanitizeLauncherPosition(items[POSITION_STORAGE_KEY]);
      if (!state.launcherPosition) {
        state.launcherPosition = getDefaultLauncherPosition();
      }
      syncFloatingUiPosition();
    });
  }

  function getDefaultLauncherPosition() {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const top =
      viewportWidth <= MOBILE_BREAKPOINT
        ? Math.max(18, viewportHeight - LAUNCHER_SIZE - 18)
        : 112;

    return clampLauncherPosition({
      left: viewportWidth - LAUNCHER_SIZE - 18,
      top,
    });
  }

  function sanitizeLauncherPosition(position) {
    if (!position || typeof position !== "object") {
      return null;
    }

    const left = Number(position.left);
    const top = Number(position.top);
    if (!Number.isFinite(left) || !Number.isFinite(top)) {
      return null;
    }

    return clampLauncherPosition({ left, top });
  }

  function clampLauncherPosition(position) {
    const maxLeft = Math.max(8, window.innerWidth - LAUNCHER_SIZE - 8);
    const maxTop = Math.max(8, window.innerHeight - LAUNCHER_SIZE - 8);

    return {
      left: Math.min(Math.max(8, Number(position.left) || 0), maxLeft),
      top: Math.min(Math.max(8, Number(position.top) || 0), maxTop),
    };
  }

  function getPanelMetrics() {
    const panelWidth =
      window.innerWidth <= MOBILE_BREAKPOINT
        ? Math.max(280, window.innerWidth - 20)
        : Math.min(PANEL_MAX_WIDTH, window.innerWidth - 28);
    const panelHeight =
      window.innerWidth <= MOBILE_BREAKPOINT
        ? Math.max(260, window.innerHeight - 108)
        : Math.max(260, window.innerHeight - 194);

    return { panelWidth, panelHeight };
  }

  function getPanelPosition() {
    const { panelWidth, panelHeight } = getPanelMetrics();
    if (state.panelManualPosition) {
      return clampPanelManualPosition(state.panelManualPosition, { panelWidth, panelHeight });
    }

    const launcherPosition = state.launcherPosition || getDefaultLauncherPosition();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let left = launcherPosition.left + LAUNCHER_SIZE - panelWidth;
    left = Math.min(Math.max(10, left), Math.max(10, viewportWidth - panelWidth - 10));

    let top = launcherPosition.top + LAUNCHER_SIZE + PANEL_GAP;
    if (top + panelHeight > viewportHeight - 10) {
      top = launcherPosition.top - panelHeight - PANEL_GAP;
    }
    top = Math.min(Math.max(10, top), Math.max(10, viewportHeight - panelHeight - 10));

    return { left, top, panelWidth, panelHeight };
  }

  function clampPanelManualPosition(position, metrics = getPanelMetrics()) {
    const panelWidth = metrics.panelWidth;
    const panelHeight = metrics.panelHeight;
    const maxLeft = Math.max(window.innerWidth - PANEL_VISIBLE_STRIP, 10);
    const maxTop = Math.max(window.innerHeight - PANEL_VISIBLE_STRIP, 10);

    return {
      left: Math.min(Math.max(-panelWidth + PANEL_VISIBLE_STRIP, Number(position.left) || 0), maxLeft),
      top: Math.min(Math.max(-panelHeight + PANEL_VISIBLE_STRIP, Number(position.top) || 0), maxTop),
      panelWidth,
      panelHeight,
    };
  }

  function syncFloatingUiPosition() {
    if (!elements.launcher || !elements.panel) {
      return;
    }

    const launcherPosition = state.launcherPosition || getDefaultLauncherPosition();
    const panelPosition = getPanelPosition();

    Object.assign(elements.launcher.style, {
      left: `${launcherPosition.left}px`,
      top: `${launcherPosition.top}px`,
      right: "auto",
      bottom: "auto",
    });

    Object.assign(elements.panel.style, {
      left: `${panelPosition.left}px`,
      top: `${panelPosition.top}px`,
      right: "auto",
      bottom: "auto",
      width: `${panelPosition.panelWidth}px`,
      maxHeight: `${panelPosition.panelHeight}px`,
    });
  }

  function persistLauncherPosition() {
    if (!state.launcherPosition) {
      return;
    }

    chrome.storage.local.set({
      [POSITION_STORAGE_KEY]: state.launcherPosition,
    });
  }

  function setupLauncherDrag() {
    elements.launcher.addEventListener("pointerdown", onLauncherPointerDown);
    elements.header?.addEventListener("pointerdown", onPanelPointerDown);
    window.addEventListener("pointermove", onLauncherPointerMove);
    window.addEventListener("pointerup", onLauncherPointerUp);
    window.addEventListener("pointercancel", onLauncherPointerUp);
  }

  function onLauncherPointerDown(event) {
    if (event.button !== 0) {
      return;
    }

    beginFloatingDrag(event, "launcher");
  }

  function onPanelPointerDown(event) {
    if (event.button !== 0 || shouldIgnorePanelDragStart(event.target)) {
      return;
    }

    beginFloatingDrag(event, "panel");
  }

  function beginFloatingDrag(event, source) {
    state.dragPointerId = event.pointerId;
    state.dragSource = source;
    state.dragStartPointer = {
      x: event.clientX,
      y: event.clientY,
    };
    state.dragStartPosition =
      source === "panel"
        ? { ...getPanelPosition() }
        : { ...(state.launcherPosition || getDefaultLauncherPosition()) };
    state.isDraggingLauncher = false;
    state.suppressLauncherClick = false;

    if (source === "launcher") {
      elements.launcher.setPointerCapture?.(event.pointerId);
    } else {
      elements.header?.setPointerCapture?.(event.pointerId);
    }
  }

  function onLauncherPointerMove(event) {
    if (event.pointerId !== state.dragPointerId || !state.dragStartPointer || !state.dragStartPosition) {
      return;
    }

    const deltaX = event.clientX - state.dragStartPointer.x;
    const deltaY = event.clientY - state.dragStartPointer.y;
    if (!state.isDraggingLauncher) {
      const distance = Math.hypot(deltaX, deltaY);
      if (distance < DRAG_THRESHOLD) {
        return;
      }
      state.isDraggingLauncher = true;
    }

    if (state.dragSource === "panel") {
      state.panelManualPosition = clampPanelManualPosition({
        left: state.dragStartPosition.left + deltaX,
        top: state.dragStartPosition.top + deltaY,
      });
    } else {
      state.panelManualPosition = null;
      state.launcherPosition = clampLauncherPosition({
        left: state.dragStartPosition.left + deltaX,
        top: state.dragStartPosition.top + deltaY,
      });
    }
    state.suppressLauncherClick = true;
    syncFloatingUiPosition();
    event.preventDefault();
  }

  function onLauncherPointerUp(event) {
    if (event.pointerId !== state.dragPointerId) {
      return;
    }

    if (state.isDraggingLauncher) {
      persistLauncherPosition();
    }

    if (state.dragSource === "launcher") {
      elements.launcher.releasePointerCapture?.(event.pointerId);
    } else if (state.dragSource === "panel") {
      elements.header?.releasePointerCapture?.(event.pointerId);
    }
    state.dragPointerId = null;
    state.dragSource = "";
    state.dragStartPointer = null;
    state.dragStartPosition = null;
    state.isDraggingLauncher = false;
  }

  function shouldIgnorePanelDragStart(target) {
    if (!(target instanceof Element)) {
      return false;
    }

    return Boolean(target.closest("button, input, textarea, select, option, summary, a, [role='button']"));
  }

  function handleViewportResize() {
    state.launcherPosition = clampLauncherPosition(state.launcherPosition || getDefaultLauncherPosition());
    if (state.panelManualPosition) {
      state.panelManualPosition = clampPanelManualPosition(state.panelManualPosition);
    }
    syncFloatingUiPosition();
  }

  function firstVisible(selectors) {
    for (const selector of selectors) {
      const nodes = Array.from(document.querySelectorAll(selector));
      const node = nodes.find((candidate) => isVisible(candidate));
      if (node) {
        return node;
      }
    }
    return null;
  }

  function isVisible(node) {
    if (!(node instanceof Element)) {
      return false;
    }
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function installAutoClipboardSync() {
    if (state.clipboardSyncInstalled) {
      return;
    }

    state.clipboardSyncInstalled = true;
    document.addEventListener(
      "copy",
      () => {
        void scheduleClipboardSync();
      },
      true,
    );
  }

  function installScreenshotShortcut() {
    if (state.screenshotShortcutInstalled) {
      return;
    }

    state.screenshotShortcutInstalled = true;
    document.addEventListener(
      "keydown",
      (event) => {
        if (matchesShortcut(event, state.settings.fullAutoShortcut)) {
          if (event.repeat) {
            return;
          }
          event.preventDefault();
          void handleToggleFullAuto();
          return;
        }

        if (matchesShortcut(event, state.settings.fullPageScreenshotShortcut)) {
          if (event.repeat || isEditableTarget(event.target)) {
            return;
          }
          event.preventDefault();
          void handleCaptureFullPageScreenshot();
          return;
        }

        if (!matchesShortcut(event, state.settings.screenshotShortcut)) {
          return;
        }

        if (event.repeat || isEditableTarget(event.target)) {
          return;
        }
        event.preventDefault();
        void handleCaptureScreenshot();
      },
      true,
    );
  }

  function matchesShortcut(event, shortcut) {
    const parsed = parseShortcut(shortcut);
    if (!parsed.key) {
      return false;
    }

    return (
      event.altKey === parsed.alt &&
      event.ctrlKey === parsed.ctrl &&
      event.metaKey === parsed.meta &&
      event.shiftKey === parsed.shift &&
      normalizeEventKey(event) === parsed.key
    );
  }

  function parseShortcut(value) {
    const normalized = normalizeShortcut(value);
    if (!normalized) {
      return { alt: false, ctrl: false, meta: false, shift: false, key: "" };
    }

    const parts = normalized.split("+");
    const last = parts[parts.length - 1] || "";
    return {
      alt: parts.includes("Alt"),
      ctrl: parts.includes("Ctrl"),
      meta: parts.includes("Meta"),
      shift: parts.includes("Shift"),
      key: last.toLowerCase(),
    };
  }

  function installFrameShortcutBridge() {
    if (state.frameShortcutBridgeInstalled) {
      return;
    }

    state.frameShortcutBridgeInstalled = true;
    window.addEventListener("message", (event) => {
      if (event.source === window) {
        return;
      }

      const data = event?.data;
      if (!data || data.source !== "autolearning:frame-shortcut") {
        return;
      }

      const shortcut = data.shortcut;
      if (!shortcut || typeof shortcut !== "object") {
        return;
      }

      const parsed = parseShortcut(state.settings.fullAutoShortcut);
      if (!parsed.key) {
        return;
      }

      const key = String(shortcut.key || "").toLowerCase();
      if (
        Boolean(shortcut.alt) !== parsed.alt ||
        Boolean(shortcut.ctrl) !== parsed.ctrl ||
        Boolean(shortcut.meta) !== parsed.meta ||
        Boolean(shortcut.shift) !== parsed.shift ||
        key !== parsed.key
      ) {
        return;
      }

      void handleToggleFullAuto();
    });
  }

  function normalizeShortcut(value) {
    const raw = String(value || "")
      .trim()
      .replace(/\s+/g, "");
    if (!raw) {
      return "";
    }

    const parts = raw
      .split("+")
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length === 0) {
      return "";
    }

    const modifiers = [];
    let key = "";

    for (const part of parts) {
      const lower = part.toLowerCase();
      if (lower === "cmd" || lower === "command" || lower === "meta") {
        if (!modifiers.includes("Meta")) {
          modifiers.push("Meta");
        }
        continue;
      }
      if (lower === "ctrl" || lower === "control") {
        if (!modifiers.includes("Ctrl")) {
          modifiers.push("Ctrl");
        }
        continue;
      }
      if (lower === "alt" || lower === "option") {
        if (!modifiers.includes("Alt")) {
          modifiers.push("Alt");
        }
        continue;
      }
      if (lower === "shift") {
        if (!modifiers.includes("Shift")) {
          modifiers.push("Shift");
        }
        continue;
      }
      key = formatShortcutKey(part);
    }

    if (!key) {
      return "";
    }

    return [...modifiers, key].join("+");
  }

  function formatShortcutKey(value) {
    const raw = String(value || "").trim();
    if (!raw) {
      return "";
    }
    if (raw.length === 1) {
      return raw.toUpperCase();
    }
    const specialKeys = {
      space: "Space",
      enter: "Enter",
      escape: "Escape",
      esc: "Escape",
      tab: "Tab",
    };
    return specialKeys[raw.toLowerCase()] || `${raw.slice(0, 1).toUpperCase()}${raw.slice(1).toLowerCase()}`;
  }

  function normalizeEventKey(event) {
    const key = String(event.key || "").toLowerCase();
    if (key === " ") {
      return "space";
    }
    if (key === "esc") {
      return "escape";
    }
    return key;
  }

  function installFrameShortcutRelay() {
    if (window.__AUTOLEARNING_FRAME_SHORTCUT_RELAY__) {
      return;
    }

    window.__AUTOLEARNING_FRAME_SHORTCUT_RELAY__ = true;
    document.addEventListener(
      "keydown",
      (event) => {
        if (event.repeat) {
          return;
        }

        const key = normalizeFrameRelayKey(event.key);
        if (!key) {
          return;
        }

        window.top.postMessage(
          {
            source: "autolearning:frame-shortcut",
            shortcut: {
              alt: Boolean(event.altKey),
              ctrl: Boolean(event.ctrlKey),
              meta: Boolean(event.metaKey),
              shift: Boolean(event.shiftKey),
              key,
            },
          },
          "*",
        );
      },
      true,
    );
  }

  function normalizeFrameRelayKey(value) {
    const key = String(value || "").toLowerCase();
    if (!key) {
      return "";
    }
    if (key === " ") {
      return "space";
    }
    if (key === "esc") {
      return "escape";
    }
    return key;
  }

  async function scheduleClipboardSync() {
    if (state.clipboardSyncPending) {
      return;
    }

    state.clipboardSyncPending = true;

    try {
      await delay(60);

      const editorContext = await callPageBridge("isEditorCopyContext", {});
      if (!editorContext?.ok || !editorContext.active) {
        return;
      }

      if (isInsideAssistant(document.activeElement)) {
        return;
      }

      const syncResult = await handlePasteCode({ auto: true });
      if (!syncResult?.updated || !hasMeaningfulCode(syncResult.text)) {
        return;
      }
      setStatus("已自动同步剪贴板代码。点击“生成答案”后再提交。");
    } finally {
      state.clipboardSyncPending = false;
    }
  }

  function isInsideAssistant(node) {
    return node instanceof Node && elements.host instanceof HTMLElement
      ? elements.host.contains(node)
      : false;
  }

  function isEditableTarget(target) {
    if (!(target instanceof Element)) {
      return false;
    }

    return Boolean(target.closest("input, textarea, [contenteditable='true'], [contenteditable='']"));
  }

  function blurAssistantEditable() {
    const active = document.activeElement;
    if (active instanceof HTMLElement && isInsideAssistant(active) && isEditableTarget(active)) {
      active.blur();
    }
  }

  function hasMeaningfulCode(value) {
    return normalizeCode(value).trim().length > 0;
  }

  function markResultReady(ready) {
    if (elements.launcher instanceof HTMLElement) {
      elements.launcher.setAttribute("data-has-result", ready ? "true" : "false");
    }
  }

  function showToast(text) {
    if (!(elements.toast instanceof HTMLElement)) {
      return;
    }

    elements.toast.textContent = text;
    elements.toast.setAttribute("data-show", "true");

    if (state.noticeTimer) {
      window.clearTimeout(state.noticeTimer);
    }

    state.noticeTimer = window.setTimeout(() => {
      elements.toast?.setAttribute("data-show", "false");
    }, 3200);
  }

  function normalizeText(value) {
    return String(value || "")
      .replace(/\u00a0/g, " ")
      .replace(/\r\n/g, "\n")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function normalizeCode(value) {
    return String(value || "").replace(/\u00a0/g, " ").replace(/\r\n/g, "\n");
  }

  function normalizeFullAutoDelay(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return 3000;
    }
    return Math.min(15000, Math.max(500, Math.round(parsed)));
  }

  function normalizeAutoPickDelay(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return 600;
    }
    return Math.min(5000, Math.max(100, Math.round(parsed)));
  }

  function getPageFingerprint() {
    const assistantText = normalizeText(document.getElementById(HOST_ID)?.innerText || "");
    const bodyText = normalizeText(document.body?.innerText || "")
      .replace(assistantText, "")
      .slice(0, 4000);
    return `${location.href}::${hashText(`${document.title}\n${bodyText}`)}`;
  }

  function hashText(value) {
    const text = String(value || "");
    let hash = 0;
    for (let index = 0; index < text.length; index += 1) {
      hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
    }
    return hash.toString(16);
  }

  async function waitForNextQuestion(previousFingerprint, runToken) {
    const fixedDelayMs = normalizeFullAutoDelay(state.settings.fullAutoNextDelayMs);
    const timeoutMs = fixedDelayMs + 8000;
    const startTime = Date.now();

    while (Date.now() - startTime < fixedDelayMs) {
      if (runToken !== state.fullAutoRunToken || state.fullAutoStopRequested) {
        return false;
      }
      await delay(120);
    }

    while (Date.now() - startTime < timeoutMs) {
      if (runToken !== state.fullAutoRunToken || state.fullAutoStopRequested) {
        return false;
      }

      await delay(350);
      if (getPageFingerprint() !== previousFingerprint) {
        await delay(900);
        return true;
      }
    }

    return false;
  }

  function resetProblemForNextAutoRound() {
    state.problem = null;
    state.result = null;
    state.lastAutoSolveCode = "";
    state.promptPreview = null;
    markResultReady(false);
    renderGeneratedTitle("");
    renderCurrentClassification(null);
    renderPromptPreview("正在等待下一题内容...");
    renderScreenshotStatus(null);
    renderOcrText("");
    renderChoiceAnswer("");
    if (elements.approach) {
      elements.approach.textContent = "正在等待下一题...";
    }
    if (elements.code) {
      elements.code.value = "";
    }
  }

  async function hydrateQuestionBank() {
    try {
      const items = await storageGet({
        [QUESTION_BANK_STORAGE_KEY]: {},
      });
      state.questionBank = normalizeQuestionBankMap(items?.[QUESTION_BANK_STORAGE_KEY]);
      state.questionBankLoaded = true;
    } catch {
      state.questionBank = {};
      state.questionBankLoaded = true;
    }
  }

  async function ensureQuestionBankLoaded() {
    if (state.questionBankLoaded) {
      return;
    }
    await hydrateQuestionBank();
  }

  function normalizeQuestionBankMap(raw) {
    if (!raw || typeof raw !== "object") {
      return {};
    }

    const normalized = {};
    for (const [key, value] of Object.entries(raw)) {
      if (!key || !value || typeof value !== "object") {
        continue;
      }
      normalized[key] = {
        key: String(value.key || key),
        promptMode: value.promptMode === "choice" ? "choice" : "code",
        title: String(value.title || ""),
        statementPreview: String(value.statementPreview || ""),
        answer: String(value.answer || ""),
        code: String(value.code || ""),
        summary: String(value.summary || ""),
        approach: String(value.approach || ""),
        generatedTitle: String(value.generatedTitle || ""),
        model: String(value.model || ""),
        source: String(value.source || ""),
        createdAt: Number.isFinite(Number(value.createdAt)) ? Number(value.createdAt) : Date.now(),
        updatedAt: Number.isFinite(Number(value.updatedAt)) ? Number(value.updatedAt) : Date.now(),
      };
    }
    return normalized;
  }

  function buildQuestionBankLookupKeys(problem, mode = "choice") {
    const promptMode = mode === "choice" ? "choice" : "code";
    const title = normalizeQuestionStem(problem?.title || "");
    const statement = extractQuestionCoreText(problem);
    const ocr = normalizeQuestionStem(problem?.ocrText || "");
    const sampleText = Array.isArray(problem?.samples)
      ? problem.samples
          .map((sample) => {
            const input = normalizeQuestionStem(sample?.input || "");
            const output = normalizeQuestionStem(sample?.output || "");
            return `${input}=>${output}`;
          })
          .join(" | ")
      : "";
    const core = statement || ocr || title;
    const primaryRaw = `${promptMode}\n${core}`;
    const secondaryRaw = `${promptMode}\n${title}\n${core}`;
    const tertiaryRaw = `${promptMode}\n${core}\n${sampleText}`;
    const keys = [
      `${promptMode}:${hashText(primaryRaw)}`,
      `${promptMode}:${hashText(secondaryRaw)}`,
      `${promptMode}:${hashText(tertiaryRaw)}`,
    ];
    return Array.from(new Set(keys.filter(Boolean)));
  }

  function findQuestionBankAnswer(problem, mode = "choice") {
    const keys = buildQuestionBankLookupKeys(problem, mode);
    for (const key of keys) {
      const entry = state.questionBank[key];
      if (!entry) {
        continue;
      }
      const candidate = mode === "choice" ? String(entry.answer || entry.code || "").trim() : String(entry.code || "").trim();
      if (!candidate) {
        continue;
      }
      return {
        key,
        keys,
        entry,
      };
    }
    if (mode === "choice") {
      const targetStem = extractQuestionCoreText(problem);
      if (targetStem) {
        for (const [bankKey, entry] of Object.entries(state.questionBank || {})) {
          if (!entry || entry.promptMode !== "choice") {
            continue;
          }
          const candidate = String(entry.answer || entry.code || "").trim();
          if (!candidate) {
            continue;
          }
          const candidateStem = normalizeQuestionStem(entry.statementPreview || entry.title || "");
          if (!candidateStem) {
            continue;
          }
          if (
            candidateStem === targetStem ||
            candidateStem.includes(targetStem) ||
            targetStem.includes(candidateStem)
          ) {
            return {
              key: bankKey,
              keys,
              entry,
            };
          }
        }
      }
    }
    return null;
  }

  function extractQuestionCoreText(problem) {
    const raw = normalizeText(problem?.statementText || problem?.ocrText || "");
    if (!raw) {
      return "";
    }

    const lines = raw
      .split("\n")
      .map((line) => normalizeText(line))
      .filter(Boolean);
    const filtered = [];

    for (const rawLine of lines) {
      let line = stripQuestionOrderPrefix(rawLine);
      if (!line) {
        continue;
      }
      line = line.replace(/^(单选题|多选题|判断题|填空题|选择题|题目)\s*/g, "");
      line = line.replace(/^第\s*\d+\s*题\s*/g, "");
      if (!line) {
        continue;
      }
      if (isChoiceOptionLine(line)) {
        continue;
      }
      filtered.push(line);
      if (filtered.length >= 4) {
        break;
      }
    }

    const joined = filtered.join(" ");
    return normalizeQuestionStem(joined);
  }

  function stripQuestionOrderPrefix(value) {
    let line = String(value || "");
    line = line.replace(/^\s*[\[(（【]?\s*\d+\s*[\])）】]?\s*[\.、。．:：-]\s*/g, "");
    line = line.replace(/^\s*\d+\s+/g, "");
    line = line.replace(/^\s*(\d+\s*[\.、。．:：-]\s*)+/g, "");
    return normalizeText(line);
  }

  function isChoiceOptionLine(value) {
    const line = String(value || "");
    if (!line) {
      return false;
    }

    if (/^[A-FＡ-Ｆ][\.、。．:：\s]/.test(line)) {
      return true;
    }
    if (/^[\(\[（【]?[A-FＡ-Ｆ][\)\]）】][\.、。．:：\s]*/.test(line)) {
      return true;
    }
    if (/[A-FＡ-Ｆ][\.、。．:：].{0,80}[A-FＡ-Ｆ][\.、。．:：]/.test(line)) {
      return true;
    }
    return false;
  }

  function normalizeQuestionStem(value) {
    return normalizeText(value)
      .toLowerCase()
      .replace(/[“”"']/g, "")
      .replace(/[（）()【】\[\]《》<>]/g, " ")
      .replace(/[，,。！？!?:：;；、]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function buildQuestionBankResult(entry, problem) {
    const answer = String(entry?.answer || "").trim();
    const code = String(entry?.code || "").trim();
    return {
      generatedTitle: entry?.generatedTitle || problem?.title || "本地题库答案",
      summary: entry?.summary || "命中本地题库答案。",
      problemType: entry?.promptMode === "choice" ? "选择题" : "代码题",
      problemDefinition: "",
      approach: entry?.approach || "已命中本地题库记录，优先使用本地答案。",
      answer,
      code: code || (entry?.promptMode === "choice" ? answer : ""),
      model: "local-question-bank",
      fromQuestionBank: true,
    };
  }

  async function upsertQuestionBankEntry(problem, mode, solveResult, options = {}) {
    if (!problem || !solveResult) {
      return;
    }

    const keys = buildQuestionBankLookupKeys(problem, mode);
    if (keys.length === 0) {
      return;
    }

    const now = Date.now();
    const firstKey = keys[0];
    const existing = state.questionBank[firstKey] || state.questionBank[keys[1]] || null;
    const normalizedAnswer =
      mode === "choice"
        ? normalizeChoiceAnswerForBank(solveResult.answer || solveResult.code || "")
        : "";
    const nextEntry = {
      key: firstKey,
      promptMode: mode === "choice" ? "choice" : "code",
      title: String(problem.title || "").slice(0, 300),
      statementPreview: normalizeText(problem.statementText || "").slice(0, 1600),
      answer: normalizedAnswer,
      code: mode === "choice" ? normalizedAnswer : String(solveResult.code || ""),
      summary: String(solveResult.summary || ""),
      approach: String(solveResult.approach || ""),
      generatedTitle: String(solveResult.generatedTitle || ""),
      model: String(solveResult.model || ""),
      source: String(options.source || "ai"),
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };

    for (const key of keys) {
      state.questionBank[key] = {
        ...nextEntry,
        key,
      };
    }
    await persistQuestionBank();
  }

  function queueQuestionBankReviewItem(problem, mode, answerText) {
    if (mode !== "choice" || !problem) {
      return;
    }
    const answer = normalizeChoiceAnswerForBank(answerText);
    if (!answer) {
      return;
    }

    const keys = buildQuestionBankLookupKeys(problem, mode);
    if (keys.length === 0) {
      return;
    }

    const primaryKey = keys[0];
    const existingIndex = state.questionBankReviewQueue.findIndex((item) => item.primaryKey === primaryKey);
    const nextItem = {
      primaryKey,
      keys,
      mode: "choice",
      title: String(problem.title || "未命名题目"),
      statementPreview: normalizeText(problem.statementText || "").slice(0, 240),
      answer,
    };
    if (existingIndex >= 0) {
      state.questionBankReviewQueue[existingIndex] = nextItem;
      return;
    }
    state.questionBankReviewQueue.push(nextItem);
  }

  async function persistQuestionBank() {
    await storageSet({
      [QUESTION_BANK_STORAGE_KEY]: state.questionBank,
    });
  }

  function normalizeChoiceAnswerForBank(value) {
    const raw = String(value || "").trim();
    if (!raw) {
      return "";
    }

    if (/^(对|正确|true|yes|√)$/i.test(raw)) {
      return "对";
    }
    if (/^(错|错误|false|no|×)$/i.test(raw)) {
      return "错";
    }

    const letters = raw.toUpperCase().match(/[A-F]/g) || [];
    if (letters.length > 0) {
      const deduped = [];
      for (const label of letters) {
        if (!deduped.includes(label)) {
          deduped.push(label);
        }
      }
      return deduped.join("");
    }

    return raw.slice(0, 24);
  }

  async function handleOpenQuestionBankEditor() {
    await ensureQuestionBankLoaded();
    const items = buildQuestionBankEditorItems();
    if (items.length === 0) {
      setStatus("题库里还没有可编辑的选择题记录。");
      return;
    }
    openQuestionBankReviewModal(items);
  }

  function buildQuestionBankEditorItems() {
    const map = new Map();

    const upsertItem = (key, payload) => {
      const current = map.get(key);
      if (!current) {
        map.set(key, {
          id: key,
          title: payload.title || "未命名题目",
          statementPreview: payload.statementPreview || "",
          answer: payload.answer || "",
          keys: Array.from(new Set(payload.keys || [])),
          updatedAt: Number.isFinite(Number(payload.updatedAt)) ? Number(payload.updatedAt) : 0,
          preferred: Boolean(payload.preferred),
        });
        return;
      }

      current.keys = Array.from(new Set([...current.keys, ...(payload.keys || [])]));
      if (payload.answer) {
        current.answer = payload.answer;
      }
      if (payload.statementPreview && !current.statementPreview) {
        current.statementPreview = payload.statementPreview;
      }
      if (payload.title && current.title === "未命名题目") {
        current.title = payload.title;
      }
      current.updatedAt = Math.max(current.updatedAt, Number(payload.updatedAt) || 0);
      if (payload.preferred) {
        current.preferred = true;
      }
    };

    const allEntries = Object.entries(state.questionBank || {});
    for (const [storageKey, entry] of allEntries) {
      if (!entry || entry.promptMode !== "choice") {
        continue;
      }
      const answer = normalizeChoiceAnswerForBank(entry.answer || entry.code || "");
      if (!answer) {
        continue;
      }
      const dedupeKey = hashText(
        `bank:${normalizeText(entry.title || "").toLowerCase()}\n${normalizeText(
          entry.statementPreview || "",
        ).toLowerCase()}`,
      );
      upsertItem(`bank:${dedupeKey}`, {
        title: String(entry.title || "未命名题目"),
        statementPreview: String(entry.statementPreview || ""),
        answer,
        keys: [storageKey],
        updatedAt: entry.updatedAt,
        preferred: false,
      });
    }

    for (const queueItem of state.questionBankReviewQueue || []) {
      const dedupeKey = hashText(
        `queue:${normalizeText(queueItem.title || "").toLowerCase()}\n${normalizeText(
          queueItem.statementPreview || "",
        ).toLowerCase()}`,
      );
      upsertItem(`queue:${dedupeKey}`, {
        title: String(queueItem.title || "未命名题目"),
        statementPreview: String(queueItem.statementPreview || ""),
        answer: normalizeChoiceAnswerForBank(queueItem.answer || ""),
        keys: Array.isArray(queueItem.keys) ? queueItem.keys : [],
        updatedAt: Date.now(),
        preferred: true,
      });
    }

    return Array.from(map.values()).sort((a, b) => {
      if (a.preferred !== b.preferred) {
        return a.preferred ? -1 : 1;
      }
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
  }

  function openQuestionBankReviewModal(items) {
    if (state.reviewModalOpen) {
      return;
    }
    if (!Array.isArray(items) || items.length === 0) {
      return;
    }

    state.reviewModalOpen = true;
    const modal = document.createElement("div");
    modal.className = "al-bank-modal";
    modal.setAttribute("data-role", "question-bank-modal");
    modal.innerHTML = `
      <div class="al-bank-modal-card" role="dialog" aria-modal="true" aria-label="题库更正">
        <div class="al-bank-modal-head">
          <div>
            <h3>编辑本地题库答案</h3>
            <p>多选题建议先随机作答并提交，看完解析后在这里把答案修正到本地题库。修正完成后，后续做题仍需要你按答案手动勾选选项。</p>
          </div>
          <button type="button" class="al-bank-modal-close" data-role="bank-close" aria-label="关闭">×</button>
        </div>
        <div class="al-bank-modal-tools">
          <div class="al-bank-modal-tool-buttons">
            <button type="button" data-role="bank-export">导出题库</button>
            <button type="button" data-role="bank-import">导入题库</button>
          </div>
          <div class="al-bank-save-indicator" data-role="bank-save-indicator" data-state="idle">支持自动保存</div>
        </div>
        <input type="file" data-role="bank-import-input" accept="application/json,.json" hidden />
        <div class="al-bank-list">
          ${items
            .map((item, index) => {
              return `
                <article class="al-bank-item">
                  <p class="al-bank-item-title">${index + 1}. ${escapeHtml(item.title)}</p>
                  <p class="al-bank-item-meta">${escapeHtml(item.statementPreview || "题面预览为空。")}</p>
                  <div class="al-bank-item-answer">
                    <label>答案</label>
                    <input type="text" data-role="bank-answer-input" data-index="${index}" value="${escapeHtml(item.answer)}" placeholder="例如 A / AC / 对 / 错" />
                  </div>
                </article>
              `;
            })
            .join("")}
        </div>
        <div class="al-bank-modal-actions">
          <button type="button" class="al-bank-modal-cancel" data-role="bank-cancel">关闭</button>
          <button type="button" class="al-bank-modal-save" data-role="bank-save">手动保存（可选）</button>
        </div>
      </div>
    `;

    const closeModal = () => {
      modal.remove();
      state.reviewModalOpen = false;
    };

    const autoSaveTimers = new Map();
    let saveIndicatorTimer = 0;
    const saveIndicator = modal.querySelector('[data-role="bank-save-indicator"]');
    const importInput = modal.querySelector('[data-role="bank-import-input"]');

    const setSaveIndicator = (text, stateName = "idle", autoReset = false) => {
      if (!(saveIndicator instanceof HTMLElement)) {
        return;
      }
      saveIndicator.textContent = text;
      saveIndicator.setAttribute("data-state", stateName);
      if (saveIndicatorTimer) {
        window.clearTimeout(saveIndicatorTimer);
        saveIndicatorTimer = 0;
      }
      if (autoReset) {
        saveIndicatorTimer = window.setTimeout(() => {
          if (saveIndicator instanceof HTMLElement) {
            saveIndicator.textContent = "支持自动保存";
            saveIndicator.setAttribute("data-state", "idle");
          }
        }, 1800);
      }
    };

    const applySingleUpdate = (editorItem, normalizedAnswer) => {
      if (!normalizedAnswer || !Array.isArray(editorItem.keys) || editorItem.keys.length === 0) {
        return false;
      }

      let changed = false;
      const now = Date.now();

      for (const aliasKey of editorItem.keys) {
        const existing = state.questionBank[aliasKey];
        const previousAnswer = normalizeChoiceAnswerForBank(existing?.answer || existing?.code || "");
        if (previousAnswer === normalizedAnswer) {
          continue;
        }
        state.questionBank[aliasKey] = {
          key: aliasKey,
          promptMode: "choice",
          title: editorItem.title || existing?.title || "",
          statementPreview: editorItem.statementPreview || existing?.statementPreview || "",
          answer: normalizedAnswer,
          code: normalizedAnswer,
          summary: existing?.summary || "",
          approach: existing?.approach || "",
          generatedTitle: existing?.generatedTitle || "",
          model: existing?.model || "",
          source: "manual-review",
          createdAt: existing?.createdAt || now,
          updatedAt: now,
        };
        changed = true;
      }

      for (const queueItem of state.questionBankReviewQueue || []) {
        const intersects = queueItem.keys?.some((key) => editorItem.keys.includes(key));
        if (intersects) {
          queueItem.answer = normalizedAnswer;
        }
      }

      if (changed) {
        editorItem.answer = normalizedAnswer;
      }
      return changed;
    };

    const saveInputValue = async (input, options = {}) => {
      if (!(input instanceof HTMLInputElement)) {
        return false;
      }
      const index = Number(input.dataset.index);
      if (!Number.isInteger(index) || index < 0 || index >= items.length) {
        return false;
      }
      const editorItem = items[index];
      const normalizedAnswer = normalizeChoiceAnswerForBank(input.value);
      if (!normalizedAnswer) {
        return false;
      }
      input.value = normalizedAnswer;

      const changed = applySingleUpdate(editorItem, normalizedAnswer);
      if (!changed) {
        return false;
      }
      setSaveIndicator("自动保存中...", "saving");
      await persistQuestionBank();
      setSaveIndicator("已自动保存", "saved", true);
      if (!options.silent) {
        setStatus(`已自动保存：${editorItem.title}`);
        showToast(`已自动保存：${editorItem.title}`);
      }
      return true;
    };

    const flushAutoSaveTimer = async (input) => {
      const index = Number(input?.dataset?.index);
      if (!Number.isInteger(index)) {
        return;
      }
      const timer = autoSaveTimers.get(index);
      if (timer) {
        window.clearTimeout(timer);
        autoSaveTimers.delete(index);
      }
      await saveInputValue(input, { silent: false });
    };

    const scheduleAutoSave = (input) => {
      const index = Number(input?.dataset?.index);
      if (!Number.isInteger(index)) {
        return;
      }
      const oldTimer = autoSaveTimers.get(index);
      if (oldTimer) {
        window.clearTimeout(oldTimer);
      }
      const timer = window.setTimeout(() => {
        autoSaveTimers.delete(index);
        void saveInputValue(input, { silent: false });
      }, 280);
      autoSaveTimers.set(index, timer);
    };

    const onSave = async () => {
      const answerInputs = Array.from(modal.querySelectorAll("input[data-role='bank-answer-input']"));
      let updatedCount = 0;

      setSaveIndicator("保存中...", "saving");
      for (const input of answerInputs) {
        const changed = await saveInputValue(input, { silent: true });
        if (changed) {
          updatedCount += 1;
        }
      }

      if (updatedCount > 0) {
        setStatus(`题库更正已保存，共更新 ${updatedCount} 条记录。`);
        showToast("题库更正已保存。");
        setSaveIndicator(`已保存 ${updatedCount} 条`, "saved", true);
      } else {
        setStatus("当前内容已经是最新，已自动保存。");
        setSaveIndicator("当前已是最新", "saved", true);
      }
    };

    const exportQuestionBank = async () => {
      await ensureQuestionBankLoaded();
      const payload = {
        exportedAt: new Date().toISOString(),
        version: 1,
        questionBank: state.questionBank || {},
      };
      const exportedAt = new Date().toISOString().slice(0, 10);
      downloadTextFile(
        `autolearning-question-bank-${exportedAt}.json`,
        JSON.stringify(payload, null, 2),
        "application/json;charset=utf-8",
      );
      setStatus("题库已导出为 JSON。");
      showToast("题库已导出。");
    };

    const importQuestionBank = async (file) => {
      if (!(file instanceof File)) {
        return;
      }

      setSaveIndicator("导入中...", "saving");
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        const rawQuestionBank =
          parsed && typeof parsed === "object" && parsed.questionBank && typeof parsed.questionBank === "object"
            ? parsed.questionBank
            : parsed;
        const normalized = normalizeQuestionBankMap(rawQuestionBank);
        const importedKeys = Object.keys(normalized);
        if (importedKeys.length === 0) {
          throw new Error("导入文件里没有可用的题库数据。");
        }

        state.questionBank = {
          ...state.questionBank,
          ...normalized,
        };
        state.questionBankLoaded = true;
        await persistQuestionBank();
        setStatus(`题库导入成功，共合并 ${importedKeys.length} 条记录。`);
        showToast(`题库已导入 ${importedKeys.length} 条。`);
        setSaveIndicator(`已导入 ${importedKeys.length} 条`, "saved", true);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setStatus(`题库导入失败：${message}`);
        showToast("题库导入失败，请检查 JSON 格式。");
        setSaveIndicator("导入失败", "idle", true);
      }
    };

    const answerInputs = Array.from(modal.querySelectorAll("input[data-role='bank-answer-input']"));
    for (const input of answerInputs) {
      if (!(input instanceof HTMLInputElement)) {
        continue;
      }
      input.addEventListener("input", () => {
        scheduleAutoSave(input);
      });
      input.addEventListener("blur", () => {
        void flushAutoSaveTimer(input);
      });
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          void flushAutoSaveTimer(input);
          input.blur();
        }
      });
    }

    modal.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      if (target.getAttribute("data-role") === "bank-export") {
        void exportQuestionBank();
        return;
      }
      if (target.getAttribute("data-role") === "bank-import") {
        if (importInput instanceof HTMLInputElement) {
          importInput.value = "";
          importInput.click();
        }
        return;
      }
      if (target.getAttribute("data-role") === "bank-close" || target.getAttribute("data-role") === "bank-cancel") {
        closeModal();
        return;
      }
      if (target.getAttribute("data-role") === "bank-save") {
        void onSave();
      }
    });

    if (importInput instanceof HTMLInputElement) {
      importInput.addEventListener("change", () => {
        const file = importInput.files?.[0];
        if (file) {
          void importQuestionBank(file);
        }
      });
    }

    document.documentElement.appendChild(modal);
  }

  function delay(ms) {
    return new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }

  function formatDateTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "未知时间";
    }

    return date.toLocaleString("zh-CN", {
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function sendMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(normalizeRuntimeErrorMessage(chrome.runtime.lastError.message)));
          return;
        }
        resolve(response);
      });
    });
  }

  function storageSet(values) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set(values, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(normalizeRuntimeErrorMessage(chrome.runtime.lastError.message)));
          return;
        }
        resolve();
      });
    });
  }

  function storageGet(defaults) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(defaults, (items) => {
        if (chrome.runtime.lastError) {
          reject(new Error(normalizeRuntimeErrorMessage(chrome.runtime.lastError.message)));
          return;
        }
        resolve(items);
      });
    });
  }

  function normalizeRuntimeErrorMessage(message) {
    const text = String(message || "");
    if (/Extension context invalidated/i.test(text)) {
      return "插件刚刚被重新加载或更新了，请刷新当前题目页面后再试。";
    }
    return text || "插件通信失败，请刷新页面后重试。";
  }

  function installBridge() {
    if (document.querySelector('script[data-autolearning-bridge="true"]')) {
      return;
    }

    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("page-bridge.js");
    script.dataset.autolearningBridge = "true";
    script.async = false;
    script.addEventListener("load", () => {
      script.remove();
    });
    (document.head || document.documentElement).appendChild(script);
  }

  function callPageBridge(type, payload) {
    return new Promise((resolve) => {
      const requestId = `autolearning-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      let settled = false;
      let timeoutId = 0;

      const onResponse = (event) => {
        const detail = event.detail || {};
        if (settled || detail.requestId !== requestId) {
          return;
        }
        settled = true;
        window.clearTimeout(timeoutId);
        window.removeEventListener(BRIDGE_RESPONSE_EVENT, onResponse);
        resolve(detail.response);
      };

      window.addEventListener(BRIDGE_RESPONSE_EVENT, onResponse);
      window.dispatchEvent(
        new CustomEvent(BRIDGE_REQUEST_EVENT, {
          detail: {
            requestId,
            type,
            payload,
          },
        }),
      );

      timeoutId = window.setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        window.removeEventListener(BRIDGE_RESPONSE_EVENT, onResponse);
        resolve({ ok: false, error: "bridge timeout" });
      }, 1200);
    });
  }
})();
