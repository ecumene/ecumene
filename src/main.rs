mod authors;
mod builder;
mod error;
mod parser;
mod posts;
mod structs;
mod writer;

use crate::structs::Site;

fn main() -> crate::error::Result<()> {
    let site = Site::load_all()?;

    let j = serde_json::to_string(&site)?;

    writer::write(site)?;

    Ok(())
}
