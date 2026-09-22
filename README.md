# Présence Fusion

App Homey Pro qui fusionne plusieurs sources (téléphone / Smart Presence, Beacon, Nut, etc.) pour piloter la **présence native** Homey (`user.present`). Les Flows Homey natifs (« quelqu’un est à la maison / parti ») restent la surface d’automation.

Le **widget** permet aussi de **forcer** la présence (Auto / Présent / Absent) jusqu’à retour manuel à Auto — utile quand une source est flaky. L’affichage des boutons est optionnel dans les réglages du widget.

## Prérequis

- Homey Pro (local), compatibility `>= 12.4.0`
- Une **clé API Homey** avec le droit **Présence** (écriture) — voir ci-dessous
- Présence par **localisation Homey désactivée** pour chaque personne gérée
- Fusion = **seul writer** de présence pour ces personnes (pas de Flows / apps concurrents)

## Clé API Homey (obligatoire)

Les sessions app (`homey:manager:api` / `createAppAPI`) n’ont que `homey.presence.readonly`.  
`setPresent` renvoie donc `403 Missing Scopes` sans clé élevée.

1. [my.homey.app](https://my.homey.app) → **Réglages → Clés API → Nouvelle clé API**
2. Cocher **Présence** (`homey.presence`)
3. Copier la clé (affichée **une seule fois**)
4. Dans Homey : **Apps → Présence Fusion → Configurer**
5. Coller la clé sous **Clé API Homey** (onglet **Clé API**) → **Enregistrer**

Sans clé : le widget peut montrer les sources à jour, mais la présence native ne bouge pas.

L’écriture utilise `HomeyAPI.createLocalAPI` avec cette clé. La lecture devices / users reste en `createAppAPI`.

## Configuration

1. Enregistrer la clé API (ci-dessus)
2. **Personnes** : activer chaque utilisateur Homey à gérer
3. **Sources** : rechercher et lier les appareils
4. **Règles** : mode OU / ET / quorum + délais de confirmation
5. Ajouter le widget **Vue présence** au dashboard (boutons de forçage affichables ou non)
6. Utiliser les **cartes Flow Homey natives** sur la présence

Défauts : fusion **OU**, confirm présent **5 s**, confirm absent **60 s**.  
Ces délais s’ajoutent à ceux déjà configurés sur Smart Presence / Beacon, etc.

**Présence forcée** : tant qu’elle est active, la fusion n’écrit plus la présence native. Revenir à **Auto** pour reprendre la fusion. Un badge « Forcé » apparaît aussi dans les réglages de l’app.

## Développement

```bash
npm install
homey app run --remote   # logs live sur Homey Pro (pas besoin de Docker)
homey app install        # installer la build
```

Structure utile :

| Chemin | Rôle |
|--------|------|
| `app.js` | Bootstrap, clé API, écriture présence |
| `lib/presenceEngine.js` | Fusion, délais, forçage, bind capabilities |
| `lib/fusion.js` | Modes OU / ET / quorum |
| `settings/` | UI configuration |
| `widgets/presence_overview/` | Widget dashboard (+ forçage) |

## Documentation Homey (App Store)

- `README.txt` — anglais (packagé avec l’app)
- `README.fr.txt` — français (packagé avec l’app)

Ce `README.md` est **exclu du déploiement** Homey (voir `.homeyignore`).

## Licence / support

- Issues : voir le dépôt GitHub du projet
