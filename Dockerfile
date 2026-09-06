FROM node:24-alpine
WORKDIR /app
COPY package.json server.mjs index.html styles.css ./
COPY js ./js
COPY lib ./lib
ENV HOST=0.0.0.0
ENV PORT=4173
USER node
EXPOSE 4173
CMD ["node", "server.mjs"]
