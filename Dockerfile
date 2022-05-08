FROM rust:1.60

MAINTAINER Mitchell Hynes, me@mitchellhynes.com

WORKDIR /usr/app/
COPY ./public .
COPY ./crates/ .
COPY ./spin.toml .

RUN apt update && apt install -y git libc-dev pkg-config libssl-dev

RUN git clone https://github.com/fermyon/spin.git
RUN cd spin && cargo build --release
RUN mv ./spin/target/release/spin ./

RUN chmod +x ./spin
RUN ./spin build

CMD ["./spin", "up"]
