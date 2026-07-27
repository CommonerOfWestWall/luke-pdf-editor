//! 通过 Windows Shell 的文件项图像工厂验证扩展名注册和缩略图处理器链路。

use std::env;
use std::ffi::c_void;
use std::fs::File;
use std::io::Write;
use std::os::windows::ffi::OsStrExt;
use std::path::Path;

use windows::core::{Interface, PCWSTR};
use windows::Win32::Foundation::SIZE;
use windows::Win32::Graphics::Gdi::{
    CreateCompatibleDC, DeleteDC, DeleteObject, GetDIBits, GetObjectW, BITMAP, BITMAPINFO,
    BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
};
use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED};
use windows::Win32::UI::Shell::{
    IShellItem, IShellItemImageFactory, SHCreateItemFromParsingName, SIIGBF_THUMBNAILONLY,
};

fn main() {
    let path = env::args_os()
        .nth(1)
        .expect("用法：cargo run --example shell_smoke -- <PDF 路径>");
    let output = env::args_os().nth(2);
    let wide_path: Vec<u16> = path.encode_wide().chain(Some(0)).collect();

    unsafe {
        CoInitializeEx(None, COINIT_APARTMENTTHREADED)
            .ok()
            .expect("初始化 COM");
        let result = request_shell_thumbnail(PCWSTR(wide_path.as_ptr()), output.as_deref());
        CoUninitialize();
        result.expect("Windows Shell 获取 PDF 首页缩略图");
    }
}

unsafe fn request_shell_thumbnail(
    path: PCWSTR,
    output: Option<&std::ffi::OsStr>,
) -> windows::core::Result<()> {
    let item: IShellItem = SHCreateItemFromParsingName(path, None)?;
    let image_factory: IShellItemImageFactory = item.cast()?;
    let bitmap = image_factory.GetImage(SIZE { cx: 256, cy: 256 }, SIIGBF_THUMBNAILONLY)?;
    println!("Shell 缩略图获取成功：HBITMAP={:?}", bitmap.0);
    if let Some(output) = output {
        save_bitmap(bitmap, Path::new(output)).expect("保存缩略图 BMP");
    }
    DeleteObject(bitmap).ok()?;
    Ok(())
}

unsafe fn save_bitmap(
    bitmap: windows::Win32::Graphics::Gdi::HBITMAP,
    path: &Path,
) -> std::io::Result<()> {
    let mut object = BITMAP::default();
    let copied = GetObjectW(
        bitmap,
        std::mem::size_of::<BITMAP>() as i32,
        Some((&mut object as *mut BITMAP).cast::<c_void>()),
    );
    if copied == 0 {
        return Err(std::io::Error::last_os_error());
    }
    let width = object.bmWidth as u32;
    let height = object.bmHeight as u32;
    let stride = width
        .checked_mul(4)
        .ok_or_else(std::io::Error::last_os_error)?;
    let image_size = stride
        .checked_mul(height)
        .ok_or_else(std::io::Error::last_os_error)?;
    let mut pixels = vec![0_u8; image_size as usize];
    let mut info = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: width as i32,
            biHeight: height as i32,
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            biSizeImage: image_size,
            ..Default::default()
        },
        bmiColors: [Default::default()],
    };
    let dc = CreateCompatibleDC(None);
    if dc.0.is_null() {
        return Err(std::io::Error::last_os_error());
    }
    let lines = GetDIBits(
        dc,
        bitmap,
        0,
        height,
        Some(pixels.as_mut_ptr().cast()),
        &mut info,
        DIB_RGB_COLORS,
    );
    let _ = DeleteDC(dc);
    if lines != height as i32 {
        return Err(std::io::Error::last_os_error());
    }

    let pixel_offset = 14_u32 + 40;
    let file_size = pixel_offset + image_size;
    let mut file = File::create(path)?;
    file.write_all(b"BM")?;
    file.write_all(&file_size.to_le_bytes())?;
    file.write_all(&[0_u8; 4])?;
    file.write_all(&pixel_offset.to_le_bytes())?;
    file.write_all(&info.bmiHeader.biSize.to_le_bytes())?;
    file.write_all(&info.bmiHeader.biWidth.to_le_bytes())?;
    file.write_all(&info.bmiHeader.biHeight.to_le_bytes())?;
    file.write_all(&info.bmiHeader.biPlanes.to_le_bytes())?;
    file.write_all(&info.bmiHeader.biBitCount.to_le_bytes())?;
    file.write_all(&info.bmiHeader.biCompression.to_le_bytes())?;
    file.write_all(&info.bmiHeader.biSizeImage.to_le_bytes())?;
    file.write_all(&info.bmiHeader.biXPelsPerMeter.to_le_bytes())?;
    file.write_all(&info.bmiHeader.biYPelsPerMeter.to_le_bytes())?;
    file.write_all(&info.bmiHeader.biClrUsed.to_le_bytes())?;
    file.write_all(&info.bmiHeader.biClrImportant.to_le_bytes())?;
    file.write_all(&pixels)?;
    println!("缩略图已保存：{}", path.display());
    Ok(())
}
