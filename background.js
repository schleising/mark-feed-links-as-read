"use strict";

const SEEN_LINK_STORAGE_KEY = "seenHistoryLinksV1";
const LEGACY_SEEN_LINK_STORAGE_KEY = "seenNewScientistArticleLinksV1";
const HISTORY_DOMAINS_STORAGE_KEY = "historyDomainsV1";
const MAX_LINKS = 5000;
const RETENTION_MS = 365 * 24 * 60 * 60 * 1000;

let trackedHistoryDomains = [];
let trackedHistoryDomainsLoaded = false;

function normalizeDomainPattern(rawPattern) {
  let pattern = String(rawPattern || "").trim().toLowerCase();
  if (pattern === "") {
    return "";
  }

  if (pattern.startsWith("http://") || pattern.startsWith("https://")) {
    try {
      pattern = new URL(pattern).hostname.toLowerCase();
    } catch (_error) {
      return "";
    }
  }

  if (pattern.includes("/")) {
    pattern = pattern.split("/")[0];
  }

  if (pattern.startsWith(".")) {
    pattern = pattern.slice(1);
  }

  return pattern;
}

function normalizeHistoryDomains(candidateDomains) {
  if (!Array.isArray(candidateDomains)) {
    return [];
  }

  const unique = new Set();

  candidateDomains.forEach(candidate => {
    const normalized = normalizeDomainPattern(candidate);
    if (normalized !== "") {
      unique.add(normalized);
    }
  });

  return Array.from(unique);
}

function escapeRegexLiteral(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function doesDomainPatternMatch(rawPattern, rawHostname) {
  const pattern = normalizeDomainPattern(rawPattern);
  const hostname = String(rawHostname || "").trim().toLowerCase().replace(/\.$/, "");

  if (pattern === "" || hostname === "") {
    return false;
  }

  if (pattern === "*") {
    return true;
  }

  if (pattern.startsWith("*.")) {
    const baseHost = pattern.slice(2);
    if (baseHost === "") {
      return false;
    }

    return hostname === baseHost || hostname.endsWith(`.${baseHost}`);
  }

  if (!pattern.includes("*")) {
    return hostname === pattern;
  }

  const wildcardRegex = new RegExp(`^${pattern.split("*").map(escapeRegexLiteral).join(".*")}$`);
  return wildcardRegex.test(hostname);
}

function normalizeTrackedUrl(rawUrl, trackedDomains) {
  try {
    const parsed = new URL(String(rawUrl || ""));
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "";
    }

    const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
    const matchesTrackedDomain = trackedDomains.some(pattern => doesDomainPatternMatch(pattern, hostname));
    if (!matchesTrackedDomain) {
      return "";
    }

    parsed.hash = "";
    return parsed.toString();
  } catch (_error) {
    return "";
  }
}

async function loadSeenLinkMap() {
  const data = await chrome.storage.local.get([
    SEEN_LINK_STORAGE_KEY,
    LEGACY_SEEN_LINK_STORAGE_KEY,
  ]);

  const primaryCandidate = data[SEEN_LINK_STORAGE_KEY];
  if (primaryCandidate && typeof primaryCandidate === "object") {
    return primaryCandidate;
  }

  const legacyCandidate = data[LEGACY_SEEN_LINK_STORAGE_KEY];
  if (legacyCandidate && typeof legacyCandidate === "object") {
    return legacyCandidate;
  }

  return {};
}

async function maybeMigrateLegacySeenLinkMap() {
  try {
    const data = await chrome.storage.local.get([
      SEEN_LINK_STORAGE_KEY,
      LEGACY_SEEN_LINK_STORAGE_KEY,
    ]);

    const current = data[SEEN_LINK_STORAGE_KEY];
    if (current && typeof current === "object") {
      return;
    }

    const legacy = data[LEGACY_SEEN_LINK_STORAGE_KEY];
    if (!legacy || typeof legacy !== "object") {
      return;
    }

    const pruned = pruneSeenLinkMap(legacy);
    await chrome.storage.local.set({ [SEEN_LINK_STORAGE_KEY]: pruned });
  } catch (_error) {
    // Intentionally ignored; migration will retry on next startup/event.
  }
}

async function loadTrackedHistoryDomains() {
  const data = await chrome.storage.local.get(HISTORY_DOMAINS_STORAGE_KEY);
  return normalizeHistoryDomains(data[HISTORY_DOMAINS_STORAGE_KEY]);
}

async function refreshTrackedHistoryDomains(reason) {
  try {
    trackedHistoryDomains = await loadTrackedHistoryDomains();
    trackedHistoryDomainsLoaded = true;
  } catch (_error) {
    // Intentionally ignored; domains will retry on next load path.
  }
}

async function ensureTrackedHistoryDomainsLoaded() {
  if (trackedHistoryDomainsLoaded) {
    return;
  }

  await refreshTrackedHistoryDomains("lazy-load");
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
    await chrome.storage.local.set({ [SEEN_LINK_STORAGE_KEY]: pruned });
  } catch (_error) {
    // Intentionally ignored; failed writes should not break navigation handlers.
  }
}

async function handleCommittedNavigation(details) {
  if (details.frameId !== 0) {
    return;
  }

  await ensureTrackedHistoryDomainsLoaded();

  const normalizedUrl = normalizeTrackedUrl(details.url, trackedHistoryDomains);
  if (normalizedUrl === "") {
    return;
  }

  await markSeenUrl(normalizedUrl, "webNavigation.onCommitted", {
    tabId: details.tabId,
    transitionType: details.transitionType,
  });
}

chrome.runtime.onInstalled.addListener(() => {
  void maybeMigrateLegacySeenLinkMap();
  void refreshTrackedHistoryDomains("onInstalled");
});

chrome.runtime.onStartup.addListener(() => {
  void maybeMigrateLegacySeenLinkMap();
  void refreshTrackedHistoryDomains("onStartup");
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (
    areaName !== "local" ||
    !Object.prototype.hasOwnProperty.call(changes, HISTORY_DOMAINS_STORAGE_KEY)
  ) {
    return;
  }

  trackedHistoryDomains = normalizeHistoryDomains(changes[HISTORY_DOMAINS_STORAGE_KEY].newValue);
  trackedHistoryDomainsLoaded = true;
});

chrome.webNavigation.onCommitted.addListener(details => {
  void handleCommittedNavigation(details);
});

void maybeMigrateLegacySeenLinkMap();
void refreshTrackedHistoryDomains("startup-eval");
