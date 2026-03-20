const { safeJsonParse } = require("./utils");

function getGitHubConfig() {
  return {
    oauthClientId: String(process.env.GITHUB_OAUTH_CLIENT_ID || "").trim(),
    oauthClientSecret: String(process.env.GITHUB_OAUTH_CLIENT_SECRET || "").trim(),
    repoToken: String(process.env.GITHUB_REPO_TOKEN || "").trim(),
    repoOwner: String(process.env.GITHUB_REPO_OWNER || "").trim(),
    repoName: String(process.env.GITHUB_REPO_NAME || "").trim(),
    repoBranch: String(process.env.GITHUB_REPO_BRANCH || "main").trim(),
  };
}

function hasGitHubOAuthConfig() {
  const config = getGitHubConfig();
  return Boolean(config.oauthClientId && config.oauthClientSecret);
}

function hasGitHubRepoConfig() {
  const config = getGitHubConfig();
  return Boolean(config.repoToken && config.repoOwner && config.repoName);
}

async function exchangeCodeForAccessToken(code) {
  const config = getGitHubConfig();
  if (!config.oauthClientId || !config.oauthClientSecret) {
    throw new Error("GitHub OAuth 尚未配置。");
  }

  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: config.oauthClientId,
      client_secret: config.oauthClientSecret,
      code,
    }),
  });

  const payload = safeJsonParse(await response.text(), {});
  if (!response.ok || !payload?.access_token) {
    throw new Error(payload?.error_description || payload?.error || "GitHub OAuth token 交换失败。");
  }
  return String(payload.access_token);
}

async function fetchGitHubUser(accessToken) {
  const response = await fetch("https://api.github.com/user", {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": "autolearing-server",
    },
  });
  const payload = safeJsonParse(await response.text(), {});
  if (!response.ok || !payload?.id) {
    throw new Error(payload?.message || "获取 GitHub 用户信息失败。");
  }
  return {
    githubId: String(payload.id),
    login: String(payload.login || ""),
    name: String(payload.name || payload.login || ""),
    avatarUrl: String(payload.avatar_url || ""),
    profileUrl: String(payload.html_url || ""),
  };
}

async function syncCategoryFileToGitHub(category, questions) {
  const config = getGitHubConfig();
  if (!hasGitHubRepoConfig()) {
    return { synced: false, reason: "missing_repo_config" };
  }

  const path = `${category}.json`;
  const apiUrl = `https://api.github.com/repos/${config.repoOwner}/${config.repoName}/contents/${path}`;
  const payload = {
    version: 1,
    name: category,
    questions,
  };

  let currentSha = "";
  const currentResponse = await fetch(`${apiUrl}?ref=${encodeURIComponent(config.repoBranch)}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${config.repoToken}`,
      "User-Agent": "autolearing-server",
    },
  });
  if (currentResponse.ok) {
    const currentPayload = safeJsonParse(await currentResponse.text(), {});
    currentSha = String(currentPayload?.sha || "");
  }

  const putResponse = await fetch(apiUrl, {
    method: "PUT",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${config.repoToken}`,
      "User-Agent": "autolearing-server",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: `sync ${category} question bank`,
      branch: config.repoBranch,
      sha: currentSha || undefined,
      content: Buffer.from(JSON.stringify(payload, null, 2), "utf8").toString("base64"),
    }),
  });

  const putPayload = safeJsonParse(await putResponse.text(), {});
  if (!putResponse.ok) {
    throw new Error(putPayload?.message || "同步 GitHub 题库失败。");
  }

  return {
    synced: true,
    commitSha: String(putPayload?.commit?.sha || ""),
  };
}

module.exports = {
  exchangeCodeForAccessToken,
  fetchGitHubUser,
  getGitHubConfig,
  hasGitHubOAuthConfig,
  hasGitHubRepoConfig,
  syncCategoryFileToGitHub,
};
