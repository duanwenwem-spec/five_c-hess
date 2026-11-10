"""A tiny, dependency-free web server for the Gomoku game."""

from __future__ import annotations

import json
import mimetypes
import random
import re
import secrets
import threading
import time
from dataclasses import dataclass, field
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Iterable
from urllib.parse import parse_qs, urlsplit


BOARD_SIZE = 15
EMPTY, BLACK, WHITE = 0, 1, 2
STATIC_DIR = Path(__file__).resolve().parent / "static"
DIRECTIONS = ((1, 0), (0, 1), (1, 1), (1, -1))
DIFFICULTIES = {"easy", "normal", "hard"}
ROOM_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
ROOM_CODE_LENGTH = 6
ROOM_TTL_SECONDS = 30 * 60
MAX_ACTIVE_ROOMS = 200
ROOM_PATH = re.compile(
    r"^/api/rooms/(?P<code>[A-Z2-9]{6})(?:/(?P<action>join|state|move|resign|rematch|leave))?$"
)


def in_bounds(row: int, col: int) -> bool:
    return 0 <= row < BOARD_SIZE and 0 <= col < BOARD_SIZE


def has_five(board: list[list[int]], row: int, col: int, player: int) -> bool:
    """Return True when the stone at row/col belongs to a line of five or more."""
    if not in_bounds(row, col) or board[row][col] != player:
        return False

    for dr, dc in DIRECTIONS:
        count = 1
        for sign in (1, -1):
            step = 1
            while True:
                nr, nc = row + dr * step * sign, col + dc * step * sign
                if not in_bounds(nr, nc) or board[nr][nc] != player:
                    break
                count += 1
                step += 1
        if count >= 5:
            return True
    return False


def candidate_cells(board: list[list[int]]) -> Iterable[tuple[int, int]]:
    """Yield empty cells close to existing stones, keeping the AI quick."""
    occupied = [
        (r, c)
        for r in range(BOARD_SIZE)
        for c in range(BOARD_SIZE)
        if board[r][c] != EMPTY
    ]
    if not occupied:
        yield BOARD_SIZE // 2, BOARD_SIZE // 2
        return

    candidates: set[tuple[int, int]] = set()
    for row, col in occupied:
        for dr in range(-2, 3):
            for dc in range(-2, 3):
                nr, nc = row + dr, col + dc
                if in_bounds(nr, nc) and board[nr][nc] == EMPTY:
                    candidates.add((nr, nc))
    yield from candidates


def line_score(board: list[list[int]], row: int, col: int, player: int) -> int:
    """Estimate the strength of placing a stone at the supplied cell."""
    score = 0
    for dr, dc in DIRECTIONS:
        total = 1
        open_ends = 0
        for sign in (1, -1):
            step = 1
            while True:
                nr, nc = row + dr * step * sign, col + dc * step * sign
                if not in_bounds(nr, nc):
                    break
                if board[nr][nc] == player:
                    total += 1
                    step += 1
                    continue
                if board[nr][nc] == EMPTY:
                    open_ends += 1
                break

        if total >= 5:
            score += 1_000_000
        elif total == 4:
            score += 45_000 if open_ends == 2 else 8_000
        elif total == 3:
            score += 4_000 if open_ends == 2 else 650
        elif total == 2:
            score += 450 if open_ends == 2 else 90
        else:
            score += 12 * open_ends
    return score


def move_score(board: list[list[int]], row: int, col: int) -> int:
    """Score a white move by balancing attack, defence and board position."""
    attack = line_score(board, row, col, WHITE)
    defence = line_score(board, row, col, BLACK)
    if attack >= 1_000_000:
        return 10_000_000 + attack
    if defence >= 1_000_000:
        return 9_000_000 + defence

    center = BOARD_SIZE // 2
    distance = abs(row - center) + abs(col - center)
    return attack * 11 // 10 + defence - distance * 2


def best_scored_moves(board: list[list[int]]) -> list[tuple[int, int]]:
    """Return all moves tied for the best one-ply pattern score."""
    candidates = list(candidate_cells(board))
    if not candidates:
        return []

    best_score = -1
    best_moves: list[tuple[int, int]] = []
    for row, col in candidates:
        score = move_score(board, row, col)

        if score > best_score:
            best_score = score
            best_moves = [(row, col)]
        elif score == best_score:
            best_moves.append((row, col))

    return best_moves


