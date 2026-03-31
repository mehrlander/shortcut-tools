#!/usr/bin/env node

const { getAction, searchActions, listApps, getActionsByApp } = require("./index");

const args = process.argv.slice(2);
const command = args[0];

function printUsage() {
  console.log(`shortcut-tools - Search iOS/macOS Shortcuts actions

Usage:
  shortcut-tools search <query>    Search actions by name or identifier
  shortcut-tools get <name>        Get exact action by name
  shortcut-tools apps              List all app sources
  shortcut-tools app <id>          List actions for a specific app
  shortcut-tools help              Show this help message

Examples:
  shortcut-tools search screenshot
  shortcut-tools search safari
  shortcut-tools get takescreenshot
  shortcut-tools apps
  shortcut-tools app com.apple.mobilesafari`);
}

function formatVariant(v) {
  const id = v.WFWorkflowActionIdentifier;
  const params = v.WFWorkflowActionParameters;
  if (params) {
    return `${id}  (params: ${JSON.stringify(params)})`;
  }
  return id;
}

switch (command) {
  case "search": {
    const query = args.slice(1).join(" ");
    if (!query) {
      console.error("Error: provide a search query");
      process.exit(1);
    }
    const results = searchActions(query);
    if (results.length === 0) {
      console.log(`No actions found for "${query}"`);
    } else {
      console.log(`Found ${results.length} action(s):\n`);
      for (const { name, variants } of results) {
        for (const v of variants) {
          console.log(`  ${name}`);
          console.log(`    ${formatVariant(v)}`);
        }
      }
    }
    break;
  }

  case "get": {
    const name = args.slice(1).join("").toLowerCase();
    if (!name) {
      console.error("Error: provide an action name");
      process.exit(1);
    }
    const variants = getAction(name);
    if (!variants) {
      console.log(`Action "${name}" not found`);
      process.exit(1);
    }
    console.log(`${name}:\n`);
    for (const v of variants) {
      console.log(`  identifier: ${v.WFWorkflowActionIdentifier}`);
      if (v.WFWorkflowActionParameters) {
        console.log(`  parameters: ${JSON.stringify(v.WFWorkflowActionParameters, null, 4)}`);
      }
    }
    break;
  }

  case "apps": {
    const apps = listApps();
    console.log(`${apps.length} app sources:\n`);
    apps
      .sort((a, b) => b.count - a.count)
      .forEach(({ appId, count }) => {
        const label = appId || "(built-in workflow actions)";
        console.log(`  ${label}  (${count} actions)`);
      });
    break;
  }

  case "app": {
    const appId = args[1];
    if (!appId) {
      console.error("Error: provide an app identifier");
      process.exit(1);
    }
    const actions = getActionsByApp(appId);
    if (!actions) {
      console.log(`App "${appId}" not found`);
      process.exit(1);
    }
    console.log(`${actions.length} actions in ${appId}:\n`);
    actions.forEach((a) => console.log(`  ${a}`));
    break;
  }

  case "help":
  case "--help":
  case "-h":
  case undefined:
    printUsage();
    break;

  default:
    console.error(`Unknown command: ${command}`);
    printUsage();
    process.exit(1);
}
