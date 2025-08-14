import { useEffect, useState } from 'react';
import { loadBoard } from './db.js';

const BOARD_ID = 1;

export default function KingsPipelineKanban() {
  const [board, setBoard] = useState({ stages: [], columns: {} });
  const [error, setError] = useState(null);

  useEffect(() => {
    async function fetchBoard() {
      try {
        const data = await loadBoard(BOARD_ID);
        setBoard(data);
      } catch (err) {
        setError('Failed to load board');
        console.error(err);
      }
    }
    fetchBoard();
  }, []);

  if (error) {
    return <p className="text-red-600 p-4">{error}</p>;
  }

  return (
    <div className="flex w-full gap-4 overflow-x-auto p-4">
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
  );
}
