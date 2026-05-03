"use strict";

const STORAGE_KEY = "seenNewScientistArticleLinksV1";
const MAX_LINKS = 5000;
const RETENTION_MS = 365 * 24 * 60 * 60 * 1000;
const FEEDS_TAB_TTL_MS = 12 * 60 * 60 * 1000;
const DEBUG = true;
const DEBUG_PREFIX = "[MFLAR][BG]";

/** @type {Map<number, number>} */
const feedsTabRegistry = new Map();

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

function isLikelyFeedsUrl(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl || ""));
    const path = parsed.pathname.toLowerCase();
    if (path === "/feeds" || path === "/feeds/" || path.startsWith("/feeds/")) {
      return true;
    }

    // Fallback for web-app host routes where feeds may be mounted at root.
    const query = parsed.searchParams;
    return query.has("category") && !path.startsWith("/article/");
  } catch (_error) {
    return false;
  }
}

function isLikelyFeedsTitle(rawTitle) {
  const title = String(rawTitle || "").trim().toLowerCase();
  return title.includes("feeds");
}

function pruneFeedsTabRegistry() {
  const now = Date.now();
  for (const [tabId, timestamp] of feedsTabRegistry.entries()) {
    if (now - timestamp > FEEDS_TAB_TTL_MS) {
      feedsTabRegistry.delete(tabId);
    }
  }
}

function registerFeedsTab(tabId, reason = "unknown") {
  if (!Number.isInteger(tabId) || tabId < 0) {
    return;
  }

  feedsTabRegistry.set(tabId, Date.now());
  pruneFeedsTabRegistry();
  debugLog("Registered feeds source tab.", {
    tabId,
    reason,
    registrySize: feedsTabRegistry.size,
  });
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

async function isFeedsSourceTab(sourceTabId) {
  pruneFeedsTabRegistry();
  if (feedsTabRegistry.has(sourceTabId)) {
    return true;
  }

  try {
    const tab = await chrome.tabs.get(sourceTabId);
    if (isLikelyFeedsUrl(tab.url) || isLikelyFeedsTitle(tab.title)) {
      registerFeedsTab(sourceTabId, "tabs.get-fallback");
      return true;
    }
  } catch (error) {
    debugError("Unable to inspect source tab for feeds fallback.", error);
  }

  return false;
}

async function handleCreatedNavigationTarget(details) {
  const normalizedUrl = normalizeNewScientistArticleUrl(details.url);
  if (normalizedUrl === "") {
    return;
  }

  const sourceTabId = Number(details.sourceTabId);
  if (!Number.isInteger(sourceTabId) || sourceTabId < 0) {
    debugLog("Skipping navigation target with invalid source tab.", {
      sourceTabId: details.sourceTabId,
      targetUrl: details.url,
    });
    return;
  }

  const fromFeeds = await isFeedsSourceTab(sourceTabId);
  if (!fromFeeds) {
    debugLog("Skipping navigation target not originating from feeds tab.", {
      sourceTabId,
      targetUrl: details.url,
    });
    return;
  }

  await markSeenUrl(normalizedUrl, "webNavigation.onCreatedNavigationTarget", {
    sourceTabId,
    targetTabId: details.tabId,
  });
}

async function handleCommittedNavigation(details) {
  if (details.frameId !== 0) {
    return;
  }

  const normalizedUrl = normalizeNewScientistArticleUrl(details.url);
  if (normalizedUrl === "") {
    return;
  }

  let openerTabId = null;
  try {
    const tab = await chrome.tabs.get(details.tabId);
    openerTabId = Number(tab.openerTabId);
  } catch (error) {
    debugError("Unable to inspect committed tab opener.", error);
    return;
  }

  if (!Number.isInteger(openerTabId) || openerTabId < 0) {
    debugLog("Committed NS navigation has no opener tab; skipping.", {
      tabId: details.tabId,
      url: details.url,
      transitionType: details.transitionType,
    });
    return;
  }

  const fromFeeds = await isFeedsSourceTab(openerTabId);
  if (!fromFeeds) {
    debugLog("Committed NS navigation opener is not a feeds tab; skipping.", {
      tabId: details.tabId,
      openerTabId,
      url: details.url,
    });
    return;
  }

  await markSeenUrl(normalizedUrl, "webNavigation.onCommitted-opener", {
    openerTabId,
    targetTabId: details.tabId,
    transitionType: details.transitionType,
  });
}

chrome.runtime.onInstalled.addListener(() => {
  debugLog("Background service worker installed.");
});

chrome.runtime.onStartup.addListener(() => {
  debugLog("Background service worker started.");
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== "mflar-feeds-tab-active") {
    return;
  }

  const tabId = sender && sender.tab ? sender.tab.id : null;
  if (Number.isInteger(tabId)) {
    registerFeedsTab(tabId, String(message.reason || "content-script"));
  }

  sendResponse({ ok: true });
});

chrome.tabs.onRemoved.addListener(tabId => {
  if (feedsTabRegistry.delete(tabId)) {
    debugLog("Removed feeds tab from registry on tab close.", { tabId });
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (typeof changeInfo.url === "string" && isLikelyFeedsUrl(changeInfo.url)) {
    registerFeedsTab(tabId, "tabs.onUpdated-url");
    return;
  }

  if (changeInfo.status === "complete" && (isLikelyFeedsUrl(tab.url) || isLikelyFeedsTitle(tab.title))) {
    registerFeedsTab(tabId, "tabs.onUpdated-complete");
  }
});

chrome.webNavigation.onCreatedNavigationTarget.addListener(details => {
  void handleCreatedNavigationTarget(details);
});

chrome.webNavigation.onCommitted.addListener(details => {
  if (details.frameId === 0 && isLikelyFeedsUrl(details.url)) {
    registerFeedsTab(details.tabId, "webNavigation.onCommitted");
  }

  void handleCommittedNavigation(details);
});
