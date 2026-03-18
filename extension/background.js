const DEFAULT_SETTINGS = {
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-4.1-mini",
  extraInstructions: "",
  temperature: 0.2,
  includeScreenshotInSolver: false,
  autoSolveAfterCapture: false,
  screenshotShortcut: "Alt+Shift+S",
  fullPageScreenshotShortcut: "Alt+Shift+F",
  autoSubmitAfterFullCapture: false,
  ocrBaseUrl: "",
  ocrApiKey: "",
  ocrModel: "",
  ocrPrompt:
    "请只做 OCR，尽量完整提取图片中的中文、英文、公式、选项和输入输出要求。不要解释，不要总结，只返回纯文本。",
};
const HISTORY_STORAGE_KEY = "autolearningSolveHistory";
const MAX_HISTORY_ITEMS = 50;

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
    solveProblem(message.problem, message.extraInstructions)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: formatError(error) }));
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

function buildSolverPrompt(problem, extraInstructions) {
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

  return [
    "你是一个帮助学生学习算法题的编程助手。",
    "请基于题面、样例和当前代码生成结果，目标是帮助用户理解并补全正确答案。",
    "右侧当前代码很多时候只是老师提供的模板、填空骨架或起始代码，不一定是用户自己的正确草稿。",
    "请优先根据题面和样例判断真实任务，再决定如何利用当前代码。",
    "如果题面、样例、标题、当前代码之间有明显冲突，优先相信题面和样例，并明确忽略疑似串题、旧题或无关的代码内容。",
    "如果页面中混入多关卡、多段教学说明或无关内容，只聚焦当前标题对应的这一关，不要把其他关卡要求混进答案。",
    "如果当前代码看起来是模板，请在保持函数签名、输入输出约定和已有骨架的前提下补全；如果当前代码明显与题目无关，可以忽略它。",
    "请严格返回 JSON，不要使用 markdown 代码块。",
    'JSON 格式：{"generatedTitle":"AI 生成的题目标题","summary":"一句话总结","problemType":"题型分类","problemDefinition":"AI 对这道题的问题定义","approach":"分步思路","code":"最终代码"}',
    "generatedTitle 请根据题面真实任务重新拟一个简洁明确的题目标题，不要照抄页面脏标题；summary 请简洁说明你最终依据了什么题意；problemType 请给出简洁题型分类；problemDefinition 请用 1 到 2 句话重新定义这道题到底在求什么；approach 请简洁说明关键思路；code 只放最终代码字符串。",
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

async function solveProblem(problem, extraInstructionsOverride) {
  if (!problem || typeof problem !== "object") {
    throw new Error("没有收到有效题目信息。");
  }

  const settings = await storageGet(DEFAULT_SETTINGS);
  const extraInstructions = normalizeExtraInstructions(
    extraInstructionsOverride,
    settings.extraInstructions,
  );
  if (!settings.apiKey || !String(settings.apiKey).trim()) {
    throw new Error("请先在插件设置页填写 API Key。");
  }

  const messages = buildSolverMessages(
    problem,
    extraInstructions,
    Boolean(settings.includeScreenshotInSolver),
  );

  const url = normalizeBaseUrl(settings.baseUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90000);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${String(settings.apiKey).trim()}`,
      },
      body: JSON.stringify({
        model: settings.model,
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

    if (!parsed.code) {
      throw new Error("模型返回里没有可填充的代码。");
    }

    const result = {
      model: settings.model,
      promptPreview: extractTextContent(messages[1]?.content).slice(0, 1200),
      generatedTitle: parsed.generatedTitle,
      summary: parsed.summary,
      problemType: parsed.problemType,
      problemDefinition: parsed.problemDefinition,
      approach: parsed.approach,
      code: parsed.code,
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
  const extraInstructions = normalizeExtraInstructions(
    extraInstructionsOverride,
    settings.extraInstructions,
  );
  const messages = buildSolverMessages(
    problem,
    extraInstructions,
    Boolean(settings.includeScreenshotInSolver),
  );

  return {
    model: settings.model,
    temperature: Number(settings.temperature ?? 0.2),
    extraInstructions,
    system: messages[0].content,
    user: extractTextContent(messages[1].content),
    hasImage: hasImageInMessage(messages[1].content),
    hasOcr: Boolean(problem?.ocrText),
  };
}

function buildSolverMessages(problem, extraInstructions, includeScreenshotInSolver) {
  const userPrompt = buildSolverPrompt(problem, extraInstructions);
  const shouldAttachScreenshot =
    Boolean(includeScreenshotInSolver) &&
    typeof problem?.screenshotDataUrl === "string" &&
    problem.screenshotDataUrl.startsWith("data:image/");

  return [
    {
      role: "system",
      content:
        "你是耐心、严谨的算法学习助手。你要优先依据题面与样例理解任务，谨慎处理可能串题的标题、代码模板和页面杂质。输出必须是 JSON，并且 code 字段里只放最终代码字符串。",
    },
    {
      role: "user",
      content: shouldAttachScreenshot
        ? [
            {
              type: "text",
              text: userPrompt,
            },
            {
              type: "image_url",
              image_url: {
                url: problem.screenshotDataUrl,
              },
            },
          ]
        : userPrompt,
    },
  ];
}

function normalizeExtraInstructions(overrideValue, storedValue) {
  if (typeof overrideValue === "string") {
    return overrideValue.trim();
  }
  return String(storedValue || "").trim();
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
      code: stripCodeFence(String(parsed.code || "").trim()),
    };
  } catch {
    return {
      generatedTitle: "",
      summary: "",
      problemType: "",
      problemDefinition: "",
      approach: "",
      code: stripCodeFence(cleaned),
    };
  }
}

async function getSolveHistory() {
  const items = await storageGet({ [HISTORY_STORAGE_KEY]: [] });
  return Array.isArray(items[HISTORY_STORAGE_KEY]) ? items[HISTORY_STORAGE_KEY] : [];
}

async function clearSolveHistory() {
  await storageSet({ [HISTORY_STORAGE_KEY]: [] });
}

async function appendSolveHistory(problem, result) {
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
    code: String(result?.code || ""),
  };

  await storageSet({
    [HISTORY_STORAGE_KEY]: [nextItem, ...history].slice(0, MAX_HISTORY_ITEMS),
  });
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
  if (error instanceof Error) {
    return error.message;
  }
  return String(error || "未知错误");
}
