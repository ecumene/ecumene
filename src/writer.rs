use crate::builder::{Asset, BuiltSite};
use crate::to_local_path;
use std::fs;
use std::io;

pub trait Write {
    fn write(self) -> io::Result<()>;
}

impl Write for Asset {
    fn write(self) -> io::Result<()> {
        match self {
            Asset::Html(artifact) => {
                if let Some(ext) = artifact.path.extension() {
                    if ext == "html" {
                        fs::write(artifact.path, artifact.content)
                    } else {
                        unreachable!();
                    }
                } else {
                    fs::create_dir_all(&artifact.path)?;
                    fs::write(
                        artifact.path.to_owned().join("index.html"),
                        artifact.content,
                    )
                }
            }
            Asset::Xml(artifact) => fs::write(artifact.path, artifact.content),
            Asset::Other(copy_data) => {
                std::fs::create_dir_all(to_local_path(
                    copy_data.path.parent().expect("Path does not have parent."),
                )?)?;

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
