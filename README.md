# HusariaBot

Nowoczesny bot Discord napisany w TypeScript z panelem administracyjnym, systemem ticketów, kreatorem publikacji oraz bazą meczów G2 opartą o PandaScore + SQLite.

## Spis treści

1. Co to jest
2. Najważniejsze funkcje
3. Architektura
4. Wymagania
5. Szybki start
6. Konfiguracja środowiska
7. Komendy bota
8. Dashboard
9. Skrypty deweloperskie
10. Bezpieczeństwo i publikacja na GitHub
11. Troubleshooting
12. Licencja

## Co to jest

Projekt składa się z dwóch procesów:

1. Bot Discord
2. Dashboard webowy (Express + OAuth2 Discord)

Dzięki temu możesz oddzielić operacje moderatorskie i publikacyjne od pracy bezpośrednio w Discordzie.

## Najważniejsze funkcje

- Slash-komendy dla administracji i moderatorów.
- System ticketów z trwałym licznikiem.
- Tymczasowe kanały voice: wejście na kanał trigger tworzy kanal nick-voice i przenosi użytkownika.
- Grace period 10 sekund: pusty kanał voice jest usuwany z opóźnieniem, dzięki czemu użytkownik może wrócić po rozłączeniu.
- Kreator publikacji (Embedded i Wiadomość) z podglądem.
- Planowanie publikacji i edycja zaplanowanych postów.
- Historia wysłanych postów: edycja, retry eventu oraz usuwanie z historii.
- Zakładka Wydarzenia: szybkie tworzenie, edycja i usuwanie wydarzeń Discord.
- Baza meczów G2 z PandaScore (lokalnie w SQLite).
- Opcjonalne dodawanie podpowiedzi meczowych i tworzenie wydarzeń Discord w głównym kreatorze.
- Retry dla eventów Discord, gdy tworzenie się nie powiedzie + bezpieczny lifecycle przy edycji wysłanych postów.
- Testy jednostkowe/integracyjne w Vitest.

## Architektura

```text
src/
  commands/                 Slash komendy bota
  tickets/                  Logika ticketów
  voice-channels/           Tymczasowe kanały voice (create/move/cleanup)
  embeds/                   Szablony i budowanie embedów
  dashboard/
    routes/                 API dashboardu
    scheduler/              Scheduler postów
    g2-matches/             Integracja PandaScore + SQLite
    event-publisher.ts      Tworzenie wydarzeń Discord (wspólny flow)
    public/                 Frontend dashboardu
data/                       Dane lokalne (SQLite/JSON)
img/                        Biblioteka obrazów
```

## Wymagania

- Node.js 20.17+ (zalecane Node.js 22 LTS)
- npm 9+
- Bot i aplikacja Discord w Developer Portal

## Szybki start

1. Instalacja zależności:

```bash
npm install
```

2. Skopiuj plik środowiskowy:

```bash
copy .env.example .env
```

3. Uzupełnij wartości w .env.

4. Zarejestruj komendy:

```bash
npm run deploy
```

5. Uruchom bota:

```bash
npm run dev
```

6. Uruchom dashboard (opcjonalnie):

```bash
npm run dashboard
```

## Konfiguracja środowiska

Źródłem prawdy jest plik .env.example.

Najważniejsze zmienne:

| Zmienna | Wymagana | Opis |
| --- | --- | --- |
| DISCORD_TOKEN | tak | Token bota |
| CLIENT_ID | tak | Application ID |
| GUILD_ID | zalecane | Guild testowy (szybsza propagacja komend) |
| ADMIN_ROLE_ID | tak | Rola admina |
| MODERATOR_ROLE_ID | tak | Rola moderatora |
| SUPPORT_CATEGORY_ID | tak | Kategoria ticketów |
| VOICE_TRIGGER_CHANNEL_ID | tak (temp voice) | ID kanału voice trigger |
| VOICE_CATEGORY_ID | tak (temp voice) | ID kategorii dla tymczasowych kanałów voice |
| DISCORD_CLIENT_SECRET | tak (dashboard) | OAuth2 Client Secret |
| DISCORD_REDIRECT_URI | tak (dashboard) | OAuth redirect URI |
| DASHBOARD_SESSION_SECRET | tak (dashboard) | Secret sesji Express |
| DASHBOARD_SESSION_DB_PATH | nie | Ścieżka do SQLite store sesji dashboardu |
| DASHBOARD_SESSION_TTL_HOURS | nie | Czas życia sesji dashboardu (h) |
| DASHBOARD_TRUST_PROXY | nie | Zaufanie nagłówkom proxy (1/0) |
| DASHBOARD_PORT | nie | Port dashboardu (domyślnie 3000) |
| DASHBOARD_BASE_URL | tak (dashboard) | Publiczny URL do komendy /dashboard |
| PANDASCORE_API_KEY | tak (moduł G2) | API key PandaScore |
| DEV_LOGS | nie | Logi developerskie dashboardu (1/0) |
| BOT_DEV_LOGS | nie | Heartbeat i logi developerskie bota (1/0) |
| DASHBOARD_RATE_LIMIT_WINDOW_MS | nie | Okno limitu globalnego dashboardu (ms) |
| DASHBOARD_RATE_LIMIT_MAX | nie | Maksymalna liczba requestów globalnie na okno |
| DASHBOARD_AUTH_RATE_LIMIT_WINDOW_MS | nie | Okno limitu callbacku OAuth (ms) |
| DASHBOARD_AUTH_RATE_LIMIT_MAX | nie | Maksymalna liczba callbacków OAuth na okno |
| DASHBOARD_MUTATION_RATE_LIMIT_WINDOW_MS | nie | Okno limitu mutacji API (ms) |
| DASHBOARD_MUTATION_RATE_LIMIT_MAX | nie | Maksymalna liczba mutacji API na okno |

