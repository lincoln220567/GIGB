import asyncio
import json
import os
from pathlib import Path
from datetime import datetime

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

APP = FastAPI()

# Добавляем CORS для локальной сети
APP.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE = Path(__file__).parent
DATA_DIR = BASE / "data"
DATA_FILE = DATA_DIR / "tournament.json"

# Гарантируем существование папки data
DATA_DIR.mkdir(exist_ok=True)


class ConnectionManager:
    def __init__(self):
        self.active: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active.append(websocket)

    def disconnect(self, websocket: WebSocket):
        try:
            self.active.remove(websocket)
        except ValueError:
            pass

    async def broadcast(self, message: str):
        for ws in list(self.active):
            try:
                await ws.send_text(message)
            except Exception:
                self.disconnect(ws)

    async def broadcast_current_data(self):
        """Отправить текущие данные всем подключенным клиентам"""
        if DATA_FILE.exists():
            try:
                text = DATA_FILE.read_text(encoding="utf-8")
                await self.broadcast(text)
            except Exception:
                pass


manager = ConnectionManager()


@APP.on_event("startup")
async def startup_poll_file():
    # Запускаем фоновую задачу для опроса файла и рассылки изменений
    APP.state._last_mtime = 0
    APP.state._last_content = ""
    APP.state._poll_task = asyncio.create_task(_poll_file_loop())


async def _poll_file_loop():
    while True:
        try:
            if DATA_FILE.exists():
                mtime = DATA_FILE.stat().st_mtime
                if mtime != APP.state._last_mtime:
                    APP.state._last_mtime = mtime
                    text = DATA_FILE.read_text(encoding="utf-8")
                    APP.state._last_content = text
                    await manager.broadcast(text)
        except Exception:
            pass
        await asyncio.sleep(0.2)  # Очень быстрый опрос для мгновенной реакции


@APP.get("/api/tournament")
async def get_tournament():
    if DATA_FILE.exists():
        try:
            data = json.loads(DATA_FILE.read_text(encoding="utf-8"))
            return JSONResponse(content=data)
        except Exception as e:
            return JSONResponse(content={"error": f"invalid json: {str(e)}"}, status_code=500)
    return JSONResponse(content={"name": "Турнир", "stage": "single", "players": [], "matches": []})


@APP.put("/api/tournament")
async def update_tournament(data: dict):
    """Обновить данные турнира (вызывается из desktop приложения)"""
    try:
        # Добавляем метку времени обновления
        data["lastUpdated"] = datetime.now().isoformat()
        
        # Сохраняем в файл
        with open(DATA_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        
        # Рассылаем всем подключенным клиентам
        await manager.broadcast_current_data()
        
        return JSONResponse(content={"status": "ok", "message": "Данные обновлены"})
    except Exception as e:
        return JSONResponse(content={"error": str(e)}, status_code=500)


@APP.post("/api/tournament/save")
async def save_tournament(data: dict):
    """Сохранить данные турнира (вызывается из сайта)"""
    try:
        # Сохраняем в файл
        with open(DATA_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        
        # Обновляем mtime чтобы не дублировать рассылку
        APP.state._last_mtime = DATA_FILE.stat().st_mtime
        APP.state._last_content = json.dumps(data, ensure_ascii=False)
        
        # Рассылаем всем подключенным клиентам мгновенно
        await manager.broadcast(APP.state._last_content)
        
        return JSONResponse(content={"status": "ok", "message": "Данные сохранены"})
    except Exception as e:
        return JSONResponse(content={"error": str(e)}, status_code=500)


@APP.get("/api/tournament/stats")
async def get_tournament_stats():
    """Получить статистику турнира"""
    if not DATA_FILE.exists():
        return JSONResponse(content={
            "playerCount": 0,
            "matchCount": 0,
            "completedMatches": 0,
            "stage": "single"
        })
    
    try:
        data = json.loads(DATA_FILE.read_text(encoding="utf-8"))
        matches = data.get("matches", [])
        completed = len([m for m in matches if m.get("status") == "Завершено"])
        
        return JSONResponse(content={
            "playerCount": len(data.get("players", [])),
            "matchCount": len(matches),
            "completedMatches": completed,
            "stage": data.get("stage", "single"),
            "name": data.get("name", "Турнир")
        })
    except Exception:
        return JSONResponse(content={"error": "invalid data"}, status_code=500)


@APP.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        # Отправляем текущие данные сразу после подключения
        if DATA_FILE.exists():
            await websocket.send_text(DATA_FILE.read_text(encoding="utf-8"))
        else:
            # Отправляем пустые данные если файла нет
            await websocket.send_text('{"name": "Турнир", "stage": "single", "players": [], "matches": []}')
        
        # Держим соединение открытым
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)


APP.mount("/", StaticFiles(directory=BASE / "web", html=True), name="web")


if __name__ == "__main__":
    import uvicorn
    import os

    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("server:APP", host="0.0.0.0", port=port, reload=False)
