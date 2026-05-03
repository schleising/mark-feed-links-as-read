"use strict";

const SEEN_LINK_STORAGE_KEY = "seenHistoryLinksV1";
const LEGACY_SEEN_LINK_STORAGE_KEY = "seenNewScientistArticleLinksV1";
const HISTORY_DOMAINS_STORAGE_KEY = "historyDomainsV1";
const CUSTOM_STYLE_RULES_STORAGE_KEY = "customStyleRulesV1";

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

function normalizeCustomStyleRules(candidateRules) {
  if (!Array.isArray(candidateRules)) {
    return [];
  }

  return candidateRules.filter(rule => rule && typeof rule === "object");
}

function normalizeSeenLinkMap(candidateMap) {
  if (!candidateMap || typeof candidateMap !== "object") {
    return {};
  }

  return Object.fromEntries(
    Object.entries(candidateMap).filter(
      ([url, timestamp]) => typeof url === "string" && typeof timestamp === "number" && timestamp > 0
    )
  );
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
  const localData = await chrome.storage.local.get([
    SEEN_LINK_STORAGE_KEY,
    LEGACY_SEEN_LINK_STORAGE_KEY,
  ]);

  const localPrimary = normalizeSeenLinkMap(localData[SEEN_LINK_STORAGE_KEY]);
  if (Object.keys(localPrimary).length > 0) {
    return localPrimary;
  }

  const localLegacy = normalizeSeenLinkMap(localData[LEGACY_SEEN_LINK_STORAGE_KEY]);
  if (Object.keys(localLegacy).length > 0) {
    return localLegacy;
  }

  const syncData = await chrome.storage.sync.get([
    SEEN_LINK_STORAGE_KEY,
    LEGACY_SEEN_LINK_STORAGE_KEY,
  ]);

  const syncPrimary = normalizeSeenLinkMap(syncData[SEEN_LINK_STORAGE_KEY]);
  if (Object.keys(syncPrimary).length > 0) {
    return syncPrimary;
  }

  const syncLegacy = normalizeSeenLinkMap(syncData[LEGACY_SEEN_LINK_STORAGE_KEY]);
  if (Object.keys(syncLegacy).length > 0) {
    return syncLegacy;
  }

  return {};
}

async function migrateStorageData() {
  try {
    const [localData, syncData] = await Promise.all([
      chrome.storage.local.get([
        SEEN_LINK_STORAGE_KEY,
        LEGACY_SEEN_LINK_STORAGE_KEY,
        HISTORY_DOMAINS_STORAGE_KEY,
        CUSTOM_STYLE_RULES_STORAGE_KEY,
      ]),
      chrome.storage.sync.get([
        SEEN_LINK_STORAGE_KEY,
        LEGACY_SEEN_LINK_STORAGE_KEY,
        HISTORY_DOMAINS_STORAGE_KEY,
        CUSTOM_STYLE_RULES_STORAGE_KEY,
      ]),
    ]);

    const localSeenPrimary = normalizeSeenLinkMap(localData[SEEN_LINK_STORAGE_KEY]);
    const localSeenLegacy = normalizeSeenLinkMap(localData[LEGACY_SEEN_LINK_STORAGE_KEY]);

    if (Object.keys(localSeenPrimary).length === 0 && Object.keys(localSeenLegacy).length === 0) {
      const syncSeenPrimary = normalizeSeenLinkMap(syncData[SEEN_LINK_STORAGE_KEY]);
      const syncSeenLegacy = normalizeSeenLinkMap(syncData[LEGACY_SEEN_LINK_STORAGE_KEY]);
      const candidate =
        Object.keys(syncSeenPrimary).length > 0
          ? syncSeenPrimary
          : Object.keys(syncSeenLegacy).length > 0
            ? syncSeenLegacy
            : null;

      if (candidate) {
        await chrome.storage.local.set({ [SEEN_LINK_STORAGE_KEY]: candidate });
      }
    }

    if (!Array.isArray(syncData[HISTORY_DOMAINS_STORAGE_KEY])) {
      const normalizedDomains = normalizeHistoryDomains(localData[HISTORY_DOMAINS_STORAGE_KEY]);
      if (normalizedDomains.length > 0) {
        await chrome.storage.sync.set({
          [HISTORY_DOMAINS_STORAGE_KEY]: normalizedDomains,
        });
      }
    }

    if (!Array.isArray(syncData[CUSTOM_STYLE_RULES_STORAGE_KEY])) {
      const normalizedRules = normalizeCustomStyleRules(localData[CUSTOM_STYLE_RULES_STORAGE_KEY]);
      if (normalizedRules.length > 0) {
        await chrome.storage.sync.set({
          [CUSTOM_STYLE_RULES_STORAGE_KEY]: normalizedRules,
        });
      }
    }
  } catch (_error) {
    // Intentionally ignored.
  }
}

async function loadTrackedHistoryDomains() {
  const syncData = await chrome.storage.sync.get(HISTORY_DOMAINS_STORAGE_KEY);
  if (Array.isArray(syncData[HISTORY_DOMAINS_STORAGE_KEY])) {
    return normalizeHistoryDomains(syncData[HISTORY_DOMAINS_STORAGE_KEY]);
  }

  const localData = await chrome.storage.local.get(HISTORY_DOMAINS_STORAGE_KEY);
  return normalizeHistoryDomains(localData[HISTORY_DOMAINS_STORAGE_KEY]);
}

async function refreshTrackedHistoryDomains() {
  try {
    trackedHistoryDomains = await loadTrackedHistoryDomains();
    trackedHistoryDomainsLoaded = true;
  } catch (_error) {
    // Intentionally ignored.
  }
}

async function ensureTrackedHistoryDomainsLoaded() {
  if (trackedHistoryDomainsLoaded) {
    return;
  }

  await refreshTrackedHistoryDomains();
}

async function markSeenUrl(normalizedUrl) {
  if (normalizedUrl === "") {
    return;
  }

  try {
    const linkMap = await loadSeenLinkMap();
    linkMap[normalizedUrl] = Date.now();
    await chrome.storage.local.set({
      [SEEN_LINK_STORAGE_KEY]: linkMap,
    });
  } catch (_error) {
    // Intentionally ignored.
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

  await markSeenUrl(normalizedUrl);
}

chrome.runtime.onInstalled.addListener(() => {
  void migrateStorageData();
  void refreshTrackedHistoryDomains();
});

chrome.runtime.onStartup.addListener(() => {
  void migrateStorageData();
  void refreshTrackedHistoryDomains();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (
    areaName !== "sync" ||
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

void migrateStorageData();
void refreshTrackedHistoryDomains();