Zachowanie modułu temp voice:

1. Użytkownik wchodzi na VOICE_TRIGGER_CHANNEL_ID.
2. Bot tworzy kanał nazwa-uzytkownika-voice w VOICE_CATEGORY_ID i przenosi użytkownika.
3. Jeśli użytkownik miał już aktywny kanał tymczasowy, bot przenosi go do istniejącego kanału zamiast tworzyć nowy.
4. Gdy kanał opustoszeje, bot czeka 10 sekund i dopiero usuwa kanał (grace period na reconnect po rozłączeniu).

## Komendy bota

| Komenda | Opis | Dostęp |
| --- | --- | --- |
| /ping | Health check i latency | Admin/Moderator |
| /dashboard | Link do dashboardu | Admin/Moderator |
| /sendimg | Wysyłka obrazu z img | Admin/Moderator |
| /ticketyconfig | Konfiguracja panelu ticketów | Admin/Moderator |

## Dashboard

Domyślny adres: http://localhost:3000

Moduły dashboardu:

- Kreator publikacji (embedded/message).
- Zaplanowane posty.
- Wysłane posty (edycja, retry eventu, usuwanie wpisów z historii).
- Wydarzenia (Discord Scheduled Events: CRUD z poziomu panelu).
- Baza meczów G2 (PandaScore, filtry, odświeżanie + automatyczny refresh widoku po udanej synchronizacji).

Skrypty dashboardu:

- npm run dashboard
- npm run dashboard:dev

## Skrypty deweloperskie

- npm run dev
- npm run build
- npm start
- npm run deploy
- npm run clear-global
- npm test
- npm run test:watch

## Bezpieczeństwo i publikacja na GitHub

Przed commitem:

1. Nigdy nie commituj .env i .env.* z realnymi danymi.
2. Upewnij się, że do repo trafia tylko .env.example z placeholderami.
3. Sprawdź staged files:

```bash
git diff --cached --name-only
```

4. Jeśli sekret mógł wyciec, zrotuj natychmiast:
   - DISCORD_TOKEN
   - DISCORD_CLIENT_SECRET
   - PANDASCORE_API_KEY
   - DASHBOARD_SESSION_SECRET

Dodatkowe zasady:

- Operacje staff-only są chronione rolami.
- Dashboard waliduje payloady i grafiki przed publikacją.
- Dashboard używa tokenów CSRF dla mutacji API.
- Dashboard ma wielowarstwowy rate limiting (globalny + auth callback + mutacje API).
- Sesje dashboardu są trzymane w SQLite store zamiast domyślnego MemoryStore.
- Nie publikuj logów z danymi środowiskowymi.

## Troubleshooting

### Komendy nie pojawiają się na serwerze

1. Sprawdź CLIENT_ID i token.
2. Uruchom npm run deploy.
3. Przy komendach globalnych poczekaj na propagację.

### Logowanie do dashboardu nie działa

1. Redirect URI musi być identyczny jak w Discord Developer Portal.
2. Sprawdź DISCORD_CLIENT_SECRET.
3. Upewnij się, że użytkownik ma właściwą rolę staff.

### Baza meczów G2 nie odświeża się

1. Sprawdź PANDASCORE_API_KEY.
2. Zweryfikuj limity/rate limit po stronie PandaScore.
3. Sprawdź logi dashboardu (DEV_LOGS=1).

### Event Discord nie tworzy się

1. Bot musi mieć uprawnienie Manage Events.
2. Sprawdź GUILD_ID i obecność bota na serwerze.
3. Upewnij się, że data meczu jest w przyszłości.

### Build/test fail

```bash
npm run build
npm test
```

## Licencja

MIT
