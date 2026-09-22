Présence Fusion met à jour la présence native Homey à partir de plusieurs appareils (Wi‑Fi / Smart Presence, Beacon, Nut, etc.).

Le widget dashboard peut aussi forcer la présence (Auto / Présent / Absent) jusqu’au retour manuel à Auto — utile si une source est instable. Les boutons de forçage sont affichables ou non dans les réglages du widget.

IMPORTANT — Clé API Homey (obligatoire)
Les apps Homey peuvent lire la présence mais pas l’écrire (limite Athom : presence.readonly seulement).
Créez une clé API Homey Pro et collez-la dans les réglages de cette app :

1. Ouvrir my.homey.app → Réglages → Clés API → Nouvelle clé API
2. Cocher **Présence** (`homey.presence`)
3. Copier la clé (affichée une seule fois) et la conserver en sécurité
4. Apps → Présence Fusion → Configurer → onglet Clé API → coller → Enregistrer

Sans cette clé, les sources se mettent à jour dans le widget mais la présence native ne change jamais.

Aussi important
Désactivez la présence par localisation Homey pour les utilisateurs gérés, sinon Homey et cette app s’écrasent.
N’utilisez pas de Flows / apps qui modifient aussi la présence de la même personne — Fusion doit être le seul writer.

Mise en place
1. Enregistrer une clé API Homey avec Présence (voir ci-dessus)
2. Personnes : activer chaque utilisateur Homey
3. Sources : rechercher & lier leurs appareils
4. Règles : OU/ET + délais de confirmation
5. Ajouter le widget Vue présence (boutons de forçage optionnels)
6. Utiliser les cartes Flow Homey natives

Présence forcée : tant qu’elle est active, la fusion n’écrit plus la présence native. Revenir à Auto pour reprendre la fusion.

Défauts : fusion OU, confirmer présent 5 s, confirmer absent 60 s.
