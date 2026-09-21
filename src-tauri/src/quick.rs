//! The quick-input panel. A system-wide shortcut summons a small glass window
//! next to the mouse; whatever is selected in the frontmost app comes along as
//! a quote; Return hands the text to the main window, which starts a new chat
//! with it. On macOS the window is turned into a non-activating `NSPanel`, so
//! it takes the keyboard without activating im: the menu bar stays with the
//! app the user was in and the main window does not jump forward.
//!
//! The panel window exists from launch (hidden) so it appears instantly. Its
//! frontend lays the content out, then reports the height with `quick_present`
//! — only then is the window sized, placed and faded in, so it never shows a
//! stale or half-sized frame.
//!
//! One AppKit rule shapes the rest: making a window key *programmatically*
//! activates a regular (Dock-icon) app even for a non-activating panel — the
//! mask only covers mouse clicks. Activation here doesn't raise the main window
//! (verified: it stays behind other apps' windows), so the visible effects are
//! the menu bar switching to im while the panel is up and, on dismissal, an
//! active app with no key window. Hence the app that was in front is remembered
//! when the shortcut fires and re-activated when the panel is dismissed by
//! Esc or the shortcut (not by a click elsewhere: that click chose an app).

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::plugin::TauriPlugin;
use tauri::{AppHandle, Emitter, Manager, Wry};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

use crate::engine::Engine;

pub const WINDOW: &str = "quick";
const MAIN: &str = "main";
/// Logical width of the panel; the height follows its content.
const WIDTH: f64 = 520.0;
#[cfg(target_os = "macos")]
const RADIUS: f64 = 14.0;
#[cfg(target_os = "macos")]
const FADE_IN: f64 = 0.16;
#[cfg(target_os = "macos")]
const FADE_OUT: f64 = 0.12;
/// A quote longer than this is cut — it is a message, not a file transfer.
const MAX_SELECTION: usize = 20_000;

/// What the shortcut saw when it fired: the mouse, in screen points (AppKit
/// coordinates, origin bottom-left) — the panel is placed there once the
/// frontend has laid out and reports its height — and the pid of the app that
/// was in front, to hand the keyboard back to on dismissal.
#[derive(Default, Clone, Copy)]
struct Summon {
    mouse: Option<(f64, f64)>,
    #[cfg(target_os = "macos")]
    previous_app: Option<i32>,
}
#[derive(Default)]
struct Anchor(Mutex<Summon>);

/// The panel's page announces itself with `quick_ready`; a shortcut pressed
/// before that (the first second or two after launch) is held until it does.
#[derive(Default)]
struct Readiness(Mutex<(bool, Option<ShowPayload>)>);

/// Bumped on every present/dismiss so the delayed hide at the end of a
/// fade-out can't take down a panel that has since been summoned again.
static GENERATION: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Serialize)]
struct ShowPayload {
    selection: Option<String>,
    model: Option<String>,
    /// Accessibility access granted — without it the selection can't be read.
    access: bool,
}

pub fn plugin() -> TauriPlugin<Wry> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                toggle(app);
            }
        })
        .build()
}

pub fn install(app: &AppHandle, shortcut: &str) {
    app.manage(Anchor::default());
    app.manage(Readiness::default());
    if let Some(w) = app.get_webview_window(WINDOW) {
        #[cfg(target_os = "macos")]
        mac::configure(&w);
        #[cfg(not(target_os = "macos"))]
        let _ = w;
    }
    if let Err(e) = set_shortcut(app, shortcut) {
        log::warn!("quick shortcut {shortcut:?} not registered: {e}");
    }
    #[cfg(debug_assertions)]
    if std::env::var("IM_QUICK").map(|v| v == "1").unwrap_or(false) {
        // scripts/app-snapshot.sh: summon the panel once the main window is up.
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
            toggle(&app);
        });
    }
}

/// Replace the registered shortcut; empty turns the panel off. Fails when the
/// combination is malformed or another app already owns it.
pub fn set_shortcut(app: &AppHandle, shortcut: &str) -> Result<(), String> {
    let gs = app.global_shortcut();
    gs.unregister_all().map_err(|e| e.to_string())?;
    let shortcut = shortcut.trim();
    if shortcut.is_empty() {
        return Ok(());
    }
    gs.register(shortcut).map_err(|e| e.to_string())
}

