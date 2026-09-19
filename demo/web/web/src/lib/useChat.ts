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

  const activeTurnRef = useRef<string | null>(null);
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

  /** Release queued non-text blocks on a short beat so they do not stack up. */
  useEffect(() => {
    const active = turns.find((turn) => turn.id === activeTurnRef.current);
    if (!active || active.role !== 'agent') return;
    if (active.revealed >= active.blocks.length) {
      if (active.status === 'revealing') {
        patchTurn(active.id, (turn) => ({ ...turn, status: 'done' }));
      }
      return;
    }
    const current = active.blocks[active.revealed - 1];
    if (current && current.kind === 'text') return; // the typewriter calls advance() itself
    const timer = setTimeout(() => advance(active.id), 240);
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
        setTurns((previous) =>
          previous.map((turn) =>
            turn.id === agentTurn.id && turn.role === 'agent'
              ? {
                  ...turn,
                  blocks: [...turn.blocks, block],
                  revealed: turn.revealed === 0 ? 1 : turn.revealed,
                  status: 'revealing',
                }
              : turn,
          ),
        );
      };

      const context: RunContext = {
        network: networkRef.current,
        burnerKey,
        knownCreators: knownRef.current,
        lastTrace: lastTraceRef.current,
        setNetwork: (next) => setNetwork(next),
      };

      try {
        const outcome = await move.run(context, emit);
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
        // A move that emitted nothing (network switch, session reset) still
        // needs a beat so the turn does not look stuck.
        setTurns((previous) =>
          previous.map((turn) =>
            turn.id === agentTurn.id && turn.role === 'agent' && turn.blocks.length === 0
              ? {
                  ...turn,
                  blocks: [{ kind: 'text', text: 'Done.' }],
                  revealed: 1,
                  status: 'revealing',
                }
              : turn,
          ),
        );
        setBusy(false);
      }
    },
    [busy, burnerKey],
  );

  const reset = useCallback(() => {
    activeTurnRef.current = null;
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
    reset,
  };
}