def choose_easy_move(board: list[list[int]]) -> tuple[int, int] | None:
    """Choose a forgiving move: take obvious wins, otherwise play nearby."""
    candidates = list(candidate_cells(board))
    if not candidates:
        return None

    winning: list[tuple[int, int]] = []
    for row, col in candidates:
        board[row][col] = WHITE
        if has_five(board, row, col, WHITE):
            winning.append((row, col))
        board[row][col] = EMPTY
    return random.choice(winning or candidates)


def choose_hard_move(board: list[list[int]]) -> tuple[int, int] | None:
    """Look one reply ahead to avoid traps and build forcing threats."""
    candidates = list(candidate_cells(board))
    if not candidates:
        return None

    # Never miss a direct win or fail to answer a direct human win.
    for player in (WHITE, BLACK):
        urgent: list[tuple[int, int]] = []
        for row, col in candidates:
            board[row][col] = player
            if has_five(board, row, col, player):
                urgent.append((row, col))
            board[row][col] = EMPTY
        if urgent:
            return random.choice(urgent)

    # Search the most plausible moves more deeply. This keeps response times
    # small while allowing the hard level to see the opponent's best reply.
    ranked = sorted(candidates, key=lambda move: move_score(board, *move), reverse=True)[:32]
    best_value: int | None = None
    best_moves: list[tuple[int, int]] = []
    center = BOARD_SIZE // 2

    for row, col in ranked:
        attack = line_score(board, row, col, WHITE)
        defence = line_score(board, row, col, BLACK)
        board[row][col] = WHITE

        replies = list(candidate_cells(board))
        opponent_pressure = max(
            (line_score(board, r, c, BLACK) for r, c in replies),
            default=0,
        )
        follow_up = max(
            (line_score(board, r, c, WHITE) for r, c in replies),
            default=0,
        )
        board[row][col] = EMPTY

        distance = abs(row - center) + abs(col - center)
        value = (
            attack * 6
            + defence * 5
            + follow_up * 2
            - opponent_pressure * 2
            - distance * 3
        )
        if best_value is None or value > best_value:
            best_value = value
            best_moves = [(row, col)]
        elif value == best_value:
            best_moves.append((row, col))

    return random.choice(best_moves)


def choose_ai_move(
    board: list[list[int]], difficulty: str = "normal"
) -> tuple[int, int] | None:
    """Choose a white move using the requested difficulty profile."""
    if difficulty not in DIFFICULTIES:
        raise ValueError("invalid difficulty")
    if difficulty == "easy":
        return choose_easy_move(board)
    if difficulty == "hard":
        return choose_hard_move(board)
    best_moves = best_scored_moves(board)
    return random.choice(best_moves) if best_moves else None


def valid_board(value: object) -> bool:
    return (
        isinstance(value, list)
        and len(value) == BOARD_SIZE
        and all(
            isinstance(row, list)
            and len(row) == BOARD_SIZE
            and all(cell in (EMPTY, BLACK, WHITE) for cell in row)
            for row in value
        )
    )


def blank_board() -> list[list[int]]:
    return [[EMPTY for _ in range(BOARD_SIZE)] for _ in range(BOARD_SIZE)]


