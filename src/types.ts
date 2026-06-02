export type PlayerColor = 'black' | 'white';
export type PlayerRole = 'black' | 'white' | 'spectator';

export interface Point {
  x: number;
  y: number;
}

export interface Move {
  id: string;
  type: 'play' | 'declare_success' | 'declare_fail' | 'timeout';
  player: PlayerColor;
  x?: number; // for play
  y?: number; // for play
  selectedPoints?: Point[]; // the other 3 points for declaration
  retractedMoveIndex?: number; // the index of the move in moves[] that was retracted
  createdAt: number;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  role: PlayerRole;
  createdAt: number;
}

export interface ActiveDeclaration {
  player: PlayerColor;
  startedAt: number; // millisecond timestamp of click
  prevLastMoveTime: number; // to resume the clock correctly if fail
}

export interface Room {
  id: string;
  name: string;
  size: number; // board capacity, e.g., 9 for 9x13
  stepTime: number; // time limit per turn in seconds
  byoyomiTime: number; // total byoyomi budget pool in seconds
  totalLives: number; // matches allowed, default 3
  status: 'waiting' | 'playing' | 'finished';
  createdAt: number;
  players: {
    black: string | null; // UID or null
    white: string | null; // UID or null
  };
  playerNames: {
    [uid: string]: string; // nickname
  };
  playerReady: {
    black: boolean;
    white: boolean;
  };
  playerLives: {
    black: number;
    white: number;
  };
  playerByoyomi: {
    black: number;
    white: number;
  };
  turn: PlayerColor;
  winner: PlayerColor | null;
  lastMoveTime: number; // millisecond epoch of last stone placed or start time
  activeDeclaration: ActiveDeclaration | null;
  moves: Move[];
}

export interface ConcyclicGroup {
  points: Point[]; // 4 points
  type: 'circle' | 'line';
  center?: Point; // center on grid unit
  radius?: number; // radius in grid unit
}
