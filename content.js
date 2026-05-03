(() => {
  "use strict";

  const SEEN_LINK_STORAGE_KEY = "seenNewScientistArticleLinksV1";
  const CUSTOM_STYLE_RULES_STORAGE_KEY = "customStyleRulesV1";
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

  async function loadSeenLinkMap() {
    const data = await chrome.storage.local.get(SEEN_LINK_STORAGE_KEY);
    const candidate = data[SEEN_LINK_STORAGE_KEY];
    if (!candidate || typeof candidate !== "object") {
      debugLog("No seen-link map found in storage yet.");
      return {};
    }

    debugLog("Loaded seen-link map from storage.", {
      entries: Object.keys(candidate).length,
    });

    return candidate;
  }

  async function loadCustomStyleRules() {
    const data = await chrome.storage.local.get(CUSTOM_STYLE_RULES_STORAGE_KEY);
    const candidate = data[CUSTOM_STYLE_RULES_STORAGE_KEY];

    if (!Array.isArray(candidate)) {
      debugLog("No custom style rules found in storage yet.");
      return [];
    }

    const rules = candidate.filter(rule => rule && typeof rule === "object");
    debugLog("Loaded custom style rules from storage.", {
      totalRules: rules.length,
    });

    return rules;
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

  function upsertCustomStyleElement() {
    const existing = document.getElementById("mflar-custom-style");
    if (existing instanceof HTMLStyleElement) {
      return existing;
    }

    const style = document.createElement("style");
    style.id = "mflar-custom-style";

    const head = document.head || document.documentElement;
    head.appendChild(style);

    return style;
  }

  function buildCustomCssRule(rule) {
    const selector = String(rule.selector || "").trim();
    const declarations = String(rule.declarations || "").trim();

    if (selector === "" || declarations === "") {
      return "";
    }

    return `${selector} {\n${declarations}\n}`;
  }

  function applyCustomStyles(rules, reason = "unknown") {
    const hostname = String(window.location.hostname || "").toLowerCase();
    const cssBlocks = [];

    rules.forEach(rule => {
      if (!rule || typeof rule !== "object") {
        return;
      }

      if (rule.enabled === false) {
        return;
      }

      if (!doesDomainPatternMatch(rule.domainPattern, hostname)) {
        return;
      }

      const cssRule = buildCustomCssRule(rule);
      if (cssRule !== "") {
        cssBlocks.push(cssRule);
      }
    });

    const styleElement = upsertCustomStyleElement();
    styleElement.textContent = cssBlocks.join("\n\n");

    debugLog("Custom style pass complete.", {
      reason,
      hostname,
      totalRules: rules.length,
      appliedRules: cssBlocks.length,
    });
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

  async function setupCustomStyleInjector() {
    debugLog("Setting up custom style injector.", {
      href: window.location.href,
    });

    let rules = await loadCustomStyleRules();
    applyCustomStyles(rules, "initial");

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (
        areaName !== "local" ||
        !Object.prototype.hasOwnProperty.call(changes, CUSTOM_STYLE_RULES_STORAGE_KEY)
      ) {
        return;
      }

      const newValue = changes[CUSTOM_STYLE_RULES_STORAGE_KEY].newValue;
      if (!Array.isArray(newValue)) {
        rules = [];
      } else {
        rules = newValue.filter(rule => rule && typeof rule === "object");
      }

      applyCustomStyles(rules, "storage-change");
    });
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
      if (areaName !== "local" || !Object.prototype.hasOwnProperty.call(changes, SEEN_LINK_STORAGE_KEY)) {
        return;
      }

      const newValue = changes[SEEN_LINK_STORAGE_KEY].newValue;
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

  void setupCustomStyleInjector().catch(error => {
    debugError("Failed to set up custom style injector.", error);
  });

  debugLog("Content script initialized.", {
    href: window.location.href,
    newScientistPage,
  });

  if (newScientistPage) {
    void setupNewScientistDecorator().catch(error => {
      debugError("Failed to set up New Scientist decorator.", error);
    });
  }
})();
