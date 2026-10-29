'use strict';

async function calculate(request = {}) {
  if (location.origin !== 'https://pokeidle.io') {
    throw new Error('Abra o PokeIdle.io nesta conta.');
  }

  async function load() {
    const paths = [
      'ginasios',
      'tipo-efetividade',
      'recompensa-hunt',
      'cooldown-golpes',
      'tm-elemental',
      'outland',
      'herdar-base-outland',
      'golpes-planilhas',
      'golpes-especiais',
      'megas',
      'herdar-looktype-outland',
      'herdar-looktype-orre'
    ];
    const modules = await Promise.all(paths.map(p => import(location.origin + '/shared/' + p + '.mjs')));
    const [stats, types, rewards, cooldown, tm, outland, inherit, sheets, special, mega, looks, orre] = modules;
    const json = await Promise.all(
      ['creatures', 'creatures-novos', 'creatures-outland-novos', 'creatures-audit-overrides'].map(async name => {
        const r = await fetch('/assets/' + name + '.json');
        if (!r.ok) throw new Error('Catálogo público indisponível: ' + name);
        return r.json();
      })
    );
    const list = json.slice(0, 3).flatMap(x => x.creatures || []);
    outland.aplicarRemapOutlandLista(list);
    for (const patch of json[3].overrides || []) {
      const species = list.find(s => s.pokeId === patch.pokeId);
      if (!species) continue;
      for (const k of ['baseHp', 'baseAtk', 'baseDef', 'baseSpAtk', 'baseSpDef', 'baseSpeed', 'attacks']) {
        if (patch[k] != null) species[k] = patch[k];
      }
    }
    const previousAttacks = new Map();
    for (const s of list) {
      if (Array.isArray(s.attacks)) {
        previousAttacks.set(s.pokeId, s.attacks.map(a => ({
          name: a.name,
          type: a.type || 'NORMAL',
          category: a.category || 'PHYSICAL',
          power: a.power || 0
        })));
      }
    }
    sheets.aplicarGolpesDasPlanilhas(id => list.filter(s => s.pokeId === id));
    inherit.herdarBaseOutland(list);
    looks.herdarLooktypeOutland(list);
    orre.herdarLooktypeOrre(list);
    for (const species of list) special.injetarGolpesEspeciais(species);
    list.push(...mega.criarEspeciesMega(list));
    const analyser = await import(location.origin + '/hunt-analyser.mjs');
    const portraits = new Map();
    let atlasPromise;

    async function atlas() {
      const metadata = await (await fetch('/assets/site/assets/maps/marker-atlas.json')).json();
      const image = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = '/assets/site/assets/maps/marker-atlas.png' + (metadata.version ? '?v=' + encodeURIComponent(metadata.version) : '');
      });
      return { metadata, image };
    }

    async function portrait(species) {
      if (!species?.looktype) return null;
      const key = species.looktype;
      if (portraits.has(key)) return portraits.get(key);
      const work = (async () => {
        if (!atlasPromise) atlasPromise = atlas();
        const { metadata, image } = await atlasPromise;
        const cell = metadata.slots?.[String(key)];
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 64;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        if (cell) {
          const size = metadata.cell || 64;
          ctx.drawImage(image, cell[0] * size, cell[1] * size, size, size, 0, 0, 64, 64);
        } else {
          const sprites = await import(location.origin + '/sprites.mjs');
          await sprites.carregarIndice();
          const outfit = await sprites.carregarOutfit(key),
            frame = sprites.quadrosDe(outfit, 3)?.[0];
          if (!frame || !outfit.imagens[frame.pagina]) return null;
          const scale = Math.min(64 / frame.w, 64 / frame.h, 1),
            w = Math.round(frame.w * scale),
            h = Math.round(frame.h * scale);
          ctx.drawImage(outfit.imagens[frame.pagina], frame.x, frame.y, frame.w, frame.h, (64 - w) / 2, 64 - h, w, h);
        }
        return canvas.toDataURL('image/png');
      })().catch(() => null);
      portraits.set(key, work);
      return work;
    }

    return {
      stats,
      types,
      rewards,
      cooldown,
      tm,
      sheets,
      previousAttacks,
      analyser,
      portrait,
      species: new Map(list.filter(s => !outland.isEspelhoFantasmaPokeId(s.pokeId)).map(s => [s.pokeId, s]))
    };
  }

  if (!window.__idleboardIoCatalog) {
    window.__idleboardIoCatalog = load().catch(error => {
      delete window.__idleboardIoCatalog;
      throw error;
    });
  }
  const catalog = await window.__idleboardIoCatalog;

  if (!window.__idleboardIoCalculatorRules) {
    window.__idleboardIoCalculatorRules = Promise.all(
      ['nota-pokemon', 'refino-stats', 'mistico', 'linhagem-nota', 'megas', 'evolucoes-cruzadas'].map(name =>
        import(location.origin + '/shared/' + name + '.mjs')
      )
    ).catch(error => {
      delete window.__idleboardIoCalculatorRules;
      throw error;
    });
  }
  const [rules, refine, mystic, lineage, mega, evolution] = await window.__idleboardIoCalculatorRules;

  if (!catalog.calculatorLineage) {
    const list = [...catalog.species.values()];
    evolution.aplicarEvolucoesEntreGeracoes(list);
    lineage.anotarLinhagemDaNota(list, id => catalog.species.get(id), mega.elosMegaDaNota(list));
    catalog.calculatorLineage = true;
  }

  const snapshot = window.__idleboardIoState?.snapshot();
  const collection = snapshot?.collection || [];

  if (request.action === 'init') {
    return {
      species: [...catalog.species.values()].map(s => ({ id: s.pokeId, name: s.name })).sort((a, b) => a.id - b.id),
      active: snapshot?.active || null,
      collection: collection
        .filter(p => p.slot != null)
        .map(p => ({
          ...p,
          name: catalog.species.get(p.speciesId)?.name || 'Pokémon #' + p.speciesId
        }))
    };
  }

  const pk = request.pokemon;
  const species = catalog.species.get(pk.speciesId);
  if (!species) throw new Error('Selecione uma espécie do catálogo.');

  const bases = refine.basesComRefino(species, pk.refino);
  const legendary = mystic.ehLendarioOuMitico(species.pokeId);
  const result = rules.notaPokemon({
    ivs: pk.ivs,
    qualidade: pk.quality,
    potencia: pk.potencia,
    shiny: pk.shiny,
    bases,
    basesLimites: rules.basesDaEspecie(species),
    basesAncestrais: species.notaAncestrais || null
  });
  const stats = catalog.stats.statsNoNivel(pk, species, pk.level);
  const megaMeta = mega.megaDaEspecie(species.pokeId);
  const megaSpecies = megaMeta ? catalog.species.get(mega.megaPokeId(megaMeta.dex)) : null;
  let megaSprite = null;

  if (megaSpecies) {
    let timeout;
    try {
      megaSprite = await Promise.race([
        catalog.portrait(megaSpecies).catch(() => null),
        new Promise(resolve => {
          timeout = setTimeout(() => resolve(null), 2500);
        })
      ]);
    } finally {
      clearTimeout(timeout);
    }
  }

  const extractRework = (pokeId, basePokeId = null) => {
    if (!pokeId || !catalog.sheets) return null;
    const keys = Object.keys(catalog.sheets).filter(k => k.startsWith('GOLPES_'));
    keys.sort((a, b) => {
      const parseDate = s => {
        const m = s.match(/(\d{4})_(\d{2})_(\d{2})/);
        if (m) return `${m[1]}-${m[2]}-${m[3]}`;
        const m2 = s.match(/(\d{4})_(\d{2})/);
        if (m2) return `${m2[1]}-${m2[2]}-01`;
        return '2026-01-01';
      };
      return parseDate(b).localeCompare(parseDate(a));
    });

    for (const k of keys) {
      const table = catalog.sheets[k];
      if (table && typeof table === 'object' && table[pokeId]) {
        const rawMoves = table[pokeId];
        const newMoves = Array.isArray(rawMoves)
          ? rawMoves.map(m => {
              if (Array.isArray(m)) {
                return { name: m[0], type: m[1] || 'NORMAL', category: m[2] || 'PHYSICAL', power: m[3] || 0 };
              }
              return { name: m.name, type: m.type || 'NORMAL', category: m.category || 'PHYSICAL', power: m.power || 0 };
            })
          : [];

        const prev = catalog.previousAttacks?.get(pokeId) || (basePokeId ? catalog.previousAttacks?.get(basePokeId) : []) || [];
        const prevMap = new Map(prev.map(m => [m.name.toLowerCase(), m]));
        const newMap = new Map(newMoves.map(m => [m.name.toLowerCase(), m]));

        const added = [];
        const kept = [];
        const removed = [];

        for (const nm of newMoves) {
          const p = prevMap.get(nm.name.toLowerCase());
          if (!p) {
            added.push(nm);
          } else {
            kept.push({
              ...nm,
              prevCategory: p.category,
              prevPower: p.power,
              changedCategory: p.category !== nm.category,
              changedPower: p.power !== nm.power
            });
          }
        }

        for (const pm of prev) {
          if (!newMap.has(pm.name.toLowerCase())) {
            removed.push(pm);
          }
        }

        const moveCount = newMoves.length;
        const physical = newMoves.filter(m => m.category === 'PHYSICAL').length;
        const special = newMoves.filter(m => m.category === 'SPECIAL').length;

        const dateMatch = k.match(/(\d{4})_(\d{2})_(\d{2})/);
        const prettyDate = dateMatch ? `${dateMatch[3]}/${dateMatch[2]}/${dateMatch[1]}` : 'Recente';

        let typeName = 'Rework de Golpes';
        if (k.includes('MEGAS')) typeName = 'Rework de Mega';
        else if (k.includes('LENDARIOS')) typeName = 'Rework de Lendários';
        else if (k.includes('OUTLAND')) typeName = 'Rework Outland';
        else if (k.includes('SEGUNDA_EVO')) typeName = 'Rework 2ª Evolução';
        else if (k.includes('INICIAIS')) typeName = 'Balanceamento de Iniciais';
        else if (k.includes('PSEUDO')) typeName = 'Balanceamento de Pseudo-Lendários';

        return {
          hasRework: true,
          tableName: k,
          date: prettyDate,
          type: typeName,
          moveCount,
          physical,
          special,
          added,
          removed,
          kept
        };
      }
    }
    return null;
  };

  const rework = extractRework(species.pokeId);

  const megaAdvice = megaSpecies
    ? {
        name: megaSpecies.name,
        sprite: megaSprite,
        offense: offensiveProfile(megaSpecies, pk.level, catalog.stats.statsNoNivel(pk, megaSpecies, pk.level)),
        rework: extractRework(megaSpecies.pokeId, species.pokeId)
      }
    : null;

  return {
    megaAdvice,
    rework,
    offense: offensiveProfile(species, pk.level, stats),
    name: species.name,
    sprite: await catalog.portrait(species),
    legendary,
    nota: legendary ? null : result.nota,
    faixa: legendary ? 'Inestimável' : result.faixa,
    eixos: legendary ? null : result.eixos,
    stats,
    bases,
    ivTotal: Object.values(pk.ivs).reduce((a, b) => a + b, 0),
    hpCombat: Math.max(24, Math.round(stats.hp * 12)),
    power: rules.poderDePokemon(pk, species),
    mult: rules.multDeNascenca(pk.potencia, pk.shiny, legendary)
  };
}

