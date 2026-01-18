# Bienvenue

Ce projet _sandbox_, à but non lucratif, recrée l'ambiance des salons de discussion de l'époque AOL/AIM ; il est accessible à l'adresse : https://pdraim.org.

## Technologies utilisées

- SvelteKit (version 5)
- Node.js
- TypeScript
- Convex (base de données temps réel)
- XP.css
- Tailwind CSS

## Prérequis

- Node.js (>=22.13.0)
- npm ou pnpm pour la gestion des packages

## Installation

Clonez le dépôt et installez les dépendances :

```bash
npm install
# ou
pnpm install
```

## Lancement du projet

Lancez le projet en mode développement :

```bash
npm run dev
# ou
pnpm dev
```

Le site sera accessible via http://localhost:5173 par défaut.

## Contribution

Toute contribution visant à améliorer le réalisme et la qualité du projet est la bienvenue !
Pour contribuer :

- Forkez ce dépôt
- Créez une branche pour vos modifications
- Envoyez une pull request en décrivant clairement vos changements

## Base de données

Le projet utilise [Convex](https://convex.dev/) comme base de données temps réel. Convex gère automatiquement les mises à jour en temps réel des messages et de la liste des utilisateurs.

### Configuration locale

1. Créez un compte sur [Convex](https://convex.dev/) et un nouveau projet
2. Copiez `.env.example` vers `.env.local` et remplissez les variables :
   - `PUBLIC_CONVEX_URL` : URL de votre déploiement Convex
   - `CONVEX_API_SECRET` : Clé secrète pour les appels serveur

### Lancer Convex en développement

Dans un terminal séparé, lancez le serveur Convex :

```bash
npx convex dev
```

Cela synchronise automatiquement vos fonctions backend avec Convex et affiche les logs en temps réel.

### Dashboard Convex

Vous pouvez visualiser et gérer vos données via le dashboard Convex :

```bash
npx convex dashboard
```

## Déploiement Cloudflare Pages

Le projet est déployé sur [Cloudflare Pages](https://pages.cloudflare.com/). Les Workers Cloudflare ont des **limitations strictes** à respecter.

### Opérations interdites au niveau global/module

Cloudflare Workers **n'autorisent PAS** les opérations suivantes au niveau global (en dehors des handlers de requête) :

```typescript
// INTERDIT - provoque "Disallowed operation called within global scope"
setInterval(() => { ... }, 1000);
setTimeout(() => { ... }, 1000);
fetch('https://api.example.com');
crypto.getRandomValues(new Uint8Array(16));

// AUTORISE - à l'intérieur d'un handler
export const GET: RequestHandler = async () => {
  const random = crypto.getRandomValues(new Uint8Array(16));
  const response = await fetch('https://api.example.com');
  // ...
};
```

### Bonnes pratiques

| A eviter | Alternative |
|------------|----------------|
| `setInterval` pour cleanup | Lazy cleanup à chaque requête |
| `fetch()` au chargement du module | `fetch()` dans les handlers |
| Création de clients API au niveau module | Création lazy ou dans les handlers |
| `process.exit()` | Retourner une Response avec status d'erreur |
| Bibliothèques avec worker threads (ex: `pino-pretty`) | Versions compatibles edge (ex: `pino` sans transports) |

### Variables d'environnement

- Utilisez `$env/dynamic/private` (runtime) au lieu de `$env/static/private` (build-time)
- Les variables définies dans le dashboard Cloudflare ne sont disponibles qu'au runtime

### Références

- [Cloudflare Workers Runtime APIs](https://developers.cloudflare.com/workers/runtime-apis/)
- [SvelteKit Cloudflare Adapter](https://svelte.dev/docs/kit/adapter-cloudflare)

## Documentation et Ressources

Si vous n'avez jamais utilisé Svelte/Kit ou Convex, référez-vous aux documentations officielles :

- [Documentation de Svelte](https://svelte.dev/docs/)
- [Documentation de SvelteKit](https://svelte.dev/docs/kit/@sveltejs-kit)
- [Documentation de Convex](https://docs.convex.dev/)
- [Convex + Svelte](https://docs.convex.dev/client/svelte)
