use crate::builder::{Asset, BuiltSite};
use std::fs;
use std::io;

pub trait Write {
    fn write(self) -> io::Result<()>;
}

impl Write for Asset {
    fn write(self) -> io::Result<()> {
        println!("{:?}", self);
        match self {
            Asset::HTML(artifact) => fs::write(artifact.path, artifact.content)?,
            Asset::CSS(_) => unimplemented!(),
            Asset::JS(_) => unimplemented!(),
        }
        Ok(())
    }
}

impl Write for BuiltSite {
    fn write(self) -> io::Result<()> {
        match fs::create_dir("./public") {
            Err(error) => {
                if error.kind() != io::ErrorKind::AlreadyExists {
                    return Err(error);
                }
            }
            Ok(_) => {}
        }
        for asset in self.assets {
            asset.write()?;
        }
        Ok(())
    }
}
