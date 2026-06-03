/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import Lobby from './components/Lobby';
import GamePlay from './components/GamePlay';
import { WifiOff } from 'lucide-react';

export default function App() {
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const handleJoinRoom = (roomId: string) => {
    setActiveRoomId(roomId);
  };

  const handleExitRoom = () => {
    setActiveRoomId(null);
  };

  return (
    <div id="game-app-root" className="min-h-screen bg-stone-50/50 pb-12 selection:bg-neutral-800 selection:text-white">
      {isOffline && (
        <div className="bg-red-500 text-white text-center py-2 font-bold flex items-center justify-center gap-2">
          <WifiOff size={18} />
          <span>网络连接已断开，请检查网络设置。部分游戏功能可能无法正常工作。</span>
        </div>
      )}
      {activeRoomId ? (
        <GamePlay roomId={activeRoomId} onExit={handleExitRoom} />
      ) : (
        <Lobby onJoinRoom={handleJoinRoom} />
      )}
    </div>
  );
}
