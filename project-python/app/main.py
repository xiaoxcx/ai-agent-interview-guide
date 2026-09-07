# -*- coding: utf-8 -*-
"""FastAPI 应用入口：生命周期内初始化异步数据库引擎。"""

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles
from loguru import logger

from app.api.routes import chat, document, health
from app.config import get_settings
from app.infrastructure.database.session import configure_session, init_engine

# 内置前端控制台静态资源目录（app/web）
_WEB_DIR = Path(__file__).resolve().parent / "web"


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    logger.info("启动 {} ({})", settings.app_name, settings.app_env)
    engine = init_engine(settings.database_url)
    configure_session(engine)
    app.state.engine = engine
    yield
    await engine.dispose()
    logger.info("关闭 {}", settings.app_name)


def create_app() -> FastAPI:
    settings = get_settings()
    application = FastAPI(
        title=settings.app_name,
        debug=settings.debug,
        lifespan=lifespan,
    )
    application.include_router(health.router, prefix=settings.api_prefix)
    application.include_router(chat.router, prefix=settings.api_prefix)
    application.include_router(document.router, prefix=settings.api_prefix)

    # 允许前端（或本地静态页面）跨域调用
    application.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    if _WEB_DIR.is_dir():
        application.mount("/ui", StaticFiles(directory=_WEB_DIR, html=True), name="web")

        @application.get("/", include_in_schema=False)
        async def _index() -> RedirectResponse:
            """根路径跳转到内置前端控制台。"""
            return RedirectResponse(url="/ui/")

    return application


app = create_app()
