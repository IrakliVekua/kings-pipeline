import React from 'react';

import { loadBoard, upsertCard, moveCard, deleteCard, saveStageOrder, updateCardRow } from './db';
const BOARD_ID = import.meta.env.VITE_BOARD_ID;


// Utility: robust UUID fallback
const uuid = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : (Math.random().toString(36).slice(2) + Date.now()));

// Helper: initials for avatar
const initials = (name = '') => name.trim().split(/\s+/).slice(0,2).map(p=>p[0]?.toUpperCase()||'').join('');

// Pure function so we can unit-test pipeline math
export function calculateWeightedPipeline(stages, columns, mode = 'absolute') {
  // mode = 'absolute' -> stage.prob is chance to reach "First Event Live"
  // mode = 'transition' -> stage.prob is chance to advance to the *next* stage; cumulative prob to end is product of transitions from here to the end
  const probToEndCache = new Map();
  const probToEnd = (idx) => {
    if (probToEndCache.has(idx)) return probToEndCache.get(idx);
    if (idx >= stages.length - 1) { // last stage -> assume success
      const p = 1;
      probToEndCache.set(idx, p); return p;
    }
    const s = stages[idx];
    const p = Math.max(0, Math.min(1, Number(s.prob || 0) / 100));
    let res;
    if (mode === 'absolute') {
      res = p;
    } else {
      res = p * probToEnd(idx + 1);
    }
    probToEndCache.set(idx, res);
    return res;
  };

  let total = 0, weighted = 0;
  const perStage = stages.map((s, i) => {
    const cards = (columns[s.id] || []);
    const stageTotal = cards.reduce((sum, c) => sum + (Number(c.value) || 0), 0);
    const p = probToEnd(i);
    const stageWeighted = stageTotal * p;
    total += stageTotal; weighted += stageWeighted;
    return { id: s.id, name: s.name, prob: Number(s.prob || 0), count: cards.length, total: stageTotal, weighted: stageWeighted };
  });
  return { total, weighted, perStage };
}

