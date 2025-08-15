// Pure function to calculate weighted pipeline totals
export function calculateWeightedPipeline(stages, columns, mode = 'absolute') {
  // mode = 'absolute' -> stage.prob is chance to reach "First Event Live"
  // mode = 'transition' -> stage.prob is chance to advance to the *next* stage;
  // cumulative probability to end is product of transitions from here to the end
  const probToEndCache = new Map();
  const probToEnd = (idx) => {
    if (probToEndCache.has(idx)) return probToEndCache.get(idx);
    if (idx >= stages.length - 1) {
      const p = 1; // last stage -> assume success
      probToEndCache.set(idx, p);
      return p;
    }
    const s = stages[idx];
    const p = Math.max(0, Math.min(1, Number(s.prob || 0) / 100));
    const res = mode === 'absolute' ? p : p * probToEnd(idx + 1);
    probToEndCache.set(idx, res);
    return res;
  };

  let total = 0;
  let weighted = 0;
  const perStage = stages.map((s, i) => {
    const cards = columns[s.id] || [];
    const stageTotal = cards.reduce((sum, c) => sum + (Number(c.value) || 0), 0);
    const p = probToEnd(i);
    const stageWeighted = stageTotal * p;
    total += stageTotal;
    weighted += stageWeighted;
    return {
      id: s.id,
      name: s.name,
      prob: Number(s.prob || 0),
      count: cards.length,
      total: stageTotal,
      weighted: stageWeighted,
    };
  });
  return { total, weighted, perStage };
}
