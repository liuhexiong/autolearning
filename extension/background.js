const DEFAULT_CHOICE_PROMPT =
  "当前页面大概率是选择题、判断题、概念题或简答型理论题。请优先输出最终答案，而不是写完整程序。若题目是单选题，code 字段只放最终选项，例如 A、B、C、D；若是多选题，code 字段只放选项组合，例如 AC；若是判断题，code 字段只放“对”或“错”；若是简短填空或概念问答，code 字段只放最终可直接填写的简短答案。不要输出 main 函数，不要伪造代码。approach 用 3 到 5 句简洁说明你的判断依据，重点使用关键词匹配、概念定义和排除法。";
const DEFAULT_CODE_PROMPT =
  "当前页面大概率是编程题、代码填空题或需要补全模板的题。请优先保留题目指定语言、函数签名、输入输出格式和已有代码骨架，只补上真正缺失的部分。若页面自带代码与题面冲突，优先相信题面和样例。code 字段只放最终可提交或可复制的内容，不要在 code 里混入解释。尽量给出最稳妥、最容易通过样例和评测的做法。";

const DEFAULT_SETTINGS = {
  baseUrl: "https://api.deepseek.com/v1",
  apiKey: "sk-9a70b94a7ec04788952e228c62529c54",
  textBaseUrl: "https://api.deepseek.com/v1",
  textApiKey: "sk-9a70b94a7ec04788952e228c62529c54",
  model: "deepseek-chat",
  textModel: "deepseek-chat",
  imageBaseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
  imageApiKey: "sk-9101f75ca6b24400953e03ba4cc283a5",
  imageModel: "qwen3.5-flash",
  promptMode: "choice",
  extraInstructions: DEFAULT_CHOICE_PROMPT,
  extraInstructionsChoice: DEFAULT_CHOICE_PROMPT,
  extraInstructionsCode: DEFAULT_CODE_PROMPT,
  temperature: 0.2,
  includeScreenshotInSolver: true,
  autoSolveAfterCapture: true,
  screenshotShortcut: "Alt+Shift+S",
  fullPageScreenshotShortcut: "Alt+Shift+F",
  autoSubmitAfterFullCapture: false,
  fullAutoNextDelayMs: 1500,
  autoPickNextDelayMs: 600,
  fullAutoMode: "extract",
  ocrBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
  ocrApiKey: "AIzaSyCt9CvmNYNcX8CGe5k9TLVt_jPNH9veRCc",
  ocrModel: "gemini-3-preview",
  ocrPrompt:
    "请只做 OCR，尽量完整提取图片中的中文、英文、公式、选项和输入输出要求。不要解释，不要总结，只返回纯文本。",
  historyLimit: 50,
};
const HISTORY_STORAGE_KEY = "autolearningSolveHistory";
const MIN_HISTORY_ITEMS = 10;
const MAX_HISTORY_ITEMS = 500;
const ACTIVE_SOLVE_CONTROLLERS = new Map();