export default function KingsPipelineKanban() {
  // --- Types (inline) ---
  // Stage: { id, name, prob (win %), wip }
  // Card: { id, country, value, owner, org, nextAction, due, priority, links, notes, flags }

  // --- Defaults (no external libraries; HTML5 drag & drop) ---
  const DEFAULT_STAGES = [
    { id: "market-fit", name: "Market & Feasibility", prob: 10 },
    { id: "sourcing", name: "Scout Sourcing (Upwork)", prob: 15 },
    { id: "scout-hired", name: "Scout Hired", prob: 20 },
    { id: "discovery", name: "Discovery Call Scheduled", prob: 30 },
    { id: "qualify", name: "Partner Qualified", prob: 40 },
    { id: "nda", name: "NDA Signed", prob: 50 },
    { id: "tech", name: "Tech & Ops Deep Dive", prob: 55 },
    { id: "jaa-draft", name: "JAA Draft / Negotiation", prob: 65 },
    { id: "jaa-signed", name: "JAA Signed", prob: 80 },
    { id: "prelaunch", name: "Pre‑Launch Setup", prob: 90 },
    { id: "first-event", name: "First Event Live", prob: 100 },
    { id: "scale", name: "Scale‑up / Post‑Mortem", prob: 100 },
  ];

  const SAMPLE_CARDS = [
    { id: uuid(), country: "Moldova", org: "Local Olympiad Assoc.", owner: "Roma", nextAction: "Kickoff call notes → NDA", priority: "Med", value: 12000, flags: { nda: false, tech: false, jaa: false } },
    { id: uuid(), country: "Egypt", org: "STEM Competitions Egypt", owner: "Irakli", nextAction: "Share JAA draft", priority: "High", value: 30000, flags: { nda: true, tech: true, jaa: false } },
    { id: uuid(), country: "Cyprus", owner: "Ana", nextAction: "Post Upwork job for scout", priority: "Low", value: 8000, flags: { nda: false, tech: false, jaa: false } },
  ];

  const STORAGE_KEY = "kings-pipeline-board-v2-lite";

  const [stages, setStages] = React.useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return parsed.stages || DEFAULT_STAGES;
      } catch {}
    }
    return DEFAULT_STAGES;
  });

  const [columns, setColumns] = React.useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.columns) return parsed.columns;
      } catch {}
    }
    const cols = {};
    DEFAULT_STAGES.forEach((s, i) => (cols[s.id] = i === 0 ? [...SAMPLE_CARDS] : []));
    return cols;
  });

  React.useEffect(() => {
  (async () => {
    try {
      const { stages: s, columns: c } = await loadBoard(BOARD_ID);
      if (s?.length) {
        setStages(s);
        setColumns(c);
      }
    } catch (e) {
      console.warn('DB load failed, using localStorage fallback', e);
    }
  })();
}, []);


  const [filter, setFilter] = React.useState("");
  const [showStageEditor, setShowStageEditor] = React.useState(false);
  const [showAddModal, setShowAddModal] = React.useState(false);
  const [editingCard, setEditingCard] = React.useState(null); // { stageId, card }
  const [importJson, setImportJson] = React.useState("");
  const [probabilityMode, setProbabilityMode] = React.useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY + ":probMode");
    return saved === 'transition' ? 'transition' : 'absolute';
  });

  React.useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ stages, columns }));
  }, [stages, columns]);

  React.useEffect(() => {
    localStorage.setItem(STORAGE_KEY + ":probMode", probabilityMode);
  }, [probabilityMode]);

  // Keyboard shortcut: N to open New Country modal
  React.useEffect(() => {
    const onKey = (e) => { if ((e.key === 'n' || e.key === 'N') && !showAddModal && !showStageEditor && !editingCard) { e.preventDefault(); setShowAddModal(true); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showAddModal, showStageEditor, editingCard]);

  // --- Drag & Drop (HTML5) ---
  const onDragStart = (e, fromStageId, cardId) => {
    e.dataTransfer.setData("text/plain", JSON.stringify({ t: "card", from: fromStageId, id: cardId }));
    e.dataTransfer.effectAllowed = "move";
  };
  const onDragOverCol = (e) => {
    e.preventDefault(); // allow drop
    e.dataTransfer.dropEffect = "move";
  };
  const onDropToCol = (e, toStageId) => {
    e.preventDefault();
    try {
      const data = JSON.parse(e.dataTransfer.getData("text/plain"));
      if (data?.t !== "card") return;
      const { from, id } = { from: data.from, id: data.id };
      if (!from || !id || from === toStageId) return;
      const card = (columns[from] || []).find((c) => c.id === id);
      if (!card) return;
      setColumns((prev) => {
        const fromList = (prev[from] || []).filter((c) => c.id !== id);
        const toList = [...(prev[toStageId] || []), card];
        return { ...prev, [from]: fromList, [toStageId]: toList };
      });
      moveCard(card.id, toStageId).catch(console.error);
    } catch {}
  };

  // --- Helpers ---
  const addCard = (stageId) => {
    setShowAddModal(true);
    // Preselect target stage via modal's local state
    setPendingNew({ stageId, country: '', value: '', owner: '', org: '', priority: '', nextAction: '', due: '' });
  };
  const removeCard = (stageId, id) => {
    if (!confirm("Remove this card?")) return;
    setColumns((prev) => ({ ...prev, [stageId]: (prev[stageId] || []).filter((c) => c.id !== id) }));
    deleteCard(id).catch(console.error);
  };
  const updateCard = (stageId, updated) => {
    setColumns((prev) => ({
      ...prev,
      [stageId]: (prev[stageId] || []).map((c) => (c.id === updated.id ? updated : c)),
    }));
    updateCardRow(updated).catch(console.error);
  };

  const exportJSON = () => {
    const data = JSON.stringify({ stages, columns }, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `kings-pipeline-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const importFromJSON = () => {
    try {
      const parsed = JSON.parse(importJson);
      if (!parsed?.stages || !parsed?.columns) throw new Error("Invalid file");
      setStages(parsed.stages);
      setColumns(parsed.columns);
      setImportJson("");
      alert("Imported!");
    } catch (e) {
      alert("Import failed: " + (e?.message || "Unknown error"));
    }
  };

  const moveStage = (index, dir) => {
    const j = index + dir;
    if (j < 0 || j >= stages.length) return;
    const s = [...stages];
    const tmp = s[index];
    s[index] = s[j];
    s[j] = tmp;
    // keep columns keyed by id — no remap needed
    setStages(s);
  };

  const pipeline = React.useMemo(() => calculateWeightedPipeline(stages, columns, probabilityMode), [stages, columns, probabilityMode]);

  const filteredColumns = React.useMemo(() => {
    if (!filter.trim()) return columns;
    const out = {};
    for (const sid of Object.keys(columns)) {
      out[sid] = (columns[sid] || []).filter((c) =>
        [c.country, c.org, c.owner, c.nextAction, c.notes, c.links, String(c.value || "")] 
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(filter.toLowerCase())
      );
    }
    return out;
  }, [columns, filter]);

  // --- New Country modal state & handler ---
  const [pendingNew, setPendingNew] = React.useState({ stageId: DEFAULT_STAGES[0].id, country: '', value: '', owner: '', org: '', priority: '', nextAction: '', due: '' });
  const saveNewCountry = () => {
    const sId = pendingNew.stageId || stages[0]?.id;
    if (!pendingNew.country?.trim()) { alert('Please enter a country'); return; }
    const val = Number(pendingNew.value);
    const card = {
      id: uuid(),
      country: pendingNew.country.trim(),
      value: isNaN(val) ? undefined : val,
      owner: pendingNew.owner?.trim() || undefined,
      org: pendingNew.org?.trim() || undefined,
      priority: pendingNew.priority || undefined,
      nextAction: pendingNew.nextAction?.trim() || undefined,
      due: pendingNew.due || undefined,
      flags: {}
    };
    setColumns((prev) => ({ ...prev, [sId]: [card, ...(prev[sId] || [])] }));
    setShowAddModal(false);
    upsertCard(BOARD_ID, sId, card).catch(console.error);
  };

  // --- UI ---
  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_at_top,theme(colors.indigo.50),white)] dark:bg-[radial-gradient(ellipse_at_top,theme(colors.zinc.900),theme(colors.zinc.950))] text-zinc-900 dark:text-zinc-100">
      <div className="mx-auto max-w-[1500px] px-4 py-6">
        {/* Topbar */}
        <div className="sticky top-0 z-10 -mx-4 mb-6 bg-white/70 dark:bg-zinc-900/70 backdrop-blur supports-[backdrop-filter]:bg-white/50 dark:supports-[backdrop-filter]:bg-zinc-900/50 border-b px-4 py-3">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-2xl bg-indigo-600 text-white grid place-items-center font-bold">K</div>
              <div>
                <h1 className="text-lg font-semibold tracking-tight">Kings Expansion Pipeline</h1>
                <div className="text-[12px] text-zinc-500">Weighted: <b>${pipeline.weighted.toLocaleString()}</b> • Face value: ${pipeline.total.toLocaleString()}</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button className="rounded-xl px-3 py-2 text-sm border hover:bg-zinc-50 dark:hover:bg-zinc-800" onClick={() => setShowStageEditor(true)}>Stages</button>
              <select className="rounded-xl border px-3 py-2 text-sm" value={probabilityMode} onChange={(e) => setProbabilityMode(e.target.value)}>
                <option value="absolute">Win% = chance to reach First Event</option>
                <option value="transition">Win% = chance to move to next stage</option>
              </select>
              <input className="w-56 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm" placeholder="Search…" value={filter} onChange={(e) => setFilter(e.target.value)} />
              <button onClick={exportJSON} className="rounded-xl px-3 py-2 text-sm border hover:bg-zinc-50 dark:hover:bg-zinc-800">Export</button>
              <details className="relative">
                <summary className="list-none"><span className="rounded-xl px-3 py-2 text-sm border inline-block cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800">Import</span></summary>
                <div className="absolute right-0 mt-2 w-[360px] p-3 bg-white dark:bg-zinc-900 rounded-xl shadow border">
                  <textarea rows={6} className="w-full rounded-xl border p-2 text-sm" placeholder="Paste exported JSON here" value={importJson} onChange={(e) => setImportJson(e.target.value)} />
                  <div className="flex justify-end gap-2 mt-2">
                    <button className="px-3 py-2 rounded-xl border text-sm" onClick={() => setImportJson("")}>Clear</button>
                    <button className="px-3 py-2 rounded-xl border text-sm" onClick={importFromJSON}>Import</button>
                  </div>
                </div>
              </details>
              <button onClick={() => { setPendingNew({ stageId: stages[0]?.id, country: '', value: '', owner: '', org: '', priority: '', nextAction: '', due: '' }); setShowAddModal(true); }} className="rounded-xl px-3 py-2 text-sm bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm">New country ⌘N</button>
            </div>
          </div>
        </div>

        {/* Per-stage overview pills */}
        <div className="flex gap-2 overflow-x-auto mb-4">
          {pipeline.perStage.map((s) => (
            <span key={s.id} className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[12px] bg-white/70 dark:bg-zinc-900/70">
              <span className="font-medium">{s.name}</span>
              <span className="opacity-70">{s.count} deals</span>
              <span className="opacity-70">Win {s.prob}%</span>
              <span className="opacity-70">Σ ${Math.round(s.total).toLocaleString()}</span>
              <span className="font-medium">WΣ ${Math.round(s.weighted).toLocaleString()}</span>
            </span>
          ))}
        </div>

        {/* Board */}
        <div className="flex gap-4 overflow-x-auto pb-10">
          {stages.map((stage, i) => (
            <div key={stage.id} className="min-w-[340px] max-w-[360px]">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <h2 className="font-medium tracking-tight">{stage.name}</h2>
                  {typeof stage.wip === "number" && <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px]">WIP {stage.wip}</span>}
                  {typeof stage.prob === "number" && <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px]">Win {stage.prob}%</span>}
                </div>
                <div className="flex items-center gap-1">
                  <button className="px-2 py-1 rounded-lg border text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800" onClick={() => addCard(stage.id)}>Add</button>
                  <button className="px-2 py-1 rounded-lg border text-xs" onClick={() => moveStage(i, -1)}>↑</button>
                  <button className="px-2 py-1 rounded-lg border text-xs" onClick={() => moveStage(i, +1)}>↓</button>
                </div>
              </div>

              <div className="rounded-2xl border bg-white/90 dark:bg-zinc-900/80 backdrop-blur p-3 min-h-[160px] shadow-sm"
                   onDragOver={onDragOverCol}
                   onDrop={(e) => onDropToCol(e, stage.id)}>
                {(filteredColumns[stage.id] || []).length === 0 && (
                  <div className="text-xs text-zinc-500 py-6 text-center border border-dashed rounded-xl">Drop country here</div>
                )}
                <div className="space-y-3">
                  {(filteredColumns[stage.id] || []).map((c) => (
                    <div key={c.id}
                         className="rounded-xl border p-3 bg-white dark:bg-zinc-950 hover:shadow-sm transition-shadow cursor-move"
                         draggable
                         onDragStart={(e) => onDragStart(e, stage.id, c.id)}>
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="font-medium text-sm">{c.country || "Untitled"}</h3>
                            {typeof c.value === "number" && <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px]">${c.value.toLocaleString()}</span>}
                            {c.priority && <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px]">{c.priority}</span>}
                          </div>
                          <div className="flex items-center gap-2 text-xs text-zinc-500">
                            {c.owner && <span className="inline-flex items-center gap-1"><span className="h-5 w-5 rounded-full bg-indigo-100 text-indigo-700 grid place-items-center text-[10px] font-semibold">{initials(c.owner)}</span> {c.owner}</span>}
                            {c.org && <span className="inline-flex items-center gap-1">• {c.org}</span>}
                            {c.due && <span className="inline-flex items-center gap-1">• Due {c.due}</span>}
                          </div>
                          {c.nextAction && <p className="text-sm mt-2">→ {c.nextAction}</p>}
                          <div className="flex items-center gap-2 mt-2 text-[11px]">
                            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 ${c.flags?.nda ? 'bg-green-50 border-green-300 text-green-700' : ''}`}>NDA {c.flags?.nda ? '✓' : ''}</span>
                            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 ${c.flags?.tech ? 'bg-green-50 border-green-300 text-green-700' : ''}`}>Tech {c.flags?.tech ? '✓' : ''}</span>
                            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 ${c.flags?.jaa ? 'bg-green-50 border-green-300 text-green-700' : ''}`}>JAA {c.flags?.jaa ? '✓' : ''}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button className="px-2 py-1 rounded-lg border text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800" onClick={() => setEditingCard({ stageId: stage.id, card: c })}>Edit</button>
                          <button className="px-2 py-1 rounded-lg border text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800" onClick={() => removeCard(stage.id, c.id)}>Delete</button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>

        {showStageEditor && (
          <StageEditor
            stages={stages}
            onClose={() => setShowStageEditor(false)}
            onSave={async (rows) => {
              setStages(rows);
              setShowStageEditor(false);
              try { await saveStageOrder(BOARD_ID, rows); } catch (e) { console.error(e); }
              }}
          />
        )}

        {editingCard && (
          <EditCardModal
            stageId={editingCard.stageId}
            card={editingCard.card}
            onClose={() => setEditingCard(null)}
            onSave={(c) => { updateCard(editingCard.stageId, c); setEditingCard(null); }}
          />
        )}

        {showAddModal && (
          <NewCountryModal
            stages={stages}
            value={pendingNew}
            onChange={setPendingNew}
            onClose={() => setShowAddModal(false)}
            onSave={saveNewCountry}
          />
        )}
      </div>
    </div>
  );
}

