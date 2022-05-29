build:
  cargo run

  cd functions/tokenize
  cargo build --target wasm32-wasi --release

  cd ../
  
  cd functions/static
  cargo build --target wasm32-wasi --release
