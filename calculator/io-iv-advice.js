'use strict';
(function (root) {
  function advice(ivs, offense) {
    const descriptions = {
      hp: ['HP', 'Pode ter menos vida e aguentar menos dano. Cuidado nas lutas mais difíceis.'],
      atk: ['ATK', 'Seus golpes físicos podem causar menos dano.'],
      def: ['DEF', 'Seu Pokémon pode receber mais dano de golpes físicos. Cuidado contra adversários que usam ATK.'],
      spAtk: ['SP. ATK', 'Seus golpes especiais podem causar menos dano.'],
      spDef: ['SP. DEF', 'Seu Pokémon pode receber mais dano de golpes especiais. Cuidado contra adversários que usam SP. ATK.'],
      speed: ['SPD', 'Pode demorar mais para atacar novamente, por ter menos redução de recarga.']
    };
    const summaries = {
      hp: 'vida baixa',
      atk: 'ataque físico baixo',
      def: 'defesa física baixa',
      spAtk: 'ataque especial baixo',
      spDef: 'defesa especial baixa',
      speed: 'velocidade baixa'
    };
    return Object.entries(descriptions)
      .filter(([key]) => Number.isInteger(ivs?.[key]) && ivs[key] >= 1 && ivs[key] < 15)
      .map(([stat, [label, message]]) => ({
        stat,
        label,
        iv: ivs[stat],
        summary: summaries[stat],
        message: message + ((stat === 'atk' && offense?.counts?.PHYSICAL === 0) || (stat === 'spAtk' && offense?.counts?.SPECIAL === 0)
          ? ' Como os golpes atuais não usam esse atributo, ele faz menos diferença no seu ataque agora.'
          : '')
      }));
  }
  if (typeof module === 'object' && module.exports) module.exports = { advice };
  else root.CalcIvAdvice = { advice };
})(typeof window === 'object' ? window : globalThis);
