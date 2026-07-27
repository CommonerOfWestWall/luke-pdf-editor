//! 鲁科 PDF 编辑器 Windows 首页缩略图处理器。
//!
//! 结构参考 Stirling-PDF 的 MIT 许可实现：
//! <https://github.com/Stirling-Tools/Stirling-PDF/tree/main/frontend/editor/src-tauri/thumbnail-handler>
//! 使用 Windows.Data.Pdf 渲染第一页，避免把应用的 WASM PDF 引擎加载进 Explorer。

use std::cell::RefCell;
use std::ffi::c_void;
use std::panic::catch_unwind;
use std::sync::atomic::{AtomicU32, Ordering};

use windows::core::{implement, IUnknown, Interface, GUID, HRESULT};
use windows::Data::Pdf::{PdfDocument, PdfPageRenderOptions};
use windows::Storage::Streams::{
    DataReader, DataWriter, IRandomAccessStream, InMemoryRandomAccessStream,
};
use windows::Win32::Foundation::{
    BOOL, CLASS_E_CLASSNOTAVAILABLE, CLASS_E_NOAGGREGATION, E_FAIL, E_INVALIDARG, E_POINTER,
    E_UNEXPECTED, S_FALSE, S_OK,
};
use windows::Win32::Graphics::Gdi::{
    CreateDIBSection, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HBITMAP,
};
use windows::Win32::Graphics::Imaging::{
    CLSID_WICImagingFactory, GUID_WICPixelFormat32bppBGRA, IWICImagingFactory,
    WICBitmapDitherTypeNone, WICBitmapInterpolationModeFant, WICBitmapPaletteTypeCustom,
    WICDecodeMetadataCacheOnDemand,
};
use windows::Win32::System::Com::{
    CoCreateInstance, IClassFactory, IClassFactory_Impl, IStream, CLSCTX_INPROC_SERVER,
    STATFLAG_DEFAULT, STREAM_SEEK_SET,
};
use windows::Win32::UI::Shell::PropertiesSystem::{
    IInitializeWithStream, IInitializeWithStream_Impl,
};
use windows::Win32::UI::Shell::{
    IThumbnailProvider, IThumbnailProvider_Impl, SHCreateMemStream, WTS_ALPHATYPE,
};

/// 必须与 NSIS 注册表项保持一致。
const CLSID_LUKE_PDF_THUMBNAIL: GUID = GUID::from_u128(0x8886cf30_e7a4_49ac_9df2_2ea9c8396fe1);
const MAX_PDF_SIZE: usize = 256 * 1024 * 1024;
static DLL_REF_COUNT: AtomicU32 = AtomicU32::new(0);

fn trace(message: &str) {
    if std::env::var_os("LUKE_THUMBNAIL_TRACE").is_some() {
        eprintln!("thumbnail: {message}");
    }
}

fn stage<T>(name: &str, result: windows::core::Result<T>) -> windows::core::Result<T> {
    match result {
        Ok(value) => {
            trace(name);
            Ok(value)
        }
        Err(error) => {
            if std::env::var_os("LUKE_THUMBNAIL_TRACE").is_some() {
                eprintln!("thumbnail: {name} 失败：{error:?}");
            }
            Err(error)
        }
    }
}

#[implement(IThumbnailProvider, IInitializeWithStream)]
struct ThumbnailProvider {
    stream: RefCell<Option<IStream>>,
}

impl ThumbnailProvider {
    fn new() -> Self {
        DLL_REF_COUNT.fetch_add(1, Ordering::SeqCst);
        Self {
            stream: RefCell::new(None),
        }
    }
}

impl Drop for ThumbnailProvider {
    fn drop(&mut self) {
        DLL_REF_COUNT.fetch_sub(1, Ordering::SeqCst);
    }
}

impl IInitializeWithStream_Impl for ThumbnailProvider_Impl {
    fn Initialize(&self, stream: Option<&IStream>, _access_mode: u32) -> windows::core::Result<()> {
        catch_unwind(std::panic::AssertUnwindSafe(|| {
            *self.stream.borrow_mut() = stream.cloned();
        }))
        .map_err(|_| windows::core::Error::from(E_UNEXPECTED))
    }
}

impl IThumbnailProvider_Impl for ThumbnailProvider_Impl {
    fn GetThumbnail(
        &self,
        size: u32,
        bitmap: *mut HBITMAP,
        alpha_type: *mut WTS_ALPHATYPE,
    ) -> windows::core::Result<()> {
        if bitmap.is_null() || alpha_type.is_null() {
            return Err(E_POINTER.into());
        }
        if size == 0 {
            return Err(E_INVALIDARG.into());
        }
        match catch_unwind(std::panic::AssertUnwindSafe(|| {
            self.render_first_page(size, bitmap, alpha_type)
        })) {
            Ok(result) => result,
            Err(_) => Err(E_UNEXPECTED.into()),
        }
    }
}

