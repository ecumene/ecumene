FROM --platform=linux/amd64 debian

RUN apt-get update && apt-get install -y wget

RUN wget https://github.com/fermyon/spin/releases/download/v0.2.0/spin-v0.2.0-linux-amd64.tar.gz
RUN mkdir ./spin
RUN tar -xf ./spin-v0.2.0-linux-amd64.tar.gz -C ./spin
RUN mv ./spin/spin /usr/local/bin

WORKDIR /usr/app/

COPY spin.toml spin.toml
COPY public public

COPY ./functions/static/target/wasm32-wasi/release/static.wasm functions/static/target/wasm32-wasi/release/
COPY ./functions/tokenize/target/wasm32-wasi/release/tokenize.wasm functions/tokenize/target/wasm32-wasi/release/
COPY ./functions/splain/target/wasm32-wasi/release/splain.wasm functions/splain/target/wasm32-wasi/release/
COPY ./functions/bot/target/wasm32-wasi/release/bot.wasm functions/bot/target/wasm32-wasi/release/

CMD ["sh", "-c", "spin up -e SPIN_APP_REDIS_ADDRESS=$SPIN_APP_REDIS_ADDRESS -e DISCORD_PUB_KEY=$DISCORD_PUB_KEY -e DISCORD_BOT_TOKEN=$DISCORD_BOT_TOKEN --listen 0.0.0.0:3000 --follow-all"]
