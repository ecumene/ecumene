use crate::builder::{Asset, BuiltSite};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

pub trait Write {
    fn write(self) -> io::Result<()>;
}

const CANT_PARSE: &str = "That's not unicode, can't parse path.";

fn to_local_path(path: &Path) -> io::Result<PathBuf> {
    Ok(PathBuf::from("./public").join(path.strip_prefix("assets").expect(CANT_PARSE)))
}

impl Write for Asset {
    fn write(self) -> io::Result<()> {
        match self {
            Asset::HTML(artifact) => fs::write(artifact.path, artifact.content),
            Asset::XML(artifact) => fs::write(artifact.path, artifact.content),
            Asset::Other(copy_data) => {
                std::fs::create_dir_all(to_local_path(
                    copy_data.path.parent().expect("Path does not have parent."),
                )?)
                .expect("msg: &star");

                if let Some(ext) = copy_data.path.extension() {
                    if ext == "jpg" || ext == "png" || ext == "jpeg" {
                        mitch_outline::write_outline(
                            &copy_data.path,
                            &to_local_path(&copy_data.path)?,
                        )
                        .expect("Couldn't outline image");
                    } else {
                        fs::copy(&copy_data.path, to_local_path(&copy_data.path)?).map(|_| {})?;
                    }
                }
                Ok(())
            }
        }
    }
}

impl Write for BuiltSite {
    fn write(self) -> io::Result<()> {
        if let Err(error) = fs::create_dir("./public") {
            if error.kind() != io::ErrorKind::AlreadyExists {
                return Err(error);
            }
        }
        if let Err(error) = fs::create_dir("./public/blog") {
            if error.kind() != io::ErrorKind::AlreadyExists {
                return Err(error);
            }
        }
        if let Err(error) = fs::create_dir("./public/team") {
            if error.kind() != io::ErrorKind::AlreadyExists {
                return Err(error);
            }
        }
        for asset in self.assets {
            asset.write()?;
        }
        Ok(())
    }
}
