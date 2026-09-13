"use client";

import { createClient, type RealtimeChannel } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef, useState } from "react";

type Suit = "man" | "pin" | "sou" | "honor";
type Tile = { id: string; suit: Suit; value: number; label: string };
type Role = "player" | "coach";
type BoardState = {
  hands: Tile[][];
  discards: Tile[][];
  wall: Tile[];
  doraIndicator: Tile;
  turn: number;
  phase: "player" | "cpu";
  gameMode: "READY" | "PLAYING";
  hostId: string | null;
  lastAction: string;
};
type ChatMessage = { id: string; role: Role; text: string; time: string };

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
    wall: deck,
    doraIndicator,
    turn: 0,
    phase: "player",
    gameMode: hostId ? "PLAYING" : "READY",
    hostId,
    lastAction: "東家の配牌が完了しました",
  };
}

function normalizeBoard(payload: Partial<BoardState>): BoardState {
  const hands = Array.from({ length: 4 }, (_, index) =>
    Array.isArray(payload.hands?.[index]) ? payload.hands[index] : []
  );
  const payloadDiscards = payload.discards ?? (payload as Partial<BoardState> & { rivers?: Tile[][] }).rivers;
  const discards = Array.from({ length: 4 }, (_, index) =>
    Array.isArray(payloadDiscards?.[index]) ? payloadDiscards[index] : []
  );
  return {
    hands,
    discards,
    wall: Array.isArray(payload.wall) ? payload.wall : [],
    doraIndicator: payload.doraIndicator ?? { id: "fallback-dora", suit: "honor", value: 5, label: "白" },
    turn: typeof payload.turn === "number" ? payload.turn : 0,
    phase: payload.phase === "cpu" ? "cpu" : "player",
    gameMode: payload.gameMode === "PLAYING" ? "PLAYING" : "READY",
    hostId: typeof payload.hostId === "string" ? payload.hostId : null,
    lastAction: typeof payload.lastAction === "string" ? payload.lastAction : "盤面を同期しました",
  };
}

function sortHand(hand: Tile[]) {
  const suitOrder: Record<Suit, number> = { man: 0, pin: 1, sou: 2, honor: 3 };
  return [...hand].sort(
    (left, right) => suitOrder[left.suit] - suitOrder[right.suit] || left.value - right.value
  );
}

function getShantenText(hand: Tile[]): string {
  if (!hand || hand.length === 0) return "";
  const counts = new Array(34).fill(0);
  const suitOffset: Record<Suit, number> = { man: 0, pin: 9, sou: 18, honor: 27 };

  hand.forEach((t) => {
    const idx = suitOffset[t.suit] + (t.value - 1);
    if (idx >= 0 && idx < 34) {
      counts[idx] = Math.min(4, counts[idx] + 1);
    }
  });

  const kokushiIndices = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];
  let kokushiKinds = 0;
  let kokushiHasPair = false;
  kokushiIndices.forEach((i) => {
    if (counts[i] > 0) {
      kokushiKinds++;
      if (counts[i] >= 2) kokushiHasPair = true;
    }
  });
  const kokushiShanten = 13 - kokushiKinds - (kokushiHasPair ? 1 : 0);

  let pairs = 0;
  let kinds = 0;
  counts.forEach((c) => {
    if (c >= 2) pairs++;
    if (c >= 1) kinds++;
  });
  let chiitoiShanten = 6 - pairs;
  if (kinds < 7) chiitoiShanten += 7 - kinds;

  let minNormalShanten = 8;
  function backtrack(index: number, melds: number, taatsu: number, head: boolean) {
    const currentShanten = 8 - (2 * melds + taatsu + (head ? 1 : 0));
    if (currentShanten < minNormalShanten) minNormalShanten = currentShanten;

    while (index < 34 && counts[index] === 0) index++;
    if (index >= 34) return;

    if (!head && counts[index] >= 2) {
      counts[index] -= 2;
      backtrack(index, melds, taatsu, true);
      counts[index] += 2;
    }

    if (counts[index] >= 3) {
      counts[index] -= 3;
      backtrack(index, melds + 1, taatsu, head);
      counts[index] += 3;
    }

    if (index < 27 && index % 9 <= 6 && counts[index + 1] > 0 && counts[index + 2] > 0) {
      counts[index]--;
      counts[index + 1]--;
      counts[index + 2]--;
      backtrack(index, melds + 1, taatsu, head);
      counts[index]++;
      counts[index + 1]++;
      counts[index + 2]++;
    }

    if (melds + taatsu < 4) {
      if (counts[index] >= 2) {
        counts[index] -= 2;
        backtrack(index, melds, taatsu + 1, head);
        counts[index] += 2;
      }
      if (index < 27 && index % 9 <= 7 && counts[index + 1] > 0) {
        counts[index]--;
        counts[index + 1]--;
        backtrack(index, melds, taatsu + 1, head);
        counts[index]++;
        counts[index + 1]++;
      }
      if (index < 27 && index % 9 <= 6 && counts[index + 2] > 0) {
        counts[index]--;
        counts[index + 2]--;
        backtrack(index, melds, taatsu + 1, head);
        counts[index]++;
        counts[index + 2]++;
      }
    }
    backtrack(index + 1, melds, taatsu, head);
  }

  backtrack(0, 0, 0, false);
  const minShanten = Math.min(minNormalShanten, chiitoiShanten, kokushiShanten);

  if (minShanten <= -1) return "和了";
  if (minShanten === 0) return "聴牌";
  return `${minShanten}向聴`;
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

