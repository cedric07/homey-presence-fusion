Présence Fusion transforme plusieurs appareils en une présence Homey fiable. Liez un téléphone / Smart Presence, Beacon, Nut, Find My ou équivalent — Fusion les combine et écrit la présence native Homey (qui est à la maison / parti).

Moins de faux présents et faux absents quand une seule source est instable. Vos Flows gardent les cartes Homey natives (quelqu’un est à la maison, parti…). Plus de Flow maison multi-appareils à entretenir.

Widget Vue présence (optionnel) : qui est là, l’état de chaque source, et forçage Présent / Absent / Auto si une source déraille.

Clé API Homey (obligatoire)
Homey n’autorise les apps à écrire la présence qu’avec une clé API. C’est ce qui permet à Fusion de marquer présent / absent selon vos appareils liés.
1. my.homey.app → Réglages → Clés API → Nouvelle clé API
2. Cocher Présence (homey.presence)
3. Copier la clé (affichée une seule fois)
4. Apps → Présence Fusion → Configurer → onglet Clé API → coller → Enregistrer

Mise en place
1. Enregistrer la clé API
2. Activer une personne, lier ses appareils
3. Après liaison, vérifier la capability choisie en Automatique — elle doit correspondre au signal présent / absent ; modifiez-la au besoin
4. Choisir un mode (OU / ET / quorum) et des délais de confirmation
5. (Optionnel) Ajouter le widget Vue présence

Éviter les conflits
Pour chaque personne gérée : désactivez la présence par localisation Homey, et n’utilisez pas de Flows / apps qui forcent aussi présent/absent.
