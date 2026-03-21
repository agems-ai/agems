#!/usr/bin/env node

import * as readline from "readline";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

// ── ANSI Colors ──────────────────────────────────────────────────────────────

const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
  bgBlue: "\x1b[44m",
  white: "\x1b[37m",
};

function ok(msg: string) {
  console.log(`  ${c.green}✓${c.reset} ${msg}`);
}
function warn(msg: string) {
  console.log(`  ${c.yellow}⚠${c.reset} ${msg}`);
}
function fail(msg: string) {
  console.log(`  ${c.red}✗${c.reset} ${msg}`);
}
function info(msg: string) {
  console.log(`  ${c.blue}i${c.reset} ${msg}`);
}
function heading(msg: string) {
  console.log(`\n${c.bold}${c.cyan}${msg}${c.reset}`);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const ROOT = path.resolve(import.meta.dirname ?? __dirname, "..");
const ENV_FILE = path.join(ROOT, ".env");
const ENV_EXAMPLE = path.join(ROOT, ".env.example");

function commandExists(cmd: string): boolean {
  try {
    execSync(`command -v ${cmd}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function getNodeMajor(): number | null {
  try {
    const ver = execSync("node --version", { encoding: "utf8" }).trim();
    const match = ver.match(/^v(\d+)/);
    return match ? parseInt(match[1], 10) : null;
  } catch {
    return null;
  }
}

function serviceReachable(cmd: string): boolean {
  try {
    execSync(cmd, { stdio: "ignore", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

function readEnvFile(): Map<string, string> {
  const map = new Map<string, string>();
  if (!fs.existsSync(ENV_FILE)) return map;
  const lines = fs.readFileSync(ENV_FILE, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    // Strip surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    map.set(key, val);
  }
  return map;
}

function writeEnvFile(envMap: Map<string, string>) {
  // Read existing file to preserve comments and order
  let content = "";
  if (fs.existsSync(ENV_FILE)) {
    content = fs.readFileSync(ENV_FILE, "utf8");
  }

  // Update existing keys and track which ones we've handled
  const handled = new Set<string>();
  const lines = content.split("\n");
  const updatedLines = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return line;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) return line;
    const key = trimmed.slice(0, eqIdx).trim();
    if (envMap.has(key)) {
      handled.add(key);
      return `${key}=${envMap.get(key)}`;
    }
    return line;
  });

  // Append new keys
  for (const [key, val] of envMap) {
    if (!handled.has(key)) {
      updatedLines.push(`${key}=${val}`);
    }
  }

  fs.writeFileSync(ENV_FILE, updatedLines.join("\n"));
}

// ── Prompts ──────────────────────────────────────────────────────────────────

function createRl(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // Banner
  console.log("");
  console.log(`${c.bold}${c.bgBlue}${c.white}                                              ${c.reset}`);
  console.log(`${c.bold}${c.bgBlue}${c.white}   Welcome to AGEMS - Agent Management System  ${c.reset}`);
  console.log(`${c.bold}${c.bgBlue}${c.white}                                              ${c.reset}`);
  console.log("");

  // ── Step 1: Check prerequisites ──────────────────────────────────────────

  heading("Step 1/6 — Checking prerequisites");

  const nodeMajor = getNodeMajor();
  if (nodeMajor === null) {
    fail("Node.js not found. Please install Node.js >= 20.");
    process.exit(1);
  }
  if (nodeMajor < 20) {
    fail(`Node.js v${nodeMajor} detected. AGEMS requires Node.js >= 20.`);
    process.exit(1);
  }
  ok(`Node.js v${nodeMajor} detected`);

  const pgAvailable =
    commandExists("psql") || serviceReachable("pg_isready -h localhost -p 5432");
  if (pgAvailable) {
    ok("PostgreSQL is available");
  } else {
    warn("PostgreSQL not detected locally. Make sure it is reachable at your DATABASE_URL.");
  }

  const redisAvailable = serviceReachable("redis-cli -h localhost ping");
  if (redisAvailable) {
    ok("Redis is available");
  } else {
    warn("Redis not detected locally. Make sure it is reachable at your REDIS_URL.");
  }

  // ── Step 2: .env file ────────────────────────────────────────────────────

  heading("Step 2/6 — Environment configuration");

  if (!fs.existsSync(ENV_FILE)) {
    if (fs.existsSync(ENV_EXAMPLE)) {
      fs.copyFileSync(ENV_EXAMPLE, ENV_FILE);
      ok("Created .env from .env.example");
    } else {
      fs.writeFileSync(ENV_FILE, "# AGEMS environment variables\n");
      ok("Created empty .env file");
    }
  } else {
    ok(".env file already exists");
  }

  // ── Step 3: Prompt for essential env vars ─────────────────────────────────

  heading("Step 3/6 — Configuring environment variables");

  const envMap = readEnvFile();
  const rl = createRl();

  // DATABASE_URL
  const defaultDb = "postgresql://postgres:postgres@localhost:5432/agems";
  const currentDb = envMap.get("DATABASE_URL");
  if (!currentDb) {
    const dbUrl = await ask(
      rl,
      `  ${c.cyan}DATABASE_URL${c.reset} [${c.dim}${defaultDb}${c.reset}]: `
    );
    envMap.set("DATABASE_URL", dbUrl || defaultDb);
    ok(`DATABASE_URL set`);
  } else {
    ok(`DATABASE_URL already configured`);
  }

  // REDIS_URL
  const defaultRedis = "redis://localhost:6379";
  const currentRedis = envMap.get("REDIS_URL");
  if (!currentRedis) {
    const redisUrl = await ask(
      rl,
      `  ${c.cyan}REDIS_URL${c.reset} [${c.dim}${defaultRedis}${c.reset}]: `
    );
    envMap.set("REDIS_URL", redisUrl || defaultRedis);
    ok(`REDIS_URL set`);
  } else {
    ok(`REDIS_URL already configured`);
  }

  // JWT_SECRET
  const currentJwt = envMap.get("JWT_SECRET");
  if (!currentJwt || currentJwt === "agems-dev-secret") {
    const generated = crypto.randomBytes(32).toString("hex");
    const jwtSecret = await ask(
      rl,
      `  ${c.cyan}JWT_SECRET${c.reset} [${c.dim}auto-generate${c.reset}]: `
    );
    envMap.set("JWT_SECRET", jwtSecret || generated);
    ok(`JWT_SECRET set${!jwtSecret ? " (auto-generated)" : ""}`);
  } else {
    ok(`JWT_SECRET already configured`);
  }

  // LLM API Keys — need at least one
  const llmKeys = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GOOGLE_API_KEY"] as const;
  const hasLlmKey = llmKeys.some((k) => {
    const v = envMap.get(k);
    return v && v.length > 0;
  });

  if (!hasLlmKey) {
    warn("No LLM API key found. You need at least one to use AI features.");
    info("Provide one or more of the following (press Enter to skip):\n");

    for (const key of llmKeys) {
      const val = await ask(rl, `  ${c.cyan}${key}${c.reset}: `);
      if (val) {
        envMap.set(key, val);
        ok(`${key} set`);
      }
    }

    const nowHasKey = llmKeys.some((k) => {
      const v = envMap.get(k);
      return v && v.length > 0;
    });
    if (!nowHasKey) {
      warn("No LLM key provided. You can add one to .env later.");
    }
  } else {
    const setKeys = llmKeys.filter((k) => {
      const v = envMap.get(k);
      return v && v.length > 0;
    });
    ok(`LLM API key(s) configured: ${setKeys.join(", ")}`);
  }

  rl.close();

  // Write updated env
  writeEnvFile(envMap);
  ok(".env file updated");

  // ── Step 4: Install dependencies ──────────────────────────────────────────

  heading("Step 4/6 — Installing dependencies");

  const nodeModulesPath = path.join(ROOT, "node_modules");
  if (!fs.existsSync(nodeModulesPath)) {
    info("Running pnpm install...");
    try {
      execSync("pnpm install", { cwd: ROOT, stdio: "inherit" });
      ok("Dependencies installed");
    } catch {
      fail("pnpm install failed. Please run it manually.");
      process.exit(1);
    }
  } else {
    ok("node_modules already present (run pnpm install manually if needed)");
  }

  // ── Step 5: Database setup ────────────────────────────────────────────────

  heading("Step 5/6 — Setting up database");

  try {
    info("Generating Prisma client...");
    execSync("pnpm db:generate", { cwd: ROOT, stdio: "inherit" });
    ok("Prisma client generated");
  } catch {
    fail("db:generate failed. Check your DATABASE_URL and try again.");
    process.exit(1);
  }

  try {
    info("Pushing database schema...");
    execSync("pnpm db:push", { cwd: ROOT, stdio: "inherit" });
    ok("Database schema pushed");
  } catch {
    fail("db:push failed. Make sure PostgreSQL is running and DATABASE_URL is correct.");
    process.exit(1);
  }

  // ── Step 6: Success ───────────────────────────────────────────────────────

  heading("Step 6/6 — All done!");

  console.log("");
  console.log(`  ${c.green}${c.bold}AGEMS is ready to go!${c.reset}`);
  console.log("");
  console.log(`  ${c.bold}Next steps:${c.reset}`);
  console.log(`    1. Start development server:  ${c.cyan}pnpm dev${c.reset}`);
  console.log(`    2. Open the web app:          ${c.cyan}http://localhost:3000${c.reset}`);
  console.log(`    3. API available at:          ${c.cyan}http://localhost:3001${c.reset}`);
  console.log(`    4. Database UI:               ${c.cyan}pnpm db:studio${c.reset}`);
  console.log("");
  console.log(`  ${c.dim}Configuration: ${ENV_FILE}${c.reset}`);
  console.log("");
}

main().catch((err) => {
  fail(`Unexpected error: ${err.message}`);
  process.exit(1);
});
