'use strict';
// Passive state cache for PokeIdle.io. Intercepts incoming WebSocket state packets.
function installIoState() {
  if (typeof window === 'undefined' || typeof location === 'undefined') return;
  if (location.origin !== 'https://pokeidle.io' || window.__idleboardIoState) return;
  const original = window.WebSocket;
  if (!original) return;
  const monsters = new Map();
  let player = {},
    publicData = null,
    receivedAt = 0;
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const select = (o, keys) => Object.fromEntries(keys.filter(k => own(o, k)).map(k => [k, o[k]]));
  const mon = p =>
    select(p, ['id', 'speciesId', 'level', 'ivs', 'quality', 'qualidade', 'potencia', 'shiny', 'refino', 'tmElemental', 'tmFisico', 'tmAoe', 'slot']);

  function receive(packet) {
    if (packet.t === 'welcome') {
      publicData = select(packet, ['hunts', 'tabelaTipos', 'tiposBoost', 'ampliacaoHunt', 'multHpSelvagem', 'multDanoSelvagem']);
    }
    if (packet.t !== 'welcome' && packet.t !== 'estado') return;
    const state = packet.estado;
    if (!state || typeof state !== 'object') return;
    if (state.cheio) {
      monsters.clear();
      player = {};
    }
    Object.assign(player, select(state, ['level', 'activeId', 'huntSlug', 'guildBonusPct']));
    if (own(state, 'diaSazonal')) {
      const d = state.diaSazonal;
      player.diaSazonal = d && typeof d === 'object' ? select(d, ['tipo', 'fim']) : null;
    }
    if (own(state, 'loja')) player.loja = state.loja ? select(state.loja, ['vipAte', 'boosts']) : {};
    if (own(state, 'guild')) player.guild = state.guild ? select(state.guild, ['boostAte']) : null;
    if (Array.isArray(state.pokemons)) {
      monsters.clear();
      for (const p of state.pokemons) monsters.set(p.id, mon(p));
    }
    for (const p of state.pkMud || []) monsters.set(p.id, mon(p));
    for (const id of state.pkFora || []) monsters.delete(id);
    receivedAt = Date.now();
  }

  class ObservedSocket extends original {
    constructor(...args) {
      super(...args);
      let target;
      try {
        target = new URL(String(args[0]));
      } catch {
        return;
      }
      if (target.protocol !== 'wss:' || target.host !== location.host) return;
      this.addEventListener('message', event => {
        if (typeof event.data !== 'string' || !/^\s*\{\s*"t"\s*:\s*"(?:welcome|estado)"/.test(event.data)) return;
        try {
          receive(JSON.parse(event.data));
        } catch {}
      });
    }
  }

  window.WebSocket = ObservedSocket;
  Object.defineProperty(window, '__idleboardIoState', {
    value: {
      snapshot: () => ({
        publicData,
        player: structuredClone(player),
        active: monsters.get(player.activeId) || null,
        collection: [...monsters.values()],
        receivedAt
      })
    },
    configurable: false
  });
}

if (process.type === 'renderer') {
  try {
    const { contextBridge } = require('electron');
    if (contextBridge && typeof contextBridge.executeInMainWorld === 'function') {
      contextBridge.executeInMainWorld({ func: installIoState });
    } else {
      installIoState();
    }
  } catch (e) {
    installIoState();
  }
}

module.exports = { installIoState };
