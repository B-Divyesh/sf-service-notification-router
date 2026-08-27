mod crypto;
mod delivery;
mod error;
mod routes;

use axum::{http::{header, HeaderValue}, routing::{get, post}, Router};
use sqlx::{sqlite::{SqliteConnectOptions, SqlitePoolOptions}, SqlitePool};
use std::{env, path::{Path, PathBuf}, str::FromStr, sync::Arc, time::Duration};
use tower_http::{
    catch_panic::CatchPanicLayer,
    compression::CompressionLayer,
    limit::RequestBodyLimitLayer,
    services::{ServeDir, ServeFile},
    set_header::SetResponseHeaderLayer,
    trace::TraceLayer,
};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[derive(Clone)]
pub struct AppState {
    pub pool: SqlitePool,
    pub encryption_key: Arc<[u8; 32]>,
    pub config: Arc<AppConfig>,
    pub http: reqwest::Client,
}

#[derive(Clone)]
pub struct AppConfig {
    pub public_base_url: String,
    pub billing_api_base: String,
    pub smtp_host: Option<String>,
    pub smtp_port: u16,
    pub smtp_username: Option<String>,
    pub smtp_password: Option<String>,
    pub smtp_from: Option<String>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "service_notification_router=info,tower_http=info".into()))
        .with(tracing_subscriber::fmt::layer().json())
        .init();

    let data_dir = PathBuf::from(env::var("DATA_DIR").unwrap_or_else(|_| "./data".into()));
    std::fs::create_dir_all(&data_dir)?;
    let db_path = data_dir.join("router.db");
    let database_url = format!("sqlite://{}", db_path.display());
    let options = SqliteConnectOptions::from_str(&database_url)?.create_if_missing(true).foreign_keys(true);
    let pool = SqlitePoolOptions::new().max_connections(8).connect_with(options).await?;
    sqlx::migrate!().run(&pool).await?;
    let encryption_key = crypto::load_or_create_key(&data_dir.join("router.key"))?;
    let config = AppConfig {
        public_base_url: env::var("PUBLIC_BASE_URL").unwrap_or_else(|_| "http://localhost:8080".into()).trim_end_matches('/').into(),
        billing_api_base: env::var("BILLING_API_BASE").unwrap_or_else(|_| "https://api.sociobot.in/api/v1".into()).trim_end_matches('/').into(),
        smtp_host: env::var("SMTP_HOST").ok(),
        smtp_port: env::var("SMTP_PORT").ok().and_then(|v| v.parse().ok()).unwrap_or(587),
        smtp_username: env::var("SMTP_USERNAME").ok(),
        smtp_password: env::var("SMTP_PASSWORD").ok(),
        smtp_from: env::var("SMTP_FROM").ok(),
    };
    let state = AppState {
        pool,
        encryption_key: Arc::new(encryption_key),
        config: Arc::new(config),
        http: reqwest::Client::builder().timeout(Duration::from_secs(10)).user_agent("service-notification-router/1.0").build()?,
    };
    spawn_maintenance(state.clone());

    let app = build_app(state, Path::new("frontend/dist"));
    let port = env::var("PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(8080);
    let listener = tokio::net::TcpListener::bind(("0.0.0.0", port)).await?;
    tracing::info!(port, "router listening");
    axum::serve(listener, app).with_graceful_shutdown(shutdown_signal()).await?;
    Ok(())
}

pub fn build_app(state: AppState, frontend_dir: &Path) -> Router {
    let index = frontend_dir.join("index.html");
    let api = Router::new()
        .route("/health", get(routes::health))
        .route("/api/status", get(routes::status))
        .route("/api/setup", post(routes::setup))
        .route("/api/login", post(routes::login))
        .route("/api/config", get(routes::config).patch(routes::update_config))
        .route("/api/secret/rotate", post(routes::rotate_secret))
        .route("/api/recipients", get(routes::list_recipients).post(routes::create_recipient))
        .route("/api/recipients/{id}", axum::routing::delete(routes::delete_recipient))
        .route("/api/rules", get(routes::list_rules).post(routes::create_rule))
        .route("/api/rules/{id}", axum::routing::delete(routes::delete_rule))
        .route("/api/bookings", post(routes::receive_booking))
        .route("/api/bookings/test", post(routes::test_booking))
        .route("/api/events", get(routes::list_events))
        .route("/api/events/{id}/retry", post(routes::retry_event))
        .route("/api/ack/{token}", get(routes::ack_status).post(routes::acknowledge))
        .route("/api/purge", post(routes::purge_now))
        .route("/api/license", post(routes::activate_license));

    Router::new()
        .merge(api)
        .fallback_service(ServeDir::new(frontend_dir).not_found_service(ServeFile::new(index)))
        .with_state(state)
        .layer(CatchPanicLayer::new())
        .layer(RequestBodyLimitLayer::new(256 * 1024))
        .layer(CompressionLayer::new())
        .layer(SetResponseHeaderLayer::if_not_present(header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff")))
        .layer(SetResponseHeaderLayer::if_not_present(header::REFERRER_POLICY, HeaderValue::from_static("same-origin")))
        .layer(SetResponseHeaderLayer::if_not_present(header::X_FRAME_OPTIONS, HeaderValue::from_static("DENY")))
        .layer(SetResponseHeaderLayer::if_not_present(header::CONTENT_SECURITY_POLICY, HeaderValue::from_static("default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self' https://api.sociobot.in https://pilot-api.sociobot.in; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://api.sociobot.in")))
        .layer(TraceLayer::new_for_http())
}

fn spawn_maintenance(state: AppState) {
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(Duration::from_secs(30));
        loop {
            tick.tick().await;
            if let Err(error) = routes::purge_expired(&state).await { tracing::warn!(%error, "retention purge failed"); }
            let ids = sqlx::query_scalar::<_, i64>("SELECT id FROM notifications WHERE status IN ('queued','failed') AND attempt_count < 8 AND (next_attempt_at IS NULL OR datetime(next_attempt_at) <= datetime('now')) ORDER BY id LIMIT 20")
                .fetch_all(&state.pool).await.unwrap_or_default();
            for id in ids { delivery::deliver_notification(&state, id).await; }
        }
    });
}

async fn shutdown_signal() {
    let ctrl_c = async { tokio::signal::ctrl_c().await.expect("install Ctrl+C handler"); };
    #[cfg(unix)]
    let terminate = async { tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()).expect("install signal handler").recv().await; };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! { _ = ctrl_c => {}, _ = terminate => {} }
    tracing::info!("shutdown requested");
}
