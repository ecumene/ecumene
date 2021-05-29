mod authors;
mod parser;
mod posts;
mod structs;

use crate::structs::Site;

fn main() {
    let site = Site::new();

    let j = serde_json::to_string(&site).unwrap();
    println!("{}", j);
}
