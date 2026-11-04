#!/usr/bin/env node
// A ratified Change has a home. Core ships in the plugin. Project lives in the repo's .harteburn/.
// User lives on this machine. A core Change built here is an override until it is submitted;
// a plugin update does not carry it, and does not delete it.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { BOARD_DIR, LEGACY, boardDir, homeDir } from "./paths.mjs";

export function userHome(env = process.env) {
  return homeDir(env);
}

/** core | project | user, from the place the retro named. */
export function layerOf(where = "") {
  const w = String(where).toLowerCase();
  if (/\buser\b|this machine/.test(w)) return "user";
  if (/house rule|\bproject\b/.test(w) || w.includes(BOARD_DIR) || w.includes(LEGACY.boardDir)) return "project";
  if (/\bcore\b|\bskill\b|\bcharter\b|\bhook\b|\bplugin\b/.test(w)) return "core";
  return "project";
}

function readList(path) {
  if (!existsSync(path)) return [];
  const data = JSON.parse(readFileSync(path, "utf8"));
  return Array.isArray(data) ? data : [];
}

function writeList(path, rows) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(rows, null, 2) + "\n", { mode: 0o600 });
}

export function layerPath(layer, { root = process.cwd(), home = userHome() } = {}) {
  if (layer === "project") return join(boardDir(root), "changes.json");
  if (layer === "user") return join(home, "changes.json");
  return join(home, "overrides.json");
}

/** Append a Change to the layer its `where` names. Core lands in the user override file. */
export function placeChange(change, opts = {}) {
  const layer = change.layer || layerOf(change.where);
  const path = layerPath(layer, opts);
  const row = {
    problem: String(change.problem || ""),
    cause: String(change.cause || ""),
    change: String(change.change || ""),
    how: String(change.how || ""),
    where: String(change.where || layer),
    layer,
    at: change.at || new Date().toISOString(),
  };
  const rows = readList(path);
  rows.push(row);
  writeList(path, rows);
  return { path, row };
}

export function readLayer(layer, opts = {}) {
  return readList(layerPath(layer, opts));
}

const invoked = process.argv[1] && process.argv[1].endsWith("layers.mjs");
if (invoked) {
  const route = process.argv.indexOf("--route");
  if (route >= 0) {
    console.log(layerOf(process.argv[route + 1] || ""));
    process.exit(0);
  }
  const place = process.argv.indexOf("--place");
  const rootFlag = process.argv.indexOf("--root");
  if (place >= 0) {
    const change = JSON.parse(readFileSync(process.argv[place + 1], "utf8"));
    const root = rootFlag >= 0 ? process.argv[rootFlag + 1] : process.cwd();
    const { path, row } = placeChange(change, { root });
    console.log(`${row.layer} ${path}`);
    process.exit(0);
  }
  console.error("usage: layers.mjs --route <where> | --place <file.json> [--root <repo>]");
  process.exit(2);
}
