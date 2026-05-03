(() => {
  "use strict";

  const STORAGE_KEY = "seenNewScientistArticleLinksV1";
  const DECORATED_CLASS = "mflar-seen-from-feeds";
  const DEBUG = true;
  const DEBUG_PREFIX = "[MFLAR]";

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

  function ensureScrollbarStyle() {
    const existing = document.getElementById("mflar-scrollbar-style");
    if (existing) {
      return;
    }

    const style = document.createElement("style");
    style.id = "mflar-scrollbar-style";
    style.textContent = [
      "html,",
      "body {",
      "  scrollbar-width: auto !important;",
      "  scrollbar-color: rgba(128, 128, 128, 0.8) #F1F1F1 !important;",
      "}"
    ].join("\n");

    const head = document.head || document.documentElement;
    head.appendChild(style);
  }

  function isSubstackPage() {
    const hostname = String(window.location.hostname || "").toLowerCase();
    return hostname === "substack.com" || hostname === "www.substack.com" || hostname.endsWith(".substack.com");
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

  async function setupNewScientistDecorator() {
    debugLog("Setting up New Scientist decorator.", {
      href: window.location.href,
    });

    ensureDecoratorStyle();

    const seenMap = await loadSeenLinkMap();
    let seenUrlSet = new Set(Object.keys(seenMap));
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
        seenUrlSet = new Set(Object.keys(newValue));
      }

      debugLog("Storage changed; refreshing decorations.", {
        size: seenUrlSet.size,
      });
      applyDecorations(document, seenUrlSet, "storage-change");
    });
  }

  const newScientistPage = isNewScientistPage();
  const substackPage = isSubstackPage();

  if (newScientistPage || substackPage) {
    ensureScrollbarStyle();
  }

  debugLog("Content script initialized.", {
    href: window.location.href,
    newScientistPage,
    substackPage,
  });

  if (newScientistPage) {
    setupNewScientistDecorator();
  }
})();