const keys = ['hp', 'atk', 'def', 'spAtk', 'spDef', 'speed'];

function validate(input) {
  if (!input || typeof input !== 'object') throw new Error('Pedido inválido.');
  if (input.action === 'init') return { action: 'init' };
  const p = input.pokemon;
  if (!p || typeof p !== 'object') throw new Error('Preencha os dados do Pokémon.');
  const number = (v, min, max, integer = false) => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max || (integer && !Number.isInteger(v))) {
      throw new Error('Confira os valores da calculadora.');
    }
    return v;
  };
  const ivs = {},
    refino = {};
  for (const k of keys) {
    ivs[k] = number(p.ivs?.[k], 1, 32, true);
    if (k !== 'speed') refino[k] = number(p.refino?.[k] ?? 0, 0, 1000000, true);
  }
  if (typeof p.shiny !== 'boolean') throw new Error('Shiny inválido.');
  return {
    action: 'calculate',
    pokemon: {
      speciesId: number(p.speciesId, 1, 1000000, true),
      level: number(p.level, 1, 1000000, true),
      quality: number(p.quality, 0.8, 1.8),
      potencia: number(p.potencia, 1, 5, true),
      shiny: p.shiny,
      ivs,
      refino
    }
  };
}

module.exports = {
  validate,
  buildScript: input =>
    '(()=>{const offensiveProfile=' +
    require('./io-offensive-profile').offensiveProfile.toString() +
    ';return (' +
    calculate.toString() +
    ')(' +
    JSON.stringify(validate(input)) +
    ');})()'
};
