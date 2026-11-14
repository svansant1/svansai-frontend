export type Evidence = {
  id: string; summary: string; source: "user_report" | "source_review" | "experiment";
  sourceRef: string; independentGroup: string; observedAt: string;
};
export type HypothesisUpdate = { evidenceId: string; effect: "supports" | "contradicts" | "inconclusive"; strength: number; explanation: string };
export type Hypothesis = { id: string; statement: string; updates: HypothesisUpdate[] };
export type RankedHypothesis = Hypothesis & { confidence: number; confidenceKind: "heuristic_not_probability"; supportingEvidence: string[]; contradictoryEvidence: string[]; patchGate: "eligible_for_review" | "blocked"; blockers: string[] };

/** Confidence ranks explanations; it is not calibrated likelihood or proof of causation. */
export function rankHypotheses(hypotheses: Hypothesis[], evidence: Evidence[]): RankedHypothesis[] {
  if (hypotheses.length > 12 || evidence.length > 200) throw new Error("Investigation exceeds its bounded working set.");
  const byId = new Map(evidence.map((item) => [item.id, item]));
  if (byId.size !== evidence.length || new Set(hypotheses.map((item) => item.id)).size !== hypotheses.length) throw new Error("Evidence and hypotheses need unique identities.");
  return hypotheses.map((hypothesis): RankedHypothesis => {
    if (!hypothesis.id || !hypothesis.statement.trim() || hypothesis.updates.length > 200) throw new Error("Invalid hypothesis.");
    const groups = new Map<string, number>(), seen = new Set<string>(), supportingEvidence: string[] = [], contradictoryEvidence: string[] = [];
    let experimentalSupport = false;
    for (const update of hypothesis.updates) {
      const item = byId.get(update.evidenceId);
      if (!item || !item.sourceRef || !item.independentGroup || !["user_report", "source_review", "experiment"].includes(item.source) ||
          !["supports", "contradicts", "inconclusive"].includes(update.effect) || seen.has(item.id) || !Number.isFinite(update.strength) ||
          update.strength < 0 || update.strength > 1 || !update.explanation.trim()) throw new Error("Hypothesis updates require unique, referenced evidence.");
      seen.add(item.id);
      if (update.effect === "inconclusive") continue;
      const trust = item.source === "experiment" ? 1 : item.source === "source_review" ? 0.7 : 0.4;
      const weight = update.strength * trust * (update.effect === "supports" ? 1 : -1);
      // Related logs/reruns do not count as independent corroboration.
      const old = groups.get(item.independentGroup);
      if (old === undefined || (weight < 0 && (old >= 0 || weight < old)) || (old >= 0 && weight > old)) groups.set(item.independentGroup, weight);
      if (update.effect === "supports") { supportingEvidence.push(item.id); if (item.source === "experiment" && update.strength >= 0.7) experimentalSupport = true; }
      else contradictoryEvidence.push(item.id);
    }
    const net = [...groups.values()].reduce((sum, weight) => sum + weight, 0);
    const confidence = Math.round(Math.max(0.02, Math.min(0.98, 0.2 + net * 0.3)) * 100) / 100;
    const blockers: string[] = [];
    if (confidence < 0.8) blockers.push("Insufficient corroborated evidence (minimum heuristic score 0.80).");
    if ([...groups.values()].filter((weight) => weight > 0).length < 2) blockers.push("Need two independent supporting evidence groups.");
    if (!experimentalSupport) blockers.push("Need a controlled experiment supporting this explanation.");
    if (contradictoryEvidence.length) blockers.push("Contradictory evidence must be resolved, not hidden.");
    return { ...hypothesis, confidence, confidenceKind: "heuristic_not_probability", supportingEvidence, contradictoryEvidence,
      patchGate: blockers.length ? "blocked" : "eligible_for_review", blockers };
  }).sort((a, b) => b.confidence - a.confidence || a.id.localeCompare(b.id));
}

export function patchGate(ranked: RankedHypothesis[], hypothesisId: string): string[] {
  const selected = ranked.find((item) => item.id === hypothesisId);
  if (!selected) return ["Root-cause hypothesis is missing."];
  const blockers = [...selected.blockers];
  const competitor = ranked.find((item) => item.id !== hypothesisId);
  if (competitor && selected.confidence - competitor.confidence < 0.15) blockers.push("Leading hypotheses remain too close; design a distinguishing experiment.");
  return blockers;
}