impl ThumbnailProvider_Impl {
    fn render_first_page(
        &self,
        size: u32,
        bitmap: *mut HBITMAP,
        alpha_type: *mut WTS_ALPHATYPE,
    ) -> windows::core::Result<()> {
        let stored_stream = self.stream.borrow();
        let source_stream = stored_stream.as_ref().ok_or(E_FAIL)?;
        let bytes = stage("读取 IStream", read_stream(source_stream))?;
        if bytes.is_empty() {
            return Err(E_FAIL.into());
        }

        let pdf_stream = stage(
            "创建 WinRT 随机访问流",
            bytes_to_random_access_stream(&bytes),
        )?;
        let load_operation = stage(
            "创建 PDF 异步加载操作",
            PdfDocument::LoadFromStreamAsync(&pdf_stream),
        )?;
        let document = stage("加载 PDF 文档", load_operation.get())?;
        if document.PageCount()? == 0 {
            return Err(E_FAIL.into());
        }

        let page = stage("读取 PDF 第一页", document.GetPage(0))?;
        let page_size = stage("读取页面尺寸", page.Size())?;
        let scale = size as f64 / f64::max(page_size.Width as f64, page_size.Height as f64);
        let width = (page_size.Width as f64 * scale).max(1.0) as u32;
        let height = (page_size.Height as f64 * scale).max(1.0) as u32;
        let output = InMemoryRandomAccessStream::new()?;
        let options = PdfPageRenderOptions::new()?;
        options.SetDestinationWidth(width)?;
        options.SetDestinationHeight(height)?;
        let render_operation = stage(
            "创建页面渲染操作",
            page.RenderWithOptionsToStreamAsync(&output, &options),
        )?;
        stage("渲染 PDF 第一页", render_operation.get())?;

        let rendered = stage(
            "将渲染结果转换为 HBITMAP",
            png_stream_to_hbitmap(&output, width, height),
        )?;
        unsafe {
            *bitmap = rendered;
            *alpha_type = WTS_ALPHATYPE(2);
        }
        Ok(())
    }
}

fn read_stream(stream: &IStream) -> windows::core::Result<Vec<u8>> {
    unsafe {
        let mut statistics = std::mem::zeroed();
        stream.Stat(&mut statistics, STATFLAG_DEFAULT)?;
        let size = statistics.cbSize as usize;
        if size == 0 {
            return Ok(Vec::new());
        }
        if size > MAX_PDF_SIZE {
            return Err(E_FAIL.into());
        }

        stream.Seek(0, STREAM_SEEK_SET, None)?;
        let mut bytes = vec![0_u8; size];
        let mut total_read = 0_usize;
        while total_read < size {
            let mut bytes_read = 0_u32;
            stream
                .Read(
                    bytes[total_read..].as_mut_ptr().cast(),
                    (size - total_read) as u32,
                    Some(&mut bytes_read),
                )
                .ok()?;
            if bytes_read == 0 {
                break;
            }
            total_read += bytes_read as usize;
        }
        bytes.truncate(total_read);
        Ok(bytes)
    }
}

fn bytes_to_random_access_stream(bytes: &[u8]) -> windows::core::Result<IRandomAccessStream> {
    let stream = InMemoryRandomAccessStream::new()?;
    let writer = DataWriter::CreateDataWriter(&stream)?;
    writer.WriteBytes(bytes)?;
    writer.StoreAsync()?.get()?;
    writer.DetachStream()?;
    stream.Seek(0)?;
    stream.cast()
}

