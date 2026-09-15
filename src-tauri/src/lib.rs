//! Tauri glue: commands, native menus, window chrome. Everything with real
//! logic lives in `engine`, `llm`, `store`; this file only forwards.

pub mod engine;
pub mod llm;
mod menu;
pub mod model;
#[cfg(all(debug_assertions, target_os = "macos"))]
mod snapshot;
pub mod sse;
pub mod store;

use std::path::PathBuf;
use std::sync::Arc;

use serde::Deserialize;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};

use engine::{Engine, TurnEvent, TurnKind};
use model::*;
use store::Store;

type Cmd<T> = Result<T, String>;

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

fn data_root(app: &AppHandle) -> tauri::Result<PathBuf> {
    if let Some(dir) = std::env::var_os("IM_DATA_DIR") {
        return Ok(PathBuf::from(dir));
    }
    Ok(app.path().data_dir()?.join("im"))
}

// ---- sessions --------------------------------------------------------------

#[tauri::command]
fn list_sessions(engine: State<'_, Arc<Engine>>) -> Cmd<Vec<SessionSummary>> {
    engine.store().list_sessions().map_err(err)
}

#[tauri::command]
fn get_session(engine: State<'_, Arc<Engine>>, id: String) -> Cmd<Session> {
    engine.store().session(&id).map_err(err)
}

#[tauri::command]
fn delete_session(engine: State<'_, Arc<Engine>>, id: String) -> Cmd<()> {
    engine.cancel(&id);
    engine.store().delete_session(&id).map_err(err)
}

#[tauri::command]
fn rename_session(engine: State<'_, Arc<Engine>>, id: String, title: String) -> Cmd<Session> {
    let store = engine.store();
    let mut s = store.session(&id).map_err(err)?;
    let title = title.trim();
    if !title.is_empty() {
        s.title = title.chars().take(120).collect();
    }
    store.save_session(&s).map_err(err)?;
    Ok(s)
}

#[tauri::command]
fn set_session_model(engine: State<'_, Arc<Engine>>, id: String, provider_id: String, model: String) -> Cmd<Session> {
    let store = engine.store();
    let mut s = store.session(&id).map_err(err)?;
    s.provider_id = provider_id;
    s.model = model;
    store.save_session(&s).map_err(err)?;
    Ok(s)
}

#[tauri::command]
async fn run_turn(engine: State<'_, Arc<Engine>>, kind: TurnKind, on_event: Channel<TurnEvent>) -> Cmd<()> {
    let engine = engine.inner().clone();
    engine
        .run_turn(kind, move |ev| {
            if let Err(e) = on_event.send(ev) {
                log::warn!("channel send failed: {e}");
            }
        })
        .await
        .map_err(err)
}

#[tauri::command]
fn cancel_turn(engine: State<'_, Arc<Engine>>, session_id: String) -> bool {
    engine.cancel(&session_id)
}

#[tauri::command]
fn active_turns(engine: State<'_, Arc<Engine>>, ids: Vec<String>) -> Vec<String> {
    ids.into_iter().filter(|id| engine.is_active(id)).collect()
}

// ---- providers & settings --------------------------------------------------

#[tauri::command]
fn get_providers(engine: State<'_, Arc<Engine>>) -> Cmd<Vec<ProviderView>> {
    engine.store().provider_views().map_err(err)
}

#[derive(Debug, Deserialize)]
struct ProviderInput {
    #[serde(flatten)]
    provider: Provider,
    /// `None` leaves the stored key untouched; `Some("")` clears it.
    #[serde(default)]
    api_key: Option<String>,
}

#[tauri::command]
fn save_provider(engine: State<'_, Arc<Engine>>, input: ProviderInput) -> Cmd<Vec<ProviderView>> {
    let store = engine.store();
    let mut p = input.provider;
    p.id = p.id.trim().to_string();
    if p.id.is_empty() || !p.id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err("provider id must be alphanumeric".into());
    }
    p.base_url = p.base_url.trim().trim_end_matches('/').to_string();
    if p.name.trim().is_empty() {
        p.name = p.id.clone();
    }
    p.models.retain(|m| !m.trim().is_empty());
    store.upsert_provider(p.clone()).map_err(err)?;
    if let Some(key) = input.api_key {
        store.set_api_key(&p.id, Some(&key)).map_err(err)?;
    }
    store.provider_views().map_err(err)
}

#[tauri::command]
fn delete_provider(engine: State<'_, Arc<Engine>>, id: String) -> Cmd<Vec<ProviderView>> {
    engine.store().delete_provider(&id).map_err(err)?;
    engine.store().provider_views().map_err(err)
}

#[tauri::command]
async fn fetch_models(
    engine: State<'_, Arc<Engine>>,
    protocol: Protocol,
    base_url: String,
    api_key: Option<String>,
    provider_id: Option<String>,
) -> Cmd<Vec<String>> {
    let key = match api_key.filter(|k| !k.trim().is_empty()) {
        Some(k) => Some(k),
        None => match provider_id {
            Some(id) => engine.store().api_key(&id).map_err(err)?,
            None => None,
        },
    };
    llm::list_models(engine.client(), protocol, base_url.trim(), key.as_deref()).await.map_err(err)
}

