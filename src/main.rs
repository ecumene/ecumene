mod builder;
mod date;
mod error;
mod inventory;
mod parser;
mod structs;
mod templating;
mod writer;

use crate::error::Result;
use crate::structs::Site;
use builder::{Build, BuiltSite};
use writer::Write;

fn main() -> Result<()> {
    let site = Site::load_all()?;

    let mut built_site = BuiltSite::default();

    site.build(&mut built_site)?;

    built_site.write()?;

    Ok(())
}
