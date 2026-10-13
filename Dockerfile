FROM node:20-alpine

WORKDIR /app

# Copie des dépendances
COPY package.json ./

# Installation des paquets de production
RUN npm install --production

# Copie du code applicatif
COPY server.js ./
COPY storage.js ./
COPY default-notes.js ./
COPY ai-service.js ./
COPY public ./public

# Création du dossier de persistance
RUN mkdir -p /app/data

# Exposer le port de l'application
EXPOSE 3000

# Healthcheck standard Traefik / Coolify
HEALTHCHECK --interval=20s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/health || exit 1

# Variables d'environnement par défaut pour Coolify
ENV PORT=3000 \
    NODE_ENV=production \
    APP_URL=https://notes.oussamma.tn \
    SSO_BASE_URL=https://sso-a.oussamma.tn \
    SSO_CLIENT_ID=client_notes_app \
    SSO_CLIENT_SECRET=sec_notes_platform_secret_2026 \
    SSO_REDIRECT_URI=https://notes.oussamma.tn/auth/callback \
    SSO_SCOPES="openid profile email" \
    LITELLM_BASE_URL=https://ai.oussamma.tn/v1 \
    LITELLM_API_KEY=sk-oussamma-master-gateway-2026 \
    LITELLM_DEFAULT_MODEL=gemini/gemini-3.1-flash-lite-preview \
    SESSION_SECRET=notes-oussamma-super-secret-key-2026-prod

CMD ["node", "server.js"]
