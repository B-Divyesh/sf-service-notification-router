mod crypto;
mod delivery;
mod error;
mod routes;

use axum::{
    body::Body,
    extract::{ConnectInfo, Request, State},
    http::{header, HeaderValue, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
    routing::{get, post},
    Router,
};
use sqlx::{
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
    SqlitePool,
};
use std::{
    collections::HashMap,
    env,
    net::SocketAddr,
    path::{Path, PathBuf},
    str::FromStr,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
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
    pub rate_limits: Arc<Mutex<HashMap<String, RateBucket>>>,
}

pub struct RateBucket {
    window_started: Instant,
    count: u32,
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
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "service_notification_router=info,tower_http=info".into()),
        )
        .with(tracing_subscriber::fmt::layer().json())
        .init();

    let data_dir = PathBuf::from(env::var("DATA_DIR").unwrap_or_else(|_| "./data".into()));
    std::fs::create_dir_all(&data_dir)?;
    let db_path = data_dir.join("router.db");
    let database_url = format!("sqlite://{}", db_path.display());
    let options = SqliteConnectOptions::from_str(&database_url)?
        .create_if_missing(true)
        .foreign_keys(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(8)
        .connect_with(options)
        .await?;
    sqlx::migrate!().run(&pool).await?;
    let encryption_key = crypto::load_or_create_key(&data_dir.join("router.key"))?;
    let config = AppConfig {
        public_base_url: env::var("PUBLIC_BASE_URL")
            .unwrap_or_else(|_| "http://localhost:8080".into())
            .trim_end_matches('/')
            .into(),
        billing_api_base: env::var("BILLING_API_BASE")
            .unwrap_or_else(|_| "https://api.sociobot.in/api/v1".into())
            .trim_end_matches('/')
            .into(),
        smtp_host: env::var("SMTP_HOST").ok(),
        smtp_port: env::var("SMTP_PORT")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(587),
        smtp_username: env::var("SMTP_USERNAME").ok(),
        smtp_password: env::var("SMTP_PASSWORD").ok(),
        smtp_from: env::var("SMTP_FROM").ok(),
    };
    let state = AppState {
        pool,
        encryption_key: Arc::new(encryption_key),
        config: Arc::new(config),
        http: reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .user_agent("service-notification-router/1.0")
            .build()?,
        rate_limits: Arc::new(Mutex::new(HashMap::new())),
    };
    spawn_maintenance(state.clone());

    let app = build_app(state, Path::new("frontend/dist"));
    let port = env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8080);
    let listener = tokio::net::TcpListener::bind(("0.0.0.0", port)).await?;
    tracing::info!(port, "router listening");
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal())
    .await?;
    Ok(())
}