function getTileImagePath(tile: Tile): string[] {
  if (tile.suit === "man") return [`/tiles/Man${tile.value}.svg`];
  if (tile.suit === "pin") return [`/tiles/Pin${tile.value}.svg`];
  if (tile.suit === "sou") return [`/tiles/Sou${tile.value}.svg`];

  const honorNames: Record<number, string[]> = {
    1: ["Ton.svg", "ton.svg", "1.svg"],
    2: ["Nan.svg", "nan.svg", "2.svg"],
    3: ["Sha.svg", "Sya.svg", "West.svg", "Nishi.svg", "sha.svg", "3.svg"], // 「西」のあらゆる名前パターンを網羅
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
  const candidatePaths = useRef<string[]>(getTileImagePath(tile));
  const [pathIndex, setPathIndex] = useState(0);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    candidatePaths.current = getTileImagePath(tile);
    setPathIndex(0);
    setHasError(false);
  }, [tile]);

  const handleImageError = () => {
    if (pathIndex + 1 < candidatePaths.current.length) {
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
      className={`relative inline-flex h-12 w-9 shrink-0 items-center justify-center rounded bg-amber-50 p-0.5 shadow-md transition-all select-none border border-amber-200/50 ${
        disabled
          ? "cursor-default opacity-95"
          : "hover:-translate-y-1 hover:brightness-105 active:translate-y-0 cursor-pointer"
      } ${className}`}
      aria-label={tile.label}
    >
      {!hasError ? (
        <img
          src={candidatePaths.current[pathIndex]}
          alt={tile.label}
          onError={handleImageError}
          className="h-full w-full object-contain drop-shadow pointer-events-none"
          loading="eager"
        />
      ) : (
        // SVG画像がサーバーになかった場合でも「西」等の文字牌として綺麗に表示する万能フォールバック
        <span className="flex h-full w-full items-center justify-center font-black text-slate-800 text-sm leading-none">
          {tile.label}
        </span>
      )}
    </button>
  );
}