fn png_stream_to_hbitmap(
    stream: &InMemoryRandomAccessStream,
    width: u32,
    height: u32,
) -> windows::core::Result<HBITMAP> {
    unsafe {
        stream.Seek(0)?;
        let size = stream.Size()? as usize;
        if size == 0 || size > u32::MAX as usize {
            return Err(E_FAIL.into());
        }

        let input = stage("取得 PNG 输入流", stream.GetInputStreamAt(0))?;
        let reader = stage("创建 PNG DataReader", DataReader::CreateDataReader(&input))?;
        let load = stage("创建 PNG 读取操作", reader.LoadAsync(size as u32))?;
        stage("读取 PNG 字节", load.get())?;
        let mut png = vec![0_u8; size];
        stage("复制 PNG 字节", reader.ReadBytes(&mut png))?;
        let memory_stream = SHCreateMemStream(Some(&png)).ok_or(E_FAIL)?;
        trace("创建内存 PNG IStream");
        let factory: IWICImagingFactory = stage(
            "创建 WIC 工厂",
            CoCreateInstance(&CLSID_WICImagingFactory, None, CLSCTX_INPROC_SERVER),
        )?;
        let decoder = stage(
            "创建 WIC PNG 解码器",
            factory.CreateDecoderFromStream(
                &memory_stream,
                std::ptr::null(),
                WICDecodeMetadataCacheOnDemand,
            ),
        )?;
        let frame = stage("取得 WIC 第 0 帧", decoder.GetFrame(0))?;
        let mut actual_width = 0_u32;
        let mut actual_height = 0_u32;
        stage(
            "读取 WIC 帧尺寸",
            frame.GetSize(&mut actual_width, &mut actual_height),
        )?;
        if std::env::var_os("LUKE_THUMBNAIL_TRACE").is_some() {
            eprintln!(
                "thumbnail: 请求尺寸={width}x{height}，实际 PNG={actual_width}x{actual_height}"
            );
        }
        let scaler = stage("创建 WIC 缩放器", factory.CreateBitmapScaler())?;
        stage(
            "将 WIC 帧缩放到 Explorer 请求尺寸",
            scaler.Initialize(&frame, width, height, WICBitmapInterpolationModeFant),
        )?;
        let converter = stage("创建 WIC 像素转换器", factory.CreateFormatConverter())?;
        stage(
            "初始化 WIC BGRA 转换",
            converter.Initialize(
                &scaler,
                &GUID_WICPixelFormat32bppBGRA,
                WICBitmapDitherTypeNone,
                None,
                0.0,
                WICBitmapPaletteTypeCustom,
            ),
        )?;

        let stride = width.checked_mul(4).ok_or(E_FAIL)?;
        let buffer_size = stride.checked_mul(height).ok_or(E_FAIL)? as usize;
        let mut pixels = vec![0_u8; buffer_size];
        stage(
            "复制 WIC BGRA 像素",
            converter.CopyPixels(std::ptr::null(), stride, &mut pixels),
        )?;

        let bitmap_info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: width as i32,
                biHeight: -(height as i32),
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            bmiColors: [Default::default()],
        };
        let mut bits: *mut c_void = std::ptr::null_mut();
        let bitmap = stage(
            "创建 GDI DIB",
            CreateDIBSection(None, &bitmap_info, DIB_RGB_COLORS, &mut bits, None, 0),
        )?;
        if bits.is_null() {
            return Err(E_FAIL.into());
        }
        std::ptr::copy_nonoverlapping(pixels.as_ptr(), bits.cast(), buffer_size);
        Ok(bitmap)
    }
}

#[implement(IClassFactory)]
struct ThumbnailProviderFactory;

impl IClassFactory_Impl for ThumbnailProviderFactory_Impl {
    fn CreateInstance(
        &self,
        outer: Option<&IUnknown>,
        interface_id: *const GUID,
        object: *mut *mut c_void,
    ) -> windows::core::Result<()> {
        unsafe {
            *object = std::ptr::null_mut();
        }
        if outer.is_some() {
            return Err(CLASS_E_NOAGGREGATION.into());
        }
        let provider: IUnknown = ThumbnailProvider::new().into();
        unsafe { provider.query(&*interface_id, object).ok() }
    }

    fn LockServer(&self, lock: BOOL) -> windows::core::Result<()> {
        if lock.as_bool() {
            DLL_REF_COUNT.fetch_add(1, Ordering::SeqCst);
        } else {
            DLL_REF_COUNT.fetch_sub(1, Ordering::SeqCst);
        }
        Ok(())
    }
}

#[no_mangle]
unsafe extern "system" fn DllGetClassObject(
    class_id: *const GUID,
    interface_id: *const GUID,
    object: *mut *mut c_void,
) -> HRESULT {
    if class_id.is_null() || interface_id.is_null() || object.is_null() {
        return E_POINTER;
    }
    *object = std::ptr::null_mut();
    if *class_id != CLSID_LUKE_PDF_THUMBNAIL {
        return CLASS_E_CLASSNOTAVAILABLE;
    }
    let factory: IUnknown = ThumbnailProviderFactory.into();
    match factory.query(&*interface_id, object).ok() {
        Ok(()) => S_OK,
        Err(error) => error.into(),
    }
}

#[no_mangle]
extern "system" fn DllCanUnloadNow() -> HRESULT {
    if DLL_REF_COUNT.load(Ordering::SeqCst) == 0 {
        S_OK
    } else {
        S_FALSE
    }
}
