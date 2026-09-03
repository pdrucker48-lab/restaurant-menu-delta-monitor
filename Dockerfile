FROM apify/actor-node-playwright-chrome:24-1.58.1

COPY package*.json ./
RUN npm --quiet set progress=false \
    && npm install --omit=dev --no-audit

COPY . ./

CMD ["npm", "start"]
