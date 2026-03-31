const crypto = require("crypto");
const actionsData = require("./actions.json");

function uuid() {
  return crypto.randomUUID().toUpperCase();
}

function parseActionValue(raw) {
  return raw.split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

const actionMap = new Map();
for (const [name, raw] of Object.entries(actionsData.actions)) {
  actionMap.set(name, parseActionValue(raw));
}

function resolveAction(name) {
  const key = name.toLowerCase().replace(/[\s_-]/g, "");
  const variants = actionMap.get(key);
  if (variants) return { key, variants };
  // Fuzzy fallback: collect candidates and pick the best match
  const candidates = [];
  for (const [k, v] of actionMap) {
    if (k.startsWith(key)) {
      candidates.push({ key: k, variants: v, score: 0 });
    } else if (k.includes(key)) {
      candidates.push({ key: k, variants: v, score: 1 });
    }
  }
  if (candidates.length === 0) return null;
  // Sort: startsWith first, then by shortest name (closest match)
  candidates.sort((a, b) => a.score - b.score || a.key.length - b.key.length);
  return { key: candidates[0].key, variants: candidates[0].variants };
}

class Shortcut {
  constructor(name = "My Shortcut") {
    this.name = name;
    this.actions = [];
    this.icon = { color: 4282601983, glyph: 61440 }; // default blue, magic wand
    this.inputContentItemClasses = [
      "WFAppStoreAppContentItem",
      "WFArticleContentItem",
      "WFContactContentItem",
      "WFDateContentItem",
      "WFEmailAddressContentItem",
      "WFGenericFileContentItem",
      "WFImageContentItem",
      "WFiTunesProductContentItem",
      "WFLocationContentItem",
      "WFDCMapsLinkContentItem",
      "WFAVAssetContentItem",
      "WFPDFContentItem",
      "WFPhoneNumberContentItem",
      "WFRichTextContentItem",
      "WFSafariWebPageContentItem",
      "WFStringContentItem",
      "WFURLContentItem",
    ];
  }

  /**
   * Add an action by name with optional parameters.
   * Returns this for chaining.
   */
  add(actionName, params = {}) {
    const resolved = resolveAction(actionName);
    if (!resolved) {
      throw new Error(`Unknown action: "${actionName}". Use searchActions() to find valid names.`);
    }
    const base = resolved.variants[0];
    const mergedParams = {
      ...(base.WFWorkflowActionParameters || {}),
      ...params,
      UUID: uuid(),
    };
    const action = {
      WFWorkflowActionIdentifier: base.WFWorkflowActionIdentifier,
      WFWorkflowActionParameters: mergedParams,
    };
    this.actions.push(action);
    return this;
  }

  /**
   * Add a raw action object directly.
   */
  addRaw(actionObj) {
    this.actions.push(actionObj);
    return this;
  }

  // -- Control flow helpers --
  // All control flow blocks share a GroupingIdentifier UUID to link begin/else/end.

  _controlFlow(identifier, mode, groupId, extraParams = {}) {
    this.actions.push({
      WFWorkflowActionIdentifier: identifier,
      WFWorkflowActionParameters: {
        GroupingIdentifier: groupId,
        UUID: uuid(),
        WFControlFlowMode: mode,
        ...extraParams,
      },
    });
  }

  /**
   * Begin an if block. Returns a groupId needed by otherwise() and ifEnd().
   */
  ifBegin(conditionParams = {}) {
    const groupId = uuid();
    this._groupStack = this._groupStack || [];
    this._groupStack.push({ type: "if", groupId });
    this._controlFlow("is.workflow.actions.conditional", 0, groupId, conditionParams);
    return this;
  }

  /** Otherwise (else) branch */
  otherwise() {
    const group = this._groupStack[this._groupStack.length - 1];
    this._controlFlow("is.workflow.actions.conditional", 1, group.groupId);
    return this;
  }

  /** End if block */
  ifEnd() {
    const group = this._groupStack.pop();
    this._controlFlow("is.workflow.actions.conditional", 2, group.groupId);
    return this;
  }

  /**
   * Convenience: if/else/end with builder callbacks.
   * shortcut.ifElse(condition, s => { s.add(...) }, s => { s.add(...) })
   */
  ifElse(conditionParams, ifBranch, elseBranch) {
    this.ifBegin(conditionParams);
    if (ifBranch) ifBranch(this);
    if (elseBranch) {
      this.otherwise();
      elseBranch(this);
    }
    this.ifEnd();
    return this;
  }

  /** Begin a repeat N times loop */
  repeatBegin(count) {
    const groupId = uuid();
    this._groupStack = this._groupStack || [];
    this._groupStack.push({ type: "repeat", groupId });
    this._controlFlow("is.workflow.actions.repeat.count", 0, groupId, { WFRepeatCount: count });
    return this;
  }

  /** End repeat loop */
  repeatEnd() {
    const group = this._groupStack.pop();
    this._controlFlow("is.workflow.actions.repeat.count", 2, group.groupId);
    return this;
  }

  /**
   * Convenience: repeat N times with builder callback.
   * shortcut.repeat(5, s => { s.add(...) })
   */
  repeat(count, bodyFn) {
    this.repeatBegin(count);
    bodyFn(this);
    this.repeatEnd();
    return this;
  }

  /** Begin a repeat with each loop */
  repeatEachBegin() {
    const groupId = uuid();
    this._groupStack = this._groupStack || [];
    this._groupStack.push({ type: "repeatEach", groupId });
    this._controlFlow("is.workflow.actions.repeat.each", 0, groupId);
    return this;
  }

  /** End repeat with each loop */
  repeatEachEnd() {
    const group = this._groupStack.pop();
    this._controlFlow("is.workflow.actions.repeat.each", 2, group.groupId);
    return this;
  }

  /** Begin a menu with a prompt */
  menuBegin(prompt = "") {
    const groupId = uuid();
    this._groupStack = this._groupStack || [];
    this._groupStack.push({ type: "menu", groupId });
    this._controlFlow("is.workflow.actions.choosefrommenu", 0, groupId,
      prompt ? { WFMenuPrompt: prompt } : {});
    return this;
  }

  /** Add a menu item/case */
  menuItem(title) {
    const group = this._groupStack[this._groupStack.length - 1];
    this._controlFlow("is.workflow.actions.choosefrommenu", 1, group.groupId,
      { WFMenuItemTitle: title });
    return this;
  }

  /** End menu */
  menuEnd() {
    const group = this._groupStack.pop();
    this._controlFlow("is.workflow.actions.choosefrommenu", 2, group.groupId);
    return this;
  }

  /**
   * Convenience: menu with items.
   * shortcut.menu("Pick one", { "Option A": s => { s.add(...) }, "Option B": s => { s.add(...) } })
   */
  menu(prompt, items) {
    this.menuBegin(prompt);
    for (const [title, bodyFn] of Object.entries(items)) {
      this.menuItem(title);
      bodyFn(this);
    }
    this.menuEnd();
    return this;
  }

  /** Add a comment action */
  comment(text) {
    this.actions.push({
      WFWorkflowActionIdentifier: "is.workflow.actions.comment",
      WFWorkflowActionParameters: { WFCommentActionText: text, UUID: uuid() },
    });
    return this;
  }

  /** Set icon color and glyph */
  setIcon(color, glyph) {
    this.icon = { color, glyph };
    return this;
  }

  /**
   * Build the workflow plist object (plain JS object).
   */
  build() {
    return {
      WFWorkflowMinimumClientVersionString: "900",
      WFWorkflowMinimumClientVersion: 900,
      WFWorkflowIcon: {
        WFWorkflowIconStartColor: this.icon.color,
        WFWorkflowIconGlyphNumber: this.icon.glyph,
      },
      WFWorkflowClientVersion: "2302.0.4",
      WFWorkflowOutputContentItemClasses: [],
      WFWorkflowHasOutputFallback: false,
      WFWorkflowActions: this.actions,
      WFWorkflowInputContentItemClasses: this.inputContentItemClasses,
      WFWorkflowImportQuestions: [],
      WFWorkflowTypes: ["NCWidget", "WatchKit"],
      WFQuickActionSurfaces: [],
      WFWorkflowHasShortcutInputVariables: false,
      WFWorkflowName: this.name,
    };
  }

  /**
   * Export as XML plist string.
   */
  toXMLPlist() {
    return buildXMLPlist(this.build());
  }

  /**
   * Export as JSON (useful for debugging).
   */
  toJSON() {
    return JSON.stringify(this.build(), null, 2);
  }

  /**
   * Write to a .shortcut file (XML plist format).
   */
  export(filePath) {
    const fs = require("fs");
    fs.writeFileSync(filePath, this.toXMLPlist(), "utf8");
    return filePath;
  }
}

// --- XML Plist generator (zero dependencies) ---

function escapeXML(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function valueToXML(value, indent = "") {
  const next = indent + "\t";

  if (value === null || value === undefined) {
    return `${indent}<string></string>`;
  }
  if (typeof value === "boolean") {
    return `${indent}<${value}/>`;
  }
  if (typeof value === "number") {
    if (Number.isInteger(value)) {
      return `${indent}<integer>${value}</integer>`;
    }
    return `${indent}<real>${value}</real>`;
  }
  if (typeof value === "string") {
    return `${indent}<string>${escapeXML(value)}</string>`;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return `${indent}<array/>`;
    const items = value.map((v) => valueToXML(v, next)).join("\n");
    return `${indent}<array>\n${items}\n${indent}</array>`;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value);
    if (keys.length === 0) return `${indent}<dict/>`;
    const entries = keys
      .map((k) => `${next}<key>${escapeXML(k)}</key>\n${valueToXML(value[k], next)}`)
      .join("\n");
    return `${indent}<dict>\n${entries}\n${indent}</dict>`;
  }
  return `${indent}<string>${escapeXML(String(value))}</string>`;
}

function buildXMLPlist(obj) {
  const body = valueToXML(obj, "");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
${body}
</plist>
`;
}

module.exports = { Shortcut };