function RiverRow({ label, tiles }: { label: string; tiles: Tile[] }) {
  return (
    <div className="river-row flex min-h-[46px] flex-row items-center gap-2 py-1">
      <span className="flex h-7 w-12 shrink-0 items-center justify-center text-center text-xs font-bold text-white bg-emerald-950/80 rounded border border-emerald-700/60 shadow-inner">
        {label}
      </span>
      <div className="river-tiles flex flex-1 flex-row flex-nowrap items-center min-h-[42px] overflow-x-auto gap-1">
        {tiles.map((tile) => (
          <TileCard key={tile.id} tile={tile} disabled className="!h-10 !w-7" />
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
  const [role, setRole] = useState<Role>("player");
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

  useEffect(() => {
    if (
      !isHostRef.current ||
      role !== "player" ||
      board?.gameMode !== "PLAYING" ||
      board?.phase !== "cpu"
    ) {
      return;
    }

    const currentTurn = board.turn;
    if (currentTurn < 1 || currentTurn > 3) return;

    const timer = setTimeout(() => {
      setBoard((current) => {
        if (!current || current.phase !== "cpu" || current.turn !== currentTurn) return current;

        const hands = current.hands.map((hand) => [...hand]);
        const discards = Array.from({ length: 4 }, (_, index) => [...(current.discards?.[index] ?? [])]);
        const wall = current.wall.slice(1);
        const drawnTile = current.wall[0];

        if (drawnTile) {
          hands[currentTurn] = [...(hands[currentTurn] ?? []), drawnTile];
        }

        const discardIndex = hands[currentTurn].length > 0 ? getBestDiscardIndex(hands[currentTurn]) : -1;
        const discarded = discardIndex >= 0 ? hands[currentTurn][discardIndex] : undefined;

        if (discarded) {
          hands[currentTurn] = sortHand([
            ...hands[currentTurn].slice(0, discardIndex),
            ...hands[currentTurn].slice(discardIndex + 1),
          ]);
          discards[currentTurn] = [...(discards[currentTurn] ?? []), discarded];
        }

        const nextTurn = currentTurn + 1;

        if (nextTurn <= 3) {
          const next = {
            ...current,
            hands,
            discards,
            wall,
            turn: nextTurn,
            lastAction: `${PLAYER_NAMES[currentTurn]}が打牌`,
          };
          broadcast(next);
          return next;
        } else {
          const playerDraw = wall[0];
          const nextWall = wall.slice(1);
          if (playerDraw) {
            hands[0] = [...hands[0], playerDraw];
          }

          const next = {
            ...current,
            hands,
            discards,
            wall: nextWall,
            phase: "player" as const,
            turn: 0,
            lastAction: "あなたのツモ番です",
          };
          broadcast(next);
          return next;
        }
      });
    }, 350);

    return () => clearTimeout(timer);
  }, [board?.gameMode, board?.phase, board?.turn, broadcast, role]);

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

    setBoard((current) => {
      if (!current) return current;
      const hands = current.hands.map((hand) => [...hand]);
      const discards = Array.from({ length: 4 }, (_, playerIndex) => [...(current.discards?.[playerIndex] ?? [])]);
      const discarded = hands[0].splice(index, 1)[0];
      if (!discarded) return current;
      hands[0] = sortHand(hands[0]);
      discards[0] = [...(discards[0] ?? []), discarded];
      const next = {
        ...current,
        hands,
        discards,
        turn: 1,
        phase: "cpu" as const,
        lastAction: `あなたが${discarded.label}を打牌`,
      };
      broadcast(next);
      return next;
    });
  };

  const reset = () => {
    if (supabase && board?.gameMode === "PLAYING" && !isHostRef.current) return;
    const next = newBoard(clientIdRef.current || "local-host");
    setIsHost(true);
    setBoard(next);
    broadcast(next);
  };

  const forceReset = () => {
    isHostRef.current = true;
    setIsHost(true);
    const next = newBoard(clientIdRef.current || "local-host");
    setBoard(next);
    broadcast(next);
  };

  const sendChat = (event: React.FormEvent) => {
    event.preventDefault();
    const text = chatText.trim();
    if (!text) return;
    const message = { id: crypto.randomUUID(), role, text, time: formatTime() };
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
                  {board.gameMode === "READY"
                    ? "対局開始を押してホストになります"
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

            <div className="bg-emerald-900/80 border border-emerald-700/80 rounded-lg p-4 shadow-xl backdrop-blur-sm">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h2 className="text-white font-black text-base tracking-wide">河</h2>
                </div>
                <div className="divide-y divide-emerald-800/40">
                  {PLAYER_NAMES.map((playerName, playerIndex) => (
                    <RiverRow key={playerName} label={playerName} tiles={board.discards[playerIndex] ?? []} />
                  ))}
                </div>
              </div>
              <div className="mt-4 flex items-center gap-3 border-t border-emerald-800/80 pt-3 text-xs font-bold text-white">
                <span>山</span>
                <div className="h-2 flex-1 rounded-full bg-emerald-950">
                  <div
                    className="h-full rounded-full bg-emerald-400 transition-all shadow-sm"
                    style={{ width: `${(board.wall.length / 82) * 100}%` }}
                  />
                </div>
                <span className="ml-2 whitespace-nowrap">ドラ</span>
                <TileCard tile={board.doraIndicator} disabled className="!h-10 !w-7" />
              </div>
            </div>
          </section>

          <aside className="relative z-10 flex flex-col h-[180px] w-full shrink-0 rounded-lg border border-emerald-700/80 bg-emerald-900/80 p-3 shadow-xl backdrop-blur-sm md:sticky md:top-4 md:h-[430px] md:w-80">
            <div className="flex items-center justify-between border-b border-emerald-800/80 pb-2">
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
                      <span>{message.role === "coach" ? "指導者" : "打者"}</span>
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

        <div className="fixed inset-x-0 bottom-0 z-50 w-full max-w-full overflow-hidden rounded-none border-x-0 border-t border-emerald-700/80 bg-emerald-900/95 p-3 shadow-2xl backdrop-blur-md md:static md:z-10 md:rounded-lg md:border">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <h2 className="text-white font-black text-base">あなたの手牌</h2>
              <span className="rounded bg-amber-500/20 px-2 py-0.5 text-xs font-bold text-white border border-amber-400/50">
                {getShantenText(board.hands[0])}
              </span>
            </div>
            <span
              className={`px-2.5 py-1 rounded text-xs font-bold shadow ${
                board.phase === "player" && role === "player"
                  ? "bg-amber-500 text-white animate-pulse"
                  : "bg-emerald-950 text-emerald-100"
              }`}
            >
              {role === "coach" ? "観戦中" : board.phase === "player" ? "あなたの番" : "CPU進行"}
            </span>
          </div>
          <div className="flex w-full max-w-full flex-nowrap items-center gap-1.5 overflow-x-auto px-1 py-1 md:justify-center">
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
                  board.turn !== 0
                }
                className={`${board.hands[0].length === 14 && index === 13 ? "ml-3" : ""}`}
              />
            ))}
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
              <div className="mt-3 flex flex-col gap-2 overflow-y-auto max-h-[60vh]">
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
                        <span>{message.role === "coach" ? "指導者" : "打者"}</span>
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