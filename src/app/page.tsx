"use client";

import { createClient, type RealtimeChannel } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef, useState } from "react";

type Suit = "man" | "pin" | "sou" | "honor";
type Tile = { id: string; suit: Suit; value: number; label: string };
type Role = "player" | "coach";
type MeldType = "chi" | "pon" | "daiminkan" | "ankan";

type Meld = {
  type: MeldType;
  tiles: Tile[];
  fromPlayer?: number;
};

type ClaimState = {
  tile: Tile;
  fromPlayer: number;
  canRon: boolean;
  canPon: boolean;
  canKan: boolean;
  canChi: boolean;
} | null;

type BoardState = {
  hands: Tile[][];
  discards: Tile[][];
  melds: Meld[][];
  riichi: boolean[];
  wall: Tile[];
  doraIndicator: Tile;
  turn: number;
  phase: "player" | "cpu" | "claim";
  gameMode: "READY" | "PLAYING";
  hostId: string | null;
  lastAction: string;
  isRiichiPending?: boolean;
  claimState?: ClaimState;
  winner?: { player: number; type: "ツモ" | "ロン"; tile: Tile } | null;
};

type ChatMessage = { id: string; role: Role; userName: string; text: string; time: string };

const ROOM = "mahjong-coaching-main";
const PLAYER_NAMES = ["自分", "下家", "対面", "上家"];
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

function createDeck() {
  let deck: Tile[] = [];
  const labels = ["一", "二", "三", "四", "五", "六", "七", "八", "九"];
  for (const suit of ["man", "pin", "sou"] as Suit[]) {
    for (let value = 1; value <= 9; value += 1) {
      for (let copy = 0; copy < 4; copy += 1) {
        deck = [
          ...deck,
          {
            id: `${suit}-${value}-${copy}`,
            suit,
            value,
            label: `${labels[value - 1]}${suit === "man" ? "萬" : suit === "pin" ? "筒" : "索"}`,
          },
        ];
      }
    }
  }
  ["東", "南", "西", "北", "白", "發", "中"].forEach((label, index) => {
    for (let copy = 0; copy < 4; copy += 1) {
      deck = [...deck, { id: `honor-${index}-${copy}`, suit: "honor", value: index + 1, label }];
    }
  });
  return deck.sort(() => Math.random() - 0.5);
}

function sortHand(hand: Tile[]) {
  const suitOrder: Record<Suit, number> = { man: 0, pin: 1, sou: 2, honor: 3 };
  return [...hand].sort(
    (left, right) => suitOrder[left.suit] - suitOrder[right.suit] || left.value - right.value
  );
}

// 副露（鳴き）を含めたシャンテン数計算
function getShantenText(hand: Tile[], melds: Meld[] = []): string {
  if (!hand) return "";
  const meldCount = melds.length;
  const counts = new Array(34).fill(0);
  const suitOffset: Record<Suit, number> = { man: 0, pin: 9, sou: 18, honor: 27 };

  hand.forEach((t) => {
    const idx = suitOffset[t.suit] + (t.value - 1);
    if (idx >= 0 && idx < 34) {
      counts[idx] = Math.min(4, counts[idx] + 1);
    }
  });

  let chiitoiShanten = 99;
  let kokushiShanten = 99;

  if (meldCount === 0) {
    const kokushiIndices = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];
    let kokushiKinds = 0;
    let kokushiHasPair = false;
    kokushiIndices.forEach((i) => {
      if (counts[i] > 0) {
        kokushiKinds++;
        if (counts[i] >= 2) kokushiHasPair = true;
      }
    });
    kokushiShanten = 13 - kokushiKinds - (kokushiHasPair ? 1 : 0);

    let pairs = 0;
    let kinds = 0;
    counts.forEach((c) => {
      if (c >= 2) pairs++;
      if (c >= 1) kinds++;
    });
    chiitoiShanten = 6 - pairs;
    if (kinds < 7) chiitoiShanten += 7 - kinds;
  }

  let minNormalShanten = 8;
  function backtrack(index: number, m: number, taatsu: number, head: boolean) {
    const totalMelds = m + meldCount;
    const currentShanten = 8 - (2 * totalMelds + taatsu + (head ? 1 : 0));
    if (currentShanten < minNormalShanten) minNormalShanten = currentShanten;

    while (index < 34 && counts[index] === 0) index++;
    if (index >= 34) return;

    if (!head && counts[index] >= 2) {
      counts[index] -= 2;
      backtrack(index, m, taatsu, true);
      counts[index] += 2;
    }

    if (counts[index] >= 3) {
      counts[index] -= 3;
      backtrack(index, m + 1, taatsu, head);
      counts[index] += 3;
    }

    if (index < 27 && index % 9 <= 6 && counts[index + 1] > 0 && counts[index + 2] > 0) {
      counts[index]--;
      counts[index + 1]--;
      counts[index + 2]--;
      backtrack(index, m + 1, taatsu, head);
      counts[index]++;
      counts[index + 1]++;
      counts[index + 2]++;
    }

    if (totalMelds + taatsu < 4) {
      if (counts[index] >= 2) {
        counts[index] -= 2;
        backtrack(index, m, taatsu + 1, head);
        counts[index] += 2;
      }
      if (index < 27 && index % 9 <= 7 && counts[index + 1] > 0) {
        counts[index]--;
        counts[index + 1]--;
        backtrack(index, m, taatsu + 1, head);
        counts[index]++;
        counts[index + 1]++;
      }
      if (index < 27 && index % 9 <= 6 && counts[index + 2] > 0) {
        counts[index]--;
        counts[index + 2]--;
        backtrack(index, m, taatsu + 1, head);
        counts[index]++;
        counts[index + 2]++;
      }
    }
    backtrack(index + 1, m, taatsu, head);
  }

  backtrack(0, 0, 0, false);
  const minShanten = Math.min(minNormalShanten, chiitoiShanten, kokushiShanten);

  if (minShanten <= -1) return "和了";
  if (minShanten === 0) return "聴牌";
  return `${minShanten}向聴`;
}

