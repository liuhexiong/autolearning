(function () {
  if (window.top !== window || window.__AUTOLEARNING_CONTENT__) {
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
  const LAUNCHER_SIZE = 52;
  const PANEL_GAP = 12;
  const PANEL_MAX_WIDTH = 420;
  const MOBILE_BREAKPOINT = 720;
  const DRAG_THRESHOLD = 6;
  const PANEL_VISIBLE_STRIP = 72;

  const state = {
    mounted: false,
    solving: false,
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
    promptPreview: null,
    screenshotShortcutInstalled: false,
    settings: {
      includeScreenshotInSolver: false,
      autoSolveAfterCapture: false,
      screenshotShortcut: "Alt+Shift+S",
      fullPageScreenshotShortcut: "Alt+Shift+F",
      autoSubmitAfterFullCapture: false,
    },
  };

  const elements = {};

  installBridge();
  bootstrap();
  observePageChanges();

  function bootstrap() {
    if (state.mounted || !looksLikeSupportedPage()) {
      return;
    }

    state.mounted = true;
    mountUi();
    installAutoClipboardSync();
    installScreenshotShortcut();
    renderSummary("点击“识别题面”开始提取当前页面内容。");
    renderGeneratedTitle("");
    renderCurrentClassification(null);
    renderPromptPreview("还没有可预览的内容。");
    renderScreenshotStatus(null);
    renderOcrText("");
    renderHistory([]);
    setStatus("插件已就绪。");
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
      }
      bootstrap();
    }, 1200);
  }

  function looksLikeSupportedPage() {
    const editorSignals = [
      ".monaco-editor",
      ".CodeMirror",
      ".ace_editor",
      "textarea",
      ".cm-content",
    ];
    const hasEditor = editorSignals.some((selector) => document.querySelector(selector));
    if (!hasEditor) {
      return false;
    }

    const quickText = normalizeText(document.body?.innerText || "").slice(0, 5000);
    const problemKeywords = [
      "任务描述",
      "题目描述",
      "问题描述",
      "学习内容",
      "输入描述",
      "输出描述",
      "示例",
      "样例",
      "时间限制",
      "Input",
      "Output",
      "Example",
      "Constraints",
    ];

    return problemKeywords.some((keyword) => quickText.includes(keyword));
  }

  function mountUi() {
    injectStyles();

    const host = document.createElement("div");
    host.id = HOST_ID;
    host.innerHTML = `
      <button id="${LAUNCHER_ID}" type="button" aria-label="打开 AutoLearning 助手">AL</button>
      <div id="autolearning-toast" aria-live="polite"></div>
      <aside id="${PANEL_ID}" data-open="false" aria-hidden="true">
        <div class="al-card">
          <header class="al-header">
            <div>
              <p class="al-kicker">AutoLearning</p>
              <h2>算法学习助手</h2>
            </div>
            <button class="al-close" type="button" aria-label="关闭面板">×</button>
          </header>

          <p class="al-status" data-role="status">初始化中...</p>

          <div class="al-actions">
            <button data-role="solve" type="button" class="al-primary">生成答案</button>
            <button data-role="capture" type="button">截图题面</button>
            <button data-role="settings" type="button">设置</button>
            <button data-role="paste-code" type="button">读取剪贴板代码</button>
          </div>

          <section class="al-section">
            <div class="al-code-head">
              <h3>额外提示词</h3>
              <button data-role="save-prompt" type="button" class="al-link">保存</button>
            </div>
            <textarea
              data-role="extra-instructions"
              class="al-prompt"
              spellcheck="false"
              placeholder="例如：保持 C 语言风格，不要改函数签名；优先修复我当前代码里的 bug；先给最稳的做法。"
            ></textarea>
          </section>

          <details class="al-section al-details" data-role="prompt-preview-wrap">
            <summary>发送给 AI 的内容预览</summary>
            <div class="al-code-head">
              <div class="al-inline-actions">
                <button data-role="refresh-preview" type="button" class="al-link-button">刷新预览</button>
                <button data-role="copy-preview" type="button" class="al-link-button">复制预览</button>
              </div>
            </div>
            <pre data-role="prompt-preview" class="al-details-content">还没有可预览的内容。</pre>
          </details>

          <section class="al-section">
            <div class="al-code-head">
              <h3>截图辅助</h3>
              <span data-role="shortcut-tip" class="al-mini-tip">框选 Alt+Shift+S / 整页 Alt+Shift+F</span>
            </div>
            <div data-role="screenshot-status" class="al-summary">还没有附带题面截图。</div>
          </section>

          <details class="al-section al-details">
            <summary>OCR 结果</summary>
            <pre data-role="ocr-text" class="al-details-content">还没有 OCR 结果。</pre>
          </details>

          <section class="al-section">
            <div class="al-code-head">
              <h3>提取概览</h3>
              <div class="al-inline-actions">
                <button data-role="copy-problem" type="button" class="al-link-button">复制 JSON</button>
                <button data-role="export-problem" type="button" class="al-link-button">导出 JSON</button>
              </div>
            </div>
            <div class="al-summary" data-role="summary"></div>
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
            <h3>解题思路</h3>
            <div class="al-result" data-role="approach">还没有生成内容。</div>
          </section>

          <section class="al-section">
            <div class="al-code-head">
              <h3>生成代码</h3>
              <button data-role="copy" type="button" class="al-link">复制</button>
            </div>
            <textarea
              data-role="code"
              class="al-code"
              spellcheck="false"
              placeholder="生成后的代码会显示在这里，你也可以手动修改后再填充。"
            ></textarea>
          </section>

          <details class="al-section al-details">
            <summary>查看提取详情</summary>
            <pre data-role="details" class="al-details-content">还没有提取内容。</pre>
          </details>
        </div>
      </aside>
    `;

    document.documentElement.appendChild(host);

    elements.host = host;
    elements.launcher = host.querySelector(`#${LAUNCHER_ID}`);
    elements.toast = host.querySelector("#autolearning-toast");
    elements.panel = host.querySelector(`#${PANEL_ID}`);
    elements.status = host.querySelector('[data-role="status"]');
    elements.summary = host.querySelector('[data-role="summary"]');
    elements.generatedTitle = host.querySelector('[data-role="generated-title"]');
    elements.problemType = host.querySelector('[data-role="problem-type"]');
    elements.problemDefinition = host.querySelector('[data-role="problem-definition"]');
    elements.approach = host.querySelector('[data-role="approach"]');
    elements.code = host.querySelector('[data-role="code"]');
    elements.extraInstructions = host.querySelector('[data-role="extra-instructions"]');
    elements.details = host.querySelector('[data-role="details"]');
    elements.promptPreview = host.querySelector('[data-role="prompt-preview"]');
    elements.screenshotStatus = host.querySelector('[data-role="screenshot-status"]');
    elements.shortcutTip = host.querySelector('[data-role="shortcut-tip"]');
    elements.header = host.querySelector(".al-header");
    elements.ocrText = host.querySelector('[data-role="ocr-text"]');
    elements.historyList = host.querySelector('[data-role="history-list"]');

    host.querySelector(".al-close").addEventListener("click", closePanel);
    elements.launcher.addEventListener("click", togglePanel);
    host.querySelector('[data-role="solve"]').addEventListener("click", () => {
      void handleSolve();
    });
    host.querySelector('[data-role="capture"]').addEventListener("click", () => {
      void handleCaptureScreenshot();
    });
    host.querySelector('[data-role="settings"]').addEventListener("click", () => {
      void handleOpenSettings();
    });
    host.querySelector('[data-role="paste-code"]').addEventListener("click", () => {
      void handlePasteCode();
    });
    host.querySelector('[data-role="save-prompt"]').addEventListener("click", () => {
      void handleSaveExtraInstructions();
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
    host.querySelector('[data-role="copy-problem"]').addEventListener("click", () => {
      void handleCopyProblem();
    });
    host.querySelector('[data-role="export-problem"]').addEventListener("click", () => {
      void handleExportProblem();
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

    initFloatingPosition();
    setupLauncherDrag();
    window.addEventListener("resize", handleViewportResize);
    chrome.storage?.onChanged?.addListener(handleStorageChanged);
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

      #${LAUNCHER_ID} {
        position: fixed;
        right: 18px;
        top: 112px;
        width: 52px;
        height: 52px;
        border: 0;
        border-radius: 18px;
        color: #fff6eb;
        font-size: 16px;
        font-weight: 800;
        letter-spacing: 0.02em;
        cursor: pointer;
        pointer-events: auto;
        background:
          radial-gradient(circle at top left, rgba(255, 208, 149, 0.38), transparent 38%),
          linear-gradient(135deg, #db7a30 0%, #bf4f29 100%);
        box-shadow:
          0 18px 40px rgba(130, 58, 24, 0.22),
          inset 0 1px 0 rgba(255, 255, 255, 0.22);
        transition:
          transform 160ms ease,
          box-shadow 160ms ease,
          opacity 160ms ease;
      }

      #${LAUNCHER_ID}:hover {
        transform: translateY(-2px);
        box-shadow:
          0 20px 44px rgba(130, 58, 24, 0.26),
          inset 0 1px 0 rgba(255, 255, 255, 0.26);
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
        color: #f3f2ef;
        background: rgba(255, 255, 255, 0.08);
        cursor: pointer;
      }

      #${PANEL_ID} .al-status {
        margin: 0;
        padding: 10px 12px;
        border-radius: 14px;
        font-size: 13px;
        line-height: 1.5;
        color: #e7ddd0;
        background: rgba(255, 255, 255, 0.06);
      }

      #${PANEL_ID} .al-actions {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
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

      #${PANEL_ID} .al-details summary {
        cursor: pointer;
        color: #ffcf9a;
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
    setStatus("正在识别题面和当前代码...");

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
    await refreshPromptPreview({ silent: true });
    setStatus("题面已提取，可以直接生成答案。");
  }

  async function handleSolve(options = {}) {
    const auto = Boolean(options.auto);
    const sourceCode = typeof options.sourceCode === "string" ? options.sourceCode : "";
    const extraInstructions = getInlineExtraInstructions();

    if (!auto) {
      openPanel();
    }

    if (state.solving) {
      return;
    }

    if (!state.problem) {
      await handleExtract();
    }

    state.solving = true;
    setStatus("正在请求模型，请稍等...");

    try {
      const response = await sendMessage({
        type: "autolearning:solve-problem",
        problem: state.problem,
        extraInstructions,
      });

      if (!response?.ok) {
        throw new Error(response?.error || "生成失败");
      }

      state.result = response.result;
      renderGeneratedTitle(response.result.generatedTitle || response.result.summary || "");
      renderCurrentClassification(response.result);
      elements.approach.textContent =
        response.result.approach || response.result.summary || "模型已返回代码。";
      elements.code.value = response.result.code || "";
      if (auto && sourceCode) {
        state.lastAutoSolveCode = sourceCode;
      }
      markResultReady(true);
      await refreshHistory({ silent: true });
      const copied = await copyTextToClipboard(elements.code.value);
      setStatus(
        copied
          ? `已生成答案并自动复制代码，模型：${response.result.model}`
          : `已生成答案，模型：${response.result.model}`,
      );
      showToast("答案已经生成好了，点 AL 就能查看。");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      state.solving = false;
    }
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

      if (elements.extraInstructions instanceof HTMLTextAreaElement) {
        elements.extraInstructions.value = settings.extraInstructions || "";
      }
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
      screenshotShortcut:
        normalizeShortcut(settings?.screenshotShortcut) || state.settings.screenshotShortcut,
      fullPageScreenshotShortcut:
        normalizeShortcut(settings?.fullPageScreenshotShortcut) ||
        state.settings.fullPageScreenshotShortcut,
      autoSubmitAfterFullCapture: Boolean(
        settings?.autoSubmitAfterFullCapture ?? state.settings.autoSubmitAfterFullCapture,
      ),
    };
    renderShortcutTip();
  }

  function handleStorageChanged(changes, areaName) {
    if (areaName !== "local") {
      return;
    }

    const nextSettings = {};
    if (changes.extraInstructions) {
      nextSettings.extraInstructions = changes.extraInstructions.newValue || "";
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
    if (changes.autoSubmitAfterFullCapture) {
      nextSettings.autoSubmitAfterFullCapture = Boolean(changes.autoSubmitAfterFullCapture.newValue);
    }

    if (Object.keys(nextSettings).length === 0) {
      return;
    }

    applySettings(nextSettings);
    if (elements.extraInstructions instanceof HTMLTextAreaElement && "extraInstructions" in nextSettings) {
      elements.extraInstructions.value = nextSettings.extraInstructions;
    }
    void refreshPromptPreview({ silent: true });
  }

  async function handleSaveExtraInstructions() {
    const value =
      elements.extraInstructions instanceof HTMLTextAreaElement
        ? elements.extraInstructions.value.trim()
        : "";

    try {
      await storageSet({ extraInstructions: value });
      await refreshPromptPreview({ silent: true });
      setStatus("额外提示词已保存。");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
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

    try {
      const problem = state.problem || (await extractProblem());
      state.problem = problem;
      renderProblem(problem);

      const response = await sendMessage({
        type: "autolearning:preview-prompt",
        problem,
        extraInstructions: getInlineExtraInstructions(),
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
        `框选 ${state.settings.screenshotShortcut} / 整页 ${state.settings.fullPageScreenshotShortcut}`;
    }
  }

  function renderScreenshotStatus(problem) {
    if (!elements.screenshotStatus) {
      return;
    }

    if (problem?.screenshotDataUrl) {
      if (problem?.ocrSkipped) {
        elements.screenshotStatus.textContent = "已截取题面截图，生成时将直接发送图片，不再调用 OCR。";
        return;
      }

      elements.screenshotStatus.textContent = problem?.ocrText
        ? "已截取题面截图，并已转写为 OCR 文本。"
        : "已截取题面截图，等待 OCR 转写。";
      return;
    }

    elements.screenshotStatus.textContent = "还没有附带题面截图。";
  }

  function renderOcrText(text) {
    if (!elements.ocrText) {
      return;
    }

    elements.ocrText.textContent = text || "还没有 OCR 结果。";
  }

  function getInlineExtraInstructions() {
    return elements.extraInstructions instanceof HTMLTextAreaElement
      ? elements.extraInstructions.value.trim()
      : "";
  }

  async function handleCaptureScreenshot() {
    return handleCaptureImageFlow({ mode: "selection" });
  }

  async function handleCaptureFullPageScreenshot() {
    return handleCaptureImageFlow({ mode: "fullPage", autoSubmit: true });
  }

  async function handleCaptureImageFlow(options = {}) {
    openPanel();
    const mode = options.mode === "fullPage" ? "fullPage" : "selection";
    const autoSubmitRequested = Boolean(options.autoSubmit);
    setStatus(mode === "fullPage" ? "正在截取当前整页画面..." : "请框选题面区域，按 Esc 可以取消。");

    try {
      let rect = null;
      if (mode === "selection") {
        rect = await selectScreenshotArea();
        if (!rect) {
          setStatus("已取消截图。");
          return;
        }
      }

      setStatus(mode === "fullPage" ? "正在截取整页图片..." : "正在截取题面图片...");
      const response = await sendMessage({ type: "autolearning:capture-visible-tab" });
      if (!response?.ok || !response.dataUrl) {
        throw new Error(response?.error || "页面截图失败");
      }

      const screenshotDataUrl =
        mode === "fullPage" ? response.dataUrl : await cropImageDataUrl(response.dataUrl, rect);
      const settings = await getCurrentSettings();
      applySettings(settings);
      const useDirectImage = Boolean(state.settings.includeScreenshotInSolver);
      const autoSolveAfterCapture =
        autoSubmitRequested || Boolean(state.settings.autoSolveAfterCapture);
      const problem = state.problem || (await extractProblem());
      problem.screenshotDataUrl = screenshotDataUrl;
      problem.screenshotRect = rect;
      problem.ocrText = "";
      problem.ocrModel = "";
      problem.ocrSkipped = useDirectImage;
      problem.screenshotMode = mode;
      state.problem = problem;

      renderProblem(problem);
      renderScreenshotStatus(problem);
      renderOcrText("");
      if (useDirectImage) {
        await refreshPromptPreview({ silent: true });
        setStatus(
          mode === "fullPage"
            ? "整页截图完成。当前设置为直接发图，已跳过 OCR。"
            : "截图完成。当前设置为直接发图，已跳过 OCR。",
        );
        showToast(
          autoSubmitRequested && state.settings.autoSubmitAfterFullCapture
            ? "整页截图已完成，准备自动生成并提交。"
            : "这次生成会直接附带截图，不再额外做 OCR。",
        );
        if (autoSolveAfterCapture) {
          await handleSolve({ auto: true });
        }
        if (autoSubmitRequested && state.settings.autoSubmitAfterFullCapture) {
          await handleAutoSubmit();
        }
        return;
      }

      setStatus(mode === "fullPage" ? "整页截图完成，正在调用 OCR..." : "截图完成，正在调用 OCR...");

      const ocrResponse = await sendMessage({
        type: "autolearning:run-ocr",
        imageDataUrl: screenshotDataUrl,
      });
      if (!ocrResponse?.ok || !ocrResponse.ocr?.text) {
        throw new Error(ocrResponse?.error || "OCR 识别失败");
      }

      problem.ocrText = ocrResponse.ocr.text;
      problem.ocrModel = ocrResponse.ocr.model || "";
      problem.ocrSkipped = false;
      state.problem = problem;

      renderProblem(problem);
      renderOcrText(problem.ocrText);
      await refreshPromptPreview({ silent: true });
      setStatus(
        mode === "fullPage"
          ? "整页截图已完成 OCR，接下来生成会把 OCR 文本发进提示词。"
          : "题面截图已完成 OCR，接下来生成会把 OCR 文本发进提示词。",
      );
      showToast(
        autoSubmitRequested && state.settings.autoSubmitAfterFullCapture
          ? "OCR 已完成，准备自动生成并提交。"
          : "OCR 已完成，接下来生成会直接参考转写后的文本。",
      );
      if (autoSolveAfterCapture) {
        await handleSolve({ auto: true });
      }
      if (autoSubmitRequested && state.settings.autoSubmitAfterFullCapture) {
        await handleAutoSubmit();
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
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

  async function selectScreenshotArea() {
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
      hint.textContent = "拖拽框选题面区域，松开完成，Esc 取消";

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
    return {
      left: Math.min(x1, x2),
      top: Math.min(y1, y2),
      width: Math.abs(x2 - x1),
      height: Math.abs(y2 - y1),
    };
  }

  async function handlePasteCode(options = {}) {
    const auto = Boolean(options.auto);
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
    const titleElement = firstVisible([
      "#task-left-panel .task-header h3",
      "#task-left-panel h3",
      "h1",
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

    const title = normalizeText(titleElement?.innerText || document.title || "未识别标题");
    const statementText = normalizeText(statementElement?.innerText || "");
    const statementHtml = statementElement?.innerHTML || "";
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
      ocrText: state.problem?.ocrText || "",
      ocrModel: state.problem?.ocrModel || "",
      ocrSkipped: Boolean(state.problem?.ocrSkipped),
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
    renderSummary(
      [
        `标题：${problem.title || "未识别"}`,
        `题面长度：${problem.statementText.length} 字`,
        `当前代码：${problem.currentCodeLineCount} 行`,
        `代码来源：${problem.currentCodeSource || "未知"}`,
        `样例数量：${problem.samples.length}`,
        `语言：${problem.limits.language || "未知"}`,
        `截图：${
          problem.screenshotDataUrl
            ? problem.screenshotMode === "fullPage"
              ? "已附带整页截图"
              : "已附带局部截图"
            : "未附带"
        }`,
        `OCR：${problem.ocrSkipped ? "已跳过" : problem.ocrText ? "已识别" : "未识别"}`,
      ].join("\n"),
    );

    elements.details.textContent = JSON.stringify(problem, null, 2);
    renderScreenshotStatus(problem);
    renderOcrText(problem.ocrText || "");
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

  function setStatus(text) {
    elements.status.textContent = text;
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
        if (!matchesShortcut(event, state.settings.screenshotShortcut)) {
          if (!matchesShortcut(event, state.settings.fullPageScreenshotShortcut)) {
            return;
          }
          if (event.repeat || isEditableTarget(event.target)) {
            return;
          }
          event.preventDefault();
          void handleCaptureFullPageScreenshot();
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

      if (state.lastAutoSolveCode === syncResult.text && state.result?.code) {
        return;
      }

      setStatus("检测到你复制了编辑器代码，正在自动生成答案...");
      void handleSolve({ auto: true, sourceCode: syncResult.text });
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