pub fn build_app(state: AppState, frontend_dir: &Path) -> Router {
    let index = frontend_dir.join("index.html");
    let api = Router::new()
        .route("/health", get(routes::health))
        .route("/api/status", get(routes::status))
        .route("/api/setup", post(routes::setup))
        .route("/api/login", post(routes::login))
        .route(
            "/api/config",
            get(routes::config).patch(routes::update_config),
        )
        .route("/api/secret/rotate", post(routes::rotate_secret))
        .route(
            "/api/recipients",
            get(routes::list_recipients).post(routes::create_recipient),
        )
        .route(
            "/api/recipients/{id}",
            axum::routing::delete(routes::delete_recipient),
        )
        .route(
            "/api/rules",
            get(routes::list_rules).post(routes::create_rule),
        )
        .route(
            "/api/rules/{id}",
            axum::routing::delete(routes::delete_rule),
        )
        .route("/api/bookings", post(routes::receive_booking))
        .route("/api/bookings/test", post(routes::test_booking))
        .route("/api/events", get(routes::list_events))
        .route("/api/events/{id}/retry", post(routes::retry_event))
        .route(
            "/api/ack/{token}",
            get(routes::ack_status).post(routes::acknowledge),
        )
        .route("/api/purge", post(routes::purge_now))
        .route("/api/license", post(routes::activate_license));

    Router::new()
        .merge(api)
        .fallback_service(ServeDir::new(frontend_dir).not_found_service(ServeFile::new(index)))
        .with_state(state.clone())
        .layer(axum::middleware::from_fn(cache_headers))
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            rate_limit,
        ))
        .layer(CatchPanicLayer::new())
        .layer(RequestBodyLimitLayer::new(256 * 1024))
        .layer(CompressionLayer::new())
        .layer(SetResponseHeaderLayer::if_not_present(header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff")))
        .layer(SetResponseHeaderLayer::if_not_present(header::REFERRER_POLICY, HeaderValue::from_static("same-origin")))
        .layer(SetResponseHeaderLayer::if_not_present(header::X_FRAME_OPTIONS, HeaderValue::from_static("DENY")))
        .layer(SetResponseHeaderLayer::if_not_present(header::CONTENT_SECURITY_POLICY, HeaderValue::from_static("default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self' https://api.sociobot.in https://pilot-api.sociobot.in; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://api.sociobot.in")))
        .layer(TraceLayer::new_for_http())
}

async fn rate_limit(State(state): State<AppState>, request: Request, next: Next) -> Response {
    let path = request.uri().path();
    let limit = match path {
        "/api/login" | "/api/setup" => 20,
        "/api/bookings" => 120,
        _ => return next.run(request).await,
    };
    let peer = request
        .extensions()
        .get::<ConnectInfo<SocketAddr>>()
        .map(|value| value.0.ip().to_string())
        .unwrap_or_else(|| "local-test".into());
    let key = format!("{peer}:{path}");
    let blocked = {
        let mut buckets = state.rate_limits.lock().expect("rate limit lock");
        let bucket = buckets.entry(key).or_insert(RateBucket {
            window_started: Instant::now(),
            count: 0,
        });
        if bucket.window_started.elapsed() >= Duration::from_secs(60) {
            bucket.window_started = Instant::now();
            bucket.count = 0;
        }
        bucket.count += 1;
        bucket.count > limit
    };
    if blocked {
        return (
            StatusCode::TOO_MANY_REQUESTS,
            [(header::RETRY_AFTER, "60")],
            axum::Json(serde_json::json!({"error":"Too many requests. Try again in one minute."})),
        )
            .into_response();
    }
    next.run(request).await
}

async fn cache_headers(request: Request<Body>, next: Next) -> Response {
    let path = request.uri().path().to_owned();
    let mut response = next.run(request).await;
    let value = if path.starts_with("/api/") || path == "/health" {
        "no-store"
    } else if path.starts_with("/assets/index-") {
        "public, max-age=31536000, immutable"
    } else if path.starts_with("/assets/") || path == "/mark.svg" {
        "public, max-age=604800"
    } else {
        "no-cache"
    };
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static(value));
    response
}

fn spawn_maintenance(state: AppState) {
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(Duration::from_secs(30));
        loop {
            tick.tick().await;
            if let Err(error) = routes::purge_expired(&state).await {
                tracing::warn!(%error, "retention purge failed");
            }
            let ids = sqlx::query_scalar::<_, i64>("SELECT id FROM notifications WHERE status IN ('queued','failed') AND attempt_count < 8 AND (next_attempt_at IS NULL OR datetime(next_attempt_at) <= datetime('now')) ORDER BY id LIMIT 20")
                .fetch_all(&state.pool).await.unwrap_or_default();
            for id in ids {
                delivery::deliver_notification(&state, id).await;
            }
        }
    });
}

async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("install Ctrl+C handler");
    };
    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("install signal handler")
            .recv()
            .await;
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! { _ = ctrl_c => {}, _ = terminate => {} }
    tracing::info!("shutdown requested");
}

