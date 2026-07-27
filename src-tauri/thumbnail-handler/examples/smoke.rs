//! 在 Explorer 外直接实例化 COM 处理器，验证真实 PDF 首页能返回 HBITMAP。

use std::env;
use std::os::windows::ffi::OsStrExt;

use windows::core::{Interface, GUID, PCWSTR};
use windows::Win32::Foundation::E_FAIL;
use windows::Win32::Graphics::Gdi::{DeleteObject, HBITMAP};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
    COINIT_APARTMENTTHREADED,
};
use windows::Win32::UI::Shell::PropertiesSystem::IInitializeWithStream;
use windows::Win32::UI::Shell::{IThumbnailProvider, SHCreateStreamOnFileEx, WTS_ALPHATYPE};

const CLSID_LUKE_PDF_THUMBNAIL: GUID = GUID::from_u128(0x8886cf30_e7a4_49ac_9df2_2ea9c8396fe1);

fn main() {
    let path = env::args_os()
        .nth(1)
        .expect("用法：cargo run --example smoke -- <PDF 路径>");
    let wide_path: Vec<u16> = path.encode_wide().chain(Some(0)).collect();

    unsafe {
        CoInitializeEx(None, COINIT_APARTMENTTHREADED)
            .ok()
            .expect("初始化 COM");
        let result = render_thumbnail(PCWSTR(wide_path.as_ptr()));
        CoUninitialize();
        result.expect("生成 PDF 首页缩略图");
    }
}

unsafe fn render_thumbnail(path: PCWSTR) -> windows::core::Result<()> {
    let provider: IThumbnailProvider =
        CoCreateInstance(&CLSID_LUKE_PDF_THUMBNAIL, None, CLSCTX_INPROC_SERVER)?;
    let initializer: IInitializeWithStream = provider.cast()?;
    let stream = SHCreateStreamOnFileEx(path, 0, 0, false, None)?;
    initializer.Initialize(&stream, 0)?;

    let mut bitmap = HBITMAP::default();
    let mut alpha = WTS_ALPHATYPE::default();
    provider.GetThumbnail(256, &mut bitmap, &mut alpha)?;
    if bitmap.0.is_null() {
        return Err(E_FAIL.into());
    }
    println!(
        "首页缩略图生成成功：HBITMAP={:?}，alpha={:?}",
        bitmap.0, alpha
    );
    DeleteObject(bitmap).ok()?;
    Ok(())
}
