"use strict";

const STORAGE_KEY = "seenNewScientistArticleLinksV1";
const MAX_LINKS = 5000;
const RETENTION_MS = 365 * 24 * 60 * 60 * 1000;
const DEBUG = true;
const DEBUG_PREFIX = "[MFLAR][BG]";

function debugLog(message, details) {
  if (!DEBUG) {
    return;
  }

  if (typeof details === "undefined") {
    console.log(`${DEBUG_PREFIX} ${message}`);
    return;
  }

  console.log(`${DEBUG_PREFIX} ${message}`, details);
}

function debugError(message, error) {
  if (!DEBUG) {
    return;
  }

  console.error(`${DEBUG_PREFIX} ${message}`, error);
}

function normalizeNewScientistArticleUrl(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl || ""));
    const hostname = parsed.hostname.toLowerCase();
    if (hostname !== "newscientist.com" && hostname !== "www.newscientist.com") {
      return "";
    }

    if (!parsed.pathname.toLowerCase().startsWith("/article/")) {
      return "";
    }

    const path = parsed.pathname.endsWith("/") ? parsed.pathname : `${parsed.pathname}/`;
    return `https://www.newscientist.com${path}`;
  } catch (_error) {
    return "";
  }
}

async function loadSeenLinkMap() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  const candidate = data[STORAGE_KEY];
  if (!candidate || typeof candidate !== "object") {
    return {};
  }

  return candidate;
}

function pruneSeenLinkMap(linkMap) {
  const now = Date.now();
  const entries = Object.entries(linkMap)
    .filter(([url, timestamp]) => typeof url === "string" && typeof timestamp === "number")
    .filter(([, timestamp]) => timestamp > 0 && now - timestamp <= RETENTION_MS)
    .sort((a, b) => b[1] - a[1]);

  const prunedEntries = entries.slice(0, MAX_LINKS);
  return Object.fromEntries(prunedEntries);
}

async function markSeenUrl(normalizedUrl, reason, details = {}) {
  if (normalizedUrl === "") {
    return;
  }

  try {
    const linkMap = await loadSeenLinkMap();
    linkMap[normalizedUrl] = Date.now();

    const pruned = pruneSeenLinkMap(linkMap);
    await chrome.storage.local.set({ [STORAGE_KEY]: pruned });

    debugLog("Marked New Scientist link as seen from background.", {
      reason,
      normalizedUrl,
      totalStored: Object.keys(pruned).length,
      ...details,
    });
  } catch (error) {
    debugError("Failed to mark link as seen from background.", error);
  }
}

async function handleCommittedNavigation(details) {
  if (details.frameId !== 0) {
    return;
  }

  const normalizedUrl = normalizeNewScientistArticleUrl(details.url);
  if (normalizedUrl === "") {
    return;
  }

  await markSeenUrl(normalizedUrl, "webNavigation.onCommitted", {
    tabId: details.tabId,
    transitionType: details.transitionType,
  });
}

async function handleTabUpdatedUrl(tabId, rawUrl, reason) {
  const normalizedUrl = normalizeNewScientistArticleUrl(rawUrl);
  if (normalizedUrl === "") {
    return;
  }

  await markSeenUrl(normalizedUrl, reason, {
    tabId,
  });
}

chrome.runtime.onInstalled.addListener(() => {
  debugLog("Background service worker installed.");
});

chrome.runtime.onStartup.addListener(() => {
  debugLog("Background service worker started.");
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (typeof changeInfo.url === "string") {
    void handleTabUpdatedUrl(tabId, changeInfo.url, "tabs.onUpdated-url");
    return;
  }

  if (changeInfo.status === "complete" && typeof tab.url === "string") {
    void handleTabUpdatedUrl(tabId, tab.url, "tabs.onUpdated-complete");
  }
});

chrome.webNavigation.onCommitted.addListener(details => {
  void handleCommittedNavigation(details);
});
