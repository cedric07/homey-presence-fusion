Présence Fusion combine plusieurs appareils (Wi‑Fi / Smart Presence, Beacon, Nut, etc.) et écrit la présence native Homey. Plus besoin d’un Flow maison pour la présence multi-appareils : vous utilisez ensuite toutes les cartes Flow Homey natives (quelqu’un est à la maison, parti…).

Le widget peut aussi forcer Présent / Absent (jusqu’au retour à Auto) si une source est instable. Les boutons sont optionnels dans les réglages du widget.

Clé API Homey (obligatoire)
Les apps Homey peuvent lire la présence mais pas l’écrire. Créez une clé API Homey Pro et collez-la dans les réglages :

1. my.homey.app → Réglages → Clés API → Nouvelle clé API
2. Cocher Présence (homey.presence)
3. Copier la clé (affichée une seule fois)
4. Apps → Présence Fusion → Configurer → onglet Clé API → Enregistrer

Éviter les conflits
Pour chaque personne gérée : désactivez la présence par localisation Homey, et n’utilisez pas de Flows / apps qui forcent aussi présent/absent.

Mise en place
1. Enregistrer la clé API
2. Activer une personne, lier ses appareils, régler mode et délais
3. (Optionnel) Ajouter le widget Vue présence
