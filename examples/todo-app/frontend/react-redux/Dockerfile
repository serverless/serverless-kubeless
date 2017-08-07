FROM bitnami/node:7

LABEL maintainer "Bitnami Team <containers@bitnami.com>"

ENV NODE_ENV=production

RUN npm install yarn --global

COPY . /app

RUN yarn install
RUN npm rebuild node-sass
RUN yarn run build

WORKDIR /app

EXPOSE 8080
ENTRYPOINT ["yarn","run","start"]
