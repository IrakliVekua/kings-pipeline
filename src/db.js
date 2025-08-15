import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const sb =
  SUPABASE_URL && SUPABASE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_KEY)
    : null;

function hasClient() {
  if (!sb) {
    console.warn('Supabase client not configured');
    return false;
  }
  return true;
}

const demoBoard = {
  stages: [
    { id: 1, name: 'Todo' },
    { id: 2, name: 'Doing' },
    { id: 3, name: 'Done' }
  ],
  columns: {
    1: [
      { id: 101, country: 'Example Country', owner: 'Demo User' }
    ],
    2: [],
    3: []
  }
};

// Load stages & cards from Supabase into the shape the UI expects
export async function loadBoard(boardId) {
  if (!hasClient()) {
    return { ...demoBoard, demo: true };
  }
  const [{ data: stages }, { data: cards }] = await Promise.all([
    sb.from('stages').select('*').eq('board_id', boardId).order('sort'),
    sb.from('cards').select('*').eq('board_id', boardId),
  ]);

  const stageList = (stages || []).map(s => ({
    id: s.id,
    name: s.name,
    prob: s.prob ?? undefined,
    wip: s.wip ?? undefined
  }));

  const columns = Object.fromEntries(stageList.map(s => [s.id, []]));
  for (const c of (cards || [])) {
    const card = {
      id: c.id,
      country: c.country,
      value: c.value === null ? undefined : Number(c.value),
      owner: c.owner || undefined,
      org: c.org || undefined,
      priority: c.priority || undefined,
      nextAction: c.next_action || undefined,
      due: c.due || undefined,
      flags: c.flags || {}
    };
    if (columns[c.stage_id]) columns[c.stage_id].push(card);
  }
  return { stages: stageList, columns, demo: false };
}

// Save the order + names + win% back to DB
export async function saveStageOrder(boardId, stages) {
  if (!hasClient()) return;
  const updates = stages.map((s, i) => ({
    id: s.id,
    board_id: boardId,
    name: s.name,
    prob: s.prob ?? null,
    wip: s.wip ?? null,
    sort: i,
  }));
  const { error } = await sb.from('stages').upsert(updates);
  if (error) console.error('saveStageOrder error', error);
}

// Insert or update one card (country)
export async function upsertCard(boardId, stageId, card) {
  if (!hasClient()) return;
  const row = {
    id: card.id,
    board_id: boardId,
    stage_id: stageId,
    country: card.country,
    value: card.value ?? null,
    owner: card.owner ?? null,
    org: card.org ?? null,
    priority: card.priority ?? null,
    next_action: card.nextAction ?? null,
    due: card.due ?? null,
    flags: card.flags ?? {}
  };
  const { error } = await sb.from('cards').upsert(row);
  if (error) console.error('upsertCard error', error);
}
// Update card fields (not the stage)
export async function updateCardRow(card) {
  if (!hasClient()) return;
  const { error } = await sb
    .from('cards')
    .update({
      country: card.country,
      value: card.value ?? null,
      owner: card.owner ?? null,
      org: card.org ?? null,
      priority: card.priority ?? null,
      next_action: card.nextAction ?? null,
      due: card.due ?? null,
      flags: card.flags ?? {},
    })
    .eq('id', card.id);
  if (error) console.error('updateCardRow error', error);
}

// Move card to another stage
export async function moveCard(cardId, toStageId) {
  if (!hasClient()) return;
  const { error } = await sb
    .from('cards')
    .update({ stage_id: toStageId })
    .eq('id', cardId);
  if (error) console.error('moveCard error', error);
}

// Delete card
export async function deleteCard(cardId) {
  if (!hasClient()) return;
  const { error } = await sb.from('cards').delete().eq('id', cardId);
  if (error) console.error('deleteCard error', error);
}
