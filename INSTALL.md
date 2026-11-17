# PLAssist — Guia de instalação

Este guia cobre as quatro peças do sistema:

1. a **VM do Hermes**, onde corre o servidor do avatar;
2. a **app no Mac**;
3. as **extensões dos browsers**;
4. o **Home Assistant**.

```
                     ┌──────────────── VM do Hermes ────────────────┐
  Hermes ──stdio──▶  │ mcp-server.js                                 │
                     │   :8080  WebSocket (app do Mac, extensões)    │
                     │   :3000  viewer web + /ws + /api + /health    │
                     └───────────────────────────────────────────────┘
        ▲ ws://VM:8080            ▲ ws://VM:8080             ▲ http(s)://…:3000/?embed=1
   App no Mac (Electron)   Extensão Chrome/Edge/Brave   Cartões do Home Assistant
```

O servidor do avatar é arrancado **pelo próprio Hermes** (servidor MCP por stdio). Por isso só está disponível enquanto o Hermes estiver a correr.

Instala por esta ordem: **VM → Mac → browsers → Home Assistant**.

---

## 0. Requisitos

| Onde | O quê |
|---|---|
| Mac | Node.js 20 LTS (`brew install node@20` ou nvm), Xcode Command Line Tools (`xcode-select --install`) |
| VM do Hermes | Node.js ≥ 18 (recomendado 20), `curl`, acesso SSH a partir do Mac (ideal com chave: `ssh-copy-id hermes@<IP_VM>`) |
| Rede | Mac/tablets → VM nas portas **8080** e **3000** |

Nos exemplos, `<IP_VM>` é o IP da VM do Hermes (p.ex. `192.168.50.X`).

---

## 1. VM do Hermes — copiar o código, compilar e instalar

### Opção A (recomendada): a partir do Mac, num só comando

No Mac, na pasta do projeto:

```bash
cd ~/Documents/src/plaiassist
bash hermes/deploy-to-hermes.sh hermes@<IP_VM>
# com token (recomendado se fores publicar o avatar fora de casa):
AVATAR_TOKEN='um-segredo-longo' bash hermes/deploy-to-hermes.sh hermes@<IP_VM>
```

O script faz isto:

1. Copia o código para `~/plaiassist-src` na VM com `rsync`. Fica de fora `node_modules`, `dist`, os backups e o `.git`.
2. Corre lá `hermes/install-hermes.sh`, que:
   - verifica o Node;
   - instala as dependências de build, sem descarregar o Electron e sem compilar módulos nativos;
   - compila só o servidor e o viewer web (`npm run build:vm`);
   - instala o resultado em `~/avatar-assistant` e a skill em `~/.hermes/skills/avatar-assistant/SKILL.md`;
   - arranca o servidor por momentos para confirmar que responde (`/health`).

Para atualizar mais tarde, corre o mesmo comando outra vez e reinicia o Hermes.

### Opção B: manualmente na VM

Copia o código (`scp -r`, `git clone`…) e depois corre:

```bash
ssh hermes@<IP_VM>
cd ~/plaiassist-src
bash hermes/install-hermes.sh            # instala em ~/avatar-assistant
```

Se o Node não existir:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs
```

### Configurar o Hermes

Acrescenta ao `~/.hermes/config.yaml`. O script mostra este bloco já com os caminhos certos:

```yaml
mcp_servers:
  avatar-assistant:
    command: "node"
    args:
      - "/home/hermes/avatar-assistant/dist/mcp-server.js"
    env:
      AVATAR_HTTP_PORT: "3000"
      AVATAR_WS_PORT: "8080"
      # AVATAR_TOKEN: "um-segredo-longo"   # obrigatório se publicares fora da rede local
```

Reinicia o Hermes. Se a VM tiver firewall, abre as portas:

```bash
sudo ufw allow 3000/tcp && sudo ufw allow 8080/tcp
```

### Verificar

```bash
curl http://<IP_VM>:3000/health        # → {"ok":true,"name":"avatar-assistant",...}
```

No browser, `http://<IP_VM>:3000` mostra o avatar. Pede ao Hermes "acena-me" e ele deve reagir.

**Token:** com `AVATAR_TOKEN` definido, todos os clientes acrescentam `?token=…` ao endereço:

| Cliente | Endereço |
|---|---|
| App e extensão | `ws://<IP_VM>:8080/?token=…` |
| Viewer | `http://<IP_VM>:3000/?embed=1&token=…` |
| API | cabeçalho `x-avatar-token: …` |

---

## 2. App no Mac

### Correr a partir do código (desenvolvimento / uso pessoal)

```bash
cd ~/Documents/src/plaiassist
npm install          # o robotjs é opcional: se falhar a compilar, não faz mal
npm run build
npm start
```

A app arranca sem ícone na Dock. O avatar aparece no ecrã e há um ícone na barra de menus.

Clica com o botão direito no avatar (ou usa o ícone da barra de menus) para:

- mudar de modo;
- abrir as **Configurações**;
- sair.

### Criar a app instalável (.dmg)

