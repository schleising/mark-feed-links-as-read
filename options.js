"use strict";

const CUSTOM_STYLE_RULES_STORAGE_KEY = "customStyleRulesV1";
const HISTORY_DOMAINS_STORAGE_KEY = "historyDomainsV1";

const historyDomainForm = document.getElementById("history-domain-form");
const historyDomainInput = document.getElementById("history-domain-input");
const historyDomainList = document.getElementById("history-domain-list");
const historyDomainEmpty = document.getElementById("history-domain-empty");

const ruleForm = document.getElementById("rule-form");
const formTitle = document.getElementById("form-title");
const nameInput = document.getElementById("rule-name");
const domainInput = document.getElementById("rule-domain");
const selectorInput = document.getElementById("rule-selector");
const declarationsInput = document.getElementById("rule-declarations");
const enabledInput = document.getElementById("rule-enabled");
const statusMessage = document.getElementById("status-message");
const rulesList = document.getElementById("rules-list");
const emptyState = document.getElementById("empty-state");
const cancelEditButton = document.getElementById("cancel-edit");

let rules = [];
let historyDomains = [];
let editingRuleId = "";

function createRuleId() {
  return `rule-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
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

function normalizeRule(rawRule) {
  const now = Date.now();

  return {
    id: typeof rawRule.id === "string" && rawRule.id.trim() !== "" ? rawRule.id.trim() : createRuleId(),
    name: String(rawRule.name || "").trim(),
    domainPattern: normalizeDomainPattern(rawRule.domainPattern),
    selector: String(rawRule.selector || "").trim(),
    declarations: String(rawRule.declarations || "").trim(),
    enabled: rawRule.enabled !== false,
    createdAt: typeof rawRule.createdAt === "number" ? rawRule.createdAt : now,
    updatedAt: typeof rawRule.updatedAt === "number" ? rawRule.updatedAt : now,
  };
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

  return Array.from(unique).sort((a, b) => a.localeCompare(b));
}

function isRuleValid(rule) {
  return (
    typeof rule.domainPattern === "string" &&
    rule.domainPattern !== "" &&
    typeof rule.selector === "string" &&
    rule.selector !== "" &&
    typeof rule.declarations === "string" &&
    rule.declarations !== ""
  );
}

function setStatus(message, type = "info") {
  statusMessage.textContent = message;
  statusMessage.dataset.type = type;
}

function clearStatus() {
  statusMessage.textContent = "";
  delete statusMessage.dataset.type;
}

async function saveRules() {
  await chrome.storage.local.set({
    [CUSTOM_STYLE_RULES_STORAGE_KEY]: rules,
  });
}

async function saveHistoryDomains() {
  await chrome.storage.local.set({
    [HISTORY_DOMAINS_STORAGE_KEY]: historyDomains,
  });
}

async function loadRules() {
  const data = await chrome.storage.local.get(CUSTOM_STYLE_RULES_STORAGE_KEY);
  const candidate = data[CUSTOM_STYLE_RULES_STORAGE_KEY];

  if (!Array.isArray(candidate)) {
    return [];
  }

  return candidate
    .filter(rule => rule && typeof rule === "object")
    .map(normalizeRule)
    .filter(isRuleValid)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

async function loadHistoryDomains() {
  const data = await chrome.storage.local.get(HISTORY_DOMAINS_STORAGE_KEY);
  return normalizeHistoryDomains(data[HISTORY_DOMAINS_STORAGE_KEY]);
}

function createButton(label, className, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.className = className;
  button.addEventListener("click", onClick);
  return button;
}

function renderHistoryDomains() {
  historyDomainList.innerHTML = "";

  if (historyDomains.length === 0) {
    historyDomainEmpty.hidden = false;
    return;
  }

  historyDomainEmpty.hidden = true;

  historyDomains.forEach(domainPattern => {
    const chip = document.createElement("div");
    chip.className = "history-domain-chip";

    const label = document.createElement("span");
    label.textContent = domainPattern;

    const removeButton = createButton("Remove", "secondary", async () => {
      historyDomains = historyDomains.filter(candidate => candidate !== domainPattern);

      try {
        await saveHistoryDomains();
        renderHistoryDomains();
        setStatus("History domain removed.", "success");
      } catch (error) {
        setStatus(`Could not remove history domain: ${error.message}`, "error");
      }
    });

    chip.appendChild(label);
    chip.appendChild(removeButton);

    historyDomainList.appendChild(chip);
  });
}

function renderRules() {
  rulesList.innerHTML = "";

  if (rules.length === 0) {
    emptyState.hidden = false;
    return;
  }

  emptyState.hidden = true;

  rules.forEach((rule, index) => {
    const card = document.createElement("article");
    card.className = "rule-card";

    const cardHead = document.createElement("div");
    cardHead.className = "rule-card-head";

    const title = document.createElement("h3");
    title.className = "rule-card-title";
    title.textContent = rule.name !== "" ? rule.name : `Rule ${index + 1}`;

    const enabledLabel = document.createElement("label");
    enabledLabel.className = "rule-chip";

    const enabledToggle = document.createElement("input");
    enabledToggle.type = "checkbox";
    enabledToggle.checked = rule.enabled;
    enabledToggle.addEventListener("change", async () => {
      const targetRule = rules.find(item => item.id === rule.id);
      if (!targetRule) {
        return;
      }

      targetRule.enabled = enabledToggle.checked;
      targetRule.updatedAt = Date.now();

      try {
        await saveRules();
        renderRules();
        setStatus("Rule updated.", "success");
      } catch (error) {
        setStatus(`Could not update rule: ${error.message}`, "error");
      }
    });

    const enabledText = document.createElement("span");
    enabledText.textContent = "Enabled";

    enabledLabel.appendChild(enabledToggle);
    enabledLabel.appendChild(enabledText);

    cardHead.appendChild(title);
    cardHead.appendChild(enabledLabel);

    const meta = document.createElement("div");
    meta.className = "rule-meta";

    const domainLine = document.createElement("div");
    domainLine.textContent = `Domain: ${rule.domainPattern}`;

    const selectorLine = document.createElement("div");
    selectorLine.textContent = `Selector: ${rule.selector}`;

    meta.appendChild(domainLine);
    meta.appendChild(selectorLine);

    const preview = document.createElement("pre");
    preview.className = "rule-preview";
    preview.textContent = `${rule.selector} {\n${rule.declarations}\n}`;

    const actions = document.createElement("div");
    actions.className = "rule-actions";

    const editButton = createButton("Edit", "secondary", () => {
      editingRuleId = rule.id;
      formTitle.textContent = "Edit Rule";
      cancelEditButton.hidden = false;

      nameInput.value = rule.name;
      domainInput.value = rule.domainPattern;
      selectorInput.value = rule.selector;
      declarationsInput.value = rule.declarations;
      enabledInput.checked = rule.enabled;
      domainInput.focus();

      clearStatus();
    });

    const deleteButton = createButton("Delete", "danger", async () => {
      const shouldDelete = window.confirm("Delete this rule?");
      if (!shouldDelete) {
        return;
      }

      rules = rules.filter(item => item.id !== rule.id);

      if (editingRuleId === rule.id) {
        resetForm();
      }

      try {
        await saveRules();
        renderRules();
        setStatus("Rule deleted.", "success");
      } catch (error) {
        setStatus(`Could not delete rule: ${error.message}`, "error");
      }
    });

    actions.appendChild(editButton);
    actions.appendChild(deleteButton);

    card.appendChild(cardHead);
    card.appendChild(meta);
    card.appendChild(preview);
    card.appendChild(actions);

    rulesList.appendChild(card);
  });
}

function resetForm() {
  editingRuleId = "";
  formTitle.textContent = "Add Rule";
  cancelEditButton.hidden = true;

  ruleForm.reset();
  enabledInput.checked = true;
  clearStatus();
}

function readFormRule() {
  const domainPattern = normalizeDomainPattern(domainInput.value);
  const selector = String(selectorInput.value || "").trim();
  const declarations = String(declarationsInput.value || "").trim();

  if (domainPattern === "") {
    setStatus("Domain pattern is required.", "error");
    domainInput.focus();
    return null;
  }

  if (selector === "") {
    setStatus("Selector is required.", "error");
    selectorInput.focus();
    return null;
  }

  if (declarations === "") {
    setStatus("CSS declarations are required.", "error");
    declarationsInput.focus();
    return null;
  }

  return {
    name: String(nameInput.value || "").trim(),
    domainPattern,
    selector,
    declarations,
    enabled: enabledInput.checked,
  };
}

async function handleHistoryDomainSubmit(event) {
  event.preventDefault();

  const domainPattern = normalizeDomainPattern(historyDomainInput.value);
  if (domainPattern === "") {
    setStatus("History domain pattern is required.", "error");
    historyDomainInput.focus();
    return;
  }

  if (historyDomains.includes(domainPattern)) {
    setStatus("History domain already exists.", "error");
    historyDomainInput.focus();
    historyDomainInput.select();
    return;
  }

  historyDomains = normalizeHistoryDomains([...historyDomains, domainPattern]);

  try {
    await saveHistoryDomains();
    renderHistoryDomains();
    historyDomainForm.reset();
    historyDomainInput.focus();
    setStatus("History domain added.", "success");
  } catch (error) {
    setStatus(`Could not add history domain: ${error.message}`, "error");
  }
}

async function handleSubmit(event) {
  event.preventDefault();

  const formRule = readFormRule();
  if (!formRule) {
    return;
  }

  const now = Date.now();

  if (editingRuleId !== "") {
    rules = rules.map(rule => {
      if (rule.id !== editingRuleId) {
        return rule;
      }

      return {
        ...rule,
        ...formRule,
        updatedAt: now,
      };
    });

    rules.sort((a, b) => b.updatedAt - a.updatedAt);

    try {
      await saveRules();
      renderRules();
      resetForm();
      setStatus("Rule saved.", "success");
    } catch (error) {
      setStatus(`Could not save rule: ${error.message}`, "error");
    }

    return;
  }

  const newRule = normalizeRule({
    ...formRule,
    id: createRuleId(),
    createdAt: now,
    updatedAt: now,
  });

  rules.unshift(newRule);

  try {
    await saveRules();
    renderRules();
    resetForm();
    setStatus("Rule added.", "success");
  } catch (error) {
    setStatus(`Could not add rule: ${error.message}`, "error");
  }
}

async function handleStorageChanged(changes, areaName) {
  if (areaName !== "local") {
    return;
  }

  if (Object.prototype.hasOwnProperty.call(changes, CUSTOM_STYLE_RULES_STORAGE_KEY)) {
    const newValue = changes[CUSTOM_STYLE_RULES_STORAGE_KEY].newValue;
    if (!Array.isArray(newValue)) {
      rules = [];
    } else {
      rules = newValue
        .filter(rule => rule && typeof rule === "object")
        .map(normalizeRule)
        .filter(isRuleValid)
        .sort((a, b) => b.updatedAt - a.updatedAt);
    }

    renderRules();
  }

  if (Object.prototype.hasOwnProperty.call(changes, HISTORY_DOMAINS_STORAGE_KEY)) {
    historyDomains = normalizeHistoryDomains(changes[HISTORY_DOMAINS_STORAGE_KEY].newValue);
    renderHistoryDomains();
  }
}

async function initialize() {
  const [loadedRules, loadedHistoryDomains] = await Promise.all([
    loadRules(),
    loadHistoryDomains(),
  ]);

  rules = loadedRules;
  historyDomains = loadedHistoryDomains;

  renderHistoryDomains();
  renderRules();

  historyDomainForm.addEventListener("submit", handleHistoryDomainSubmit);
  ruleForm.addEventListener("submit", handleSubmit);
  cancelEditButton.addEventListener("click", resetForm);
  chrome.storage.onChanged.addListener(handleStorageChanged);
}

void initialize().catch(error => {
  setStatus(`Failed to initialize options page: ${error.message}`, "error");
});