chrome.runtime.onInstalled.addListener(async () => {
  const current = await storageGet(DEFAULT_SETTINGS);
  await storageSet({ ...DEFAULT_SETTINGS, ...current });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "autolearning:get-settings") {
    storageGet(DEFAULT_SETTINGS)
      .then((settings) => sendResponse({ ok: true, settings }))
      .catch((error) => sendResponse({ ok: false, error: formatError(error) }));
    return true;
  }

  if (message?.type === "autolearning:solve-problem") {
    const requestId =
      typeof message.requestId === "string" && message.requestId.trim()
        ? message.requestId.trim()
        : `solve-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const controller = new AbortController();
    ACTIVE_SOLVE_CONTROLLERS.set(requestId, controller);

    solveProblem(message.problem, message.extraInstructions, controller)
      .then((result) => sendResponse({ ok: true, result, requestId }))
      .catch((error) => sendResponse({ ok: false, error: formatError(error), requestId }))
      .finally(() => {
        ACTIVE_SOLVE_CONTROLLERS.delete(requestId);
      });
    return true;
  }

  if (message?.type === "autolearning:cancel-solve") {
    const requestId = typeof message.requestId === "string" ? message.requestId.trim() : "";
    const controller = requestId ? ACTIVE_SOLVE_CONTROLLERS.get(requestId) : null;
    if (!controller) {
      sendResponse({ ok: false, error: "当前没有可取消的请求。" });
      return false;
    }

    controller.abort(new Error("请求已取消"));
    sendResponse({ ok: true, requestId });
    return true;
  }

  if (message?.type === "autolearning:get-history") {
    getSolveHistory()
      .then((history) => sendResponse({ ok: true, history }))
      .catch((error) => sendResponse({ ok: false, error: formatError(error) }));
    return true;
  }

  if (message?.type === "autolearning:clear-history") {
    clearSolveHistory()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: formatError(error) }));
    return true;
  }

  if (message?.type === "autolearning:preview-prompt") {
    buildPromptPreview(message.problem, message.extraInstructions)
      .then((preview) => sendResponse({ ok: true, preview }))
      .catch((error) => sendResponse({ ok: false, error: formatError(error) }));
    return true;
  }

  if (message?.type === "autolearning:capture-visible-tab") {
    captureVisibleTab(_sender)
      .then((dataUrl) => sendResponse({ ok: true, dataUrl }))
      .catch((error) => sendResponse({ ok: false, error: formatError(error) }));
    return true;
  }

  if (message?.type === "autolearning:run-ocr") {
    runExternalOcr(message.imageDataUrl)
      .then((ocr) => sendResponse({ ok: true, ocr }))
      .catch((error) => sendResponse({ ok: false, error: formatError(error) }));
    return true;
  }

  if (message?.type === "autolearning:open-options") {
    chrome.runtime.openOptionsPage(() => {
      if (chrome.runtime.lastError) {
        sendResponse({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      sendResponse({ ok: true });
    });
    return true;
  }

  return false;
});

function storageGet(defaults) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(defaults, (items) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(items);
    });
  });
}

function storageSet(values) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(values, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve();
    });
  });
}

function normalizeBaseUrl(baseUrl) {
  const trimmed = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!trimmed) {
    throw new Error("请先在设置页填写 Base URL。");
  }

  if (trimmed.endsWith("/chat/completions")) {
    return trimmed;
  }

  return `${trimmed}/chat/completions`;
}

function buildSolverPrompt(problem, extraInstructions, promptMode = "code") {
  const sampleText =
    Array.isArray(problem?.samples) && problem.samples.length > 0
      ? problem.samples
          .map((sample, index) => {
            return [
              `样例 ${index + 1}`,
              "输入：",
              sample.input || "[空]",
              "输出：",
              sample.output || "[空]",
            ].join("\n");
          })
          .join("\n\n")
      : "页面里没有明确提取到样例。";

  const currentCode = String(problem?.currentCode || "").trim();
  const currentCodeBlock = currentCode ? currentCode : "[当前编辑器为空]";
  const mode = getPromptMode({ promptMode });
  const choiceOptionText =
    Array.isArray(problem?.choiceOptions) && problem.choiceOptions.length > 0
      ? problem.choiceOptions
          .map((option) => {
            const label = String(option?.label || "").trim();
            const text = String(option?.text || "").trim();
            return [label, text].filter(Boolean).join(" ");
          })
          .filter(Boolean)
          .join("\n")
      : "";

  if (mode === "choice") {
    return [
      "请根据题面直接判断最终答案，并返回 JSON。",
      'JSON 格式：{"answer":"A/B/C/D/AC/对/错","summary":"一句话总结","approach":"简短依据"}',
      "只返回合法 JSON，不要使用 markdown 代码块。",
      "answer 必填，只放最终答案；summary 和 approach 尽量简短。",
      extraInstructions ? `额外要求：${extraInstructions}` : "",
      "",
      `标题：${problem?.title || "未识别标题"}`,
      problem?.questionType ? `题型：${problem.questionType}` : "",
      "",
      "题面：",
      problem?.statementText || "[未提取到题面]",
      "",
      choiceOptionText ? ["结构化选项：", choiceOptionText, ""].join("\n") : "",
      problem?.ocrText
        ? ["题面 OCR：", problem.ocrText, ""].join("\n")
        : "",
      sampleText && sampleText !== "页面里没有明确提取到样例。"
        ? ["样例：", sampleText, ""].join("\n")
        : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  return [
    "你是一个帮助学生学习算法题的编程助手。",
    "请基于题面、样例和当前代码生成结果，目标是帮助用户理解并补全正确答案。",
    "右侧当前代码很多时候只是老师提供的模板、填空骨架或起始代码，不一定是用户自己的正确草稿。",
    "请优先根据题面和样例判断真实任务，再决定如何利用当前代码。",
    "如果题面、样例、标题、当前代码之间有明显冲突，优先相信题面和样例，并明确忽略疑似串题、旧题或无关的代码内容。",
    "如果页面中混入多关卡、多段教学说明或无关内容，只聚焦当前标题对应的这一关，不要把其他关卡要求混进答案。",
    "如果当前代码看起来是模板，请在保持函数签名、输入输出约定和已有骨架的前提下补全；如果当前代码明显与题目无关，可以忽略它。",
    "请严格返回 JSON，不要使用 markdown 代码块。",
    'JSON 格式：{"generatedTitle":"AI 生成的题目标题","summary":"一句话总结","problemType":"题型分类","problemDefinition":"AI 对这道题的问题定义","approach":"分步思路","answer":"选择题最终答案","code":"代码题最终可复制内容"}',
    "generatedTitle 请根据题面真实任务重新拟一个简洁明确的题目标题，不要照抄页面脏标题；summary 请简洁说明你最终依据了什么题意；problemType 请给出简洁题型分类；problemDefinition 请用 1 到 2 句话重新定义这道题到底在求什么；approach 请简洁说明关键思路；answer 只在选择题、判断题、填空题这类非代码题里填写最终答案，例如 A、B、C、D、AC、对、错；code 只在代码题里放最终可复制代码，非代码题时留空字符串。",
    extraInstructions ? `额外要求：${extraInstructions}` : "",
    "",
    `标题：${problem?.title || "未识别标题"}`,
    `页面地址：${problem?.url || ""}`,
    `语言：${problem?.limits?.language || "未知"}`,
    `时间限制：${problem?.limits?.time || "未知"}`,
    `内存限制：${problem?.limits?.memory || "未知"}`,
    `题面截图：${
      problem?.screenshotDataUrl
        ? problem?.ocrText
          ? "已截图，并已转写为 OCR 文本"
          : "已截图，但还没有 OCR 文本"
        : "未截图"
    }`,
    `题面 OCR：${problem?.ocrText ? "已附带 OCR 识别文本" : "未附带 OCR 识别文本"}`,
    "",
    "题面：",
    problem?.statementText || "[未提取到题面]",
    "",
    "题面 OCR：",
    problem?.ocrText || "[没有 OCR 文本]",
    "",
    "样例：",
    sampleText,
    "",
    "当前代码：",
    currentCodeBlock,
  ]
    .filter(Boolean)
    .join("\n");
}

async function solveProblem(problem, extraInstructionsOverride, externalController = null) {
  if (!problem || typeof problem !== "object") {
    throw new Error("没有收到有效题目信息。");
  }

  const settings = await storageGet(DEFAULT_SETTINGS);
  const extraInstructions = normalizeExtraInstructions(extraInstructionsOverride, settings);
  const promptMode = getPromptMode(settings);

  const messages = buildSolverMessages(
    problem,
    extraInstructions,
    Boolean(settings.includeScreenshotInSolver),
    promptMode,
  );
  const solverConfig = resolveSolverConfig(settings, messages[1]?.content);
  const url = normalizeBaseUrl(solverConfig.baseUrl);
  const controller = externalController instanceof AbortController ? externalController : new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("请求超时")), 90000);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${solverConfig.apiKey}`,
      },
      body: JSON.stringify({
        model: solverConfig.model,
        temperature: Number(settings.temperature ?? 0.2),
        messages,
      }),
      signal: controller.signal,
    });

    const rawText = await response.text();
    let payload = {};

    try {
      payload = rawText ? JSON.parse(rawText) : {};
    } catch {
      payload = {};
    }

    if (!response.ok) {
      const apiMessage =
        payload?.error?.message ||
        payload?.message ||
        rawText ||
        `请求失败，状态码 ${response.status}`;
      throw new Error(apiMessage);
    }

    const assistantText = readAssistantText(payload);
    const parsed = parseSolverResponse(assistantText);
    const fallbackAnswer = extractChoiceAnswer(parsed.answer || parsed.code || assistantText);
    const finalAnswer = parsed.answer || fallbackAnswer;
    const finalCode =
      promptMode === "choice" && finalAnswer ? parsed.code || finalAnswer : parsed.code;

    if (promptMode === "choice" && !finalAnswer) {
      throw new Error("模型返回里没有识别到最终答案。");
    }

    if (promptMode !== "choice" && !finalCode) {
      throw new Error("模型返回里没有可填充的代码。");
    }

    const result = {
      model: solverConfig.model,
      promptPreview: extractTextContent(messages[1]?.content).slice(0, 1200),
      generatedTitle: parsed.generatedTitle,
      summary: parsed.summary,
      problemType: parsed.problemType,
      problemDefinition: parsed.problemDefinition,
      approach: parsed.approach,
      answer: finalAnswer,
      code: finalCode,
      raw: assistantText,
    };

    await appendSolveHistory(problem, result);
    return result;
  } finally {
    clearTimeout(timeout);
  }
}

