import React, { useState, useEffect, useRef } from 'react';
import { doc, onSnapshot, updateDoc, setDoc, deleteDoc, collection, query, orderBy } from 'firebase/firestore';
import { db } from '../firebase';
import { Room, ChatMessage, Move, Point, ConcyclicGroup, PlayerColor } from '../types';
import { getOrCreateUserId, getOrCreateNickname } from '../utils/userId';
import { checkConcyclic, calculateCircle, findAllConcyclicGroups, areFourCollinear } from '../utils/math';
import { Heart, Send, CornerDownLeft, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, MessageSquare, AlertCircle, Play, Info, Crown, Users } from 'lucide-react';

interface GamePlayProps {
  roomId: string;
  onExit: () => void;
}

export default function GamePlay({ roomId, onExit }: GamePlayProps) {
  const userId = getOrCreateUserId();
  const nickname = getOrCreateNickname();
  const [room, setRoom] = useState<Room | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [historyIndex, setHistoryIndex] = useState<number>(0);
  const [selectedDeclarationPoints, setSelectedDeclarationPoints] = useState<Point[]>([]);

  const [savedAnalysisByStep, setSavedAnalysisByStep] = useState<Record<number, ConcyclicGroup[]>>({});
  const concyclicGroups = savedAnalysisByStep[historyIndex] || [];
  const showAllConcyclic = savedAnalysisByStep[historyIndex] !== undefined;

  // Reset hover and selected indicators when history index changes
  useEffect(() => {
    setHoveredGroupIndex(null);
    setSelectedGroupIndex(null);
  }, [historyIndex]);
  const [hoveredGroupIndex, setHoveredGroupIndex] = useState<number | null>(null);
  const [selectedGroupIndex, setSelectedGroupIndex] = useState<number | null>(null);

  // Local clock state for active player timers
  const [localStepTime, setLocalStepTime] = useState(0);
  const [localByoyomiTime, setLocalByoyomiTime] = useState(0);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 1. Subscribe to the Room state
  useEffect(() => {
    const roomRef = doc(db, 'rooms', roomId);
    const unsubscribe = onSnapshot(roomRef, (snapshot) => {
      if (!snapshot.exists()) {
        // Room dissolved
        onExit();
        return;
      }

      const data = snapshot.data() as Room;
      setRoom(data);

      // Auto-set the viewing history index to the latest moves length when moves update,
      // provided the player is not currently checking past history (or jump to latest automatically).
      // If history index was at the end, keep it at the end.
      setHistoryIndex((prevIndex) => {
        if (prevIndex === 0 || prevIndex >= data.moves.length - 1) {
          return data.moves.length;
        }
        return prevIndex;
      });

      // Clear analysis if this is a new game
      if (data.moves.length === 0) {
        setSavedAnalysisByStep({});
      }
    }, (error) => {
      console.error('Error listening to room:', error);
    });

    return () => unsubscribe();
  }, [roomId, onExit]);

  // 2. Subscribe to room chat lobby messages
  useEffect(() => {
    const msgQuery = query(collection(db, 'rooms', roomId, 'messages'), orderBy('createdAt', 'asc'));
    const unsubscribe = onSnapshot(msgQuery, (snapshot) => {
      const list: ChatMessage[] = [];
      snapshot.forEach((snap) => {
        list.push(snap.data() as ChatMessage);
      });
      setMessages(list);
    }, (error) => {
      console.error('Error listening to chat messages:', error);
    });

    return () => unsubscribe();
  }, [roomId]);

  // Auto scroll chats to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Determine current user's role and color
  const getMyRole = (): { color: PlayerColor | null; isPlayer: boolean; label: string } => {
    if (!room) return { color: null, isPlayer: false, label: '观战' };
    if (room.players.black === userId) return { color: 'black', isPlayer: true, label: '黑方' };
    if (room.players.white === userId) return { color: 'white', isPlayer: true, label: '白方' };
    return { color: null, isPlayer: false, label: '观战' };
  };

  const myRole = getMyRole();
  const declaring = room?.activeDeclaration?.player === myRole.color;

  // 3. Register self as white/black when entering room if slots are empty
  useEffect(() => {
    if (!room) return;

    const updates: Partial<Room> = {};
    let changed = false;

    // Check if player names dictionary has my current nickname
    if (room.playerNames[userId] !== nickname) {
      updates[`playerNames.${userId}` as any] = nickname;
      changed = true;
    }

    // Auto slotting if room status is waiting
    if (room.status === 'waiting') {
      if (room.players.black === null && room.players.white !== userId) {
        updates['players.black'] = userId;
        updates[`playerNames.${userId}` as any] = nickname;
        changed = true;
      } else if (room.players.white === null && room.players.black !== userId) {
        updates['players.white'] = userId;
        updates[`playerNames.${userId}` as any] = nickname;
        changed = true;
      }
    }

    if (changed) {
      updateDoc(doc(db, 'rooms', roomId), updates).catch(err => console.error('Error updating player registration:', err));
    }
  }, [room, roomId, userId, nickname]);

  // 4. Timer Tick Effect
  useEffect(() => {
    if (!room || room.status !== 'playing' || room.winner || room.activeDeclaration) {
      return;
    }

    const interval = setInterval(() => {
      const elapsedMs = Date.now() - room.lastMoveTime;
      const totalElapsedSec = Math.floor(elapsedMs / 1000);

      // Calculation of remaining clock
      let stepTimeLeft = Math.max(0, room.stepTime - totalElapsedSec);
      let byoyomiTimeLeft = room.playerByoyomi[room.turn];

      if (stepTimeLeft === 0) {
        // We are consuming byoyomi reservoir!
        const byoyomiSpent = totalElapsedSec - room.stepTime;
        byoyomiTimeLeft = Math.max(0, room.playerByoyomi[room.turn] - byoyomiSpent);
      }

      setLocalStepTime(stepTimeLeft);
      setLocalByoyomiTime(byoyomiTimeLeft);

      // Timeout execution guard!
      // Only the active player or opponent handles triggering.
      // To prevent strict network latency bugs where a player played at the last second
      // but their connection lagged, we wait an extra grace period (e.g., 3s)
      // before actually enforcing the timeout.
      if (byoyomiTimeLeft === 0) {
        // Visual timer shows 0, but logical timeout adds a small grace period for remote network sync
        const totalBudgetSec = room.stepTime + room.playerByoyomi[room.turn];
        const GRACE_PERIOD_SEC = 3;
        
        if (totalElapsedSec >= totalBudgetSec + GRACE_PERIOD_SEC) {
          clearInterval(interval);
          handleTimeout(room.turn);
        }
      }
    }, 200);

    return () => clearInterval(interval);
  }, [room]);

  // Periodic visual clock for showing time left during non-active player states
  useEffect(() => {
    if (!room || room.status !== 'playing' || room.winner) return;

    // Set initial clock render
    const elapsedMs = Date.now() - room.lastMoveTime;
    const totalElapsedSec = Math.floor(elapsedMs / 1000);
    const stepTimeLeft = Math.max(0, room.stepTime - totalElapsedSec);
    let byoyomiTimeLeft = room.playerByoyomi[room.turn];

    if (stepTimeLeft === 0) {
      const byoyomiSpent = totalElapsedSec - room.stepTime;
      byoyomiTimeLeft = Math.max(0, room.playerByoyomi[room.turn] - byoyomiSpent);
    }
    setLocalStepTime(stepTimeLeft);
    setLocalByoyomiTime(byoyomiTimeLeft);
  }, [room?.lastMoveTime, room?.turn, room?.status]);

  // Exit Room Cleanup
  const handleExitRoom = async () => {
    if (!room) {
      onExit();
      return;
    }

    try {
      const roomRef = doc(db, 'rooms', roomId);
      const updates: any = {};
      
      let wasPlayer = false;
      if (room.players.black === userId) {
        updates['players.black'] = null;
        updates['playerReady.black'] = false;
        wasPlayer = true;
      }
      if (room.players.white === userId) {
        updates['players.white'] = null;
        updates['playerReady.white'] = false;
        wasPlayer = true;
      }

      if (room.status === 'playing' && wasPlayer) {
        const opponentColor = room.players.black === userId ? 'white' : 'black';
        updates.status = 'finished';
        updates.winner = opponentColor;
        updates.winnerReason = '对方退出房间导致游戏结束';
      }

      const willBeBlackEmpty = room.players.black === userId ? true : !room.players.black;
      const willBeWhiteEmpty = room.players.white === userId ? true : !room.players.white;

      if (willBeBlackEmpty && willBeWhiteEmpty) {
        await deleteDoc(roomRef);
      } else if (Object.keys(updates).length > 0) {
        await updateDoc(roomRef, updates);
      }

      onExit();
    } catch (err) {
      console.error('Error exiting room:', err);
      onExit();
    }
  };

  // Set Ready status toggle
  const handleToggleReady = async () => {
    if (!room || !myRole.isPlayer || !myRole.color) return;

    try {
      const roomRef = doc(db, 'rooms', roomId);
      const targetKey = `playerReady.${myRole.color}`;
      const updatedReady = !room.playerReady[myRole.color];

      const updates: any = {
        [targetKey]: updatedReady
      };

      // Check if both will be ready now
      const isBlackReady = myRole.color === 'black' ? updatedReady : room.playerReady.black;
      const isWhiteReady = myRole.color === 'white' ? updatedReady : room.playerReady.white;

      const hasBothPlayers = room.players.black !== null && room.players.white !== null;

      if (isBlackReady && isWhiteReady && hasBothPlayers) {
        // Start game!
        updates.status = 'playing';
        updates.lastMoveTime = Date.now();
        updates.turn = 'black';
        updates.winner = null;
        updates.playerLives = {
          black: room.totalLives,
          white: room.totalLives
        };
        updates.playerByoyomi = {
          black: room.byoyomiTime,
          white: room.byoyomiTime
        };
        updates.moves = [];

        // System message of game start
        await postSystemChat('对局已经正式开始！黑方先手，开始落子！');
      }

      await updateDoc(roomRef, updates);
    } catch (err) {
      console.error('Error toggling ready:', err);
    }
  };

  // Post System chat log
  const postSystemChat = async (text: string) => {
    try {
      const msgDoc = doc(collection(db, 'rooms', roomId, 'messages'));
      await setDoc(msgDoc, {
        id: msgDoc.id,
        senderId: 'system',
        senderName: '系统通知',
        text,
        role: 'spectator',
        createdAt: Date.now()
      });
    } catch (err) {
      console.error('Error posting system chat:', err);
    }
  };

  // Post message to chat
  const handleSendChat = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = chatInput.trim();
    if (!text || !room) return;

    try {
      const msgDoc = doc(collection(db, 'rooms', roomId, 'messages'));
      await setDoc(msgDoc, {
        id: msgDoc.id,
        senderId: userId,
        senderName: nickname,
        text,
        role: myRole.color || 'spectator',
        createdAt: Date.now()
      });
      setChatInput('');
    } catch (err) {
      console.error('Error sending message:', err);
    }
  };

  // Reconstruct board stones array up to historyIndex
  const getBoardStones = (index: number): { x: number; y: number; color: PlayerColor; originalMoveIndex: number }[] => {
    if (!room) return [];
    const stones: { x: number; y: number; color: PlayerColor; originalMoveIndex: number }[] = [];

    for (let i = 0; i < index; i++) {
      const move = room.moves[i];
      if (!move) continue;

      if (move.type === 'play') {
        stones.push({
          x: move.x!,
          y: move.y!,
          color: move.player,
          originalMoveIndex: i
        });
      } else if (move.type === 'declare_success') {
        const retractedMoveIdx = move.retractedMoveIndex!;
        const retracted = room.moves[retractedMoveIdx];
        if (retracted) {
          // Remove the corresponding stone
          const stoneIdx = stones.findIndex(s => s.x === retracted.x! && s.y === retracted.y!);
          if (stoneIdx !== -1) {
            stones.splice(stoneIdx, 1);
          }
        }
      }
    }

    return stones;
  };

  const stonesOnBoard = getBoardStones(historyIndex);

  // Find last played move in the current displayed history
  const getLastPlayedMove = (): Move | null => {
    if (!room || historyIndex === 0) return null;
    // Iterate backwards from historyIndex-1 to find the latest 'play' move
    for (let i = historyIndex - 1; i >= 0; i--) {
      const m = room.moves[i];
      if (m && m.type === 'play') {
        return m;
      }
    }
    return null;
  };

  const lastMove = getLastPlayedMove();

  // Handle Board Intersection Point Click
  const handleIntersectionClick = async (x: number, y: number) => {
    if (!room || room.status !== 'playing' || room.winner || room.activeDeclaration) return;
    if (historyIndex !== room.moves.length) return; // Must be at latest step to play

    if (!myRole.isPlayer || myRole.color !== room.turn) return;

    // Check if space is already occupied
    const occupied = stonesOnBoard.some(s => s.x === x && s.y === y);
    if (occupied) return;

    // Play!
    const newMove: Move = {
      id: 'm_' + Date.now(),
      type: 'play',
      player: myRole.color,
      x,
      y,
      createdAt: Date.now()
    };

    // Reservoir overtime updates
    const elapsedSecs = Math.floor((Date.now() - room.lastMoveTime) / 1000);
    const byoyomiCost = Math.max(0, elapsedSecs - room.stepTime);
    const updatedByoyomi = Math.max(0, room.playerByoyomi[room.turn] - byoyomiCost);

    const opponentColor = myRole.color === 'black' ? 'white' : 'black';

    try {
      const roomRef = doc(db, 'rooms', roomId);
      await updateDoc(roomRef, {
        [`playerByoyomi.${room.turn}`]: updatedByoyomi,
        turn: opponentColor,
        lastMoveTime: Date.now(),
        moves: [...room.moves, newMove]
      });


    } catch (err) {
      console.error('Error placing stone:', err);
    }
  };

  const timeoutLock = useRef<number>(-1);

  // Timeout handler
  const handleTimeout = async (timedOutPlayer: PlayerColor) => {
    if (!room || room.status !== 'playing' || room.winner) return;
    if (timeoutLock.current === room.moves.length) return;
    timeoutLock.current = room.moves.length;
    
    const opponentColor = timedOutPlayer === 'black' ? 'white' : 'black';
    // To prevent duplicate timeout triggers from multiple clients, only the opponent is authorized to enforce the timeout.
    // If the opponent is disconnected, the timeout will be enforced as soon as they reconnect.
    if (myRole.color !== opponentColor) return;

    const updatedLives = Math.max(0, room.playerLives[timedOutPlayer] - 1);

    const isGameOver = updatedLives === 0;

    const timeoutMove: Move = {
      id: 'timeout_' + Date.now(),
      type: 'timeout',
      player: timedOutPlayer,
      createdAt: Date.now()
    };

    try {
      const roomRef = doc(db, 'rooms', roomId);
      const updates: any = {
        [`playerLives.${timedOutPlayer}`]: updatedLives,
        [`playerByoyomi.${timedOutPlayer}`]: room.byoyomiTime, // Refresh byoyomi reservoir
        lastMoveTime: Date.now(),
        moves: [...room.moves, timeoutMove],
        activeDeclaration: null
      };

      if (isGameOver) {
        updates.status = 'finished';
        updates.winner = opponentColor;
        updates.winnerReason = '对方超时';
        await postSystemChat(`时间到！${timedOutPlayer === 'black' ? '黑方' : '白方'}生命值耗尽，游戏结束，${opponentColor === 'black' ? '黑方' : '白方'}获胜。`);
      } else {
        await postSystemChat(`超时！${timedOutPlayer === 'black' ? '黑方' : '白方'}失去 1 点生命，重置读秒。`);
      }

      await updateDoc(roomRef, updates);
    } catch (err) {
      console.error('Error executing timeout:', err);
    }
  };

  // Conconcyclic Declaration Mode Toggle Toggle
  const handleStartDeclaration = () => {
    if (!room || room.status !== 'playing' || room.winner || room.activeDeclaration) return;
    if (!myRole.isPlayer || myRole.color !== room.turn) return; // Only active player can declare based on the opponent's last move

    if (!lastMove || lastMove.player === myRole.color) {
      alert('无法宣言：对方尚未下子，或者上一步并非是对方的落子！');
      return;
    }

    // Set declaration state
    setSelectedDeclarationPoints([]);

    const roomRef = doc(db, 'rooms', roomId);
    updateDoc(roomRef, {
      activeDeclaration: {
        player: myRole.color,
        startedAt: Date.now()
      }
    }).catch(err => console.error('Error starting declaration:', err));

    postSystemChat(`[共圆宣言] ${nickname} 发起了“共圆！”宣言！`);
  };

  // Select stone during declaring concyclic
  const handleSelectStoneForDeclaration = (stone: { x: number; y: number }) => {
    if (!declaring || !lastMove) return;

    // Opponent last stone cannot be selected again, since it's the mandatory basis
    if (stone.x === lastMove.x && stone.y === lastMove.y) {
      return;
    }

    const existsIdx = selectedDeclarationPoints.findIndex(p => p.x === stone.x && p.y === stone.y);
    if (existsIdx !== -1) {
      setSelectedDeclarationPoints(prev => prev.filter((_, idx) => idx !== existsIdx));
    } else {
      if (selectedDeclarationPoints.length < 3) {
        setSelectedDeclarationPoints(prev => [...prev, stone]);
      } else {
        alert('无法选择：最多只能选择另外3个子进行四点共圆宣言！');
      }
    }
  };

  // Confirm declaration submission
  const handleConfirmDeclaration = async () => {
    if (!room || !room.activeDeclaration || !lastMove) return;
    if (selectedDeclarationPoints.length !== 3) {
      alert('宣言失败：必须在棋盘上不限颜色选择另外3个子来与最新的落子形成四点共圆！');
      return;
    }

    const opponentColor = myRole.color === 'black' ? 'white' : 'black';

    // The four points to validate
    const p1: Point = { x: lastMove.x!, y: lastMove.y! };
    const p2 = selectedDeclarationPoints[0];
    const p3 = selectedDeclarationPoints[1];
    const p4 = selectedDeclarationPoints[2];

    const isSuccess = checkConcyclic(p1, p2, p3, p4);

    const roomRef = doc(db, 'rooms', roomId);

    try {
      if (isSuccess) {
        // Success!
        // Opponent loses 1 life
        const updatedOpponentLives = Math.max(0, room.playerLives[opponentColor] - 1);
        const isGameOver = updatedOpponentLives === 0;

        // Retrieve the retracted index
        // It's the move in room.moves that matches lastMove.id
        const lastMoveIndex = room.moves.findIndex(m => m.id === lastMove.id);

        const newSuccessMove: Move = {
          id: 'dec_success_' + Date.now(),
          type: 'declare_success',
          player: myRole.color,
          selectedPoints: selectedDeclarationPoints,
          retractedMoveIndex: lastMoveIndex,
          createdAt: Date.now()
        };

        const updates: any = {
          activeDeclaration: null,
          [`playerLives.${opponentColor}`]: updatedOpponentLives,
          lastMoveTime: Date.now(), // Reset clock for declaration success play
          // The next turn is our turn because we succeeded!
          turn: myRole.color,
          moves: [...room.moves, newSuccessMove]
        };

        if (isGameOver) {
          updates.status = 'finished';
          updates.winner = myRole.color;
          updates.winnerReason = '共圆宣言成功';
          await postSystemChat(`宣言成功！四点 (${p1.x+1}, ${p1.y+1}), (${p2.x+1}, ${p2.y+1}), (${p3.x+1}, ${p3.y+1}), (${p4.x+1}, ${p4.y+1}) 共圆。${opponentColor === 'black' ? '黑方' : '白方'}扣除1点生命，生命值为0。游戏结束，${myRole.color === 'black' ? '黑方' : '白方'}获胜。`);
        } else {
          await postSystemChat(`宣言成功！四点共圆成立。${opponentColor === 'black' ? '黑方' : '白方'}扣除1点生命，上一步落子 (${p1.x+1}, ${p1.y+1}) 被移除，由 ${nickname} 继续落子。`);
        }

        setSelectedDeclarationPoints([]);
        await updateDoc(roomRef, updates);
      } else {
        // Fail! We lose 1 life
        const updatedMyLives = Math.max(0, room.playerLives[myRole.color!] - 1);
        const isGameOver = updatedMyLives === 0;

        const newFailMove: Move = {
          id: 'dec_fail_' + Date.now(),
          type: 'declare_fail',
          player: myRole.color!,
          selectedPoints: selectedDeclarationPoints,
          createdAt: Date.now()
        };

        const updates: any = {
          activeDeclaration: null,
          [`playerLives.${myRole.color!}`]: updatedMyLives,
          moves: [...room.moves, newFailMove],
          lastMoveTime: room.lastMoveTime + (Date.now() - room.activeDeclaration.startedAt)
        };

        if (isGameOver) {
          updates.status = 'finished';
          updates.winner = opponentColor;
          updates.winnerReason = '对方共圆宣言失败';
          await postSystemChat(`宣言失败，四点不共圆。${myRole.color === 'black' ? '黑方' : '白方'}损失1点生命，生命值为0。游戏结束，${opponentColor === 'black' ? '黑方' : '白方'}获胜。`);
        } else {
          await postSystemChat(`宣言失败，四点不共圆。${myRole.color === 'black' ? '黑方' : '白方'}损失1点生命，交回行棋权。`);
        }

        setSelectedDeclarationPoints([]);
        await updateDoc(roomRef, updates);
      }
    } catch (err) {
      console.error('Error resolving declaration:', err);
    }
  };

  // Toggle show all concyclic circles on board (retro review mode)
  const handleToggleAllCircles = () => {
    if (!room) return;
    if (showAllConcyclic) {
      setSavedAnalysisByStep(prev => {
        const copy = { ...prev };
        delete copy[historyIndex];
        return copy;
      });
      setHoveredGroupIndex(null);
      setSelectedGroupIndex(null);
    } else {
      // Find all groups is computationally light because we only scan stonesOnBoard
      const coords = stonesOnBoard.map(s => ({ x: s.x, y: s.y }));
      const groups = findAllConcyclicGroups(coords);
      setSavedAnalysisByStep(prev => ({
        ...prev,
        [historyIndex]: groups
      }));
    }
  };

  // Start a new game room reset matching
  const handleRestartNewGame = async () => {
    if (!room) return;
    try {
      const roomRef = doc(db, 'rooms', roomId);
      await updateDoc(roomRef, {
        'players.black': room.players.white,
        'players.white': room.players.black,
        status: 'waiting',
        playerReady: {
          black: false,
          white: false
        },
        playerLives: {
          black: room.totalLives,
          white: room.totalLives
        },
        playerByoyomi: {
          black: room.byoyomiTime,
          white: room.byoyomiTime
        },
        turn: 'black',
        winner: null,
        winnerReason: '',
        lastMoveTime: 0,
        activeDeclaration: null,
        moves: []
      });

      setHistoryIndex(0);
      setSavedAnalysisByStep({});
      await postSystemChat(`重新开局！双方已交换黑白方，重新进入备战状态。`);
    } catch (err) {
      console.error('Error resetting game room:', err);
    }
  };

  if (!room) {
    return (
      <div className="flex flex-col items-center justify-center py-24 font-sans border border-neutral-200 rounded-xl bg-white m-4">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-black mb-3"></div>
        <p className="text-sm text-neutral-400 font-mono">正在加载对弈房间...</p>
      </div>
    );
  }

  const isWaitState = room.status === 'waiting';
  const isPlayState = room.status === 'playing';
  const isEndState = room.status === 'finished';

  // Board Size Constants
  const N = room.size;
  const boardWidth = 440;
  const margin = 30;
  const gridSpan = (boardWidth - margin * 2) / (N - 1);

  // Helper to map index to alphabet
  const getColLabel = (idx: number) => String.fromCharCode(65 + idx); // A, B, C...
  const getRowLabel = (idx: number) => idx + 1; // 1, 2, 3...

  // Star Points (星位) for sizes
  const getStarPoints = (): Point[] => {
    if (N === 9) {
      return [{ x: 2, y: 2 }, { x: 2, y: 6 }, { x: 6, y: 2 }, { x: 6, y: 6 }, { x: 4, y: 4 }];
    } else if (N === 13) {
      return [{ x: 3, y: 3 }, { x: 3, y: 9 }, { x: 9, y: 3 }, { x: 9, y: 9 }, { x: 6, y: 6 }];
    } else if (N === 15) {
      return [{ x: 3, y: 3 }, { x: 3, y: 11 }, { x: 11, y: 3 }, { x: 11, y: 11 }, { x: 7, y: 7 }];
    } else if (N === 19) {
      const edge = 3;
      const center = 9;
      return [
        { x: edge, y: edge }, { x: edge, y: N - 1 - edge }, { x: N - 1 - edge, y: edge }, { x: N - 1 - edge, y: N - 1 - edge },
        { x: edge, y: center }, { x: center, y: edge }, { x: center, y: N - 1 - edge }, { x: N - 1 - edge, y: center },
        { x: center, y: center }
      ];
    }
    return [];
  };

  const starPoints = getStarPoints();

  // Helper to resolve players display name
  const getPlayerName = (uid: string | null): string => {
    if (!uid) return '等待加入...';
    return room.playerNames[uid] || '联弈用户';
  };

  const activeDeclaringPlayer = room.activeDeclaration?.player;

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 font-sans selection:bg-black selection:text-white">
      {/* Top Navbar details */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center border-2 border-black bg-white px-6 py-4 shadow-[4px_4px_0px_rgba(0,0,0,1)] mb-6 gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-lg font-black text-black tracking-tight uppercase">{room.name}</h1>
            <span className="text-xs font-mono font-bold bg-neutral-100 text-black px-2 py-0.5 border border-black">
              ID: {room.id}
            </span>
          </div>
          <p className="text-[10px] text-neutral-500 font-mono font-extrabold uppercase tracking-widest mt-1">
            GRID: {N}×{N} · HEALTH: {room.totalLives} HP · TIMER: {room.stepTime}S / BYOYOMI: {room.byoyomiTime}S
          </p>
        </div>

        {/* Mini status indicator */}
        <div className="flex items-center gap-3">
          {isWaitState && (
            <span className="text-[10px] font-bold border border-black bg-neutral-100 text-black px-3 py-1.5 uppercase tracking-wider">
              等待双方准备 READYING
            </span>
          )}
          {isPlayState && (
            <span className="text-[10px] font-black border border-black bg-black text-white px-3 py-1.5 uppercase tracking-widest animate-pulse">
              进行中 BATTLE (第 {room.moves.length} 手)
            </span>
          )}
          {isEndState && (
            <span className="text-[10px] font-black border border-black bg-neutral-100 text-black px-3 py-1.5 uppercase tracking-widest">
              对局已分胜负 OVER
            </span>
          )}

          <button
            id="exit-room-button"
            onClick={handleExitRoom}
            className="text-[10px] font-black tracking-widest uppercase px-4 py-1.5 border-2 border-black bg-white text-black hover:bg-black hover:text-white transition-all shadow-[2px_2px_0px_rgba(0,0,0,1)] active:shadow-none active:translate-x-0.5 active:translate-y-0.5 cursor-pointer"
          >
            离开房间 EXIT
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* LEFT COLUMN (Lg span 7): Interactive Board and Navigation step buttons */}
        <div className="lg:col-span-7 flex flex-col items-center">
          {/* Historical navigation badge alert */}
          {historyIndex !== room.moves.length && (
            <div className="w-full bg-white border-2 border-black p-3 text-xs mb-4 flex justify-between items-center text-black shadow-[4px_4px_0px_rgba(0,0,0,1)]">
              <span className="flex items-center gap-2 font-mono font-bold uppercase text-[10px]">
                <Info size={14} className="text-black animate-bounce" />
                复盘中 REVIEW: VIEWING MOVE {historyIndex} / {room.moves.length}
              </span>
              <button
                id="jump-to-latest"
                onClick={() => {
                  setHistoryIndex(room.moves.length);
                }}
                className="bg-black hover:bg-neutral-800 text-white font-mono font-black text-[9px] px-3 py-1.5 border border-black uppercase tracking-widest cursor-pointer shadow-[2px_2px_0px_rgba(255,255,255,0.2)]"
              >
                回到最新 JUMP LATEST
              </button>
            </div>
          )}

          {/* Large SVG Goban Board panel */}
          <div className="bg-white border-4 border-black p-4 shadow-[6px_6px_0px_rgba(0,0,0,1)] w-full max-w-[500px] aspect-square flex items-center justify-center relative">
            <svg
              id="concyclic-goban-board"
              viewBox={`0 0 ${boardWidth} ${boardWidth}`}
              className="w-full h-full select-none"
            >
              <defs>
                <radialGradient id="black-gradient" cx="30%" cy="30%" r="70%">
                  <stop offset="0%" stopColor="#555" />
                  <stop offset="30%" stopColor="#222" />
                  <stop offset="100%" stopColor="#000" />
                </radialGradient>
                <radialGradient id="white-gradient" cx="30%" cy="30%" r="70%">
                  <stop offset="0%" stopColor="#fff" />
                  <stop offset="80%" stopColor="#eee" />
                  <stop offset="100%" stopColor="#ccc" />
                </radialGradient>
                <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
                  <feDropShadow dx="1" dy="1.5" stdDeviation="1.5" floodOpacity="0.3" />
                </filter>
              </defs>

              {/* Board Wood Background details */}
              <rect width={boardWidth} height={boardWidth} fill="#ffffff" />

              {/* Coordinate Margins Header Letters */}
              {Array.from({ length: N }).map((_, i) => (
                <text
                  key={`col-lbl-${i}`}
                  x={margin + i * gridSpan}
                  y={margin - 10}
                  textAnchor="middle"
                  className="font-mono text-[9px] font-black fill-black"
                >
                  {getColLabel(i)}
                </text>
              ))}

              {/* Coordinate Margins Footer Letters */}
              {Array.from({ length: N }).map((_, i) => (
                <text
                  key={`col-lbl-bot-${i}`}
                  x={margin + i * gridSpan}
                  y={boardWidth - margin + 18}
                  textAnchor="middle"
                  className="font-mono text-[9px] font-black fill-black"
                >
                  {getColLabel(i)}
                </text>
              ))}

              {/* Coordinate Margins Left Numbers */}
              {Array.from({ length: N }).map((_, i) => (
                <text
                  key={`row-lbl-${i}`}
                  x={margin - 14}
                  y={margin + i * gridSpan + 3}
                  textAnchor="end"
                  className="font-mono text-[9px] font-black fill-black"
                >
                  {getRowLabel(i)}
                </text>
              ))}

              {/* Coordinate Margins Right Numbers */}
              {Array.from({ length: N }).map((_, i) => (
                <text
                  key={`row-lbl-rt-${i}`}
                  x={boardWidth - margin + 14}
                  y={margin + i * gridSpan + 3}
                  textAnchor="start"
                  className="font-mono text-[9px] font-black fill-black"
                >
                  {getRowLabel(i)}
                </text>
              ))}

              {/* Grid Horizontal Lines */}
              {Array.from({ length: N }).map((_, i) => (
                <line
                  key={`grid-hz-${i}`}
                  x1={margin}
                  y1={margin + i * gridSpan}
                  x2={boardWidth - margin}
                  y2={margin + i * gridSpan}
                  stroke="#000000"
                  strokeWidth="1.2"
                />
              ))}

              {/* Grid Vertical Lines */}
              {Array.from({ length: N }).map((_, i) => (
                <line
                  key={`grid-vt-${i}`}
                  x1={margin + i * gridSpan}
                  y1={margin}
                  x2={margin + i * gridSpan}
                  y2={boardWidth - margin}
                  stroke="#000000"
                  strokeWidth="1.2"
                />
              ))}

              {/* Star point dots (星位) */}
              {starPoints.map((pt, i) => (
                <circle
                  key={`star-${i}`}
                  cx={margin + pt.x * gridSpan}
                  cy={margin + pt.y * gridSpan}
                  r={3.5}
                  fill="#000000"
                />
              ))}

              {/* Display Concyclic Circles / Lines under active review select or hover */}
              {concyclicGroups.map((group, grpIdx) => {
                const isHovered = hoveredGroupIndex === grpIdx;
                const isSelected = selectedGroupIndex === grpIdx;

                if (!isHovered && !isSelected) return null;

                const strokeColor = isSelected ? '#ef4444' : '#3b82f6';
                const strokeWidth = isSelected ? '3.5' : '2.5';

                if (group.type === 'circle' && group.center && group.radius) {
                  const cxSVG = margin + group.center.x * gridSpan;
                  const cySVG = margin + group.center.y * gridSpan;
                  const rSVG = group.radius * gridSpan;

                  return (
                    <circle
                      key={`concyclic-circ-${grpIdx}`}
                      cx={cxSVG}
                      cy={cySVG}
                      r={rSVG}
                      fill="none"
                      stroke={strokeColor}
                      strokeWidth={strokeWidth}
                      strokeDasharray="5,3"
                      className="transition-all duration-300"
                    />
                  );
                } else if (group.type === 'line') {
                  // For collinear line, draw a long line crossing coordinates bounds
                  // Sort points by X then Y to find ends
                  const sorted = [...group.points].sort((a, b) => a.x - b.x || a.y - b.y);
                  const pStart = sorted[0];
                  const pEnd = sorted[sorted.length - 1];

                  const dx = pEnd.x - pStart.x;
                  const dy = pEnd.y - pStart.y;

                  // Extent line endpoints for better visual
                  const x1 = margin + (pStart.x - dx * 0.15) * gridSpan;
                  const y1 = margin + (pStart.y - dy * 0.15) * gridSpan;
                  const x2 = margin + (pEnd.x + dx * 0.15) * gridSpan;
                  const y2 = margin + (pEnd.y + dy * 0.15) * gridSpan;

                  return (
                    <line
                      key={`concyclic-line-${grpIdx}`}
                      x1={x1}
                      y1={y1}
                      x2={x2}
                      y2={y2}
                      stroke={strokeColor}
                      strokeWidth={strokeWidth}
                      strokeDasharray="5,3"
                    />
                  );
                }
                return null;
              })}

              {/* Visual Concyclic Success circle from history if latest move is declare_success */}
              {(() => {
                const curMove = room.moves[historyIndex - 1];
                if (curMove && curMove.type === 'declare_success' && curMove.selectedPoints && curMove.selectedPoints.length === 3) {
                  // Reconstruct the 4 points including the retracted move
                  const retracted = room.moves[curMove.retractedMoveIndex!];
                  if (retracted) {
                    const p1 = { x: retracted.x!, y: retracted.y! };
                    const p2 = curMove.selectedPoints[0];
                    const p3 = curMove.selectedPoints[1];
                    const p4 = curMove.selectedPoints[2];

                    if (areFourCollinear(p1, p2, p3, p4)) {
                      const sorted = [p1, p2, p3, p4].sort((a, b) => a.x - b.x || a.y - b.y);
                      const x1 = margin + sorted[0].x * gridSpan;
                      const y1 = margin + sorted[0].y * gridSpan;
                      const x2 = margin + sorted[3].x * gridSpan;
                      const y2 = margin + sorted[3].y * gridSpan;
                      return (
                        <line
                          x1={x1}
                          y1={y1}
                          x2={x2}
                          y2={y2}
                          stroke="#ef4444"
                          strokeWidth="3.5"
                          strokeDasharray="6,4"
                        />
                      );
                    } else {
                      const circ = calculateCircle(p1, p2, p3);
                      if (circ) {
                        return (
                          <circle
                            cx={margin + circ.center.x * gridSpan}
                            cy={margin + circ.center.y * gridSpan}
                            r={circ.radius * gridSpan}
                            fill="none"
                            stroke="#ef4444"
                            strokeWidth="3.5"
                            strokeDasharray="6,4"
                          />
                        );
                      }
                    }
                  }
                }
                return null;
              })()}

              {/* Hover Intersect Preview Dot (Only on matching user turn and active view index) */}
              {isPlayState && myRole.color === room.turn && historyIndex === room.moves.length && !room.activeDeclaration && (
                Array.from({ length: N }).map((_, r) =>
                  Array.from({ length: N }).map((_, c) => {
                    const isOcc = stonesOnBoard.some(s => s.x === c && s.y === r);
                    if (isOcc) return null;

                    return (
                      <circle
                        key={`preval-${c}-${r}`}
                        cx={margin + c * gridSpan}
                        cy={margin + r * gridSpan}
                        r={gridSpan * 0.45}
                        fill="transparent"
                        className="hover:fill-black/15 cursor-pointer transition-all duration-150"
                        onClick={() => handleIntersectionClick(c, r)}
                      />
                    );
                  })
                )
              )}

              {/* Stones currently on board */}
              {stonesOnBoard.map((stone, idx) => {
                const cxSVG = margin + stone.x * gridSpan;
                const cySVG = margin + stone.y * gridSpan;

                // Highlights
                const isLastPlayedStone = lastMove && lastMove.x === stone.x && lastMove.y === stone.y;

                // Color configuration
                const isBlack = stone.color === 'black';

                // Declaration details
                const isDeclaredBase = declaring && isLastPlayedStone;
                const isDeclaredSelected = selectedDeclarationPoints.some(p => p.x === stone.x && p.y === stone.y);

                return (
                  <g
                    key={`stone-${idx}`}
                    filter="url(#shadow)"
                    className="cursor-pointer"
                    onClick={() => handleSelectStoneForDeclaration(stone)}
                  >
                    {/* Ring highlight for last played move */}
                    {isLastPlayedStone && !declaring && (
                      <circle
                        cx={cxSVG}
                        cy={cySVG}
                        r={gridSpan * 0.58}
                        fill="none"
                        stroke="#f59e0b"
                        strokeWidth="2.5"
                        className="animate-pulse"
                      />
                    )}

                    {/* Ring highlight for concyclic base stone */}
                    {isDeclaredBase && (
                      <circle
                        cx={cxSVG}
                        cy={cySVG}
                        r={gridSpan * 0.58}
                        fill="none"
                        stroke="#ef4444"
                        strokeWidth="3"
                        className="animate-pulse"
                      />
                    )}

                    {/* Checked highlight ring for chosen stones */}
                    {isDeclaredSelected && (
                      <circle
                        cx={cxSVG}
                        cy={cySVG}
                        r={gridSpan * 0.58}
                        fill="none"
                        stroke="#10b981"
                        strokeWidth="3"
                      />
                    )}

                    {/* The stone body itself */}
                    <circle
                      cx={cxSVG}
                      cy={cySVG}
                      r={gridSpan * 0.41}
                      fill={isBlack ? 'url(#black-gradient)' : 'url(#white-gradient)'}
                      stroke={isBlack ? '#111' : '#bbb'}
                      strokeWidth="1"
                    />

                    {/* Text indicators or selections overlay */}
                    {isDeclaredBase && (
                      <text
                        x={cxSVG}
                        y={cySVG + 3}
                        textAnchor="middle"
                        fill="red"
                        className="font-mono text-[9px] font-extrabold"
                      >
                        1/4
                      </text>
                    )}

                    {isDeclaredSelected && (
                      <text
                        x={cxSVG}
                        y={cySVG + 3}
                        textAnchor="middle"
                        fill="#10b981"
                        className="font-mono text-[9px] font-extrabold"
                      >
                        ✓
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>

          {/* Stepper Steps controls (第一步, 前一步, 后一步, 最后一步) */}
          <div className="flex gap-1 justify-center items-center mt-5 mb-5 select-none bg-white border-2 border-black p-1 shadow-[3px_3px_0px_rgba(0,0,0,1)] text-black font-mono">
            <button
              id="step-first"
              disabled={historyIndex === 0}
              onClick={() => {
                setHistoryIndex(0);
                setSelectedGroupIndex(null);
              }}
              className="p-2 border border-transparent hover:border-black hover:bg-neutral-50 text-black disabled:opacity-30 cursor-pointer"
              title="第一步"
            >
              <ChevronsLeft size={14} className="stroke-[3.5]" />
            </button>
            <button
              id="step-prev"
              disabled={historyIndex === 0}
              onClick={() => {
                setHistoryIndex(prev => Math.max(0, prev - 1));
                setSelectedGroupIndex(null);
              }}
              className="p-2 border border-transparent hover:border-black hover:bg-neutral-50 text-black disabled:opacity-30 flex items-center gap-1 text-[10px] font-black uppercase tracking-tight cursor-pointer"
              title="向前一步"
            >
              <ChevronLeft size={14} className="stroke-[3.5]" />
              <span>向前 PREV</span>
            </button>
            <span className="font-mono text-xs px-3.5 py-1 text-white bg-black border border-black font-extrabold">
              {historyIndex} / {room.moves.length}
            </span>
            <button
              id="step-next"
              disabled={historyIndex >= room.moves.length}
              onClick={() => {
                setHistoryIndex(prev => Math.min(room.moves.length, prev + 1));
                setSelectedGroupIndex(null);
              }}
              className="p-2 border border-transparent hover:border-black hover:bg-neutral-50 text-black disabled:opacity-30 flex items-center gap-1 text-[10px] font-black uppercase tracking-tight cursor-pointer"
              title="向后一步"
            >
              <span>向后 NEXT</span>
              <ChevronRight size={14} className="stroke-[3.5]" />
            </button>
            <button
              id="step-last"
              disabled={historyIndex >= room.moves.length}
              onClick={() => {
                setHistoryIndex(room.moves.length);
                setSelectedGroupIndex(null);
              }}
              className="p-2 border border-transparent hover:border-black hover:bg-neutral-50 text-black disabled:opacity-30 cursor-pointer"
              title="最后一步"
            >
              <ChevronsRight size={14} className="stroke-[3.5]" />
            </button>
          </div>

          {/* Show All Concyclic Panel (For Post game Review & Analysis) */}
          {isEndState && (
            <div className="w-full max-w-[500px]">
              <div className="bg-white border-2 border-black p-5 shadow-[4px_4px_0px_rgba(0,0,0,1)]">
                <div className="flex justify-between items-center mb-3">
                  <h3 className="text-xs font-black uppercase tracking-widest text-black flex items-center gap-2">
                    <Info size={14} className="stroke-[3]" />
                    <span>共圆复盘报告 ANALYSIS</span>
                  </h3>
                  <button
                    id="find-all-concyclic"
                    onClick={handleToggleAllCircles}
                    className="text-[10px] font-black tracking-wider uppercase px-4 py-2 border-2 border-black bg-white hover:bg-black hover:text-white transition-all shadow-[2px_2px_0px_rgba(0,0,0,1)] active:shadow-none active:translate-x-0.5 active:translate-y-0.5 cursor-pointer"
                  >
                    {showAllConcyclic ? '收起辅助 HIDE' : '显示共圆 SHOW ALL'}
                  </button>
                </div>

                {showAllConcyclic && (
                  <div className="text-xs font-mono">
                    <p className="text-neutral-500 mb-3 font-bold text-[10px] uppercase tracking-wide">
                      FOUND <span className="font-extrabold text-black bg-neutral-100 px-1 border border-black">{concyclicGroups.length}</span> GROUPS. HOVER OR CLICK TO OVERLAY MARKERS:
                    </p>

                    {concyclicGroups.length > 0 ? (
                      <div className="max-h-[140px] overflow-y-auto border-2 border-black bg-white p-2 divide-y divide-black/10 font-mono text-[10px]">
                        {concyclicGroups.map((grp, gidx) => (
                          <div
                            key={`grp-item-${gidx}`}
                            className={`p-2 hover:bg-neutral-50 flex justify-between items-center cursor-pointer transition-colors ${
                              selectedGroupIndex === gidx ? 'bg-black text-white font-extrabold' : 'text-neutral-800'
                            }`}
                            onMouseEnter={() => setHoveredGroupIndex(gidx)}
                            onMouseLeave={() => setHoveredGroupIndex(null)}
                            onClick={() => setSelectedGroupIndex(gidx === selectedGroupIndex ? null : gidx)}
                          >
                            <span>
                              [{grp.type === 'line' ? 'ALIGN LINE' : 'CIRCLE'}] #{gidx + 1}:{' '}
                              {grp.points.map(p => `${getColLabel(p.x)}${getRowLabel(p.y)}`).join(', ')}
                            </span>
                            {grp.type === 'circle' && grp.center && grp.radius && (
                              <span className={`text-[9px] ${selectedGroupIndex === gidx ? 'text-neutral-300' : 'text-neutral-400'}`}>
                                Radius: {grp.radius.toFixed(2)}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-6 bg-white border-2 border-dashed border-black rounded-none text-neutral-400 font-mono uppercase text-[10px] font-bold">
                        No conconcyclic groups detected
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* RIGHT COLUMN (Lg span 5): Player info, countdown, chats, ready panel */}
        <div className="lg:col-span-5 space-y-6">
          {/* Active Opponents / Player Info Card */}
          <div className="border-2 border-black bg-white p-5 shadow-[4px_4px_0px_rgba(0,0,0,1)]">
            <h2 className="text-xs font-black text-black mb-4 flex items-center gap-2 uppercase font-mono tracking-widest border-b-2 border-black pb-2.5">
              <Users size={14} className="stroke-[3]" />
              <span>选手对弈状态 PLAYERS</span>
            </h2>

            <div className="space-y-4">
              {/* Black Player Card */}
              {(() => {
                const isBlackActive = isPlayState && room.turn === 'black';
                const blackName = getPlayerName(room.players.black);
                const blackLives = Array.from({ length: room.totalLives }).map((_, i) => i < room.playerLives.black);

                return (
                  <div className={`p-4 border-2 transition-all ${
                    isBlackActive
                      ? 'border-black bg-neutral-50 shadow-[3px_3px_0px_rgba(0,0,0,1)] font-bold'
                      : 'border-black bg-white opacity-85'
                  }`}>
                    <div className="flex justify-between items-center mb-2">
                      <div className="flex items-center gap-2">
                        <span className="w-4 h-4 bg-black border-2 border-black inline-block shadow-[1px_1px_0px_rgba(0,0,0,1)]"></span>
                        <span className="font-black text-xs text-black truncate max-w-[150px] uppercase font-mono tracking-wide">
                          {blackName}
                        </span>
                        {room.players.black === userId && (
                          <span className="bg-black text-white text-[9px] font-mono font-bold px-1.5 py-0.5 border border-black uppercase tracking-wide">YOU</span>
                        )}
                      </div>
                      {/* Ready status for waiting */}
                      {isWaitState && (
                        <span className={`text-[9px] font-black px-2 py-0.5 border-2 border-black font-mono uppercase tracking-widest ${
                          room.playerReady.black
                            ? 'bg-black text-white'
                            : 'bg-white text-black/55'
                        }`}>
                          {room.playerReady.black ? 'READY' : 'WAITING'}
                        </span>
                      )}
                    </div>

                    {/* Hearts (Life indicators) */}
                    {isPlayState && (
                      <div className="flex justify-between items-center text-xs">
                        <div className="flex items-center gap-1">
                          {blackLives.map((isHeartActive, i) => (
                            <Heart
                              key={`bh-${i}`}
                              size={13}
                              className={isHeartActive ? 'fill-black text-black stroke-[2]' : 'text-neutral-300'}
                            />
                          ))}
                        </div>

                        {/* Clock timer */}
                        {isBlackActive && (
                          <div className="font-mono text-xs text-right">
                            <span className="bg-black text-white px-2 py-1 border border-black font-black mr-1 uppercase tracking-wide inline-block">
                              {localStepTime}s
                            </span>
                            <span className="text-black bg-neutral-100 border border-black px-1.5 py-1 text-[10px] font-extrabold uppercase tracking-wide inline-block">
                              EXTRA: {localByoyomiTime}s
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* White Player Card */}
              {(() => {
                const isWhiteActive = isPlayState && room.turn === 'white';
                const whiteName = getPlayerName(room.players.white);
                const whiteLives = Array.from({ length: room.totalLives }).map((_, i) => i < room.playerLives.white);

                return (
                  <div className={`p-4 border-2 transition-all ${
                    isWhiteActive
                      ? 'border-black bg-neutral-50 shadow-[3px_3px_0px_rgba(0,0,0,1)] font-bold'
                      : 'border-black bg-white opacity-85'
                  }`}>
                    <div className="flex justify-between items-center mb-2">
                      <div className="flex items-center gap-2">
                        <span className="w-4 h-4 bg-white border-2 border-black inline-block shadow-[1px_1px_0px_rgba(0,0,0,1)]"></span>
                        <span className="font-black text-xs text-black truncate max-w-[150px] uppercase font-mono tracking-wide">
                          {whiteName}
                        </span>
                        {room.players.white === userId && (
                          <span className="bg-black text-white text-[9px] font-mono font-bold px-1.5 py-0.5 border border-black uppercase tracking-wide">YOU</span>
                        )}
                      </div>
                      {/* Ready status for waiting */}
                      {isWaitState && (
                        <span className={`text-[9px] font-black px-2 py-0.5 border-2 border-black font-mono uppercase tracking-widest ${
                          room.playerReady.white
                            ? 'bg-black text-white'
                            : 'bg-white text-black/55'
                        }`}>
                          {room.playerReady.white ? 'READY' : 'WAITING'}
                        </span>
                      )}
                    </div>

                    {/* Hearts (Life indicators) */}
                    {isPlayState && (
                      <div className="flex justify-between items-center text-xs">
                        <div className="flex items-center gap-1">
                          {whiteLives.map((isHeartActive, i) => (
                            <Heart
                              key={`wh-${i}`}
                              size={13}
                              className={isHeartActive ? 'fill-black text-black stroke-[2]' : 'text-neutral-300'}
                            />
                          ))}
                        </div>

                        {/* Clock timer */}
                        {isWhiteActive && (
                          <div className="font-mono text-xs text-right">
                            <span className="bg-black text-white px-2 py-1 border border-black font-black mr-1 uppercase tracking-wide inline-block">
                              {localStepTime}s
                            </span>
                            <span className="text-black bg-neutral-100 border border-black px-1.5 py-1 text-[10px] font-extrabold uppercase tracking-wide inline-block">
                              EXTRA: {localByoyomiTime}s
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>

          {/* Active Action decision areas, Ready button, pause declarations modals */}
          <div className="border-2 border-black bg-white p-5 shadow-[4px_4px_0px_rgba(0,0,0,1)] text-center">
            {/* 1. Pre-Game Waiting Ready State Buttons */}
            {isWaitState && (
              <div className="space-y-4">
                <p className="text-[10px] font-mono font-extrabold uppercase tracking-wider text-neutral-500 mb-3">
                  {room.players.black && room.players.white
                    ? '双方已就位。请点击“准备”开启游戏'
                    : '等待第二位选手加入。房间支持旁观复盘'}
                </p>

                {myRole.isPlayer ? (
                  <button
                    id="ready-up-button"
                    onClick={handleToggleReady}
                    className={`w-full font-black py-4.5 tracking-widest uppercase transition-all text-xs border-2 border-black flex items-center justify-center gap-1.5 cursor-pointer shadow-[3px_3px_0px_rgba(0,0,0,1)] active:shadow-none active:translate-x-0.5 active:translate-y-0.5 ${
                      room.playerReady[myRole.color!]
                        ? 'bg-neutral-100 hover:bg-neutral-200 text-black'
                        : 'bg-black hover:bg-neutral-850 text-white'
                    }`}
                  >
                    <Play size={14} className="stroke-[3]" />
                    <span>{room.playerReady[myRole.color!] ? '已就绪 (点击取消)' : '我准备好了 READY'}</span>
                  </button>
                ) : (
                  <div className="bg-white border-2 border-dashed border-black p-4 text-xs text-neutral-500 font-mono font-bold uppercase tracking-wider">
                    你正以 旁观观众 SPECTATOR 身份观战中。
                  </div>
                )}
              </div>
            )}

            {/* 2. On Play decisions state */}
            {isPlayState && (
              <div className="space-y-4">
                {/* Active declaration in progress overlay details */}
                {room.activeDeclaration ? (
                  <div className="bg-white border-2 border-black p-4 text-left shadow-[3px_3px_0px_rgba(0,0,0,1)]">
                    <h3 className="font-extrabold uppercase tracking-widest text-[#ef4444] text-xs flex items-center gap-1.5 mb-2 animate-pulse">
                      <AlertCircle size={14} className="stroke-[3]" />
                      <span>{room.playerNames[room.players[activeDeclaringPlayer!]!] || '对手'} 宣告【共圆！】</span>
                    </h3>
                    <p className="text-[10px] text-neutral-500 leading-normal mb-3 font-mono">
                      对局计时已暂停。宣告方必须在棋盘上选择除最新落子外的另外 3 个子形成四点共圆。（不限颜色）
                    </p>

                    {activeDeclaringPlayer === myRole.color ? (
                      <div className="space-y-2">
                        <div className="text-[10px] font-mono font-extrabold uppercase bg-neutral-100 border-2 border-black p-2.5 flex justify-between items-center text-black">
                          <span>已选择另外的点数 SELECT:</span>
                          <span className="text-black text-xs font-black bg-white px-2 border border-black">{selectedDeclarationPoints.length} / 3</span>
                        </div>
                        <div className="flex gap-2">
                          <button
                            id="confirm-declare"
                            onClick={handleConfirmDeclaration}
                            disabled={selectedDeclarationPoints.length !== 3}
                            className="w-full bg-black text-white font-black hover:bg-neutral-800 py-3 text-[10px] uppercase tracking-widest border-2 border-black shadow-[2px_2px_0px_rgba(0,0,0,1)] active:shadow-none active:translate-x-0.5 active:translate-y-0.5 cursor-pointer disabled:opacity-40"
                          >
                            确认选择并比对
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="p-4 bg-white border-2 border-dashed border-black text-center text-[10px] uppercase text-black font-mono font-extrabold animate-pulse">
                        对手正在紧张研判共圆轨迹中，请稍候 ANALYSIS IN PROGRESS...
                      </div>
                    )}
                  </div>
                ) : (
                  // General play status turn indicators
                  <div>
                    {room.turn === myRole.color ? (
                      <div className="space-y-3">
                        <p className="text-[10px] font-extrabold uppercase tracking-wider text-black flex items-center justify-center gap-1.5 bg-neutral-100 py-2 border-2 border-black">
                          <Crown size={12} className="text-black animate-bounce stroke-[3]" />
                          <span>轮到你了！落子或发起共圆宣言 YOUR TURN</span>
                        </p>

                        {/* Declare Concyclic Trigger buttons */}
                        {lastMove && lastMove.player !== myRole.color && (
                          <button
                            id="declare-concyclic-trigger"
                            onClick={handleStartDeclaration}
                            disabled={stonesOnBoard.length < 4}
                            className="w-full py-3.5 bg-black hover:bg-neutral-800 text-white font-black border-2 border-black transition-all text-xs tracking-widest uppercase shadow-[3px_3px_0px_rgba(0,0,0,1)] active:shadow-none active:translate-x-0.5 active:translate-y-0.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            共圆！
                          </button>
                        )}
                      </div>
                    ) : (
                      <div>
                        <p className="text-[10px] font-mono font-extrabold uppercase bg-white border-2 border-black p-3 text-black animate-pulse tracking-wider">
                          对方思考中 THINKING... ({room.playerNames[room.players[room.turn]!] || '对手'}'s Turn)
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* 3. Finished victory reset widgets */}
            {isEndState && (
              <div className="space-y-4">
                <div className="bg-black text-white p-5 text-left border-2 border-black font-mono shadow-[4px_4px_0px_rgba(0,0,0,1)]">
                  <h3 className="font-black text-xs mb-2 text-center tracking-widest text-[#ef4444] uppercase">
                    🏆 胜负已分 GAME OVER
                  </h3>
                  <div className="text-center font-black text-xs text-white py-2 border-b border-white/20 mb-3 uppercase tracking-wider">
                    获胜者: {room.winner === 'black' ? '黑方 BLACK' : '白方 WHITE'} (
                    {getPlayerName(room.players[room.winner!])})
                  </div>
                  <p className="text-[10px] text-neutral-400 leading-normal uppercase">
                    REASON: {room.winnerReason || 'HEALTH EXHAUSTED.'}
                  </p>
                </div>

                {myRole.isPlayer ? (
                  <button
                    id="restart-game-trigger"
                    onClick={handleRestartNewGame}
                    className="w-full py-4.5 bg-black hover:bg-neutral-800 text-white font-black border-2 border-black transition-all text-xs tracking-widest uppercase shadow-[3px_3px_0px_rgba(0,0,0,1)] active:shadow-none active:translate-x-0.5 active:translate-y-0.5 cursor-pointer"
                  >
                    重新开始 NEW BATTLE
                  </button>
                ) : (
                  <p className="text-[10px] font-mono font-bold text-neutral-500 uppercase tracking-widest">观战已结束。可启用复盘研讨模式。</p>
                )}
              </div>
            )}
          </div>

          {/* Interactive Chat Lobby Channel */}
          <div className="border-2 border-black bg-white shadow-[4px_4px_0px_rgba(0,0,0,1)] flex flex-col h-[280px]">
            {/* Chat header */}
            <div className="px-4 py-3 border-b-2 border-black bg-neutral-50 flex items-center gap-2">
              <MessageSquare size={13} className="text-black stroke-[3]" />
              <span className="text-[10px] font-black uppercase tracking-widest text-black animate-pulse">实时对局聊天室 CHAT</span>
            </div>

            {/* Chats messages window */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2.5 text-xs text-neutral-800 font-sans">
              {messages.length === 0 ? (
                <div className="text-center text-neutral-400 italic py-12 font-mono text-[10px] uppercase">
                  聊天室空空如也 NO CHATS YET...
                </div>
              ) : (
                messages.map((msg) => {
                  const isSystemMsg = msg.senderId === 'system';
                  const roleBadge = msg.role === 'black' ? '⚫ 黑' : msg.role === 'white' ? '⚪ 白' : '👁 旁';

                  if (isSystemMsg) {
                    return (
                      <div key={msg.id} className="bg-neutral-50 border-2 border-black p-2 text-neutral-600 text-[10px] font-mono leading-relaxed">
                        🔊 {msg.text}
                      </div>
                    );
                  }

                  return (
                    <div
                      key={msg.id}
                      className={`flex flex-col ${msg.senderId === userId ? 'items-end' : 'items-start'}`}
                    >
                      <div className="flex items-center gap-1 mb-0.5 text-[9px] text-neutral-500 font-mono text-xs uppercase font-extrabold">
                        <span className={`px-1 border border-black text-[8px] leading-none ${
                          msg.role === 'black' ? 'bg-black text-white' : msg.role === 'white' ? 'bg-white text-black font-bold' : 'bg-neutral-200 text-neutral-500'
                        }`}>
                          {roleBadge}
                        </span>
                        <span className="text-neutral-600 truncate max-w-[80px]">
                          {msg.senderName}
                        </span>
                      </div>
                      <div className={`p-2.5 border-2 border-black text-xs font-sans font-semibold ${
                        msg.senderId === userId
                          ? 'bg-black text-white'
                          : 'bg-white text-black bg-neutral-50'
                      }`}>
                        {msg.text}
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input message form sender */}
            <form onSubmit={handleSendChat} className="border-t-2 border-black p-2 bg-neutral-50 flex gap-2">
              <input
                id="chat-message-input"
                type="text"
                placeholder="PROMPT MSG (例如: 承让，承让！)"
                className="flex-1 text-xs border-2 border-black bg-white px-3 py-2 outline-none font-bold placeholder:opacity-50"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                maxLength={45}
              />
              <button
                id="submit-chat-msg"
                type="submit"
                className="bg-black text-white hover:bg-neutral-800 p-2 border-2 border-black transition-all shadow-[2px_2px_0px_rgba(0,0,0,1)] active:shadow-none active:translate-x-0.5 active:translate-y-0.5 cursor-pointer flex items-center justify-center disabled:opacity-30"
                disabled={!chatInput.trim()}
              >
                <Send size={12} className="stroke-[3]" />
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
