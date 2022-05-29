FROM rust:1.60 as builder

MAINTAINER Mitchell Hynes, me@mitchellhynes.com

WORKDIR /usr/app/

COPY . .

RUN rustup target add wasm32-wasi

RUN wget https://github.com/casey/just/releases/download/1.1.3/just-1.1.3-x86_64-unknown-linux-musl.tar.gz
RUN mkdir ./just
RUN tar -xf ./just-1.1.3-x86_64-unknown-linux-musl.tar.gz -C ./just
RUN mv ./just/just /usr/local/bin

RUN just build

FROM alpine

RUN wget https://github.com/fermyon/spin/releases/download/v0.2.0/spin-v0.2.0-linux-amd64.tar.gz
RUN mkdir ./spin
RUN tar -xf ./spin-v0.2.0-linux-amd64.tar.gz -C ./spin
RUN mv ./spin/spin /usr/local/bin

WORKDIR /usr/app/

RUN mkdir -p functions/static/target/wasm32-wasi/release
RUN mkdir -p functions/tokenize/target/wasm32-wasi/release

COPY --from=builder /usr/app/public /usr/app/public
COPY --from=builder /usr/app/functions/static/target/wasm32-wasi/release/static.wasm functions/static/target/wasm32-wasi/release/static.wasm
COPY --from=builder /usr/app/functions/tokenize/target/wasm32-wasi/release/tokenize.wasm functions/tokenize/target/wasm32-wasi/release/tokenize.wasm

ENTRYPOINT ["spin"]
