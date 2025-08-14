import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const sb =
  SUPABASE_URL && SUPABASE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_KEY)
    : null;

function requireClient() {
  if (!sb) {
    throw new Error('Supabase client not configured');
  }
}

// Load stages & cards from Supabase into the shape the UI expects
export async function loadBoard(boardId) {
  requireClient();
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
  return { stages: stageList, columns };
}

// Save the order + names + win% back to DB
export async function saveStageOrder(boardId, stages) {
  requireClient();
  const updates = stages.map((s, i) => ({
    id: s.id,
    board_id: boardId,
    name: s.name,
    prob: s.prob ?? null,
    wip: s.wip ?? null,
    sort: i
  }));
  await sb.from('stages').upsert(updates);
}

// Insert or update one card (country)
export async function upsertCard(boardId, stageId, card) {
  requireClient();
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
  await sb.from('cards').upsert(row);
}

// Update card fields (not the stage)
export async function updateCardRow(card) {
  requireClient();
  await sb.from('cards')
    .update({
      country: card.country,
      value: card.value ?? null,
      owner: card.owner ?? null,
      org: card.org ?? null,
      priority: card.priority ?? null,
      next_action: card.nextAction ?? null,
      due: card.due ?? null,
      flags: card.flags ?? {}
    })
    .eq('id', card.id);
}

// Move card to another stage
export async function moveCard(cardId, toStageId) {
  requireClient();
  await sb.from('cards').update({ stage_id: toStageId }).eq('id', cardId);
}

// Delete card
export async function deleteCard(cardId) {
  requireClient();
  await sb.from('cards').delete().eq('id', cardId);
}