fn toggle(app: &AppHandle) {
    let Some(w) = app.get_webview_window(WINDOW) else {
        return;
    };
    if w.is_visible().unwrap_or(false) {
        dismiss(app, true);
        return;
    }
    // Read the selection first: once the panel is key, the focused element is ours.
    let selection = selected_text().map(|s| s.chars().take(MAX_SELECTION).collect::<String>());
    if let Some(anchor) = app.try_state::<Anchor>() {
        *anchor.0.lock().unwrap() = Summon {
            mouse: mouse_location(),
            #[cfg(target_os = "macos")]
            previous_app: mac::frontmost_app().filter(|&pid| pid != std::process::id() as i32),
        };
    }
    let model = app
        .try_state::<Arc<Engine>>()
        .and_then(|e| e.store().settings().ok())
        .and_then(|s| s.default_model);
    let payload = ShowPayload {
        selection,
        model,
        access: access_granted(),
    };
    log::debug!(
        "quick: summoned (selection: {} chars, access: {})",
        payload
            .selection
            .as_deref()
            .map_or(0, |s| s.chars().count()),
        payload.access
    );
    if let Some(readiness) = app.try_state::<Readiness>() {
        let mut state = readiness.0.lock().unwrap();
        if !state.0 {
            state.1 = Some(payload);
            return;
        }
    }
    show(app, payload);
}

fn show(app: &AppHandle, payload: ShowPayload) {
    if let Err(e) = app.emit_to(WINDOW, "quick:show", payload) {
        log::warn!("quick: show emit failed: {e}");
    }
}

/// Fade the panel out and hide it. `restore` hands activation back to the app
/// that was in front when the shortcut fired (Esc, the shortcut again); a
/// click elsewhere has already chosen an app, so it passes false.
fn dismiss(app: &AppHandle, restore: bool) {
    let Some(w) = app.get_webview_window(WINDOW) else {
        return;
    };
    if !w.is_visible().unwrap_or(false) {
        return;
    }
    let generation = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    #[cfg(target_os = "macos")]
    {
        mac::fade(&w, 0.0, FADE_OUT);
        if restore {
            if let Some(pid) = app
                .try_state::<Anchor>()
                .and_then(|a| a.0.lock().unwrap().previous_app)
            {
                mac::activate_app(pid);
                #[cfg(debug_assertions)]
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_millis(600)).await;
                    log::debug!(
                        "quick: handed back to pid {pid}; front now {:?}",
                        mac::frontmost_app()
                    );
                });
            }
        }
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_secs_f64(FADE_OUT + 0.02)).await;
            if GENERATION.load(Ordering::SeqCst) == generation {
                let _ = w.hide();
            }
        });
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (restore, generation);
        let _ = w.hide();
    }
}

fn selected_text() -> Option<String> {
    #[cfg(debug_assertions)]
    if let Ok(s) = std::env::var("IM_QUICK_SELECTION") {
        return Some(s).filter(|s| !s.is_empty());
    }
    #[cfg(target_os = "macos")]
    {
        mac::selected_text()
    }
    #[cfg(not(target_os = "macos"))]
    {
        None
    }
}

fn mouse_location() -> Option<(f64, f64)> {
    #[cfg(target_os = "macos")]
    {
        Some(mac::mouse_location())
    }
    #[cfg(not(target_os = "macos"))]
    {
        None
    }
}

fn access_granted() -> bool {
    #[cfg(target_os = "macos")]
    {
        mac::access_granted()
    }
    #[cfg(not(target_os = "macos"))]
    {
        false
    }
}

// ---- commands (called by the panel's frontend and Settings) -------------------

/// The panel's page is listening; a summon that arrived earlier goes out now.
#[tauri::command]
pub fn quick_ready(app: AppHandle) {
    let pending = app.try_state::<Readiness>().and_then(|r| {
        let mut state = r.0.lock().unwrap();
        state.0 = true;
        state.1.take()
    });
    if let Some(payload) = pending {
        show(&app, payload);
    }
}

