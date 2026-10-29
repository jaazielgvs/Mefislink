'use strict';
// Relative offensive coverage of learned species moves. Not combat DPS.
function offensiveProfile(species, level, stats) {
  const types = [species.type1, species.type2].filter(Boolean), seen = new Set();
  const moves = (species.attacks || [])
    .filter(move => Number(move.power) > 0 && ['PHYSICAL', 'SPECIAL'].includes(move.category) && Number(move.learnLevel || 1) <= level)
    .filter(move => {
      const id = [move.name, move.type, move.category, move.power, move.learnLevel].join('|');
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .map(move => ({
      name: String(move.name || move.type).slice(0, 100),
      type: move.type,
      category: move.category,
      power: Number(move.power),
      level: Number(move.learnLevel || 1),
      cooldown: Number(move.cooldownMs) > 0 ? Number(move.cooldownMs) : null,
      stab: types.includes(move.type) ? 1.5 : 1
    }));
  const weights = { PHYSICAL: 0, SPECIAL: 0 }, counts = { PHYSICAL: 0, SPECIAL: 0 };
  const timed = moves.length > 0 && moves.every(move => move.cooldown > 0);
  for (const move of moves) {
    weights[move.category] += (move.power * move.stab) / (timed ? move.cooldown / 1000 : 1);
    counts[move.category]++;
  }
  const total = weights.PHYSICAL + weights.SPECIAL;
  const physical = total ? weights.PHYSICAL / total : null;
  const focus = physical == null ? 'unknown' : physical >= 0.65 ? 'physical' : physical <= 0.35 ? 'special' : 'balanced';
  return {
    focus,
    physical,
    counts,
    timed,
    atk: stats.atk,
    spAtk: stats.spAtk,
    top: moves.slice().sort((a, b) => b.power - a.power || a.level - b.level || a.name.localeCompare(b.name)).slice(0, 3),
    total: moves.length
  };
}

module.exports = { offensiveProfile };
