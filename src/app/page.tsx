"use client";

import { createClient, type RealtimeChannel } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef, useState } from "react";

type Suit = "man" | "pin" | "sou" | "honor";
type Tile = { id: string; suit: Suit; value: number; label: string };
type Role = "player" | "coach";
type BoardState = { hands: Tile[][]; rivers: Tile[][]; wall: Tile[]; doraIndicator: Tile; turn: number; phase: "player" | "cpu"; gameMode: "READY" | "PLAYING"; hostId: string | null; lastAction: string };
type ChatMessage = { id: string; role: Role; text: string; time: string };

const ROOM = "mahjong-coaching-main";
const PLAYER_NAMES = ["自分", "下家", "対面", "上家"];
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

function createDeck() {
  let deck: Tile[] = [];
  const labels = ["一", "二", "三", "四", "五", "六", "七", "八", "九"];
  for (const suit of ["man", "pin", "sou"] as Suit[]) for (let value = 1; value <= 9; value += 1) for (let copy = 0; copy < 4; copy += 1) deck = [...deck, { id: `${suit}-${value}-${copy}`, suit, value, label: `${labels[value - 1]}${suit === "man" ? "萬" : suit === "pin" ? "筒" : "索"}` }];
  ["東", "南", "西", "北", "白", "發", "中"].forEach((label, index) => { for (let copy = 0; copy < 4; copy += 1) deck = [...deck, { id: `honor-${index}-${copy}`, suit: "honor", value: index + 1, label }]; });
  return deck.sort(() => Math.random() - 0.5);
}

function newBoard(hostId: string | null = null): BoardState {
  const deck = createDeck();
  const doraIndicator = deck.splice(Math.floor(Math.random() * deck.length), 1)[0];
  const hands = [[], [], [], []] as Tile[][];
  for (let round = 0; round < 13; round += 1) for (let index = 0; index < hands.length; index += 1) {
    const tile = deck.pop();
    if (tile) hands[index] = [...hands[index], tile];
  }
  const firstDraw = deck.pop();
  if (firstDraw) hands[0] = [...hands[0], firstDraw];
  hands[0] = sortHand(hands[0]);
  return { hands, rivers: [[], [], [], []], wall: deck, doraIndicator, turn: 0, phase: "player", gameMode: hostId ? "PLAYING" : "READY", hostId, lastAction: "東家の配牌が完了しました" };
}

