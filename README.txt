Presence Fusion combines several devices (Wi‑Fi / Smart Presence, Beacon, Nut, etc.) and writes Homey’s native presence. No custom Flow needed for multi-device presence — then use all built-in Homey Flow cards (someone is home, left…).

The widget can also force Home / Away (until you switch back to Auto) when a source is flaky. Force buttons are optional in the widget settings.

Homey API key (required)
Homey apps can read presence but cannot write it. Create a Homey Pro API key and paste it in this app’s settings:

1. my.homey.app → Settings → API Keys → New API Key
2. Check Presence (homey.presence)
3. Copy the key (shown once)
4. Apps → Presence Fusion → Configure → API key tab → Save

Avoid conflicts
For each managed person: turn off Homey location-based presence, and don’t use Flows/apps that also force home/away.

Setup
1. Save the API key
2. Enable a person, link devices, set mode and delays
3. (Optional) Add the Presence overview widget
