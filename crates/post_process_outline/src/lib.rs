use anyhow::Error;
use image::io::Reader as ImageReader;
use image::{
    imageops::{blur, overlay},
    GenericImage, GenericImageView, ImageBuffer, Rgba, RgbaImage,
};
use std::path::Path;

fn whiteout<
    I: GenericImage + GenericImageView<Pixel = Rgba<u8>>,
    O: GenericImage + GenericImageView<Pixel = Rgba<u8>>,
>(
    buffer: &I,
    output: &mut O,
    xd: u32,
    yd: u32,
    x: u32,
    y: u32,
) {
    if buffer.get_pixel(x, y).0[3] != 0 {
        output.put_pixel(xd, yd, Rgba([255, 255, 255, 255]));
    }
}

fn outline<
    I: Clone + GenericImage + GenericImageView<Pixel = Rgba<u8>>,
    O: GenericImage + GenericImageView<Pixel = Rgba<u8>>,
>(
    input: &I,
    output: &mut O,
    gutters: u32,
) {
    let tmp_buffer = input.clone();
    let (width, height) = input.dimensions();

    for x in 0..width {
        for y in 0..height {
            // Original pixel
            let pixel = tmp_buffer.get_pixel(x, y);

            if pixel.0[3] != 255 {
                if x > gutters - 1 {
                    whiteout(&tmp_buffer, output, x, y, x - gutters, y);
                }

                if x < width - gutters {
                    whiteout(&tmp_buffer, output, x, y, x + gutters, y);
                }

                if y < height - gutters {
                    whiteout(&tmp_buffer, output, x, y, x, y + gutters);
                }

                if y > gutters - 1 {
                    whiteout(&tmp_buffer, output, x, y, x, y - gutters);
                }

                if y > gutters - 1 && x > gutters - 1 {
                    whiteout(&tmp_buffer, output, x, y, x - gutters, y - gutters);
                }

                if y > gutters - 1 && x < width - gutters {
                    whiteout(&tmp_buffer, output, x, y, x + gutters, y - gutters);
                }

                if y < height - gutters && x < width - gutters {
                    whiteout(&tmp_buffer, output, x, y, x + gutters, y + gutters);
                }

                if y < height - gutters && x > gutters - 1 {
                    whiteout(&tmp_buffer, output, x, y, x - gutters, y + gutters);
                }
            }
        }
    }
}

pub fn write_outline<P: AsRef<Path>>(path_in: P, path_out: P) -> Result<(), Error> {
    let buffer = ImageReader::open(path_in)?.decode()?;
    let (width, height) = buffer.dimensions();
    let gutters = (width as f32 * 0.01).floor() as u32;
    let mut input: RgbaImage = ImageBuffer::new(width + gutters * 4, height + gutters * 4);
    overlay(&mut input, &buffer, gutters.into(), gutters.into());
    let mut output: RgbaImage = ImageBuffer::new(width + gutters * 4, height + gutters * 4);
    outline(&input, &mut output, gutters);
    output = blur(&output, 0.5);
    overlay(&mut output, &input, 0, 0);

    output
        .save(path_out)
        .expect("Couldn't write outlined image.");

    Ok(())
}