async function buildPromptPreview(problem, extraInstructionsOverride) {
  if (!problem || typeof problem !== "object") {
    throw new Error("请先识别题面或读取当前代码。");
  }

  const settings = await storageGet(DEFAULT_SETTINGS);
  const extraInstructions = normalizeExtraInstructions(extraInstructionsOverride, settings);
  const promptMode = getPromptMode(settings);
  const messages = buildSolverMessages(
    problem,
    extraInstructions,
    Boolean(settings.includeScreenshotInSolver),
    promptMode,
  );
  const solverConfig = resolveSolverConfig(settings, messages[1]?.content);

  return {
    model: solverConfig.model,
    promptMode,
    temperature: Number(settings.temperature ?? 0.2),
    extraInstructions,
    system: messages[0].content,
    user: extractTextContent(messages[1].content),
    hasImage: hasImageInMessage(messages[1].content),
    hasOcr: Boolean(problem?.ocrText),
  };
}

function buildSolverMessages(problem, extraInstructions, includeScreenshotInSolver, promptMode = "code") {
  const userPrompt = buildSolverPrompt(problem, extraInstructions, promptMode);
  const screenshotItems = getScreenshotItems(problem);
  const shouldAttachScreenshot = Boolean(includeScreenshotInSolver) && screenshotItems.length > 0;
  const mode = getPromptMode({ promptMode });

  return [
    {
      role: "system",
      content:
        mode === "choice"
          ? "你是一个只做题目判定的助手。输出必须是 JSON。"
          : "你是耐心、严谨的智拓算法助手。你要优先依据题面与样例理解任务，谨慎处理可能串题的标题、代码模板和页面杂质。输出必须是 JSON，并且 code 字段里只放最终可复制内容。",
    },
    {
      role: "user",
      content: shouldAttachScreenshot
        ? [
            {
              type: "text",
              text: userPrompt,
            },
            ...screenshotItems.map((item) => ({
              type: "image_url",
              image_url: {
                url: item.dataUrl,
              },
            })),
          ]
        : userPrompt,
    },
  ];
}