class ApiError(ValueError):
    def __init__(self, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.status = status


@dataclass
class Room:
    code: str
    black_token: str
    white_token: str | None = None
    board: list[list[int]] = field(default_factory=blank_board)
    current_player: int = BLACK
    winner: int | None = None
    status: str = "waiting"
    revision: int = 0
    history: list[dict[str, int]] = field(default_factory=list)
    rematch_players: set[int] = field(default_factory=set)
    last_seen: dict[int, float] = field(default_factory=dict)
    updated_at: float = field(default_factory=time.monotonic)
    lock: threading.RLock = field(default_factory=threading.RLock, repr=False)
    condition: threading.Condition = field(init=False, repr=False)

    def __post_init__(self) -> None:
        self.condition = threading.Condition(self.lock)
        self.last_seen[BLACK] = time.monotonic()

    def player_for(self, token: str) -> int:
        if secrets.compare_digest(token, self.black_token):
            return BLACK
        if self.white_token and secrets.compare_digest(token, self.white_token):
            return WHITE
        raise ApiError("玩家身份已失效，请重新加入", 403)

    def touch(self, player: int) -> None:
        now = time.monotonic()
        self.last_seen[player] = now
        self.updated_at = now

    def changed(self) -> None:
        self.revision += 1
        self.updated_at = time.monotonic()
        self.condition.notify_all()

    def snapshot(self, token: str) -> dict[str, object]:
        player = self.player_for(token)
        self.touch(player)
        opponent = WHITE if player == BLACK else BLACK
        last_move = self.history[-1] if self.history else None
        return {
            "roomCode": self.code,
            "status": self.status,
            "board": self.board,
            "currentPlayer": self.current_player,
            "player": player,
            "winner": self.winner,
            "revision": self.revision,
            "moveCount": len(self.history),
            "lastMove": last_move,
            "opponentConnected": (
                opponent in self.last_seen
                and time.monotonic() - self.last_seen[opponent] < 35
            ),
            "rematchRequested": player in self.rematch_players,
            "opponentRematch": opponent in self.rematch_players,
        }


class RoomManager:
    def __init__(self) -> None:
        self.rooms: dict[str, Room] = {}
        self.lock = threading.RLock()

    def _cleanup(self) -> None:
        cutoff = time.monotonic() - ROOM_TTL_SECONDS
        for code, room in list(self.rooms.items()):
            if room.updated_at < cutoff:
                del self.rooms[code]

    def create(self) -> tuple[Room, str]:
        with self.lock:
            self._cleanup()
            if len(self.rooms) >= MAX_ACTIVE_ROOMS:
                raise ApiError("当前房间数量已达上限，请稍后重试", 503)
            while True:
                code = "".join(secrets.choice(ROOM_CODE_CHARS) for _ in range(ROOM_CODE_LENGTH))
                if code not in self.rooms:
                    break
            token = secrets.token_urlsafe(32)
            room = Room(code=code, black_token=token)
            self.rooms[code] = room
            return room, token

    def get(self, code: str) -> Room:
        with self.lock:
            self._cleanup()
            room = self.rooms.get(code.upper())
        if room is None:
            raise ApiError("房间不存在或已经过期", 404)
        return room

    def join(self, code: str) -> tuple[Room, str]:
        room = self.get(code)
        with room.lock:
            if room.white_token is not None:
                raise ApiError("房间人数已满", 409)
            token = secrets.token_urlsafe(32)
            room.white_token = token
            room.status = "playing"
            room.last_seen[WHITE] = time.monotonic()
            room.changed()
            return room, token


ROOMS = RoomManager()


class GomokuHandler(SimpleHTTPRequestHandler):
    def translate_path(self, path: str) -> str:
        clean_path = path.split("?", 1)[0].split("#", 1)[0].lstrip("/")
        if not clean_path:
            clean_path = "index.html"
        requested = (STATIC_DIR / clean_path).resolve()
        if STATIC_DIR.resolve() not in requested.parents and requested != STATIC_DIR.resolve():
            return str(STATIC_DIR / "404")
        return str(requested)

    def end_headers(self) -> None:
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def do_GET(self) -> None:  # noqa: N802 - required by BaseHTTPRequestHandler
        parsed = urlsplit(self.path)
        match = ROOM_PATH.match(parsed.path)
        if match and match.group("action") == "state":
            try:
                query = parse_qs(parsed.query)
                token = query.get("token", [""])[0]
                if not token:
                    raise ApiError("缺少玩家身份", 401)
                try:
                    revision = int(query.get("revision", ["-1"])[0])
                except ValueError as exc:
                    raise ApiError("无效的棋局版本") from exc
                room = ROOMS.get(match.group("code"))
                with room.condition:
                    room.player_for(token)
                    if room.revision == revision:
                        room.condition.wait(timeout=20)
                    self._send_json(200, room.snapshot(token))
            except ApiError as exc:
                self._send_json(exc.status, {"error": str(exc)})
            except (BrokenPipeError, ConnectionResetError):
                pass
            return
        if parsed.path.startswith("/api/"):
            self._send_json(404, {"error": "接口不存在"})
            return
        super().do_GET()

    def do_POST(self) -> None:  # noqa: N802 - required by BaseHTTPRequestHandler
        try:
            parsed = urlsplit(self.path)
            payload = self._read_json()
            if parsed.path == "/api/move":
                self._handle_ai_move(payload)
                return
            if parsed.path == "/api/rooms":
                room, token = ROOMS.create()
                self._send_json(201, {**room.snapshot(token), "token": token})
                return

            match = ROOM_PATH.match(parsed.path)
            if not match:
                raise ApiError("接口不存在", 404)
            action = match.group("action")
            code = match.group("code")
            if action == "join":
                room, token = ROOMS.join(code)
                self._send_json(200, {**room.snapshot(token), "token": token})
                return
            if action not in {"move", "resign", "rematch", "leave"}:
                raise ApiError("接口不存在", 404)
            token = payload.get("token")
            if not isinstance(token, str) or not token:
                raise ApiError("缺少玩家身份", 401)
            room = ROOMS.get(code)
            with room.condition:
                player = room.player_for(token)
                room.touch(player)
                if action == "move":
                    self._handle_room_move(room, player, payload)
                elif action == "resign":
                    if room.status != "playing":
                        raise ApiError("当前对局不能认输", 409)
                    room.winner = WHITE if player == BLACK else BLACK
                    room.status = "finished"
                    room.changed()
                elif action == "rematch":
                    if room.status != "finished":
                        raise ApiError("对局结束后才能再来一局", 409)
                    room.rematch_players.add(player)
                    if room.rematch_players == {BLACK, WHITE}:
                        room.black_token, room.white_token = room.white_token, room.black_token
                        room.board = blank_board()
                        room.current_player = BLACK
                        room.winner = None
                        room.status = "playing"
                        room.history.clear()
                        room.rematch_players.clear()
                    room.changed()
                else:
                    room.status = "finished"
                    room.winner = WHITE if player == BLACK else BLACK
                    room.changed()
                self._send_json(200, room.snapshot(token))
        except ApiError as exc:
            self._send_json(exc.status, {"error": str(exc)})
        except (ValueError, TypeError, json.JSONDecodeError) as exc:
            self._send_json(400, {"error": str(exc)})

    def _read_json(self) -> dict[str, object]:
        length = int(self.headers.get("Content-Length", "0"))
        if length > 32_000:
            raise ApiError("请求内容过大", 413)
        if length == 0:
            return {}
        payload = json.loads(self.rfile.read(length))
        if not isinstance(payload, dict):
            raise ApiError("无效的请求")
        return payload

    def _handle_ai_move(self, payload: dict[str, object]) -> None:
        board = payload.get("board")
        if not valid_board(board):
            raise ApiError("无效的棋盘")
        difficulty = payload.get("difficulty", "normal")
        if not isinstance(difficulty, str) or difficulty not in DIFFICULTIES:
            raise ApiError("无效的难度")

        move = choose_ai_move(board, difficulty)
        response: dict[str, object] = {"move": None, "winner": None}
        if move is not None:
            row, col = move
            board[row][col] = WHITE
            response["move"] = {"row": row, "col": col}
            if has_five(board, row, col, WHITE):
                response["winner"] = WHITE
        self._send_json(200, response)

    def _handle_room_move(
        self, room: Room, player: int, payload: dict[str, object]
    ) -> None:
        if room.status != "playing":
            raise ApiError("对局尚未开始或已经结束", 409)
        if room.current_player != player:
            raise ApiError("还没有轮到你落子", 409)
        row, col = payload.get("row"), payload.get("col")
        if not isinstance(row, int) or not isinstance(col, int) or not in_bounds(row, col):
            raise ApiError("无效的落子位置")
        expected = payload.get("revision")
        if expected is not None and expected != room.revision:
            raise ApiError("棋局状态已更新，请重试", 409)
        if room.board[row][col] != EMPTY:
            raise ApiError("该位置已经有棋子", 409)

        room.board[row][col] = player
        room.history.append({"row": row, "col": col, "player": player})
        if has_five(room.board, row, col, player):
            room.winner = player
            room.status = "finished"
        elif len(room.history) == BOARD_SIZE * BOARD_SIZE:
            room.winner = EMPTY
            room.status = "finished"
        else:
            room.current_player = WHITE if player == BLACK else BLACK
        room.changed()

    def _send_json(self, status: int, payload: dict[str, object]) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def guess_type(self, path: str) -> str:
        return mimetypes.guess_type(path)[0] or "application/octet-stream"


def run(host: str = "0.0.0.0", port: int = 8000) -> None:
    server = ThreadingHTTPServer((host, port), GomokuHandler)
    print(f"五子棋已启动：http://127.0.0.1:{port}")
    print("手机访问：请将 127.0.0.1 替换为这台电脑的局域网 IP")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n游戏已停止")
    finally:
        server.server_close()


if __name__ == "__main__":
    run()
