const actionsData = require("./actions.json");
const groupedData = require("./actions-grouped.json");

/**
 * Parse a raw action value string into structured object(s).
 * Some actions (like choosefrommenu) have multiple variants separated by newlines.
 */
function parseActionValue(raw) {
  const lines = raw.split("\n").filter(Boolean);
  return lines.map((line) => JSON.parse(line));
}

/** All actions as a Map of name -> parsed action object(s) */
const allActions = new Map();
for (const [name, raw] of Object.entries(actionsData.actions)) {
  allActions.set(name, parseActionValue(raw));
}

/**
 * Get an action by exact name.
 * Returns array of action variant(s) or undefined.
 */
function getAction(name) {
  return allActions.get(name.toLowerCase());
}

/**
 * Search actions by substring match on name or identifier.
 * Returns array of { name, variants } objects.
 */
function searchActions(query) {
  const q = query.toLowerCase();
  const results = [];
  for (const [name, variants] of allActions) {
    const identifierMatch = variants.some((v) =>
      v.WFWorkflowActionIdentifier.toLowerCase().includes(q)
    );
    if (name.includes(q) || identifierMatch) {
      results.push({ name, variants });
    }
  }
  return results;
}

/**
 * actions-grouped.json decomposes each WFWorkflowActionIdentifier into bundle
 * root, source, and leaf. Reassembling them is what lets a grouped entry be
 * resolved back to the action name the rest of this module is keyed by.
 */
function fullAppId(root, source) {
  if (root === "other") return source;
  if (source === "") return root;
  return `${root}.${source}`;
}

/** Identifier -> every action name carrying it. */
const identifierToNames = new Map();
for (const [name, variants] of allActions) {
  for (const variant of variants) {
    const id = variant.WFWorkflowActionIdentifier;
    if (!identifierToNames.has(id)) identifierToNames.set(id, []);
    identifierToNames.get(id).push(name);
  }
}

// Control-flow leaves carry a `:mode` suffix the flat dictionary lacks, because
// it collapses every mode onto one identifier. Only these three are
// recoverable. The operator suffixes (`conditional:contains`) name a generic
// comparison the dictionary has no entry for: its nearest entries are all
// input-specific (ifclipboardcontains), so any pick would be arbitrary. Those
// resolve to null rather than to a confident wrong answer.
const SUFFIX_MODE = { if: 0, else: 1, end: 2 };

function resolveLeaf(appId, leaf) {
  const [bare, suffix] = leaf.split(":");
  const identifier = `${appId}.${bare}`;
  const candidates = identifierToNames.get(identifier) || [];
  if (suffix === undefined) {
    if (candidates.length === 1) return { name: candidates[0], leaf, identifier };
    // A bare leaf whose file also carries a `:end` sibling is the opener, so
    // prefer the mode-0 entry over its closer.
    const opener = candidates.find((n) => {
      const params = allActions.get(n)[0].WFWorkflowActionParameters || {};
      return params.WFControlFlowMode === 0;
    });
    return { name: opener || null, leaf, identifier };
  }
  if (suffix in SUFFIX_MODE) {
    const wanted = SUFFIX_MODE[suffix];
    const match = candidates.find((n) => {
      const params = allActions.get(n)[0].WFWorkflowActionParameters || {};
      return params.WFControlFlowMode === wanted && !("WFCondition" in params);
    });
    if (match) return { name: match, leaf, identifier };
  }
  return { name: null, leaf, identifier };
}

const appIndex = new Map();
for (const [root, sources] of Object.entries(groupedData)) {
  for (const [source, leaves] of Object.entries(sources)) {
    const appId = fullAppId(root, source);
    appIndex.set(appId, {
      appId,
      category: root,
      source,
      actions: leaves.map((leaf) => resolveLeaf(appId, leaf)),
    });
  }
}

/**
 * Get the actions belonging to one app/source, by full bundle id
 * (com.apple.mobilenotes) or by the bare source segment (mobilenotes).
 *
 * Returns action names usable with getAction() and Shortcut.add(). Pass
 * { detailed: true } for { name, leaf, identifier } objects instead; `name` is
 * null for the handful of control-flow forms the flat dictionary cannot
 * disambiguate.
 */
function getActionsByApp(appId, { detailed = false } = {}) {
  let entry = appIndex.get(appId);
  if (!entry) {
    for (const candidate of appIndex.values()) {
      if (candidate.source === appId) { entry = candidate; break; }
    }
  }
  if (!entry) return null;
  return detailed ? entry.actions : entry.actions.map((a) => a.name || a.identifier);
}

/**
 * List every app/source that has actions, with its full bundle id.
 */
function listApps() {
  return [...appIndex.values()].map(({ appId, category, actions }) => ({
    category,
    appId,
    count: actions.length,
  }));
}

/**
 * Get all action names.
 */
function listActions() {
  return Array.from(allActions.keys());
}

const { Shortcut, buildXMLPlist, attachment, variable, tokenString, ANCHOR } = require("./shortcut");

module.exports = {
  getAction,
  searchActions,
  getActionsByApp,
  listApps,
  listActions,
  allActions,
  Shortcut,
  buildXMLPlist,
  attachment,
  variable,
  tokenString,
  ANCHOR,
};
