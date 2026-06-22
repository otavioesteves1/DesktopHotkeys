# DesktopHotkeys

Painel de atalhos para Windows que abre por cima de tudo com um atalho de teclado — estilo "Stream Deck", só que via teclado. Cada quadradinho abre um site/programa, roda um comando, ou abre outra pasta de quadradinhos (sem limite de profundidade). Feito em Electron.

![Painel](docs/preview.png)

## Como usar

Grade fixa de 12 lugares com teclas no estilo StarCraft:

```
Q  W  E  R
A  S  D  F
Z  X  C  V
```

- **Abrir / fechar:** `Ctrl + Shift + Alt + P`
- **Escolher:** aperte a letra do quadradinho (`Q W E R / A S D F / Z X C V`)
- **Voltar uma pasta:** `Esc` ou `Backspace`
- **Ir pro início:** `Home`
- **Trocar de página** (mais de 12 itens): `Tab` ou setas `←` `→`
- Lugares vazios ("buracos") ficam visíveis, então cada botão mantém sempre a mesma tecla.
- O app fica na **bandeja** (perto do relógio). Botão direito → editar atalhos, abrir pasta, sair.

## Editar pela interface (sem mexer em arquivo)

Abra o painel → **✏️ Editar** (ou `Ctrl+E`). Aí dá pra:

- Clicar num lugar vazio (**＋**) pra criar, ou num botão pra editar.
- Definir nome, **ícone (emoji ou imagem/GIF)**, tipo (📁 Pasta ou ⚡ Ação) e, na ação, o que ela faz.
- **Arrastar** um botão para mover/reordenar entre os lugares.
- **🧩 Modelo** — define os campos padrão de um "projeto" (ex.: Autodesk: Arquivos, Problemas, Membros…), reordenáveis.
- **➕ Novo projeto** — com o modelo definido, cria um projeto preenchendo todos os links e a pasta numa tela só.

## Editar pelo arquivo

A configuração fica em **`config.json`** (criado a partir de `config.example.json` na primeira execução).
Cada item é uma `pasta` (lista `filhos`) ou uma `acao` (bloco `acao`). O número é automático, pela ordem.

Tipos de ação:

| Tipo | O que faz | Campos |
|------|-----------|--------|
| `abrir_url` | abre um site | `url` |
| `abrir_arquivo` | abre programa/arquivo/pasta | `caminho` (e opcional `argumentos`) |
| `executar_comando` | roda um comando | `comando`, `shell` (`cmd`/`powershell`) |
| `copiar_texto` | copia texto pra área de transferência | `texto` |
| `enviar_teclas` | envia teclas pro app que estava aberto | `teclas` |

## Rodar (desenvolvimento)

```bash
npm install
npm start
```

## Configurações (pela bandeja)

Botão direito no ícone da bandeja (perto do relógio) → **⚙️ Configurações**:

- **Atalho para abrir o painel** — clique em "Mudar atalho" e aperte a combinação que quiser
  (ex.: `Ctrl + Espaço`). Fica salvo no `config.json` (`"atalho"`).
- **Iniciar junto com o Windows** — liga/desliga o atalho na pasta Inicializar.

Também no menu da bandeja: **✏️ Editar tela inicial** (abre já no modo edição).

## Iniciar com o Windows

Liga pela tela de Configurações (acima), ou use o `DesktopHotkeys.vbs` (abre sem janela de
console) com um atalho na pasta Inicializar (`shell:startup`).

## Licença

MIT
