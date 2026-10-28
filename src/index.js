import { IncidentSession } from "./session.js";
import { IncidentInvestigationWorkflow } from "./workflow.js";
import { json, now, id, safeText, classifySeverity, makeSystemPrompt } from "./utils.js";

export { IncidentSession, IncidentInvestigationWorkflow };

const corsHeaders = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,DELETE,OPTIONS", "access-control-allow-headers": "content-type" };
function withCors(response) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders)) headers.set(key, value);
  return new Response(response.body, { status: response.status, headers });
}
async function readJson(request) { try { return await request.json(); } catch { return null; } }

async function createIncident(env, title, summary, source = "chat") {
  const incidentId = id(), timestamp = now();
  const cleanTitle = safeText(title, 160) || "Untitled incident";
  const cleanSummary = safeText(summary, Number(env.MAX_INPUT_CHARS || 12000));
  const severity = classifySeverity(cleanSummary);
  await env.DB.prepare("INSERT INTO incidents (id, title, severity, status, summary, source, created_at, updated_at) VALUES (?, ?, ?, 'open', ?, ?, ?, ?)")
    .bind(incidentId, cleanTitle, severity, cleanSummary, source, timestamp, timestamp).run();
  return { id: incidentId, title: cleanTitle, severity, status: "open", summary: cleanSummary, created_at: timestamp, updated_at: timestamp };
}

async function chat(request, env) {
  const body = await readJson(request);
  if (!body || typeof body.message !== "string") return json({ error: "A message is required." }, 400);
  const message = safeText(body.message, Number(env.MAX_INPUT_CHARS || 12000));
  if (!message) return json({ error: "Message cannot be empty." }, 400);
  let incidentId = safeText(body.incidentId, 80), incident;
  if (incidentId) {
    incident = await env.DB.prepare("SELECT * FROM incidents WHERE id = ?").bind(incidentId).first();
    if (!incident) return json({ error: "Incident not found." }, 404);
  } else {
    incident = await createIncident(env, safeText(body.title, 160) || message.slice(0, 72), message);
    incidentId = incident.id;
  }
  await env.DB.prepare("INSERT INTO messages (id, incident_id, role, content, created_at) VALUES (?, ?, 'user', ?, ?)")
    .bind(id(), incidentId, message, now()).run();
  const historyRows = await env.DB.prepare("SELECT role, content FROM messages WHERE incident_id = ? ORDER BY created_at DESC LIMIT 12").bind(incidentId).all();
  const history = (historyRows.results || []).reverse().map(row => ({ role: row.role, content: row.content }));
  let answer;
  try {
    const result = await env.AI.run(env.AI_MODEL || "@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
      messages: [{ role: "system", content: makeSystemPrompt() }, ...history], max_tokens: 1200, temperature: 0.25
    });
    answer = result.response || "I couldn't generate a response. Please try again.";
  } catch (error) {
    console.error("LLM inference request failed", error?.message || error);
    return json({ error: "AI analysis is temporarily unavailable. Check the LLM inference binding and model availability." }, 502);
  }
  await env.DB.prepare("INSERT INTO messages (id, incident_id, role, content, created_at) VALUES (?, ?, 'assistant', ?, ?)")
    .bind(id(), incidentId, answer, now()).run();
  const severity = classifySeverity(message);
  await env.DB.prepare("UPDATE incidents SET summary = ?, severity = ?, updated_at = ? WHERE id = ?")
    .bind(message.slice(0, 2000), severity, now(), incidentId).run();
  const stub = env.INCIDENT_SESSIONS.get(env.INCIDENT_SESSIONS.idFromName(incidentId));
  await stub.fetch("https://session/message", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ role: "user", content: message }) }).catch(() => {});
  await stub.fetch("https://session/message", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ role: "assistant", content: answer }) }).catch(() => {});
  return json({ incidentId, answer, incident: { id: incidentId, title: incident.title, severity, status: incident.status } });
}

