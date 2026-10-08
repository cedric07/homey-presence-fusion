# Presence Fusion

Homey Pro app that turns several devices into one reliable **native presence** (`user.present`). Link a phone / Smart Presence, Beacon, Nut, Find My, or similar — Fusion combines them so you get fewer false home / false away events. Built-in Homey Flow cards (“someone is home / left”) remain the automation surface — no custom multi-device presence Flow.

Fusion fuses the signals your detectors already provide (it does not replace them). Timing is limited by those sources, plus Fusion’s confirmation delays.

The **widget** can also **force** presence (Auto / Home / Away) until you manually return to Auto — useful when a source is flaky. Force buttons can be shown or hidden in the widget settings.

## Requirements

- Homey Pro (local), compatibility `>= 12.4.0`
- A **Homey API key** with **Presence** (write) — see below
- Homey **location-based presence disabled** for every managed person
- Fusion = **only writer** of presence for those people (no competing Flows / apps)

## Homey API key (required)

App sessions (`homey:manager:api` / `createAppAPI`) only get `homey.presence.readonly`.  
`setPresent` therefore returns `403 Missing Scopes` without an elevated key.

1. [my.homey.app](https://my.homey.app) → **Settings → API Keys → New API Key**
2. Check **Presence** (`homey.presence`)
3. Copy the key (shown **once**)
4. In Homey: **Apps → Presence Fusion → Configure**
5. Paste the key under **Homey API key** (**API key** tab) → **Save**

Without a key: the widget can still show up-to-date sources, but native presence never changes.

Writes use `HomeyAPI.createLocalAPI` with this key. Device / user reads stay on `createAppAPI`.

## Setup

1. Save the API key (above)
2. **People**: enable each Homey user to manage
3. **Sources**: search and link devices
4. **Capability**: check what Automatic selected — it should match the home / away signal; change it if needed
5. **Rules**: OR / AND / quorum mode + confirmation delays
6. Add the **Presence overview** widget to the dashboard (force buttons optional)
7. Use Homey’s **built-in Flow cards** on presence

Defaults: **OR** fusion, confirm home **5 s**, confirm away **60 s**.  
These delays add on top of any debounce already set on Smart Presence / Beacon, etc.

**Forced presence**: while active, fusion stops writing native presence. Switch back to **Auto** to resume fusion. A “Forced” badge also appears in the app settings.

## Development

```bash
npm install
homey app run --remote   # live logs on Homey Pro (no Docker needed)
homey app install        # install the build
```

Useful layout:

| Path | Role |
|------|------|
| `app.js` | Bootstrap, API key, presence writes |
| `lib/presenceEngine.js` | Fusion, delays, force, capability binds |
| `lib/fusion.js` | OR / AND / quorum modes |
| `settings/` | Configuration UI |
| `widgets/presence_overview/` | Dashboard widget (+ force) |

## Homey docs (App Store)

- `README.txt` — English (packaged with the app)
- `README.fr.txt` — French (packaged with the app)

This `README.md` is **excluded** from Homey deployment (see `.homeyignore`).

## License / support

- Issues: see the project’s GitHub repository