function getScreenshotItems(problem) {
  if (Array.isArray(problem?.screenshotItems) && problem.screenshotItems.length > 0) {
    return problem.screenshotItems
      .map((item) => ({
        dataUrl: typeof item?.dataUrl === "string" ? item.dataUrl : "",
      }))
      .filter((item) => item.dataUrl.startsWith("data:image/"));
  }

  if (typeof problem?.screenshotDataUrl === "string" && problem.screenshotDataUrl.startsWith("data:image/")) {
    return [{ dataUrl: problem.screenshotDataUrl }];
  }

  return [];
}

function normalizeExtraInstructions(overrideValue, settings) {
  if (typeof overrideValue === "string" && overrideValue.trim()) {
    return overrideValue.trim();
  }
  const promptMode = getPromptMode(settings);
  const modeValue =
    promptMode === "choice"
      ? settings?.extraInstructionsChoice
      : settings?.extraInstructionsCode;
  return String(modeValue || settings?.extraInstructions || "").trim();
}

function getPromptMode(settings) {
  return settings?.promptMode === "choice" ? "choice" : "code";
}

function resolveSolverConfig(settings, userContent) {
  const legacyBaseUrl = String(settings?.baseUrl || "").trim();
  const legacyApiKey = String(settings?.apiKey || "").trim();
  const legacyModel = String(settings?.model || "").trim();
  const textBaseUrl = String(settings?.textBaseUrl || legacyBaseUrl || "").trim();
  const textApiKey = String(settings?.textApiKey || legacyApiKey || "").trim();
  const textModel = String(settings?.textModel || legacyModel || "").trim();
  const imageBaseUrl = String(settings?.imageBaseUrl || textBaseUrl || legacyBaseUrl || "").trim();
  const imageApiKey = String(settings?.imageApiKey || textApiKey || legacyApiKey || "").trim();
  const imageModel = String(settings?.imageModel || textModel || legacyModel || "").trim();
  const shouldUseImageModel = hasImageInMessage(userContent);
  const selectedConfig = shouldUseImageModel
    ? {
        baseUrl: imageBaseUrl,
        apiKey: imageApiKey,
        model: imageModel,
      }
    : {
        baseUrl: textBaseUrl,
        apiKey: textApiKey,
        model: textModel,
      };

  if (!selectedConfig.baseUrl) {
    throw new Error(
      shouldUseImageModel
        ? "请先在设置页填写图像 Base URL。"
        : "请先在设置页填写文本 Base URL。",
    );
  }

  if (!selectedConfig.apiKey) {
    throw new Error(
      shouldUseImageModel
        ? "请先在设置页填写图像 API Key。"
        : "请先在设置页填写文本 API Key。",
    );
  }

  if (!selectedConfig.model) {
    throw new Error(
      shouldUseImageModel
        ? "请先在设置页填写图像模型。"
        : "请先在设置页填写文本模型。",
    );
  }

  return selectedConfig;
}