async function listIncidents(env) {
  const rows = await env.DB.prepare("SELECT id, title, severity, status, summary, source, created_at, updated_at FROM incidents ORDER BY updated_at DESC LIMIT 50").all();
  return json({ incidents: rows.results || [] });
}
async function getIncident(env, incidentId) {
  const incident = await env.DB.prepare("SELECT * FROM incidents WHERE id = ?").bind(incidentId).first();
  if (!incident) return json({ error: "Incident not found." }, 404);
  const messages = await env.DB.prepare("SELECT id, role, content, created_at FROM messages WHERE incident_id = ? ORDER BY created_at ASC LIMIT 100").bind(incidentId).all();
  const resolutions = await env.DB.prepare("SELECT id, title, resolution, created_at FROM resolutions WHERE incident_id = ? ORDER BY created_at DESC").bind(incidentId).all();
  return json({ incident, messages: messages.results || [], resolutions: resolutions.results || [] });
}
async function investigate(request, env) {
  const body = await readJson(request);
  if (!body) return json({ error: "Invalid JSON body." }, 400);
  const report = safeText(body.report, Number(env.MAX_INPUT_CHARS || 12000));
  if (!report) return json({ error: "An incident report is required." }, 400);
  const incident = await createIncident(env, safeText(body.title, 160) || report.slice(0, 72), report, "workflow");
  await env.DB.prepare("INSERT INTO messages (id, incident_id, role, content, created_at) VALUES (?, ?, 'user', ?, ?)")
    .bind(id(), incident.id, report, now()).run();
  try {
    const instance = await env.INCIDENT_WORKFLOW.create({ id: `incident-${incident.id}`, params: { incidentId: incident.id, report, context: safeText(body.context, 6000) } });
    return json({ incidentId: incident.id, workflowId: instance.id, status: "queued", message: "Investigation workflow started." }, 202);
  } catch (error) {
    console.error("Workflow start failed", error?.message || error);
    return json({ error: "Could not start the investigation workflow. Check the Workflows binding." }, 502);
  }
}
async function route(request, env) {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (url.pathname === "/api/health" && request.method === "GET") return json({ ok: true, app: env.APP_NAME || "SRE Incident Copilot", timestamp: now() });
  if (url.pathname === "/api/chat" && request.method === "POST") return chat(request, env);
  if (url.pathname === "/api/incidents" && request.method === "GET") return listIncidents(env);
  if (url.pathname === "/api/incidents" && request.method === "POST") {
    const body = await readJson(request);
    if (!body) return json({ error: "Invalid JSON body." }, 400);
    return json({ incident: await createIncident(env, body.title, body.summary, body.source || "manual") }, 201);
  }
  if (url.pathname === "/api/investigate" && request.method === "POST") return investigate(request, env);
  const incidentMatch = url.pathname.match(/^\/api\/incidents\/([\w-]+)$/);
  if (incidentMatch && request.method === "GET") return getIncident(env, incidentMatch[1]);
  if (incidentMatch && request.method === "DELETE") {
    const incidentId = incidentMatch[1];
    await env.DB.prepare("DELETE FROM incidents WHERE id = ?").bind(incidentId).run();
    const stub = env.INCIDENT_SESSIONS.get(env.INCIDENT_SESSIONS.idFromName(incidentId));
    await stub.fetch("https://session/state", { method: "DELETE" }).catch(() => {});
    return json({ ok: true });
  }
  if (url.pathname === "/api/resolutions" && request.method === "POST") {
    const body = await readJson(request);
    if (!body || !body.incidentId || !body.title || !body.resolution) return json({ error: "incidentId, title, and resolution are required." }, 400);
    const incident = await env.DB.prepare("SELECT id FROM incidents WHERE id = ?").bind(body.incidentId).first();
    if (!incident) return json({ error: "Incident not found." }, 404);
    const resolutionId = id();
    await env.DB.prepare("INSERT INTO resolutions (id, incident_id, title, resolution, created_at) VALUES (?, ?, ?, ?, ?)")
      .bind(resolutionId, body.incidentId, safeText(body.title, 160), safeText(body.resolution, 6000), now()).run();
    return json({ id: resolutionId }, 201);
  }
  return json({ error: "Not found" }, 404);
}
export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (url.pathname.startsWith("/api/")) return withCors(await route(request, env));
      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error("Unhandled request error", error?.message || error);
      return withCors(json({ error: "Internal server error." }, 500));
    }
  }
};
