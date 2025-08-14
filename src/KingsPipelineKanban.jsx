import { useEffect, useState } from 'react';
import { loadBoard } from './db.js';

const BOARD_ID = 1;

export default function KingsPipelineKanban() {
  const [board, setBoard] = useState({ stages: [], columns: {}, demo: false });
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchBoard() {
      try {
        const data = await loadBoard(BOARD_ID);
        setBoard(data);
      } catch (err) {
        setError(err.message);
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    fetchBoard();
  }, []);

  if (loading) {
    return <p className="p-4">Loading board...</p>;
  }

  if (error) {
    return <p className="text-red-600 p-4">{error}</p>;
  }

  return (
    <div className="p-4">
      {board.demo && (
        <p className="mb-4 text-yellow-600">
          Supabase not configured; showing demo board.
        </p>
      )}
      <div className="flex w-full gap-4 overflow-x-auto">
        {board.stages.map(stage => (
          <div key={stage.id} className="flex-shrink-0 w-64 rounded-lg bg-gray-100">
            <h2 className="p-2 text-center font-semibold border-b">{stage.name}</h2>
            <div className="p-2 space-y-2">
              {(board.columns[stage.id] || []).map(card => (
                <div key={card.id} className="rounded bg-white p-2 shadow">
                  <div className="font-medium">{card.country}</div>
                  {card.owner && (
                    <div className="text-sm text-gray-500">{card.owner}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
