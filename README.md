# Mefislink — Master Link Edition

Gerenciador multi-contas de alta performance para o jogo [PokeIdle](https://pokeidle.io), com suporte a até 4 contas simultâneas em uma única janela integrada.

---

## 🚀 Novidades da versão (v1.1.1)

- **Sessão /hunt Mais Limpa**: Removido o botão e banner de "Apoie o dev" de dentro da janela do /hunt para um visual mais focado no jogo.
- **Novo Ícone (Master Ball Edition)**: Ícone oficial inspirado na Master Ball em alta definição para o executável, barra de tarefas e bandeja do sistema.
- **Minimizar para a Bandeja (Ícones Ocultos)**: Ao clicar no "X" para fechar, o Mefislink continua rodando em segundo plano sem interromper o farm das contas. Reabra com um clique no ícone da bandeja ou encerre através do botão direito > *Encerrar o Mefislink* (ou pelo menu *Ajuda > Encerrar*).
- **Instância Única (Single Instance)**: Se tentar abrir o programa novamente enquanto ele estiver minimizado nos ícones ocultos, a janela atual é trazida para a frente automaticamente, evitando duplicatas.
- **Barra Superior Mais Limpa**: Removida a aba de atualizações para simplificar o menu.
- **Portabilidade Total**: Executável único pronto para envio (`Mefislink-v1.1.1-Portable.exe`). Não precisa instalar nada: basta dar dois cliques para abrir.
- **Gerenciamento de Dados**:
  - Por padrão, cada computador salva os logins de forma segura e independente em `%APPDATA%\Mefislink`.
  - Se preferir usar em um Pendrive de forma 100% isolada, basta criar uma pasta chamada `mefislink-data` na mesma pasta do executável.

---

## 📦 Download e Como Compartilhar

Você e seus amigos podem baixar o executável pronto diretamente nas Releases do GitHub:
👉 **[Baixar Mefislink v1.1.1 Portable (Releases)](https://github.com/jaazielgvs/Mefislink/releases/latest)**

Não precisa instalar nada! Basta baixar o arquivo `Mefislink-v1.1.1-Portable.exe`, dar dois cliques para abrir e fazer login com as 4 contas normalmente. Também é possível compartilhar o executável diretamente via Discord, Drive ou Telegram.

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