/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import Lobby from './components/Lobby';
import GamePlay from './components/GamePlay';

export default function App() {
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);

  const handleJoinRoom = (roomId: string) => {
    setActiveRoomId(roomId);
  };

  const handleExitRoom = () => {
    setActiveRoomId(null);
  };

  return (
    <div id="game-app-root" className="min-h-screen bg-stone-50/50 pb-12 selection:bg-neutral-800 selection:text-white">
      {activeRoomId ? (
        <GamePlay roomId={activeRoomId} onExit={handleExitRoom} />
      ) : (
        <Lobby onJoinRoom={handleJoinRoom} />
      )}
    </div>
  );
}
