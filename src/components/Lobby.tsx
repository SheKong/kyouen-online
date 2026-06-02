import React, { useState, useEffect } from 'react';
import { collection, query, onSnapshot, setDoc, doc, orderBy, deleteDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { Room } from '../types';
import { getOrCreateUserId, getOrCreateNickname, saveNickname } from '../utils/userId';
import { Plus, User, Play, Eye, Flame, Clock, Hash, Check, RefreshCw, HelpCircle, X } from 'lucide-react';

interface LobbyProps {
  onJoinRoom: (roomId: string) => void;
}

export default function Lobby({ onJoinRoom }: LobbyProps) {
  const [userId] = useState(() => getOrCreateUserId());
  const [nickname, setNickname] = useState(() => getOrCreateNickname());
  const [isEditingName, setIsEditingName] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);

  // Form states for creating a room
  const [roomName, setRoomName] = useState('');
  const [boardSize, setBoardSize] = useState(9);
  const [stepTime, setStepTime] = useState(60);
  const [byoyomiTime, setByoyomiTime] = useState(60);
  const [totalLives, setTotalLives] = useState(3);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [joinError, setJoinError] = useState('');

  const [isCreatingRoom, setIsCreatingRoom] = useState(false);

  // Listen to active rooms
  useEffect(() => {
    const roomsQuery = query(collection(db, 'rooms'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(roomsQuery, (snapshot) => {
      const roomList: Room[] = [];
      const now = Date.now();
      const INACTIVITY_LIMIT = 10 * 60 * 1000; // 10 minutes

      snapshot.forEach((docSnap) => {
        const r = docSnap.data() as Room;
        const lastActive = r.lastMoveTime || r.createdAt || 0;
        
        // Clean up stale or inactive rooms to prevent ghosts when players close the tab directly
        if ((now - lastActive > INACTIVITY_LIMIT) || (!r.players.black && !r.players.white)) {
          try {
            deleteDoc(doc(db, 'rooms', r.id)).catch(() => {});
          } catch (e) { }
          return;
        }
        
        if (r.status !== 'finished') {
          roomList.push(r);
        }
      });
      setRooms(roomList);
      setLoading(false);
    }, (error) => {
      console.error('Error fetching rooms:', error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const handleUpdateNickname = () => {
    const trimmed = nickname.trim();
    if (trimmed) {
      saveNickname(trimmed);
      setIsEditingName(false);
    }
  };

  const generateRoomCode = () => {
    return Math.floor(100000 + Math.random() * 90000).toString(); // 6 digits
  };

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isCreatingRoom) return;
    setIsCreatingRoom(true);
    
    const cleanRoomName = roomName.trim() || `${nickname}的房间`;
    const newRoomId = generateRoomCode();

    const newRoom: Room = {
      id: newRoomId,
      name: cleanRoomName,
      size: boardSize,
      stepTime,
      byoyomiTime,
      totalLives,
      status: 'waiting',
      createdAt: Date.now(),
      players: {
        black: userId,
        white: null,
      },
      playerNames: {
        [userId]: nickname,
      },
      playerReady: {
        black: false,
        white: false,
      },
      playerLives: {
        black: totalLives,
        white: totalLives,
      },
      playerByoyomi: {
        black: byoyomiTime,
        white: byoyomiTime,
      },
      turn: 'black',
      winner: null,
      lastMoveTime: 0,
      activeDeclaration: null,
      moves: [],
    };

    try {
      await setDoc(doc(db, 'rooms', newRoomId), newRoom);
      onJoinRoom(newRoomId);
    } catch (err) {
      console.error('Error creating room:', err);
    } finally {
      // Small cooldown to prevent rapid spamming even after success/failure
      setTimeout(() => setIsCreatingRoom(false), 500);
    }
  };

  const handleJoinByCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = roomCodeInput.trim();
    if (!code) return;

    // Check if room exists in our state
    const roomExists = rooms.find((r) => r.id === code);
    if (roomExists) {
      setJoinError('');
      onJoinRoom(code);
    } else {
      setJoinError('未找到房间，请检查房间号是否正确');
    }
  };

  return (
    <div id="lobby-container" className="max-w-5xl mx-auto px-4 py-10 font-sans selection:bg-black selection:text-white">
      {/* Header and User Profile Card */}
      <div className="flex flex-col md:flex-row justify-between items-center bg-white border-2 border-black p-6 mb-8 gap-4 shadow-[4px_4px_0px_rgba(0,0,0,1)]">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-black text-white flex items-center justify-center font-mono text-xl font-extrabold border border-black transform hover:rotate-6 transition-transform">
            共
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tighter text-black uppercase">“共圆” 联机对战</h1>
            <p className="text-[10px] text-neutral-500 font-mono font-bold uppercase tracking-widest">Concyclic Multi-Player Game Platform</p>
          </div>
        </div>

        {/* Edit Nickname Widget */}
        <div className="flex items-center gap-2 border-2 border-black bg-white px-4 py-2 font-mono shadow-[2px_2px_0px_rgba(0,0,0,1)]">
          <User size={14} className="text-black animate-pulse" />
          {isEditingName ? (
            <div className="flex items-center gap-1">
              <input
                id="nickname-input"
                type="text"
                className="border-2 border-black px-2 py-1 text-xs outline-none font-bold font-mono focus:bg-neutral-50 max-w-[140px]"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                maxLength={12}
                onKeyDown={(e) => e.key === 'Enter' && handleUpdateNickname()}
                autoFocus
              />
              <button
                id="save-nickname"
                onClick={handleUpdateNickname}
                className="bg-black text-white p-1 hover:bg-neutral-800 border-l border-black flex items-center justify-center cursor-pointer"
              >
                <Check size={14} />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3 text-xs font-black">
              <span className="text-black uppercase tracking-tight">{nickname}</span>
              <button
                id="edit-nickname"
                onClick={() => setIsEditingName(true)}
                className="text-[10px] text-neutral-500 hover:text-black cursor-pointer font-extrabold uppercase tracking-wider underline border-none bg-transparent"
              >
                [修改/EDIT]
              </button>
              <button
                id="show-rules"
                onClick={() => setShowRules(true)}
                title="游戏规则"
                className="text-neutral-500 hover:text-black cursor-pointer bg-neutral-100 hover:bg-neutral-200 rounded-full p-1 transition-colors ml-2"
              >
                <HelpCircle size={14} className="stroke-[2.5]" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Rules Modal Overlay */}
      {showRules && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white border-2 border-black p-6 md:p-8 max-w-lg w-full shadow-[8px_8px_0px_rgba(0,0,0,1)] relative">
            <button
              onClick={() => setShowRules(false)}
              className="absolute top-4 right-4 p-1 hover:bg-neutral-100 cursor-pointer text-black"
            >
              <X size={20} className="stroke-[3]" />
            </button>
            <h2 className="text-xl font-black uppercase tracking-widest text-black flex items-center gap-2 mb-6">
              <HelpCircle size={22} className="stroke-[3]" />
              游戏规则 RULES
            </h2>
            <div className="space-y-4 text-sm font-medium text-neutral-700 leading-relaxed font-sans">
              <p>
                「共圆」是一款基于四点共圆几何原理的二人智力对弈游戏。
              </p>
              <ul className="list-disc pl-5 space-y-2">
                <li><strong className="text-black">目标：</strong>尽可能消耗对方的生命点数。</li>
                <li><strong className="text-black">落子：</strong>黑白双方轮流在网格交叉点上落子，任何落子不得重叠。</li>
                <li><strong className="text-black">共圆宣告：</strong>当对方落子后，若你发现该子与棋盘上<strong>任意颜色</strong>的其他三个子构成了“四点共圆”，你可以在你的回合点击“共圆！”进行宣告。</li>
                <li><strong className="text-black">奖惩机制：</strong>宣告成功，则扣除对方1点生命值，并移除对方上一步的落子，由你继续走棋。若宣告失败（选错或不存在），则扣除你的1点生命值！</li>
                <li><strong className="text-black">时间限制：</strong>每回合有固定的思考时间，若思考时间耗尽则进入读秒，读秒耗尽将失去1点生命值。</li>
              </ul>
              <p className="pt-2 text-xs font-bold text-black border-t-2 border-black italic">
                “保持敏锐的几何直觉，不要错过任何一个共圆的瞬间！”
              </p>
            </div>
            <button
              onClick={() => setShowRules(false)}
              className="mt-8 w-full bg-black text-white font-black py-3 text-xs tracking-widest uppercase hover:bg-neutral-800 transition-colors shadow-[3px_3px_0px_rgba(0,0,0,1)] active:translate-y-0.5 active:translate-x-0.5 active:shadow-none"
            >
              明白 UNDERSTOOD
            </button>
          </div>
        </div>
      )}

      {/* Main Grid: Rooms List & Setup Board */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {/* Play Lobby (Left / Center Column span 2) */}
        <div className="md:col-span-2">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xs uppercase tracking-widest font-extrabold text-black flex items-center gap-3 border-l-4 border-black pl-3">
              <span>等待中的房间 LOBBY</span>
              <span className="border-2 border-black bg-black text-white font-mono text-xs px-2.5 py-0.5 font-bold">
                {rooms.length}
              </span>
            </h2>
            <button
              id="refresh-lobby"
              onClick={() => {
                setLoading(true);
                setTimeout(() => setLoading(false), 300);
              }}
              className="text-black hover:text-white hover:bg-black transition-all duration-300 p-2 border-2 border-black bg-white cursor-pointer shadow-[2px_2px_0px_rgba(0,0,0,1)] active:shadow-none active:translate-x-0.5 active:translate-y-0.5"
              title="刷新列表"
            >
              <RefreshCw size={14} className="font-bold" />
            </button>
          </div>

          {loading ? (
            <div className="flex flex-col items-center justify-center py-24 border-2 border-black bg-white shadow-[4px_4px_0px_rgba(0,0,0,1)]">
              <div className="animate-spin h-8 w-8 border-4 border-black border-t-transparent mb-4"></div>
              <p className="text-xs font-mono font-bold uppercase tracking-widest text-black/60">Lobby parsing ...</p>
            </div>
          ) : rooms.length === 0 ? (
            <div className="text-center py-20 border-2 border-black border-dashed bg-white shadow-[4px_4px_0px_rgba(0,0,0,1)]">
              <p className="text-black font-extrabold uppercase tracking-tight text-lg mb-2">暂无开放的房间</p>
              <p className="text-xs text-neutral-500 font-mono mb-6">Create a room and invite your opponent with the Room Code</p>
              <button
                id="create-room-secondary"
                onClick={() => {
                  const el = document.getElementById('room-name-input');
                  el?.focus();
                }}
                className="bg-black hover:bg-neutral-800 text-white font-extrabold text-xs px-6 py-3 transition-transform inline-flex items-center gap-2 shadow-[3px_3px_0px_rgba(0,0,0,1)] cursor-pointer tracking-wider uppercase border-2 border-black"
              >
                <Plus size={14} /> 创建新房间
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              {rooms.map((room) => {
                const isBlackFull = room.players.black !== null;
                const isWhiteFull = room.players.white !== null;
                const playersCount = (isBlackFull ? 1 : 0) + (isWhiteFull ? 1 : 0);
                const isWaiting = room.status === 'waiting';
                const isPlaying = room.status === 'playing';

                // Display nick names
                const blackName = room.players.black ? room.playerNames[room.players.black] || '离线玩家' : '空闲';
                const whiteName = room.players.white ? room.playerNames[room.players.white] || '空闲' : '空闲';

                return (
                  <div
                    key={room.id}
                    className="border-2 border-black hover:bg-neutral-50/40 transition-all bg-white p-5 flex flex-col justify-between shadow-[4px_4px_0px_rgba(0,0,0,1)] relative group"
                  >
                    <div>
                      {/* Badge status */}
                      <div className="flex justify-between items-center mb-4">
                        <span className="text-[10px] font-mono font-extrabold bg-neutral-100 text-black px-2.5 py-1 border border-black uppercase tracking-tight">
                          # {room.id}
                        </span>
                        {isWaiting ? (
                          <span className="text-[10px] font-extrabold text-black bg-neutral-100 border border-black px-2 py-1 uppercase tracking-tight animate-pulse">
                            等待中 WAIT ({playersCount}/2)
                          </span>
                        ) : isPlaying ? (
                          <span className="text-[10px] font-extrabold text-white bg-black border border-black px-2 py-1 uppercase tracking-tight">
                            进行中 BATTLE
                          </span>
                        ) : (
                          <span className="text-[10px] font-extrabold text-neutral-400 bg-neutral-100 border border-neutral-350 px-2 py-1 uppercase tracking-tight">
                            已结束 DONE
                          </span>
                        )}
                      </div>

                      <h3 className="font-extrabold text-black text-base mb-4 tracking-tighter uppercase line-clamp-1 group-hover:underline">{room.name}</h3>

                      {/* Room Stats */}
                      <div className="grid grid-cols-2 gap-y-2 gap-x-4 text-[10px] font-mono font-bold uppercase text-neutral-600 mb-4 border-b-2 border-black/10 pb-4">
                        <span className="flex items-center gap-1.5">
                          棋盘 Grid : {room.size}×{room.size}
                        </span>
                        <span className="flex items-center gap-1.5">
                          生命 Lives: {room.totalLives} HP
                        </span>
                        <span className="flex items-center gap-1.5">
                          限时 Step : {room.stepTime}s
                        </span>
                        <span className="flex items-center gap-1.5">
                          读秒 Extra: {room.byoyomiTime}s
                        </span>
                      </div>

                      {/* Players */}
                      <div className="space-y-2 text-xs mb-5 font-mono">
                        <div className="flex items-center justify-between border-b border-black/5 pb-1">
                          <span className="flex items-center gap-1.5 font-bold uppercase text-[10px] opacity-70">
                            <span className="w-2.5 h-2.5 bg-black border border-black inline-block"></span>
                            <span>黑方 Black</span>
                          </span>
                          <span className="font-extrabold text-black truncate max-w-[125px]">{blackName}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="flex items-center gap-1.5 font-bold uppercase text-[10px] opacity-70">
                            <span className="w-2.5 h-2.5 bg-white border border-black inline-block"></span>
                            <span>白方 White</span>
                          </span>
                          <span className="font-extrabold text-black truncate max-w-[125px]">{whiteName}</span>
                        </div>
                      </div>
                    </div>

                    <button
                      id={`join-room-${room.id}`}
                      onClick={() => onJoinRoom(room.id)}
                      className="w-full border-2 border-black bg-white text-black font-extrabold py-2.5 hover:bg-black hover:text-white transition-all text-[11px] tracking-widest uppercase shadow-[3px_3px_0px_rgba(0,0,0,1)] active:shadow-none active:translate-x-0.5 active:translate-y-0.5 cursor-pointer flex items-center justify-center gap-1.5"
                    >
                      {isWaiting && playersCount < 2 ? (
                        <>
                          <Play size={12} className="stroke-[3]" /> 进入战局 PLAY GAME
                        </>
                      ) : (
                        <>
                          <Eye size={12} className="stroke-[3]" /> 旁观 / 复盘 SPECTATE
                        </>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Join Code / Create Panel (Right Sidebar Card) */}
        <div>
          {/* Join with room code */}
          <div className="border-2 border-black p-5 bg-white shadow-[4px_4px_0px_rgba(0,0,0,1)] mb-6">
            <h3 className="font-extrabold uppercase tracking-widest text-black text-xs mb-3.5 flex items-center gap-2">
              <Hash size={13} className="stroke-[3]" />
              <span>加入已有对局 JOIN GAME</span>
            </h3>
            <form onSubmit={handleJoinByCode} className="flex gap-2">
              <input
                id="join-code-input"
                type="text"
                placeholder="PROMPT CODE (例如: 104230)"
                className="flex-1 text-xs border-2 border-black font-mono px-3 py-2.5 outline-none focus:bg-neutral-50/70"
                value={roomCodeInput}
                onChange={(e) => setRoomCodeInput(e.target.value)}
                maxLength={6}
              />
              <button
                id="submit-join-code"
                type="submit"
                className="bg-black hover:bg-neutral-850 text-white text-xs font-black tracking-widest uppercase px-4 py-2 border-2 border-black transition-all shadow-[2px_2px_0px_rgba(0,0,0,1)] active:shadow-none active:translate-x-0.5 active:translate-y-0.5 cursor-pointer disabled:opacity-40"
                disabled={!roomCodeInput.trim()}
              >
                加入
              </button>
            </form>
            {joinError && <p className="text-red-600 text-[10px] font-mono uppercase bg-red-50 border border-red-200 px-2 py-1.5 mt-2 font-bold">{joinError}</p>}
          </div>

          {/* Create room settings card */}
          <div className="border-2 border-black p-5 bg-white shadow-[4px_4px_0px_rgba(0,0,0,1)]">
            <h3 className="font-extrabold uppercase tracking-widest text-black text-xs mb-4 flex items-center gap-2">
              <Plus size={15} className="stroke-[3]" />
              <span>创建房间 CREATE ROOM</span>
            </h3>

            <form onSubmit={handleCreateRoom} className="space-y-4">
              <div>
                <label className="block text-[10px] font-mono font-extrabold uppercase tracking-widest text-black/60 mb-1.5">房间别名 ALIAS NAME</label>
                <input
                  id="room-name-input"
                  type="text"
                  placeholder={`${nickname}的对局厅`}
                  className="w-full text-xs border-2 border-black px-3 py-2 bg-white outline-none focus:bg-neutral-50/50 font-bold"
                  value={roomName}
                  onChange={(e) => setRoomName(e.target.value)}
                  maxLength={18}
                />
              </div>

              <div>
                <label className="block text-[10px] font-mono font-extrabold uppercase tracking-widest text-black/60 mb-1.5">棋盘规格 SIZE</label>
                <div className="grid grid-cols-4 gap-2">
                  {[9, 11, 13, 15].map((size) => (
                    <button
                      key={size}
                      type="button"
                      id={`size-${size}`}
                      onClick={() => setBoardSize(size)}
                      className={`py-2 text-[10px] font-mono font-black border-2 transition-all cursor-pointer ${
                        boardSize === size
                          ? 'bg-black text-white border-black'
                          : 'bg-white text-black border-black hover:bg-neutral-100'
                      }`}
                    >
                      {size}×{size}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-mono font-extrabold uppercase tracking-widest text-black/60 mb-1.5">步时限制 TIMER</label>
                <select
                  id="step-time-select"
                  className="w-full text-xs border-2 border-black bg-white px-3 py-2.5 outline-none focus:bg-neutral-50/50 font-black font-mono cursor-pointer"
                  value={stepTime}
                  onChange={(e) => setStepTime(parseInt(e.target.value))}
                >
                  <option value={15}>15 SECONDS</option>
                  <option value={30}>30 SECONDS</option>
                  <option value={60}>60 SECONDS</option>
                  <option value={120}>120 SECONDS</option>
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-mono font-extrabold uppercase tracking-widest text-black/60 mb-1.5">用尽读秒 BYOYOMI</label>
                <select
                  id="byoyomi-select"
                  className="w-full text-xs border-2 border-black bg-white px-3 py-2.5 outline-none focus:bg-neutral-50/50 font-black font-mono cursor-pointer"
                  value={byoyomiTime}
                  onChange={(e) => setByoyomiTime(parseInt(e.target.value))}
                >
                  <option value={30}>30 SECONDS</option>
                  <option value={60}>60 SECONDS</option>
                  <option value={120}>120 SECONDS</option>
                  <option value={180}>180 SECONDS</option>
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-mono font-extrabold uppercase tracking-widest text-black/60 mb-1.5">健康生命 LIVES / HP</label>
                <div className="grid grid-cols-4 gap-2">
                  {[1, 3, 5, 10].map((lives) => (
                    <button
                      key={lives}
                      type="button"
                      id={`lives-${lives}`}
                      onClick={() => setTotalLives(lives)}
                      className={`py-2 text-[10px] font-mono font-black border-2 transition-all cursor-pointer ${
                        totalLives === lives
                          ? 'bg-black text-white border-black'
                          : 'bg-white text-black border-black hover:bg-neutral-100'
                      }`}
                    >
                      {lives} HP
                    </button>
                  ))}
                </div>
              </div>

              <button
                id="submit-create-room"
                type="submit"
                disabled={isCreatingRoom}
                className={`w-full text-white text-xs font-black tracking-widest uppercase py-4 border-2 border-black transition-all shadow-[4px_4px_0px_rgba(0,0,0,1)] flex items-center justify-center gap-1.5 ${isCreatingRoom ? 'bg-neutral-600 cursor-not-allowed opacity-80' : 'bg-black hover:bg-neutral-800 active:shadow-none active:translate-x-0.5 active:translate-y-0.5 cursor-pointer'}`}
              >
                <Plus size={14} className="stroke-[3]" /> {isCreatingRoom ? 'CREATING...' : '创建新房间 LAUNCH'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