function getShantenValue(hand: Tile[], melds: Meld[] = []): number {
  const text = getShantenText(hand, melds);
  if (text === "和了") return -1;
  if (text === "聴牌") return 0;
  const match = text.match(/(\d+)向聴/);
  return match ? parseInt(match[1], 10) : 8;
}

function canRiichi(hand: Tile[], melds: Meld[] = []): boolean {
  if (melds.length > 0 || hand.length !== 14) return false;
  return hand.some((_, index) => {
    const testHand = hand.filter((_, i) => i !== index);
    return getShantenValue(testHand, melds) === 0;
  });
}

function canPon(hand: Tile[], tile: Tile): boolean {
  return hand.filter((t) => t.suit === tile.suit && t.value === tile.value).length >= 2;
}

function canDaiminkan(hand: Tile[], tile: Tile): boolean {
  return hand.filter((t) => t.suit === tile.suit && t.value === tile.value).length === 3;
}

function canChi(hand: Tile[], tile: Tile, fromPlayer: number, currentPlayer: number): boolean {
  if ((currentPlayer + 3) % 4 !== fromPlayer || tile.suit === "honor") return false;
  const vals = hand.filter((t) => t.suit === tile.suit).map((t) => t.value);
  const v = tile.value;
  return (
    (vals.includes(v - 2) && vals.includes(v - 1)) ||
    (vals.includes(v - 1) && vals.includes(v + 1)) ||
    (vals.includes(v + 1) && vals.includes(v + 2))
  );
}

function getBestDiscardIndex(hand: Tile[]) {
  const tileCount = (tile: Tile) =>
    hand.filter((candidate) => candidate.suit === tile.suit && candidate.value === tile.value).length;
  const connectedCount = (tile: Tile) =>
    tile.suit === "honor"
      ? 0
      : hand.filter(
          (candidate) =>
            candidate.suit === tile.suit &&
            candidate.value !== tile.value &&
            Math.abs(candidate.value - tile.value) <= 2
        ).length;
  const discardScore = (tile: Tile) => {
    const count = tileCount(tile);
    const connected = connectedCount(tile);
    if (count > 1) return -100 + count;
    if (tile.suit === "honor") return tile.value <= 4 ? 600 : 500;
    if (connected > 0) return -200 - connected;
    if (tile.value === 1 || tile.value === 9) return 400;
    if (tile.value === 2 || tile.value === 8) return 300;
    return 200;
  };
  return hand.reduce(
    (bestIndex, tile, index) => (discardScore(tile) > discardScore(hand[bestIndex]) ? index : bestIndex),
    0
  );
}

function newBoard(hostId: string | null = null): BoardState {
  const deck = createDeck();
  const doraIndicator = deck.splice(Math.floor(Math.random() * deck.length), 1)[0];
  const hands = [[], [], [], []] as Tile[][];
  for (let round = 0; round < 13; round += 1) {
    for (let index = 0; index < hands.length; index += 1) {
      const tile = deck.pop();
      if (tile) hands[index] = [...hands[index], tile];
    }
  }
  const firstDraw = deck.pop();
  if (firstDraw) hands[0] = [...hands[0], firstDraw];
  hands[0] = sortHand(hands[0]);
  return {
    hands,
    discards: [[], [], [], []],
    melds: [[], [], [], []],
    riichi: [false, false, false, false],
    wall: deck,
    doraIndicator,
    turn: 0,
    phase: "player",
    gameMode: hostId ? "PLAYING" : "READY",
    hostId,
    lastAction: "東家の配牌が完了しました",
    isRiichiPending: false,
    claimState: null,
    winner: null,
  };
}

function normalizeBoard(payload: Partial<BoardState>): BoardState {
  return {
    hands: Array.from({ length: 4 }, (_, i) => payload.hands?.[i] ?? []),
    discards: Array.from({ length: 4 }, (_, i) => payload.discards?.[i] ?? []),
    melds: Array.from({ length: 4 }, (_, i) => payload.melds?.[i] ?? []),
    riichi: payload.riichi ?? [false, false, false, false],
    wall: payload.wall ?? [],
    doraIndicator: payload.doraIndicator ?? { id: "dora", suit: "honor", value: 5, label: "白" },
    turn: payload.turn ?? 0,
    phase: payload.phase ?? "player",
    gameMode: payload.gameMode === "PLAYING" ? "PLAYING" : "READY",
    hostId: payload.hostId ?? null,
    lastAction: payload.lastAction ?? "同期しました",
    isRiichiPending: payload.isRiichiPending ?? false,
    claimState: payload.claimState ?? null,
    winner: payload.winner ?? null,
  };
}