#[tauri::command]
fn get_settings(engine: State<'_, Arc<Engine>>) -> Cmd<Settings> {
    engine.store().settings().map_err(err)
}

#[tauri::command]
fn save_settings(app: AppHandle, engine: State<'_, Arc<Engine>>, settings: Settings) -> Cmd<()> {
    engine.store().save_settings(&settings).map_err(err)?;
    menu::apply_appearance(&app, settings.appearance);
    Ok(())
}

#[tauri::command]
fn data_dir(engine: State<'_, Arc<Engine>>) -> String {
    engine.store().root().display().to_string()
}

#[tauri::command]
fn reveal_data_dir(app: AppHandle, engine: State<'_, Arc<Engine>>) -> Cmd<()> {
    use tauri_plugin_opener::OpenerExt;
    app.opener().open_path(engine.store().root().display().to_string(), None::<&str>).map_err(err)
}

#[tauri::command]
fn export_jsonl(engine: State<'_, Arc<Engine>>, path: String) -> Cmd<usize> {
    engine.store().export_jsonl(std::path::Path::new(&path)).map_err(err)
}

#[tauri::command]
fn export_session(engine: State<'_, Arc<Engine>>, id: String, path: String) -> Cmd<()> {
    let s = engine.store().session(&id).map_err(err)?;
    let bytes = serde_json::to_vec_pretty(&s).map_err(err)?;
    std::fs::write(&path, bytes).map_err(err)
}

#[tauri::command]
fn popup_menu(window: tauri::Window, items: Vec<menu::ContextItem>) -> Cmd<()> {
    menu::popup(window, items).map_err(err)
}

/// Debug builds only: `IM_SCENARIO` / `IM_AUTOSEND` let scripts drive the UI
/// (see scripts/app-snapshot.sh). Always empty in release.
#[tauri::command]
fn debug_scenario() -> serde_json::Value {
    #[cfg(debug_assertions)]
    {
        serde_json::json!({
            "state": std::env::var("IM_SCENARIO").ok(),
            "autosend": std::env::var("IM_AUTOSEND").ok(),
        })
    }
    #[cfg(not(debug_assertions))]
    {
        serde_json::Value::Null
    }
}

/// Webview console errors, forwarded so they show up in the process log.
#[tauri::command]
fn log_message(level: String, message: String) {
    match level.as_str() {
        "error" => log::error!(target: "webview", "{message}"),
        "warn" => log::warn!(target: "webview", "{message}"),
        _ => log::info!(target: "webview", "{message}"),
    }
}

// ---- app -------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("im=info,webview=info")).init();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let root = data_root(app.handle())?;
            let store = Store::new(root)?;
            let settings = store.settings()?;
            app.manage(Arc::new(Engine::new(store)));

            menu::install(app.handle(), settings.appearance)?;

            if let Some(window) = app.get_webview_window("main") {
                #[cfg(target_os = "macos")]
                {
                    use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial, NSVisualEffectState};
                    if let Err(e) = apply_vibrancy(
                        &window,
                        NSVisualEffectMaterial::Sidebar,
                        Some(NSVisualEffectState::FollowsWindowActiveState),
                        None,
                    ) {
                        log::warn!("vibrancy unavailable: {e}");
                    }
                }
                let _ = window.set_theme(menu::theme_for(settings.appearance));

                // The red button and Window → Close hide the window instead of
                // destroying it: a destroyed window plus a still-running app
                // (ExitRequested is prevented below) is an app with no window
                // that the dock click can't bring back.
                #[cfg(target_os = "macos")]
                {
                    let w = window.clone();
                    window.on_window_event(move |event| {
                        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                            api.prevent_close();
                            let _ = w.hide();
                        }
                    });
                }

                // The frontend shows the window once it has rendered; if it never
                // does (a startup exception), show it anyway so the failure is visible.
                let w = window.clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                    if !w.is_visible().unwrap_or(true) {
                        log::warn!("frontend did not show the window within 5s; showing it");
                        let _ = w.show();
                    }
                });
            }
            #[cfg(all(debug_assertions, target_os = "macos"))]
            snapshot::install(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_sessions,
            get_session,
            delete_session,
            rename_session,
            set_session_model,
            run_turn,
            cancel_turn,
            active_turns,
            get_providers,
            save_provider,
            delete_provider,
            fetch_models,
            get_settings,
            save_settings,
            data_dir,
            reveal_data_dir,
            export_jsonl,
            export_session,
            popup_menu,
            log_message,
            debug_scenario,
        ])
        .build(tauri::generate_context!())
        .expect("error while building im")
        .run(|app, event| match event {
            // ⌘W hides the window; clicking the dock icon brings it back.
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen { .. } => {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
            tauri::RunEvent::ExitRequested { api, code: None, .. } => {
                // Closing the last window keeps the app alive, as macOS apps do.
                #[cfg(target_os = "macos")]
                api.prevent_exit();
                #[cfg(not(target_os = "macos"))]
                let _ = api;
            }
            _ => {}
        });
}