```bash
npm run build
npx electron-builder --mac dmg --arm64     # Mac M1/M2/M3 (mais rápido que gerar as duas arquiteturas)
# ou: npm run package:dmg                 # x64 + arm64
```

O instalador fica em `build/Avatar Assistant-<versão>-arm64.dmg`. Abre-o e arrasta a app para **Aplicações**.

A app não está assinada. Na primeira abertura, faz botão direito → **Abrir** → **Abrir**. Se o macOS disser que está danificada, corre:

```bash
xattr -dr com.apple.quarantine "/Applications/Avatar Assistant.app"
```

### Permissões do macOS

| Permissão | Para quê | Onde |
|---|---|---|
| **Gravação de ecrã** | Ver linhas e texto do ecrã para andar sobre eles (sem ela só anda no fundo do ecrã) | Definições do Sistema → Privacidade e Segurança → Gravação de ecrã → ativar *Avatar Assistant* (ou *Electron* se correres com `npm start`) e reabrir a app |
| Microfone | Entrada de voz (opcional) | pedido automaticamente |

### Ligar ao Hermes

1. Abre **Configurações → Advanced → Ligação ao Hermes**.
2. Escreve o IP da VM, p.ex. `192.168.50.X`. Fica `ws://192.168.50.X:8080`.
3. Carrega em **Testar ligação**. Deve aparecer ✅ "Servidor do avatar do Hermes a responder".
4. Carrega em **Save**. O indicador passa a "Avatar ligado a ws://…".
5. Desmarca **Iniciar também um servidor local**: com o Hermes não é preciso.

Se o teste falhar, a mensagem indica a causa provável:

- **Ligação recusada:** o Hermes ainda não arrancou o servidor, ou a porta está errada.
- **Máquina inacessível:** problema de rede ou firewall.
- **Token inválido:** falta o `?token=…` ou está errado.

### Arrancar com o Mac

Definições do Sistema → Geral → **Itens de início de sessão** → `+` → *Avatar Assistant*.

---

## 3. Extensões dos browsers

A extensão põe o avatar a andar por cima das páginas web. Esconde-se sozinha quando a app do Mac está visível.

### Compilar

```bash
cd ~/Documents/src/plaiassist
npm run build:extension          # → dist/extension
```

### Chrome, Edge, Brave, Arc, Opera (Chromium)

1. Abre a página de extensões:

   | Browser | Endereço |
   |---|---|
   | Chrome / Arc | `chrome://extensions` |
   | Edge | `edge://extensions` |
   | Brave | `brave://extensions` |
   | Opera | `opera://extensions` |

2. Ativa o **Modo de programador** (canto superior direito; no Edge é no menu lateral).
3. Clica em **Carregar descompactada** e escolhe a pasta `dist/extension`.
4. Afixa o ícone *PLAssist* na barra de ferramentas.
5. No popup da extensão, define:
   - **Servidor:** `ws://<IP_VM>:8080` (mais `/?token=…` se usares token);
   - modo (seguir / passear / ficar);
   - tamanho;
   - **Passear quando estou inativo**;
   - **Esconder nesta página** / **Esconder em todo o lado**.
6. Recarrega as páginas que já estavam abertas.

**Atualizar:** depois de `npm run build:extension`, carrega em ↻ no cartão da extensão em `chrome://extensions`.

As extensões carregadas "descompactadas" ficam enquanto a pasta existir. Não apagues nem movas `dist/extension`, ou copia-a primeiro para um sítio fixo, p.ex. `~/Applications/plaiassist-extension`.

### Safari e Firefox

Ainda não são suportados. O Safari exige converter a extensão num projeto Xcode (`xcrun safari-web-extension-converter`). O Firefox usa outro formato de *background* no Manifest V3.

---

## 4. Home Assistant

O viewer servido pela VM pode ser embutido em dashboards. Parâmetros do URL:

| Parâmetro | Efeito |
|---|---|
| `embed=1` | Sem botões nem indicador de estado, fundo transparente |
| `bg=%23111827` | Cor de fundo (`%23` = `#`) |
| `voice=1` | Este ecrã também fala (por defeito fica calado quando embutido, para não falarem vários dispositivos ao mesmo tempo). O browser só toca som depois de um primeiro toque no ecrã |
| `token=…` | Necessário se `AVATAR_TOKEN` estiver definido |

### 4.1 Na rede local (HA aberto por `http://`)

Basta um cartão **Página Web** (*Webpage*). Editar painel → Adicionar cartão → Página Web, ou em YAML:

```yaml
type: iframe
url: http://192.168.50.X:3000/?embed=1
aspect_ratio: 120%
```

### 4.2 Fora de casa / HA aberto por HTTPS (DuckDNS + Nginx Proxy Manager)

Uma página HTTPS não pode embutir um `http://`: o browser bloqueia o conteúdo misto e o cartão fica em branco. Publica o avatar com HTTPS no Nginx Proxy Manager:

