(() => {
  "use strict";

  const SEEN_LINK_STORAGE_KEY = "seenHistoryLinksV1";
  const LEGACY_SEEN_LINK_STORAGE_KEY = "seenNewScientistArticleLinksV1";
  const HISTORY_DOMAINS_STORAGE_KEY = "historyDomainsV1";
  const CUSTOM_STYLE_RULES_STORAGE_KEY = "customStyleRulesV1";
  const DECORATED_CLASS = "mflar-seen-from-feeds";
  const DEBUG = true;
  const DEBUG_PREFIX = "[MFLAR]";
  const CONTROL_ESCAPE_MAP = {
    n: "\n",
    r: "\r",
    t: "\t",
    b: "\b",
    f: "\f",
    v: "\v",
    0: "\0",
  };

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

  function isHexDigit(char) {
    return /^[0-9a-fA-F]$/.test(char);
  }

  function isSlashEscapeBoundary(value, index, escapeLength) {
    const previous = index > 0 ? value[index - 1] : "";
    const nextIndex = index + escapeLength;
    const following = nextIndex < value.length ? value[nextIndex] : "";

    const previousIsBoundary = previous === "" || /[\s:;,(\[{=+>~!]/.test(previous);
    const followingIsBoundary = following === "" || /[\s;:,)\]}=+>~!]/.test(following);

    return previousIsBoundary && followingIsBoundary;
  }

  function decodeEscapedControlCodes(rawValue) {
    const value = String(rawValue || "");
    if (value === "") {
      return "";
    }

    let output = "";

    for (let index = 0; index < value.length; index += 1) {
      const char = value[index];
      const hasNext = index + 1 < value.length;

      if (!hasNext || (char !== "\\" && char !== "/")) {
        output += char;
        continue;
      }

      const next = value[index + 1];
      const isBackslashEscape = char === "\\";
      const canDecodeSlashEscape = isBackslashEscape || isSlashEscapeBoundary(value, index, 2);

      if (canDecodeSlashEscape && Object.prototype.hasOwnProperty.call(CONTROL_ESCAPE_MAP, next)) {
        output += CONTROL_ESCAPE_MAP[next];
        index += 1;
        continue;
      }

      if (next === "x" && index + 3 < value.length) {
        if (!isBackslashEscape && !isSlashEscapeBoundary(value, index, 4)) {
          output += char;
          continue;
        }

        const hexValue = value.slice(index + 2, index + 4);
        if (isHexDigit(hexValue[0]) && isHexDigit(hexValue[1])) {
          const codePoint = Number.parseInt(hexValue, 16);
          if (codePoint <= 0x1f || codePoint === 0x7f || isBackslashEscape) {
            output += String.fromCodePoint(codePoint);
            index += 3;
            continue;
          }
        }
      }

      if (next === "u") {
        if (index + 2 < value.length && value[index + 2] === "{") {
          const closeIndex = value.indexOf("}", index + 3);
          if (closeIndex !== -1) {
            if (!isBackslashEscape && !isSlashEscapeBoundary(value, index, closeIndex - index + 1)) {
              output += char;
              continue;
            }

            const hexCodePoint = value.slice(index + 3, closeIndex);
            if (/^[0-9a-fA-F]{1,6}$/.test(hexCodePoint)) {
              const codePoint = Number.parseInt(hexCodePoint, 16);
              if (codePoint <= 0x1f || codePoint === 0x7f || isBackslashEscape) {
                output += String.fromCodePoint(codePoint);
                index = closeIndex;
                continue;
              }
            }
          }
        } else if (index + 5 < value.length) {
          if (!isBackslashEscape && !isSlashEscapeBoundary(value, index, 6)) {
            output += char;
            continue;
          }

          const hexValue = value.slice(index + 2, index + 6);
          if (/^[0-9a-fA-F]{4}$/.test(hexValue)) {
            const codePoint = Number.parseInt(hexValue, 16);
            if (codePoint <= 0x1f || codePoint === 0x7f || isBackslashEscape) {
              output += String.fromCodePoint(codePoint);
              index += 5;
              continue;
            }
          }
        }
      }

      output += char;
    }

    return output;
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
      const parsed = new URL(String(rawUrl || ""), window.location.href);
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

    const current = data[SEEN_LINK_STORAGE_KEY];
    if (current && typeof current === "object") {
      debugLog("Loaded seen-link map from generic storage key.", {
        entries: Object.keys(current).length,
      });

      return current;
    }

    const legacy = data[LEGACY_SEEN_LINK_STORAGE_KEY];
    if (legacy && typeof legacy === "object") {
      debugLog("Loaded seen-link map from legacy storage key.", {
        entries: Object.keys(legacy).length,
      });

      return legacy;
    }

    debugLog("No seen-link map found in storage yet.");
    return {};
  }

  async function loadHistoryDomains() {
    const data = await chrome.storage.local.get(HISTORY_DOMAINS_STORAGE_KEY);
    const normalized = normalizeHistoryDomains(data[HISTORY_DOMAINS_STORAGE_KEY]);

    debugLog("Loaded history domains from storage.", {
      totalDomains: normalized.length,
      domains: normalized,
    });

    return normalized;
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
    const declarations = decodeEscapedControlCodes(String(rule.declarations || "").trim());

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

  function applyDecorations(root, seenUrlSet, trackedDomains, reason = "unknown") {
    const anchors = collectAnchors(root);
    let decoratedCount = 0;
    let matchedCount = 0;

    anchors.forEach(anchor => {
      const normalized = normalizeTrackedUrl(anchor.href, trackedDomains);
      if (normalized === "") {
        anchor.classList.remove(DECORATED_CLASS);
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
        trackedDomainCount: trackedDomains.length,
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

  async function setupSeenLinkDecorator() {
    debugLog("Setting up tracked-domain link decorator.", {
      href: window.location.href,
    });

    ensureDecoratorStyle();

    const [seenMap, initialHistoryDomains] = await Promise.all([
      loadSeenLinkMap(),
      loadHistoryDomains(),
    ]);

    let seenUrlSet = new Set(Object.keys(seenMap));
    let historyDomains = initialHistoryDomains;

    debugLog("Initial tracked-domain decorator state ready.", {
      seenCount: seenUrlSet.size,
      totalDomains: historyDomains.length,
      domains: historyDomains,
    });

    applyDecorations(document, seenUrlSet, historyDomains, "initial");

    const observer = new MutationObserver(mutations => {
      mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
          if (node instanceof Element) {
            applyDecorations(node, seenUrlSet, historyDomains, "mutation");
          }
        });
      });
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local") {
        return;
      }

      let shouldRefreshDecorations = false;

      if (Object.prototype.hasOwnProperty.call(changes, SEEN_LINK_STORAGE_KEY)) {
        const newValue = changes[SEEN_LINK_STORAGE_KEY].newValue;
        if (newValue && typeof newValue === "object") {
          seenUrlSet = new Set(Object.keys(newValue));
        } else {
          seenUrlSet = new Set();
        }

        shouldRefreshDecorations = true;
      } else if (Object.prototype.hasOwnProperty.call(changes, LEGACY_SEEN_LINK_STORAGE_KEY)) {
        const legacyValue = changes[LEGACY_SEEN_LINK_STORAGE_KEY].newValue;
        if (legacyValue && typeof legacyValue === "object") {
          seenUrlSet = new Set(Object.keys(legacyValue));
        } else {
          seenUrlSet = new Set();
        }

        shouldRefreshDecorations = true;
      }

      if (Object.prototype.hasOwnProperty.call(changes, HISTORY_DOMAINS_STORAGE_KEY)) {
        historyDomains = normalizeHistoryDomains(changes[HISTORY_DOMAINS_STORAGE_KEY].newValue);
        shouldRefreshDecorations = true;
      }

      if (!shouldRefreshDecorations) {
        return;
      }

      debugLog("Storage changed; refreshing tracked-domain decorations.", {
        seenCount: seenUrlSet.size,
        totalDomains: historyDomains.length,
        domains: historyDomains,
      });

      applyDecorations(document, seenUrlSet, historyDomains, "storage-change");
    });
  }

  void setupCustomStyleInjector().catch(error => {
    debugError("Failed to set up custom style injector.", error);
  });

  debugLog("Content script initialized.", {
    href: window.location.href,
  });

  void setupSeenLinkDecorator().catch(error => {
    debugError("Failed to set up tracked-domain link decorator.", error);
  });
})();
