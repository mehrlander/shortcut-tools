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
 * Get all actions belonging to a specific app/source.
 * e.g. getActionsByApp("com.sindresorhus.Actions")
 */
function getActionsByApp(appId) {
  for (const [category, apps] of Object.entries(groupedData)) {
    if (apps[appId]) {
      return apps[appId];
    }
  }
  return null;
}

/**
 * List all app/source identifiers that have actions.
 */
function listApps() {
  const apps = [];
  for (const [category, appMap] of Object.entries(groupedData)) {
    for (const appId of Object.keys(appMap)) {
      apps.push({ category, appId, count: appMap[appId].length });
    }
  }
  return apps;
}

/**
 * Get all action names.
 */
function listActions() {
  return Array.from(allActions.keys());
}

module.exports = {
  getAction,
  searchActions,
  getActionsByApp,
  listApps,
  listActions,
  allActions,
};
