# Controle remoto TCL

Este projeto usa dois componentes:

- `index.html`: interface estática publicada no GitHub Pages.
- `server.js`: backend Node.js que emparelha com a TV e envia os comandos.

O GitHub Pages não executa o backend. Para acessar o backend com segurança sem configurar o roteador, use Tailscale nos dispositivos que precisam acessar a TV.

## Publicar a interface

1. Crie um repositório GitHub para este projeto e envie os arquivos para a branch `main`.
2. No GitHub, abra **Settings > Pages**, escolha **Deploy from a branch**, selecione `main` e a pasta `/ (root)`, e salve.
3. O GitHub Pages publica a partir da branch `main`. Aguarde o primeiro build e acesse `https://operacaoindustria-boop.github.io/controleremotopw/`.

## Conectar à TV

1. O PC que executa o backend precisa estar ligado na mesma rede da TV. Inicie o servidor pela tarefa **Iniciar controle remoto TCL** no VS Code; não é necessário informar o IP da TV.
2. Para usar a página do GitHub Pages, instale e conecte Tailscale no PC e no celular, colocando ambos no mesmo tailnet.
3. No PC, execute `tailscale serve --bg 3000`. O Tailscale mostrará um endereço HTTPS do tipo `https://nome-do-pc.nome-da-rede.ts.net`.
4. Abra o GitHub Pages no celular e informe esse endereço do Tailscale Serve uma única vez. A interface buscará TVs na rede do PC; escolha a sua na lista.
5. No primeiro pareamento, digite na interface o código solicitado pela TV. O backend salva a identidade do pareamento localmente para reconectar sem pedir o código em quedas futuras.

Também é possível acessar a interface servida pelo próprio backend em `http://IP-DO-PC:3000` quando o celular está na mesma rede Wi-Fi. Nesse caso, o navegador já se conecta ao backend local e não é necessário configurar o Tailscale para uso dentro de casa.

O PC precisa permanecer ligado e com o servidor Node.js ativo. Para acesso pelo GitHub Pages, Tailscale também deve permanecer conectado no PC e no celular. Não use Tailscale Funnel nem encaminhamento público da porta 3000: o backend não implementa autenticação de utilizadores.

## Desenvolvimento local

Instale as dependências com `npm install` e inicie `node server.js`. A interface também pode ser aberta na origem local indicada no terminal.