function normalizeBoard(payload: Partial<BoardState>): BoardState {
  const hands = Array.from({ length: 4 }, (_, index) => Array.isArray(payload.hands?.[index]) ? payload.hands[index] : []);
  const rivers = Array.from({ length: 4 }, (_, index) => Array.isArray(payload.rivers?.[index]) ? payload.rivers[index] : []);
  return {
    hands,
    rivers,
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
  return [...hand].sort((left, right) => suitOrder[left.suit] - suitOrder[right.suit] || left.value - right.value);
}

function tileClass(tile: Tile) {
  if (tile.suit === "man") return "text-red-600";
  if (tile.suit === "pin") return "text-blue-600";
  if (tile.suit === "sou" || tile.label === "發") return "text-emerald-600";
  if (tile.label === "中") return "text-red-600";
  return "text-slate-900";
}

function TileCard({ tile, onClick, disabled, className = "" }: { tile: Tile; onClick?: () => void; disabled?: boolean; className?: string }) {
  return <button type="button" disabled={disabled} onClick={onClick} className={`tile-card ${tileClass(tile)} ${className} ${disabled ? "cursor-default" : "hover:-translate-y-1 hover:shadow-md"}`} aria-label={tile.label}>{tile.label}</button>;
}

function formatTime() { return new Date().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" }); }

export default function Home() {
  const [isMounted, setIsMounted] = useState(false);
  const [board, setBoard] = useState<BoardState | null>(null);
  const [role, setRole] = useState<Role>("player");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatText, setChatText] = useState("");
  const [connection, setConnection] = useState(supabase ? "接続準備中" : "ローカル対局");
  const [isHost, setIsHost] = useState(!supabase);
  const [isProcessingCpu, setIsProcessingCpu] = useState(false);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const roleRef = useRef(role);
  const boardRef = useRef<BoardState | null>(null);
  const isHostRef = useRef(!supabase);
  const isProcessingCpuRef = useRef(false);
  const clientIdRef = useRef("");
  const cpuTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { clientIdRef.current = crypto.randomUUID(); setIsMounted(true); setBoard(newBoard(supabase ? null : "local-host")); }, []);
  useEffect(() => { roleRef.current = role; }, [role]);
  useEffect(() => { boardRef.current = board; }, [board]);
  useEffect(() => { isHostRef.current = isHost; }, [isHost]);

  const broadcast = useCallback((next: BoardState) => { void channelRef.current?.send({ type: "broadcast", event: "board", payload: next }); }, []);

  useEffect(() => {
    if (!isMounted || !supabase) return;
    const channel = supabase.channel(ROOM);
    channelRef.current = channel;
    channel.on("broadcast", { event: "board" }, ({ payload }) => {
      const nextBoard = normalizeBoard(payload as Partial<BoardState>);
      setBoard(nextBoard);
      setIsHost(nextBoard.hostId === clientIdRef.current);
    });
    channel.on("broadcast", { event: "request-board" }, () => { void channel.send({ type: "broadcast", event: "board", payload: boardRef.current }); });
    channel.on("broadcast", { event: "chat" }, ({ payload }) => setMessages((current) => [...current.slice(-29), payload as ChatMessage]));
    void channel.subscribe((status) => { setConnection(status === "SUBSCRIBED" ? "Realtime 接続中" : `接続: ${status}`); if (status === "SUBSCRIBED") void channel.send({ type: "broadcast", event: "request-board", payload: {} }); });
    return () => { void supabase.removeChannel(channel); channelRef.current = null; };
  }, [isMounted]);

  useEffect(() => {
    if (!isHostRef.current || role !== "player" || boardRef.current?.gameMode !== "PLAYING" || boardRef.current.phase !== "cpu" || isProcessingCpuRef.current) return;
    isProcessingCpuRef.current = true;
    setIsProcessingCpu(true);
    let cancelled = false;
    let cpu = 1;
    const runCpuTurn = () => {
      if (!isHostRef.current || isProcessingCpuRef.current === false || cancelled || boardRef.current?.gameMode !== "PLAYING") return;
        setBoard((current) => {
          if (!current) return current;
          const hands = current.hands.map((hand) => [...hand]);
          const rivers = current.rivers.map((river) => [...river]);
          const wall = current.wall.slice(1);
          const drawnTile = current.wall[0];
          if (drawnTile) hands[cpu] = [...(hands[cpu] ?? []), drawnTile];
          const discarded = hands[cpu]?.[hands[cpu].length - 1];
          if (discarded) {
            hands[cpu] = hands[cpu].slice(0, -1);
            rivers[cpu] = [...(rivers[cpu] ?? []), discarded];
          }
          const next = { ...current, hands, rivers, wall, turn: cpu, lastAction: `${PLAYER_NAMES[cpu]}がツモ切り` };
          broadcast(next);
          return next;
        });
      cpu += 1;
      if (cpu <= 3) {
        cpuTimerRef.current = setTimeout(runCpuTurn, 300);
        return;
      }
      if (!cancelled) setBoard((current) => {
        if (!current) return current;
        const drawnTile = current.wall[0];
        const hands = current.hands.map((currentHand, index) => index === 0 && drawnTile ? [...currentHand, drawnTile] : [...currentHand]);
        const next = { ...current, hands, wall: current.wall.slice(1), phase: "player" as const, turn: 0, lastAction: "あなたのツモ番です" };
        broadcast(next);
        return next;
      });
      isProcessingCpuRef.current = false;
      setIsProcessingCpu(false);
    };
    cpuTimerRef.current = setTimeout(runCpuTurn, 300);
    return () => {
      cancelled = true;
      if (cpuTimerRef.current) clearTimeout(cpuTimerRef.current);
      cpuTimerRef.current = null;
      isProcessingCpuRef.current = false;
      setIsProcessingCpu(false);
    };
  }, [board?.phase, broadcast, isHost, role]);

  const discard = (index: number) => {
    if (!board || !isHostRef.current || roleRef.current !== "player" || board.gameMode !== "PLAYING" || board.phase !== "player" || board.turn !== 0 || isProcessingCpuRef.current) return;
    setBoard((current) => {
      if (!current) return current;
      const hands = current.hands.map((hand) => [...hand]);
      const rivers = current.rivers.map((river) => [...river]);
      const discarded = hands[0].splice(index, 1)[0];
      if (!discarded) return current;
      hands[0] = sortHand(hands[0]);
      rivers[0] = [...(rivers[0] ?? []), discarded];
      const next = { ...current, hands, rivers, turn: 1, phase: "cpu" as const, lastAction: `あなたが${discarded.label}を打牌` };
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
  const sendChat = (event: React.FormEvent) => {
    event.preventDefault();
    const text = chatText.trim();
    if (!text) return;
    const message = { id: crypto.randomUUID(), role, text, time: formatTime() };
    setMessages((current) => [...current.slice(-29), message]);
    void channelRef.current?.send({ type: "broadcast", event: "chat", payload: message });
    setChatText("");
  };

  if (!isMounted || !board) return <main className="flex min-h-screen items-center justify-center bg-amber-50 text-sm font-bold text-amber-800">対局を準備しています...</main>;

  return (
    <main className="min-h-screen bg-amber-50 text-slate-900">
      <header className="border-b border-amber-200 bg-white/75 px-4 py-4 shadow-sm backdrop-blur sm:px-8"><div className="mx-auto flex max-w-7xl items-center justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[0.2em] text-amber-700">MAHJONG COACHING ROOM</p><h1 className="mt-1 text-2xl font-black tracking-tight sm:text-3xl">東一局 / 指導対局</h1></div><div className="text-right"><p className="text-xs text-slate-500">{connection}</p><p className="mt-1 text-sm font-bold text-amber-800">残り {board.wall.length} 枚</p></div></div></header>
      <div className="flex w-full max-w-[1400px] mx-auto flex-col gap-4 px-4 py-6 sm:px-8">
        <div className="flex w-full flex-row items-start gap-4">
        <section className="relative z-10 min-w-0 w-full flex-1 space-y-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-bold text-amber-700">{board.lastAction}</p><p className="text-xs text-slate-500">{board.gameMode === "READY" ? "対局開始を押してホストになります" : board.phase === "player" ? "手牌から捨てる牌を選択" : isProcessingCpu ? "CPUが順番にツモ切り中..." : "CPU処理を同期中..."}</p></div><div className="relative z-10 flex gap-2"><button type="button" onClick={() => setRole("player")} className={`mode-button ${role === "player" ? "active" : ""}`}>打者</button><button type="button" onClick={() => setRole("coach")} className={`mode-button ${role === "coach" ? "active" : ""}`}>指導者</button><button type="button" onClick={reset} disabled={supabase !== null && board.gameMode === "PLAYING" && !isHost} className="secondary-button">{board.gameMode === "READY" ? "対局開始" : "新しい局"}</button></div></div>
          <div className="table-surface"><div className="space-y-4"><div className="flex items-center justify-between"><h2 className="section-title">河</h2></div><div className="river-grid">{board.rivers.map((river, playerIndex) => <div key={playerIndex} className="river-row"><span className="w-10 shrink-0 text-xs font-bold text-slate-500">{PLAYER_NAMES[playerIndex]}</span><div className="river-tiles flex flex-row flex-nowrap overflow-x-auto">{river.map((tile) => <TileCard key={tile.id} tile={tile} disabled />)}</div></div>)}</div></div><div className="wall-line"><span>山</span><div className="h-2 flex-1 rounded-full bg-amber-300/70"><div className="h-full rounded-full bg-amber-600 transition-all" style={{ width: `${(board.wall.length / 82) * 100}%` }} /></div><span className="ml-2 whitespace-nowrap">ドラ</span><TileCard tile={board.doraIndicator} disabled /></div></div>
        </section>
        <aside className="chat-panel relative z-10 sticky top-4 h-[430px] w-80 shrink-0"><div className="flex items-center justify-between border-b border-amber-200 pb-4"><div><h2 className="section-title">指導チャット</h2><p className="text-xs text-slate-500">全端末にリアルタイム同期</p></div><span className="live-dot">LIVE</span></div><div className="chat-list max-h-[250px] overflow-y-auto">{messages.length === 0 ? <p className="py-8 text-center text-sm text-slate-400">牌譜を見ながら会話できます</p> : messages.map((message) => <div key={message.id} className={`chat-bubble ${message.role === role ? "mine" : ""}`}><div className="flex justify-between gap-2 text-[11px] font-bold text-slate-500"><span>{message.role === "coach" ? "指導者" : "打者"}</span><time>{message.time}</time></div><p className="mt-1 text-sm">{message.text}</p></div>)}</div><form onSubmit={sendChat} className="mt-auto flex gap-2 border-t border-amber-200 pt-4"><input value={chatText} onChange={(event) => setChatText(event.target.value)} placeholder="メッセージを入力" className="chat-input" /><button type="submit" className="send-button" aria-label="送信">送信</button></form></aside>
        </div>
        <div className="table-surface relative z-10 w-full"><div className="flex items-center justify-between"><div><h2 className="section-title">あなたの手牌</h2><p className="text-xs text-slate-500">東家 / {board.hands[0].length}枚</p></div><span className={`turn-pill ${board.phase === "player" && role === "player" ? "turn-pill-active" : ""}`}>{role === "coach" ? "観戦中" : board.phase === "player" ? "あなたの番" : "CPU進行"}</span></div><div className="hand-row justify-center">{board.hands[0].map((tile, index) => <TileCard key={tile.id} tile={tile} onClick={() => discard(index)} disabled={!isHost || role !== "player" || board.gameMode !== "PLAYING" || board.phase !== "player" || board.turn !== 0 || isProcessingCpu} className={board.hands[0].length === 14 && index === 13 ? "ml-3" : ""} />)}</div></div>
      </div>
    </main>
  );
}