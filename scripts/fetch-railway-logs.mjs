// Pulls cuhz_bot stdout/stderr from Railway GraphQL and writes JSONL
// snapshots into logs/YYYY/MM/DD/HH-MM.jsonl on the logs-archive branch.
//
// Env: RAILWAY_API_TOKEN, RAILWAY_PROJECT_ID, RAILWAY_SERVICE_ID
// Args: --out <jsonl-path> --cursor-file <path>
//
// Cursor is per-deployment: { "<deploymentId>": "<iso-timestamp>" }
// so a redeploy starts from its own beginning, not the previous tail.
import fs from "node:fs/promises";

const API = "https://backboard.railway.app/graphql/v2";
const TOKEN = process.env.RAILWAY_API_TOKEN;
const PROJECT_ID = process.env.RAILWAY_PROJECT_ID;
const SERVICE_ID = process.env.RAILWAY_SERVICE_ID;

if (!TOKEN || !PROJECT_ID || !SERVICE_ID) {
    console.error("missing RAILWAY_API_TOKEN / RAILWAY_PROJECT_ID / RAILWAY_SERVICE_ID");
    process.exit(1);
}

const OUT = process.argv[process.argv.indexOf("--out") + 1];
const CURSOR_FILE = process.argv[process.argv.indexOf("--cursor-file") + 1];
const PAGE = 5000;

async function gql(query, variables, attempt = 1) {
    const r = await fetch(API, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${TOKEN}`,
        },
        body: JSON.stringify({ query, variables }),
    });
    if ((r.status === 429 || r.status >= 500) && attempt <= 3) {
        const wait = 2000 * 2 ** (attempt - 1);
        console.error(`HTTP ${r.status}, retrying in ${wait}ms (attempt ${attempt})`);
        await new Promise((res) => setTimeout(res, wait));
        return gql(query, variables, attempt + 1);
    }
    if (!r.ok) throw new Error(`Railway API ${r.status}: ${await r.text()}`);
    const j = await r.json();
    if (j.errors) throw new Error(`GraphQL: ${JSON.stringify(j.errors)}`);
    return j.data;
}

const depQuery = `
  query($projectId: String!, $serviceId: String!) {
    deployments(first: 1, input: { projectId: $projectId, serviceId: $serviceId }) {
      edges { node { id status createdAt } }
    }
  }`;
const dep = await gql(depQuery, { projectId: PROJECT_ID, serviceId: SERVICE_ID });
const deploymentId = dep.deployments?.edges?.[0]?.node?.id;
if (!deploymentId) {
    console.log("no active deployment");
    process.exit(0);
}

let cursors = {};
try {
    cursors = JSON.parse(await fs.readFile(CURSOR_FILE, "utf8"));
} catch {}
let since = cursors[deploymentId] ?? null;

const logsQuery = `
  query($deploymentId: String!, $startDate: DateTime, $limit: Int!) {
    deploymentLogs(deploymentId: $deploymentId, startDate: $startDate, limit: $limit) {
      timestamp severity message tags attributes { key value }
    }
  }`;

const all = [];
while (true) {
    const vars = { deploymentId, limit: PAGE };
    if (since) vars.startDate = since;
    const data = await gql(logsQuery, vars);
    const batch = data.deploymentLogs ?? [];
    if (batch.length === 0) break;
    const fresh = since ? batch.filter((e) => e.timestamp > since) : batch;
    if (fresh.length === 0) break;
    all.push(...fresh);
    since = fresh[fresh.length - 1].timestamp;
    if (batch.length < PAGE) break;
}

if (all.length === 0) {
    console.log("no new logs");
    process.exit(0);
}

const dir = OUT.substring(0, OUT.lastIndexOf("/"));
if (dir) await fs.mkdir(dir, { recursive: true });
await fs.writeFile(OUT, all.map((e) => JSON.stringify(e)).join("\n") + "\n");

cursors[deploymentId] = since;
await fs.writeFile(CURSOR_FILE, JSON.stringify(cursors, null, 2) + "\n");
console.log(`wrote ${all.length} entries for deployment ${deploymentId}`);
