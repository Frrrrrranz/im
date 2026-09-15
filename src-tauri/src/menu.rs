//! Native menu bar and context menus. Menu clicks are forwarded to the
//! webview as a `menu` event carrying the item id; the frontend owns the
//! behaviour so keyboard shortcuts and menu items share one code path.

use serde::Deserialize;
use tauri::menu::{
    AboutMetadata, CheckMenuItem, ContextMenu, Menu, MenuBuilder, MenuItem, MenuItemBuilder, PredefinedMenuItem,
    SubmenuBuilder,
};
use tauri::{AppHandle, Emitter, Manager, Runtime, Wry};

use crate::model::Appearance;

pub const APPEARANCE_ITEMS: [(&str, Appearance); 3] = [
    ("appearance:system", Appearance::System),
    ("appearance:light", Appearance::Light),
    ("appearance:dark", Appearance::Dark),
];

struct AppearanceMenu(Vec<(Appearance, CheckMenuItem<Wry>)>);

pub fn theme_for(a: Appearance) -> Option<tauri::Theme> {
    match a {
        Appearance::System => None,
        Appearance::Light => Some(tauri::Theme::Light),
        Appearance::Dark => Some(tauri::Theme::Dark),
    }
}

pub fn apply_appearance(app: &AppHandle, appearance: Appearance) {
    if let Some(items) = app.try_state::<AppearanceMenu>() {
        for (a, item) in &items.0 {
            let _ = item.set_checked(*a == appearance);
        }
    }
    for label in ["main", crate::quick::WINDOW] {
        if let Some(w) = app.get_webview_window(label) {
            let _ = w.set_theme(theme_for(appearance));
        }
    }
}

pub fn install(app: &AppHandle, appearance: Appearance) -> tauri::Result<()> {
    let about = AboutMetadata {
        name: Some("im".into()),
        version: Some(env!("CARGO_PKG_VERSION").into()),
        comments: Some("An ultra-lightweight LLM chat client.".into()),
        ..Default::default()
    };

    let app_menu = SubmenuBuilder::new(app, "im")
        .item(&PredefinedMenuItem::about(app, Some("About im"), Some(about))?)
        .item(&MenuItem::with_id(app, "check_updates", "Check for Updates…", true, None::<&str>)?)
        .separator()
        .item(&MenuItem::with_id(app, "settings", "Settings…", true, Some("CmdOrCtrl+Comma"))?)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;

    let file_menu = SubmenuBuilder::new(app, "File")
        .item(&MenuItem::with_id(app, "new_chat", "New Chat", true, Some("CmdOrCtrl+N"))?)
        .item(&MenuItem::with_id(app, "attach_image", "Attach Image…", true, Some("Shift+CmdOrCtrl+A"))?)
        .separator()
        .item(&MenuItem::with_id(app, "export_chat", "Export Chat…", true, Some("Shift+CmdOrCtrl+E"))?)
        .item(&MenuItem::with_id(app, "export_all", "Export All Chats as JSONL…", true, None::<&str>)?)
        .item(&MenuItem::with_id(app, "show_data", "Show Data Folder", true, None::<&str>)?)
        .separator()
        .item(&MenuItem::with_id(app, "delete_chat", "Delete Chat", true, None::<&str>)?)
        .separator()
        .item(&MenuItem::with_id(app, "close", "Close", true, Some("CmdOrCtrl+W"))?)
        .build()?;

    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let mut checks = Vec::new();
    let mut appearance_menu = SubmenuBuilder::new(app, "Appearance");
    for (id, a) in APPEARANCE_ITEMS {
        let label = match a {
            Appearance::System => "System",
            Appearance::Light => "Light",
            Appearance::Dark => "Dark",
        };
        let item = CheckMenuItem::with_id(app, id, label, true, a == appearance, None::<&str>)?;
        appearance_menu = appearance_menu.item(&item);
        checks.push((a, item));
    }
    let appearance_menu = appearance_menu.build()?;
    app.manage(AppearanceMenu(checks));

    let view_menu = SubmenuBuilder::new(app, "View")
        .item(&MenuItem::with_id(app, "toggle_sidebar", "Toggle Sidebar", true, Some("Ctrl+CmdOrCtrl+S"))?)
        .item(&MenuItem::with_id(app, "toggle_inspector", "Toggle Trajectory", true, Some("Alt+CmdOrCtrl+T"))?)
        .item(&MenuItem::with_id(app, "choose_model", "Choose Model…", true, Some("CmdOrCtrl+K"))?)
        .separator()
        .item(&appearance_menu)
        .separator()
        .fullscreen()
        .build()?;

    let chat_menu = SubmenuBuilder::new(app, "Chat")
        .item(&MenuItem::with_id(app, "stop", "Stop Generating", true, Some("CmdOrCtrl+Period"))?)
        .item(&MenuItem::with_id(app, "regenerate", "Regenerate", true, Some("CmdOrCtrl+R"))?)
        .item(&MenuItem::with_id(app, "edit_last", "Edit Last Message", true, Some("CmdOrCtrl+E"))?)
        .separator()
        .item(&MenuItem::with_id(app, "prev_chat", "Previous Chat", true, Some("Shift+CmdOrCtrl+BracketLeft"))?)
        .item(&MenuItem::with_id(app, "next_chat", "Next Chat", true, Some("Shift+CmdOrCtrl+BracketRight"))?)
        .build()?;

    let window_menu = SubmenuBuilder::new(app, "Window").minimize().maximize().separator().close_window().build()?;

    let menu = MenuBuilder::new(app)
        .items(&[&app_menu, &file_menu, &edit_menu, &view_menu, &chat_menu, &window_menu])
        .build()?;
    app.set_menu(menu)?;

    app.on_menu_event(|app, event| {
        let id = event.id().0.as_str();
        match id {
            "close" => {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.hide();
                }
            }
            _ => {
                if let Err(e) = app.emit("menu", id) {
                    log::warn!("menu emit failed: {e}");
                }
            }
        }
    });
    Ok(())
}

/// One entry of a context menu requested by the frontend.
#[derive(Debug, Clone, Deserialize)]
pub struct ContextItem {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub label: String,
    #[serde(default = "yes")]
    pub enabled: bool,
    #[serde(default)]
    pub separator: bool,
}

fn yes() -> bool {
    true
}

pub fn popup<R: Runtime>(window: tauri::Window<R>, items: Vec<ContextItem>) -> tauri::Result<()> {
    let app = window.app_handle();
    let mut builder = MenuBuilder::new(app);
    for item in items {
        if item.separator {
            builder = builder.separator();
        } else {
            let mi = MenuItemBuilder::with_id(item.id, item.label).enabled(item.enabled).build(app)?;
            builder = builder.item(&mi);
        }
    }
    let menu: Menu<R> = builder.build()?;
    menu.popup(window)
}