function getTileImagePath(tile: Tile): string[] {
  if (tile.suit === "man") return [`/tiles/Man${tile.value}.svg`];
  if (tile.suit === "pin") return [`/tiles/Pin${tile.value}.svg`];
  if (tile.suit === "sou") return [`/tiles/Sou${tile.value}.svg`];

  const honorNames: Record<number, string[]> = {
    1: ["Ton.svg", "ton.svg", "1.svg"],
    2: ["Nan.svg", "nan.svg", "2.svg"],
    3: ["Sha.svg", "Sya.svg", "West.svg", "Nishi.svg", "sha.svg", "3.svg"],
    4: ["Pei.svg", "pei.svg", "North.svg", "4.svg"],
    5: ["Haku.svg", "haku.svg", "5.svg"],
    6: ["Hatsu.svg", "hatsu.svg", "6.svg"],
    7: ["Chun.svg", "chun.svg", "7.svg"],
  };

  const candidates = honorNames[tile.value] || ["Haku.svg"];
  return candidates.map((name) => `/tiles/${name}`);
}

function TileCard({
  tile,
  onClick,
  disabled,
  className = "",
}: {
  tile: Tile;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  const candidatePaths = getTileImagePath(tile);
  const [pathIndex, setPathIndex] = useState(0);
  const [hasError, setHasError] = useState(false);

  const handleImageError = () => {
    if (pathIndex + 1 < candidatePaths.length) {
      setPathIndex((prev) => prev + 1);
    } else {
      setHasError(true);
    }
  };

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`relative inline-flex aspect-[3/4] h-auto w-[calc((100vw-36px)/15)] max-w-[30px] sm:h-12 sm:w-9 sm:max-w-[36px] shrink-0 items-center justify-center rounded bg-amber-50 p-0.5 shadow-md transition-all select-none border border-amber-200/50 ${
        disabled
          ? "cursor-default opacity-95"
          : "hover:-translate-y-1 hover:brightness-105 active:translate-y-0 cursor-pointer"
      } ${className}`}
      aria-label={tile.label}
    >
      {!hasError ? (
        <img
          src={candidatePaths[pathIndex]}
          alt={tile.label}
          onError={handleImageError}
          className="h-full w-full object-contain drop-shadow pointer-events-none"
          loading="eager"
        />
      ) : (
        <span className="flex h-full w-full items-center justify-center font-black text-slate-800 text-[10px] sm:text-sm leading-none">
          {tile.label}
        </span>
      )}
    </button>
  );
}

// 河（1行6枚固定：6列グリッドで確実に自動改行）
function RiverRow({
  label,
  tiles,
  isRiichi,
}: {
  label: string;
  tiles: Tile[];
  isRiichi?: boolean;
}) {
  return (
    <div className="river-row flex items-start gap-1.5 sm:gap-2 py-1.5 border-b border-emerald-800/40 last:border-b-0">
      <div className="flex flex-col items-center gap-0.5 pt-0.5 w-10 sm:w-12 shrink-0">
        <span className="flex h-6 w-10 sm:h-7 sm:w-12 shrink-0 items-center justify-center text-center text-[11px] sm:text-xs font-bold text-white bg-emerald-950/80 rounded border border-emerald-700/60 shadow-inner">
          {label}
        </span>
        {isRiichi && (
          <span className="text-[8px] sm:text-[9px] bg-rose-600 font-bold px-1 rounded text-white shadow">
            立直
          </span>
        )}
      </div>
      <div className="river-tiles grid grid-cols-6 gap-0.5 sm:gap-1 items-center min-h-[28px] pt-0.5">
        {tiles.map((tile) => (
          <TileCard
            key={tile.id}
            tile={tile}
            disabled
            className="!h-7 !w-[22px] max-w-none sm:!h-9 sm:!w-[28px] !rounded-sm !p-0"
          />
        ))}
      </div>
    </div>
  );
}

function formatTime() {
  return new Date().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
}

