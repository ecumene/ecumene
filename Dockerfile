FROM rust:1.60

MAINTAINER Mitchell Hynes, me@mitchellhynes.com

WORKDIR /usr/app/

COPY . .

RUN wget https://github.com/casey/just/releases/download/1.1.3/just-1.1.3-x86_64-unknown-linux-musl.tar.gz
RUN mkdir ./just
RUN tar -xf ./just-1.1.3-x86_64-unknown-linux-musl.tar.gz -C ./just
RUN mv ./just/just /usr/local/bin

RUN wget https://github.com/fermyon/spin/releases/download/v0.2.0/spin-v0.2.0-linux-amd64.tar.gz
RUN mkdir ./spin
RUN tar -xf ./spin-v0.2.0-linux-amd64.tar.gz -C ./spin
RUN mv ./spin/spin /usr/local/bin

RUN just build

ENTRYPOINT ["spin"]
