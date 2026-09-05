// Hotline Tauri App

mod commands;
mod protocol;
mod state;

use state::AppState;
use tauri::{Manager, Emitter};

#[cfg(not(mobile))]
fn build_menu(app: &tauri::App) -> tauri::Result<()> {
    use tauri::menu::{MenuBuilder, SubmenuBuilder, PredefinedMenuItem, AboutMetadata, MenuItem};

    let app_submenu = SubmenuBuilder::new(app, "Hotline Navigator")
        .item(&PredefinedMenuItem::about(app, Some("About Hotline Navigator"), Some(AboutMetadata {
            name: Some("Hotline Navigator".into()),
            version: Some(env!("CARGO_PKG_VERSION").into()),
            copyright: Some("Copyright © 2025-2026 Greg Gant".into()),
            comments: Some("A modern Hotline client".into()),
            ..Default::default()
        }))?)
        .separator()
        .item(&MenuItem::with_id(app, "settings", "Settings...", true, Some("CmdOrCtrl+,"))?)
        .separator()
        .item(&PredefinedMenuItem::hide(app, Some("Hide Hotline Navigator"))?)
        .item(&PredefinedMenuItem::hide_others(app, Some("Hide Others"))?)
        .item(&PredefinedMenuItem::show_all(app, Some("Show All"))?)
        .separator()
        .item(&PredefinedMenuItem::quit(app, Some("Quit Hotline Navigator"))?)
        .build()?;

    let edit_submenu = SubmenuBuilder::new(app, "Edit")
        .item(&PredefinedMenuItem::undo(app, None)?)
        .item(&PredefinedMenuItem::redo(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, None)?)
        .item(&PredefinedMenuItem::copy(app, None)?)
        .item(&PredefinedMenuItem::paste(app, None)?)
        .item(&PredefinedMenuItem::select_all(app, None)?)
        .build()?;

    let window_submenu = SubmenuBuilder::new(app, "Window")
        .item(&PredefinedMenuItem::minimize(app, None)?)
        .item(&PredefinedMenuItem::maximize(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::close_window(app, Some("Close Window"))?)
        .build()?;

    let help_submenu = SubmenuBuilder::new(app, "Help")
        .item(&MenuItem::with_id(app, "help_wiki", "Hotline Navigator Wiki", true, None::<&str>)?)
        .item(&MenuItem::with_id(app, "help_github", "Hotline Navigator on GitHub", true, None::<&str>)?)
        .item(&MenuItem::with_id(app, "help_issues", "Report an Issue", true, None::<&str>)?)
        .item(&MenuItem::with_id(app, "help_readme", "README", true, None::<&str>)?)
        .build()?;

    let menu = MenuBuilder::new(app)
        .item(&app_submenu)
        .item(&edit_submenu)
        .item(&window_submenu)
        .item(&help_submenu)
        .build()?;

    app.set_menu(menu)?;

    // Handle menu events
    app.on_menu_event(move |app_handle, event| {
        match event.id().as_ref() {
            "settings" => {
                let _ = app_handle.emit("menu-settings", ());
            }
            "help_wiki" => {
                let _ = tauri_plugin_opener::open_url("https://github.com/fuzzywalrus/Hotline-Navigator/wiki", None::<&str>);
            }
            "help_github" => {
                let _ = tauri_plugin_opener::open_url("https://github.com/fuzzywalrus/Hotline-Navigator", None::<&str>);
            }
            "help_issues" => {
                let _ = tauri_plugin_opener::open_url("https://github.com/fuzzywalrus/Hotline-Navigator/issues", None::<&str>);
            }
            "help_readme" => {
                let _ = tauri_plugin_opener::open_url("https://github.com/fuzzywalrus/Hotline-Navigator/blob/main/README.md", None::<&str>);
            }
            _ => {}
        }
    });

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_stronghold::Builder::new(|password| {
            // Use argon2 key derivation with app-specific salt
            use argon2::{hash_raw, Config, Variant, Version};
            let config = Config {
                lanes: 4,
                mem_cost: 10_000,
                time_cost: 10,
                variant: Variant::Argon2id,
                version: Version::Version13,
                ..Default::default()
            };
            let salt = b"hotline-navigator-stronghold-salt";
            let key = hash_raw(password.as_ref(), salt, &config)
                .expect("Failed to derive key");
            key.to_vec()
        }).build())
        .setup(|app| {
            // Get app data directory
            let app_data_dir = app
                .handle()
                .path()
                .app_data_dir()
                .expect("Failed to get app data directory");

            // Initialize app state with persistent storage
            let app_state = AppState::new(app_data_dir, app.handle().clone());
            app.manage(app_state);

            // Build native menu bar (macOS/Windows/Linux only)
            #[cfg(not(mobile))]
            build_menu(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::connect_to_server,
            commands::cancel_connection,
            commands::disconnect_from_server,
            commands::update_user_info,
            commands::send_chat_message,
            commands::send_private_message,
            commands::get_message_board,
            commands::post_message_board,
            commands::get_file_list,
            commands::download_file,
            commands::download_folder,
            commands::upload_folder,
            commands::upload_file,
            commands::get_news_categories,
            commands::get_news_articles,
            commands::get_news_article_data,
            commands::post_news_article,
            commands::get_bookmarks,
            commands::bookmark_vault_status,
            commands::finish_bookmark_vault_migration,
            commands::save_bookmark,
            commands::delete_bookmark,
            commands::reorder_bookmarks,
            commands::add_default_bookmarks,
            commands::get_pending_agreement,
            commands::accept_agreement,
            commands::download_banner,
            commands::read_preview_file,
            commands::fetch_tracker_servers,
            commands::get_server_info,
            commands::get_user_access,
            commands::get_client_info,
            commands::delete_file,
            commands::move_file,
            commands::get_file_info,
            commands::set_file_info,
            commands::disconnect_user,
            commands::test_connection,
            commands::check_for_updates,
            commands::pick_download_folder,
            commands::send_broadcast,
            commands::create_folder,
            commands::create_news_category,
            commands::create_news_folder,
            commands::delete_news_item,
            commands::delete_news_article,
            commands::invite_to_new_chat,
            commands::invite_to_chat,
            commands::reject_chat_invite,
            commands::join_chat,
            commands::leave_chat,
            commands::set_chat_subject,
            commands::send_private_chat,
            commands::mnemosyne_fetch,
            commands::fetch_link_preview,
            commands::fetch_external_image,
            commands::get_chat_history,
            commands::upload_media,
            commands::download_media,
            commands::get_inline_media_status,
            commands::set_inline_media_enabled,
            commands::pick_image_for_chat,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