/// The summoned panel has laid out: size it to `height`, put it by the mouse, fade it in.
#[tauri::command]
pub fn quick_present(app: AppHandle, height: f64) -> Result<(), String> {
    let w = app.get_webview_window(WINDOW).ok_or("no quick window")?;
    GENERATION.fetch_add(1, Ordering::SeqCst);
    let mouse = app
        .try_state::<Anchor>()
        .and_then(|a| a.0.lock().unwrap().mouse);
    log::debug!("quick: present at {mouse:?}, height {height}");
    #[cfg(target_os = "macos")]
    {
        mac::present(&w, mouse, WIDTH, height.max(40.0), FADE_IN);
        w.as_ref().set_focus().map_err(|e| e.to_string())?;
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = mouse;
        w.set_size(tauri::LogicalSize::new(WIDTH, height))
            .map_err(|e| e.to_string())?;
        w.show().map_err(|e| e.to_string())?;
        w.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// The content grew or shrank: follow it, keeping the top edge where it is.
#[tauri::command]
pub fn quick_resize(app: AppHandle, height: f64) -> Result<(), String> {
    let w = app.get_webview_window(WINDOW).ok_or("no quick window")?;
    #[cfg(target_os = "macos")]
    mac::resize(&w, WIDTH, height.max(40.0));
    #[cfg(not(target_os = "macos"))]
    w.set_size(tauri::LogicalSize::new(WIDTH, height))
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Esc (`restore`: give the keyboard back to the app that was in front) or a
/// click elsewhere (`!restore`).
#[tauri::command]
pub fn quick_dismiss(app: AppHandle, restore: bool) {
    dismiss(&app, restore);
}

/// Return in the panel: hide it, bring the main window up and hand it the text.
#[tauri::command]
pub fn quick_submit(app: AppHandle, text: String) -> Result<(), String> {
    dismiss(&app, false);
    if let Some(main) = app.get_webview_window(MAIN) {
        if main.is_minimized().unwrap_or(false) {
            let _ = main.unminimize();
        }
        main.show().map_err(|e| e.to_string())?;
        main.set_focus().map_err(|e| e.to_string())?;
    }
    app.emit_to(MAIN, "quick:send", text)
        .map_err(|e| e.to_string())
}

/// Whether the selection in other apps can be read (macOS Accessibility access).
#[tauri::command]
pub fn quick_access() -> bool {
    access_granted()
}

/// Ask for Accessibility access; macOS shows its own prompt that leads to System Settings.
#[tauri::command]
pub fn quick_request_access() -> bool {
    #[cfg(target_os = "macos")]
    {
        mac::request_access()
    }
    #[cfg(not(target_os = "macos"))]
    {
        false
    }
}

// ---- macOS -------------------------------------------------------------------

#[cfg(target_os = "macos")]
mod mac {
    use std::ffi::{c_char, c_void, CString};
    use std::sync::OnceLock;

    use objc2::encode::{Encode, Encoding};
    use objc2::runtime::{AnyClass, AnyObject, Bool, ClassBuilder, Sel};
    use objc2::{class, msg_send, sel};
    use tauri::WebviewWindow;

    #[repr(C)]
    #[derive(Clone, Copy, Debug)]
    struct Point {
        x: f64,
        y: f64,
    }
    #[repr(C)]
    #[derive(Clone, Copy, Debug)]
    struct Size {
        w: f64,
        h: f64,
    }
    #[repr(C)]
    #[derive(Clone, Copy, Debug)]
    struct Rect {
        origin: Point,
        size: Size,
    }
    unsafe impl Encode for Point {
        const ENCODING: Encoding = Encoding::Struct("CGPoint", &[f64::ENCODING, f64::ENCODING]);
    }
    unsafe impl Encode for Size {
        const ENCODING: Encoding = Encoding::Struct("CGSize", &[f64::ENCODING, f64::ENCODING]);
    }
    unsafe impl Encode for Rect {
        const ENCODING: Encoding = Encoding::Struct("CGRect", &[Point::ENCODING, Size::ENCODING]);
    }
    impl Rect {
        fn max_x(&self) -> f64 {
            self.origin.x + self.size.w
        }
        fn max_y(&self) -> f64 {
            self.origin.y + self.size.h
        }
        fn contains(&self, x: f64, y: f64) -> bool {
            x >= self.origin.x && x < self.max_x() && y >= self.origin.y && y < self.max_y()
        }
    }

    // NSWindowStyleMask / NSWindowCollectionBehavior bits.
    const NON_ACTIVATING_PANEL: usize = 1 << 7;
    const CAN_JOIN_ALL_SPACES: usize = 1 << 0;
    const IGNORES_CYCLE: usize = 1 << 6;
    const FULL_SCREEN_AUXILIARY: usize = 1 << 8;
    /// Gap kept from the screen's visible edges, and the offset from the mouse.
    const MARGIN: f64 = 8.0;
    const OFFSET_X: f64 = 36.0;
    const OFFSET_Y: f64 = 18.0;

    extern "C" fn yes(_: &AnyObject, _: Sel) -> Bool {
        Bool::YES
    }
    extern "C" fn no(_: &AnyObject, _: Sel) -> Bool {
        Bool::NO
    }

    /// `NSPanel` subclass that can become key while borderless. Tao's window class
    /// is swapped for it at runtime (the way tauri-nspanel does); the two differ
    /// only in methods, and the instance size is checked before the swap.
    fn panel_class() -> Option<&'static AnyClass> {
        static CLS: OnceLock<Option<&'static AnyClass>> = OnceLock::new();
        *CLS.get_or_init(|| {
            let superclass = AnyClass::get(c"NSPanel")?;
            let mut builder = ClassBuilder::new(c"ImQuickPanel", superclass)?;
            unsafe {
                builder.add_method(sel!(canBecomeKeyWindow), yes as extern "C" fn(_, _) -> _);
                builder.add_method(sel!(canBecomeMainWindow), no as extern "C" fn(_, _) -> _);
            }
            Some(builder.register())
        })
    }

    fn on_main(w: &WebviewWindow, f: impl FnOnce(*mut AnyObject) + Send + 'static) {
        let target = w.clone();
        let _ = w.run_on_main_thread(move || {
            if let Ok(ns) = target.ns_window() {
                f(ns as *mut AnyObject);
            }
        });
    }

    pub fn configure(w: &WebviewWindow) {
        use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial, NSVisualEffectState};
        on_main(w, |ns| unsafe {
            let obj = &*ns;
            match panel_class() {
                Some(cls) if cls.instance_size() <= obj.class().instance_size() => {
                    AnyObject::set_class(obj, cls);
                    let mask: usize = msg_send![ns, styleMask];
                    let _: () = msg_send![ns, setStyleMask: mask | NON_ACTIVATING_PANEL];
                    // NSPanel defaults that would make it vanish or fight for focus.
                    let _: () = msg_send![ns, setHidesOnDeactivate: false];
                    let _: () = msg_send![ns, setBecomesKeyOnlyIfNeeded: false];
                    let now: usize = msg_send![ns, styleMask];
                    log::debug!("quick: panel class installed; style mask {mask:#x} → {now:#x}");
                }
                _ => log::warn!(
                    "quick: NSPanel conversion unavailable; the panel will activate the app"
                ),
            }
            let _: () = msg_send![ns, setCollectionBehavior: CAN_JOIN_ALL_SPACES | IGNORES_CYCLE | FULL_SCREEN_AUXILIARY];
            let _: () = msg_send![ns, setAlphaValue: 0.0f64];
        });
        // The panel's app is never active, so the material must not follow the window state.
        if let Err(e) = apply_vibrancy(
            w,
            NSVisualEffectMaterial::Popover,
            Some(NSVisualEffectState::Active),
            Some(super::RADIUS),
        ) {
            log::warn!("quick: vibrancy unavailable: {e}");
        }
    }

    pub fn mouse_location() -> (f64, f64) {
        let p: Point = unsafe { msg_send![class!(NSEvent), mouseLocation] };
        (p.x, p.y)
    }

    /// The screen under the point (or the main one), as its visible frame: no menu bar, no Dock.
    unsafe fn visible_frame_at(x: f64, y: f64) -> Option<Rect> {
        let screens: *mut AnyObject = msg_send![class!(NSScreen), screens];
        let count: usize = msg_send![screens, count];
        let mut first = None;
        for i in 0..count {
            let screen: *mut AnyObject = msg_send![screens, objectAtIndex: i];
            let frame: Rect = msg_send![screen, frame];
            let visible: Rect = msg_send![screen, visibleFrame];
            if frame.contains(x, y) {
                return Some(visible);
            }
            first.get_or_insert(visible);
        }
        first
    }

    fn clamp(v: f64, lo: f64, hi: f64) -> f64 {
        if hi < lo {
            lo
        } else {
            v.max(lo).min(hi)
        }
    }

    /// Frame for a `width`×`height` panel hanging off the mouse: its top-left a
    /// little up-left of the pointer, flipped above it when there is no room
    /// below, always inside the visible screen area.
    unsafe fn frame_near(mouse: Option<(f64, f64)>, width: f64, height: f64) -> Rect {
        let (mx, my) = mouse.unwrap_or_else(mouse_location);
        let area = visible_frame_at(mx, my).unwrap_or(Rect {
            origin: Point { x: 0.0, y: 0.0 },
            size: Size {
                w: 1440.0,
                h: 900.0,
            },
        });
        let x = clamp(
            mx - OFFSET_X,
            area.origin.x + MARGIN,
            area.max_x() - width - MARGIN,
        );
        let mut y = my - OFFSET_Y - height; // AppKit y grows upward: this is "below the pointer"
        if y < area.origin.y + MARGIN {
            y = my + OFFSET_Y;
        }
        let y = clamp(y, area.origin.y + MARGIN, area.max_y() - height - MARGIN);
        Rect {
            origin: Point { x, y },
            size: Size {
                w: width,
                h: height,
            },
        }
    }

    unsafe fn animate_alpha(ns: *mut AnyObject, alpha: f64, duration: f64) {
        let _: () = msg_send![class!(NSAnimationContext), beginGrouping];
        let ctx: *mut AnyObject = msg_send![class!(NSAnimationContext), currentContext];
        let _: () = msg_send![ctx, setDuration: duration];
        let animator: *mut AnyObject = msg_send![ns, animator];
        let _: () = msg_send![animator, setAlphaValue: alpha];
        let _: () = msg_send![class!(NSAnimationContext), endGrouping];
    }

    pub fn present(
        w: &WebviewWindow,
        mouse: Option<(f64, f64)>,
        width: f64,
        height: f64,
        fade_in: f64,
    ) {
        on_main(w, move |ns| unsafe {
            let frame = frame_near(mouse, width, height);
            let _: () = msg_send![ns, setAlphaValue: 0.0f64];
            let _: () = msg_send![ns, setFrame: frame, display: false];
            // The panel comes up and takes the keyboard; the app's other windows stay
            // where they are (checked against the on-screen window order).
            let _: () = msg_send![ns, orderFrontRegardless];
            let _: () = msg_send![ns, makeKeyWindow];
            let _: () = msg_send![ns, invalidateShadow];
            animate_alpha(ns, 1.0, fade_in);
            if log::log_enabled!(log::Level::Debug) {
                let key: bool = msg_send![ns, isKeyWindow];
                let cls = (*ns).class().name().to_string_lossy().into_owned();
                log::debug!("quick: shown at {:?} as {cls}, key: {key}", frame.origin);
            }
        });
    }

    /// pid of the frontmost app.
    pub fn frontmost_app() -> Option<i32> {
        unsafe {
            let workspace: *mut AnyObject = msg_send![class!(NSWorkspace), sharedWorkspace];
            let front: *mut AnyObject = msg_send![workspace, frontmostApplication];
            if front.is_null() {
                return None;
            }
            let pid: i32 = msg_send![front, processIdentifier];
            Some(pid)
        }
    }

    /// Bring `pid` back to the front (we are active at this point, so the hand-off is allowed).
    pub fn activate_app(pid: i32) {
        const ACTIVATE_IGNORING_OTHER_APPS: usize = 1 << 1;
        unsafe {
            let running: *mut AnyObject = msg_send![class!(NSRunningApplication), runningApplicationWithProcessIdentifier: pid];
            if !running.is_null() {
                let _: bool = msg_send![running, activateWithOptions: ACTIVATE_IGNORING_OTHER_APPS];
            }
        }
    }

    pub fn resize(w: &WebviewWindow, width: f64, height: f64) {
        on_main(w, move |ns| unsafe {
            let cur: Rect = msg_send![ns, frame];
            let top = cur.max_y();
            let mut y = top - height;
            if let Some(area) = visible_frame_at(cur.origin.x + 1.0, top - 1.0) {
                if y < area.origin.y + MARGIN {
                    y = area.origin.y + MARGIN;
                }
            }
            let frame = Rect {
                origin: Point { x: cur.origin.x, y },
                size: Size {
                    w: width,
                    h: height,
                },
            };
            let _: () = msg_send![ns, setFrame: frame, display: true];
            let _: () = msg_send![ns, invalidateShadow];
        });
    }

    pub fn fade(w: &WebviewWindow, alpha: f64, duration: f64) {
        on_main(w, move |ns| unsafe { animate_alpha(ns, alpha, duration) });
    }

    // ---- selected text via Accessibility ---------------------------------------

    type CFTypeRef = *const c_void;
    // `*mut` to match snapshot.rs's declaration of the same CF functions.
    type CFStringRef = *mut c_void;
    type AXUIElementRef = *const c_void;

    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXIsProcessTrusted() -> bool;
        fn AXIsProcessTrustedWithOptions(options: *const c_void) -> bool;
        fn AXUIElementCreateSystemWide() -> AXUIElementRef;
        fn AXUIElementCopyAttributeValue(
            element: AXUIElementRef,
            attribute: CFStringRef,
            value: *mut CFTypeRef,
        ) -> i32;
        fn AXUIElementSetMessagingTimeout(element: AXUIElementRef, timeout: f32) -> i32;
        static kAXTrustedCheckOptionPrompt: CFStringRef;
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFStringCreateWithCString(
            alloc: *const c_void,
            cstr: *const c_char,
            encoding: u32,
        ) -> CFStringRef;
        fn CFStringGetLength(s: CFTypeRef) -> isize;
        fn CFStringGetMaximumSizeForEncoding(length: isize, encoding: u32) -> isize;
        fn CFStringGetCString(
            s: CFTypeRef,
            buffer: *mut c_char,
            size: isize,
            encoding: u32,
        ) -> bool;
        fn CFGetTypeID(cf: CFTypeRef) -> usize;
        fn CFStringGetTypeID() -> usize;
        fn CFDictionaryCreate(
            alloc: *const c_void,
            keys: *const *const c_void,
            values: *const *const c_void,
            count: isize,
            key_callbacks: *const c_void,
            value_callbacks: *const c_void,
        ) -> *const c_void;
        fn CFRelease(cf: *const c_void);
        static kCFTypeDictionaryKeyCallBacks: c_void;
        static kCFTypeDictionaryValueCallBacks: c_void;
        static kCFBooleanTrue: CFTypeRef;
    }

    const UTF8: u32 = 0x0800_0100;

    unsafe fn cfstr(s: &str) -> CFStringRef {
        let c = CString::new(s).unwrap();
        CFStringCreateWithCString(std::ptr::null(), c.as_ptr(), UTF8)
    }

    unsafe fn string_of(cf: CFTypeRef) -> Option<String> {
        if cf.is_null() || CFGetTypeID(cf) != CFStringGetTypeID() {
            return None;
        }
        let len = CFStringGetMaximumSizeForEncoding(CFStringGetLength(cf), UTF8) + 1;
        let mut buf = vec![0u8; len.max(1) as usize];
        if !CFStringGetCString(cf, buf.as_mut_ptr() as *mut c_char, len, UTF8) {
            return None;
        }
        let end = buf.iter().position(|&b| b == 0).unwrap_or(buf.len());
        buf.truncate(end);
        String::from_utf8(buf).ok()
    }

    /// `attribute` of `element`, released by the caller.
    unsafe fn attribute(element: AXUIElementRef, attribute: &str) -> Option<CFTypeRef> {
        let name = cfstr(attribute);
        let mut value: CFTypeRef = std::ptr::null();
        let err = AXUIElementCopyAttributeValue(element, name, &mut value);
        CFRelease(name);
        (err == 0 && !value.is_null()).then_some(value)
    }

    pub fn access_granted() -> bool {
        unsafe { AXIsProcessTrusted() }
    }

    pub fn request_access() -> bool {
        unsafe {
            let keys = [kAXTrustedCheckOptionPrompt as *const c_void];
            let values = [kCFBooleanTrue];
            let options = CFDictionaryCreate(
                std::ptr::null(),
                keys.as_ptr(),
                values.as_ptr(),
                1,
                &kCFTypeDictionaryKeyCallBacks,
                &kCFTypeDictionaryValueCallBacks,
            );
            let trusted = AXIsProcessTrustedWithOptions(options);
            if !options.is_null() {
                CFRelease(options);
            }
            trusted
        }
    }

    /// The text selected in the focused element of whatever app is frontmost,
    /// or None when there is none / the app doesn't expose it / we lack access.
    pub fn selected_text() -> Option<String> {
        if !access_granted() {
            return None;
        }
        unsafe {
            let system = AXUIElementCreateSystemWide();
            if system.is_null() {
                return None;
            }
            // Set on the system-wide element this applies to every element: an
            // unresponsive app must not hold the panel back.
            AXUIElementSetMessagingTimeout(system, 0.25);
            let text = attribute(system, "AXFocusedUIElement").and_then(|focused| {
                let value = attribute(focused, "AXSelectedText");
                let text = value.and_then(|v| {
                    let s = string_of(v);
                    CFRelease(v);
                    s
                });
                CFRelease(focused);
                text
            });
            CFRelease(system);
            text.filter(|s| !s.trim().is_empty())
        }
    }
}
