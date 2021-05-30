mod authors;
mod error;
mod parser;
mod posts;
mod structs;

use crate::structs::Site;

fn main() -> crate::error::Result<()> {
    let site = Site::load_all()?;

    let j = serde_json::to_string(&site)?;
    println!("{}", j);

    Ok(())
}
