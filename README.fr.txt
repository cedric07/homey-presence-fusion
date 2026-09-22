Présence Fusion met à jour la présence native Homey à partir de plusieurs appareils (Wi‑Fi / Smart Presence, Beacon, Nut, etc.).

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
5. Utiliser les cartes Flow Homey natives

V1 gère uniquement la présence native (pas le sommeil).
Prévu en V2 : présence forcée, gestion du sommeil.
Défauts : fusion OU, confirmer présent 5 s, confirmer absent 60 s.
