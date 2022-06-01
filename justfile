build:
  cargo run;

  cd functions/static && cargo build --target wasm32-wasi --release;
  cd functions/tokenize && cargo build --target wasm32-wasi --release;

spin-up:
  spin up --follow-all -e SPIN_APP_REDIS_ADDRESS=redis://127.0.0.1:6379

start-redis:
  docker run --name=redis --publish=6379:6379 --hostname=redis --restart=on-failure --detach redis:latest
