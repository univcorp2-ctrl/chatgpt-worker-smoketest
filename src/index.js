const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

const TYPES = new Set([
  "research",
  "deep_research_result",
  "decision",
  "task",
  "idea",
  "property_analysis",
  "finance",
  "dev",
  "personal_reflection",
  "meeting_note"
]);

const PRIORITIES = new Set(["A", "B", "C"]);
const AREAS = new Set([
  "real_estate",
  "finance",
  "ai_automation",
  "github_dev",
  "business",
  "personal",
  "investment",
  "sales",
  "research"
]);

export default {
  async fetch(request, env) {
    try {
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: JSON_HEADERS });
      }

      const url = new URL(request.url);
      const route = parseRoute(url.pathname);
      if (!route) return json({ ok: false, error: "not_found" }, 404);

      if (!env.URL_SECRET || route.secret !== env.URL_SECRET) {
        return json({ ok: false, error: "unauthorized" }, 401);
      }

      if (route.action === "health" && request.method === "GET") {
        return json({
          ok: true,
          service: "chatgpt-output-capture-api",
          timestamp: new Date().toISOString(),
          storage: {
            kv: Boolean(env.CAPTURE_KV),
            github: Boolean(env.GITHUB_TOKEN && env.GITHUB_REPO)
          }
        });
      }

      if (route.action === "capture" && request.method === "POST") {
        return handleCapture(request, env);
      }

      if (route.action === "handoff" && request.method === "POST") {
        return handleHandoff(request, env);
      }

      if (route.action === "github-issue" && request.method === "POST") {
        return handleGithubIssue(request, env);
      }

      return json({ ok: false, error: "method_or_route_not_allowed" }, 405);
    } catch (error) {
      return json({ ok: false, error: "server_error", message: error.message }, 500);
    }
  }
};

function parseRoute(pathname) {
  const match = pathname.match(/^\/t\/([^/]+)\/(health|capture|handoff|github-issue)\/?$/);
  if (!match) return null;
  return { secret: decodeURIComponent(match[1]), action: match[2] };
}

async function handleCapture(request, env) {
  const body = await readJson(request);
  requireFields(body, ["title", "date", "type", "priority", "area", "summary", "markdown"]);
  assertEnum("type", body.type, TYPES);
  assertEnum("priority", body.priority, PRIORITIES);
  assertEnum("area", body.area, AREAS);

  const id = createId(body.date, body.area, body.type, body.title);
  const markdownPath = `captures/${body.area}/${id}.md`;
  const jsonPath = `captures/${body.area}/${id}.json`;
  const payload = { id, captured_at: new Date().toISOString(), ...body };

  const saved = await saveRecord(env, [
    { path: markdownPath, content: body.markdown || body.summary || "" },
    { path: jsonPath, content: JSON.stringify(payload, null, 2) }
  ]);

  return json({
    ok: true,
    id,
    saved_locations: {
      google_drive_path: null,
      obsidian_path: null,
      github_path: saved.github ? markdownPath : null,
      github_issue_url: null,
      notion_url: null,
      database_id: saved.kv ? id : null
    },
    storage: saved,
    message: saved.message
  });
}

async function handleHandoff(request, env) {
  const body = await readJson(request);
  requireFields(body, ["project_name", "goal", "context", "agent_prompt"]);

  const id = createId(new Date().toISOString().slice(0, 10), "agent_handoff", "handoff", body.project_name);
  const path = `agent_handoff/${id}.md`;
  const markdown = [
    `# ${body.project_name}`,
    "",
    "## Goal",
    body.goal,
    "",
    "## Context",
    body.context,
    "",
    "## Current State",
    body.current_state || "",
    "",
    "## Required Output",
    body.required_output || "",
    "",
    "## Agent Prompt",
    body.agent_prompt
  ].join("\n");

  const saved = await saveRecord(env, [
    { path, content: markdown },
    { path: `agent_handoff/${id}.json`, content: JSON.stringify({ id, created_at: new Date().toISOString(), ...body }, null, 2) }
  ]);

  return json({ ok: true, id, saved_path: saved.github ? path : null, storage: saved, message: saved.message });
}

