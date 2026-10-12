# Controle remoto TCL

Este projeto usa dois componentes:

- `index.html`: interface estática publicada no GitHub Pages.
- `server.js`: backend Node.js que emparelha com a TV e envia os comandos.

O GitHub Pages não executa o backend. Para acessar o backend com segurança sem configurar o roteador, use Tailscale nos dispositivos que precisam acessar a TV.

## Publicar a interface

1. Crie um repositório GitHub para este projeto e envie os arquivos para a branch `main`.
2. No GitHub, abra **Settings > Pages** e escolha **GitHub Actions** como origem de publicação.
3. O workflow `.github/workflows/deploy-pages.yml` publica apenas `index.html`.
4. Aguarde o workflow concluir e anote a origem do site, como `https://usuario.github.io`. Para um domínio personalizado, use a origem configurada para o site.

## Configurar acesso privado ao backend

1. Instale e conecte Tailscale no PC que alcança a TV e no celular. Ambos devem entrar no mesmo tailnet.
2. Inicie o servidor pela tarefa **Iniciar controle remoto TCL** no VS Code.
3. Quando solicitado, informe a origem exata do GitHub Pages, sem caminho nem barra final. Deixe vazio para uso local sem o Pages.
4. Informe o IP local da TV quando a tarefa solicitar. O endereço fica na configuração local da tarefa e não deve ser incluído no repositório público.
5. No PC, execute `tailscale serve --bg 3000` em um terminal. O Tailscale mostrará um endereço HTTPS do tipo `https://nome-do-pc.nome-da-rede.ts.net`.
6. No celular, abra o endereço do GitHub Pages, informe o endereço HTTPS do Tailscale Serve e conecte-se.
7. Quando a TV solicitar o PIN, digite-o na interface e confirme.

O PC precisa permanecer ligado, com o servidor Node.js e Tailscale ativos. O celular precisa estar conectado ao mesmo tailnet. Não use Tailscale Funnel nem encaminhamento público da porta 3000: o backend não implementa autenticação de utilizadores.

## Desenvolvimento local

Instale as dependências com `npm install` e inicie `node server.js`. A interface também pode ser aberta na origem local indicada no terminal.