async function captureVisibleTab(sender) {
  const windowId = sender?.tab?.windowId;
  return new Promise((resolve, reject) => {
    chrome.tabs.captureVisibleTab(windowId, { format: "png" }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!dataUrl) {
        reject(new Error("没有捕获到页面截图。"));
        return;
      }
      resolve(dataUrl);
    });
  });
}

async function runExternalOcr(imageDataUrl) {
  if (typeof imageDataUrl !== "string" || !imageDataUrl.startsWith("data:image/")) {
    throw new Error("没有收到有效的截图图片。");
  }

  const settings = await storageGet(DEFAULT_SETTINGS);
  if (!settings.ocrBaseUrl || !settings.ocrApiKey || !settings.ocrModel) {
    throw new Error("请先在设置页填写 OCR Base URL、OCR API Key 和 OCR Model。");
  }

  const url = normalizeBaseUrl(settings.ocrBaseUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90000);
  const ocrPrompt =
    String(settings.ocrPrompt || "").trim() ||
    "请只返回图片中的纯文本 OCR 结果。";
  const systemPrompt =
    "你是 OCR 助手。你的任务是尽量准确提取图片中的文字与公式，并只返回纯文本。";
  const imageBase64 = extractBase64Data(imageDataUrl);

  try {
    let result = await postOcrRequest(url, String(settings.ocrApiKey).trim(), {
      model: String(settings.ocrModel).trim(),
      temperature: 0,
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: ocrPrompt,
            },
            {
              type: "image_url",
              image_url: {
                url: imageDataUrl,
              },
            },
          ],
        },
      ],
    }, controller.signal);

    if (!result.ok && shouldRetryOcrWithInlineImages(result.errorMessage)) {
      result = await postOcrRequest(url, String(settings.ocrApiKey).trim(), {
        model: String(settings.ocrModel).trim(),
        stream: false,
        messages: [
          {
            role: "system",
            content: systemPrompt,
          },
          {
            role: "user",
            content: ocrPrompt,
            images: [imageBase64],
          },
        ],
      }, controller.signal);
    }

    if (!result.ok) {
      throw new Error(result.errorMessage);
    }

    const text = String(readAssistantText(result.payload) || "").trim();
    if (!text) {
      throw new Error("OCR 没有返回可用文本。");
    }

    return {
      model: String(settings.ocrModel).trim(),
      text,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function postOcrRequest(url, apiKey, body, signal) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  });

  const rawText = await response.text();
  let payload = {};

  try {
    payload = rawText ? JSON.parse(rawText) : {};
  } catch {
    payload = {};
  }

  if (!response.ok) {
    return {
      ok: false,
      payload,
      errorMessage:
        payload?.error?.message ||
        payload?.message ||
        rawText ||
        `OCR 请求失败，状态码 ${response.status}`,
    };
  }

  return { ok: true, payload, errorMessage: "" };
}

