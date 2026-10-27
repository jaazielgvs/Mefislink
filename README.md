# Mefislink

Gerenciador multi-contas para o jogo [PokeIdle](https://pokeidle.io) com suporte a até 4 contas simultâneas em uma única janela.

---

## 🚀 Novidades da versão (v1.1)

- **Minimizar para a Bandeja (Ícones Ocultos)**: Ao clicar no "X" para fechar, o Mefislink continua rodando em segundo plano sem interromper o farm das contas. Reabra com um clique no ícone da bandeja ou encerre através do botão direito > *Encerrar o Mefislink* (ou pelo menu *Ajuda > Encerrar*).
- **Instância Única (Single Instance)**: Se tentar abrir o programa novamente enquanto ele estiver minimizado nos ícones ocultos, a janela atual é trazida para a frente automaticamente, evitando duplicatas.
- **Barra Superior Mais Limpa**: Removida a aba de atualizações para simplificar o menu.
- **Portabilidade Total**: Executável único pronto para envio (`Mefislink-Portable.exe`). Seus amigos não precisam instalar nada: basta dar dois cliques para abrir.
- **Gerenciamento de Dados**:
  - Por padrão, cada computador salva os logins de forma segura e independente em `%APPDATA%\Mefislink`.
  - Se preferir usar em um Pendrive de forma 100% isolada, basta criar uma pasta chamada `mefislink-data` na mesma pasta do executável.

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
