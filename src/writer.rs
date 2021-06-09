use crate::builder::{Asset, BuiltSite};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

pub trait Write {
    fn write(self) -> io::Result<()>;
}

const CANT_PARSE: &'static str = "That's not unicode, can't parse path.";

fn to_local_path(path: &Path) -> io::Result<PathBuf> {
    let path_str = path.to_str().expect(CANT_PARSE);
    let file_name = path
        .file_name()
        .ok_or(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!(
                "{} is an invalid file. No filename (.. isn't accepted).",
                path_str
            ),
        ))?
        .to_str()
        .expect(CANT_PARSE);
    Ok(PathBuf::from(format!("./public/{}", file_name)))
}

impl Write for Asset {
    fn write(self) -> io::Result<()> {
        match self {
            Asset::HTML(artifact) => fs::write(artifact.path, artifact.content),
            Asset::Other(copy_data) => {
                fs::copy(&copy_data.path, to_local_path(&copy_data.path)?).map(|_| {})
            }
        }
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