#[cfg(test)]
mod integration_tests {
    use super::*;
    use axum::{
        body::Body,
        http::{Request, StatusCode},
    };
    use http_body_util::BodyExt;
    use serde_json::{json, Value};
    use tempfile::TempDir;
    use tower::ServiceExt;

    async fn test_app() -> (Router, AppState, TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let options = SqliteConnectOptions::from_str(&format!(
            "sqlite://{}",
            dir.path().join("test.db").display()
        ))
        .unwrap()
        .create_if_missing(true)
        .foreign_keys(true);
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await
            .unwrap();
        sqlx::migrate!().run(&pool).await.unwrap();
        let state = AppState {
            pool,
            encryption_key: Arc::new([4u8; 32]),
            config: Arc::new(AppConfig {
                public_base_url: "http://localhost".into(),
                billing_api_base: "http://localhost".into(),
                smtp_host: None,
                smtp_port: 587,
                smtp_username: None,
                smtp_password: None,
                smtp_from: None,
            }),
            http: reqwest::Client::new(),
            rate_limits: Arc::new(Mutex::new(HashMap::new())),
        };
        (build_app(state.clone(), dir.path()), state, dir)
    }

    async fn json_body(response: axum::response::Response) -> Value {
        serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes()).unwrap()
    }

    #[tokio::test]
    async fn setup_route_and_signed_booking_flow() {
        let (app, state, _dir) = test_app().await;
        let setup = app.clone().oneshot(Request::post("/api/setup").header("content-type","application/json").body(Body::from(json!({"business_name":"Harbor Clinic","password":"correct horse battery","retention_hours":24}).to_string())).unwrap()).await.unwrap();
        assert_eq!(setup.status(), StatusCode::CREATED);
        let setup_json = json_body(setup).await;
        let token = setup_json["token"].as_str().unwrap();
        let secret = setup_json["webhook_secret"].as_str().unwrap();
        let auth = format!("Bearer {token}");

        let recipient = app.clone().oneshot(Request::post("/api/recipients").header("authorization",&auth).header("content-type","application/json").body(Body::from(json!({"name":"Front desk","channel":"email","destination":"desk@example.com","consent_confirmed":true}).to_string())).unwrap()).await.unwrap();
        assert_eq!(recipient.status(), StatusCode::CREATED);
        let recipient_id = json_body(recipient).await["id"].as_i64().unwrap();
        let rule = app.clone().oneshot(Request::post("/api/rules").header("authorization",&auth).header("content-type","application/json").body(Body::from(json!({"match_field":"service","match_value":"Dental cleaning","recipient_id":recipient_id,"priority":10}).to_string())).unwrap()).await.unwrap();
        assert_eq!(rule.status(), StatusCode::CREATED);

        let booking = json!({"external_id":"apt-100","service":"Dental cleaning","provider":"Dr. Rivera","starts_at":"2026-08-28T09:30:00Z","customer_name":"A. Patient","customer_email":"patient@example.com","metadata":{}}).to_string();
        let signature = crate::crypto::sign(secret, booking.as_bytes());
        let received = app
            .clone()
            .oneshot(
                Request::post("/api/bookings")
                    .header("content-type", "application/json")
                    .header("x-router-signature", signature)
                    .body(Body::from(booking))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(received.status(), StatusCode::ACCEPTED);
        let received_json = json_body(received).await;
        assert_eq!(received_json["matched"], true);
        assert_eq!(received_json["delivery_status"], "failed");

        let ack = sqlx::query_scalar::<_, String>("SELECT ack_token FROM notifications LIMIT 1")
            .fetch_one(&state.pool)
            .await
            .unwrap();
        let acknowledged = app
            .oneshot(
                Request::post(format!("/api/ack/{ack}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(acknowledged.status(), StatusCode::OK);
        let stored = sqlx::query_scalar::<_, String>("SELECT status FROM notifications LIMIT 1")
            .fetch_one(&state.pool)
            .await
            .unwrap();
        assert_eq!(stored, "acknowledged");
    }
}