function shouldRetryOcrWithInlineImages(errorMessage) {
  const message = String(errorMessage || "");
  return /unknown variant [`'"]image_url/i.test(message) || /messages\[\d+\].*content/i.test(message);
}

function extractBase64Data(dataUrl) {
  const match = String(dataUrl || "").match(/^data:image\/[^;]+;base64,(.+)$/);
  if (!match?.[1]) {
    throw new Error("OCR 截图不是有效的 base64 图片。");
  }
  return match[1];
}

function extractTextContent(content) {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (item?.type === "text") {
          return item.text || "";
        }
        if (item?.type === "image_url") {
          return "[已附带题面截图]";
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }

  return "";
}

function hasImageInMessage(content) {
  return Array.isArray(content) && content.some((item) => item?.type === "image_url");
}

function readAssistantText(payload) {
  if (typeof payload?.message?.content === "string") {
    return payload.message.content;
  }

  if (typeof payload?.response === "string") {
    return payload.response;
  }

  const content = payload?.choices?.[0]?.message?.content;

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }
        if (item?.type === "text") {
          return item.text || "";
        }
        return "";
      })
      .join("\n");
  }

  return "";
}

function parseSolverResponse(text) {
  const cleaned = String(text || "").trim();
  const jsonCandidate = extractJsonCandidate(cleaned);

  try {
    const parsed = JSON.parse(jsonCandidate);
    return {
      generatedTitle: String(parsed.generatedTitle || parsed.aiTitle || parsed.title || "").trim(),
      summary: String(parsed.summary || parsed.result || "").trim(),
      problemType: String(parsed.problemType || parsed.category || parsed.type || "").trim(),
      problemDefinition: String(
        parsed.problemDefinition || parsed.problem || parsed.taskDefinition || "",
      ).trim(),
      approach: String(parsed.approach || parsed.analysis || "").trim(),
      answer: String(parsed.answer || parsed.finalAnswer || "").trim(),
      code: stripCodeFence(String(parsed.code || "").trim()),
    };
  } catch {
    return {
      generatedTitle: "",
      summary: "",
      problemType: "",
      problemDefinition: "",
      approach: "",
      answer: "",
      code: stripCodeFence(cleaned),
    };
  }
}

function extractChoiceAnswer(text) {
  const value = String(text || "").trim();
  if (!value) {
    return "";
  }

  const normalized = value
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const answerMatch =
    normalized.match(/(?:答案|answer|final answer)\s*[:：]?\s*([A-D]{1,4}|对|错)/i) ||
    normalized.match(/\b([A-D]{1,4})\b/) ||
    normalized.match(/^(对|错)$/);

  return answerMatch?.[1] ? String(answerMatch[1]).toUpperCase() : "";
}

async function getSolveHistory() {
  const items = await storageGet({ [HISTORY_STORAGE_KEY]: [] });
  return Array.isArray(items[HISTORY_STORAGE_KEY]) ? items[HISTORY_STORAGE_KEY] : [];
}

async function clearSolveHistory() {
  await storageSet({ [HISTORY_STORAGE_KEY]: [] });
}

async function appendSolveHistory(problem, result) {
  const settings = await storageGet(DEFAULT_SETTINGS);
  const historyLimit = normalizeHistoryLimit(settings?.historyLimit);
  const history = await getSolveHistory();
  const nextItem = {
    id: `solve-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    savedAt: new Date().toISOString(),
    title: String(result?.generatedTitle || problem?.title || "").trim(),
    sourceTitle: String(problem?.title || "").trim(),
    pageUrl: String(problem?.url || "").trim(),
    language: String(problem?.limits?.language || "").trim(),
    model: String(result?.model || "").trim(),
    generatedTitle: String(result?.generatedTitle || "").trim(),
    problemType: String(result?.problemType || "").trim(),
    problemDefinition: String(result?.problemDefinition || "").trim(),
    summary: String(result?.summary || "").trim(),
    approach: String(result?.approach || "").trim(),
    answer: String(result?.answer || "").trim(),
    code: String(result?.code || ""),
  };

  await storageSet({
    [HISTORY_STORAGE_KEY]: [nextItem, ...history].slice(0, historyLimit),
  });
}

function normalizeHistoryLimit(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_SETTINGS.historyLimit;
  }
  return Math.min(MAX_HISTORY_ITEMS, Math.max(MIN_HISTORY_ITEMS, Math.round(parsed)));
}

function extractJsonCandidate(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1);
  }

  return text;
}

function stripCodeFence(text) {
  const fenced = String(text || "").trim().match(/```(?:[\w+-]+)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }
  return String(text || "").trim();
}

function formatError(error) {
  if (isAbortLikeError(error)) {
    return "请求已取消";
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error || "未知错误");
}

function isAbortLikeError(error) {
  return (
    error?.name === "AbortError" ||
    (error instanceof Error && /aborted|abort|取消/u.test(error.message || ""))
  );
}
