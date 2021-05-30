use crate::structs::Site;
use std::fs;
use std::io;

pub fn write(site: Site) -> io::Result<()> {
    fs::create_dir("./public")?;
    println!("Building");

    Ok(())
}
