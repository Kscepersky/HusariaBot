# HusariaBot

> Bot Discord dla społeczności **Husaria** — system ekonomii z levelami i coinsami, panel administracyjny z kreatorem postów i schedulerem, automatyczne kanały głosowe i tickety, watchparty z XP multiplierem, oraz pełne strukturowane logowanie z alertami.

---

## Spis treści

- [Funkcje](#funkcje)
- [Stack technologiczny](#stack-technologiczny)
- [Wymagania](#wymagania)
- [Instalacja](#instalacja)
- [Konfiguracja środowiska](#konfiguracja-środowiska)
- [Komendy slash](#komendy-slash)
- [Dashboard](#dashboard)
- [Architektura projektu](#architektura-projektu)
- [Testy](#testy)
- [Logowanie](#logowanie)

---

## Funkcje

### Ekonomia

- **XP i poziomy** — punkty doświadczenia za aktywność tekstową i głosową; cooldown per user; konfigurowalny krok XP za wiadomość i za minutę głosu
- **Dwa tryby levelowania** — `progressive` (skala wykładnicza) i `linear`; dwie formuły krzywej (`default`, `formula_v2`) — dobierane przez konfigurację per guild
- **Cebuliony (coins)** — waluta serwera; przyznawane za level-up, komendy daily i minuty watchparty
- **Daily z paskiem** — dzienna nagroda z configurowalnym zakresem coinsów, mnożnikiem streak (do konfigurowalnej liczby dni) i grace window
- **Leaderboard** — ranking top memberów po XP lub coinsach z paginacją, awatarami i wyróżnieniem aktualnego użytkownika
- **Karty levelów** — generowane graficznie (Canvas) z awatarem, paskiem XP, poziomem i globalną rangą
- **Import CSV** — masowy import snapshotów bazy: `userId,level,totalxp,messages,voiceMinutes`
- **Role ekonomiczne** — automatyczne przydzielanie ról Discord po osiągnięciu progu poziomu (konfigurowane z dashboardu)
- **Ochrona staff** — konfigurowalny zestaw ról zwolnionych z niektórych mechanizmów ekonomii

### Watchparty

- Tworzenie głosowych kanałów watchparty powiązanych z zaplanowanymi postami (własna kategoria Discord)
- Mnożnik XP i bonus coinów za każdą minutę aktywności na kanale watchparty
- Pełny lifecycle zarządzany przez bota: kanał otwiera się o zaplanowanej godzinie, zamykany gdy liczba użytkowników spadnie do zera lub upłynie czas

### Tymczasowe kanały głosowe

- Wejście na trigger channel → bot tworzy prywatny kanał głosowy dla użytkownika
- Kanał usuwany automatycznie gdy wszyscy wychodzą

### Tickety

- Panel ticketów konfigurowalny przez `/ticketyconfig` — publikuje interaktywny embed z przyciskami
- Historia wszystkich ticketów z persystencją w pliku JSON
- Licznik ticketów z gwarancją monotoniczności między restartami

### Timeouty (mute)

- Komenda `/mute` z wyborem czasu (minuty / godziny / dni) i powodem
- Realizacja przez dedykowaną rolę `SERVER_MUTE_ROLE_ID`
- Automatyczne zdjęcie roli po upływie czasu (persystencja przez restart przez SQLite)
- Historia timeoutów: kto nałożył, na jak długo, z jakim powodem

### Panel administracyjny (Dashboard)

Szczegóły w sekcji [Dashboard](#dashboard).

---

## Stack technologiczny

| Warstwa | Technologia |
|---|---|
| Język | TypeScript 6 |
| Runtime | Node.js |
| Discord | discord.js v14 |
| Web (dashboard) | Express v5 |
| Baza danych | SQLite (`sqlite` + `sqlite3`) |
| Walidacja wejść | Zod v4 |
| Generowanie grafik | Canvas |
| Sesje | express-session + SQLite store |
| Rate limiting | express-rate-limit |
| Testy | Vitest |
| Dev runner | tsx |
| Build | tsc |

---

## Wymagania

- **Node.js** v20+
- **npm** v9+
- Aplikacja w [Discord Developer Portal](https://discord.com/developers/applications) z włączonymi intentami: `GUILD_MEMBERS`, `GUILD_MESSAGES`, `MESSAGE_CONTENT`, `GUILD_VOICE_STATES`
- (Opcjonalnie) Klucz API [PandaScore](https://pandascore.co/) dla sekcji meczów G2

---

## Instalacja

```bash
# 1. Klonuj repo
git clone https://github.com/Kscepersky/HusariaBot.git
cd HusariaBot

# 2. Zainstaluj zależności
npm install

# 3. Skonfiguruj środowisko
cp .env.example .env
# Otwórz .env i uzupełnij wszystkie wartości

# 4. Zarejestruj komendy slash na serwerze
npm run deploy

# 5. Uruchom bota i dashboard (dwa osobne procesy)
npm run dev            # bot — tryb deweloperski (tsx watch)
npm run dashboard:dev  # dashboard — tryb deweloperski (tsx watch)

# Produkcja:
npm run build          # kompiluje TypeScript do dist/
npm start              # uruchamia bota z dist/
npm run dashboard      # uruchamia dashboard z dist/
```

> Bot i dashboard to dwa niezależne procesy Node.js. W produkcji uruchamiaj je jako osobne serwisy (np. dwie instancje PM2).

---

## Konfiguracja środowiska

Skopiuj `.env.example` do `.env` i uzupełnij wartości:

```env
# ── Discord Bot ─────────────────────────────────────────────────────────────
DISCORD_TOKEN=              # Token bota z Discord Developer Portal → Bot → Token
CLIENT_ID=                  # Application ID (Discord Developer Portal → General)
GUILD_ID=                   # ID twojego serwera (guild commands rejestrują się natychmiast)

# ── Role IDs ─────────────────────────────────────────────────────────────────
# Prawy klik na roli w Discordzie → "Kopiuj ID roli"
ADMIN_ROLE_ID=
MODERATOR_ROLE_ID=
COMMUNITY_MANAGER_ROLE_ID=
DEV_ROLE_ID=
SERVER_MUTE_ROLE_ID=        # Rola przyznawana przez komendę /mute

# ── Kategorie i kanały ────────────────────────────────────────────────────────
SUPPORT_CATEGORY_ID=        # Kategoria dla ticketów
VOICE_TRIGGER_CHANNEL_ID=   # Kanał głosowy — wejście tworzy prywatny kanal
VOICE_CATEGORY_ID=          # Kategoria dla tymczasowych kanałów głosowych
WATCHPARTY_CATEGORY_ID=     # Kategoria dla kanałów watchparty
LEVEL_UP_ANNOUNCE_CHANNEL_ID=   # Kanał ogłoszeń awansów (opcjonalny)

# ── Dashboard OAuth2 ──────────────────────────────────────────────────────────
# Discord Developer Portal → OAuth2 → General
DISCORD_CLIENT_SECRET=
DISCORD_REDIRECT_URI=http://localhost:3000/auth/discord/callback
DASHBOARD_PORT=3000
DASHBOARD_BASE_URL=http://localhost:3000
# Min. 32 losowe znaki: openssl rand -hex 32
DASHBOARD_SESSION_SECRET=
DASHBOARD_SESSION_TTL_HOURS=24
DASHBOARD_TRUST_PROXY=0     # Ustaw 1 jeśli dashboard stoi za reverse proxy (nginx/caddy)

# ── Rate limiting dashboardu ─────────────────────────────────────────────────
DASHBOARD_RATE_LIMIT_WINDOW_MS=900000
DASHBOARD_RATE_LIMIT_MAX=240
DASHBOARD_MUTATION_RATE_LIMIT_WINDOW_MS=60000
DASHBOARD_MUTATION_RATE_LIMIT_MAX=80
DASHBOARD_AUTH_RATE_LIMIT_WINDOW_MS=900000
DASHBOARD_AUTH_RATE_LIMIT_MAX=30

# ── Integracje zewnętrzne ────────────────────────────────────────────────────
PANDASCORE_API_KEY=             # Klucz PandaScore (opcjonalny — sekcja meczów G2)
LOG_ALERT_WEBHOOK_URL=          # Webhook Discord na kanał alertów (błędy error/fatal)

# ── Ścieżki (opcjonalne, domyślnie w katalogu roboczym) ─────────────────────
ECONOMY_DB_PATH=
DASHBOARD_SESSION_DB_PATH=

# ── Deweloperskie ─────────────────────────────────────────────────────────────
DEV_LOGS=1
BOT_DEV_LOGS=1
```

---

## Komendy slash

### Dostępne dla wszystkich

| Komenda | Opis |
|---|---|
| `/daily` | Odbierz dzienne cebuliony ze streak multiplierem |
| `/streak-daily` | Sprawdź aktualny streak i mnożnik daily |
| `/stankonta` | Pokaż aktualny stan swojego konta (cebuliony) |
| `/level` | Karta levelowa z XP, rangą i paskiem postępu |
| `/leaderboard-xp` | Ranking serwera po XP i poziomach |

### Tylko administracja

> Komendy z `setDefaultMemberPermissions(null)` — widoczne i dostępne wyłącznie dla osób z uprawnieniami skonfigurowanymi przez administratora serwera w ustawieniach integracji Discord.

| Komenda | Opis |
|---|---|
| `/dodaj-xp` | Dodaj XP wybranemu użytkownikowi (z opcjonalnym powodem) |
| `/dodaj-coinsy` | Dodaj cebuliony wybranemu użytkownikowi |
| `/usun-coinsy` | Usuń cebuliony wybranemu użytkownikowi |
| `/resetuj-level` | Zresetuj level i XP do zera (z potwierdzeniem) |
| `/resetuj-coinsy` | Zresetuj cebuliony do zera (z potwierdzeniem) |
| `/mute` | Nadaj timeout przez rolę Server Mute (czas + powód) |
| `/ticketyconfig` | Opublikuj panel ticketów na wskazanym kanale |
| `/sendimg` | Wyślij obraz z biblioteki `/img` na wybrany kanał |
| `/ping` | Sprawdź latencję bota i status połączenia z Discord |

---

## Dashboard

Dashboard to osobna aplikacja webowa. Logowanie odbywa się przez Discord OAuth2 — dostęp wyłącznie dla memberów z rolą administracyjną (Admin, Moderator, Community Manager, Dev).

### Kreator publikacji

Kreator umożliwia wysyłanie wiadomości na dowolny kanał tekstowy lub announcement serwera:

- **Tryb embed** — pełny edytor embeda: tytuł, opis, kolor, autor, footer, pole obrazu; podgląd Discord na żywo
- **Tryb plain text** — zwykła wiadomość Discord z pełnym markdownem i obsługą mentionów użytkowników/ról
- **Ping roli** — opcjonalny ping przed postem (bot weryfikuje istnienie roli przed wysłaniem)
- **Obraz** — attach z biblioteki serwerowej lub upload pliku (PNG, JPG, GIF, WebP; max 20 MB); SVG z pełną weryfikacją bezpieczeństwa
- **Podgląd na żywo** — WYSIWYG renderowany w przeglądarce przed wysłaniem

### Scheduler

- Planowanie publikacji na dowolną datę i godzinę
- Lista zaplanowanych postów z możliwością edycji, anulowania i natychmiastowej publikacji
- Automatyczne wykonanie przez wbudowany scheduler oparty na natywnych timerach Node.js
- Obsługa wielokrotnych restartów — scheduled posty przeżywają restart procesu (persystencja w JSON)

### Historia wysłanych postów

- Pełna historia wszystkich wysłanych i zaplanowanych postów ze statusami (`sent`, `pending`, `failed`, `cancelled`)
- Edycja treści i ponowne wysłanie istniejących postów
- Renderowanie mentionów `<@userId>` jako rzeczywistych nazw użytkowników (prefetch z Discord API)
- Statusy powiązanych eventów Discord i kanałów watchparty

### Ekonomia

- Leaderboard z rankingiem XP i coinów, paginacja, awatary pobierane z Discord
- Podgląd i edycja stanu konta dowolnego użytkownika (XP, coins, statsy)
- Masowy import danych przez CSV: `userId,level,totalxp,messages,voiceMinutes`
- Konfiguracja mapowań ról na poziomy (automatyczne przyznawanie ról po awansie)
- Statystyki serwera: wykresy aktywności (wiadomości, minuty głosowe), top userzy, configurowalny zakres dat

### Eventy Discord

- Tworzenie natywnych eventów Discord bezpośrednio z poziomu kreatora postów
- Opcjonalne powiązanie z kanałem watchparty

### Watchparty

- Tworzenie kanałów watchparty powiązanych ze zaplanowanymi postami
- Lifecycle: kanał otwiera się o wyznaczonym czasie, zamykany automatycznie
- Rollback kanału w przypadku błędu persystencji

### Baza meczów G2

- Integracja z PandaScore API — przeglądarka wyników i historii meczów drużyny G2 Esports
- Cache po stronie serwera

---

## Architektura projektu

```
src/
├── index.ts                    # Entry point bota Discord
├── deploy-commands.ts          # Rejestracja komend slash
│
├── commands/                   # Handlery komend slash (jeden plik = jedna komenda)
│   ├── daily.ts
│   ├── level.ts
│   ├── leaderboard-xp.ts
│   ├── mute.ts
│   ├── ticketyconfig.ts
│   └── ...
│
├── economy/
│   ├── types.ts                # Typy domenowe (EconomyConfig, EconomyUserState, ...)
│   ├── database.ts             # Inicjalizacja SQLite i migracje schematu
│   ├── repository.ts           # Data access layer — SQL + logika biznesowa
│   ├── runtime.ts              # Eventy bota: XP za wiadomości i voice (tick co minutę)
│   ├── stats-store.ts          # Daily stats aggregation i time-series
│   └── ...
│
├── voice-channels/             # Tymczasowe prywatne kanały głosowe
├── tickets/                    # System ticketów (panel + historia + licznik)
├── timeouts/                   # System timeoutów / mute z auto-expire
│
├── utils/
│   ├── logger.ts               # Strukturowany logger (.jsonl + .log + Discord webhook)
│   ├── embed-builder.ts        # Utility do budowania embedów
│   ├── role-access.ts          # Sprawdzanie uprawnień po rolach
│   └── ...
│
└── dashboard/
    ├── index.ts                # Entry point dashboardu (Express)
    ├── server.ts               # App setup, middleware, security headers
    ├── discord-api.ts          # Klient Discord REST API (Bot token)
    ├── publish-flow.ts         # Logika publikowania — ping, embed/tekst, obrazy
    ├── embed-handlers.ts       # Walidacja i budowanie payloadów embed
    ├── event-publisher.ts      # Tworzenie natywnych eventów Discord
    ├── watchparty-publisher.ts # Tworzenie i zamykanie kanałów watchparty
    ├── watchparty-lifecycle.ts # Zarządzanie cyklem życia watchparty
    │
    ├── routes/
    │   └── api.ts              # REST API dashboardu (~2700 linii, 60+ endpointów)
    │
    ├── scheduler/
    │   ├── service.ts          # Scheduler — Node.js timers, execute przy restarcie
    │   ├── store.ts            # Persystencja zaplanowanych postów (JSON)
    │   └── types.ts
    │
    ├── middleware/             # Autentykacja, autoryzacja, rate limiting, sesje
    ├── validation/             # Schematy Zod dla payloadów API
    ├── views/                  # HTML (dashboard.html, login.html)
    ├── public/
    │   ├── css/style.css       # Style dashboardu
    │   └── js/app.js           # Frontend SPA (vanilla JS, bez bundlera)
    └── g2-matches/             # PandaScore client, cache, typy
```

### Kluczowe wzorce projektowe

| Wzorzec | Gdzie używany |
|---|---|
| Repository Pattern | `economy/repository.ts` — warstwa SQL oddzielona od logiki |
| Immutable updates | Cały codebase — zakaz mutacji, wyłącznie spread + nowe obiekty |
| Structured logging | `utils/logger.ts` — każda operacja z `action`, `scope`, kontekstem, stack trace |
| Zod validation | Wszystkie endpointy API — walidacja na granicy systemu |
| Write lock (SQLite) | `economy/database.ts` — serializacja zapisów przez `Promise` chain |
| Session auth (OAuth2) | `middleware/` — Discord OAuth2, role check, CSRF |

---

## Testy

```bash
npm test              # Uruchom wszystkie testy (Vitest, tryb jednorazowy)
npm run test:watch    # Tryb watch — ponowne uruchomienie przy zmianach
```

Pokrycie testami:
- Logika ekonomii: XP, levele, daily, streak, CSV import
- Repozytoria: operacje SQL na in-memory SQLite
- Parsowanie i walidacja komend slash
- Moduły kanałów głosowych (store, flow, service)
- Handlery embedów dashboardu
- Klient PandaScore (parsowanie odpowiedzi API)

---

## Logowanie

Bot używa strukturowanego systemu logowania z `src/utils/logger.ts`. Każdy moduł tworzy własny logger przez `createLogger(scope)`.

**Wyjścia:**
- `logs/system-YYYY-MM-DD.jsonl` — structured JSON, jeden wpis na linię
- `logs/system-YYYY-MM-DD.log` — czytelny format dla oczu
- Discord webhook (`LOG_ALERT_WEBHOOK_URL`) — automatyczny alert przy `error` i `fatal`

**Scopy logerów:** `dashboard:api`, `dashboard:publish-flow`, `dashboard:scheduler`, i inne per moduł.

**Format wpisu `.jsonl`:**

```json
{
  "timestampIso": "2026-05-10T14:23:01.000Z",
  "timestampMs": 1746885781000,
  "level": "error",
  "action": "EMBED_SEND_FAILED",
  "scope": "dashboard:publish-flow",
  "message": "Nie udalo sie wyslac embeda do kanalu Discord.",
  "context": {
    "channelId": "123456789012345678",
    "mode": "embedded",
    "publishedByUserId": "987654321098765432"
  },
  "error": {
    "name": "DiscordRequestError",
    "message": "Missing Access",
    "stack": "..."
  }
}
```

---

## Licencja

MIT
