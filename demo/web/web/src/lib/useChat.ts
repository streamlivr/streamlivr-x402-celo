'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { MAINNET_ENABLED, NETWORKS, type NetworkKey } from './config';
import {
  initialMoves,
  type Block,
  type KnownCreator,
  type Move,
  type RunContext,
} from './intents';
import type { RequestTrace } from './x402pay';

export interface UserTurn {
  id: string;
  role: 'user';
  label: string;
}

export interface AgentTurn {
  id: string;
  role: 'agent';
  blocks: Block[];
  /** How many blocks are currently visible. Blocks arrive faster than they show. */
  revealed: number;
  status: 'thinking' | 'revealing' | 'done';
}

export type Turn = UserTurn | AgentTurn;

/** A hung request must never leave the composer disabled with no way out. */
const MOVE_WATCHDOG_MS = 60_000;

let counter = 0;
function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

/**
 * Drives one move at a time and paces the reveal.
 *
 * A move emits blocks as it goes, but a wall of text appearing at once reads as
 * a page load rather than an agent working. Blocks queue here and are released
 * one at a time; text blocks hold the queue until their typewriter finishes.
 */
export function useChat(burnerKey: string) {
  const [turns, setTurns] = useState<Turn[]>([]);
  // Open on the network the build is pointed at. With mainnet enabled that is
  // Celo mainnet, because paying a Sepolia invoice is not what this demo is for.
  const [network, setNetwork] = useState<NetworkKey>(() => (MAINNET_ENABLED ? 'mainnet' : 'sepolia'));
  const [options, setOptions] = useState<Move[]>(() => initialMoves());
  const [busy, setBusy] = useState(false);
  const [knownCreators, setKnownCreators] = useState<KnownCreator[]>([]);
  // Bumped whenever a settled payment lands, so the header can re-read the
  // burner balance at the moment money actually moves.
  const [settlementCount, setSettlementCount] = useState(0);
  const [settledNetwork, setSettledNetwork] = useState<NetworkKey>(() => (MAINNET_ENABLED ? 'mainnet' : 'sepolia'));

  const activeTurnRef = useRef<string | null>(null);
  // Text blocks that have finished typing. A text block holds the reveal queue
  // until it lands here, and keeping the record past that point is what lets a
  // block that finished before the next one arrived still release the queue.
  const streamedRef = useRef<Set<string>>(new Set());
  const lastTraceRef = useRef<RequestTrace | null>(null);
  const networkRef = useRef<NetworkKey>(network);
  const knownRef = useRef<KnownCreator[]>([]);

  useEffect(() => {
    networkRef.current = network;
  }, [network]);
  useEffect(() => {
    knownRef.current = knownCreators;
  }, [knownCreators]);

  const patchTurn = useCallback((id: string, patch: (turn: AgentTurn) => AgentTurn) => {
    setTurns((previous) => previous.map((turn) => (turn.id === id && turn.role === 'agent' ? patch(turn) : turn)));
  }, []);

  const advance = useCallback(
    (id: string) => {
      patchTurn(id, (turn) => (turn.revealed >= turn.blocks.length ? turn : { ...turn, revealed: turn.revealed + 1 }));
    },
    [patchTurn],
  );

  /**
   * Called by the typewriter when a text block finishes. It advances the turn
   * only when the finished block is still the visible frontier; when it is not,
   * the release effect below picks the queue up instead.
   */
  const markStreamDone = useCallback(
    (turnId: string, index: number) => {
      streamedRef.current.add(`${turnId}:${index}`);
      patchTurn(turnId, (turn) =>
        turn.revealed === index + 1 && turn.revealed < turn.blocks.length
          ? { ...turn, revealed: turn.revealed + 1 }
          : turn,
      );
    },
    [patchTurn],
  );

  /**
   * Release queued blocks one at a time, on a short beat so they do not stack
   * up. A text block holds the queue until its typewriter reports back, which
   * it may do before or after the next block is emitted. Testing the finished
   * record rather than the block kind is what keeps both orderings moving.
   */
  useEffect(() => {
    const active = turns.find((turn) => turn.id === activeTurnRef.current);
    if (!active || active.role !== 'agent') return;
    if (active.revealed >= active.blocks.length) {
      if (active.status === 'revealing') {
        patchTurn(active.id, (turn) => ({ ...turn, status: 'done' }));
      }
      return;
    }
    const index = active.revealed - 1;
    const current = index >= 0 ? active.blocks[index] : undefined;
    if (current && current.kind === 'text' && !streamedRef.current.has(`${active.id}:${index}`)) return;
    const delay = index < 0 || current?.kind === 'text' ? 0 : 240;
    const timer = setTimeout(() => advance(active.id), delay);
    return () => clearTimeout(timer);
  }, [turns, advance, patchTurn]);

  const send = useCallback(
    async (move: Move) => {
      if (busy) return;
      setBusy(true);
      setOptions([]);

      const userTurn: UserTurn = { id: nextId('user'), role: 'user', label: move.label };
      const agentTurn: AgentTurn = {
        id: nextId('agent'),
        role: 'agent',
        blocks: [],
        revealed: 0,
        status: 'thinking',
      };
      activeTurnRef.current = agentTurn.id;
      setTurns((previous) => [...previous, userTurn, agentTurn]);

      const emit = (block: Block) => {
        if (block.kind === 'receipt') {
          setSettlementCount((count) => count + 1);
          setSettledNetwork(block.network);
        }
        setTurns((previous) =>
          previous.map((turn) => {
            if (turn.id !== agentTurn.id || turn.role !== 'agent') return turn;
            const last = turn.blocks[turn.blocks.length - 1];
            // A status line changes label several times while a request runs.
            // Replacing the previous one keeps the transcript from filling with
            // lines that were only true for a second.
            const blocks =
              block.kind === 'progress' && last?.kind === 'progress'
                ? [...turn.blocks.slice(0, -1), block]
                : [...turn.blocks, block];
            return {
              ...turn,
              blocks,
              revealed: turn.revealed === 0 ? 1 : turn.revealed,
              status: 'revealing',
            };
          }),
        );
      };

      const context: RunContext = {
        network: networkRef.current,
        burnerKey,
        knownCreators: knownRef.current,
        lastTrace: lastTraceRef.current,
        setNetwork: (next) => setNetwork(next),
      };

      let watchdog: ReturnType<typeof setTimeout> | undefined;
      const stalled = new Promise<never>((_, reject) => {
        watchdog = setTimeout(() => reject(new Error('That request never came back, so it was stopped.')), MOVE_WATCHDOG_MS);
      });

      try {
        const outcome = await Promise.race([move.run(context, emit), stalled]);
        if (outcome.knownCreators?.length) setKnownCreators(outcome.knownCreators);
        if (outcome.lastTrace) lastTraceRef.current = outcome.lastTrace;
        setOptions(outcome.next ?? initialMoves());
      } catch (error) {
        emit({
          kind: 'error',
          text: error instanceof Error ? error.message : 'That move failed unexpectedly.',
        });
        setOptions(initialMoves());
      } finally {
        if (watchdog) clearTimeout(watchdog);
        // Status lines are scaffolding, not part of the answer, so they come
        // out of the transcript once the move is finished. Every one of them,
        // not just the last: a failed payment leaves the line it died on buried
        // between real blocks, and dropping only the trailing entry stranded it
        // there with its timer still counting. A move that emitted nothing else
        // (network switch, session reset) still needs a beat so the turn does
        // not look stuck.
        setTurns((previous) =>
          previous.map((turn) => {
            if (turn.id !== agentTurn.id || turn.role !== 'agent') return turn;
            const blocks = turn.blocks.filter((block) => block.kind !== 'progress');
            if (blocks.length === 0) {
              return { ...turn, blocks: [{ kind: 'text', text: 'Done.' }], revealed: 1, status: 'revealing' };
            }
            // Count what the reader has already seen, minus the lines just
            // removed, so clearing one mid-reveal cannot skip the block behind
            // it or replay one already on screen.
            const seen = turn.blocks
              .slice(0, turn.revealed)
              .filter((block) => block.kind !== 'progress').length;
            return { ...turn, blocks, revealed: seen };
          }),
        );
        setBusy(false);
      }
    },
    [busy, burnerKey],
  );

  const reset = useCallback(() => {
    activeTurnRef.current = null;
    streamedRef.current.clear();
    lastTraceRef.current = null;
    setKnownCreators([]);
    setTurns([]);
    setOptions(initialMoves());
  }, []);

  return {
    turns,
    options,
    busy,
    network,
    networkLabel: NETWORKS[network].label,
    send,
    advance,
    markStreamDone,
    settlementCount,
    settledNetwork,
    reset,
  };
}