function StageEditor({ stages, onSave, onClose }) {
  const [rows, setRows] = React.useState(stages.map((s) => ({ ...s })));
  const add = () => setRows((r) => [...r, { id: uuid(), name: "New stage", prob: 0 }]);
  const del = (i) => setRows((r) => r.filter((_, idx) => idx !== i));
  const move = (i, dir) => setRows((r) => {
    const j = Math.min(r.length - 1, Math.max(0, i + dir));
    const copy = [...r];
    const tmp = copy[i];
    copy[i] = copy[j];
    copy[j] = tmp;
    return copy;
  });
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
      <div className="w-full max-w-2xl rounded-2xl border bg-white dark:bg-zinc-900">
        <div className="p-4 border-b">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Edit Stages</h3>
          </div>
          <p className="text-sm text-zinc-500 mt-1">Rename, set Win%, WIP and reorder. Save to apply.</p>
        </div>
        <div className="p-4 space-y-2 max-h-[60vh] overflow-auto">
          {rows.map((r, i) => (
            <div key={r.id} className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-2">
              <input className="rounded-xl border px-3 py-2 text-sm" value={r.name} onChange={(e) => setRows((rows) => rows.map((x, idx) => (idx === i ? { ...x, name: e.target.value } : x)))} />
              <input className="w-24 rounded-xl border px-3 py-2 text-sm" type="number" placeholder="Win%" value={r.prob ?? ""} onChange={(e) => setRows((rows) => rows.map((x, idx) => (idx === i ? { ...x, prob: e.target.value ? Number(e.target.value) : undefined } : x)))} />
              <input className="w-24 rounded-xl border px-3 py-2 text-sm" type="number" placeholder="WIP" value={r.wip ?? ""} onChange={(e) => setRows((rows) => rows.map((x, idx) => (idx === i ? { ...x, wip: e.target.value ? Number(e.target.value) : undefined } : x)))} />
              <button className="px-2 py-1 rounded-lg border text-xs" onClick={() => move(i, -1)}>↑</button>
              <button className="px-2 py-1 rounded-lg border text-xs" onClick={() => move(i, +1)}>↓</button>
              <button className="px-2 py-1 rounded-lg border text-xs" onClick={() => del(i)}>Delete</button>
            </div>
          ))}
          <div className="flex justify-between mt-3">
            <button className="px-3 py-2 rounded-xl border text-sm" onClick={add}>Add stage</button>
            <div className="flex gap-2">
              <button className="px-3 py-2 rounded-xl border text-sm" onClick={onClose}>Close</button>
              <button className="px-3 py-2 rounded-xl border text-sm" onClick={() => onSave(rows)}>Save</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function EditCardModal({ stageId, card, onSave, onClose }) {
  const [form, setForm] = React.useState({ ...card });
  const bind = (k) => ({ value: form[k] || "", onChange: (e) => setForm({ ...form, [k]: e.target.value }) });
  const toggleFlag = (k) => (value) => setForm({ ...form, flags: { ...(form.flags || {}), [k]: value } });
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
      <div className="w-full max-w-xl rounded-2xl border bg-white dark:bg-zinc-900">
        <div className="p-4 border-b"><h3 className="text-lg font-semibold">Edit Country</h3></div>
        <div className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-zinc-500">Country</label>
              <input className="w-full rounded-xl border px-3 py-2 text-sm" {...bind("country")} placeholder="e.g., Egypt" />
            </div>
            <div>
              <label className="text-xs text-zinc-500">Partner org</label>
              <input className="w-full rounded-xl border px-3 py-2 text-sm" {...bind("org")} placeholder="Org / contact" />
            </div>
            <div>
              <label className="text-xs text-zinc-500">Owner</label>
              <input className="w-full rounded-xl border px-3 py-2 text-sm" {...bind("owner")} placeholder="Ana / Roma / …" />
            </div>
            <div>
              <label className="text-xs text-zinc-500">Priority</label>
              <select className="w-full rounded-xl border px-3 py-2 text-sm" value={form.priority || ""} onChange={(e) => setForm({ ...form, priority: e.target.value || undefined })}>
                <option value="">—</option>
                <option>High</option>
                <option>Med</option>
                <option>Low</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-zinc-500">Deal value (USD)</label>
              <input className="w-full rounded-xl border px-3 py-2 text-sm" type="number" value={form.value ?? ""} onChange={(e) => setForm({ ...form, value: e.target.value ? Number(e.target.value) : undefined })} placeholder="e.g., 10000" />
            </div>
            <div className="md:col-span-2">
              <label className="text-xs text-zinc-500">Next action</label>
              <input className="w-full rounded-xl border px-3 py-2 text-sm" {...bind("nextAction")} placeholder="What happens next?" />
            </div>
            <div>
              <label className="text-xs text-zinc-500">Due date</label>
              <input className="w-full rounded-xl border px-3 py-2 text-sm" type="date" value={form.due || ""} onChange={(e) => setForm({ ...form, due: e.target.value })} />
            </div>
            <div>
              <label className="text-xs text-zinc-500">Links</label>
              <input className="w-full rounded-xl border px-3 py-2 text-sm" {...bind("links")} placeholder="Comma-separated URLs" />
            </div>
            <div className="md:col-span-2">
              <label className="text-xs text-zinc-500">Notes</label>
              <textarea className="w-full rounded-xl border px-3 py-2 text-sm" rows={4} {...bind("notes")} placeholder="Context, risks, decision log…" />
            </div>
            <div className="flex items-center gap-4 md:col-span-2 text-sm">
              <label className="inline-flex items-center gap-2"><input type="checkbox" checked={!!(form.flags && form.flags.nda)} onChange={(e) => toggleFlag("nda")(e.target.checked)} /> NDA signed</label>
              <label className="inline-flex items-center gap-2"><input type="checkbox" checked={!!(form.flags && form.flags.tech)} onChange={(e) => toggleFlag("tech")(e.target.checked)} /> Tech meeting done</label>
              <label className="inline-flex items-center gap-2"><input type="checkbox" checked={!!(form.flags && form.flags.jaa)} onChange={(e) => toggleFlag("jaa")(e.target.checked)} /> JAA signed</label>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button className="px-3 py-2 rounded-xl border text-sm" onClick={onClose}>Cancel</button>
            <button className="px-3 py-2 rounded-xl border text-sm" onClick={() => onSave(form)}>Save</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function NewCountryModal({ stages, value, onChange, onClose, onSave }) {
  const bind = (k) => ({ value: value[k] || '', onChange: (e) => onChange({ ...value, [k]: e.target.value }) });
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
      <div className="w-full max-w-xl rounded-2xl border bg-white dark:bg-zinc-900 shadow">
        <div className="p-4 border-b flex items-center justify-between">
          <h3 className="text-lg font-semibold">Add country</h3>
          <button className="px-2 py-1 rounded-lg border text-xs" onClick={onClose}>Close</button>
        </div>
        <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-zinc-500">Country</label>
            <input className="w-full rounded-xl border px-3 py-2 text-sm" {...bind('country')} placeholder="e.g., Ghana" />
          </div>
          <div>
            <label className="text-xs text-zinc-500">Stage</label>
            <select className="w-full rounded-xl border px-3 py-2 text-sm" value={value.stageId} onChange={(e) => onChange({ ...value, stageId: e.target.value })}>
              {stages.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-zinc-500">Deal value (USD)</label>
            <input className="w-full rounded-xl border px-3 py-2 text-sm" type="number" {...bind('value')} placeholder="e.g., 10000" />
          </div>
          <div>
            <label className="text-xs text-zinc-500">Owner</label>
            <input className="w-full rounded-xl border px-3 py-2 text-sm" {...bind('owner')} placeholder="Ana / Roma / …" />
          </div>
          <div className="md:col-span-2">
            <label className="text-xs text-zinc-500">Partner org</label>
            <input className="w-full rounded-xl border px-3 py-2 text-sm" {...bind('org')} placeholder="Org / contact" />
          </div>
          <div>
            <label className="text-xs text-zinc-500">Priority</label>
            <select className="w-full rounded-xl border px-3 py-2 text-sm" value={value.priority || ''} onChange={(e) => onChange({ ...value, priority: e.target.value })}>
              <option value="">—</option>
              <option>High</option>
              <option>Med</option>
              <option>Low</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-zinc-500">Due date</label>
            <input className="w-full rounded-xl border px-3 py-2 text-sm" type="date" {...bind('due')} />
          </div>
          <div className="md:col-span-2">
            <label className="text-xs text-zinc-500">Next action</label>
            <input className="w-full rounded-xl border px-3 py-2 text-sm" {...bind('nextAction')} placeholder="What happens next?" />
          </div>
        </div>
        <div className="p-4 border-t flex justify-end gap-2">
          <button className="px-3 py-2 rounded-xl border text-sm" onClick={onClose}>Cancel</button>
          <button className="px-3 py-2 rounded-xl text-sm bg-indigo-600 text-white hover:bg-indigo-700" onClick={onSave}>Add</button>
        </div>
      </div>
    </div>
  );
}

// -------------------
// Quick inline test cases (visible in browser console)
// -------------------
(function runTests(){
  try {
    // Test 1: absolute mode
    const stagesA = [
      { id: 'A', name: 'A', prob: 50 },
      { id: 'B', name: 'B', prob: 100 },
    ];
    const columnsA = {
      A: [{ id: '1', value: 100 }],
      B: [{ id: '2', value: 200 }],
    };
    const rA = calculateWeightedPipeline(stagesA, columnsA, 'absolute');
    console.assert(Math.abs(rA.weighted - (100*0.5 + 200*1)) < 1e-6, 'Test 1 failed: absolute mode basic');

    // Test 2: transition mode simple (50% then 100% => first stage prob to end = 0.5*1)
    const rB = calculateWeightedPipeline(stagesA, columnsA, 'transition');
    console.assert(Math.abs(rB.weighted - (100*0.5 + 200*1)) < 1e-6, 'Test 2 failed: transition mode basic');

    // Test 3: transition chain (50% → 60% → 100%)
    const stagesB = [
      { id: 'S1', name: 'S1', prob: 50 },
      { id: 'S2', name: 'S2', prob: 60 },
      { id: 'S3', name: 'S3', prob: 100 },
    ];
    const columnsB = {
      S1: [{ id: 'x', value: 100 }],
      S2: [{ id: 'y', value: 100 }],
      S3: [],
    };
    const rC = calculateWeightedPipeline(stagesB, columnsB, 'transition');
    // S1 prob to end = 0.5 * 0.6 * 1 = 0.3 => 30; S2 prob to end = 0.6 * 1 = 0.6 => 60; total 90
    console.assert(Math.abs(rC.weighted - 90) < 1e-6, 'Test 3 failed: transition chain');

    // Test 4: absolute mode vs transition mode should differ here
    const rD = calculateWeightedPipeline(stagesB, columnsB, 'absolute');
    // absolute uses stage.prob directly: 100*0.5 + 100*0.6 = 110
    console.assert(Math.abs(rD.weighted - 110) < 1e-6, 'Test 4 failed: absolute chain');

    // Test 5: missing values should not NaN the sum
    const columnsC = { S1: [{ id:'a' }], S2: [{ id:'b', value: 0 }], S3: [{ id:'c', value: 5 }] };
    const rE = calculateWeightedPipeline(stagesB, columnsC, 'absolute');
    console.assert(!Number.isNaN(rE.total) && rE.total === 5, 'Test 5 failed: handle missing/zero values');

    // Test 6: zero probabilities
    const stagesC = [ {id:'s1', name:'s1', prob:0}, {id:'s2', name:'s2', prob:0}, {id:'s3', name:'s3', prob:100} ];
    const columnsD = { s1:[{id:'1',value:50}], s2:[{id:'2',value:50}], s3:[] };
    const rF = calculateWeightedPipeline(stagesC, columnsD, 'transition');
    console.assert(rF.weighted === 0, 'Test 6 failed: zero transition chain');

    console.log('%cAll pipeline tests passed', 'color: green;');
  } catch (e) {
    console.error('Pipeline tests error:', e);
  }
})();
