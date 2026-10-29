# Mefislink — Master Link Edition

Gerenciador multi-contas de alta performance para o jogo [PokeIdle](https://pokeidle.io), com suporte a até 4 contas simultâneas em uma única janela integrada.

---

## 🚀 Novidades da versão (v1.1.3)

- **Calculadora de Pokémon Integrada (Atalho Ctrl+K ou Menu Superior)**: Avaliação detalhada de IVs, notas de 0 a 10 (Forte, Razoável, Bom, Mítico, Divino, etc.), cálculo de HP de combate, multiplicador de nascimento e refinos sincronizados em tempo real com qualquer uma das suas 4 contas.
- **Detector de Balanceamento & Changelogs de Golpes**: Monitora atualizações e reworks oficiais de movesets direto dos servidores do PokeIdle, exibindo data do patch, golpes adicionados (+), removidos (-) e mudanças de categoria (Físico vs Especial) com tags coloridas dos tipos elementais.
- **Suporte Completo a Mega Evoluções**: Análise dinâmica do perfil ofensivo de todas as formas Mega, com alertas preditivos de IVs baixos e histórico de balanceamento da Mega.
- **Portabilidade Total**: Executável único pronto para envio (`Mefislink-v1.1.3-Portable.exe`). Não precisa instalar nada: basta dar dois cliques para abrir.

---

## 📦 Download e Como Compartilhar

Você e seus amigos podem baixar o executável pronto diretamente nas Releases do GitHub:
👉 **[Baixar Mefislink v1.1.3 Portable (Releases)](https://github.com/jaazielgvs/Mefislink/releases/latest)**

Não precisa instalar nada! Basta baixar o arquivo `Mefislink-v1.1.3-Portable.exe`, dar dois cliques para abrir e fazer login com as 4 contas normalmente. Também é possível compartilhar o executável diretamente via Discord, Drive ou Telegram.

---

## 🛠️ Como Executar e Recompilar

### Modo Desenvolvedor
```bash
npm start
```

### Gerar um novo executável Portable
```bash
npm run build:portable
```
O novo executável será gerado na pasta `dist/`.