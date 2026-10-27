# Mefislink

Gerenciador multi-contas para o jogo [PokeIdle](https://pokeidle.io) com suporte a até 4 contas simultâneas em uma única janela.

---

## 🚀 Novidades desta versão (Mefislink)

- **Renomeação completa**: Todas as referências visuais e internas foram atualizadas para **Mefislink**.
- **Remoção da Autocompra**: O serviço de autocompra no Market (poções, pokébolas e revives) foi completamente removido, garantindo conformidade com o seu estilo de jogo.
- **Portabilidade Total**: Executável único pronto para envio (`Mefislink-Portable.exe`). Seus amigos não precisam instalar nada: basta dar dois cliques para abrir.
- **Gerenciamento de Dados**:
  - Por padrão, cada computador salva os logins de forma segura e independente em `%APPDATA%\Mefislink`.
  - Se preferir usar em um Pendrive de forma 100% isolada, basta criar uma pasta chamada `mefislink-data` na mesma pasta do executável.
- **Independência**: Removido o feed de atualização remota do autor anterior para impedir que o executável seja sobrescrito.

---

## 📦 Como Compartilhar com Amigos

O arquivo pronto para envio está localizado em:
`dist/Mefislink-Portable.exe`

Basta enviar esse arquivo (via Google Drive, Discord, Telegram, etc.) para os seus amigos. Eles só precisam executar o arquivo e fazer login com as 4 contas normalmente.

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
