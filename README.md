# D4 Manifeste App

Application web mono-utilisateur pour lire, éditer et enrichir le manifeste stratégique de **D4 Immobilier**.

**URL** : [https://marcdelestrade.github.io/manifesteD4](https://marcdelestrade.github.io/manifesteD4)

## Architecture

- **Frontend** : HTML / CSS / JavaScript vanilla, zéro framework, zéro build
- **Stockage** : API GitHub REST → repo privé [`manifesteD4-data`](https://github.com/marcdelestrade/manifesteD4-data)
- **IA** : API Anthropic (Claude Sonnet 4.5) — appels directs depuis le navigateur
- **Hébergement** : GitHub Pages

## Premier lancement

1. Ouvrir l'URL ci-dessus
2. Saisir dans l'écran de configuration :
   - GitHub username : `marcdelestrade`
   - Repo données : `manifesteD4-data`
   - Personal Access Token GitHub (scope `repo`)
   - Clé API Anthropic
3. Les identifiants sont stockés **uniquement dans le navigateur** (localStorage), jamais envoyés ailleurs.

## Structure

```
manifesteD4/
├── index.html       # Point d'entrée + config screen + app
├── style.css        # Styles + responsive (desktop / tablette / mobile)
├── app.js           # Orchestration + state + UI bindings
├── github.js        # API GitHub (lecture/écriture JSON)
├── anthropic.js     # API Anthropic (Phase 2)
├── editor.js        # Éditeur markdown split-view
└── README.md
```

Les données vivent dans le repo privé séparé `manifesteD4-data` :

```
manifesteD4-data/
└── data/
    ├── manifeste.json   # 52 sections H1/H2/H3
    ├── taches.json
    ├── projets.json
    └── memoire.json
```

## Statut

- ✅ **Phase 1 (MVP)** : config, chargement GitHub, TOC, éditeur markdown, auto-save
- 🚧 Phase 2 : assistant IA, tâches, projets, onglet Générer
- 🚧 Phase 3 : polish, raccourcis clavier, historique versions

## Développement local

```bash
# Servir en local (ES modules nécessitent HTTP, pas file://)
python3 -m http.server 8080
open http://localhost:8080
```
