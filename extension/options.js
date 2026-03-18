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

const form = document.getElementById("settings-form");
const statusNode = document.getElementById("status");
const resetButton = document.getElementById("reset");

void hydrateForm();

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const values = {
    baseUrl: document.getElementById("baseUrl").value.trim(),
    apiKey: document.getElementById("apiKey").value.trim(),
    model: document.getElementById("model").value.trim(),
    extraInstructions: document.getElementById("extraInstructions").value.trim(),
    includeScreenshotInSolver: document.getElementById("includeScreenshotInSolver").checked,
    autoSolveAfterCapture: document.getElementById("autoSolveAfterCapture").checked,
    screenshotShortcut:
      normalizeShortcut(document.getElementById("screenshotShortcut").value) ||
      DEFAULT_SETTINGS.screenshotShortcut,
    fullPageScreenshotShortcut:
      normalizeShortcut(document.getElementById("fullPageScreenshotShortcut").value) ||
      DEFAULT_SETTINGS.fullPageScreenshotShortcut,
    autoSubmitAfterFullCapture: document.getElementById("autoSubmitAfterFullCapture").checked,
    ocrBaseUrl: document.getElementById("ocrBaseUrl").value.trim(),
    ocrApiKey: document.getElementById("ocrApiKey").value.trim(),
    ocrModel: document.getElementById("ocrModel").value.trim(),
    ocrPrompt: document.getElementById("ocrPrompt").value.trim(),
    temperature: DEFAULT_SETTINGS.temperature,
  };

  await storageSet(values);
  setStatus("设置已保存。");
});

resetButton.addEventListener("click", async () => {
  await storageSet(DEFAULT_SETTINGS);
  await hydrateForm();
  setStatus("已恢复默认值。");
});

async function hydrateForm() {
  const values = await storageGet(DEFAULT_SETTINGS);
  document.getElementById("baseUrl").value = values.baseUrl || "";
  document.getElementById("apiKey").value = values.apiKey || "";
  document.getElementById("model").value = values.model || "";
  document.getElementById("extraInstructions").value = values.extraInstructions || "";
  document.getElementById("includeScreenshotInSolver").checked = Boolean(
    values.includeScreenshotInSolver,
  );
  document.getElementById("autoSolveAfterCapture").checked = Boolean(values.autoSolveAfterCapture);
  document.getElementById("screenshotShortcut").value =
    normalizeShortcut(values.screenshotShortcut) || DEFAULT_SETTINGS.screenshotShortcut;
  document.getElementById("fullPageScreenshotShortcut").value =
    normalizeShortcut(values.fullPageScreenshotShortcut) ||
    DEFAULT_SETTINGS.fullPageScreenshotShortcut;
  document.getElementById("autoSubmitAfterFullCapture").checked = Boolean(
    values.autoSubmitAfterFullCapture,
  );
  document.getElementById("ocrBaseUrl").value = values.ocrBaseUrl || "";
  document.getElementById("ocrApiKey").value = values.ocrApiKey || "";
  document.getElementById("ocrModel").value = values.ocrModel || "";
  document.getElementById("ocrPrompt").value = values.ocrPrompt || "";
}

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

function setStatus(text) {
  statusNode.textContent = text;
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