async function handleGithubIssue(request, env) {
  const body = await readJson(request);
  requireFields(body, ["title", "body", "priority", "area"]);
  assertEnum("priority", body.priority, PRIORITIES);
  assertEnum("area", body.area, AREAS);

  const repo = body.repo || env.GITHUB_REPO;
  let issueUrl = null;
  if (body.create_issue === true) {
    if (!env.GITHUB_TOKEN || !repo) throw new Error("GITHUB_TOKEN and GITHUB_REPO are required to create issues");
    issueUrl = await createGithubIssue(env.GITHUB_TOKEN, repo, body);
  }

  const id = createId(new Date().toISOString().slice(0, 10), body.area, "issue", body.title);
  const path = `issues/${id}.md`;
  const saved = await saveRecord(env, [
    { path, content: body.body },
    { path: `issues/${id}.json`, content: JSON.stringify({ id, created_at: new Date().toISOString(), issue_url: issueUrl, ...body }, null, 2) }
  ]);

  return json({ ok: true, issue_url: issueUrl, saved_path: saved.github ? path : null, storage: saved, message: saved.message });
}

async function saveRecord(env, files) {
  const result = { kv: false, github: false, message: "saved" };

  if (env.CAPTURE_KV) {
    for (const file of files) {
      await env.CAPTURE_KV.put(file.path, file.content);
    }
    result.kv = true;
  }

  if (env.GITHUB_TOKEN && env.GITHUB_REPO) {
    for (const file of files) {
      await putGithubFile(env.GITHUB_TOKEN, env.GITHUB_REPO, file.path, file.content);
    }
    result.github = true;
  }

  if (!result.kv && !result.github) {
    result.message = "accepted; no persistent storage configured. Bind CAPTURE_KV or set GITHUB_TOKEN and GITHUB_REPO to persist records.";
  }

  return result;
}

async function putGithubFile(token, repo, path, content) {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const url = `https://api.github.com/repos/${repo}/contents/${encodedPath}`;
  const existing = await fetch(url, { headers: githubHeaders(token) });
  let sha;
  if (existing.ok) {
    sha = (await existing.json()).sha;
  } else if (existing.status !== 404) {
    throw new Error(`GitHub fetch failed: ${existing.status}`);
  }

  const response = await fetch(url, {
    method: "PUT",
    headers: githubHeaders(token),
    body: JSON.stringify({
      message: `Save ChatGPT output ${path}`,
      content: btoa(unescape(encodeURIComponent(content))),
      sha
    })
  });
  if (!response.ok) throw new Error(`GitHub save failed: ${response.status} ${await response.text()}`);
}

async function createGithubIssue(token, repo, body) {
  const response = await fetch(`https://api.github.com/repos/${repo}/issues`, {
    method: "POST",
    headers: githubHeaders(token),
    body: JSON.stringify({ title: body.title, body: body.body, labels: body.labels || [] })
  });
  if (!response.ok) throw new Error(`GitHub issue create failed: ${response.status} ${await response.text()}`);
  return (await response.json()).html_url;
}

function githubHeaders(token) {
  return {
    "Authorization": `Bearer ${token}`,
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json"
  };
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw new Error("Request body must be valid JSON");
  }
}

function requireFields(body, fields) {
  const missing = fields.filter((field) => body[field] === undefined || body[field] === null || body[field] === "");
  if (missing.length) throw new Error(`Missing required fields: ${missing.join(", ")}`);
}

function assertEnum(name, value, allowed) {
  if (!allowed.has(value)) throw new Error(`Invalid ${name}: ${value}`);
}

function createId(date, area, type, title) {
  const cleanDate = String(date || new Date().toISOString().slice(0, 10)).slice(0, 10);
  return `${cleanDate}_${slug(area)}_${slug(type)}_${slug(title).slice(0, 80)}_${crypto.randomUUID().slice(0, 8)}`;
}

function slug(value) {
  return String(value || "item")
    .toLowerCase()
    .replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "") || "item";
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: JSON_HEADERS });
}
