FROM --platform=linux/x86_64 alpine

MAINTAINER Mitchell Hynes, me@mitchellhynes.com

RUN wget https://github.com/fermyon/spin/releases/download/v0.2.0/spin-v0.2.0-linux-amd64.tar.gz
RUN mkdir ./spin
RUN tar -xf ./spin-v0.2.0-linux-amd64.tar.gz -C ./spin
RUN mv ./spin/spin /usr/local/bin

WORKDIR /usr/app/

ENTRYPOINT ["spin"]
