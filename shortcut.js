const actionsData = require("./actions.json");

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
    const action = {
      WFWorkflowActionIdentifier: base.WFWorkflowActionIdentifier,
      WFWorkflowActionParameters: {
        ...(base.WFWorkflowActionParameters || {}),
        ...params,
      },
    };
    // Remove empty params object
    if (Object.keys(action.WFWorkflowActionParameters).length === 0) {
      delete action.WFWorkflowActionParameters;
    }
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

  /**
   * Begin an if block. condition can include WFCondition, WFInput, etc.
   */
  ifBegin(conditionParams = {}) {
    this.actions.push({
      WFWorkflowActionIdentifier: "is.workflow.actions.conditional",
      WFWorkflowActionParameters: { WFControlFlowMode: 0, ...conditionParams },
    });
    return this;
  }

  /** Otherwise (else) branch */
  otherwise() {
    this.actions.push({
      WFWorkflowActionIdentifier: "is.workflow.actions.conditional",
      WFWorkflowActionParameters: { WFControlFlowMode: 1 },
    });
    return this;
  }

  /** End if block */
  ifEnd() {
    this.actions.push({
      WFWorkflowActionIdentifier: "is.workflow.actions.conditional",
      WFWorkflowActionParameters: { WFControlFlowMode: 2 },
    });
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
    this.actions.push({
      WFWorkflowActionIdentifier: "is.workflow.actions.repeat.count",
      WFWorkflowActionParameters: { WFControlFlowMode: 0, WFRepeatCount: count },
    });
    return this;
  }

  /** End repeat loop */
  repeatEnd() {
    this.actions.push({
      WFWorkflowActionIdentifier: "is.workflow.actions.repeat.count",
      WFWorkflowActionParameters: { WFControlFlowMode: 2 },
    });
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
    this.actions.push({
      WFWorkflowActionIdentifier: "is.workflow.actions.repeat.each",
      WFWorkflowActionParameters: { WFControlFlowMode: 0 },
    });
    return this;
  }

  /** End repeat with each loop */
  repeatEachEnd() {
    this.actions.push({
      WFWorkflowActionIdentifier: "is.workflow.actions.repeat.each",
      WFWorkflowActionParameters: { WFControlFlowMode: 2 },
    });
    return this;
  }

  /** Begin a menu with a prompt */
  menuBegin(prompt = "") {
    this.actions.push({
      WFWorkflowActionIdentifier: "is.workflow.actions.choosefrommenu",
      WFWorkflowActionParameters: {
        WFControlFlowMode: 0,
        ...(prompt ? { WFMenuPrompt: prompt } : {}),
      },
    });
    return this;
  }

  /** Add a menu item/case */
  menuItem(title) {
    this.actions.push({
      WFWorkflowActionIdentifier: "is.workflow.actions.choosefrommenu",
      WFWorkflowActionParameters: { WFControlFlowMode: 1, WFMenuItemTitle: title },
    });
    return this;
  }

  /** End menu */
  menuEnd() {
    this.actions.push({
      WFWorkflowActionIdentifier: "is.workflow.actions.choosefrommenu",
      WFWorkflowActionParameters: { WFControlFlowMode: 2 },
    });
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
      WFWorkflowActionParameters: { WFCommentActionText: text },
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
