import { readFile } from "node:fs/promises";

const requiredFiles = [
  "index.html",
  "machines.html",
  "schedule.html",
  "workorders.html",
  "logs.html",
  "settings.html",
  "login.html",
  "styles.css",
  "app.js",
  "db.js",
  "auth.js",
  "config.js",
  "config.example.js",
  "data/equipment-data.json",
];

for (const file of requiredFiles) {
  await readFile(new URL(`../${file}`, import.meta.url), "utf8");
}

const data = JSON.parse(
  await readFile(new URL("../data/equipment-data.json", import.meta.url), "utf8"),
);

if (!Array.isArray(data.machines) || data.machines.length === 0) {
  throw new Error("equipment-data.json must include machines.");
}

if (!Array.isArray(data.updates) || data.updates.length === 0) {
  throw new Error("equipment-data.json must include status updates.");
}

console.log(`Static site check passed: ${data.machines.length} machines, ${data.updates.length} updates.`);