1. **Token:** define o `AVATAR_TOKEN` na VM (secção 1) e reinicia o Hermes.
2. **Proxy host:** no NPM, em **Hosts → Proxy Hosts → Add Proxy Host**:
   - **Domain Names:** `avatar.<teu-dominio>.duckdns.org` (os subdomínios DuckDNS apontam para o mesmo IP);
   - **Scheme / Forward Host / Port:** `http` · `<IP_VM>` · `3000`;
   - ✅ **Websockets Support** (essencial: o avatar recebe os comandos por `wss://…/ws`);
   - ✅ Block Common Exploits;
   - separador **SSL:** *Request a new SSL Certificate*, ✅ Force SSL, ✅ HTTP/2.
3. **Router:** se o NPM já serve outros nomes, as portas 80/443 já estão encaminhadas e não é preciso mais nada.
4. **Testar:** abre `https://avatar.<teu-dominio>.duckdns.org/health` e depois `https://avatar.<teu-dominio>.duckdns.org/?embed=1&token=…`.

Cartão:

```yaml
type: iframe
url: https://avatar.<teu-dominio>.duckdns.org/?embed=1&token=um-segredo-longo
aspect_ratio: 120%
```

Usa um subdomínio próprio, e não um sub-caminho como `/avatar`, porque o canal de comandos é sempre `/ws` na raiz.

### 4.3 Exemplos de cartões

**Avatar ao lado do estado da casa** (vertical stack):

```yaml
type: vertical-stack
cards:
  - type: iframe
    url: http://192.168.50.X:3000/?embed=1
    aspect_ratio: 100%
  - type: entities
    title: Hermes
    entities:
      - entity: sensor.hermes_status            # se tiveres um sensor do Hermes
```

**Tablet de parede que fala** (só neste ecrã, com fundo do tema escuro):

```yaml
type: iframe
url: http://192.168.50.X:3000/?embed=1&voice=1&bg=%23111827
aspect_ratio: 140%
```

**Painel lateral inteiro só com o avatar:** Definições → Painéis → **Adicionar painel** → *Página Web*:

- URL: `http://192.168.50.X:3000/?embed=1`
- Título: *Hermes*
- Ícone: `mdi:account-voice`

**Só no tablet / só para um utilizador** (cartão condicional):

```yaml
type: conditional
conditions:
  - condition: user
    users:
      - <id do utilizador do tablet>
card:
  type: iframe
  url: http://192.168.50.X:3000/?embed=1&voice=1
  aspect_ratio: 140%
```

### 4.4 O Home Assistant a mandar no avatar (automações e botões)

O servidor tem uma API simples, `POST /api/express`. Aceita:

| Campo | Exemplo |
|---|---|
| `emotion` | `happy`, `surprised`, `thinking`… |
| `pose` | `waving`, `pointing`, `celebrating`, `auto`… |
| `speechText` | o texto do balão |
| `holdSeconds` | duração da pose |

Em `configuration.yaml`:

```yaml
rest_command:
  avatar_express:
    url: "http://192.168.50.X:3000/api/express"
    method: POST
    content_type: "application/json"
    headers:
      x-avatar-token: !secret avatar_token        # só se usares AVATAR_TOKEN
    payload: >-
      {{ {"emotion": emotion | default('happy'),
          "pose": pose | default('waving'),
          "speechText": text | default(''),
          "holdSeconds": hold | default(8)} | to_json }}
```

Em `secrets.yaml`: `avatar_token: um-segredo-longo`. Depois reinicia o HA.

**Botão num painel:**

```yaml
type: button
name: Hermes, acena!
icon: mdi:hand-wave
tap_action:
  action: perform-action
  perform_action: rest_command.avatar_express
  data:
    emotion: happy
    pose: waving
    text: Olá! 👋
```

**Automação: tocaram à campainha:**

```yaml
alias: Avatar avisa campainha
triggers:
  - trigger: state
    entity_id: binary_sensor.doorbell_ring        # a tua entidade da campainha
    to: "on"
actions:
  - action: rest_command.avatar_express
    data:
      emotion: surprised
      pose: pointing
      text: Está alguém à porta!
      hold: 10
```

Tudo o que é enviado assim aparece em todos os avatares ligados: app do Mac, extensões e dashboards.

---

## 5. Resolução de problemas

| Sintoma | Causa / solução |
|---|---|
| App: "Servidor local parado" | Normal se usas o Hermes: desmarca *Iniciar também um servidor local*. Se o quiseres, a linha *Motivo* diz porquê (p.ex. porta ocupada) |
| App: "Avatar sem ligação a ws://…" | O Hermes não está a correr, o `config.yaml` não tem o `mcp_servers`, ou há uma firewall na VM. Testa `curl http://<IP_VM>:3000/health` |
| Cartão do HA em branco | HA em HTTPS com URL `http://`: usa o proxy HTTPS (4.2) |
| Avatar no HA não reage | No NPM falta **Websockets Support**, ou o token está errado |
| Extensão não aparece | Recarrega a página. Vê se a app do Mac está visível (a extensão esconde-se) e se o site não está em *Esconder nesta página* |
| Avatar só anda no fundo do ecrã (Mac) | Falta a permissão de **Gravação de ecrã** |
| Na VM: `Cannot find module @rollup/rollup-linux-…` | Apaga `node_modules` e `package-lock.json` em `~/plaiassist-src` e volta a correr o `install-hermes.sh` |