export default function Home() {
  const [isMounted, setIsMounted] = useState(false);
  const [board, setBoard] = useState<BoardState | null>(null);
  const [history, setHistory] = useState<BoardState[]>([]); // アクションUndo（待った）履歴
  const [role, setRole] = useState<Role>("player");
  const [userName, setUserName] = useState("プレイヤー"); // チャットの送信者名設定
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatText, setChatText] = useState("");
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [connection, setConnection] = useState(supabase ? "接続準備中" : "ローカル対局");
  const [isHost, setIsHost] = useState(!supabase);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const roleRef = useRef(role);
  const boardRef = useRef<BoardState | null>(null);
  const isHostRef = useRef(!supabase);
  const clientIdRef = useRef("");

  useEffect(() => {
    clientIdRef.current = crypto.randomUUID();
    setIsMounted(true);
    setBoard(newBoard(supabase ? null : "local-host"));
  }, []);
  useEffect(() => {
    roleRef.current = role;
  }, [role]);
  useEffect(() => {
    boardRef.current = board;
  }, [board]);
  useEffect(() => {
    isHostRef.current = isHost;
  }, [isHost]);

  const broadcast = useCallback((next: BoardState) => {
    void channelRef.current?.send({ type: "broadcast", event: "board", payload: next });
  }, []);

  useEffect(() => {
    if (!isMounted || !supabase) return;
    const channel = supabase.channel(ROOM);
    channelRef.current = channel;
    channel.on("broadcast", { event: "board" }, ({ payload }) => {
      const nextBoard = normalizeBoard(payload as Partial<BoardState>);
      setBoard(nextBoard);
      boardRef.current = nextBoard;
      setIsHost(nextBoard.hostId === clientIdRef.current);
    });
    channel.on("broadcast", { event: "request-board" }, () => {
      void channel.send({ type: "broadcast", event: "board", payload: boardRef.current });
    });
    channel.on("broadcast", { event: "chat" }, ({ payload }) =>
      setMessages((current) => [...current.slice(-29), payload as ChatMessage])
    );
    void channel.subscribe((status) => {
      setConnection(status === "SUBSCRIBED" ? "Realtime 接続中" : `接続: ${status}`);
      if (status === "SUBSCRIBED") void channel.send({ type: "broadcast", event: "request-board", payload: {} });
    });
    return () => {
      void supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [isMounted]);

  // アクションを1手戻す（Undo機能）
  const handleUndo = () => {
    if (history.length === 0) return;
    const previousState = history[history.length - 1];
    setHistory((prev) => prev.slice(0, -1));
    setBoard(previousState);
    broadcast(previousState);
  };

  // CPU打牌処理
  const processCpuTurn = useCallback(() => {
    if (!isHostRef.current || roleRef.current !== "player" || board?.gameMode !== "PLAYING") return;
    if (board?.phase !== "cpu" || board?.winner) return;

    const currentTurn = board.turn;
    if (currentTurn < 1 || currentTurn > 3) return;

    const hands = board.hands.map((h) => [...h]);
    const discards = board.discards.map((d) => [...d]);
    const wall = board.wall.slice(1);
    const drawnTile = board.wall[0];

    if (!drawnTile) {
      const next = { ...board, lastAction: "流局しました" };
      setBoard(next);
      broadcast(next);
      return;
    }

    hands[currentTurn] = [...hands[currentTurn], drawnTile];

    // CPUのツモ和了チェック
    if (getShantenValue(hands[currentTurn], board.melds[currentTurn]) === -1) {
      const next: BoardState = {
        ...board,
        hands,
        wall,
        winner: { player: currentTurn, type: "ツモ", tile: drawnTile },
        lastAction: `${PLAYER_NAMES[currentTurn]}がツモ和了！`,
      };
      setBoard(next);
      broadcast(next);
      return;
    }

    const discardIndex = getBestDiscardIndex(hands[currentTurn]);
    const discarded = hands[currentTurn][discardIndex];

    if (discarded) {
      hands[currentTurn] = sortHand([
        ...hands[currentTurn].slice(0, discardIndex),
        ...hands[currentTurn].slice(discardIndex + 1),
      ]);
      discards[currentTurn] = [...discards[currentTurn], discarded];
    }

    // プレイヤーへの割り込み（ロン・ポン・チー・カン）判定
    const playerHand = hands[0];
    const playerMelds = board.melds[0];
    const canRonResult = getShantenValue([...playerHand, discarded], playerMelds) === -1;
    const canPonResult = canPon(playerHand, discarded);
    const canKanResult = canDaiminkan(playerHand, discarded);
    const canChiResult = canChi(playerHand, discarded, currentTurn, 0);

    if (canRonResult || canPonResult || canKanResult || canChiResult) {
      const next: BoardState = {
        ...board,
        hands,
        discards,
        wall,
        phase: "claim",
        claimState: {
          tile: discarded,
          fromPlayer: currentTurn,
          canRon: canRonResult,
          canPon: canPonResult,
          canKan: canKanResult,
          canChi: canChiResult,
        },
        lastAction: `${PLAYER_NAMES[currentTurn]}が${discarded.label}を打牌 (${
          canRonResult ? "ロン可能！" : "鳴き可能"
        })`,
      };
      setBoard(next);
      broadcast(next);
      return;
    }

    // 次のターンへ進行
    const nextTurn = currentTurn + 1;
    if (nextTurn <= 3) {
      const next: BoardState = {
        ...board,
        hands,
        discards,
        wall,
        turn: nextTurn,
        lastAction: `${PLAYER_NAMES[currentTurn]}が${discarded.label}を打牌`,
      };
      setBoard(next);
      broadcast(next);
    } else {
      const playerDraw = wall[0];
      const nextWall = wall.slice(1);
      if (playerDraw) {
        hands[0] = [...hands[0], playerDraw];
      }

      const next: BoardState = {
        ...board,
        hands,
        discards,
        wall: nextWall,
        phase: "player",
        turn: 0,
        lastAction: "あなたのツモ番です",
      };
      setBoard(next);
      broadcast(next);
    }
  }, [board, broadcast]);

  useEffect(() => {
    if (board?.phase === "cpu") {
      const timer = setTimeout(processCpuTurn, 400);
      return () => clearTimeout(timer);
    }
  }, [board?.phase, board?.turn, processCpuTurn]);

  // リーチ時の自動ツモ切り
  useEffect(() => {
    if (
      board?.phase === "player" &&
      board.turn === 0 &&
      board.riichi[0] &&
      !board.winner &&
      board.gameMode === "PLAYING"
    ) {
      const currentHand = board.hands[0];
      if (getShantenValue(currentHand, board.melds[0]) !== -1) {
        const timer = setTimeout(() => {
          discard(currentHand.length - 1);
        }, 700);
        return () => clearTimeout(timer);
      }
    }
  }, [board?.phase, board?.turn, board?.riichi]);

  // 打牌アクション（Undo用に現在の盤面をスタックに保存）
  const discard = (index: number) => {
    if (
      !board ||
      !isHostRef.current ||
      roleRef.current !== "player" ||
      board.gameMode !== "PLAYING" ||
      board.phase !== "player" ||
      board.turn !== 0
    )
      return;

    // 現在の盤面を履歴に保存
    setHistory((prev) => [...prev, board]);

    const hands = board.hands.map((h) => [...h]);
    const discards = board.discards.map((d) => [...d]);
    const discarded = hands[0].splice(index, 1)[0];
    if (!discarded) return;

    hands[0] = sortHand(hands[0]);
    discards[0] = [...discards[0], discarded];

    const riichi = [...board.riichi];
    if (board.isRiichiPending) {
      riichi[0] = true;
    }

    const next: BoardState = {
      ...board,
      hands,
      discards,
      riichi,
      isRiichiPending: false,
      turn: 1,
      phase: "cpu",
      lastAction: board.isRiichiPending
        ? `あなたがリーチ！(${discarded.label}を打牌)`
        : `あなたが${discarded.label}を打牌`,
    };
    setBoard(next);
    broadcast(next);
  };

  const handlePass = () => {
    if (!board || !board.claimState) return;
    setHistory((prev) => [...prev, board]);

    const nextTurn = board.claimState.fromPlayer + 1;
    const hands = board.hands.map((h) => [...h]);
    const wall = board.wall.slice(1);

    if (nextTurn <= 3) {
      const next: BoardState = {
        ...board,
        phase: "cpu",
        turn: nextTurn,
        claimState: null,
        lastAction: "スルーしました",
      };
      setBoard(next);
      broadcast(next);
    } else {
      const playerDraw = wall[0];
      if (playerDraw) {
        hands[0] = [...hands[0], playerDraw];
      }
      const next: BoardState = {
        ...board,
        hands,
        wall,
        phase: "player",
        turn: 0,
        claimState: null,
        lastAction: "スルーしました。あなたのツモ番です",
      };
      setBoard(next);
      broadcast(next);
    }
  };

  const handleRon = () => {
    if (!board || !board.claimState) return;
    setHistory((prev) => [...prev, board]);

    const next: BoardState = {
      ...board,
      winner: { player: 0, type: "ロン", tile: board.claimState.tile },
      claimState: null,
      lastAction: "ロン和了！おめでとうございます！",
    };
    setBoard(next);
    broadcast(next);
  };

  const handleTsumo = () => {
    if (!board) return;
    setHistory((prev) => [...prev, board]);

    const next: BoardState = {
      ...board,
      winner: { player: 0, type: "ツモ", tile: board.hands[0][board.hands[0].length - 1] },
      lastAction: "ツモ和了！おめでとうございます！",
    };
    setBoard(next);
    broadcast(next);
  };

  const handlePon = () => {
    if (!board || !board.claimState) return;
    setHistory((prev) => [...prev, board]);

    const targetTile = board.claimState.tile;
    const hand = [...board.hands[0]];

    let removed = 0;
    const newHand = hand.filter((t) => {
      if (removed < 2 && t.suit === targetTile.suit && t.value === targetTile.value) {
        removed++;
        return false;
      }
      return true;
    });

    const melds = board.melds.map((m) => [...m]);
    melds[0].push({
      type: "pon",
      tiles: [targetTile, targetTile, targetTile],
      fromPlayer: board.claimState.fromPlayer,
    });

    const next: BoardState = {
      ...board,
      hands: board.hands.map((h, i) => (i === 0 ? sortHand(newHand) : h)),
      melds,
      turn: 0,
      phase: "player",
      claimState: null,
      lastAction: `ポンして${targetTile.label}を鳴きました`,
    };
    setBoard(next);
    broadcast(next);
  };

  const handleChi = () => {
    if (!board || !board.claimState) return;
    setHistory((prev) => [...prev, board]);

    const targetTile = board.claimState.tile;
    const hand = [...board.hands[0]];
    const v = targetTile.value;

    let c1 = hand.find((t) => t.suit === targetTile.suit && t.value === v - 2);
    let c2 = hand.find((t) => t.suit === targetTile.suit && t.value === v - 1);
    if (!c1 || !c2) {
      c1 = hand.find((t) => t.suit === targetTile.suit && t.value === v - 1);
      c2 = hand.find((t) => t.suit === targetTile.suit && t.value === v + 1);
    }
    if (!c1 || !c2) {
      c1 = hand.find((t) => t.suit === targetTile.suit && t.value === v + 1);
      c2 = hand.find((t) => t.suit === targetTile.suit && t.value === v + 2);
    }

    if (!c1 || !c2) return;

    const newHand = hand.filter((t) => t.id !== c1.id && t.id !== c2.id);
    const melds = board.melds.map((m) => [...m]);
    melds[0].push({
      type: "chi",
      tiles: sortHand([targetTile, c1, c2]),
      fromPlayer: board.claimState.fromPlayer,
    });

    const next: BoardState = {
      ...board,
      hands: board.hands.map((h, i) => (i === 0 ? sortHand(newHand) : h)),
      melds,
      turn: 0,
      phase: "player",
      claimState: null,
      lastAction: `チーして${targetTile.label}を鳴きました`,
    };
    setBoard(next);
    broadcast(next);
  };

  const reset = () => {
    if (supabase && board?.gameMode === "PLAYING" && !isHostRef.current) return;
    const next = newBoard(clientIdRef.current || "local-host");
    setIsHost(true);
    setHistory([]);
    setBoard(next);
    broadcast(next);
  };

  const forceReset = () => {
    isHostRef.current = true;
    setIsHost(true);
    const next = newBoard(clientIdRef.current || "local-host");
    setHistory([]);
    setBoard(next);
    broadcast(next);
  };

  const sendChat = (event: React.FormEvent) => {
    event.preventDefault();
    const text = chatText.trim();
    if (!text) return;
    const displayName = userName.trim() || (role === "coach" ? "指導者" : "打者");
    const message: ChatMessage = {
      id: crypto.randomUUID(),
      role,
      userName: displayName,
      text,
      time: formatTime(),
    };
    setMessages((current) => [...current.slice(-29), message]);
    void channelRef.current?.send({ type: "broadcast", event: "chat", payload: message });
    setChatText("");
  };

  if (!isMounted || !board)
    return (
      <main className="flex min-h-screen items-center justify-center bg-emerald-950 text-sm font-bold text-white">
        対局を準備しています...
      </main>
    );

  return (
    <main className="min-h-screen bg-emerald-950 text-white">
      <header className="border-b border-emerald-800 bg-emerald-900/90 px-4 py-4 shadow-md backdrop-blur sm:px-8">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-300">MAHJONG COACHING ROOM</p>
            <h1 className="mt-1 text-2xl font-black tracking-tight text-white sm:text-3xl">東一局 / 指導対局</h1>
          </div>
          <div className="text-right">
            <p className="text-xs font-semibold text-emerald-100">{connection}</p>
            <p className="mt-1 text-sm font-bold text-white">残り {board.wall.length} 枚</p>
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-3 px-2 py-3 pb-48 sm:px-8 sm:py-4 md:pb-0">
        <div className="flex w-full flex-col items-stretch gap-3 md:flex-row md:items-start md:gap-4">
          <section className="relative z-10 w-full min-w-0 flex-1 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-bold text-white">{board.lastAction}</p>
                <p className="text-xs text-emerald-100 font-medium">
                  {board.winner
                    ? "対局終了"
                    : board.phase === "claim"
                    ? "選択待ち"
                    : board.phase === "player"
                    ? "手牌から捨てる牌を選択"
                    : "CPUが順番に打牌中..."}
                </p>
              </div>
              <div className="relative z-10 flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setRole("player")}
                  className={`px-3 py-1.5 rounded text-xs font-bold transition-all ${
                    role === "player" ? "bg-amber-600 text-white shadow" : "bg-emerald-800 text-white hover:bg-emerald-700"
                  }`}
                >
                  打者
                </button>
                <button
                  type="button"
                  onClick={() => setRole("coach")}
                  className={`px-3 py-1.5 rounded text-xs font-bold transition-all ${
                    role === "coach" ? "bg-amber-600 text-white shadow" : "bg-emerald-800 text-white hover:bg-emerald-700"
                  }`}
                >
                  指導者
                </button>

                {/* 1手戻す（Undo）ボタン */}
                <button
                  type="button"
                  onClick={handleUndo}
                  disabled={history.length === 0}
                  className={`px-3 py-1.5 rounded text-xs font-bold text-white shadow border transition-all ${
                    history.length > 0
                      ? "bg-amber-500 hover:bg-amber-400 border-amber-300"
                      : "bg-gray-700 opacity-50 cursor-not-allowed border-gray-600"
                  }`}
                >
                  ↩ 1手戻す
                </button>

                <button
                  type="button"
                  onClick={reset}
                  disabled={supabase !== null && board.gameMode === "PLAYING" && !isHost}
                  className="px-3 py-1.5 rounded bg-emerald-700 text-xs font-bold text-white hover:bg-emerald-600 shadow border border-emerald-500/40"
                >
                  {board.gameMode === "READY" ? "対局開始" : "新しい局"}
                </button>
                <button
                  type="button"
                  onClick={forceReset}
                  className="px-3 py-1.5 rounded bg-rose-700 text-xs font-bold text-white hover:bg-rose-600 shadow"
                >
                  強制リセット
                </button>
              </div>
            </div>

            <div className="bg-emerald-900/80 border border-emerald-700/80 rounded-lg p-3 sm:p-4 shadow-xl backdrop-blur-sm">
              <div className="space-y-1">
                <div className="flex items-center justify-between mb-1">
                  <h2 className="text-white font-black text-base tracking-wide">河</h2>
                </div>
                <div>
                  {PLAYER_NAMES.map((playerName, playerIndex) => (
                    <RiverRow
                      key={playerName}
                      label={playerName}
                      tiles={board.discards[playerIndex] ?? []}
                      isRiichi={board.riichi[playerIndex]}
                    />
                  ))}
                </div>
              </div>
              <div className="mt-3 flex items-center gap-3 border-t border-emerald-800/80 pt-3 text-xs font-bold text-white">
                <span>山</span>
                <div className="h-2 flex-1 rounded-full bg-emerald-950">
                  <div
                    className="h-full rounded-full bg-emerald-400 transition-all shadow-sm"
                    style={{ width: `${(board.wall.length / 82) * 100}%` }}
                  />
                </div>
                <span className="ml-2 whitespace-nowrap">ドラ</span>
                <TileCard tile={board.doraIndicator} disabled className="!h-8 !w-6 sm:!h-10 sm:!w-7" />
              </div>
            </div>
          </section>

          {/* 指導チャット（名前設定機能つき） */}
          <aside className="relative z-10 flex flex-col h-[220px] w-full shrink-0 rounded-lg border border-emerald-700/80 bg-emerald-900/80 p-3 shadow-xl backdrop-blur-sm md:sticky md:top-4 md:h-[450px] md:w-80">
            <div className="flex flex-col gap-2 border-b border-emerald-800/80 pb-2">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-white font-black text-base">指導チャット</h2>
                  <p className="text-xs text-emerald-100 font-medium">全端末にリアルタイム同期</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsChatOpen(true)}
                    className="text-xs bg-emerald-800 px-2 py-1 rounded text-white font-bold md:hidden"
                  >
                    履歴
                  </button>
                  <span className="rounded bg-rose-600 px-1.5 py-0.5 text-[10px] font-black text-white uppercase tracking-wider">
                    LIVE
                  </span>
                </div>
              </div>

              {/* チャット送信名設定欄 */}
              <div className="flex items-center gap-2 pt-1">
                <label className="text-[11px] font-bold text-emerald-200 shrink-0">表示名:</label>
                <input
                  type="text"
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                  placeholder="名前を入力"
                  maxLength={10}
                  className="w-full rounded bg-emerald-950 px-2 py-1 text-xs text-white placeholder-emerald-100/50 border border-emerald-700 focus:outline-none focus:border-amber-400 font-bold"
                />
              </div>
            </div>

            <div className="flex-1 flex flex-col gap-2 overflow-y-auto py-2">
              {messages.length === 0 ? (
                <p className="m-auto text-center text-xs font-medium text-emerald-100">
                  牌譜を見ながら会話できます
                </p>
              ) : (
                messages.map((message) => (
                  <div
                    key={message.id}
                    className={`p-2 rounded bg-emerald-950/90 border border-emerald-800 ${
                      message.role === role ? "border-amber-400/80 bg-emerald-950" : ""
                    }`}
                  >
                    <div className="flex justify-between gap-2 text-[11px] font-bold text-emerald-200">
                      <span>{message.userName || (message.role === "coach" ? "指導者" : "打者")}</span>
                      <time className="text-emerald-100">{message.time}</time>
                    </div>
                    <p className="mt-1 text-sm font-medium text-white">{message.text}</p>
                  </div>
                ))
              )}
            </div>
            <form onSubmit={sendChat} className="mt-auto hidden gap-2 border-t border-emerald-800/80 pt-2 md:flex">
              <input
                value={chatText}
                onChange={(event) => setChatText(event.target.value)}
                placeholder="メッセージを入力"
                className="flex-1 rounded bg-emerald-950 px-3 py-1.5 text-sm text-white placeholder-emerald-100/60 border border-emerald-700 focus:outline-none focus:border-amber-400"
              />
              <button
                type="submit"
                className="rounded bg-amber-600 px-3 py-1.5 text-sm font-bold text-white hover:bg-amber-500 shadow"
                aria-label="送信"
              >
                送信
              </button>
            </form>
          </aside>
        </div>

        {/* 手牌＆アクションボタンエリア */}
        <div className="fixed inset-x-0 bottom-0 z-50 w-full max-w-full overflow-hidden rounded-none border-x-0 border-t border-emerald-700/80 bg-emerald-900/95 p-1.5 sm:p-3 shadow-2xl backdrop-blur-md md:static md:z-10 md:rounded-lg md:border">
          {/* アクションボタンバー */}
          <div className="flex items-center justify-between mb-1.5 sm:mb-2">
            <div className="flex items-center gap-2">
              <h2 className="text-white font-black text-sm sm:text-base">あなたの手牌</h2>
              <span className="rounded bg-amber-500/20 px-2 py-0.5 text-xs font-bold text-white border border-amber-400/50">
                {getShantenText(board.hands[0], board.melds[0])}
              </span>
            </div>

            {/* ロン・ツモ・鳴き・リーチ・Undo ボタン表示エリア */}
            <div className="flex items-center gap-1.5">
              {board.phase === "claim" && board.claimState && (
                <>
                  {board.claimState.canRon ? (
                    <button
                      type="button"
                      onClick={handleRon}
                      className="px-3 py-1 rounded bg-rose-600 text-xs font-black text-white hover:bg-rose-500 shadow animate-bounce"
                    >
                      ロン
                    </button>
                  ) : (
                    <>
                      {board.claimState.canPon && (
                        <button
                          type="button"
                          onClick={handlePon}
                          className="px-3 py-1 rounded bg-amber-500 text-xs font-black text-white hover:bg-amber-400 shadow"
                        >
                          ポン
                        </button>
                      )}
                      {board.claimState.canChi && (
                        <button
                          type="button"
                          onClick={handleChi}
                          className="px-3 py-1 rounded bg-blue-600 text-xs font-black text-white hover:bg-blue-500 shadow"
                        >
                          チー
                        </button>
                      )}
                    </>
                  )}
                  <button
                    type="button"
                    onClick={handlePass}
                    className="px-3 py-1 rounded bg-slate-600 text-xs font-bold text-white hover:bg-slate-500 shadow"
                  >
                    パス
                  </button>
                </>
              )}

              {board.phase === "player" &&
                getShantenValue(board.hands[0], board.melds[0]) === -1 &&
                !board.winner && (
                  <button
                    type="button"
                    onClick={handleTsumo}
                    className="px-3 py-1 rounded bg-rose-600 text-xs font-black text-white hover:bg-rose-500 shadow animate-bounce"
                  >
                    ツモ
                  </button>
                )}

              {board.phase === "player" &&
                !board.riichi[0] &&
                canRiichi(board.hands[0], board.melds[0]) && (
                  <button
                    type="button"
                    onClick={() => setBoard((prev) => (prev ? { ...prev, isRiichiPending: true } : prev))}
                    className={`px-3 py-1 rounded text-xs font-black shadow transition-all ${
                      board.isRiichiPending
                        ? "bg-rose-500 text-white animate-pulse"
                        : "bg-amber-500 text-white hover:bg-amber-400"
                    }`}
                  >
                    {board.isRiichiPending ? "切る牌を選択" : "リーチ"}
                  </button>
                )}

              <span
                className={`px-2.5 py-1 rounded text-xs font-bold shadow ${
                  board.winner
                    ? "bg-rose-600 text-white"
                    : board.phase === "player" && role === "player"
                    ? "bg-amber-500 text-white animate-pulse"
                    : "bg-emerald-950 text-emerald-100"
                }`}
              >
                {board.winner
                  ? `${PLAYER_NAMES[board.winner.player]}の${board.winner.type}`
                  : role === "coach"
                  ? "観戦中"
                  : board.phase === "player"
                  ? "あなたの番"
                  : "待機中"}
              </span>
            </div>
          </div>

          {/* 手牌一覧 ＋ 右端に副露（鳴き牌：超コンパクト表示） */}
          <div className="flex w-full items-center justify-between gap-1 sm:gap-2 px-1 py-1 overflow-x-auto">
            {/* 自分の純手牌 */}
            <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">
              {board.hands[0].map((tile, index) => (
                <TileCard
                  key={tile.id}
                  tile={tile}
                  onClick={() => discard(index)}
                  disabled={
                    !isHost ||
                    role !== "player" ||
                    board.gameMode !== "PLAYING" ||
                    board.phase !== "player" ||
                    board.turn !== 0 ||
                    board.winner !== null
                  }
                  className={`hand-tile ${
                    board.hands[0].length % 3 === 2 && index === board.hands[0].length - 1
                      ? "ml-1 sm:ml-2"
                      : ""
                  }`}
                />
              ))}
            </div>

            {/* 自分の鳴いた牌（ポン・チー：超コンパクト表示） */}
            {board.melds[0].length > 0 && (
              <div className="flex items-center gap-1 sm:gap-1.5 border-l border-emerald-700/80 pl-1 sm:pl-2 shrink-0">
                {board.melds[0].map((meld, idx) => (
                  <div key={idx} className="flex gap-0.5 bg-emerald-950/80 p-0.5 rounded border border-emerald-800/80">
                    {meld.tiles.map((t) => (
                      <TileCard
                        key={t.id}
                        tile={t}
                        disabled
                        className="!h-6 !w-[16px] sm:!h-8 sm:!w-[22px] !rounded-none !p-0"
                      />
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>

          <form onSubmit={sendChat} className="mt-2 flex gap-2 border-t border-emerald-800/80 pt-2 md:hidden">
            <input
              value={chatText}
              onChange={(event) => setChatText(event.target.value)}
              placeholder="メッセージを入力"
              className="flex-1 rounded bg-emerald-950 px-3 py-1.5 text-sm text-white placeholder-emerald-100/60 border border-emerald-700"
            />
            <button
              type="submit"
              className="rounded bg-amber-600 px-3 py-1.5 text-sm font-bold text-white"
              aria-label="送信"
            >
              送信
            </button>
          </form>
        </div>

        {/* スマホ用チャットモーダル */}
        {isChatOpen && (
          <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 md:hidden backdrop-blur-sm">
            <div className="w-full max-h-[80vh] rounded-t-xl bg-emerald-900 p-4 border-t border-emerald-700">
              <div className="flex items-center justify-between border-b border-emerald-800 pb-3">
                <h2 className="text-white font-black text-base">指導チャットの履歴</h2>
                <button
                  type="button"
                  onClick={() => setIsChatOpen(false)}
                  className="text-xs font-bold text-emerald-100 bg-emerald-800 px-3 py-1 rounded"
                >
                  閉じる
                </button>
              </div>

              <div className="flex items-center gap-2 my-2">
                <label className="text-xs font-bold text-emerald-200 shrink-0">表示名:</label>
                <input
                  type="text"
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                  placeholder="名前を入力"
                  className="w-full rounded bg-emerald-950 px-2 py-1 text-xs text-white border border-emerald-700"
                />
              </div>

              <div className="mt-2 flex flex-col gap-2 overflow-y-auto max-h-[50vh]">
                {messages.length === 0 ? (
                  <p className="py-8 text-center text-xs font-medium text-emerald-100">
                    まだメッセージはありません
                  </p>
                ) : (
                  messages.map((message) => (
                    <div
                      key={message.id}
                      className={`p-2 rounded bg-emerald-950/90 border border-emerald-800 ${
                        message.role === role ? "border-amber-400/80" : ""
                      }`}
                    >
                      <div className="flex justify-between gap-2 text-[11px] font-bold text-emerald-200">
                        <span>{message.userName || (message.role === "coach" ? "指導者" : "打者")}</span>
                        <time className="text-emerald-100">{message.time}</time>
                      </div>
                      <p className="mt-1 text-sm font-medium text-white">{message.text}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}