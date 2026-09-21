//! Debug-only: render our own window to a PNG so the UI can be inspected from
//! a terminal that cannot take screenshots. Triggered by `IM_SNAPSHOT_PATH`;
//! `IM_SNAPSHOT_DELAY_MS` (default 2500) waits for the webview to settle and
//! `IM_SNAPSHOT_EXIT=1` quits afterwards; `IM_SNAPSHOT_WINDOW=quick` captures
//! the quick-input panel instead of the main window. Captures everything on
//! screen below the window too, so translucent materials show what they
//! actually blur.

use std::ffi::{c_char, c_void, CString};
use std::path::Path;

use tauri::{Manager, WebviewWindow};

#[repr(C)]
struct CGPoint {
    x: f64,
    y: f64,
}
#[repr(C)]
struct CGSize {
    width: f64,
    height: f64,
}
#[repr(C)]
struct CGRect {
    origin: CGPoint,
    size: CGSize,
}

type CreateImageFn = unsafe extern "C" fn(CGRect, u32, u32, u32) -> *mut c_void;

extern "C" {
    fn dlsym(handle: *mut c_void, symbol: *const c_char) -> *mut c_void;
}

#[link(name = "ImageIO", kind = "framework")]
extern "C" {
    fn CGImageDestinationCreateWithURL(
        url: *const c_void,
        ty: *const c_void,
        count: usize,
        options: *const c_void,
    ) -> *mut c_void;
    fn CGImageDestinationAddImage(dest: *mut c_void, image: *mut c_void, properties: *const c_void);
    fn CGImageDestinationFinalize(dest: *mut c_void) -> bool;
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFURLCreateWithFileSystemPath(
        alloc: *const c_void,
        path: *const c_void,
        style: isize,
        is_dir: bool,
    ) -> *mut c_void;
    fn CFStringCreateWithCString(
        alloc: *const c_void,
        cstr: *const c_char,
        encoding: u32,
    ) -> *mut c_void;
    fn CFRelease(cf: *const c_void);
}

const RTLD_DEFAULT: *mut c_void = -2isize as *mut c_void;
const K_CG_WINDOW_LIST_OPTION_ON_SCREEN_BELOW_WINDOW: u32 = 1 << 2;
const K_CG_WINDOW_LIST_OPTION_INCLUDING_WINDOW: u32 = 1 << 3;
const K_CG_WINDOW_IMAGE_BOUNDS_IGNORE_FRAMING: u32 = 1 << 0;
const K_CG_WINDOW_IMAGE_BEST_RESOLUTION: u32 = 1 << 3;
const K_CF_STRING_ENCODING_UTF8: u32 = 0x0800_0100;
const K_CF_URL_POSIX_PATH_STYLE: isize = 0;

fn capture(window: &WebviewWindow, path: &Path) -> Result<(), String> {
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let pos = window
        .outer_position()
        .map_err(|e| e.to_string())?
        .to_logical::<f64>(scale);
    let size = window
        .outer_size()
        .map_err(|e| e.to_string())?
        .to_logical::<f64>(scale);
    let frame = CGRect {
        origin: CGPoint { x: pos.x, y: pos.y },
        size: CGSize {
            width: size.width,
            height: size.height,
        },
    };
    let ns_window = window.ns_window().map_err(|e| e.to_string())?;
    let window_number: isize =
        unsafe { objc2::msg_send![ns_window as *mut objc2::runtime::AnyObject, windowNumber] };
    if window_number <= 0 {
        return Err("window has no number (not on screen?)".into());
    }

    let symbol = CString::new("CGWindowListCreateImage").unwrap();
    let f = unsafe { dlsym(RTLD_DEFAULT, symbol.as_ptr()) };
    if f.is_null() {
        return Err("CGWindowListCreateImage unavailable".into());
    }
    let create: CreateImageFn = unsafe { std::mem::transmute(f) };
    let image = unsafe {
        create(
            frame,
            K_CG_WINDOW_LIST_OPTION_ON_SCREEN_BELOW_WINDOW
                | K_CG_WINDOW_LIST_OPTION_INCLUDING_WINDOW,
            window_number as u32,
            K_CG_WINDOW_IMAGE_BOUNDS_IGNORE_FRAMING | K_CG_WINDOW_IMAGE_BEST_RESOLUTION,
        )
    };
    if image.is_null() {
        return Err("CGWindowListCreateImage returned null".into());
    }

    let path_c = CString::new(path.to_string_lossy().as_bytes()).unwrap();
    let png_c = CString::new("public.png").unwrap();
    unsafe {
        let cf_path =
            CFStringCreateWithCString(std::ptr::null(), path_c.as_ptr(), K_CF_STRING_ENCODING_UTF8);
        let url = CFURLCreateWithFileSystemPath(
            std::ptr::null(),
            cf_path,
            K_CF_URL_POSIX_PATH_STYLE,
            false,
        );
        let ty =
            CFStringCreateWithCString(std::ptr::null(), png_c.as_ptr(), K_CF_STRING_ENCODING_UTF8);
        let dest = CGImageDestinationCreateWithURL(url, ty, 1, std::ptr::null());
        let ok = if dest.is_null() {
            false
        } else {
            CGImageDestinationAddImage(dest, image, std::ptr::null());
            let ok = CGImageDestinationFinalize(dest);
            CFRelease(dest);
            ok
        };
        CFRelease(ty);
        CFRelease(url);
        CFRelease(cf_path);
        CFRelease(image);
        if !ok {
            return Err("could not write PNG".into());
        }
    }
    Ok(())
}

pub fn install(app: &tauri::AppHandle) {
    let Some(path) = std::env::var_os("IM_SNAPSHOT_PATH") else {
        return;
    };
    let delay = std::env::var("IM_SNAPSHOT_DELAY_MS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(2500u64);
    let exit = std::env::var("IM_SNAPSHOT_EXIT")
        .map(|v| v == "1")
        .unwrap_or(false);
    let label = std::env::var("IM_SNAPSHOT_WINDOW").unwrap_or_else(|_| "main".into());
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(delay)).await;
        let Some(window) = app.get_webview_window(&label) else {
            return;
        };
        if !window.is_visible().unwrap_or(false) {
            eprintln!("snapshot: window was still hidden (frontend never called show()) — forcing it visible");
            let _ = window.show();
            tokio::time::sleep(std::time::Duration::from_millis(600)).await;
        }
        // Launched from a script the app usually isn't frontmost, so vibrancy and the
        // traffic lights render in their inactive state; IM_SNAPSHOT_ACTIVATE=1 fixes that.
        if std::env::var("IM_SNAPSHOT_ACTIVATE")
            .map(|v| v == "1")
            .unwrap_or(false)
        {
            let _ = window.run_on_main_thread(|| unsafe {
                use objc2::runtime::{AnyClass, AnyObject};
                if let Some(cls) = AnyClass::get(c"NSApplication") {
                    let app: *mut AnyObject = objc2::msg_send![cls, sharedApplication];
                    let _: () = objc2::msg_send![app, activateIgnoringOtherApps: true];
                }
            });
            tokio::time::sleep(std::time::Duration::from_millis(400)).await;
        }
        let path = std::path::PathBuf::from(path);
        let w = window.clone();
        let app2 = app.clone();
        let _ = window.run_on_main_thread(move || {
            match capture(&w, &path) {
                Ok(()) => eprintln!("snapshot written to {}", path.display()),
                Err(e) => eprintln!("snapshot failed: {e}"),
            }
            if exit {
                app2.exit(0);
            }
        });
    });
}
