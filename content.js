(() => {
  "use strict";

  const STORAGE_KEY = "seenNewScientistArticleLinksV1";
  const DECORATED_CLASS = "mflar-seen-from-feeds";
  const MAX_LINKS = 5000;
  const RETENTION_MS = 365 * 24 * 60 * 60 * 1000;
  const DEBUG = true;
  const DEBUG_PREFIX = "[MFLAR]";

  let pendingWriteUrls = new Set();
  let flushPromise = null;

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

  function notifyBackgroundFeedsTabActive(reason = "unknown") {
    if (!isFeedsPage()) {
      return;
    }

    if (!chrome.runtime || typeof chrome.runtime.sendMessage !== "function") {
      return;
    }

    chrome.runtime.sendMessage({
      type: "mflar-feeds-tab-active",
      href: window.location.href,
      reason,
    })
      .then(response => {
        debugLog("Reported active feeds tab to background.", {
          reason,
          response,
        });
      })
      .catch(error => {
        debugError("Failed to report active feeds tab to background.", error);
      });
  }

  function normalizeNewScientistArticleUrl(rawUrl) {
    try {
      const parsed = new URL(String(rawUrl || ""), window.location.href);
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

  function isFeedsPage() {
    if (document.getElementById("feeds-reader-root")) {
      return true;
    }

    if (document.querySelector(".feed-article-card[data-article-link]")) {
      return true;
    }

    const path = String(window.location.pathname || "").toLowerCase();
    return path === "/feeds" || path.startsWith("/feeds/");
  }

  function isNewScientistPage() {
    const hostname = String(window.location.hostname || "").toLowerCase();
    return hostname === "newscientist.com" || hostname === "www.newscientist.com";
  }

  async function loadSeenLinkMap() {
    const data = await chrome.storage.local.get(STORAGE_KEY);
    const candidate = data[STORAGE_KEY];
    if (!candidate || typeof candidate !== "object") {
      debugLog("No seen-link map found in storage yet.");
      return {};
    }

    debugLog("Loaded seen-link map from storage.", {
      entries: Object.keys(candidate).length,
    });

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

  async function flushPendingFeedLinks() {
    if (flushPromise !== null) {
      debugLog("Flush already in progress; reusing current promise.");
      return flushPromise;
    }

    debugLog("Starting flush of pending feed links.", {
      pendingCount: pendingWriteUrls.size,
    });

    flushPromise = (async () => {
      while (pendingWriteUrls.size > 0) {
        const urlsToPersist = Array.from(pendingWriteUrls);
        pendingWriteUrls = new Set();

        debugLog("Persisting pending links batch.", {
          batchCount: urlsToPersist.length,
          sample: urlsToPersist[0] || "",
        });

        try {
          const linkMap = await loadSeenLinkMap();
          const now = Date.now();
          urlsToPersist.forEach(url => {
            linkMap[url] = now;
          });

          const pruned = pruneSeenLinkMap(linkMap);
          await chrome.storage.local.set({ [STORAGE_KEY]: pruned });
          debugLog("Persisted seen-link map.", {
            totalStored: Object.keys(pruned).length,
          });
        } catch (_error) {
          debugError("Failed to persist seen-link map.", _error);
        }
      }
    })();

    try {
      await flushPromise;
    } finally {
      flushPromise = null;
      debugLog("Flush complete.");
    }
  }

  function queueSeenFeedLink(url) {
    if (url === "") {
      return;
    }

    pendingWriteUrls.add(url);
    debugLog("Queued seen link.", {
      url,
      pendingCount: pendingWriteUrls.size,
    });

    if (flushPromise !== null) {
      return;
    }

    void flushPendingFeedLinks();
  }

  function getEventTargetElement(event) {
    if (event.target instanceof Element) {
      return event.target;
    }

    if (event.target instanceof Node && event.target.parentElement instanceof Element) {
      return event.target.parentElement;
    }

    return null;
  }

  function trackFeedsLinkActivation(event) {
    if (!isFeedsPage()) {
      return;
    }

    if (event.defaultPrevented) {
      return;
    }

    if (event.type === "click" && event.button !== 0) {
      return;
    }

    if (event.type === "auxclick" && event.button !== 1) {
      return;
    }

    const target = getEventTargetElement(event);
    if (!target) {
      return;
    }

    const link = target.closest("a[href]");
    if (!(link instanceof HTMLAnchorElement)) {
      return;
    }

    const normalized = normalizeNewScientistArticleUrl(link.href);
    if (normalized === "") {
      return;
    }

    debugLog("Captured feed link activation.", {
      eventType: event.type,
      href: link.href,
      normalized,
    });

    queueSeenFeedLink(normalized);
  }

  function trackFeedsKeyActivation(event) {
    if (!isFeedsPage()) {
      return;
    }

    if (event.defaultPrevented || event.key !== "Enter") {
      return;
    }

    const activeElement = document.activeElement;
    if (!(activeElement instanceof HTMLAnchorElement)) {
      return;
    }

    const normalized = normalizeNewScientistArticleUrl(activeElement.href);
    if (normalized === "") {
      return;
    }

    debugLog("Captured feed keyboard activation.", {
      key: event.key,
      href: activeElement.href,
      normalized,
    });

    queueSeenFeedLink(normalized);
  }

  function collectAnchors(root) {
    const anchors = [];

    if (root instanceof HTMLAnchorElement) {
      anchors.push(root);
      return anchors;
    }

    if (root instanceof Document || root instanceof Element) {
      if (root instanceof Element && root.matches("a[href]")) {
        anchors.push(root);
      }

      anchors.push(...root.querySelectorAll("a[href]"));
    }

    return anchors;
  }

  function ensureDecoratorStyle() {
    const existing = document.getElementById("mflar-style");
    if (existing) {
      return;
    }

    const style = document.createElement("style");
    style.id = "mflar-style";
    style.textContent = [
      `a.${DECORATED_CLASS},`,
      `a.${DECORATED_CLASS} * {`,
      "  color: dimgrey !important;",
      "}"
    ].join("\n");

    const head = document.head || document.documentElement;
    head.appendChild(style);
  }

  function applyDecorations(root, seenUrlSet, reason = "unknown") {
    const anchors = collectAnchors(root);
    let decoratedCount = 0;
    let matchedCount = 0;

    anchors.forEach(anchor => {
      const normalized = normalizeNewScientistArticleUrl(anchor.href);
      if (normalized === "") {
        return;
      }

      if (seenUrlSet.has(normalized)) {
        matchedCount += 1;
        anchor.classList.add(DECORATED_CLASS);
        decoratedCount += 1;
      } else {
        anchor.classList.remove(DECORATED_CLASS);
      }
    });

    if (reason !== "mutation" || matchedCount > 0) {
      debugLog("Decoration pass complete.", {
        reason,
        scannedAnchors: anchors.length,
        matchedCount,
        decoratedCount,
      });
    }
  }

  async function setupFeedsTracker() {
    debugLog("Setting up feeds tracker listeners.", {
      href: window.location.href,
    });

    notifyBackgroundFeedsTabActive("setup");

    document.addEventListener("click", trackFeedsLinkActivation, true);
    document.addEventListener("auxclick", trackFeedsLinkActivation, true);
    document.addEventListener("keydown", trackFeedsKeyActivation, true);
    window.addEventListener("focus", () => {
      notifyBackgroundFeedsTabActive("focus");
    });
    window.addEventListener("pagehide", () => {
      debugLog("pagehide observed, forcing pending flush.");
      notifyBackgroundFeedsTabActive("pagehide");
      void flushPendingFeedLinks();
    });
  }

  async function setupNewScientistDecorator() {
    debugLog("Setting up New Scientist decorator.", {
      href: window.location.href,
    });

    ensureDecoratorStyle();

    const seenMap = await loadSeenLinkMap();
    let seenUrlSet = new Set(Object.keys(pruneSeenLinkMap(seenMap)));
    debugLog("Initial seen-link set ready.", {
      size: seenUrlSet.size,
    });
    applyDecorations(document, seenUrlSet, "initial");

    const observer = new MutationObserver(mutations => {
      mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
          if (node instanceof Element) {
            applyDecorations(node, seenUrlSet, "mutation");
          }
        });
      });
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local" || !Object.prototype.hasOwnProperty.call(changes, STORAGE_KEY)) {
        return;
      }

      const newValue = changes[STORAGE_KEY].newValue;
      if (!newValue || typeof newValue !== "object") {
        seenUrlSet = new Set();
      } else {
        seenUrlSet = new Set(Object.keys(pruneSeenLinkMap(newValue)));
      }

      debugLog("Storage changed; refreshing decorations.", {
        size: seenUrlSet.size,
      });
      applyDecorations(document, seenUrlSet, "storage-change");
    });
  }

  const feedsPage = isFeedsPage();
  const newScientistPage = isNewScientistPage();

  debugLog("Content script initialized.", {
    href: window.location.href,
    feedsPage,
    newScientistPage,
  });

  if (feedsPage) {
    setupFeedsTracker();
  }

  if (newScientistPage) {
    setupNewScientistDecorator();
  }
})();
