FROM node:20-slim

# Dépendances système pour better-sqlite3 (compilation native)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copie des fichiers de dépendances en premier (cache Docker)
COPY package*.json ./

# Installation des dépendances (inclut la compilation de better-sqlite3)
RUN npm ci --omit=dev

# Copie du code source
COPY src/ ./src/

# Création du dossier data pour SQLite
RUN mkdir -p /app/data

# Volume pour persister la base SQLite
VOLUME ["/app/data"]

# Démarrage
CMD ["node", "src/index.js"]
