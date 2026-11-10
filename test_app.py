import unittest

from app import (
    BLACK,
    BOARD_SIZE,
    EMPTY,
    WHITE,
    ApiError,
    RoomManager,
    choose_ai_move,
    has_five,
)


def blank_board():
    return [[EMPTY for _ in range(BOARD_SIZE)] for _ in range(BOARD_SIZE)]


class GomokuTests(unittest.TestCase):
    def test_horizontal_five(self):
        board = blank_board()
        for col in range(3, 8):
            board[6][col] = BLACK
        self.assertTrue(has_five(board, 6, 5, BLACK))

    def test_broken_line_is_not_a_win(self):
        board = blank_board()
        for col in (3, 4, 6, 7, 8):
            board[6][col] = BLACK
        self.assertFalse(has_five(board, 6, 6, BLACK))

    def test_ai_takes_winning_move(self):
        board = blank_board()
        for col in range(4, 8):
            board[7][col] = WHITE
        self.assertIn(choose_ai_move(board), {(7, 3), (7, 8)})

    def test_ai_blocks_human_win(self):
        board = blank_board()
        for row in range(4, 8):
            board[row][8] = BLACK
        self.assertIn(choose_ai_move(board), {(3, 8), (8, 8)})

    def test_all_difficulties_return_legal_moves(self):
        board = blank_board()
        board[7][7] = BLACK
        for difficulty in ("easy", "normal", "hard"):
            move = choose_ai_move(board, difficulty)
            self.assertIsNotNone(move)
            row, col = move
            self.assertEqual(board[row][col], EMPTY)

    def test_hard_ai_takes_winning_move(self):
        board = blank_board()
        for col in range(4, 8):
            board[7][col] = WHITE
        self.assertIn(choose_ai_move(board, "hard"), {(7, 3), (7, 8)})

    def test_invalid_difficulty_is_rejected(self):
        with self.assertRaises(ValueError):
            choose_ai_move(blank_board(), "impossible")

    def test_room_can_be_created_and_joined(self):
        manager = RoomManager()
        room, black_token = manager.create()
        self.assertEqual(len(room.code), 6)
        self.assertEqual(room.snapshot(black_token)["status"], "waiting")

        joined_room, white_token = manager.join(room.code)
        self.assertIs(joined_room, room)
        self.assertEqual(room.snapshot(white_token)["player"], WHITE)
        self.assertEqual(room.status, "playing")

    def test_room_rejects_a_third_player(self):
        manager = RoomManager()
        room, _ = manager.create()
        manager.join(room.code)
        with self.assertRaises(ApiError):
            manager.join(room.code)

    def test_room_rejects_unknown_token(self):
        manager = RoomManager()
        room, _ = manager.create()
        with self.assertRaises(ApiError):
            room.snapshot("not-a-real-token")


if __name__ == "__main__":
    unittest.main()
