import { makeSystemPrompt, now, id } from "./utils.js";

/** Durable, retryable multi-step investigation. Findings are advisory, not automated actions. */
export class IncidentInvestigationWorkflow {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; }

  async run(event, step) {
    const { incidentId, report, context = "" } = event.payload || {};
    if (!incidentId || !report) throw new Error("incidentId and report are required");

    const prepared = await step.do("prepare-investigation", async () => ({
      incidentId,
      report: String(report).slice(0, 12000),
      context: String(context).slice(0, 6000),
      startedAt: now()
    }));

    const analysis = await step.do("analyze-evidence", async () => {
      const prompt = `${makeSystemPrompt()}\n\nAnalyze this incident report. Return a practical investigation plan with: summary, severity, observed facts, ranked hypotheses, safe diagnostic checks, possible mitigations (human approval required), and missing information.\n\nIncident report:\n${prepared.report}\n\nAdditional context:\n${prepared.context || "None supplied"}`;
      const result = await this.env.AI.run(this.env.AI_MODEL || "@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
        messages: [
          { role: "system", content: makeSystemPrompt() },
          { role: "user", content: prompt }
        ],
        max_tokens: 1400,
        temperature: 0.2
      });
      return result.response || "The model returned no analysis. Please retry with more evidence.";
    });

    await step.do("persist-findings", async () => {
      await this.env.DB.prepare("INSERT INTO messages (id, incident_id, role, content, created_at) VALUES (?, ?, 'assistant', ?, ?)")
        .bind(id(), incidentId, `[Workflow investigation]\n${analysis}`, now()).run();
      await this.env.DB.prepare("UPDATE incidents SET summary = ?, updated_at = ? WHERE id = ?")
        .bind(analysis.slice(0, 2000), now(), incidentId).run();
      return { saved: true };
    });

    return { incidentId, analysis, completedAt: now() };
  }
}
