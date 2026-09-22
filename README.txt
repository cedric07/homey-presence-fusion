Presence Fusion updates Homey’s native user presence from several devices you choose (Wi‑Fi / Smart Presence, Beacon, Nut, etc.).

IMPORTANT — Homey API key (required)
Homey apps can read presence but cannot write it (Athom scope limit: presence.readonly only).
Create a Homey Pro API key and paste it in this app’s settings:

1. Open my.homey.app → Settings → API Keys → New API Key
2. Check **Presence** (`homey.presence`)
3. Copy the key (shown once) and store it safely
4. Apps → Presence Fusion → Configure → API key tab → paste → Save

Without this key, sources update in the widget but native presence never changes.

Also important
Disable Homey location-based presence for managed users, or Homey and this app will overwrite each other.
Don’t use Flows/apps that also set the same user’s presence — Fusion should be the only writer.

Setup
1. Save a Homey API key with Presence (see above)
2. People: enable each Homey user to manage
3. Sources: search & link their devices
4. Rules: OR/AND + confirmation delays
5. Use Homey’s built-in presence Flow cards

Defaults: OR fusion, confirm home 5s, confirm away 60s.
